package com.familylibrary.phone.upload

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.familylibrary.phone.FamilyPhoneApp
import com.familylibrary.phone.util.FileCategoryMapper
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.storage.storage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.io.File
import java.io.IOException
import java.util.UUID

@Serializable
data class FileInsertPayload(
    val id: String,
    @SerialName("space_id") val spaceId: String,
    @SerialName("folder_id") val folderId: String? = null,
    val name: String,
    @SerialName("file_type") val fileType: String,
    @SerialName("file_category") val fileCategory: String,
    @SerialName("size_bytes") val sizeBytes: Long,
    @SerialName("storage_path") val storagePath: String,
    @SerialName("conversion_status") val conversionStatus: String,
    @SerialName("uploader_name") val uploaderName: String = "Family Android Phone"
)

class UploadWorker(
    private val context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    // Allows injection for testing
    var injectedSupabaseClient: SupabaseClient? = null

    private val notificationManager = UploadNotificationManager(context)

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val spaceId = inputData.getString(KEY_SPACE_ID) ?: return@withContext Result.failure()
        val folderId = inputData.getString(KEY_FOLDER_ID)
        val stagingPath = inputData.getString(KEY_STAGING_PATH) ?: return@withContext Result.failure()
        val fileName = inputData.getString(KEY_FILE_NAME) ?: "unnamed_file"
        val mimeType = inputData.getString(KEY_MIME_TYPE) ?: "application/octet-stream"

        val stagedFile = File(stagingPath)
        if (!stagedFile.exists() || stagedFile.length() == 0L) {
            return@withContext Result.failure()
        }

        // Enforce 50MB Supabase bucket limit
        val fileSize = stagedFile.length()
        if (fileSize > MAX_FILE_SIZE_BYTES) {
            notificationManager.showCompletion(fileName, false)
            FileSpooler.cleanupStagedFile(stagingPath)
            return@withContext Result.failure(workDataOf("error" to "File exceeds 50MB limit"))
        }

        val fileId = UUID.randomUUID().toString()
        val storagePath = "$spaceId/original/$fileId/$fileName"

        val supabaseClient = injectedSupabaseClient ?: FamilyPhoneApp.getSupabaseClient(context)

        try {
            try {
                // Foreground notification for Android 14 compliance
                setForeground(notificationManager.createForegroundInfo(fileName, 0, 100))
            } catch (e: Exception) {
                // In headless tests or certain background modes, setForeground may be mocked or throw
            }

            // 1. Upload bytes to Supabase Storage bucket 'family-files'
            val storage = supabaseClient.storage.from("family-files")
            val fileBytes = stagedFile.readBytes()

            storage.upload(
                path = storagePath,
                data = fileBytes,
                upsert = true
            )

            // 2. Resolve category and conversion status
            val category = FileCategoryMapper.resolveCategory(mimeType, fileName)
            val conversionStatus = FileCategoryMapper.resolveConversionStatus(category)

            // 3. Insert metadata record into PostgREST 'files' table
            val insertPayload = FileInsertPayload(
                id = fileId,
                spaceId = spaceId,
                folderId = folderId,
                name = fileName,
                fileType = mimeType,
                fileCategory = category,
                sizeBytes = fileSize,
                storagePath = storagePath,
                conversionStatus = conversionStatus
            )

            supabaseClient.from("files").insert(insertPayload)

            // 4. Cleanup staged file on success
            FileSpooler.cleanupStagedFile(stagingPath)
            notificationManager.showCompletion(fileName, true)

            Result.success(workDataOf(KEY_UPLOADED_FILE_ID to fileId))

        } catch (e: Exception) {
            if (e is IOException && runAttemptCount < MAX_RETRIES) {
                // Transient network failure; trigger WorkManager exponential backoff
                Result.retry()
            } else {
                // Permanent failure or retry exhausted
                FileSpooler.cleanupStagedFile(stagingPath)
                notificationManager.showCompletion(fileName, false)
                Result.failure(workDataOf("error" to (e.message ?: "Upload failed")))
            }
        }
    }

    companion object {
        const val KEY_SPACE_ID = "key_space_id"
        const val KEY_FOLDER_ID = "key_folder_id"
        const val KEY_STAGING_PATH = "key_staging_path"
        const val KEY_FILE_NAME = "key_file_name"
        const val KEY_MIME_TYPE = "key_mime_type"
        const val KEY_UPLOADED_FILE_ID = "key_uploaded_file_id"

        const val MAX_FILE_SIZE_BYTES = 52428800L // 50MB
        const val MAX_RETRIES = 5
    }
}
