package com.liteasy.mobile

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.io.RandomAccessFile
import java.net.URI
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID

/** All callers, including Android workers, share the same transaction/attachment boundary. */
class LibraryStore private constructor(private val context: Context) : SQLiteOpenHelper(context, "library.db", null, 1) {
    companion object {
        const val MAX_BYTES = 256L * 1024 * 1024
        @Volatile private var instance: LibraryStore? = null
        fun get(context: Context): LibraryStore = instance ?: synchronized(this) {
            instance ?: LibraryStore(context.applicationContext).also { instance = it }
        }
        fun digest(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    }

    override fun onConfigure(db: SQLiteDatabase) { db.setForeignKeyConstraintsEnabled(true) }
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE items (scope TEXT NOT NULL, id TEXT NOT NULL, hash TEXT NOT NULL, kind TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(scope,id), UNIQUE(scope,kind,hash))")
        db.execSQL("CREATE TABLE records (scope TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(scope,key))")
    }
    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        throw IllegalStateException("资料库版本不受支持，请升级 Liteasy。")
    }

    fun directory(scope: String): File {
        require(scope.isNotEmpty() && scope.length <= 256) { "账号分区无效。" }
        return File(context.filesDir, "library/${digest(scope.toByteArray())}").apply { mkdirs() }
    }
    private fun transfers(scope: String) = File(directory(scope), "transfers").apply { mkdirs() }
    private fun transferFile(scope: String, transfer: String, suffix: String): File {
        require(Regex("[a-f0-9-]{36}").matches(transfer)) { "导入任务无效。" }
        return File(transfers(scope), "$transfer.$suffix")
    }
    private fun file(scope: String, hash: String): File {
        require(Regex("[a-f0-9]{64}").matches(hash)) { "文件标识无效。" }
        return File(File(directory(scope), "files").apply { mkdirs() }, hash)
    }
    private fun now() = Instant.now().toString()
    private fun find(scope: String, id: String): JSONObject? = readableDatabase.rawQuery(
        "SELECT value FROM items WHERE scope=? AND id=?", arrayOf(scope, id)
    ).use { cursor -> if (cursor.moveToFirst()) JSONObject(cursor.getString(0)) else null }
    @Synchronized fun list(scope: String): JSONArray {
        directory(scope)
        return JSONArray().also { result -> readableDatabase.rawQuery("SELECT value FROM items WHERE scope=? ORDER BY id", arrayOf(scope)).use {
            while (it.moveToNext()) result.put(JSONObject(it.getString(0)))
        } }
    }
    private fun save(scope: String, item: JSONObject) {
        val values = ContentValues().apply {
            put("scope", scope); put("id", item.getString("id")); put("hash", item.getString("contentHash"))
            put("kind", item.getString("kind")); put("value", item.toString())
        }
        check(writableDatabase.insertWithOnConflict("items", null, values, SQLiteDatabase.CONFLICT_REPLACE) != -1L) { "无法保存资料。" }
    }
    private fun validate(input: JSONObject) {
        require(input.optString("title").trim().length in 1..1024) { "请填写有效标题。" }
        require(input.optString("text").length <= 2_000_000) { "文字内容过长，请作为文件导入。" }
        val url = input.optString("sourceUrl")
        if (url.isNotEmpty()) require(URI(url).scheme?.lowercase() in listOf("http", "https")) { "仅支持 HTTP 或 HTTPS 链接。" }
    }
    private fun kind(input: JSONObject): String {
        val name = input.optString("filename"); val mime = input.optString("mimeType")
        return when {
            mime == "application/pdf" || name.endsWith(".pdf", true) -> "pdf"
            mime.startsWith("image/") -> "image"
            name.isEmpty() && input.optString("sourceUrl").isNotEmpty() -> "link"
            name.isEmpty() && input.has("text") -> "text"
            else -> "file"
        }
    }

    @Synchronized fun importStream(scope: String, input: JSONObject, stream: InputStream): JSONObject {
        validate(input)
        val temporary = File(transfers(scope), "${UUID.randomUUID()}.pending")
        try {
            var size = 0L
            val hash = MessageDigest.getInstance("SHA-256")
            val prefix = java.io.ByteArrayOutputStream()
            FileOutputStream(temporary).use { output ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    val count = stream.read(buffer); if (count < 0) break
                    size += count; require(size <= MAX_BYTES) { "单个文件不能超过 256 MiB。" }
                    if (prefix.size() < 1024) prefix.write(buffer, 0, minOf(count, 1024 - prefix.size()))
                    hash.update(buffer, 0, count); output.write(buffer, 0, count)
                }
                output.fd.sync()
            }
            val resourceKind = kind(input)
            require(resourceKind != "pdf" || prefix.toString(Charsets.ISO_8859_1.name()).contains("%PDF-")) { "文件内容不是有效的 PDF。" }
            val contentHash = hash.digest().joinToString("") { "%02x".format(it) }
            val db = writableDatabase
            db.beginTransaction()
            try {
                val existing = db.rawQuery("SELECT value FROM items WHERE scope=? AND kind=? AND hash=?", arrayOf(scope, resourceKind, contentHash)).use {
                    if (it.moveToFirst()) JSONObject(it.getString(0)) else null
                }
                if (existing != null) {
                    if (existing.has("deletedAt")) {
                        existing.remove("deletedAt"); existing.put("updatedAt", now()); existing.put("revision", existing.getInt("revision") + 1); save(scope, existing)
                    }
                    val target = file(scope, contentHash)
                    if (!target.exists()) check(temporary.renameTo(target)) { "无法保存附件。" }
                    existing.put("downloaded", true); save(scope, existing)
                    db.setTransactionSuccessful(); return existing
                }
                val date = now()
                val item = JSONObject().apply {
                    put("id", UUID.randomUUID().toString()); put("kind", resourceKind); put("title", input.getString("title").trim())
                    put("filename", input.optString("filename")); put("mimeType", input.optString("mimeType", "text/plain")); put("size", size); put("contentHash", contentHash)
                    for (key in listOf("sourceUrl", "text")) if (input.has(key)) put(key, input.get(key))
                    put("collection", input.optString("collection", "收件箱")); put("note", input.optString("note")); put("tags", JSONArray())
                    put("createdAt", date); put("updatedAt", date); put("page", 1); put("pinned", false); put("downloaded", true); put("revision", 1)
                }
                val target = file(scope, contentHash)
                if (!target.exists()) check(temporary.renameTo(target)) { "无法保存附件。" }
                save(scope, item); db.setTransactionSuccessful(); return item
            } finally { db.endTransaction() }
        } finally { temporary.delete() }
    }

    @Synchronized fun dispatch(scope: String, request: JSONObject): Any? {
        directory(scope)
        return when (request.getString("operation")) {
            "list" -> list(scope)
            "update" -> {
                val edit = request.getJSONObject("item")
                val current = find(scope, edit.getString("id")) ?: error("资料不存在。")
                require(current.getInt("revision") == edit.getInt("revision")) { "资料已在其他窗口更新，请刷新后重试。" }
                validate(edit)
                for (key in listOf("title", "collection", "note", "tags", "page", "pinned", "lastReadAt", "deletedAt")) {
                    if (edit.has(key)) current.put(key, edit.get(key)) else current.remove(key)
                }
                require(current.optInt("page", 1) in 1..1_000_000) { "页码无效。" }
                current.put("updatedAt", now()); current.put("revision", current.getInt("revision") + 1)
                save(scope, current); current
            }
            "importText" -> {
                val input = request.getJSONObject("input"); validate(input)
                val text = input.optString("sourceUrl").ifEmpty { input.optString("text") }
                require(text.isNotBlank()) { "资料内容为空。" }
                text.byteInputStream().use { importStream(scope, input, it) }
            }
            "beginImport" -> {
                val input = request.getJSONObject("input"); validate(input)
                val size = request.getLong("size"); require(size in 0..MAX_BYTES) { "文件大小无效。" }
                val id = UUID.randomUUID().toString()
                transferFile(scope, id, "json").writeText(JSONObject().put("input", input).put("size", size).toString())
                transferFile(scope, id, "part").createNewFile(); id
            }
            "appendImport" -> {
                val id = request.getString("transfer"); val part = transferFile(scope, id, "part")
                val metadata = JSONObject(transferFile(scope, id, "json").readText())
                val bytes = Base64.decode(request.getString("data"), Base64.DEFAULT)
                require(bytes.size <= 256 * 1024 && request.getLong("offset") == part.length() && part.length() + bytes.size <= metadata.getLong("size")) { "文件分块位置无效，请重新导入。" }
                FileOutputStream(part, true).use { it.write(bytes) }; null
            }
            "finishImport" -> {
                val id = request.getString("transfer"); val part = transferFile(scope, id, "part")
                val metadata = JSONObject(transferFile(scope, id, "json").readText())
                require(part.length() == metadata.getLong("size")) { "文件尚未传输完整。" }
                val item = FileInputStream(part).use { importStream(scope, metadata.getJSONObject("input"), it) }
                part.delete(); transferFile(scope, id, "json").delete(); item
            }
            "cancelImport" -> {
                val id = request.getString("transfer"); transferFile(scope, id, "part").delete(); transferFile(scope, id, "json").delete(); null
            }
            "fileInfo", "readFile" -> {
                val item = find(scope, request.getString("id")) ?: error("资料不存在。")
                val path = file(scope, item.getString("contentHash")); require(path.exists()) { "此文件尚未下载到本机。" }
                if (request.getString("operation") == "fileInfo") JSONObject().put("size", path.length()) else {
                    val offset = request.getLong("offset"); val length = request.getInt("length")
                    require(offset >= 0 && length in 0..256 * 1024 && offset + length <= path.length()) { "文件读取范围无效。" }
                    val bytes = ByteArray(length); RandomAccessFile(path, "r").use { it.seek(offset); it.readFully(bytes) }
                    Base64.encodeToString(bytes, Base64.NO_WRAP)
                }
            }
            "readRecord" -> {
                readableDatabase.rawQuery("SELECT value FROM records WHERE scope=? AND key=?", arrayOf(scope, request.getString("key"))).use {
                    if (it.moveToFirst()) JSONObject(it.getString(0)).get("value") else null
                }
            }
            "writeRecord" -> {
                val key = request.getString("key"); require(key.length in 1..512) { "记录标识无效。" }
                val value = JSONObject().put("value", request.get("value")).toString(); require(value.length <= 32 * 1024 * 1024) { "记录超过容量限制。" }
                check(writableDatabase.insertWithOnConflict("records", null, ContentValues().apply { put("scope", scope); put("key", key); put("value", value) }, SQLiteDatabase.CONFLICT_REPLACE) != -1L) { "无法保存记录。" }; null
            }
            else -> error("不支持的资料操作。")
        }
    }
}
