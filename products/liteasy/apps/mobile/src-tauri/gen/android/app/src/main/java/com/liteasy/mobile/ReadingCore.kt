package com.liteasy.mobile

import org.json.JSONObject

object ReadingCore {
    init { System.loadLibrary("liteasy_mobile_lib") }
    @JvmStatic private external fun process(request: String): String
    private fun invoke(request: JSONObject): JSONObject {
        val result = JSONObject(process(request.toString()))
        require(!result.has("error")) { result.optString("error", "批注处理失败，原数据已保留。") }
        return result.getJSONObject("value")
    }
    fun prepare(id: String, previous: Any?, next: Any): JSONObject = invoke(JSONObject().put("operation", "prepare").put("documentId", id)
        .put("previous", previous ?: JSONObject.NULL).put("next", next))
    fun validate(id: String, hash: String, value: JSONObject) { invoke(JSONObject().put("operation", "validate").put("documentId", id).put("contentHash", hash).put("next", value)) }
    fun merge(id: String, hash: String, base: JSONObject?, local: JSONObject, remote: JSONObject): JSONObject = invoke(JSONObject()
        .put("operation", "merge").put("documentId", id).put("contentHash", hash).put("previous", base ?: JSONObject.NULL).put("local", local).put("remote", remote))
}
