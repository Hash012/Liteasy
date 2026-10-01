package com.liteasy.mobile

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.util.AtomicFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.time.Instant
import java.util.UUID
import java.util.concurrent.Executors

/** Unassigned captures survive activity recreation and never depend on a sender's URI grant after capture. */
class ShareInbox(private val context: Context) {
    companion object {
        private val executor = Executors.newSingleThreadExecutor()
        private val active = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()
        private val lock = Any()
        private const val MAX_PENDING_BYTES = 512L * 1024 * 1024
    }
    private val root = File(context.filesDir, "share-inbox").apply { mkdirs() }
    private fun directory(id: String): File {
        require(Regex("[a-f0-9-]{36}").matches(id)) { "分享记录无效。" }
        return File(root, id)
    }
    private fun write(value: JSONObject) {
        val path = directory(value.getString("id")).apply { mkdirs() }
        val file = AtomicFile(File(path, "capture.json"))
        val stream = file.startWrite()
        try { stream.write(value.toString().toByteArray()); file.finishWrite(stream) }
        catch (error: Exception) { file.failWrite(stream); throw error }
    }
    private fun read(id: String): JSONObject = JSONObject(AtomicFile(File(directory(id), "capture.json")).openRead().bufferedReader().use { it.readText() })

    fun receive(intent: Intent): List<String> {
        if (intent.action !in listOf(Intent.ACTION_SEND, Intent.ACTION_SEND_MULTIPLE)) return emptyList()
        val requests = mutableListOf<Pair<Uri?, String?>>()
        try {
            @Suppress("DEPRECATION")
            val streams = if (intent.action == Intent.ACTION_SEND_MULTIPLE) intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM).orEmpty()
                else listOfNotNull(intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM))
            val clip = intent.clipData
            val uris = (streams + (0 until (clip?.itemCount ?: 0)).mapNotNull { clip?.getItemAt(it)?.uri }).distinct()
            require(uris.size <= 16) { "一次最多接收 16 个附件，请分批分享。" }
            requests.addAll(uris.map { it to null })
            val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()
            if (!text.isNullOrBlank()) requests.add(null to text)
            require(requests.isNotEmpty()) { "分享内容为空，请从来源应用重新分享。" }
        } catch (error: Exception) {
            val failed = create("分享未完成")
            failed.put("state", "error").put("error", error.message ?: "无法读取分享内容。")
            synchronized(lock) { write(failed) }
            return listOf(failed.getString("id"))
        }
        val subject = intent.getStringExtra(Intent.EXTRA_SUBJECT)?.take(1024)
        return requests.map { (uri, text) ->
            val record = create(subject?.takeIf { it.isNotBlank() } ?: "收到的资料")
            val id = record.getString("id")
            active.add(id)
            synchronized(lock) { write(record) }
            executor.execute {
                try {
                    if (uri != null) captureFile(record, uri, intent.type) else captureText(record, text!!, subject)
                    record.put("state", "ready")
                } catch (error: Exception) {
                    File(directory(id), "attachment.part").delete()
                    record.put("state", "error").put("error", error.message ?: "接收失败，请从来源应用重新分享。")
                } finally {
                    synchronized(lock) { write(record); active.remove(id) }
                }
            }
            id
        }
    }

    private fun create(title: String) = JSONObject().put("id", UUID.randomUUID().toString()).put("title", title)
        .put("state", "capturing").put("receivedAt", Instant.now().toString()).put("collection", "收件箱").put("note", "")

    private fun captureText(record: JSONObject, text: String, subject: String?) {
        require(text.length <= 2_000_000) { "文字内容过长，请作为文件分享。" }
        val trimmed = text.trim()
        val uri = Uri.parse(trimmed)
        val link = !trimmed.any { it.isWhitespace() } && uri.scheme in listOf("http", "https") && !uri.host.isNullOrEmpty()
        record.put("text", text).put("size", text.toByteArray().size).put("mimeType", "text/plain")
        if (link) record.put("sourceUrl", trimmed)
        record.put("title", subject?.takeIf { it.isNotBlank() } ?: if (link) uri.host else trimmed.lineSequence().first().take(120))
    }

    private fun captureFile(record: JSONObject, uri: Uri, fallbackMime: String?) {
        require(uri.scheme == "content") { "此分享未提供可读取的附件，请通过文件应用重新分享。" }
        val resolver = context.contentResolver
        var name = "附件"
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (nameIndex >= 0) name = cursor.getString(nameIndex)?.take(1024)?.takeIf { it.isNotBlank() } ?: name
                val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
                if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) require(cursor.getLong(sizeIndex) <= LibraryStore.MAX_BYTES) { "单个附件不能超过 256 MiB。" }
            }
        }
        val used = root.walkTopDown().filter { it.isFile && it.name == "attachment" }.sumOf { it.length() }
        val path = directory(record.getString("id"))
        val partial = File(path, "attachment.part")
        var size = 0L
        resolver.openInputStream(uri)?.use { input ->
            FileOutputStream(partial).use { output ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    val count = input.read(buffer); if (count < 0) break
                    size += count
                    require(size <= LibraryStore.MAX_BYTES) { "单个附件不能超过 256 MiB。" }
                    require(used + size <= MAX_PENDING_BYTES) { "待归档附件空间已满，请先归档或删除已有分享。" }
                    output.write(buffer, 0, count)
                }
                output.fd.sync()
            }
        } ?: error("无法读取附件，请从来源应用重新分享。")
        check(partial.renameTo(File(path, "attachment"))) { "无法保存分享附件。" }
        record.put("filename", name).put("title", name).put("mimeType", resolver.getType(uri) ?: fallbackMime ?: "application/octet-stream").put("size", size)
    }

    fun list(): JSONArray = synchronized(lock) {
        JSONArray().also { result -> root.listFiles()?.filter { it.isDirectory }?.sortedBy { it.name }?.forEach { path ->
            val record = try { read(path.name) } catch (_: Exception) { null }
            if (record != null) {
                if (record.optString("state") == "capturing" && !active.contains(path.name)) {
                    record.put("state", "error").put("error", "接收被中断，请从来源应用重新分享。")
                    File(path, "attachment.part").delete(); write(record)
                }
                if (record.optString("state") == "imported") path.deleteRecursively() else result.put(record)
            }
        } }
    }

    fun import(scope: String, id: String, edit: JSONObject): JSONObject = synchronized(lock) {
        val record = read(id)
        require(record.getString("state") == "ready") { "附件尚未接收完成。" }
        val input = JSONObject(record.toString())
        for (key in listOf("title", "collection", "note")) if (edit.has(key)) input.put(key, edit.get(key))
        val store = LibraryStore.get(context)
        val item = if (record.has("filename")) File(directory(id), "attachment").inputStream().use { store.importStream(scope, input, it) }
            else store.dispatch(scope, JSONObject().put("operation", "importText").put("input", input)) as JSONObject
        // This acknowledgement follows the library commit; a crash before it leaves a retryable, deduplicated capture.
        record.put("state", "imported"); write(record)
        directory(id).deleteRecursively()
        item
    }

    fun discard(id: String) = synchronized(lock) {
        require(!active.contains(id)) { "正在接收附件，请稍后删除。" }
        check(directory(id).deleteRecursively()) { "无法删除分享，请重试。" }
    }
}
