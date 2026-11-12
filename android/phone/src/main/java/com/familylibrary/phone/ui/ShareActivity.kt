package com.familylibrary.phone.ui

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.ArrayAdapter
import android.widget.Toast
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.familylibrary.phone.databinding.ActivityShareBinding
import com.familylibrary.phone.upload.FileSpooler
import com.familylibrary.phone.upload.UploadScheduler
import com.familylibrary.phone.util.ContentUriHelper
import com.familylibrary.phone.util.SharedFileItem
import kotlinx.coroutines.launch

class ShareActivity : AppCompatActivity() {

    private lateinit var binding: ActivityShareBinding
    private val viewModel: ShareViewModel by viewModels()
    private var sharedFiles: List<SharedFileItem> = emptyList()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityShareBinding.inflate(layoutInflater)
        setContentView(binding.root)

        handleIncomingIntent(intent)
        setupViews()
        observeViewModel()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIncomingIntent(intent)
    }

    private fun handleIncomingIntent(intent: Intent?) {
        if (intent == null) return
        val uris = ContentUriHelper.parseIncomingUris(intent)
        if (uris.isEmpty()) {
            Toast.makeText(this, "No files found to share", Toast.LENGTH_SHORT).show()
            finish()
            return
        }

        sharedFiles = uris.map { ContentUriHelper.extractMetadata(this, it) }
        displayFileSummary(sharedFiles)
    }

    private fun displayFileSummary(files: List<SharedFileItem>) {
        if (files.size == 1) {
            val item = files.first()
            binding.tvFileTitle.text = item.displayName
            binding.tvFileSubtitle.text = formatFileSize(item.sizeBytes)
        } else {
            binding.tvFileTitle.text = "${files.size} files selected"
            val totalBytes = files.sumOf { if (it.sizeBytes > 0) it.sizeBytes else 0L }
            binding.tvFileSubtitle.text = formatFileSize(totalBytes)
        }
    }

    private fun setupViews() {
        binding.btnCancel.setOnClickListener { finish() }

        binding.btnUpload.setOnClickListener {
            val selectedSpaceId = viewModel.selectedSpaceId.value
            if (selectedSpaceId.isNullOrBlank()) {
                Toast.makeText(this, "Please select a space", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            val selectedFolderId = viewModel.selectedFolderId.value // null for root

            // Spool files into internal staging cache & schedule background WorkManager
            binding.progressBar.visibility = View.VISIBLE
            binding.btnUpload.isEnabled = false

            lifecycleScope.launch {
                try {
                    for (fileItem in sharedFiles) {
                        val stagedFile = FileSpooler.spoolToCache(
                            this@ShareActivity,
                            fileItem.uri,
                            fileItem.displayName
                        )

                        UploadScheduler.scheduleUpload(
                            applicationContext,
                            spaceId = selectedSpaceId,
                            folderId = selectedFolderId,
                            stagingPath = stagedFile.absolutePath,
                            fileName = fileItem.displayName,
                            mimeType = fileItem.mimeType
                        )
                    }

                    Toast.makeText(
                        applicationContext,
                        "Uploading ${sharedFiles.size} item(s) to Family Library",
                        Toast.LENGTH_SHORT
                    ).show()

                    finish()
                } catch (e: Exception) {
                    binding.progressBar.visibility = View.GONE
                    binding.btnUpload.isEnabled = true
                    Toast.makeText(
                        this@ShareActivity,
                        "Failed to prepare upload: ${e.message}",
                        Toast.LENGTH_LONG
                    ).show()
                }
            }
        }
    }

    private fun observeViewModel() {
        viewModel.availableSpaces.observe(this) { spaces ->
            val adapter = ArrayAdapter(this, android.R.layout.simple_dropdown_item_1line, spaces.map { it.name })
            binding.actvSpace.setAdapter(adapter)
            if (spaces.isNotEmpty()) {
                binding.actvSpace.setText(spaces.first().name, false)
                viewModel.selectSpace(spaces.first().id)
            }
        }

        viewModel.availableFolders.observe(this) { folders ->
            val folderNames = listOf("Inbox / Root") + folders.map { it.name }
            val adapter = ArrayAdapter(this, android.R.layout.simple_dropdown_item_1line, folderNames)
            binding.actvFolder.setAdapter(adapter)
            binding.actvFolder.setText("Inbox / Root", false)
            binding.actvFolder.setOnItemClickListener { _, _, position, _ ->
                if (position == 0) {
                    viewModel.selectFolder(null)
                } else {
                    viewModel.selectFolder(folders[position - 1].id)
                }
            }
        }
    }

    private fun formatFileSize(bytes: Long): String {
        if (bytes <= 0) return "Unknown size"
        val kb = bytes / 1024.0
        val mb = kb / 1024.0
        return if (mb >= 1.0) String.format("%.1f MB", mb) else String.format("%.0f KB", kb)
    }
}
