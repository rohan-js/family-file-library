package com.familylibrary.core.security

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.io.File
import java.security.KeyStore

data class SessionCredentials(
    val deviceId: String,
    val spaceId: String,
    val deviceToken: String
)

class SecureSessionStore(private val context: Context) {

    private val masterKey: MasterKey by lazy {
        createMasterKey()
    }

    private var prefs: SharedPreferences = createEncryptedPrefsDefensively()

    private fun createMasterKey(): MasterKey {
        return MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
    }

    private fun createEncryptedPrefsDefensively(): SharedPreferences {
        return try {
            buildPrefs()
        } catch (e: Exception) {
            Log.e(TAG, "EncryptedSharedPreferences corrupted on API 28 OEM. Initiating auto-recovery.", e)
            wipeAndRecreatePrefs()
        }
    }

    private fun buildPrefs(): SharedPreferences {
        return EncryptedSharedPreferences.create(
            context,
            PREFS_FILE_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    internal fun wipeAndRecreatePrefs(): SharedPreferences {
        try {
            prefs.edit().clear().commit()
        } catch (_: Exception) {
        }

        try {
            context.getSharedPreferences(PREFS_FILE_NAME, Context.MODE_PRIVATE)
                .edit()
                .clear()
                .commit()
            val file = File(context.filesDir.parent, "shared_prefs/$PREFS_FILE_NAME.xml")
            if (file.exists()) file.delete()
        } catch (ex: Exception) {
            Log.w(TAG, "Failed to delete corrupted prefs XML: ${ex.message}")
        }

        try {
            val keyStore = KeyStore.getInstance("AndroidKeyStore")
            keyStore.load(null)
            val alias = MasterKey.DEFAULT_MASTER_KEY_ALIAS
            if (keyStore.containsAlias(alias)) {
                keyStore.deleteEntry(alias)
            }
        } catch (ex: Exception) {
            Log.w(TAG, "Failed to clear MasterKey from KeyStore: ${ex.message}")
        }

        val newPrefs = try {
            buildPrefs()
        } catch (fallbackException: Exception) {
            Log.e(TAG, "Fallback creation of EncryptedSharedPreferences failed. Using standard private prefs.", fallbackException)
            context.getSharedPreferences("${PREFS_FILE_NAME}_fallback", Context.MODE_PRIVATE)
        }
        prefs = newPrefs
        return newPrefs
    }

    fun saveSession(deviceId: String, spaceId: String, deviceToken: String) {
        prefs.edit()
            .putString(KEY_DEVICE_ID, deviceId)
            .putString(KEY_SPACE_ID, spaceId)
            .putString(KEY_DEVICE_TOKEN, deviceToken)
            .apply()
    }

    fun saveDeviceToken(token: String) {
        prefs.edit()
            .putString(KEY_DEVICE_TOKEN, token)
            .apply()
    }

    fun saveSpaceCredentials(spaceId: String, secretKey: String) {
        prefs.edit()
            .putString(KEY_SPACE_ID, spaceId)
            .putString(KEY_DEVICE_TOKEN, secretKey)
            .apply()
    }

    fun getDeviceToken(): String? = prefs.getString(KEY_DEVICE_TOKEN, null)
    fun getSpaceId(): String? = prefs.getString(KEY_SPACE_ID, null)
    fun getDeviceId(): String? = prefs.getString(KEY_DEVICE_ID, null)

    fun getSession(): SessionCredentials? {
        val deviceId = getDeviceId() ?: return null
        val spaceId = getSpaceId() ?: return null
        val token = getDeviceToken() ?: return null
        return SessionCredentials(deviceId, spaceId, token)
    }

    fun isPaired(): Boolean = !getDeviceToken().isNullOrBlank() && !getSpaceId().isNullOrBlank()

    fun clearSession() {
        prefs.edit().clear().apply()
    }

    fun clear() {
        clearSession()
    }

    companion object {
        private const val TAG = "SecureSessionStore"
        const val PREFS_FILE_NAME = "family_library_secure_session"
        const val KEY_DEVICE_ID = "device_id"
        const val KEY_SPACE_ID = "space_id"
        const val KEY_DEVICE_TOKEN = "device_token"
    }
}
