package com.familylibrary.core.data.local

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.familylibrary.core.data.local.dao.BookmarkDao
import com.familylibrary.core.data.local.dao.FileDao
import com.familylibrary.core.data.local.dao.FolderDao
import com.familylibrary.core.data.local.entity.BookmarkEntity
import com.familylibrary.core.data.local.entity.FileEntity
import com.familylibrary.core.data.local.entity.FolderEntity
import com.familylibrary.core.util.FtsQuerySanitizer
import com.google.common.truth.Truth.assertThat
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.IOException
import java.util.UUID

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class RoomDatabaseFtsTest {

    private lateinit var db: FamilyLibraryDatabase
    private lateinit var fileDao: FileDao
    private lateinit var folderDao: FolderDao
    private lateinit var bookmarkDao: BookmarkDao

    private val testSpaceId = "space-" + UUID.randomUUID().toString()

    @Before
    fun createDb() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        db = Room.inMemoryDatabaseBuilder(context, FamilyLibraryDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        fileDao = db.fileDao()
        folderDao = db.folderDao()
        bookmarkDao = db.bookmarkDao()
    }

    @After
    @Throws(IOException::class)
    fun closeDb() {
        db.close()
    }

    @Test
    fun testInsertAndQueryFilesByFolder() = runBlocking {
        val folder = FolderEntity(
            id = "folder-1",
            spaceId = testSpaceId,
            name = "Tax Documents"
        )
        folderDao.upsertFolder(folder)

        val file1 = FileEntity(
            id = "file-1",
            spaceId = testSpaceId,
            folderId = "folder-1",
            name = "2025_w2.pdf",
            fileType = "application/pdf",
            fileCategory = "pdf",
            sizeBytes = 1024L,
            storagePath = "$testSpaceId/original/file-1/2025_w2.pdf",
            textContent = "Annual wage and tax statement 2025"
        )
        val file2 = FileEntity(
            id = "file-2",
            spaceId = testSpaceId,
            folderId = "folder-1",
            name = "2025_1099.pdf",
            fileType = "application/pdf",
            fileCategory = "pdf",
            sizeBytes = 2048L,
            storagePath = "$testSpaceId/original/file-2/2025_1099.pdf",
            textContent = "Miscellaneous income tax statement"
        )
        fileDao.upsertFiles(listOf(file1, file2))

        val retrievedFiles = fileDao.getFilesByFolder(testSpaceId, "folder-1").first()
        assertThat(retrievedFiles).hasSize(2)
        assertThat(retrievedFiles.map { it.id }).containsExactly("file-2", "file-1").inOrder()
    }

    @Test
    fun testFts4SearchOnFileName() = runBlocking {
        val file1 = FileEntity(
            id = "file-tax",
            spaceId = testSpaceId,
            name = "Property_Tax_Receipt.pdf",
            fileType = "application/pdf",
            fileCategory = "pdf",
            sizeBytes = 4096L,
            storagePath = "$testSpaceId/original/file-tax/receipt.pdf",
            textContent = "Paid in full for fiscal year 2024"
        )
        val file2 = FileEntity(
            id = "file-other",
            spaceId = testSpaceId,
            name = "Vacation_Itinerary.pdf",
            fileType = "application/pdf",
            fileCategory = "pdf",
            sizeBytes = 512L,
            storagePath = "$testSpaceId/original/file-other/vacation.pdf",
            textContent = "Flight details to Kerala"
        )
        fileDao.upsertFiles(listOf(file1, file2))

        val query = FtsQuerySanitizer.sanitize("Property")
        val searchResults = fileDao.searchFilesFts(query).first()
        assertThat(searchResults).hasSize(1)
        assertThat(searchResults.first().id).isEqualTo("file-tax")
    }

    @Test
    fun testFts4SearchOnExtractedText() = runBlocking {
        val file1 = FileEntity(
            id = "file-inv",
            spaceId = testSpaceId,
            name = "Receipt_001.pdf",
            fileType = "application/pdf",
            fileCategory = "pdf",
            sizeBytes = 1000L,
            storagePath = "$testSpaceId/receipt.pdf",
            textContent = "Invoice billing information for electronic appliance"
        )
        val file2 = FileEntity(
            id = "file-manual",
            spaceId = testSpaceId,
            name = "UserManual.pdf",
            fileType = "application/pdf",
            fileCategory = "pdf",
            sizeBytes = 5000L,
            storagePath = "$testSpaceId/manual.pdf",
            textContent = "How to configure your Android TV remote control"
        )
        fileDao.upsertFiles(listOf(file1, file2))

        val query = FtsQuerySanitizer.sanitize("appliance")
        val searchResults = fileDao.searchFilesFts(query).first()
        assertThat(searchResults).hasSize(1)
        assertThat(searchResults.first().id).isEqualTo("file-inv")
    }

    @Test
    fun testFts4SearchSpecialCharactersSanitization() = runBlocking {
        val file = FileEntity(
            id = "file-special",
            spaceId = testSpaceId,
            name = "Medical_Report_2026.pdf",
            fileType = "application/pdf",
            fileCategory = "pdf",
            sizeBytes = 2000L,
            storagePath = "$testSpaceId/medical.pdf",
            textContent = "Complete blood count and lipid profile"
        )
        fileDao.upsertFile(file)

        // Raw input with dangerous punctuation characters that break SQLite FTS syntax
        val dangerousInput = "\"Medical:*(Report)\"^~"
        val cleanQuery = FtsQuerySanitizer.sanitize(dangerousInput)
        assertThat(cleanQuery).isEqualTo("Medical* Report*")

        val searchResults = fileDao.searchFilesFts(cleanQuery).first()
        assertThat(searchResults).hasSize(1)
        assertThat(searchResults.first().id).isEqualTo("file-special")
    }

    @Test
    fun testContinueReadingQuery() = runBlocking {
        val now = System.currentTimeMillis()
        val file1 = FileEntity(
            id = "f-1",
            spaceId = testSpaceId,
            name = "Book1.pdf",
            fileType = "application/pdf",
            sizeBytes = 100L,
            storagePath = "p1",
            lastOpenedAt = now - 10000L,
            lastOpenedPage = 12
        )
        val file2 = FileEntity(
            id = "f-2",
            spaceId = testSpaceId,
            name = "Book2.pdf",
            fileType = "application/pdf",
            sizeBytes = 100L,
            storagePath = "p2",
            lastOpenedAt = now - 1000L,
            lastOpenedPage = 5
        )
        val file3 = FileEntity(
            id = "f-3",
            spaceId = testSpaceId,
            name = "Unopened.pdf",
            fileType = "application/pdf",
            sizeBytes = 100L,
            storagePath = "p3",
            lastOpenedAt = null
        )
        fileDao.upsertFiles(listOf(file1, file2, file3))

        val continueList = fileDao.getContinueReadingFiles(testSpaceId).first()
        assertThat(continueList).hasSize(2)
        // file2 was opened more recently than file1
        assertThat(continueList.map { it.id }).containsExactly("f-2", "f-1").inOrder()
    }

    @Test
    fun testFavoritesQuery() = runBlocking {
        val file1 = FileEntity(
            id = "fav-1",
            spaceId = testSpaceId,
            name = "A_Fav.pdf",
            fileType = "application/pdf",
            sizeBytes = 100L,
            storagePath = "fav1",
            isFavorite = true
        )
        val file2 = FileEntity(
            id = "non-fav",
            spaceId = testSpaceId,
            name = "B_Regular.pdf",
            fileType = "application/pdf",
            sizeBytes = 100L,
            storagePath = "reg1",
            isFavorite = false
        )
        fileDao.upsertFiles(listOf(file1, file2))

        val favorites = fileDao.getFavoriteFiles(testSpaceId).first()
        assertThat(favorites).hasSize(1)
        assertThat(favorites.first().id).isEqualTo("fav-1")
    }

    @Test
    fun testSoftDeleteExclusion() = runBlocking {
        val file = FileEntity(
            id = "del-1",
            spaceId = testSpaceId,
            name = "Deleted.pdf",
            fileType = "application/pdf",
            sizeBytes = 100L,
            storagePath = "del",
            deletedAt = System.currentTimeMillis()
        )
        fileDao.upsertFile(file)

        val activeFiles = fileDao.getAllActiveFiles(testSpaceId).first()
        assertThat(activeFiles).isEmpty()

        val trashFiles = fileDao.getTrashFiles().first()
        assertThat(trashFiles).hasSize(1)
        assertThat(trashFiles.first().id).isEqualTo("del-1")
    }

    @Test
    fun testBookmarkOperations() = runBlocking {
        val file = FileEntity(
            id = "book-file",
            spaceId = testSpaceId,
            name = "Novel.pdf",
            fileType = "application/pdf",
            sizeBytes = 500L,
            storagePath = "novel"
        )
        fileDao.upsertFile(file)

        val bookmark1 = BookmarkEntity(
            id = "bm-1",
            spaceId = testSpaceId,
            fileId = "book-file",
            pageNumber = 10,
            label = "Chapter 2",
            isLastRead = true
        )
        bookmarkDao.setLastReadBookmark(bookmark1)

        val lastRead = bookmarkDao.getLastReadBookmark("book-file", null).first()
        assertThat(lastRead).isNotNull()
        assertThat(lastRead?.pageNumber).isEqualTo(10)

        // Now advance page to 25
        val bookmark2 = BookmarkEntity(
            id = "bm-2",
            spaceId = testSpaceId,
            fileId = "book-file",
            pageNumber = 25,
            label = "Chapter 4",
            isLastRead = true
        )
        bookmarkDao.setLastReadBookmark(bookmark2)

        val updatedLastRead = bookmarkDao.getLastReadBookmark("book-file", null).first()
        assertThat(updatedLastRead?.pageNumber).isEqualTo(25)
        assertThat(updatedLastRead?.id).isEqualTo("bm-2")

        // Prior bookmark should have is_last_read = false
        val allBookmarks = bookmarkDao.getBookmarksForFile("book-file").first()
        assertThat(allBookmarks).hasSize(2)
        val oldBm = allBookmarks.find { it.id == "bm-1" }
        assertThat(oldBm?.isLastRead).isFalse()
    }
}
