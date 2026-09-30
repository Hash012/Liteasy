package com.liteasy.mobile

import android.content.Context
import androidx.work.*
import java.util.concurrent.TimeUnit

class DavSyncWorker(context: Context, parameters: WorkerParameters) : Worker(context, parameters) {
    @Volatile private var sync: DavSync? = null
    override fun onStopped() { sync?.cancelRequests() }
    override fun doWork(): Result {
        val scope = inputData.getString("scope") ?: return Result.failure()
        if (scope != "local" && MobileAccount(applicationContext).activeScope() != scope) return Result.failure()
        return try { val operation = DavSync(applicationContext, scope); sync = operation; operation.run { isStopped }; Result.success() }
        catch (error: Exception) {
            if (error is DavHttpException && error.status in listOf(401, 403, 507)) Result.failure()
            else if (error is java.io.IOException && runAttemptCount < 3) Result.retry() else Result.failure()
        }
    }
    companion object {
        fun schedule(context: Context, scope: String, immediate: Boolean) {
            val sync = DavSync(context, scope); val settings = sync.settings() ?: error("请先配置文件同步。")
            val manager = WorkManager.getInstance(context)
            val name = "webdav-${LibraryStore.digest(scope.toByteArray())}"
            val constraints = Constraints.Builder().setRequiredNetworkType(if (settings.optBoolean("wifiOnly", true)) NetworkType.UNMETERED else NetworkType.CONNECTED).build()
            val data = Data.Builder().putString("scope", scope).build()
            if (immediate) {
                DavLocal(context, scope).record("sync-status", org.json.JSONObject().put("state", "queued"))
                manager.enqueueUniqueWork("$name-now", ExistingWorkPolicy.KEEP, OneTimeWorkRequestBuilder<DavSyncWorker>().setInputData(data).setConstraints(constraints)
                    .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build())
            }
            else if (settings.optBoolean("autoSync")) manager.enqueueUniquePeriodicWork(name, ExistingPeriodicWorkPolicy.UPDATE,
                PeriodicWorkRequestBuilder<DavSyncWorker>(15, TimeUnit.MINUTES).setInputData(data).setConstraints(constraints).build())
            else manager.cancelUniqueWork(name)
        }
        fun cancel(context: Context, scope: String) {
            val name = "webdav-${LibraryStore.digest(scope.toByteArray())}"
            WorkManager.getInstance(context).cancelUniqueWork("$name-now")
        }
        fun suspend(context: Context, scope: String) {
            val name = "webdav-${LibraryStore.digest(scope.toByteArray())}"
            val manager = WorkManager.getInstance(context)
            manager.cancelUniqueWork(name); manager.cancelUniqueWork("$name-now")
        }
    }
}
