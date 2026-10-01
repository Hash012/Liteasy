package com.liteasy.mobile

import okhttp3.Credentials
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

object DavJson {
    fun version(value: DavVersion?): Any = value?.let { JSONObject().put("hash", it.hash).put("size", it.size).put("documentId", it.documentId ?: JSONObject.NULL) } ?: JSONObject.NULL
    fun parseVersion(value: JSONObject): DavVersion {
        require(value.keys().asSequence().all { it in listOf("hash", "size", "documentId") }) { "同步文件格式不受支持。" }
        require(value.get("hash") is String && (value.get("size") is Int || value.get("size") is Long) &&
            (value.isNull("documentId") || value.get("documentId") is String)) { "同步文件字段类型无效。" }
        return DavVersion(value.getString("hash"), value.getLong("size"), if (value.isNull("documentId")) null else value.getString("documentId"))
    }
    fun encode(value: DavManifest) = JSONObject().put("schemaVersion", value.schemaVersion).put("files", JSONObject().also { files -> value.files.toSortedMap().forEach { (path, version) -> files.put(path, version(version)) } }).toString().toByteArray()
    fun decode(bytes: ByteArray): DavManifest {
        require(bytes.size <= DavModel.MAX_MANIFEST_BYTES) { "同步清单超过 16 MiB。" }
        val json = JSONObject(String(bytes))
        require(json.keys().asSequence().all { it in listOf("schemaVersion", "files") }) { "同步清单格式不受支持，原数据未修改。" }
        require(json.get("schemaVersion") is Int || json.get("schemaVersion") is Long) { "同步清单版本无效。" }
        val files = json.getJSONObject("files")
        val value = DavManifest(json.getInt("schemaVersion"), files.keys().asSequence().associateWithTo(sortedMapOf()) { if (files.isNull(it)) null else parseVersion(files.getJSONObject(it)) })
        DavModel.validate(value); return value
    }
}

class DavHttpException(val status: Int) : java.io.IOException(when (status) {
    401, 403 -> "WebDAV 身份验证失败或没有访问权限。"
    412 -> "其他设备已更新同步数据，请重新同步。"
    507 -> "WebDAV 存储空间不足。"
    else -> "WebDAV 服务器返回 HTTP $status。"
})

data class RemoteDavManifest(val value: DavManifest, val revision: String?, val bytes: ByteArray?)
interface DavRemote {
    fun prepare()
    fun manifest(): RemoteDavManifest
    fun publish(manifest: DavManifest, revision: String?)
    fun upload(version: DavVersion, file: File, temporary: File)
    fun download(version: DavVersion, target: File)
    fun cancel()
}
class DavTransport(endpoint: String, collection: String, username: String, password: String) : DavRemote {
    override fun cancel() { client.dispatcher.cancelAll() }
    companion object {
        fun endpoint(value: String): String {
            val url = value.trim().toHttpUrl()
            require(url.isHttps && url.username.isEmpty() && url.password.isEmpty() && url.query == null && url.fragment == null) { "WebDAV 地址必须使用 HTTPS，且不能包含账号、查询参数或片段。" }
            return url.toString().let { if (it.endsWith('/')) it else "$it/" }
        }
        fun hash(file: File): String {
            val digest = MessageDigest.getInstance("SHA-256")
            file.inputStream().use { input -> val buffer = ByteArray(64 * 1024); while (true) { val count = input.read(buffer); if (count < 0) break; digest.update(buffer, 0, count) } }
            return digest.digest().joinToString("") { "%02x".format(it) }
        }
    }
    private val root = (endpoint(endpoint) + "liteasy/$collection/").toHttpUrl()
    private val auth = Credentials.basic(username, password)
    private val client = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS).writeTimeout(60, TimeUnit.SECONDS).callTimeout(180, TimeUnit.SECONDS).build()
    private fun request(method: String, path: String, bytes: ByteArray? = null, headers: Map<String, String> = emptyMap()): Response {
        val builder = Request.Builder().url(root.resolve(path)!!).header("Authorization", auth).header("User-Agent", "Liteasy-WebDAV/1")
        headers.forEach { (name, value) -> builder.header(name, value) }
        val body = bytes?.toRequestBody("application/octet-stream".toMediaType())
            ?: if (method in listOf("PUT", "POST", "MKCOL", "PROPFIND")) ByteArray(0).toRequestBody() else null
        return client.newCall(builder.method(method, body).build()).execute()
    }
    private fun success(response: Response) { if (response.code !in listOf(200, 201, 204)) throw DavHttpException(response.code) }
    private fun bytes(response: Response, limit: Long): ByteArray {
        require(response.body.contentLength() <= limit) { "WebDAV 响应超过容量限制。" }
        return response.body.byteStream().use { input ->
            val output = java.io.ByteArrayOutputStream(); val buffer = ByteArray(64 * 1024)
            while (true) { val count = input.read(buffer); if (count < 0) break; require(output.size().toLong() + count <= limit) { "WebDAV 响应超过容量限制。" }; output.write(buffer, 0, count) }
            output.toByteArray()
        }
    }
    override fun prepare() {
        for (path in listOf("../", "", "objects/")) request("MKCOL", path).use { response ->
            if (response.code == 405) request("PROPFIND", path, "<propfind xmlns=\"DAV:\"><prop><resourcetype/></prop></propfind>".toByteArray(), mapOf("Depth" to "0", "Content-Type" to "application/xml")).use {
                if (it.code != 207) throw DavHttpException(it.code)
            } else success(response)
        }
    }
    override fun manifest(): RemoteDavManifest = request("GET", "manifest.v1.json", headers = mapOf("Cache-Control" to "no-cache")).use { response ->
        if (response.code == 404) return RemoteDavManifest(DavManifest(), null, null)
        success(response); val bytes = bytes(response, DavModel.MAX_MANIFEST_BYTES)
        val tag = response.header("ETag")?.takeIf { it.startsWith('"') && it.endsWith('"') && it.length >= 2 }
        RemoteDavManifest(DavJson.decode(bytes), tag ?: "sha256:${LibraryStore.digest(bytes)}", bytes)
    }
    override fun publish(manifest: DavManifest, revision: String?) {
        DavModel.validate(manifest); val data = DavJson.encode(manifest)
        require(data.size <= DavModel.MAX_MANIFEST_BYTES) { "同步清单过大。" }
        check(manifest().revision == revision) { "其他设备已更新远端数据，请重新同步。" }
        val headers = mutableMapOf("Content-Type" to "application/json")
        if (revision == null) headers["If-None-Match"] = "*" else if (!revision.startsWith("sha256:")) headers["If-Match"] = revision
        request("PUT", "manifest.v1.json", data, headers).use { success(it) }
        check(manifest().bytes?.contentEquals(data) == true) { "同步清单写入校验失败，未确认本次同步。" }
    }
    override fun upload(version: DavVersion, file: File, temporary: File) {
        require(file.length() == version.size && hash(file) == version.hash) { "同步期间文件发生变化，请重试。" }
        val request = Request.Builder().url(root.resolve("objects/${version.hash}")!!).header("Authorization", auth).header("If-None-Match", "*")
            .put(file.asRequestBody("application/octet-stream".toMediaType())).build()
        client.newCall(request).execute().use { response ->
            if (response.code == 412) { download(version, temporary); temporary.delete() } else success(response)
        }
    }
    override fun download(version: DavVersion, target: File) {
        require(Regex("[a-f0-9]{64}").matches(version.hash))
        val partial = File(target.parentFile, "${target.name}.part")
        try {
            request("GET", "objects/${version.hash}").use { response ->
                success(response); require(response.body.contentLength() <= version.size) { "下载文件大小不符。" }
                var size = 0L
                response.body.byteStream().use { input -> FileOutputStream(partial).use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) { val count = input.read(buffer); if (count < 0) break; size += count; require(size <= version.size) { "下载文件超过声明大小。" }; output.write(buffer, 0, count) }
                    output.fd.sync()
                } }
                require(size == version.size && hash(partial) == version.hash) { "下载文件校验失败，已保留本地版本。" }
            }
            check(partial.renameTo(target)) { "无法保存下载内容。" }
        } finally { partial.delete() }
    }
}
