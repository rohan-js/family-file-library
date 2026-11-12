package com.familylibrary.tv.viewer

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.tv.material3.Button
import androidx.tv.material3.ButtonDefaults
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.familylibrary.core.data.local.entity.FileEntity
import com.familylibrary.tv.theme.NeonCyan
import com.familylibrary.tv.theme.Slate800
import com.familylibrary.tv.theme.Slate900
import com.familylibrary.tv.theme.TvFocusTokens
import com.familylibrary.tv.theme.TvTextPrimary
import com.familylibrary.tv.theme.TvTextSecondary
import kotlinx.coroutines.delay
import java.io.File

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun ImageViewerScreen(
    fileEntity: FileEntity,
    imageFiles: List<FileEntity> = listOf(fileEntity),
    localFile: File? = null,
    onBack: () -> Unit
) {
    val context = LocalContext.current
    var currentIndex by remember { mutableIntStateOf(imageFiles.indexOfFirst { it.id == fileEntity.id }.coerceAtLeast(0)) }
    val currentFile = imageFiles.getOrElse(currentIndex) { fileEntity }

    var rotationAngle by remember { mutableFloatStateOf(0f) }
    var zoomScale by remember { mutableFloatStateOf(1f) }
    var isSlideshowActive by remember { mutableStateOf(false) }
    var showOverlay by remember { mutableStateOf(false) }

    val focusRequester = remember { FocusRequester() }

    // Automatic 5-second interval slideshow
    LaunchedEffect(isSlideshowActive, currentIndex) {
        if (isSlideshowActive && imageFiles.size > 1) {
            delay(5000)
            currentIndex = (currentIndex + 1) % imageFiles.size
            rotationAngle = 0f
            zoomScale = 1f
        }
    }

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
                            if (currentIndex > 0) {
                                currentIndex--
                                rotationAngle = 0f
                                zoomScale = 1f
                                true
                            } else false
                        }
                        Key.DirectionRight -> {
                            if (currentIndex < imageFiles.size - 1) {
                                currentIndex++
                                rotationAngle = 0f
                                zoomScale = 1f
                                true
                            } else false
                        }
                        Key.DirectionCenter, Key.Enter -> {
                            showOverlay = !showOverlay
                            true
                        }
                        Key.MediaPlayPause -> {
                            isSlideshowActive = !isSlideshowActive
                            true
                        }
                        Key.Back -> {
                            if (showOverlay) {
                                showOverlay = false
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

        // Memory-Tuned Async Image Render via Coil
        val imageModel = remember(currentFile.id, localFile) {
            localFile ?: currentFile.storagePath
        }

        AsyncImage(
            model = ImageRequest.Builder(context)
                .data(imageModel)
                .crossfade(300)
                .build(),
            contentDescription = currentFile.name,
            contentScale = ContentScale.Fit,
            modifier = Modifier
                .fillMaxSize()
                .graphicsLayer {
                    rotationZ = rotationAngle
                    scaleX = zoomScale
                    scaleY = zoomScale
                }
        )

        // Slideshow Status HUD indicator
        if (isSlideshowActive) {
            Box(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(48.dp)
                    .background(Slate800.copy(alpha = 0.85f), RoundedCornerShape(8.dp))
                    .padding(horizontal = 16.dp, vertical = 8.dp)
            ) {
                Text(
                    text = "▶ Slideshow (${currentIndex + 1}/${imageFiles.size})",
                    style = MaterialTheme.typography.bodyMedium,
                    color = NeonCyan
                )
            }
        }

        // Bottom Controls HUD Overlay
        AnimatedVisibility(
            visible = showOverlay,
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
                    text = currentFile.name,
                    style = MaterialTheme.typography.titleLarge,
                    color = TvTextPrimary
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = "Image ${currentIndex + 1} of ${imageFiles.size} • Rotation: ${rotationAngle.toInt()}° • Zoom: ${"%.1f".format(zoomScale)}x",
                    style = MaterialTheme.typography.bodyMedium,
                    color = TvTextSecondary
                )
                Spacer(modifier = Modifier.height(16.dp))

                Row(
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Button(
                        onClick = { rotationAngle = (rotationAngle + 90f) % 360f },
                        colors = ButtonDefaults.colors(focusedContainerColor = NeonCyan, containerColor = Slate900),
                        scale = ButtonDefaults.scale(focusedScale = TvFocusTokens.FocusedScale)
                    ) {
                        Text("⟳ Rotate", style = MaterialTheme.typography.labelLarge)
                    }

                    Button(
                        onClick = { zoomScale = if (zoomScale >= 2.0f) 1.0f else zoomScale + 0.5f },
                        colors = ButtonDefaults.colors(focusedContainerColor = NeonCyan, containerColor = Slate900),
                        scale = ButtonDefaults.scale(focusedScale = TvFocusTokens.FocusedScale)
                    ) {
                        Text("🔍 Zoom", style = MaterialTheme.typography.labelLarge)
                    }

                    Button(
                        onClick = { isSlideshowActive = !isSlideshowActive },
                        colors = ButtonDefaults.colors(focusedContainerColor = NeonCyan, containerColor = Slate900),
                        scale = ButtonDefaults.scale(focusedScale = TvFocusTokens.FocusedScale)
                    ) {
                        Text(
                            if (isSlideshowActive) "⏸ Pause Slideshow" else "▶ Slideshow",
                            style = MaterialTheme.typography.labelLarge
                        )
                    }

                    Button(
                        onClick = onBack,
                        colors = ButtonDefaults.colors(focusedContainerColor = NeonCyan, containerColor = Slate900),
                        scale = ButtonDefaults.scale(focusedScale = TvFocusTokens.FocusedScale)
                    ) {
                        Text("Close", style = MaterialTheme.typography.labelLarge)
                    }
                }
            }
        }
    }
}
