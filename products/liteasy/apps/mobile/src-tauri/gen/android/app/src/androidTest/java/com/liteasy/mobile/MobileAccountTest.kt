package com.liteasy.mobile

import android.content.Context
import android.content.ContextWrapper
import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import okhttp3.Request
import okio.Buffer
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class MobileAccountTest {
    private fun isolatedContext(): Context {
        val base = InstrumentationRegistry.getInstrumentation().targetContext; val id = UUID.randomUUID().toString()
        return object : ContextWrapper(base) {
            override fun getNoBackupFilesDir(): File = File(base.noBackupFilesDir, "auth-test-$id").apply { mkdirs() }
            override fun getSharedPreferences(name: String, mode: Int) = base.getSharedPreferences("$name-$id", mode)
        }
    }
    private class Provider : AccountHttp {
        var exchanges = 0; var revoked = false; var subject = "user-a"; var reject = false; var lastForm = ""
        var deviceHandler: ((Request) -> JSONObject)? = null
        override fun execute(request: Request): JSONObject {
            return when (request.url.encodedPath) {
                "/v1/identity/mobile-config" -> JSONObject().put("audience", "liteasy-mobile").put("authorizationFlow", "authorization_code_pkce")
                    .put("clientId", "mobile-public").put("issuer", "https://identity.example").put("redirectUri", MobileAccount.REDIRECT).put("revocationUrl", "https://identity.example/revoke")
                "/.well-known/openid-configuration" -> JSONObject().put("issuer", "https://identity.example").put("authorization_endpoint", "https://identity.example/authorize")
                    .put("token_endpoint", "https://identity.example/token").put("code_challenge_methods_supported", org.json.JSONArray().put("S256"))
                "/token" -> {
                    if (reject) throw AccountHttpError(400)
                    val buffer = Buffer(); request.body!!.writeTo(buffer); lastForm = buffer.readUtf8(); exchanges++
                    JSONObject().put("token_type", "Bearer").put("access_token", "secret-access-$exchanges").put("refresh_token", "secret-refresh-$exchanges").put("expires_in", 3600)
                }
                "/v1/mobile/session" -> {
                    assertTrue(request.header("Authorization")!!.startsWith("Bearer secret-access-"))
                    JSONObject().put("subject", subject).put("issuer", "https://identity.example").put("audience", "liteasy-mobile")
                }
                "/revoke" -> { revoked = true; JSONObject() }
                else -> deviceHandler?.invoke(request) ?: error("Unexpected endpoint")
            }
        }
    }
    private fun callback(url: String) = Uri.parse("${MobileAccount.REDIRECT}?code=test-code&state=${Uri.parse(url).getQueryParameter("state")}")
    @Test fun outboxSurvivesUnknownDeliveryAndRetriesSameOperation() {
        val context = isolatedContext(); val provider = Provider(); val account = MobileAccount(context, provider)
        provider.subject = "outbox-${UUID.randomUUID()}"
        val scope = account.complete(callback(account.begin("https://api.example"))).getString("scope")
        val received = mutableListOf<JSONObject>(); var loseReceipt = true
        provider.deviceHandler = { request ->
            when (request.url.encodedPath) {
                "/v1/mobile/devices/register" -> JSONObject()
                "/v1/mobile/devices" -> JSONObject().put("devices", org.json.JSONArray()).put("pairs", org.json.JSONArray()).put("tasks", org.json.JSONArray())
                "/v1/mobile/tasks" -> {
                    assertNotNull(request.header("X-Liteasy-Device-Secret"))
                    val buffer = Buffer(); request.body!!.writeTo(buffer); received.add(JSONObject(buffer.readUtf8()))
                    if (loseReceipt) { loseReceipt = false; throw java.io.IOException("Lost response after server commit") }
                    JSONObject().put("replayed", true)
                }
                else -> error("Unexpected device endpoint")
            }
        }
        val operation = UUID.randomUUID().toString()
        val tasks = MobileTasks(context, scope, account)
        tasks.enqueue(JSONObject().put("operationId", operation).put("desktopId", UUID.randomUUID().toString()).put("kind", "sync-library"))
        try { tasks.flush(); fail("Lost response") } catch (_: java.io.IOException) { }
        val restored = MobileTasks(context, scope, MobileAccount(context, provider))
        assertEquals(1, restored.snapshot().getJSONArray("outbox").length())
        assertEquals(0, restored.flush())
        assertEquals(listOf(operation, operation), received.map { it.getString("operationId") })
        assertFalse(restored.snapshot().toString().contains("secret"))
        val cancelled = UUID.randomUUID().toString()
        restored.enqueue(JSONObject().put("operationId", cancelled).put("desktopId", UUID.randomUUID().toString()).put("kind", "sync-library"))
        restored.cancel(cancelled, null); restored.flush()
        assertTrue(received.last().getBoolean("cancelRequested"))
        account.logout()
        try { restored.snapshot(); fail("Old account") } catch (_: IllegalArgumentException) { }
    }
    @Test fun pkceCallbackIsSingleUseAndSecretsStayOutOfPublicStatus() {
        val context = isolatedContext(); val provider = Provider(); val account = MobileAccount(context, provider)
        val url = account.begin("https://api.example")
        assertEquals("S256", Uri.parse(url).getQueryParameter("code_challenge_method"))
        val pending = JSONObject(SecureStore(context).read("account-pending")!!)
        val expected = android.util.Base64.encodeToString(java.security.MessageDigest.getInstance("SHA-256").digest(pending.getString("verifier").toByteArray()), android.util.Base64.URL_SAFE or android.util.Base64.NO_PADDING or android.util.Base64.NO_WRAP)
        assertEquals(expected, Uri.parse(url).getQueryParameter("code_challenge"))
        try { account.complete(Uri.parse("${MobileAccount.REDIRECT}?code=test-code&state=wrong")); fail("Invalid state") } catch (_: IllegalStateException) { }
        assertEquals(0, provider.exchanges)
        val session = MobileAccount(context, provider).complete(callback(url))
        assertEquals("user-a", session.getString("subject")); assertTrue(session.getString("scope").startsWith("account:"))
        assertFalse(session.toString().contains("secret-")); assertFalse(session.toString().contains("verifier"))
        assertTrue(provider.lastForm.contains("code_verifier=${pending.getString("verifier")}"))
        try { account.complete(callback(url)); fail("Replay") } catch (_: IllegalStateException) { }
        assertEquals(1, provider.exchanges)
        val persisted = context.noBackupFilesDir.walkTopDown().filter { it.isFile }.map { it.readText() }.toList()
        assertFalse(persisted.any { it.contains("secret-refresh") || it.contains("secret-access") })
    }
    @Test fun refreshRotationIsDurableAndLogoutRevokesAndReturnsToGuest() {
        val context = isolatedContext(); val provider = Provider(); val account = MobileAccount(context, provider)
        val status = account.complete(callback(account.begin("https://api.example")))
        val secure = SecureStore(context); val saved = JSONObject(secure.read("account-session")!!).put("expiresAt", 0)
        secure.write("account-session", saved.toString())
        MobileAccount(context, provider).request("/v1/mobile/session")
        assertEquals(2, provider.exchanges)
        assertEquals("secret-refresh-2", JSONObject(secure.read("account-session")!!).getString("refreshToken"))
        assertEquals(status.getString("scope"), account.activeScope())
        try { account.request("/v1/mobile/../../outside"); fail("Path escape") } catch (_: IllegalArgumentException) { }
        assertEquals("local", account.logout().getString("scope")); assertTrue(provider.revoked); assertNull(secure.read("account-session"))
    }
    @Test fun expiredAndCancelledCallbacksNeverExchangeCredentials() {
        val context = isolatedContext(); val provider = Provider(); val account = MobileAccount(context, provider)
        val url = account.begin("https://api.example"); val secure = SecureStore(context)
        secure.write("account-pending", JSONObject(secure.read("account-pending")!!).put("expiresAt", 0).toString())
        try { account.complete(callback(url)); fail("Expired request") } catch (_: IllegalStateException) { }
        account.cancelLogin()
        try { account.complete(callback(url)); fail("Cancelled request") } catch (_: IllegalStateException) { }
        assertEquals(0, provider.exchanges); assertEquals("local", account.activeScope())
    }
    @Test fun refreshCannotSwitchSubjectsAndRevokedRefreshReturnsToGuest() {
        val context = isolatedContext(); val provider = Provider(); val account = MobileAccount(context, provider)
        val scope = account.complete(callback(account.begin("https://api.example"))).getString("scope")
        val secure = SecureStore(context)
        secure.write("account-session", JSONObject(secure.read("account-session")!!).put("expiresAt", 0).toString())
        provider.subject = "other-user"
        try { account.request("/v1/mobile/session"); fail("Different subject") } catch (_: IllegalArgumentException) { }
        assertEquals(scope, account.activeScope()); assertEquals("user-a", JSONObject(secure.read("account-session")!!).getString("subject"))
        provider.reject = true
        try { account.request("/v1/mobile/session"); fail("Revoked refresh") } catch (_: AccountHttpError) { }
        assertEquals("local", account.activeScope())
    }
    @Test fun explicitGuestCopyKeepsOriginalsAndNeverCopiesSyncCredentials() {
        val store = LibraryStore.get(InstrumentationRegistry.getInstrumentation().targetContext)
        val guest = "test:${UUID.randomUUID()}"; val destination = "account:${UUID.randomUUID()}"
        val item = "%PDF-1.7\ncopy".byteInputStream().use { store.importStream(guest, JSONObject().put("title", "本机资料").put("filename", "copy.pdf").put("note", "原件备注"), it) }
        val key = "annotations:${item.getString("id")}"
        val annotations = JSONObject().put("version", 2).put("autoPublic", true).put("annotations", org.json.JSONArray().put(JSONObject()
            .put("id", "note").put("kind", "note").put("page", 1).put("rects", org.json.JSONArray()).put("text", "本机批注").put("revision", 1)
            .put("paperIdentity", JSONObject().put("paperId", item.getString("id"))).put("publication", JSONObject().put("desiredVisibility", "public").put("state", "published").put("remoteAnnotationId", "guest-remote"))))
        store.dispatch(guest, JSONObject().put("operation", "writeRecord").put("key", key).put("value", annotations))
        store.dispatch(guest, JSONObject().put("operation", "writeRecord").put("key", "sync-status").put("value", JSONObject().put("state", "complete")))
        assertEquals(1, store.copyLibrary(guest, destination).getInt("copied"))
        assertEquals(1, store.list(guest).length()); assertEquals("原件备注", store.list(destination).getJSONObject(0).getString("note"))
        assertEquals(item.getString("contentHash"), store.list(destination).getJSONObject(0).getString("contentHash"))
        assertNull(store.dispatch(destination, JSONObject().put("operation", "readRecord").put("key", "sync-status")))
        val copied = store.dispatch(destination, JSONObject().put("operation", "readRecord").put("key", key)) as JSONObject
        assertFalse(copied.getBoolean("autoPublic")); assertEquals("private", copied.getJSONArray("annotations").getJSONObject(0).getJSONObject("publication").getString("desiredVisibility"))
        val original = store.dispatch(guest, JSONObject().put("operation", "readRecord").put("key", key)) as JSONObject
        assertTrue(original.getBoolean("autoPublic")); assertTrue(original.toString().contains("guest-remote"))
        assertEquals(1, store.copyLibrary(guest, destination).getInt("skipped"))
    }
}
