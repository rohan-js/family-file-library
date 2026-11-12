import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import type { FolderRecord, FileRecord } from '../types/library.types';
import { FolderCard } from '../components/folders/FolderCard';
import { FileCard } from '../components/files/FileCard';
import { DropzoneArea } from '../components/uploader/DropzoneArea';
import { CreateFolderModal } from '../components/folders/CreateFolderModal';
import { MoveFolderModal } from '../components/folders/MoveFolderModal';
import { RenameModal } from '../components/common/RenameModal';
import { FolderPlus, Folder, FileText, Search } from 'lucide-react';

export const LibraryView: React.FC = () => {
  const { activeSpace } = useAuth();
  const [folders, setFolders] = useState<FolderRecord[]>([]);
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [allFolders, setAllFolders] = useState<FolderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Modals state
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [moveModalFolder, setMoveModalFolder] = useState<FolderRecord | null>(null);
  const [renameTarget, setRenameTarget] = useState<{
    type: 'folder' | 'file';
    item: FolderRecord | FileRecord;
  } | null>(null);

  const fetchData = useCallback(async () => {
    if (!activeSpace) return;
    setLoading(true);
    try {
      // 1. Fetch root folders + all folders for hierarchy lookups
      const { data: allFoldersData, error: fError } = await supabase
        .from('folders')
        .select('*')
        .eq('space_id', activeSpace.id)
        .is('deleted_at', null)
        .order('name');

      if (fError) throw fError;

      const folderList = allFoldersData || [];
      setAllFolders(folderList);
      setFolders(folderList.filter((f) => f.parent_id === null));

      // 2. Fetch root files (folder_id is null and deleted_at is null)
      const { data: filesData, error: fileError } = await supabase
        .from('files')
        .select('*')
        .eq('space_id', activeSpace.id)
        .is('folder_id', null)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (fileError) throw fileError;
      setFiles(filesData || []);
    } catch (err) {
      console.error('[LibraryView] Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [activeSpace]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Folder CRUD handlers
  const handleCreateFolder = async (folder: {
    name: string;
    color: string;
    icon: string;
    parent_id: string | null;
  }) => {
    if (!activeSpace) return;
    const { error } = await supabase.from('folders').insert({
      space_id: activeSpace.id,
      name: folder.name,
      color: folder.color,
      icon: folder.icon,
      parent_id: folder.parent_id,
    });
    if (error) throw error;
    fetchData();
  };

  const handleMoveFolder = async (sourceFolderId: string, newParentId: string | null) => {
    const { error } = await supabase
      .from('folders')
      .update({ parent_id: newParentId, updated_at: new Date().toISOString() })
      .eq('id', sourceFolderId);

    if (error) throw error;
    fetchData();
  };

  const handleRename = async (newName: string) => {
    if (!renameTarget) return;
    if (renameTarget.type === 'folder') {
      const { error } = await supabase
        .from('folders')
        .update({ name: newName, updated_at: new Date().toISOString() })
        .eq('id', renameTarget.item.id);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('files')
        .update({ name: newName, updated_at: new Date().toISOString() })
        .eq('id', renameTarget.item.id);
      if (error) throw error;
    }
    fetchData();
  };

  const handleDeleteFolder = async (folder: FolderRecord) => {
    if (!window.confirm(`Move folder "${folder.name}" to Trash?`)) return;
    const { error } = await supabase
      .from('folders')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', folder.id);

    if (error) console.error('Soft delete folder failed:', error);
    fetchData();
  };

  const handleDeleteFile = async (file: FileRecord) => {
    if (!window.confirm(`Move "${file.name}" to Trash?`)) return;
    const { error } = await supabase
      .from('files')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', file.id);

    if (error) console.error('Soft delete file failed:', error);
    fetchData();
  };

  const filteredFolders = folders.filter((f) =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const filteredFiles = files.filter((f) =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto text-tv-textLight space-y-8">
      {/* Top Header & Action Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between pb-4 border-b border-tv-border gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center space-x-2">
            <span>Family Library</span>
          </h1>
          <p className="text-sm text-tv-textMuted mt-0.5">
            {activeSpace?.name || 'All Files & Folders'}
          </p>
        </div>

        <div className="flex items-center space-x-3">
          {/* Search Bar */}
          <div className="relative flex-1 sm:w-64">
            <Search className="w-4 h-4 text-tv-textMuted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search library..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-tv-card border border-tv-border rounded-xl pl-9 pr-3.5 py-2 text-xs text-tv-textLight placeholder-tv-textMuted focus:outline-none focus:border-tv-cyan"
            />
          </div>

          <button
            onClick={() => setCreateModalOpen(true)}
            className="flex items-center space-x-2 bg-tv-elevated hover:bg-tv-border text-tv-textLight px-4 py-2 rounded-xl text-xs font-semibold border border-tv-border transition-colors shadow flex-shrink-0"
          >
            <FolderPlus className="w-4 h-4 text-tv-cyan" />
            <span className="hidden sm:inline">New Folder</span>
          </button>
        </div>
      </div>

      {/* Embedded Drag & Drop Zone */}
      <DropzoneArea targetFolderId={null} />

      {/* Folders Section */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold flex items-center space-x-2">
            <Folder className="w-4 h-4 text-tv-cyan" />
            <span>Folders</span>
            <span className="text-xs text-tv-textMuted font-normal">({filteredFolders.length})</span>
          </h2>
        </div>

        {loading ? (
          <div className="text-sm text-tv-textMuted py-8 text-center">Loading folders...</div>
        ) : filteredFolders.length === 0 ? (
          <div className="text-xs text-tv-textMuted p-6 bg-tv-card/40 border border-tv-border/50 rounded-2xl text-center">
            No root folders yet. Click &ldquo;New Folder&rdquo; above to organize your files.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {filteredFolders.map((folder) => (
              <FolderCard
                key={folder.id}
                folder={folder}
                onRename={(f) => setRenameTarget({ type: 'folder', item: f })}
                onMove={(f) => setMoveModalFolder(f)}
                onDelete={handleDeleteFolder}
              />
            ))}
          </div>
        )}
      </section>

      {/* Files Section (Root Inbox) */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold flex items-center space-x-2">
            <FileText className="w-4 h-4 text-tv-blue" />
            <span>Files (Root Inbox)</span>
            <span className="text-xs text-tv-textMuted font-normal">({filteredFiles.length})</span>
          </h2>
        </div>

        {loading ? (
          <div className="text-sm text-tv-textMuted py-8 text-center">Loading files...</div>
        ) : filteredFiles.length === 0 ? (
          <div className="text-xs text-tv-textMuted p-6 bg-tv-card/40 border border-tv-border/50 rounded-2xl text-center">
            No files in root inbox. Drop files above or share from mobile apps.
          </div>
        ) : (
          <div className="space-y-2.5">
            {filteredFiles.map((file) => (
              <FileCard
                key={file.id}
                file={file}
                onRename={(f) => setRenameTarget({ type: 'file', item: f })}
                onDelete={handleDeleteFile}
              />
            ))}
          </div>
        )}
      </section>

      {/* Modals */}
      <CreateFolderModal
        isOpen={createModalOpen}
        parentId={null}
        onClose={() => setCreateModalOpen(false)}
        onSubmit={handleCreateFolder}
      />

      {moveModalFolder && (
        <MoveFolderModal
          isOpen={Boolean(moveModalFolder)}
          folderToMove={moveModalFolder}
          allFolders={allFolders}
          onClose={() => setMoveModalFolder(null)}
          onMove={handleMoveFolder}
        />
      )}

      {renameTarget && (
        <RenameModal
          isOpen={Boolean(renameTarget)}
          initialName={renameTarget.item.name}
          itemType={renameTarget.type}
          onClose={() => setRenameTarget(null)}
          onSubmit={handleRename}
        />
      )}
    </div>
  );
};
