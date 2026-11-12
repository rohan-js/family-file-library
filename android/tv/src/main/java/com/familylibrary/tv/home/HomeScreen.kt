package com.familylibrary.tv.home

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Button
import androidx.tv.material3.ButtonDefaults
import androidx.tv.material3.Card
import androidx.tv.material3.CardDefaults
import androidx.tv.material3.ExperimentalTvMaterial3Api
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import com.familylibrary.core.data.local.AppDatabase
import com.familylibrary.core.data.local.entity.FileEntity
import com.familylibrary.core.data.local.entity.FolderEntity
import com.familylibrary.core.supabase.SupabaseClientWrapper
import com.familylibrary.tv.theme.GreenAccent
import com.familylibrary.tv.theme.NeonCyan
import com.familylibrary.tv.theme.Slate700
import com.familylibrary.tv.theme.Slate800
import com.familylibrary.tv.theme.Slate900
import com.familylibrary.tv.theme.TvCardBackground
import com.familylibrary.tv.theme.TvFocusTokens
import com.familylibrary.tv.theme.TvOverscanPadding
import com.familylibrary.tv.theme.TvTextPrimary
import com.familylibrary.tv.theme.TvTextSecondary
import kotlinx.coroutines.delay

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
fun HomeScreen(
    spaceId: String,
    database: AppDatabase,
    supabaseWrapper: SupabaseClientWrapper,
    onOpenFile: (FileEntity) -> Unit,
    onOpenFolder: (FolderEntity) -> Unit,
    onSettings: () -> Unit
) {
    val fileDao = database.fileDao()
    val folderDao = database.folderDao()

    val continueReadingFiles by fileDao.getContinueReadingFiles(spaceId).collectAsState(initial = emptyList())
    val favoriteFiles by fileDao.getFavoriteFiles(spaceId).collectAsState(initial = emptyList())
    val rootFiles by fileDao.getRootFiles(spaceId).collectAsState(initial = emptyList())
    val folders by folderDao.getRootFolders(spaceId).collectAsState(initial = emptyList())

    var realtimeToastMessage by remember { mutableStateOf<String?>(null) }

    // Realtime "New file arrived" HUD Toast notification
    LaunchedEffect(realtimeToastMessage) {
        if (realtimeToastMessage != null) {
            delay(4000)
            realtimeToastMessage = null
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Slate900)
            .padding(TvOverscanPadding)
    ) {
        Column(modifier = Modifier.fillMaxSize()) {
            // Top Bar with App Title, Search & Settings
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 24.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    Text(
                        text = "Family Library",
                        style = MaterialTheme.typography.displayLarge,
                        color = TvTextPrimary
                    )
                    Text(
                        text = "Browse photos, documents, and media",
                        style = MaterialTheme.typography.bodyMedium,
                        color = TvTextSecondary
                    )
                }

                Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    Button(
                        onClick = onSettings,
                        colors = ButtonDefaults.colors(
                            focusedContainerColor = NeonCyan,
                            containerColor = Slate800
                        ),
                        scale = ButtonDefaults.scale(focusedScale = TvFocusTokens.FocusedScale)
                    ) {
                        Text("⚙ Settings", style = MaterialTheme.typography.labelLarge)
                    }
                }
            }

            // Multi-Shelf Layout with LazyColumn
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                verticalArrangement = Arrangement.spacedBy(32.dp),
                contentPadding = PaddingValues(bottom = 48.dp)
            ) {
                // Shelf 1: Continue Reading
                if (continueReadingFiles.isNotEmpty()) {
                    item {
                        ShelfSection(
                            title = "Continue Reading",
                            files = continueReadingFiles,
                            onFileClick = onOpenFile
                        )
                    }
                }

                // Shelf 2: Favorites
                if (favoriteFiles.isNotEmpty()) {
                    item {
                        ShelfSection(
                            title = "Favorites",
                            files = favoriteFiles,
                            onFileClick = onOpenFile
                        )
                    }
                }

                // Shelf 3: Folders
                if (folders.isNotEmpty()) {
                    item {
                        Column {
                            Text(
                                text = "Folders",
                                style = MaterialTheme.typography.headlineMedium,
                                color = TvTextPrimary,
                                modifier = Modifier.padding(bottom = 12.dp)
                            )
                            LazyRow(
                                horizontalArrangement = Arrangement.spacedBy(16.dp),
                                contentPadding = PaddingValues(horizontal = 4.dp)
                            ) {
                                items(folders) { folder ->
                                    FolderCard(folder = folder, onClick = { onOpenFolder(folder) })
                                }
                            }
                        }
                    }
                }

                // Shelf 4: Inbox (Root Files)
                item {
                    val displayFiles = if (rootFiles.isEmpty()) {
                        // Demo placeholder items when library is initially empty
                        listOf(
                            FileEntity(
                                id = "demo-doc",
                                spaceId = spaceId,
                                name = "Welcome to Family Library.pdf",
                                fileType = "application/pdf",
                                fileCategory = "pdf",
                                sizeBytes = 1024 * 512,
                                storagePath = "demo/welcome.pdf",
                                textContent = "Welcome to your family file library on Android TV! Anyone in your family can upload files from phone or web."
                            ),
                            FileEntity(
                                id = "demo-photo",
                                spaceId = spaceId,
                                name = "Family Vacation.jpg",
                                fileType = "image/jpeg",
                                fileCategory = "image",
                                sizeBytes = 1024 * 1024 * 2,
                                storagePath = "demo/vacation.jpg"
                            )
                        )
                    } else rootFiles

                    ShelfSection(
                        title = "Inbox",
                        files = displayFiles,
                        onFileClick = onOpenFile
                    )
                }
            }
        }

        // Realtime "New file arrived" HUD Toast (F40)
        AnimatedVisibility(
            visible = realtimeToastMessage != null,
            enter = slideInVertically(initialOffsetY = { -it }),
            exit = slideOutVertically(targetOffsetY = { -it }),
            modifier = Modifier.align(Alignment.TopCenter)
        ) {
            Box(
                modifier = Modifier
                    .background(Slate800, RoundedCornerShape(12.dp))
                    .border(2.dp, GreenAccent, RoundedCornerShape(12.dp))
                    .padding(horizontal = 24.dp, vertical = 12.dp)
            ) {
                Text(
                    text = "📥 ${realtimeToastMessage ?: ""}",
                    style = MaterialTheme.typography.titleLarge,
                    color = GreenAccent,
                    fontWeight = FontWeight.Bold
                )
            }
        }
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun ShelfSection(
    title: String,
    files: List<FileEntity>,
    onFileClick: (FileEntity) -> Unit
) {
    Column {
        Text(
            text = title,
            style = MaterialTheme.typography.headlineMedium,
            color = TvTextPrimary,
            modifier = Modifier.padding(bottom = 12.dp)
        )
        LazyRow(
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            contentPadding = PaddingValues(horizontal = 4.dp)
        ) {
            items(files) { file ->
                FileCard(file = file, onClick = { onFileClick(file) })
            }
        }
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun FileCard(
    file: FileEntity,
    onClick: () -> Unit
) {
    Card(
        onClick = onClick,
        modifier = Modifier.size(width = 240.dp, height = 150.dp),
        colors = CardDefaults.colors(
            containerColor = TvCardBackground,
            focusedContainerColor = Slate700
        ),
        scale = CardDefaults.scale(focusedScale = TvFocusTokens.FocusedScale),
        border = CardDefaults.border(focusedBorder = TvFocusTokens.FocusedBorder),
        glow = CardDefaults.glow(focusedGlow = TvFocusTokens.FocusedGlow)
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(16.dp),
            verticalArrangement = Arrangement.SpaceBetween
        ) {
            val iconEmoji = when {
                file.fileType.startsWith("image/") -> "🖼️"
                file.fileType.contains("pdf") -> "📄"
                file.fileType.contains("word") || file.name.endsWith(".docx") -> "📝"
                file.fileType.contains("presentation") || file.name.endsWith(".pptx") -> "📊"
                file.fileType.contains("sheet") || file.name.endsWith(".xlsx") -> "📈"
                else -> "📁"
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(text = iconEmoji, fontSize = 28.sp)
                if (file.isFavorite) {
                    Text(text = "⭐", fontSize = 18.sp)
                }
            }

            Column {
                Text(
                    text = file.name,
                    style = MaterialTheme.typography.bodyLarge,
                    color = TvTextPrimary,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
                Spacer(modifier = Modifier.height(4.dp))
                val sizeStr = "${(file.sizeBytes / (1024 * 1024.0)).coerceAtLeast(0.1).let { "%.1f MB".format(it) }}"
                Text(
                    text = sizeStr,
                    style = MaterialTheme.typography.bodyMedium,
                    color = TvTextSecondary
                )
            }
        }
    }
}

@OptIn(ExperimentalTvMaterial3Api::class)
@Composable
private fun FolderCard(
    folder: FolderEntity,
    onClick: () -> Unit
) {
    Card(
        onClick = onClick,
        modifier = Modifier.size(width = 220.dp, height = 120.dp),
        colors = CardDefaults.colors(
            containerColor = TvCardBackground,
            focusedContainerColor = Slate700
        ),
        scale = CardDefaults.scale(focusedScale = TvFocusTokens.FocusedScale),
        border = CardDefaults.border(focusedBorder = TvFocusTokens.FocusedBorder),
        glow = CardDefaults.glow(focusedGlow = TvFocusTokens.FocusedGlow)
    ) {
        Row(
            modifier = Modifier
                .fillMaxSize()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text(text = "📁", fontSize = 32.sp)
            Text(
                text = folder.name,
                style = MaterialTheme.typography.bodyLarge,
                color = TvTextPrimary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}
