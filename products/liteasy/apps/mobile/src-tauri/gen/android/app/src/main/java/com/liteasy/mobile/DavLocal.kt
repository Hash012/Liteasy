package com.liteasy.mobile

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.Instant

data class LocalDavFile(val version: DavVersion, val file: File)

class DavLocal(context: Context, private val scope: String) {
    private val store = LibraryStore.get(context)
    val directory = File(store.directory(scope), "sync").apply { mkdirs() }
    private val generated = File(directory, "generated").apply { mkdirs() }
    companion object {
        const val METADATA_PREFIX = ".liteasy/sync-data/objects/mobile-library/"
        fun annotationPath(id: String) = ".liteasy/paper-artifacts/${DavModel.artifactDirectory(id)}/annotations.v1.json"
        fun selected(path: String) = !path.startsWith('.') || path.startsWith(METADATA_PREFIX)
        fun canonical(value: Any?): Any? = when (value) {
            is JSONObject -> JSONObject().also { target -> value.keys().asSequence().sorted().forEach { target.put(it, canonical(value.get(it))) } }
            is JSONArray -> JSONArray().also { target -> for (index in 0 until value.length()) target.put(canonical(value.get(index))) }
            else -> value
        }
    }
    fun record(key: String): Any? = store.dispatch(scope, JSONObject().put("operation", "readRecord").put("key", key))?.takeUnless { it == JSONObject.NULL }
    fun record(key: String, value: Any) { store.dispatch(scope, JSONObject().put("operation", "writeRecord").put("key", key).put("value", value)) }
    private fun path(item: JSONObject): String {
        if (item.has("syncPath")) return item.getString("syncPath").also { require(DavModel.allowedPath(it)) }
        val filename = item.optString("filename").ifBlank { item.getString("title") + if (item.getString("kind") == "link") ".url" else ".txt" }
        val safe = filename.map { if (Character.isISOControl(it) || it in "/\\:*?\"<>|") '_' else it }.joinToString("").trim().trim('.', ' ').take(100).ifEmpty { "resource" }
        val extension = safe.substringAfterLast('.', "").takeIf { it.matches(Regex("[a-zA-Z0-9]{1,10}")) }
        val name = if (extension != null) safe.substringBeforeLast('.') else safe
        val relative = "mobile/${name.take(70)}-${item.getString("id")}${extension?.let { ".$it" } ?: ""}"
        require(DavModel.allowedPath(relative)) { "文件名无法同步，请修改标题后重试。" }
        item.put("syncPath", relative); store.syncSaveItem(scope, item); return relative
    }
    private fun materialize(path: String, value: JSONObject): LocalDavFile {
        val bytes = canonical(value).toString().toByteArray()
        val file = File(generated, LibraryStore.digest(path.toByteArray()))
        file.writeBytes(bytes)
        return LocalDavFile(DavVersion(LibraryStore.digest(bytes), bytes.size.toLong()), file)
    }
    fun scan(): Map<String, LocalDavFile?> = synchronized(store) {
        val result = sortedMapOf<String, LocalDavFile?>()
        val items = store.list(scope)
        for (index in 0 until items.length()) {
            val item = items.getJSONObject(index); val id = item.getString("id"); val path = path(item)
            val attachment = store.attachment(scope, item.getString("contentHash"))
            val version = DavVersion(item.getString("contentHash"), item.getLong("size"), id.takeIf { item.getString("kind") == "pdf" })
            result[path] = if (item.has("deletedAt")) null else LocalDavFile(version, attachment)
            val metadata = JSONObject((record("sync-metadata:$id") as? JSONObject)?.toString() ?: "{}")
                .put("version", 1).put("id", id).put("path", path).put("kind", item.getString("kind"))
            for (key in listOf("title", "collection", "tags", "note", "sourceUrl", "text", "createdAt", "updatedAt", "deletedAt", "page", "lastReadAt")) {
                if (item.has(key)) metadata.put(key, item.get(key)) else metadata.remove(key)
            }
            result["$METADATA_PREFIX$id.json"] = materialize("$METADATA_PREFIX$id.json", metadata)
        }
        result
    }
    fun applyBatch(decisions: List<DavDecision>, downloaded: Map<String, File>, remote: DavManifest) = synchronized(store) {
        val before = scan()
        require(decisions.all { before[it.path]?.version == it.local }) { "同步期间本地内容发生变化，请重新同步。" }
        val openId = store.openDocument(scope)
        val openPath = openId?.let { store.syncItem(scope, it)?.optString("syncPath") }
        require(openId == null || decisions.none { it.local?.documentId == openId || it.remote?.documentId == openId || it.path == openPath ||
            it.path == "$METADATA_PREFIX$openId.json" || it.path == annotationPath(openId) }) { "此文献刚被打开，请关闭后再次同步。" }
        val incomingIds = mutableMapOf<String, String>()
        for ((path, file) in downloaded.filterKeys { it.startsWith(METADATA_PREFIX) }) {
            val value = JSONObject(file.readText()); val id = value.getString("id"); val source = value.getString("path")
            require(value.getInt("version") == 1 && "$METADATA_PREFIX$id.json" == path && Regex("[a-zA-Z0-9-]{1,128}").matches(id) && DavModel.allowedPath(source)) { "资料元数据版本或标识无效。" }
            require(incomingIds.put(source, id) == null) { "资料元数据存在重复标识。" }
            val documentId = remote.files[source]?.documentId
            require(documentId == null || documentId == id) { "资料身份与文件不符。" }
            val existing = store.syncItem(scope, id)
            require(existing == null || existing.optString("syncPath") == source || remote.files[existing.optString("syncPath")] == null) { "资料身份已被另一文件占用。" }
        }
        // Files first, then their descriptions. All CAS checks precede this batch under the library mutex.
        store.syncTransaction {
            for (decision in decisions.sortedBy { it.path.startsWith('.') }) apply(decision.path, decision.remote, downloaded[decision.path], incomingIds)
        }
    }
    private fun apply(path: String, version: DavVersion?, bytes: File?, incomingIds: Map<String, String>) {
        if (path.startsWith(METADATA_PREFIX)) {
            if (version == null || bytes == null) return
            val metadata = JSONObject(bytes.readText())
            require(metadata.getInt("version") == 1 && "$METADATA_PREFIX${metadata.getString("id")}.json" == path) { "资料元数据版本或标识无效。" }
            // Applied after file downloads; metadata never turns an absent attachment into a saved file.
            val item = store.syncItem(scope, metadata.getString("id")) ?: return
            require(metadata.getString("kind") in listOf("pdf", "image", "text", "link", "file") && metadata.getInt("page") in 1..1_000_000 && metadata.getJSONArray("tags").length() <= 128) { "资料元数据内容无效。" }
            require((metadata.getString("kind") == "pdf") == item.getString("syncPath").endsWith(".pdf", true)) { "资料类型与文件不符。" }
            if (item.has("deletedAt") && metadata.has("deletedAt")) item.put("deletedAt", metadata.get("deletedAt"))
            for (key in listOf("kind", "title", "collection", "tags", "note", "sourceUrl", "text", "createdAt", "updatedAt", "page", "lastReadAt")) {
                if (metadata.has(key)) item.put(key, metadata.get(key)) else if (key in listOf("sourceUrl", "text", "lastReadAt")) item.remove(key)
            }
            item.put("revision", item.getInt("revision") + 1); store.syncSaveItem(scope, item)
            record("sync-metadata:${item.getString("id")}", metadata); return
        }
        if (path.startsWith(".liteasy/paper-artifacts/")) {
            if (bytes == null || version == null) return
            require(bytes.length() <= 32L * 1024 * 1024) { "批注文件过大。" }
            val items = store.list(scope)
            val item = (0 until items.length()).map { items.getJSONObject(it) }.find { annotationPath(it.getString("id")) == path }
                ?: throw IllegalStateException("批注对应的文献尚未下载，请先同步文献。")
            val value = JSONObject(bytes.readText())
            require(value.optInt("version", 1) in 1..2 && value.optJSONArray("annotations") != null) { "批注版本不受支持，原记录未修改。" }
            record("annotations:${item.getString("id")}", value); return
        }
        val items = store.list(scope)
        val existing = (0 until items.length()).map { items.getJSONObject(it) }.find { it.optString("syncPath") == path }
        if (version == null) {
            if (existing != null) { existing.put("deletedAt", Instant.now().toString()).put("revision", existing.getInt("revision") + 1); store.syncSaveItem(scope, existing) }
            return
        }
        require(bytes != null && bytes.length() == version.size && DavTransport.hash(bytes) == version.hash) { "下载内容校验失败。" }
        val id = version.documentId ?: incomingIds[path] ?: existing?.getString("id") ?: "file-${LibraryStore.digest(path.toByteArray()).take(32)}"
        val input = JSONObject().put("filename", path.substringAfterLast('/')).put("title", path.substringAfterLast('/'))
            .put("mimeType", if (path.endsWith(".pdf", true)) "application/pdf" else java.net.URLConnection.guessContentTypeFromName(path) ?: "application/octet-stream")
        val item = bytes.inputStream().use { store.importStream(scope, input, it, id) }
        item.put("syncPath", path); store.syncSaveItem(scope, item)
    }
}
