package com.familylibrary.tv

import android.app.Application
import androidx.room.Room
import com.familylibrary.core.cache.TvCacheManager
import com.familylibrary.core.data.local.AppDatabase
import com.familylibrary.core.data.local.FamilyLibraryDatabase
import com.familylibrary.core.security.SecureSessionStore
import com.familylibrary.core.supabase.SupabaseClientWrapper

class FamilyTvApp : Application() {

    lateinit var database: AppDatabase
        private set

    lateinit var sessionStore: SecureSessionStore
        private set

    lateinit var cacheManager: TvCacheManager
        private set

    lateinit var supabaseWrapper: SupabaseClientWrapper
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this

        sessionStore = SecureSessionStore(this)

        database = Room.databaseBuilder(
            applicationContext,
            FamilyLibraryDatabase::class.java,
            FamilyLibraryDatabase.DATABASE_NAME
        ).fallbackToDestructiveMigration().build()

        cacheManager = TvCacheManager(
            context = applicationContext,
            cacheDao = database.cacheDao(),
            fileDao = database.fileDao(),
            maxCacheSizeBytes = 500L * 1024 * 1024 // 500 MB LRU limit
        )

        // Supabase cloud production configuration
        val supabaseUrl = "https://qcpambyzkgygxdbguqer.supabase.co"
        val supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFjcGFtYnl6a2d5Z3hkYmd1cWVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ0NzY0ODcsImV4cCI6MjExMDA1MjQ4N30.jq7z-gpu93-9vKGX4IH_O-AynkXy8HsJuDU-W94LUls"
        supabaseWrapper = SupabaseClientWrapper(
            supabaseUrl = supabaseUrl,
            supabaseAnonKey = supabaseAnonKey,
            sessionStore = sessionStore
        )
    }

    companion object {
        lateinit var instance: FamilyTvApp
            private set
    }
}
