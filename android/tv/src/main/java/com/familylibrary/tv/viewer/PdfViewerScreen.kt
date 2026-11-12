package com.familylibrary.tv.viewer

import android.graphics.Bitmap
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Button
import androidx.tv.material3.ButtonDefaults
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import com.familylibrary.core.data.local.dao.BookmarkDao
import com.familylibrary.core.data.local.entity.BookmarkEntity
import com.familylibrary.core.data.local.entity.FileEntity
import com.familylibrary.tv.theme.NeonCyan
import com.familylibrary.tv.theme.Slate800
import com.familylibrary.tv.theme.Slate900
import com.familylibrary.tv.theme.TvFocusTokens
import com.familylibrary.tv.theme.TvTextPrimary
import com.familylibrary.tv.theme.TvTextSecondary
import com.familylibrary.tv.tts.TtsAvailability
import com.familylibrary.tv.tts.TvTtsManager
import kotlinx.coroutines.launch
import java.io.File
import java.util.UUID

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun PdfViewerScreen(
    fileEntity: FileEntity,
    localPdfFile: File,
    initialPage: Int = 1,
    bookmarkDao: BookmarkDao,
    ttsManager: TvTtsManager,
    onBack: () -> Unit
) {
    val coroutineScope = rememberCoroutineScope()
    val pdfRenderer = remember(localPdfFile) { SafeTvPdfRenderer(localPdfFile) }
    val pageCount = pdfRenderer.pageCount

    var currentPage by remember { mutableIntStateOf(initialPage.coerceIn(1, maxOf(1, pageCount))) }
    var currentBitmap by remember { mutableStateOf<Bitmap?>(null) }
    var showToolbar by remember { mutableStateOf(false) }

    val ttsAvailability by ttsManager.availability.collectAsState()
    val isSpeaking by ttsManager.isSpeaking.collectAsState()

    val focusRequester = remember { FocusRequester() }

    // Render current page when page index changes
    LaunchedEffect(currentPage) {
        val bitmap = pdfRenderer.renderPage(currentPage - 1)
        currentBitmap = bitmap

        // Persist reading progress
        coroutineScope.launch {
            bookmarkDao.setLastReadBookmark(
                BookmarkEntity(
                    id = UUID.randomUUID().toString(),
                    spaceId = fileEntity.spaceId,
                    fileId = fileEntity.id,
                    pageNumber = currentPage,
                    scrollPosition = 0.0f,
                    isLastRead = true,
                    updatedAt = System.currentTimeMillis()
                )
            )
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            ttsManager.stop()
            pdfRenderer.close()
        }
    }

    // D-Pad remote control handler
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Slate900)
            .focusRequester(focusRequester)
            .focusable()
            .onPreviewKeyEvent { event ->
                if (event.type == KeyEventType.KeyDown) {
                    when (event.key) {
                        Key.DirectionLeft -> {
                            if (currentPage > 1) {
                                currentPage--
                                true
                            } else false
                        }
                        Key.DirectionRight -> {
                            if (currentPage < pageCount) {
                                currentPage++
                                true
                            } else false
                        }
                        Key.DirectionCenter, Key.Enter -> {
                            showToolbar = !showToolbar
                            true
                        }
                        Key.MediaPlayPause -> {
                            if (isSpeaking) {
                                ttsManager.stop()
                            } else {
                                fileEntity.textContent?.let { ttsManager.speak(it) }
                            }
                            true
                        }
                        Key.Back -> {
                            if (showToolbar) {
                                showToolbar = false
                                true
                            } else {
                                onBack()
                                true
                            }
                        }
                        else -> false
                    }
                } else false
            },
        contentAlignment = Alignment.Center
    ) {
        LaunchedEffect(Unit) {
            focusRequester.requestFocus()
        }

        // Rendered PDF Page Bitmap
        if (currentBitmap != null && !currentBitmap!!.isRecycled) {
            Image(
                bitmap = currentBitmap!!.asImageBitmap(),
                contentDescription = "PDF Page $currentPage of $pageCount",
                modifier = Modifier.fillMaxSize()
            )
        } else {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    text = "Loading page $currentPage...",
                    style = MaterialTheme.typography.bodyLarge,
                    color = TvTextSecondary
                )
            }
        }

        // Floating HUD Toolbar Overlay (toggled with Remote OK / Center)
        AnimatedVisibility(
            visible = showToolbar,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier.align(Alignment.BottomCenter)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Slate800.copy(alpha = 0.95f))
                    .border(1.dp, NeonCyan, RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp))
                    .padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text(
                    text = fileEntity.name,
                    style = MaterialTheme.typography.titleLarge,
                    color = TvTextPrimary
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = "Page $currentPage of $pageCount",
                    style = MaterialTheme.typography.bodyMedium,
                    color = NeonCyan
                )

                Spacer(modifier = Modifier.height(16.dp))

                Row(
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Button(
                        onClick = { if (currentPage > 1) currentPage-- },
                        enabled = currentPage > 1,
                        colors = ButtonDefaults.colors(
                            focusedContainerColor = NeonCyan,
                            containerColor = Slate900
                        ),
                        scale = ButtonDefaults.scale(focusedScale = TvFocusTokens.FocusedScale)
                    ) {
                        Text("◀ Previous", style = MaterialTheme.typography.labelLarge)
                    }

                    Button(
                        onClick = { if (currentPage < pageCount) currentPage++ },
                        enabled = currentPage < pageCount,
                        colors = ButtonDefaults.colors(
                            focusedContainerColor = NeonCyan,
                            containerColor = Slate900
                        ),
                        scale = ButtonDefaults.scale(focusedScale = TvFocusTokens.FocusedScale)
                    ) {
                        Text("Next ▶", style = MaterialTheme.typography.labelLarge)
                    }

                    // Text-To-Speech Read Aloud Button
                    val textContent = fileEntity.textContent
                    if (ttsAvailability is TtsAvailability.Ready && !textContent.isNullOrBlank()) {
                        Button(
                            onClick = {
                                if (isSpeaking) {
                                    ttsManager.stop()
                                } else {
                                    ttsManager.speak(textContent)
                                }
                            },
                            colors = ButtonDefaults.colors(
                                focusedContainerColor = NeonCyan,
                                containerColor = Slate900
                            ),
                            scale = ButtonDefaults.scale(focusedScale = TvFocusTokens.FocusedScale)
                        ) {
                            Text(
                                if (isSpeaking) "⏹ Stop Reading" else "🔊 Read Aloud",
                                style = MaterialTheme.typography.labelLarge
                            )
                        }
                    }

                    Button(
                        onClick = onBack,
                        colors = ButtonDefaults.colors(
                            focusedContainerColor = NeonCyan,
                            containerColor = Slate900
                        ),
                        scale = ButtonDefaults.scale(focusedScale = TvFocusTokens.FocusedScale)
                    ) {
                        Text("Close", style = MaterialTheme.typography.labelLarge)
                    }
                }
            }
        }
    }
}
