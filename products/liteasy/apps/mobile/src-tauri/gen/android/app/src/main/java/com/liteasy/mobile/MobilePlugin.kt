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
                val value = when (request.getString("operation")) {
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
