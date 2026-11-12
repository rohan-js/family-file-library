import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import type { FolderRecord, FileRecord } from '../types/library.types';
import { BreadcrumbNav } from '../components/folders/BreadcrumbNav';
import { FolderCard } from '../components/folders/FolderCard';
import { FileCard } from '../components/files/FileCard';
import { DropzoneArea } from '../components/uploader/DropzoneArea';
import { CreateFolderModal } from '../components/folders/CreateFolderModal';
import { MoveFolderModal } from '../components/folders/MoveFolderModal';
import { RenameModal } from '../components/common/RenameModal';
import { resolveFolderIcon } from '../components/common/IconResolver';
import { FolderPlus, Folder, FileText, ArrowLeft } from 'lucide-react';

export const FolderView: React.FC = () => {
  const { folderId } = useParams<{ folderId: string }>();
  const navigate = useNavigate();
  const { activeSpace } = useAuth();

  const [currentFolder, setCurrentFolder] = useState<FolderRecord | null>(null);
  const [subFolders, setSubFolders] = useState<FolderRecord[]>([]);
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [allFolders, setAllFolders] = useState<FolderRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals state
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [moveModalFolder, setMoveModalFolder] = useState<FolderRecord | null>(null);
  const [renameTarget, setRenameTarget] = useState<{
    type: 'folder' | 'file';
    item: FolderRecord | FileRecord;
  } | null>(null);

  const fetchData = useCallback(async () => {
    if (!activeSpace || !folderId) return;
    setLoading(true);
    try {
      // 1. Fetch all folders for breadcrumb hierarchy & subfolders
      const { data: allFoldersData, error: fError } = await supabase
        .from('folders')
        .select('*')
        .eq('space_id', activeSpace.id)
        .is('deleted_at', null);

      if (fError) throw fError;

      const folderList = allFoldersData || [];
      setAllFolders(folderList);

      const curr = folderList.find((f) => f.id === folderId);
      if (!curr) {
        // Folder not found or deleted
        navigate('/');
        return;
      }
      setCurrentFolder(curr);
      setSubFolders(folderList.filter((f) => f.parent_id === folderId));

      // 2. Fetch files inside this folder
      const { data: filesData, error: fileError } = await supabase
        .from('files')
        .select('*')
        .eq('space_id', activeSpace.id)
        .eq('folder_id', folderId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (fileError) throw fileError;
      setFiles(filesData || []);
    } catch (err) {
      console.error('[FolderView] Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [activeSpace, folderId, navigate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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

  const IconComp = resolveFolderIcon(currentFolder?.icon);
  const folderColor = currentFolder?.color || '#3B82F6';

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto text-tv-textLight space-y-6">
      {/* Breadcrumb Navigation Trail */}
      <div className="flex items-center justify-between pb-2 border-b border-tv-border">
        <BreadcrumbNav currentFolderId={folderId || null} allFolders={allFolders} />

        <button
          onClick={() => navigate(-1)}
          className="p-1.5 rounded-lg text-tv-textMuted hover:text-tv-textLight hover:bg-tv-card transition-colors sm:hidden"
          title="Back"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
      </div>

      {/* Folder Header */}
      <div className="flex items-center justify-between pb-4">
        <div className="flex items-center space-x-3 truncate">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-lg"
            style={{ backgroundColor: `${folderColor}25` }}
          >
            <IconComp className="w-6 h-6" style={{ color: folderColor }} />
          </div>
          <div className="truncate">
            <h1 className="text-xl sm:text-2xl font-bold truncate">{currentFolder?.name}</h1>
            <p className="text-xs text-tv-textMuted mt-0.5">
              {files.length} file{files.length === 1 ? '' : 's'} • {subFolders.length} subfolder{subFolders.length === 1 ? '' : 's'}
            </p>
          </div>
        </div>

        <button
          onClick={() => setCreateModalOpen(true)}
          className="flex items-center space-x-2 bg-tv-elevated hover:bg-tv-border text-tv-textLight px-4 py-2 rounded-xl text-xs font-semibold border border-tv-border transition-colors shadow flex-shrink-0"
        >
          <FolderPlus className="w-4 h-4 text-tv-cyan" />
          <span className="hidden sm:inline">New Subfolder</span>
        </button>
      </div>

      {/* Dropzone configured to upload into this folder */}
      <DropzoneArea targetFolderId={folderId} />

      {/* Subfolders Section */}
      {subFolders.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold flex items-center space-x-2">
              <Folder className="w-4 h-4 text-tv-cyan" />
              <span>Subfolders</span>
              <span className="text-xs text-tv-textMuted font-normal">({subFolders.length})</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {subFolders.map((sub) => (
              <FolderCard
                key={sub.id}
                folder={sub}
                onRename={(f) => setRenameTarget({ type: 'folder', item: f })}
                onMove={(f) => setMoveModalFolder(f)}
                onDelete={handleDeleteFolder}
              />
            ))}
          </div>
        </section>
      )}

      {/* Files in Folder */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold flex items-center space-x-2">
            <FileText className="w-4 h-4 text-tv-blue" />
            <span>Files in this Folder</span>
            <span className="text-xs text-tv-textMuted font-normal">({files.length})</span>
          </h2>
        </div>

        {loading ? (
          <div className="text-sm text-tv-textMuted py-8 text-center">Loading files...</div>
        ) : files.length === 0 ? (
          <div className="text-xs text-tv-textMuted p-6 bg-tv-card/40 border border-tv-border/50 rounded-2xl text-center">
            No files in this folder yet. Drop files above to upload here.
          </div>
        ) : (
          <div className="space-y-2.5">
            {files.map((file) => (
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
        parentId={folderId || null}
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
