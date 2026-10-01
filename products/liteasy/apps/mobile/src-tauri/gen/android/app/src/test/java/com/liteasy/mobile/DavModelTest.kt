package com.liteasy.mobile

import org.junit.Assert.*
import org.junit.Test

class DavModelTest {
    private fun version(hash: Char, id: String = "paper-1") = DavVersion(hash.toString().repeat(64), 20, id)
    private fun manifest(vararg pairs: Pair<String, DavVersion?>) = DavManifest(2, pairs.toMap().toMutableMap())
    @Test fun threeWayChangesAndDeletes() {
        val a = version('a'); val b = version('b'); val c = version('c')
        assertEquals(DavAction.UPLOAD, DavModel.action(a, b, a))
        assertEquals(DavAction.DOWNLOAD, DavModel.action(a, a, b))
        assertEquals(DavAction.UPLOAD, DavModel.action(a, null, a))
        assertEquals(DavAction.DOWNLOAD, DavModel.action(a, a, null))
        assertEquals(DavAction.CONFLICT, DavModel.action(a, b, c))
        assertEquals(DavAction.CONFLICT, DavModel.action(a, null, b))
        assertEquals(DavAction.EQUAL, DavModel.action(a, b, b))
    }
    @Test fun unpairedDeviceCannotResurrectDeletionAndStaleResolutionIsRejected() {
        val path = "paper.pdf"; val local = manifest(path to version('a')); val remote = manifest(path to null)
        val stale = mapOf(path to (DavConflict(path, version('b'), null) to true))
        assertEquals(DavAction.CONFLICT, DavPlan.create(null, local, remote, true, { true }, stale).single().action)
        val current = mapOf(path to (DavConflict(path, version('a'), null) to true))
        assertEquals(DavAction.UPLOAD, DavPlan.create(null, local, remote, true, { true }, current).single().action)
    }
    @Test fun missingManifestOrRecordsCannotMassDelete() {
        val base = manifest("paper.pdf" to version('a'))
        try { DavPlan.create(base, base, DavManifest(), false, { true }); fail("Missing manifest must fail") } catch (_: IllegalArgumentException) { }
        try { DavPlan.create(base, base, DavManifest(), true, { true }); fail("Missing records must fail") } catch (_: IllegalArgumentException) { }
        assertEquals(DavAction.DOWNLOAD, DavPlan.create(base, base, manifest("paper.pdf" to null), true, { true }).single().action)
    }
    @Test fun unsupportedPathsAndIdentityCollisionsAreRejected() {
        for (path in listOf("../a.pdf", "/a.pdf", "AUX.pdf", "a/../b.pdf", "a\\b.pdf", ".liteasy/secrets/key.json", "a.pdf ")) assertFalse(path, DavModel.allowedPath(path))
        for (path in listOf("folder/paper.pdf", ".liteasy/paper-artifacts/paper-1/annotations.v1.json", ".liteasy/sync-data/objects/mobile-library/paper-1.json")) assertTrue(path, DavModel.allowedPath(path))
        try { DavModel.validate(manifest("a.pdf" to version('a'), "A.pdf" to version('b', "paper-2"))); fail("Case collision") } catch (_: IllegalArgumentException) { }
        try { DavModel.validate(manifest("a.pdf" to version('a'), "b.pdf" to version('b'))); fail("Identity collision") } catch (_: IllegalArgumentException) { }
        try { DavModel.validate(DavManifest(99)); fail("Future version") } catch (_: IllegalArgumentException) { }
    }
}
