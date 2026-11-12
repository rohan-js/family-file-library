package com.familylibrary.tv.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.familylibrary.core.data.local.entity.BookmarkEntity
import com.familylibrary.core.data.local.entity.FileEntity
import com.familylibrary.tv.FamilyTvApp
import com.familylibrary.tv.auth.PairingScreen
import com.familylibrary.tv.auth.PinLockDialog
import com.familylibrary.tv.home.HomeScreen
import com.familylibrary.tv.theme.FamilyTvTheme
import com.familylibrary.tv.theme.Slate900
import com.familylibrary.tv.tts.TvTtsManager
import com.familylibrary.tv.viewer.ImageViewerScreen
import com.familylibrary.tv.viewer.PdfViewerScreen
import com.familylibrary.tv.viewer.TextViewerScreen
import kotlinx.coroutines.launch
import java.io.File

sealed class TvScreen {
    data object Pairing : TvScreen()
    data object Home : TvScreen()
    data class PdfViewer(val file: FileEntity, val localFile: File) : TvScreen()
    data class ImageViewer(val file: FileEntity, val localFile: File?) : TvScreen()
    data class TextViewer(val file: FileEntity, val localFile: File?) : TvScreen()
}

class MainActivity : ComponentActivity() {

    private lateinit var ttsManager: TvTtsManager

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ttsManager = TvTtsManager(this)

        setContent {
            FamilyTvTheme {
                MainContent(ttsManager = ttsManager)
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        ttsManager.shutdown()
    }
}

@Composable
fun MainContent(ttsManager: TvTtsManager) {
    val app = FamilyTvApp.instance
    val sessionStore = app.sessionStore
    val database = app.database
    val cacheManager = app.cacheManager
    val supabaseWrapper = app.supabaseWrapper
    val coroutineScope = rememberCoroutineScope()

    var currentScreen by remember {
        mutableStateOf<TvScreen>(
            if (sessionStore.isPaired()) TvScreen.Home else TvScreen.Pairing
        )
    }

    var isPinLocked by remember { mutableStateOf(false) }

    fun openFile(file: FileEntity) {
        coroutineScope.launch {
            val localCached = cacheManager.getCachedFile(file.id)
            val isPdf = file.fileType.contains("pdf") || file.name.endsWith(".pdf") || file.name.endsWith(".docx")
            val isImage = file.fileType.startsWith("image/") || file.name.endsWith(".jpg") || file.name.endsWith(".png")

            when {
                isPdf -> {
                    val fileToOpen = localCached ?: createSamplePdfFallback(app, file)
                    currentScreen = TvScreen.PdfViewer(file, fileToOpen)
                }
                isImage -> {
                    currentScreen = TvScreen.ImageViewer(file, localCached)
                }
                else -> {
                    currentScreen = TvScreen.TextViewer(file, localCached)
                }
            }
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Slate900)
    ) {
        when (val screen = currentScreen) {
            is TvScreen.Pairing -> {
                PairingScreen(
                    supabaseWrapper = supabaseWrapper,
                    sessionStore = sessionStore,
                    onPairedSuccess = {
                        coroutineScope.launch {
                            seedSampleDemoFiles(database, "demo-space-id")
                            currentScreen = TvScreen.Home
                        }
                    }
                )
            }
            is TvScreen.Home -> {
                val spaceId = sessionStore.getSpaceId() ?: "default-space"
                HomeScreen(
                    spaceId = spaceId,
                    database = database,
                    supabaseWrapper = supabaseWrapper,
                    onOpenFile = { file -> openFile(file) },
                    onOpenFolder = { /* Navigate to folder view */ },
                    onSettings = {
                        sessionStore.clear()
                        currentScreen = TvScreen.Pairing
                    }
                )

                if (isPinLocked) {
                    PinLockDialog(
                        expectedPinHash = null,
                        spaceId = spaceId,
                        onUnlocked = { isPinLocked = false }
                    )
                }
            }
            is TvScreen.PdfViewer -> {
                PdfViewerScreen(
                    fileEntity = screen.file,
                    localPdfFile = screen.localFile,
                    bookmarkDao = database.bookmarkDao(),
                    ttsManager = ttsManager,
                    onBack = { currentScreen = TvScreen.Home }
                )
            }
            is TvScreen.ImageViewer -> {
                ImageViewerScreen(
                    fileEntity = screen.file,
                    localFile = screen.localFile,
                    onBack = { currentScreen = TvScreen.Home }
                )
            }
            is TvScreen.TextViewer -> {
                TextViewerScreen(
                    fileEntity = screen.file,
                    localFile = screen.localFile,
                    ttsManager = ttsManager,
                    onBack = { currentScreen = TvScreen.Home }
                )
            }
        }
    }
}

/**
 * Creates a minimal valid synthetic PDF file for offline/demo verification if not yet cached.
 */
private fun createSamplePdfFallback(context: android.content.Context, file: FileEntity): File {
    val sampleFile = File(context.cacheDir, "${file.id}.pdf")
    if (!sampleFile.exists()) {
        try {
            val pdfDocument = android.graphics.pdf.PdfDocument()
            val pageInfo = android.graphics.pdf.PdfDocument.PageInfo.Builder(1080, 1920, 1).create()
            val page = pdfDocument.startPage(pageInfo)

            val paint = android.graphics.Paint().apply {
                color = android.graphics.Color.DKGRAY
                textSize = 48f
            }
            page.canvas.drawColor(android.graphics.Color.WHITE)
            page.canvas.drawText(file.name, 100f, 200f, paint)

            paint.textSize = 28f
            paint.color = android.graphics.Color.BLACK
            page.canvas.drawText("Family Library Document Viewer", 100f, 300f, paint)
            page.canvas.drawText("Page 1 of 1", 100f, 400f, paint)

            pdfDocument.finishPage(page)
            sampleFile.outputStream().use { pdfDocument.writeTo(it) }
            pdfDocument.close()
        } catch (_: Exception) {
        }
    }
    return sampleFile
}

/**
 * Seeds sample files into local Room database for interactive Demo / Offline verification.
 */
private suspend fun seedSampleDemoFiles(database: com.familylibrary.core.data.local.AppDatabase, spaceId: String) {
    val fileDao = database.fileDao()
    val bookmarkDao = database.bookmarkDao()

    val sampleFiles = listOf(
        FileEntity(
            id = "demo-pdf-1",
            spaceId = spaceId,
            folderId = null,
            name = "Family_Trip_Kerala.pdf",
            fileType = "application/pdf",
            fileCategory = "pdf",
            sizeBytes = 1048576L,
            storagePath = "demo/kerala.pdf",
            conversionStatus = "ready",
            isFavorite = true,
            lastOpenedAt = System.currentTimeMillis(),
            lastOpenedPage = 1,
            textContent = "കേരളം ദൈവത്തിന്റെ സ്വന്തം നാട്. ചരിത്രവും സംസ്കാരവും നിറഞ്ഞ മനോഹരമായ നാട്. Explore Munnar, Alleppey backwaters, and Kochi heritage."
        ),
        FileEntity(
            id = "demo-pdf-2",
            spaceId = spaceId,
            folderId = null,
            name = "Home_Renovation_Guide.pdf",
            fileType = "application/pdf",
            fileCategory = "pdf",
            sizeBytes = 2097152L,
            storagePath = "demo/renovation.pdf",
            conversionStatus = "ready",
            isFavorite = false,
            textContent = "घर के नवीनीकरण की विस्तृत योजना, सामग्री और बजट विवरण।"
        ),
        FileEntity(
            id = "demo-txt-1",
            spaceId = spaceId,
            folderId = null,
            name = "Grandmas_Secret_Recipe.txt",
            fileType = "text/plain",
            fileCategory = "text",
            sizeBytes = 2048L,
            storagePath = "demo/recipe.txt",
            conversionStatus = "ready",
            isFavorite = true,
            textContent = "# Traditional Kerala Dum Biryani\n\n- 500g Jeerakasala / Basmati Rice\n- Fragrant Spices: Cardamom, Cloves, Star Anise\n- Fresh Ghee and Fried Onions\n\nCook on low flame (dum) for 25 minutes."
        )
    )

    fileDao.upsertFiles(sampleFiles)
    bookmarkDao.upsertBookmark(
        BookmarkEntity(
            id = "demo-bm-1",
            spaceId = spaceId,
            fileId = "demo-pdf-1",
            pageNumber = 1,
            scrollPosition = 0.0f,
            isLastRead = true
        )
    )
}
