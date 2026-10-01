package com.liteasy.mobile

data class DavDecision(val path: String, val action: DavAction, val local: DavVersion?, val remote: DavVersion?)
object DavPlan {
    fun create(base: DavManifest?, local: DavManifest, remote: DavManifest, remoteExists: Boolean,
        selected: (String) -> Boolean, resolutions: Map<String, Pair<DavConflict, Boolean>> = emptyMap()): List<DavDecision> {
        DavModel.validate(local); DavModel.validate(remote); base?.let { DavModel.validate(it) }
        require(base == null || remoteExists) { "远端同步清单已丢失，已停止同步以保护本地数据。" }
        require(base == null || base.files.keys.all { remote.files.containsKey(it) }) { "远端清单缺少已同步记录，原数据未修改。" }
        val paths = ((base?.files?.keys ?: emptySet()) + local.files.keys + remote.files.keys).filter(selected).sorted()
        return paths.map { path ->
            val l = local.files[path]; val r = remote.files[path]
            val action = if (base?.files?.containsKey(path) != true && remote.files.containsKey(path) && r == null && l != null) DavAction.CONFLICT
                else DavModel.action(base?.files?.get(path), l, r)
            val resolution = resolutions[path]?.takeIf { it.first == DavConflict(path, l, r) }
            DavDecision(path, if (action == DavAction.CONFLICT && resolution != null) { if (resolution.second) DavAction.UPLOAD else DavAction.DOWNLOAD } else action, l, r)
        }
    }
}
