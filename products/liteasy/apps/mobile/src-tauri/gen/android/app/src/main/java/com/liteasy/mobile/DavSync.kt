package com.liteasy.mobile

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.Instant
import java.util.UUID
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

class DavSync(private val context: Context, private val scope: String, private val remoteFactory: (JSONObject) -> DavRemote = {
    DavTransport(it.getString("endpoint"), it.getString("collection"), it.getString("username"), it.getString("password"))
}) {
    companion object { private val locks = java.util.concurrent.ConcurrentHashMap<String, ReentrantLock>() }
    private fun operationLock() = locks.getOrPut(scope) { ReentrantLock() }
    private val secure = SecureStore(context)
    private val local = DavLocal(context, scope)
    private val settingsKey = "webdav:$scope"
    @Volatile private var transport: DavRemote? = null
    fun cancelRequests() { transport?.cancel() }
    fun settings(): JSONObject? = secure.read(settingsKey)?.let { JSONObject(it) }
    fun publicSettings(): JSONObject? = settings()?.also { it.remove("password"); it.put("hasPassword", true) }
    fun configure(value: JSONObject) {
        val lock = operationLock()
        check(lock.tryLock()) { "正在同步，请在本次同步完成或停止后修改设置。" }
        try {
            val endpoint = DavTransport.endpoint(value.getString("endpoint"))
            val username = value.getString("username").trim(); val collection = value.getString("collection")
            require(username.length in 1..256 && Regex("[a-zA-Z0-9_-]{1,64}").matches(collection)) { "请填写用户名及有效的同步库名称。" }
            val previous = settings()
            val password = value.optString("password").ifEmpty {
                previous?.takeIf { it.optString("endpoint") == endpoint && it.optString("username") == username && it.optString("collection") == collection }?.optString("password") ?: ""
            }
            require(password.isNotEmpty() && password.length <= 4096) { "请填写 WebDAV 密码。" }
            secure.write(settingsKey, JSONObject().put("endpoint", endpoint).put("username", username).put("collection", collection).put("password", password)
                .put("autoSync", value.optBoolean("autoSync")).put("wifiOnly", value.optBoolean("wifiOnly", true)).toString())
            DavSyncWorker.schedule(context, scope, false)
        } finally { lock.unlock() }
    }
    fun status(): Any? = local.record("sync-status")
    fun run(stopped: () -> Boolean = { false }): JSONObject = operationLock().withLock {
        val config = settings() ?: error("请先配置文件同步。")
        val connection = LibraryStore.digest("${config.getString("endpoint")}\n${config.getString("username")}\n${config.getString("collection")}".toByteArray())
        val baselineKey = "sync-base:$connection"
        val remote = remoteFactory(config)
        transport = remote
        val operation = File(local.directory, "operation-${UUID.randomUUID()}").apply { mkdirs() }
        val downloadCache = File(local.directory, "downloads").apply { mkdirs() }
        fun progress(phase: String, completed: Int = 0, total: Int = 0) {
            check(!stopped()) { "同步已暂停，将在满足条件后重试。" }
            local.record("sync-status", JSONObject().put("state", "running").put("phase", phase).put("completed", completed).put("total", total))
        }
        try {
            progress("连接同步库"); remote.prepare()
            val original = remote.manifest()
            val base = (local.record(baselineKey) as? JSONObject)?.let { DavJson.decode(it.toString().toByteArray()) }
            val files = local.scan()
            val current = DavManifest(2, files.mapValuesTo(sortedMapOf()) { it.value?.version })
            val resolutions = (local.record("sync-resolutions:$connection") as? JSONArray)?.let { array ->
                (0 until array.length()).associate { index ->
                    val value = array.getJSONObject(index); val path = value.getString("path")
                    path to (DavConflict(path, if (value.isNull("local")) null else DavJson.parseVersion(value.getJSONObject("local")),
                        if (value.isNull("remote")) null else DavJson.parseVersion(value.getJSONObject("remote"))) to value.getBoolean("keepLocal"))
                }
            } ?: emptyMap()
            val openId = LibraryStore.get(context).openDocument(scope)
            val blocked = files.filter { it.value?.version?.documentId == openId && openId != null }.keys +
                original.value.files.filter { it.value?.documentId == openId && openId != null }.keys +
                setOfNotNull(openId?.let { LibraryStore.get(context).syncItem(scope, it)?.optString("syncPath") }) +
                if (openId != null) setOf("${DavLocal.METADATA_PREFIX}$openId.json", DavLocal.annotationPath(openId)) else emptySet()
            val knownAnnotations = (current.files.values + original.value.files.values).mapNotNull { it?.documentId }.map { DavLocal.annotationPath(it) }.toSet() + files.keys.filter { DavLocal.isAnnotation(it) }
            val decisions = DavPlan.create(base, current, original.value, original.revision != null,
                { DavLocal.selected(it) && it !in blocked && (!DavLocal.isAnnotation(it) || it in knownAnnotations) }, resolutions).toMutableList()
            // Renames sharing an ID are applied as one document; divergent paths require explicit conflict handling.
            val target = DavManifest(maxOf(2, original.value.schemaVersion), original.value.files.toSortedMap())
            val downloads = mutableMapOf<String, File>(); var uploaded = 0
            for ((index, decision) in decisions.withIndex()) {
                progress("传输文件", index, decisions.size)
                when (decision.action) {
                    DavAction.UPLOAD -> {
                        files[decision.path]?.let { remote.upload(it.version, it.file, File(operation, "verify")); uploaded++ }
                        target.files[decision.path] = decision.local
                    }
                    DavAction.DOWNLOAD -> decision.remote?.let { version ->
                        require(!decision.path.startsWith(DavLocal.METADATA_PREFIX) || version.size <= DavModel.MAX_MANIFEST_BYTES) { "资料元数据超过容量限制，原数据未修改。" }
                        val file = File(downloadCache, version.hash)
                        if (!file.exists() || file.length() != version.size || DavTransport.hash(file) != version.hash) {
                            require(downloadCache.usableSpace > version.size + 1024 * 1024) { "设备存储空间不足，请释放空间后重试。" }
                            remote.download(version, file)
                        }
                        downloads[decision.path] = file
                    }
                    DavAction.CONFLICT -> if (DavLocal.isAnnotation(decision.path) && decision.local != null && decision.remote != null) {
                        // Merge only when both manifests identify exactly the same PDF bytes.
                        val source = current.files.values.filterNotNull().find { it.documentId != null && DavLocal.annotationPath(it.documentId) == decision.path }
                        val other = original.value.files.values.filterNotNull().find { it.documentId != null && DavLocal.annotationPath(it.documentId) == decision.path }
                        if (source != null && other != null && source.hash == other.hash) {
                            try {
                                fun snapshot(version: DavVersion): JSONObject {
                                    require(version.size <= 32L * 1024 * 1024)
                                    val file = File(downloadCache, version.hash)
                                    if (!file.exists() || file.length() != version.size || DavTransport.hash(file) != version.hash) remote.download(version, file)
                                    return JSONObject(file.readText())
                                }
                                val merged = ReadingCore.merge(source.documentId!!, source.hash, base?.files?.get(decision.path)?.let { snapshot(it) },
                                    JSONObject(files[decision.path]!!.file.readText()), snapshot(decision.remote))
                                val file = File(operation, "merged-$index").apply { writeText(DavLocal.canonical(merged).toString()) }
                                val version = DavVersion(DavTransport.hash(file), file.length())
                                remote.upload(version, file, File(operation, "verify")); uploaded++
                                target.files[decision.path] = version; downloads[decision.path] = file
                                decisions[index] = decision.copy(action = DavAction.DOWNLOAD, remote = version)
                            } catch (_: IllegalArgumentException) { /* Leave unsupported/corrupt snapshots as explicit file conflicts. */ }
                        }
                    }
                    else -> Unit
                }
            }
            DavModel.validate(target)
            progress("确认同步")
            // Do not publish a stale upload if the foreground edited its metadata while networking.
            val latest = local.scan()
            require(decisions.filter { it.action == DavAction.UPLOAD }.all { latest[it.path]?.version == it.local }) { "同步期间本地内容发生变化，请重试。" }
            if (target.files != original.value.files || original.revision == null) remote.publish(target, original.revision)
            else require(remote.manifest().revision == original.revision) { "远端数据已变化，请重新同步。" }
            progress("保存资料")
            local.applyBatch(decisions.filter { it.action == DavAction.DOWNLOAD }, downloads, target)
            val baseline = DavManifest(2, base?.files?.toSortedMap() ?: sortedMapOf())
            for (decision in decisions) if (decision.action != DavAction.CONFLICT) baseline.files[decision.path] = target.files[decision.path]
            local.record(baselineKey, JSONObject(String(DavJson.encode(baseline))))
            downloads.values.forEach { it.delete() }
            local.record("sync-resolutions:$connection", JSONArray())
            val conflicts = JSONArray()
            decisions.filter { it.action == DavAction.CONFLICT }.forEach { conflicts.put(JSONObject().put("path", it.path).put("local", DavJson.version(it.local)).put("remote", DavJson.version(it.remote))) }
            val result = JSONObject().put("state", if (conflicts.length() > 0) "conflict" else "complete").put("uploaded", uploaded).put("downloaded", downloads.size).put("deferredOpenDocument", openId != null)
                .put("conflicts", conflicts).put("connection", connection).put("finishedAt", Instant.now().toString())
            local.record("sync-status", result); result
        } catch (error: Exception) {
            // Never include URLs with credentials, response bodies or Authorization headers in status.
            val message = if (error is java.io.IOException && error !is DavHttpException) "同步网络请求失败，请检查网络和服务器证书。" else error.message ?: "同步失败，请重试。"
            local.record("sync-status", JSONObject().put("state", "error").put("error", message).put("finishedAt", Instant.now().toString()))
            throw error
        } finally { transport = null; operation.deleteRecursively() }
    }
    fun resolve(request: JSONObject) {
        val status = status() as? JSONObject ?: error("没有待处理冲突。")
        val path = request.getString("path"); val conflicts = status.getJSONArray("conflicts")
        val conflict = (0 until conflicts.length()).map { conflicts.getJSONObject(it) }.find { it.getString("path") == path } ?: error("冲突已变化，请刷新后重试。")
        val key = "sync-resolutions:${status.getString("connection")}"; val resolutions = (local.record(key) as? JSONArray) ?: JSONArray()
        conflict.put("keepLocal", request.getBoolean("keepLocal")); resolutions.put(conflict); local.record(key, resolutions)
        DavSyncWorker.schedule(context, scope, true)
    }
}
