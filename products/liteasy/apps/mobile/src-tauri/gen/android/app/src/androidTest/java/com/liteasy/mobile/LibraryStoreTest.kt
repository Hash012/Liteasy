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
}
