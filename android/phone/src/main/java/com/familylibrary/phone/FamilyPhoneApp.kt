package com.familylibrary.phone

import android.app.Application
import android.content.Context
import com.familylibrary.core.security.SecureSessionStore
import com.familylibrary.core.supabase.SupabaseClientWrapper
import io.github.jan.supabase.SupabaseClient

class FamilyPhoneApp : Application() {

    lateinit var sessionStore: SecureSessionStore
        private set

    lateinit var supabaseClientWrapper: SupabaseClientWrapper
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this
        sessionStore = SecureSessionStore(this)
        // Default or configured Supabase credentials
        supabaseClientWrapper = SupabaseClientWrapper(
            supabaseUrl = DEFAULT_SUPABASE_URL,
            supabaseAnonKey = DEFAULT_SUPABASE_ANON_KEY,
            sessionStore = sessionStore
        )
    }

    companion object {
        lateinit var instance: FamilyPhoneApp
            private set

        const val DEFAULT_SUPABASE_URL = "https://placeholder-project.supabase.co"
        const val DEFAULT_SUPABASE_ANON_KEY = "placeholder-anon-key"

        fun getSupabaseClient(context: Context): SupabaseClient {
            val app = context.applicationContext as? FamilyPhoneApp
            return app?.supabaseClientWrapper?.client
                ?: SupabaseClientWrapper(
                    DEFAULT_SUPABASE_URL,
                    DEFAULT_SUPABASE_ANON_KEY,
                    SecureSessionStore(context)
                ).client
        }
    }
}
