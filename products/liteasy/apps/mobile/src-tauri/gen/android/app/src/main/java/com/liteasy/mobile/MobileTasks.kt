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
    companion object { private val locks = java.util.concurrent.ConcurrentHashMap<String, Any>() }
    private val mutex = locks.getOrPut(scope) { Any() }
    private val local = DavLocal(context, scope)
    private val secure = SecureStore(context)
    private val key = "device:$scope"
    private fun assertScope() { require(scope != "local" && account.activeScope() == scope) { "请先登录对应账号。" } }
    private fun credential(): JSONObject {
        assertScope()
        return secure.read(key)?.let(::JSONObject) ?: JSONObject().put("deviceId", UUID.randomUUID().toString())
            .put("secret", Base64.encodeToString(ByteArray(32).also { SecureRandom().nextBytes(it) }, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP))
            .put("name", "${Build.MANUFACTURER} ${Build.MODEL}".take(100)).put("capabilities", JSONArray()).also { secure.write(key, it.toString()) }
    }
    private fun call(path: String, method: String = "GET", body: JSONObject? = null): JSONObject {
        val device = credential()
        if (!device.optBoolean("registered")) {
            account.request("/v1/mobile/devices/register", "POST", device, expectedScope = scope)
            device.put("registered", true); secure.write(key, device.toString())
        }
        return account.request("/v1/mobile/$path", method, body, mapOf("X-Liteasy-Device-Id" to device.getString("deviceId"), "X-Liteasy-Device-Secret" to device.getString("secret")), scope)
    }
    private fun outbox() = (local.record("task-outbox") as? JSONArray) ?: JSONArray()
    fun snapshot(): JSONObject = synchronized(mutex) {
        assertScope()
        var error: String? = null
        val snapshot = try { call("devices").also { local.record("device-snapshot", it) } }
        catch (_: Exception) { error = "暂时无法刷新桌面状态，待发送任务仍保存在本机。"; (local.record("device-snapshot") as? JSONObject) ?: JSONObject().put("devices", JSONArray()).put("pairs", JSONArray()).put("tasks", JSONArray()) }
        snapshot.put("outbox", outbox()); snapshot.put("offline", error != null); if (error != null) snapshot.put("error", error)
        snapshot
    }
    fun pair(code: String): JSONObject = synchronized(mutex) { call("pairs", "POST", JSONObject().put("code", code)); snapshot() }
    fun unpair(pairId: String): JSONObject = synchronized(mutex) {
        require(Regex("[a-f0-9-]{36}").matches(pairId))
        val previous = local.record("device-snapshot") as? JSONObject
        val pairs = previous?.optJSONArray("pairs") ?: JSONArray()
        val desktop = (0 until pairs.length()).map { pairs.getJSONObject(it) }.find { it.getString("pairId") == pairId }?.getString("desktopId")
        call("pairs/$pairId", "DELETE")
        if (desktop != null) local.record("task-outbox", JSONArray((0 until outbox().length()).map { outbox().getJSONObject(it) }.filter { it.getString("desktopId") != desktop }))
        snapshot()
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
    fun cancel(operationId: String, taskId: String?): JSONObject = synchronized(mutex) {
        assertScope()
        val queue = outbox(); val pending = (0 until queue.length()).map { queue.getJSONObject(it) }.find { it.getString("operationId") == operationId }
        if (pending != null) {
            // Resolving an unknown send and requesting cancellation happen in one server transaction.
            pending.put("cancelRequested", true); local.record("task-outbox", queue); TaskOutboxWorker.schedule(context, scope)
        } else {
            require(taskId != null && Regex("[a-f0-9-]{36}").matches(taskId)) { "任务不存在。" }
            call("tasks/$taskId/cancel", "POST", JSONObject())
        }
        snapshot()
    }
    fun flush(stopped: () -> Boolean = { false }): Int = synchronized(mutex) {
        assertScope()
        var sent = 0; val queue = outbox()
        while (queue.length() > 0 && sent < 5 && !stopped()) {
            val pending = queue.getJSONObject(0)
            try {
                call("tasks", "POST", pending)
                queue.remove(0); local.record("task-outbox", queue); sent++
            } catch (error: Exception) {
                pending.put("error", "任务尚未确认送达，将使用同一操作编号重试。")
                local.record("task-outbox", queue); throw error
            }
        }
        if (sent > 0) snapshot()
        queue.length()
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
