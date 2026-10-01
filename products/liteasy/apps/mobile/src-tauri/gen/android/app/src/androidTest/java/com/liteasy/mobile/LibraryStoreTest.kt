package com.liteasy.mobile

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import android.util.Base64
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class LibraryStoreTest {
    private val store = LibraryStore.get(InstrumentationRegistry.getInstrumentation().targetContext)
    private fun scope() = "test:${UUID.randomUUID()}"
    private fun input() = JSONObject().put("title", "论文").put("filename", "paper.pdf").put("mimeType", "application/pdf")
    private val bytes = "%PDF-1.7\nfixture".toByteArray()

    @Test fun durableAttachmentAndAccountIsolation() {
        val scope = scope()
        val item = bytes.inputStream().use { store.importStream(scope, input(), it) }
        store.close()
        assertEquals(1, store.list(scope).length())
        assertEquals(0, store.list(scope()).length())
        val read = store.dispatch(scope, JSONObject().put("operation", "readFile").put("id", item.getString("id")).put("offset", 0).put("length", bytes.size)) as String
        assertArrayEquals(bytes, Base64.decode(read, Base64.DEFAULT))
        try {
            store.dispatch(scope, JSONObject().put("operation", "fileInfo").put("id", item.getString("id")).put("expectedHash", "b".repeat(64)))
            fail("A stale reader must not receive different PDF bytes")
        } catch (expected: IllegalArgumentException) { assertTrue(expected.message!!.contains("资料版本已更新")) }
    }

    @Test fun duplicateImportPreservesUserEditsAndRestoresTrash() {
        val scope = scope()
        val item = bytes.inputStream().use { store.importStream(scope, input(), it) }
        item.put("collection", "项目 A").put("note", "保留备注").put("deletedAt", "2026-09-30T00:00:00Z")
        store.dispatch(scope, JSONObject().put("operation", "update").put("item", item))
        val duplicate = bytes.inputStream().use { store.importStream(scope, input(), it) }
        assertEquals(item.getString("id"), duplicate.getString("id"))
        assertEquals("项目 A", duplicate.getString("collection"))
        assertEquals("保留备注", duplicate.getString("note"))
        assertFalse(duplicate.has("deletedAt"))
        assertEquals(1, store.list(scope).length())
    }

    @Test fun incompleteTransferNeverPublishesAnItem() {
        val scope = scope()
        val transfer = store.dispatch(scope, JSONObject().put("operation", "beginImport").put("input", input()).put("size", bytes.size))
        try {
            store.dispatch(scope, JSONObject().put("operation", "finishImport").put("transfer", transfer))
            fail("Incomplete import must fail")
        } catch (expected: IllegalArgumentException) { assertEquals(0, store.list(scope).length()) }
        store.dispatch(scope, JSONObject().put("operation", "cancelImport").put("transfer", transfer))
    }

    @Test fun recordsPreserveJsonValueTypes() {
        val scope = scope()
        store.dispatch(scope, JSONObject().put("operation", "writeRecord").put("key", "preference").put("value", "true"))
        assertEquals("true", store.dispatch(scope, JSONObject().put("operation", "readRecord").put("key", "preference")))
    }

    @Test fun versionOneUpgradePreservesMetadataAndRecordsAndAllowsSharedBytes() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val path = java.io.File(context.cacheDir, "upgrade-${UUID.randomUUID()}.db")
        try {
            android.database.sqlite.SQLiteDatabase.openOrCreateDatabase(path, null).use { db ->
                db.execSQL("CREATE TABLE items (scope TEXT NOT NULL, id TEXT NOT NULL, hash TEXT NOT NULL, kind TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(scope,id), UNIQUE(scope,hash))")
                db.execSQL("CREATE TABLE records (scope TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(scope,key))")
                val value = JSONObject().put("title", "升级前资料").put("note", "保留备注").put("page", 8).toString()
                db.execSQL("INSERT INTO items VALUES (?,?,?,?,?)", arrayOf("local", "original", "same-hash", "pdf", value))
                db.execSQL("INSERT INTO records VALUES (?,?,?)", arrayOf("local", "annotations:original", "{\"version\":2,\"annotations\":[{\"id\":\"ink\"}]}"))
                db.beginTransaction()
                try { store.onUpgrade(db, 1, 2); db.version = 2; db.setTransactionSuccessful() } finally { db.endTransaction() }
            }
            android.database.sqlite.SQLiteDatabase.openDatabase(path.path, null, android.database.sqlite.SQLiteDatabase.OPEN_READWRITE).use { db ->
                assertEquals(2, db.version)
                db.rawQuery("SELECT value FROM items WHERE id='original'", null).use { cursor ->
                    assertTrue(cursor.moveToFirst()); val item = JSONObject(cursor.getString(0))
                    assertEquals("升级前资料", item.getString("title")); assertEquals("保留备注", item.getString("note")); assertEquals(8, item.getInt("page"))
                }
                db.rawQuery("SELECT value FROM records", null).use { cursor -> assertTrue(cursor.moveToFirst()); assertTrue(cursor.getString(0).contains("ink")) }
                db.execSQL("INSERT INTO items VALUES (?,?,?,?,?)", arrayOf("local", "another-document", "same-hash", "pdf", "{}"))
                db.rawQuery("SELECT COUNT(*) FROM items", null).use { cursor -> cursor.moveToFirst(); assertEquals(2, cursor.getInt(0)) }
            }
        } finally { android.database.sqlite.SQLiteDatabase.deleteDatabase(path) }
    }
}
