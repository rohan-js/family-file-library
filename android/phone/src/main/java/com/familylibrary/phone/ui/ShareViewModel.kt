package com.familylibrary.phone.ui

import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.ViewModel

data class SpaceItem(
    val id: String,
    val name: String
)

data class FolderItem(
    val id: String,
    val name: String
)

class ShareViewModel : ViewModel() {

    private val _availableSpaces = MutableLiveData<List<SpaceItem>>(
        listOf(
            SpaceItem("default-space-id", "Family Space")
        )
    )
    val availableSpaces: LiveData<List<SpaceItem>> = _availableSpaces

    private val _availableFolders = MutableLiveData<List<FolderItem>>(
        listOf(
            FolderItem("folder-receipts", "Receipts"),
            FolderItem("folder-medical", "Medical"),
            FolderItem("folder-taxes", "Taxes")
        )
    )
    val availableFolders: LiveData<List<FolderItem>> = _availableFolders

    private val _selectedSpaceId = MutableLiveData<String?>("default-space-id")
    val selectedSpaceId: LiveData<String?> = _selectedSpaceId

    private val _selectedFolderId = MutableLiveData<String?>(null) // null for Inbox / Root
    val selectedFolderId: LiveData<String?> = _selectedFolderId

    fun selectSpace(spaceId: String) {
        _selectedSpaceId.value = spaceId
    }

    fun selectFolder(folderId: String?) {
        _selectedFolderId.value = folderId
    }

    fun setSpaces(spaces: List<SpaceItem>) {
        _availableSpaces.value = spaces
        if (spaces.isNotEmpty() && _selectedSpaceId.value == null) {
            _selectedSpaceId.value = spaces.first().id
        }
    }

    fun setFolders(folders: List<FolderItem>) {
        _availableFolders.value = folders
    }
}
