package com.liteasy.mobile

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class DavSyncTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val store = LibraryStore.get(context)
    private fun device(remote: FakeRemote): Pair<String, DavSync> {
        val scope = "test:${UUID.randomUUID()}"
        SecureStore(context).write("webdav:$scope", JSONObject().put("endpoint", "https://example.org/dav/").put("collection", "library").put("username", "test").put("password", "test-secret").toString())
        return scope to DavSync(context, scope) { remote }
    }
    private fun pdf(scope: String): JSONObject = "%PDF-1.7\n${UUID.randomUUID()}".byteInputStream().use {
        store.importStream(scope, JSONObject().put("title", "研究资料").put("filename", "paper.pdf").put("mimeType", "application/pdf").put("note", "保留备注"), it)
    }
    @Test fun twoDevicesTransferFilesDescriptionsAndDeletionWithoutRemovingOtherCategories() {
        val remote = FakeRemote(); val (a, first) = device(remote); val (b, second) = device(remote)
        val unrelated = DavVersion("f".repeat(64), 1)
        remote.value.files[".liteasy/sync-data/keys/account/encrypted.json"] = unrelated
        remote.exists = true
        val original = pdf(a)
        assertEquals("complete", first.run().getString("state"))
        assertEquals("complete", second.run().getString("state"))
        val received = store.syncItem(b, original.getString("id"))!!
        assertEquals(original.getString("contentHash"), received.getString("contentHash"))
        assertEquals("保留备注", received.getString("note"))
        assertEquals(unrelated, remote.value.files[".liteasy/sync-data/keys/account/encrypted.json"])
        val deleted = store.syncItem(a, original.getString("id"))!!.put("deletedAt", "2026-09-30T00:00:00Z")
        store.dispatch(a, JSONObject().put("operation", "update").put("item", deleted))
        first.run(); second.run()
        assertTrue(store.syncItem(b, original.getString("id"))!!.has("deletedAt"))
        assertTrue(store.attachment(b, original.getString("contentHash")).exists())
    }
    @Test fun missingManifestAndFailedPublishLeaveRecoverableLocalData() {
        val remote = FakeRemote(); val (scope, sync) = device(remote); val item = pdf(scope)
        remote.failPublish = true
        try { sync.run(); fail("Publish should fail") } catch (_: IllegalStateException) { }
        assertEquals(1, store.list(scope).length()); assertTrue(store.attachment(scope, item.getString("contentHash")).exists())
        remote.failPublish = false; sync.run(); remote.exists = false
        try { sync.run(); fail("Lost manifest should fail") } catch (expected: IllegalArgumentException) { assertTrue(expected.message!!.contains("已丢失")) }
        assertFalse(store.syncItem(scope, item.getString("id"))!!.has("deletedAt"))
    }
    @Test fun localEditsDuringDownloadAreNotOverwritten() {
        val remote = FakeRemote(); val (a, first) = device(remote); val (b, second) = device(remote)
        val original = pdf(a); first.run(); second.run()
        val edit = store.syncItem(a, original.getString("id"))!!.put("note", "来自桌面的备注")
        store.dispatch(a, JSONObject().put("operation", "update").put("item", edit)); first.run()
        remote.duringDownload = {
            val local = store.syncItem(b, original.getString("id"))!!.put("note", "刚在手机修改")
            store.dispatch(b, JSONObject().put("operation", "update").put("item", local))
        }
        try { second.run(); fail("Concurrent local edit must stop apply") } catch (_: IllegalArgumentException) { }
        assertEquals("刚在手机修改", store.syncItem(b, original.getString("id"))!!.getString("note"))
    }
    @Test fun credentialsAreEncryptedAndNotReturnedToTheWebview() {
        val (_, sync) = device(FakeRemote())
        assertFalse(sync.publicSettings()!!.has("password"))
        assertTrue(sync.publicSettings()!!.getBoolean("hasPassword"))
        val values = File(context.noBackupFilesDir, "secrets").listFiles().orEmpty()
        assertFalse(values.any { it.readText().contains("test-secret") })
    }
    @Test fun emptyFirstSyncCreatesManifestBeforeRecordingBaseline() {
        val remote = FakeRemote(); val (scope, sync) = device(remote)
        sync.run(); assertTrue(remote.exists)
        sync.run(); pdf(scope); sync.run()
        assertTrue(remote.value.files.keys.any { it.endsWith(".pdf") })
    }
    @Test fun openDocumentIsNotReplacedByRemoteRename() {
        val remote = FakeRemote(); val (scope, sync) = device(remote); val original = pdf(scope)
        sync.run()
        val path = store.syncItem(scope, original.getString("id"))!!.getString("syncPath")
        val version = remote.value.files[path]
        remote.value.files[path] = null; remote.value.files["renamed.pdf"] = version; remote.revision++
        store.dispatch(scope, JSONObject().put("operation", "setOpenDocument").put("id", original.getString("id")))
        assertTrue(sync.run().getBoolean("deferredOpenDocument"))
        assertEquals(path, store.syncItem(scope, original.getString("id"))!!.getString("syncPath"))
        store.dispatch(scope, JSONObject().put("operation", "setOpenDocument").put("id", JSONObject.NULL))
        sync.run()
        assertEquals("renamed.pdf", store.syncItem(scope, original.getString("id"))!!.getString("syncPath"))
    }
    @Test fun manifestParserRejectsCoercibleButInvalidFieldTypes() {
        for (text in listOf("{\"schemaVersion\":\"2\",\"files\":{}}", "{\"schemaVersion\":2,\"files\":{\"a.txt\":{\"hash\":\"${"a".repeat(64)}\",\"size\":1.5}}}")) {
            try { DavJson.decode(text.toByteArray()); fail("Invalid field type must fail") } catch (_: IllegalArgumentException) { }
        }
    }
    private class FakeRemote : DavRemote {
        var value = DavManifest(); var exists = false; var revision = 0; var failPublish = false
        var duringDownload: (() -> Unit)? = null
        private val objects = mutableMapOf<String, ByteArray>()
        override fun prepare() { }
        override fun cancel() { }
        override fun manifest(): RemoteDavManifest = if (exists) RemoteDavManifest(DavManifest(value.schemaVersion, value.files.toSortedMap()), revision.toString(), DavJson.encode(value)) else RemoteDavManifest(DavManifest(), null, null)
        override fun publish(manifest: DavManifest, revision: String?) {
            check(!failPublish) { "Interrupted publication" }
            check(revision == manifest().revision)
            value = DavManifest(manifest.schemaVersion, manifest.files.toSortedMap()); exists = true; this.revision++
        }
        override fun upload(version: DavVersion, file: File, temporary: File) {
            val bytes = file.readBytes(); check(LibraryStore.digest(bytes) == version.hash); objects[version.hash] = bytes
        }
        override fun download(version: DavVersion, target: File) {
            duringDownload?.invoke(); target.writeBytes(objects[version.hash] ?: error("Missing test object"))
        }
    }
}
