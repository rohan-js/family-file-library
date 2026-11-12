package com.familylibrary.tv.viewer

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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Button
import androidx.tv.material3.ButtonDefaults
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import com.familylibrary.core.data.local.entity.FileEntity
import com.familylibrary.tv.theme.NeonCyan
import com.familylibrary.tv.theme.Slate800
import com.familylibrary.tv.theme.Slate900
import com.familylibrary.tv.theme.TvFocusTokens
import com.familylibrary.tv.theme.TvOverscanPadding
import com.familylibrary.tv.theme.TvTextPrimary
import com.familylibrary.tv.tts.TtsAvailability
import com.familylibrary.tv.tts.TvTtsManager
import kotlinx.coroutines.launch
import java.io.File

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun TextViewerScreen(
    fileEntity: FileEntity,
    localFile: File? = null,
    ttsManager: TvTtsManager,
    onBack: () -> Unit
) {
    val scrollState = rememberScrollState()
    val coroutineScope = rememberCoroutineScope()
    val focusRequester = remember { FocusRequester() }

    val contentText = remember(fileEntity, localFile) {
        if (localFile != null && localFile.exists()) {
            try {
                localFile.readText(Charsets.UTF_8)
            } catch (_: Exception) {
                fileEntity.textContent ?: "Failed to read file content."
            }
        } else {
            fileEntity.textContent ?: "No text preview available."
        }
    }

    val ttsAvailability by ttsManager.availability.collectAsState()
    val isSpeaking by ttsManager.isSpeaking.collectAsState()

    DisposableEffect(Unit) {
        onDispose {
            ttsManager.stop()
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Slate900)
            .padding(TvOverscanPadding)
            .focusRequester(focusRequester)
            .focusable()
            .onPreviewKeyEvent { event ->
                if (event.type == KeyEventType.KeyDown) {
                    when (event.key) {
                        Key.DirectionUp -> {
                            coroutineScope.launch {
                                scrollState.animateScrollTo((scrollState.value - 200).coerceAtLeast(0))
                            }
                            true
                        }
                        Key.DirectionDown -> {
                            coroutineScope.launch {
                                scrollState.animateScrollTo((scrollState.value + 200).coerceAtMost(scrollState.maxValue))
                            }
                            true
                        }
                        Key.MediaPlayPause -> {
                            if (isSpeaking) {
                                ttsManager.stop()
                            } else {
                                ttsManager.speak(contentText)
                            }
                            true
                        }
                        Key.Back -> {
                            onBack()
                            true
                        }
                        else -> false
                    }
                } else false
            }
    ) {
        Column(modifier = Modifier.fillMaxSize()) {
            // Header Bar
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Slate800, RoundedCornerShape(12.dp))
                    .padding(horizontal = 24.dp, vertical = 16.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = fileEntity.name,
                    style = MaterialTheme.typography.titleLarge,
                    color = TvTextPrimary
                )

                Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    if (ttsAvailability is TtsAvailability.Ready) {
                        Button(
                            onClick = {
                                if (isSpeaking) ttsManager.stop() else ttsManager.speak(contentText)
                            },
                            colors = ButtonDefaults.colors(focusedContainerColor = NeonCyan, containerColor = Slate900),
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
                        colors = ButtonDefaults.colors(focusedContainerColor = NeonCyan, containerColor = Slate900),
                        scale = ButtonDefaults.scale(focusedScale = TvFocusTokens.FocusedScale)
                    ) {
                        Text("Back", style = MaterialTheme.typography.labelLarge)
                    }
                }
            }

            Spacer(modifier = Modifier.height(20.dp))

            // Scrollable 28sp Content View
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Slate800.copy(alpha = 0.5f), RoundedCornerShape(16.dp))
                    .border(1.dp, Slate800, RoundedCornerShape(16.dp))
                    .padding(32.dp)
                    .verticalScroll(scrollState)
            ) {
                Text(
                    text = contentText,
                    fontSize = 28.sp,
                    lineHeight = 40.sp,
                    color = TvTextPrimary
                )
            }
        }
    }
}
