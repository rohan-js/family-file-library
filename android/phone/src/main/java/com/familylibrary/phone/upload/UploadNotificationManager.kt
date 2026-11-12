package com.familylibrary.phone.upload

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.ForegroundInfo

class UploadNotificationManager(private val context: Context) {

    private val notificationManager =
        context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    init {
        createChannel()
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Family Library Uploads",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shows progress of background file uploads to Family Library"
            }
            notificationManager.createNotificationChannel(channel)
        }
    }

    fun createForegroundInfo(fileName: String, progress: Int, max: Int = 100): ForegroundInfo {
        val notification: Notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle("Uploading to Family Library")
            .setContentText(fileName)
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setOngoing(true)
            .setProgress(max, progress, progress == 0)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

        return ForegroundInfo(NOTIFICATION_ID, notification)
    }

    fun showCompletion(fileName: String, success: Boolean) {
        val notification: Notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle(if (success) "Upload Complete" else "Upload Failed")
            .setContentText(fileName)
            .setSmallIcon(if (success) android.R.drawable.stat_sys_upload_done else android.R.drawable.stat_notify_error)
            .setAutoCancel(true)
            .build()

        notificationManager.notify(fileName.hashCode(), notification)
    }

    companion object {
        const val CHANNEL_ID = "family_library_upload_channel"
        const val NOTIFICATION_ID = 1001
    }
}
