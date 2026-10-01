package com.liteasy.mobile

import android.content.Context
import android.os.Build
import android.util.Base64
import androidx.work.*
import org.json.JSONArray
import org.json.JSONObject
import java.security.SecureRandom
import java.util.UUID
import java.util.concurrent.TimeUnit

/** The account owns this credential/outbox. No device secret is returned to JavaScript or WebDAV. */
class MobileTasks(private val context: Context, private val scope: String, private val account: MobileAccount = MobileAccount(context)) {
    companion object {
        private val locks = java.util.concurrent.ConcurrentHashMap<String, Any>()
        private val sendLocks = java.util.concurrent.ConcurrentHashMap<String, Any>()
    }
    private val mutex = locks.getOrPut(scope) { Any() }
    private val local = DavLocal(context, scope)
    private val secure = SecureStore(context)
    private val key = "device:$scope"
    private fun assertScope() { require(scope != "local" && account.activeScope() == scope) { "请先登录对应账号。" } }
    private fun credential(): JSONObject = synchronized(mutex) {
        assertScope()
        secure.read(key)?.let(::JSONObject) ?: JSONObject().put("deviceId", UUID.randomUUID().toString())
            .put("secret", Base64.encodeToString(ByteArray(32).also { SecureRandom().nextBytes(it) }, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP))
            .put("name", "${Build.MANUFACTURER} ${Build.MODEL}".take(100)).put("capabilities", JSONArray()).also { secure.write(key, it.toString()) }
    }
    private fun call(path: String, method: String = "GET", body: JSONObject? = null): JSONObject {
        val device = credential()
        if (!device.optBoolean("registered")) {
            val registered = account.request("/v1/mobile/devices/register", "POST", device, expectedScope = scope)
            require(registered.getJSONObject("device").getString("deviceId") == device.getString("deviceId")) { "设备注册响应不匹配。" }
            device.put("registered", true); secure.write(key, device.toString())
        }
        return account.request("/v1/mobile/$path", method, body, mapOf("X-Liteasy-Device-Id" to device.getString("deviceId"), "X-Liteasy-Device-Secret" to device.getString("secret")), scope)
    }
    private fun outbox() = (local.record("task-outbox") as? JSONArray) ?: JSONArray()
    private fun cachedSnapshot(error: String? = null): JSONObject = synchronized(mutex) {
        val snapshot = (local.record("device-snapshot") as? JSONObject) ?: JSONObject().put("devices", JSONArray()).put("pairs", JSONArray()).put("tasks", JSONArray())
        snapshot.put("outbox", outbox()); snapshot.put("offline", error != null); if (error != null) snapshot.put("error", error)
        snapshot
    }
    fun snapshot(): JSONObject {
        assertScope()
        var error: String? = null
        try { val response = call("devices"); synchronized(mutex) { local.record("device-snapshot", response) } }
        catch (_: Exception) { error = "暂时无法刷新桌面状态，待发送任务仍保存在本机。" }
        assertScope(); return cachedSnapshot(error)
    }
    fun pair(code: String): JSONObject { call("pairs", "POST", JSONObject().put("code", code)); return snapshot() }
    fun result(taskId: String, updatedAt: Long): JSONObject {
        assertScope(); require(Regex("[a-f0-9-]{36}").matches(taskId))
        val prior = synchronized(mutex) { (local.record("task-results") as? JSONObject)?.optJSONObject(taskId) }
        if (prior != null && prior.optLong("updatedAt") == updatedAt && prior.optString("status") in listOf("succeeded", "failed", "cancelled")) return prior
        val task = try { call("tasks/$taskId").getJSONObject("task") }
        catch (error: Exception) { if (prior != null && prior.optLong("updatedAt") == updatedAt) return prior else throw error }
        synchronized(mutex) {
            val cached = (local.record("task-results") as? JSONObject) ?: JSONObject()
            cached.put(taskId, task)
            val ids = cached.keys().asSequence().toList().sortedByDescending { cached.getJSONObject(it).optLong("updatedAt") }
            ids.drop(20).forEach { cached.remove(it) }; local.record("task-results", cached)
        }
        return task
    }
    fun unpair(pairId: String): JSONObject {
        require(Regex("[a-f0-9-]{36}").matches(pairId))
        val previous = local.record("device-snapshot") as? JSONObject
        val pairs = previous?.optJSONArray("pairs") ?: JSONArray()
        val desktop = (0 until pairs.length()).map { pairs.getJSONObject(it) }.find { it.getString("pairId") == pairId }?.getString("desktopId")
        call("pairs/$pairId", "DELETE")
        if (desktop != null) synchronized(mutex) { val queue = outbox(); local.record("task-outbox", JSONArray((0 until queue.length()).map { queue.getJSONObject(it) }.filter { it.getString("desktopId") != desktop })) }
        return snapshot()
    }
    fun enqueue(input: JSONObject): JSONObject = synchronized(mutex) {
        assertScope()
        require(Regex("[a-f0-9-]{36}").matches(input.getString("operationId")) && Regex("[a-f0-9-]{36}").matches(input.getString("desktopId"))) { "任务标识无效。" }
        require(input.getString("kind") in listOf("open-document", "extract-text", "summarize-document", "sync-library")) { "不支持的桌面任务。" }
        if (input.getString("kind") != "sync-library") {
            val document = input.getJSONObject("document")
            val item = LibraryStore.get(context).syncItem(scope, document.getString("documentId")) ?: error("文献不存在。")
            require(item.getString("kind") == "pdf" && item.getString("contentHash") == document.getString("contentHash") && !item.has("deletedAt")) { "文献版本已更新，请重新选择。" }
        }
        val queue = outbox()
        val existing = (0 until queue.length()).map { queue.getJSONObject(it) }.find { it.getString("operationId") == input.getString("operationId") }
        if (existing != null) return@synchronized existing
        require(queue.length() < 50) { "待发送任务过多，请先连接网络处理已有任务。" }
        val value = JSONObject(input.toString()).put("createdAt", System.currentTimeMillis()).put("status", "pending-send")
        queue.put(value); local.record("task-outbox", queue); TaskOutboxWorker.schedule(context, scope)
        value
    }
    fun cancel(operationId: String, taskId: String?): JSONObject {
        assertScope()
        val pending = synchronized(mutex) {
            val queue = outbox(); val value = (0 until queue.length()).map { queue.getJSONObject(it) }.find { it.getString("operationId") == operationId }
            if (value != null) { value.put("cancelRequested", true); local.record("task-outbox", queue) }
            value != null
        }
        if (pending) {
            TaskOutboxWorker.schedule(context, scope); return cachedSnapshot()
        } else {
            require(taskId != null && Regex("[a-f0-9-]{36}").matches(taskId)) { "任务不存在。" }
            call("tasks/$taskId/cancel", "POST", JSONObject())
        }
        return snapshot()
    }
    fun flush(stopped: () -> Boolean = { false }): Int = synchronized(sendLocks.getOrPut(scope) { Any() }) {
        assertScope()
        var sent = 0
        while (sent < 5 && !stopped()) {
            val pending = synchronized(mutex) { outbox().optJSONObject(0)?.let { JSONObject(it.toString()) } } ?: break
            try {
                val receipt = call("tasks", "POST", pending).getJSONObject("task")
                require(receipt.getString("operationId") == pending.getString("operationId") && Regex("[a-f0-9-]{36}").matches(receipt.getString("taskId")) &&
                    receipt.getString("status") in listOf("queued", "leased", "waiting-input", "running", "uncertain", "succeeded", "failed", "cancelled")) { "任务尚未收到有效回执，将保留并重试。" }
                synchronized(mutex) {
                    val queue = outbox(); val index = (0 until queue.length()).find { queue.getJSONObject(it).getString("operationId") == pending.getString("operationId") }
                    if (index != null) {
                        // A cancellation saved while the send was in flight must still reach the server.
                        if (!queue.getJSONObject(index).optBoolean("cancelRequested") || pending.optBoolean("cancelRequested")) queue.remove(index)
                        local.record("task-outbox", queue)
                    }
                }
                sent++
            } catch (error: Exception) {
                synchronized(mutex) {
                    val queue = outbox(); (0 until queue.length()).map { queue.getJSONObject(it) }.find { it.getString("operationId") == pending.getString("operationId") }
                        ?.put("error", "任务尚未确认送达，将使用同一操作编号重试。")
                    local.record("task-outbox", queue)
                }
                throw error
            }
        }
        synchronized(mutex) { outbox().length() }
    }
}

class TaskOutboxWorker(context: Context, parameters: WorkerParameters) : Worker(context, parameters) {
    override fun doWork(): Result {
        val scope = inputData.getString("scope") ?: return Result.failure()
        if (MobileAccount(applicationContext).activeScope() != scope) return Result.failure()
        return try { if (MobileTasks(applicationContext, scope).flush { isStopped } > 0) schedule(applicationContext, scope); Result.success() }
        catch (error: Exception) { if (error is AccountHttpError && error.status in listOf(401, 403, 404, 409, 413)) Result.failure() else Result.retry() }
    }
    companion object {
        private fun name(scope: String) = "task-outbox-${LibraryStore.digest(scope.toByteArray())}"
        fun schedule(context: Context, scope: String) {
            WorkManager.getInstance(context).enqueueUniqueWork(name(scope), ExistingWorkPolicy.APPEND_OR_REPLACE, OneTimeWorkRequestBuilder<TaskOutboxWorker>()
                .setInputData(Data.Builder().putString("scope", scope).build()).setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build())
        }
        fun suspend(context: Context, scope: String) { WorkManager.getInstance(context).cancelUniqueWork(name(scope)) }
    }
}
