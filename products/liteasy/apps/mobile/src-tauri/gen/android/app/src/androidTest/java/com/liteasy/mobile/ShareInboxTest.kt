package com.liteasy.mobile

import android.content.Intent
import android.net.Uri
import android.os.SystemClock
import androidx.core.content.FileProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class ShareInboxTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val inbox = ShareInbox(context)
    private fun await(id: String): JSONObject {
        val deadline = SystemClock.elapsedRealtime() + 30_000
        while (SystemClock.elapsedRealtime() < deadline) {
            val list = inbox.list()
            for (index in 0 until list.length()) {
                val item = list.getJSONObject(index)
                if (item.getString("id") == id && item.getString("state") != "capturing") return item
            }
            SystemClock.sleep(50)
        }
        error("Capture did not complete")
    }
    private fun pdf(): Pair<File, Uri> {
        val file = File(context.cacheDir, "${UUID.randomUUID()}.pdf").apply { writeText("%PDF-1.7\nshared fixture") }
        return file to FileProvider.getUriForFile(context, "com.liteasy.mobile.fileprovider", file)
    }

    @Test fun attachmentSurvivesSourceRemovalAndInboxReopen() {
        val (source, uri) = pdf()
        val intent = Intent(Intent.ACTION_SEND).setType("application/pdf").putExtra(Intent.EXTRA_STREAM, uri)
        val id = inbox.receive(intent).single()
        assertEquals("ready", await(id).getString("state"))
        source.delete()
        val scope = "test:${UUID.randomUUID()}"
        val item = ShareInbox(context).import(scope, id, JSONObject().put("title", "保存的论文").put("collection", "研究"))
        assertEquals("保存的论文", item.getString("title"))
        assertEquals("研究", item.getString("collection"))
        assertEquals(1, LibraryStore.get(context).list(scope).length())
        assertFalse(inbox.list().toString().contains(id))
    }

    @Test fun multipleFilesRemainIndependentAndFailedImportCanRetry() {
        val first = pdf(); val second = pdf()
        val ids = inbox.receive(Intent(Intent.ACTION_SEND_MULTIPLE).setType("application/pdf")
            .putParcelableArrayListExtra(Intent.EXTRA_STREAM, arrayListOf(first.second, second.second)))
        assertEquals(2, ids.size)
        ids.forEach { assertEquals("ready", await(it).getString("state")) }
        try { inbox.import("test", ids[0], JSONObject().put("title", "")); fail("Invalid title must fail") }
        catch (_: IllegalArgumentException) { assertEquals("ready", await(ids[0]).getString("state")) }
        ids.forEach { inbox.discard(it) }; first.first.delete(); second.first.delete()
    }

    @Test fun textAndLinksAreDurableAndUnsupportedUrisAreReported() {
        val id = inbox.receive(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "https://example.org/paper")).single()
        assertEquals("https://example.org/paper", await(id).getString("sourceUrl"))
        val item = inbox.import("test:${UUID.randomUUID()}", id, JSONObject())
        assertEquals("link", item.getString("kind"))
        val invalid = inbox.receive(Intent(Intent.ACTION_SEND).setType("application/pdf").putExtra(Intent.EXTRA_STREAM, Uri.parse("file:///private/file.pdf"))).single()
        assertEquals("error", await(invalid).getString("state")); inbox.discard(invalid)
    }
}
