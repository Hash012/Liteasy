package com.liteasy.mobile

data class DavVersion(val hash: String, val size: Long, val documentId: String? = null)
data class DavManifest(val schemaVersion: Int = 2, val files: MutableMap<String, DavVersion?> = sortedMapOf())
enum class DavAction { EQUAL, UPLOAD, DOWNLOAD, CONFLICT }
data class DavConflict(val path: String, val local: DavVersion?, val remote: DavVersion?)

object DavModel {
    const val MAX_FILE_BYTES = 256L * 1024 * 1024
    const val MAX_MANIFEST_BYTES = 16L * 1024 * 1024
    fun action(base: DavVersion?, local: DavVersion?, remote: DavVersion?): DavAction = when {
        local == remote -> DavAction.EQUAL
        local == base -> DavAction.DOWNLOAD
        remote == base -> DavAction.UPLOAD
        else -> DavAction.CONFLICT
    }
    fun allowedPath(path: String): Boolean {
        if (path.toByteArray().size > 1024 || path.split('/').any { part ->
            part.isEmpty() || part in listOf(".", "..") || part.endsWith('.') || part.endsWith(' ') ||
                part.any { Character.isISOControl(it) || it in "\\:*?\"<>|" } ||
                Regex("CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9]").matches(part.substringBefore('.').uppercase())
        }) return false
        val parts = path.split('/')
        if (parts[0] == ".liteasy") return (
            (parts.size == 3 && parts[1] == "metadata-entries" && path.endsWith(".json")) ||
            (parts.size == 4 && parts[1] == "paper-artifacts" && path.endsWith(".v1.json")) ||
            (parts.size == 5 && parts[1] == "paper-artifacts" && parts[3] == "agent-results" && path.endsWith(".json")) ||
            (parts.size >= 4 && parts[1] == "sync-data" && parts[2] in listOf("objects", "boards", "external", "history", "preferences", "keys") && parts.drop(3).none { it.startsWith('.') }))
        return parts.none { it.startsWith('.') }
    }
    fun validate(manifest: DavManifest) {
        require(manifest.schemaVersion in 1..2 && manifest.files.size <= 100_000) { "同步清单版本不受支持或清单过大；原数据未修改。" }
        val names = mutableSetOf<String>(); val ids = mutableSetOf<String>()
        for ((path, version) in manifest.files) {
            require(allowedPath(path) && names.add(path.lowercase())) { "同步清单包含不安全或大小写冲突的路径。" }
            if (version == null) continue
            require(Regex("[a-f0-9]{64}").matches(version.hash) && version.size in 0..MAX_FILE_BYTES) { "同步文件校验信息无效。" }
            val pdf = !path.startsWith(".liteasy/") && path.endsWith(".pdf", true)
            require(pdf == (version.documentId != null)) { "同步文件缺少文献身份信息。" }
            version.documentId?.let { require(Regex("[a-zA-Z0-9-]{1,128}").matches(it) && ids.add(it)) { "文献标识无效或重复。" } }
        }
    }
    fun artifactDirectory(id: String): String {
        var hash = 0xcbf29ce484222325uL
        for (byte in id.toByteArray()) { hash = (hash xor byte.toUByte().toULong()) * 0x100000001b3uL }
        val stem = id.filter { it in 'a'..'z' || it in 'A'..'Z' || it in '0'..'9' || it in "-_." }.lowercase().take(40).ifEmpty { "paper" }
        return "$stem-${hash.toString(16).padStart(16, '0')}"
    }
}
