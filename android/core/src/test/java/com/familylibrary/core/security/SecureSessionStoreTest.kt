package com.familylibrary.core.security

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class SecureSessionStoreTest {

    private lateinit var context: Context
    private lateinit var sessionStore: SecureSessionStore

    @Before
    fun setup() {
        context = ApplicationProvider.getApplicationContext()
        sessionStore = SecureSessionStore(context)
        sessionStore.clearSession()
    }

    @After
    fun tearDown() {
        sessionStore.clearSession()
    }

    @Test
    fun testSaveAndRetrieveSession() {
        assertThat(sessionStore.isPaired()).isFalse()
        assertThat(sessionStore.getSession()).isNull()

        val deviceId = "dev-12345"
        val spaceId = "space-67890"
        val token = "bearer_secret_token_abc"

        sessionStore.saveSession(deviceId, spaceId, token)

        assertThat(sessionStore.isPaired()).isTrue()
        assertThat(sessionStore.getDeviceId()).isEqualTo(deviceId)
        assertThat(sessionStore.getSpaceId()).isEqualTo(spaceId)
        assertThat(sessionStore.getDeviceToken()).isEqualTo(token)

        val session = sessionStore.getSession()
        assertThat(session).isNotNull()
        assertThat(session?.deviceId).isEqualTo(deviceId)
        assertThat(session?.spaceId).isEqualTo(spaceId)
        assertThat(session?.deviceToken).isEqualTo(token)

        sessionStore.clearSession()
        assertThat(sessionStore.isPaired()).isFalse()
        assertThat(sessionStore.getSession()).isNull()
    }

    @Test
    fun testSaveDeviceTokenAndSpaceCredentials() {
        sessionStore.saveDeviceToken("token-xyz")
        assertThat(sessionStore.getDeviceToken()).isEqualTo("token-xyz")

        sessionStore.saveSpaceCredentials("space-abc", "key-999")
        assertThat(sessionStore.getSpaceId()).isEqualTo("space-abc")
        assertThat(sessionStore.getDeviceToken()).isEqualTo("key-999")
    }

    @Test
    fun testDefensiveKeyStoreAutoRecovery() {
        // First populate session
        sessionStore.saveSession("dev-1", "space-1", "token-1")
        assertThat(sessionStore.isPaired()).isTrue()

        // Directly invoke defensive auto-recovery
        val recoveredPrefs = sessionStore.wipeAndRecreatePrefs()
        assertThat(recoveredPrefs).isNotNull()

        // After wipe, credentials are cleared cleanly without crashing
        val freshStore = SecureSessionStore(context)
        assertThat(freshStore.getDeviceToken()).isNull()

        // Able to save new credentials normally
        freshStore.saveSession("dev-2", "space-2", "token-2")
        assertThat(freshStore.isPaired()).isTrue()
        assertThat(freshStore.getDeviceToken()).isEqualTo("token-2")
    }
}
