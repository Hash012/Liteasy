package com.liteasy.mobile

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Secrets stay outside Android backup and are authenticated with an installation-bound keystore key. */
class SecureStore(context: Context) {
    private val directory = File(context.noBackupFilesDir, "secrets").apply { mkdirs() }
    private fun file(name: String) = AtomicFile(File(directory, LibraryStore.digest(name.toByteArray())))
    private fun key(): SecretKey = synchronized(SecureStore::class.java) {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val alias = "liteasy-mobile-secrets-v1"
        (store.getKey(alias, null) as? SecretKey) ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    fun read(name: String): String? = synchronized(SecureStore::class.java) {
        val file = file(name); if (!file.baseFile.exists()) return null
        val bytes = file.openRead().use { it.readBytes() }
        require(bytes.size in 29..128_000) { "保存的凭据损坏，请重新登录或配置同步。" }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
        cipher.updateAAD(name.toByteArray())
        String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)))
    }
    fun write(name: String, value: String) = synchronized(SecureStore::class.java) {
        require(value.toByteArray().size <= 100_000) { "凭据内容过大。" }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key()); cipher.updateAAD(name.toByteArray())
        val file = file(name); val output = file.startWrite()
        try { output.write(cipher.iv); output.write(cipher.doFinal(value.toByteArray())); file.finishWrite(output) }
        catch (error: Exception) { file.failWrite(output); throw error }
    }
    fun remove(name: String) = synchronized(SecureStore::class.java) { file(name).delete() }
}
