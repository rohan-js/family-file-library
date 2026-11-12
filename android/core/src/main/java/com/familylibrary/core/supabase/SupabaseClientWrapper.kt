package com.familylibrary.core.supabase

import com.familylibrary.core.security.SecureSessionStore
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.gotrue.Auth
import io.github.jan.supabase.postgrest.Postgrest
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.postgrest.rpc
import io.github.jan.supabase.realtime.Realtime
import io.github.jan.supabase.realtime.realtime
import io.github.jan.supabase.storage.Storage
import io.github.jan.supabase.storage.storage
import io.ktor.client.engine.okhttp.OkHttp
import kotlinx.serialization.Serializable
import okhttp3.Interceptor
import java.util.concurrent.TimeUnit
import kotlin.time.Duration.Companion.seconds

@Serializable
data class PairingCodeRequest(
    val p_device_identifier: String,
    val p_device_name: String
)

@Serializable
data class PairingCodeResponse(
    val code: String,
    val device_secret: String,
    val expires_at: String
)

@Serializable
data class ClaimPairingRequest(
    val p_device_identifier: String,
    val p_device_secret: String
)

@Serializable
data class ClaimPairingResponse(
    val status: String,
    val device_id: String? = null,
    val space_id: String? = null,
    val device_token: String? = null
)

class SupabaseClientWrapper(
    val supabaseUrl: String,
    val supabaseAnonKey: String,
    private val sessionStore: SecureSessionStore
) {
    private val deviceTokenInterceptor = Interceptor { chain ->
        val original = chain.request()
        val builder = original.newBuilder()
        val token = sessionStore.getDeviceToken()
        if (!token.isNullOrBlank()) {
            builder.header("x-device-token", token)
        }
        chain.proceed(builder.build())
    }

    val client: SupabaseClient by lazy {
        createSupabaseClient(
            supabaseUrl = supabaseUrl,
            supabaseKey = supabaseAnonKey
        ) {
            httpEngine = OkHttp.create {
                config {
                    addInterceptor(deviceTokenInterceptor)
                    connectTimeout(30, TimeUnit.SECONDS)
                    readTimeout(60, TimeUnit.SECONDS)
                    writeTimeout(60, TimeUnit.SECONDS)
                    pingInterval(30, TimeUnit.SECONDS)
                    retryOnConnectionFailure(true)
                }
            }
            install(Postgrest)
            install(Storage)
            install(Realtime) {
                reconnectDelay = 2.seconds
            }
            install(Auth)
        }
    }

    val postgrest: Postgrest get() = client.postgrest
    val storage: Storage get() = client.storage
    val realtime: Realtime get() = client.realtime

    suspend fun requestPairingCode(deviceIdentifier: String, deviceName: String): PairingCodeResponse {
        return client.postgrest.rpc(
            "request_tv_pairing_code",
            PairingCodeRequest(deviceIdentifier, deviceName)
        ).decodeAs<PairingCodeResponse>()
    }

    suspend fun claimPairingCode(deviceIdentifier: String, deviceSecret: String): ClaimPairingResponse {
        return client.postgrest.rpc(
            "claim_tv_pairing_code",
            ClaimPairingRequest(deviceIdentifier, deviceSecret)
        ).decodeAs<ClaimPairingResponse>()
    }

    suspend fun createSignedUrl(
        bucketName: String = "family-files",
        path: String,
        expiresInSeconds: Long = 3600
    ): String {
        return client.storage.from(bucketName).createSignedUrl(path, expiresInSeconds.seconds)
    }

    suspend fun downloadPublic(bucketName: String = "family-files", path: String): ByteArray {
        return client.storage.from(bucketName).downloadPublic(path)
    }

    suspend fun downloadAuthenticated(bucketName: String = "family-files", path: String): ByteArray {
        return client.storage.from(bucketName).downloadAuthenticated(path)
    }
}
