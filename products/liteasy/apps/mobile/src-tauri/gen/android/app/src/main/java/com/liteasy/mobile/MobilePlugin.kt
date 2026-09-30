package com.liteasy.mobile

import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONObject
import java.util.concurrent.Executors

@TauriPlugin
class MobilePlugin(private val activity: Activity) : Plugin(activity) {
    private val executor = Executors.newSingleThreadExecutor()
    @Command
    fun dispatch(invoke: Invoke) {
        val request = invoke.getArgs().getJSONObject("request")
        executor.execute {
            try {
                val scope = request.optString("scope", "local")
                val account = MobileAccount(activity)
                require(scope == "local" || scope == account.activeScope()) { "账号已切换，请返回当前资料库重试。" }
                val value = when (request.getString("operation")) {
                    "backgroundApp" -> { activity.runOnUiThread { activity.moveTaskToBack(true) }; null }
                    "accountStatus" -> account.status()
                    "beginLogin" -> {
                        val url = account.begin(request.getString("apiBaseUrl"))
                        activity.runOnUiThread { try { activity.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url))) }
                            catch (_: Exception) { account.browserUnavailable() } }
                        account.status()
                    }
                    "cancelLogin" -> { account.cancelLogin(); account.status() }
                    "logout" -> account.logout()
                    "accountRequest" -> account.request(request.getString("path"), request.optString("method", "GET"), request.optJSONObject("body"))
                    "tasksSnapshot" -> MobileTasks(activity, scope).snapshot()
                    "taskResult" -> MobileTasks(activity, scope).result(request.getString("taskId"), request.optLong("updatedAt"))
                    "pairDesktop" -> MobileTasks(activity, scope).pair(request.getString("code"))
                    "unpairDesktop" -> MobileTasks(activity, scope).unpair(request.getString("pairId"))
                    "enqueueTask" -> MobileTasks(activity, scope).enqueue(request.getJSONObject("input"))
                    "cancelTask" -> MobileTasks(activity, scope).cancel(request.getString("operationId"), request.optString("taskId").ifEmpty { null })
                    "retryTaskOutbox" -> { TaskOutboxWorker.schedule(activity, scope); null }
                    "copyGuestLibrary" -> {
                        val destination = account.activeScope(); require(destination != "local") { "请先登录账号。" }
                        LibraryStore.get(activity).copyGuestLibrary(destination)
                    }
                    "syncSettings" -> DavSync(activity, scope).publicSettings()
                    "configureSync" -> { DavSync(activity, scope).configure(request.getJSONObject("settings")); null }
                    "syncStatus" -> DavSync(activity, scope).status()
                    "startSync" -> { DavSyncWorker.schedule(activity, scope, true); null }
                    "cancelSync" -> { DavSyncWorker.cancel(activity, scope); null }
                    "resolveSync" -> { DavSync(activity, scope).resolve(request); null }
                    "listShares" -> ShareInbox(activity).list()
                    "importShare" -> ShareInbox(activity).import(scope, request.getString("id"), request.getJSONObject("input"))
                    "discardShare" -> { ShareInbox(activity).discard(request.getString("id")); null }
                    else -> LibraryStore.get(activity).dispatch(scope, request)
                }
                invoke.resolve(JSObject().putValue("value", value ?: JSONObject.NULL))
            } catch (error: Exception) {
                invoke.reject(error.message ?: "操作失败，请重试。")
            }
        }
    }
}

private fun JSObject.putValue(key: String, value: Any): JSObject {
    put(key, value)
    return this
}
