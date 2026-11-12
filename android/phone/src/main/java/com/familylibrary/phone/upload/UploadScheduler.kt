package com.familylibrary.phone.upload

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkRequest
import androidx.work.workDataOf
import java.util.UUID
import java.util.concurrent.TimeUnit

object UploadScheduler {

    fun scheduleUpload(
        context: Context,
        spaceId: String,
        folderId: String?,
        stagingPath: String,
        fileName: String,
        mimeType: String
    ): UUID {
        val inputData = workDataOf(
            UploadWorker.KEY_SPACE_ID to spaceId,
            UploadWorker.KEY_FOLDER_ID to folderId,
            UploadWorker.KEY_STAGING_PATH to stagingPath,
            UploadWorker.KEY_FILE_NAME to fileName,
            UploadWorker.KEY_MIME_TYPE to mimeType
        )

        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        val uploadRequest = OneTimeWorkRequestBuilder<UploadWorker>()
            .setConstraints(constraints)
            .setBackoffCriteria(
                BackoffPolicy.EXPONENTIAL,
                WorkRequest.MIN_BACKOFF_MILLIS, // 10s initial delay
                TimeUnit.MILLISECONDS
            )
            .setInputData(inputData)
            .addTag("upload")
            .addTag("space_$spaceId")
            .build()

        WorkManager.getInstance(context).enqueue(uploadRequest)
        return uploadRequest.id
    }
}
