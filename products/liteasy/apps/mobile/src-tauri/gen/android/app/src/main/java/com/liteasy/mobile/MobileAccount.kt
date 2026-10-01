package com.liteasy.mobile

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Base64
import okhttp3.FormBody
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class AccountHttpError(val status: Int) : IllegalStateException(if (status == 401 || status == 403) "登录已失效，请重新登录。" else "账号服务暂时不可用，请稍后重试。")
fun interface AccountHttp { fun execute(request: Request): JSONObject }

/** OAuth credentials and PKCE verifiers never cross the WebView bridge. */
class MobileAccount(private val context: Context, private val http: AccountHttp = AccountHttp { request ->
    client.newCall(request).execute().use { response ->
        if (!response.isSuccessful) throw AccountHttpError(response.code)
        val body = response.body ?: error("账号服务没有返回内容。")
        val limit = if (request.url.encodedPath.endsWith("/v1/mobile/devices")) 4 * 1024 * 1024 else 1024 * 1024
        require(body.contentLength() <= limit) { "账号服务响应过大。" }
        val bytes = body.byteStream().use { it.readBytesBounded(limit) }
        if (bytes.isEmpty()) JSONObject() else JSONObject(String(bytes))
    }
}) {
    companion object {
        const val REDIRECT = "com.liteasy.mobile://oauth/callback"
        private const val SESSION = "account-session"
        private const val PENDING = "account-pending"
        private val lock = Any()
        private val callbacks = Executors.newSingleThreadExecutor()
        private val client = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
            .connectTimeout(15, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS).callTimeout(45, TimeUnit.SECONDS).build()
        private fun random(): String = ByteArray(32).also { SecureRandom().nextBytes(it) }.let { Base64.encodeToString(it, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP) }
        fun receive(context: Context, intent: Intent?) {
            val uri = intent?.data ?: return
            if (intent.action != Intent.ACTION_VIEW || uri.scheme != "com.liteasy.mobile" || uri.host != "oauth" || uri.path != "/callback") return
            callbacks.execute { try { MobileAccount(context.applicationContext).complete(uri) } catch (_: Exception) { /* Public status already carries a safe error. */ } }
        }
        fun endpoint(value: String): HttpUrl {
            val url = value.trim().toHttpUrl()
            require(url.isHttps && url.username.isEmpty() && url.password.isEmpty() && url.query == null && url.fragment == null) { "服务地址必须是没有账号密码的 HTTPS 地址。" }
            return url
        }
        private fun sameOrigin(base: HttpUrl, value: String): HttpUrl = endpoint(value).also {
            require(it.scheme == base.scheme && it.host == base.host && it.port == base.port) { "身份服务地址不匹配。" }
        }
    }
    private val secure = SecureStore(context)
    private val preferences = context.getSharedPreferences("account-status", Context.MODE_PRIVATE)
    private fun credential() = secure.read(SESSION)?.let(::JSONObject)
    private fun read(url: HttpUrl, bearer: String? = null) = http.execute(Request.Builder().url(url).apply { if (bearer != null) header("Authorization", "Bearer $bearer") }.build())
    private fun form(url: String, fields: Map<String, String>) = http.execute(Request.Builder().url(endpoint(url))
        .post(FormBody.Builder().apply { fields.forEach { (key, value) -> add(key, value) } }.build()).build())
    private fun scope(session: JSONObject) = "account:${LibraryStore.digest("${session.getString("apiBaseUrl")}\n${session.getString("issuer")}\n${session.getString("subject")}".toByteArray())}"
    // SecureStore serializes atomic file access independently; local reads never wait for network I/O.
    fun activeScope(): String = credential()?.let { scope(it) } ?: "local"
    fun status(): JSONObject {
        val result = JSONObject().put("scope", "local").put("apiBaseUrl", preferences.getString("apiBaseUrl", ""))
            .put("error", preferences.getString("error", ""))
        secure.read(PENDING)?.let { value ->
            val pending = JSONObject(value)
            if (pending.getLong("expiresAt") > System.currentTimeMillis()) result.put("pending", true)
            else result.put("error", "登录已超时，请重新开始。")
        }
        credential()?.let { value -> result.put("scope", scope(value)).put("subject", value.getString("subject"))
            .put("apiBaseUrl", value.getString("apiBaseUrl")).put("expiresAt", value.getLong("expiresAt")) }
        return result
    }
    fun begin(base: String): String = synchronized(lock) {
        val apiBase = endpoint(base).toString().trimEnd('/')
        val config = read("$apiBase/v1/identity/mobile-config".toHttpUrl())
        require(config.getString("audience") == "liteasy-mobile" && config.getString("authorizationFlow") == "authorization_code_pkce" && config.getString("redirectUri") == REDIRECT) { "此服务尚未启用手机登录。" }
        val issuer = endpoint(config.getString("issuer"))
        val clientId = config.getString("clientId")
        require(Regex("[a-zA-Z0-9._~-]{1,200}").matches(clientId)) { "手机登录配置无效。" }
        val discovery = read("${issuer.toString().trimEnd('/')}/.well-known/openid-configuration".toHttpUrl())
        require(discovery.getString("issuer") == config.getString("issuer")) { "身份服务与登录配置不符。" }
        val authorization = sameOrigin(issuer, discovery.getString("authorization_endpoint"))
        val token = sameOrigin(issuer, discovery.getString("token_endpoint"))
        val revocation = sameOrigin(issuer, config.getString("revocationUrl"))
        require(discovery.optJSONArray("code_challenge_methods_supported")?.let { array -> (0 until array.length()).any { array.optString(it) == "S256" } } == true) { "身份服务未提供安全的手机登录方式。" }
        val verifier = random(); val state = random()
        val challenge = Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)), Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
        val pending = JSONObject().put("apiBaseUrl", apiBase).put("issuer", config.getString("issuer")).put("clientId", clientId)
            .put("tokenEndpoint", token.toString()).put("revocationUrl", revocation.toString()).put("verifier", verifier).put("state", state)
            .put("expiresAt", System.currentTimeMillis() + 5 * 60_000)
        secure.write(PENDING, pending.toString()); preferences.edit().putString("apiBaseUrl", apiBase).remove("error").apply()
        authorization.newBuilder().addQueryParameter("response_type", "code").addQueryParameter("client_id", clientId)
            .addQueryParameter("redirect_uri", REDIRECT).addQueryParameter("scope", "openid email profile offline_access")
            .addQueryParameter("audience", "liteasy-mobile").addQueryParameter("state", state)
            .addQueryParameter("code_challenge", challenge).addQueryParameter("code_challenge_method", "S256").build().toString()
    }
    fun complete(uri: Uri): JSONObject = synchronized(lock) {
        try {
            val pending = secure.read(PENDING)?.let(::JSONObject) ?: error("没有等待中的登录请求。")
            require(uri.scheme == "com.liteasy.mobile" && uri.host == "oauth" && uri.path == "/callback" && uri.fragment == null && uri.port == -1 && uri.userInfo == null) { "登录回调地址无效。" }
            val states = uri.getQueryParameters("state")
            require(states.size == 1 && MessageDigest.isEqual(states[0].toByteArray(), pending.getString("state").toByteArray())) { "登录请求不匹配，请重新开始。" }
            require(pending.getLong("expiresAt") > System.currentTimeMillis()) { "登录已超时，请重新开始。" }
            secure.remove(PENDING) // A matching callback is consumed before its code is exchanged.
            require(uri.getQueryParameter("error") == null) { "登录未完成，可以重新开始。" }
            val codes = uri.getQueryParameters("code")
            require(codes.size == 1 && codes[0].length in 1..8192) { "登录授权码无效。" }
            val tokens = form(pending.getString("tokenEndpoint"), mapOf("grant_type" to "authorization_code", "code" to codes[0],
                "redirect_uri" to REDIRECT, "client_id" to pending.getString("clientId"), "code_verifier" to pending.getString("verifier")))
            val session = verified(pending, tokens, null)
            val oldScope = activeScope(); secure.write(SESSION, session.toString())
            if (oldScope != scope(session)) { DavSyncWorker.suspend(context, oldScope); TaskOutboxWorker.suspend(context, oldScope) }
            if (DavSync(context, scope(session)).settings() != null) DavSyncWorker.schedule(context, scope(session), false)
            TaskOutboxWorker.schedule(context, scope(session))
            preferences.edit().remove("error").apply(); status()
        } catch (error: Exception) {
            preferences.edit().putString("error", safeError(error)).apply(); throw IllegalStateException(safeError(error))
        }
    }
    private fun verified(config: JSONObject, tokens: JSONObject, expectedSubject: String?): JSONObject {
        require(tokens.optString("token_type").equals("bearer", true)) { "登录凭据格式无效。" }
        val access = tokens.getString("access_token"); val seconds = tokens.getLong("expires_in")
        require(access.length in 1..32_768 && seconds in 1..604_800) { "登录凭据有效期无效。" }
        // Identity comes from the business API's JWT + introspection checks, not unverified ID-token claims.
        val profile = read("${config.getString("apiBaseUrl")}/v1/mobile/session".toHttpUrl(), access)
        val subject = profile.getString("subject")
        require(profile.getString("issuer") == config.getString("issuer") && profile.getString("audience") == "liteasy-mobile" && subject.length in 1..512) { "登录账号与身份服务不匹配。" }
        require(expectedSubject == null || expectedSubject == subject) { "刷新后的账号已变化，请重新登录。" }
        return JSONObject().apply {
            for (key in listOf("apiBaseUrl", "issuer", "clientId", "tokenEndpoint", "revocationUrl")) put(key, config.getString(key))
            put("subject", subject); put("accessToken", access); put("expiresAt", System.currentTimeMillis() + seconds * 1000)
            val refresh = tokens.optString("refresh_token").ifEmpty { config.optString("refreshToken") }
            require(refresh.length <= 32_768) { "刷新凭据格式无效。" }
            if (refresh.isNotEmpty()) put("refreshToken", refresh)
        }
    }
    private fun token(): JSONObject {
        val current = credential() ?: error("请先登录账号。")
        if (current.getLong("expiresAt") > System.currentTimeMillis() + 60_000) return current
        val refresh = current.optString("refreshToken")
        if (refresh.isEmpty()) { clear(); error("登录已过期，请重新登录。"); }
        try {
            val tokens = form(current.getString("tokenEndpoint"), mapOf("grant_type" to "refresh_token", "refresh_token" to refresh, "client_id" to current.getString("clientId")))
            val next = verified(current, tokens, current.getString("subject")); secure.write(SESSION, next.toString()); return next
        } catch (error: AccountHttpError) {
            if (error.status in listOf(400, 401, 403)) clear()
            throw error
        }
    }
    fun request(path: String, method: String = "GET", body: JSONObject? = null, deviceHeaders: Map<String, String> = emptyMap(), expectedScope: String? = null): JSONObject {
      val authorized = synchronized(lock) {
        require(expectedScope == null || expectedScope == activeScope()) { "账号已切换，请返回当前资料库重试。" }
        require(path.startsWith("/v1/mobile/") && !path.contains("..") && !path.contains('\\') && !path.contains('#')) { "账号请求路径无效。" }
        val session = token(); val base = endpoint(session.getString("apiBaseUrl"))
        val url = "${session.getString("apiBaseUrl")}$path".toHttpUrl()
        require(url.host == base.host && url.port == base.port && url.encodedPath.startsWith("${base.encodedPath.trimEnd('/')}/v1/mobile/")) { "账号请求地址无效。" }
        require(method in listOf("GET", "POST", "DELETE"))
        val builder = Request.Builder().url(url).header("Authorization", "Bearer ${session.getString("accessToken")}")
        for ((name, value) in deviceHeaders) {
            require(name in listOf("X-Liteasy-Device-Id", "X-Liteasy-Device-Secret")); builder.header(name, value)
        }
        if (method != "GET") builder.method(method, (body ?: JSONObject()).toString().toRequestBody("application/json".toMediaType()))
        Pair(builder.build(), session)
      }
      val result = try { http.execute(authorized.first) }
      catch (error: AccountHttpError) {
        if (error.status == 401) synchronized(lock) {
          val current = credential()
          if (current != null && current.optString("accessToken") == authorized.second.optString("accessToken") && scope(current) == scope(authorized.second)) clear()
        }
        throw error
      }
      require(expectedScope == null || expectedScope == activeScope()) { "账号已切换，请返回当前资料库重试。" }
      return result
    }
    fun cancelLogin() = synchronized(lock) { secure.remove(PENDING); preferences.edit().remove("error").apply() }
    fun browserUnavailable() = synchronized(lock) { secure.remove(PENDING); preferences.edit().putString("error", "无法打开系统浏览器，请安装或启用浏览器后重试。").apply() }
    private fun clear() { val old = credential()?.let { scope(it) }; secure.remove(SESSION); secure.remove(PENDING); old?.let { DavSyncWorker.suspend(context, it); TaskOutboxWorker.suspend(context, it) } }
    fun logout(): JSONObject = synchronized(lock) {
        val previous = credential(); clear(); preferences.edit().remove("error").apply()
        if (previous != null) try { form(previous.getString("revocationUrl"), mapOf("token" to previous.optString("refreshToken", previous.getString("accessToken")),
            "token_type_hint" to if (previous.has("refreshToken")) "refresh_token" else "access_token", "client_id" to previous.getString("clientId"))) }
        catch (_: Exception) { preferences.edit().putString("error", "已退出此设备；暂时无法确认服务器撤销，请在账号安全设置中检查会话。").apply() }
        status()
    }
    private fun safeError(error: Exception) = if (error is java.io.IOException) "无法连接账号服务，请检查网络后重试。" else if (error is AccountHttpError || error is IllegalArgumentException || error is IllegalStateException) error.message ?: "登录失败，请重试。" else "登录响应无效，请重试。"
}

private fun java.io.InputStream.readBytesBounded(limit: Int): ByteArray {
    val output = java.io.ByteArrayOutputStream(); val buffer = ByteArray(8192)
    while (true) { val count = read(buffer); if (count < 0) break; require(output.size() + count <= limit) { "账号服务响应过大。" }; output.write(buffer, 0, count) }
    return output.toByteArray()
}
