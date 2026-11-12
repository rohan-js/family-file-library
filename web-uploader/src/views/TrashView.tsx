import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import {
  Trash2,
  RotateCcw,
  FileText,
  Folder as FolderIcon,
  Clock,
} from 'lucide-react';
import { computeDaysRemaining, formatFileSize } from '../lib/fileValidation';
import { resolveFolderIcon, resolveCategoryIcon } from '../components/common/IconResolver';

export const TrashView: React.FC = () => {
  const { activeSpace } = useAuth();
  const [trashFiles, setTrashFiles] = useState<any[]>([]);
  const [trashFolders, setTrashFolders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchTrash = useCallback(async () => {
    if (!activeSpace) return;
    setLoading(true);
    setActionError(null);
    try {
      const [filesRes, foldersRes] = await Promise.all([
        supabase
          .from('view_trash_files')
          .select('*')
          .eq('space_id', activeSpace.id)
          .order('deleted_at', { ascending: false }),
        supabase
          .from('folders')
          .select('*')
          .eq('space_id', activeSpace.id)
          .not('deleted_at', 'is', null)
          .order('deleted_at', { ascending: false }),
      ]);

      if (filesRes.error) throw filesRes.error;
      if (foldersRes.error) throw foldersRes.error;

      setTrashFiles(filesRes.data || []);
      setTrashFolders(foldersRes.data || []);
    } catch (err: any) {
      setActionError(err.message || 'Failed to load trash items.');
    } finally {
      setLoading(false);
    }
  }, [activeSpace]);

  useEffect(() => {
    fetchTrash();
  }, [fetchTrash]);

  // 1. Restore Action
  const handleRestoreFile = async (fileId: string) => {
    try {
      const { error } = await supabase
        .from('files')
        .update({ deleted_at: null, deleted_by: null })
        .eq('id', fileId);

      if (error) throw error;
      fetchTrash();
    } catch (err: any) {
      setActionError(err.message || 'Failed to restore file.');
    }
  };

  const handleRestoreFolder = async (folderId: string) => {
    try {
      const { error } = await supabase
        .from('folders')
        .update({ deleted_at: null })
        .eq('id', folderId);

      if (error) throw error;
      fetchTrash();
    } catch (err: any) {
      setActionError(err.message || 'Failed to restore folder.');
    }
  };

  // 2. Permanent Delete Action (Purge storage object & DB row)
  const handlePermanentDeleteFile = async (file: any) => {
    if (
      !window.confirm(
        `Permanently delete "${file.name}"? This file will be immediately erased from cloud storage and cannot be restored.`
      )
    ) {
      return;
    }

    try {
      // 1. Remove original storage blob
      if (file.storage_path) {
        await supabase.storage.from('family-files').remove([file.storage_path]);
      }
      // 2. Remove converted PDF if present
      if (file.pdf_path) {
        await supabase.storage.from('family-files').remove([file.pdf_path]);
      }
      // 3. Remove DB record
      const { error } = await supabase.from('files').delete().eq('id', file.id);
      if (error) throw error;
      fetchTrash();
    } catch (err: any) {
      setActionError(`Purge failed: ${err.message}`);
    }
  };

  const handlePermanentDeleteFolder = async (folder: any) => {
    if (
      !window.confirm(
        `Permanently delete folder "${folder.name}"? All sub-items will be permanently removed.`
      )
    ) {
      return;
    }

    try {
      const { error } = await supabase.from('folders').delete().eq('id', folder.id);
      if (error) throw error;
      fetchTrash();
    } catch (err: any) {
      setActionError(`Folder purge failed: ${err.message}`);
    }
  };

  const totalTrashCount = trashFiles.length + trashFolders.length;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto text-tv-textLight">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-tv-border gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center space-x-2.5">
            <Trash2 className="w-7 h-7 text-tv-danger" />
            <span>Trash Recovery & Management</span>
          </h1>
          <p className="text-sm text-tv-textMuted mt-1">
            Soft-deleted items are safely preserved here for 30 days before automatic purge.
          </p>
        </div>
      </div>

      {actionError && (
        <div className="my-4 p-4 bg-tv-dangerBg border border-tv-danger/30 text-tv-danger rounded-xl text-sm">
          {actionError}
        </div>
      )}

      {loading ? (
        <div className="text-center py-20 text-tv-textMuted text-sm">Loading trash items...</div>
      ) : totalTrashCount === 0 ? (
        <div className="text-center py-20 bg-tv-card rounded-2xl border border-tv-border mt-6">
          <Trash2 className="w-14 h-14 mx-auto text-tv-textMuted/30 mb-3" />
          <h3 className="text-lg font-bold text-tv-textLight">Trash is Empty</h3>
          <p className="text-sm text-tv-textMuted max-w-sm mx-auto mt-1">
            Files and folders you delete will appear here with a 30-day countdown before being permanently erased.
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {/* Folders in Trash */}
          {trashFolders.map((folder) => {
            const daysLeft = computeDaysRemaining(folder.deleted_at);
            const FolderIconComp = resolveFolderIcon(folder.icon);
            return (
              <div
                key={folder.id}
                className="flex items-center justify-between p-4 bg-tv-card border border-tv-border rounded-xl shadow"
              >
                <div className="flex items-center space-x-3.5 truncate">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: `${folder.color || '#3B82F6'}20` }}
                  >
                    <FolderIconComp
                      className="w-5 h-5 flex-shrink-0"
                      style={{ color: folder.color || '#3B82F6' }}
                    />
                  </div>
                  <div className="truncate">
                    <span className="font-semibold text-sm truncate">{folder.name}</span>
                    <p className="text-xs text-tv-textMuted mt-0.5">
                      Deleted {new Date(folder.deleted_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-3 flex-shrink-0">
                  <span
                    className={`text-xs px-2.5 py-1 rounded-full font-medium flex items-center space-x-1 ${
                      daysLeft <= 5
                        ? 'bg-tv-dangerBg text-tv-danger border border-tv-danger/30'
                        : daysLeft <= 19
                        ? 'bg-tv-warningBg text-tv-warning border border-tv-warning/30'
                        : 'bg-tv-elevated text-tv-textMuted'
                    }`}
                  >
                    <Clock className="w-3 h-3" />
                    <span>{daysLeft} days left</span>
                  </span>

                  <button
                    onClick={() => handleRestoreFolder(folder.id)}
                    className="p-2 text-tv-textMuted hover:text-tv-cyan hover:bg-tv-elevated rounded-lg transition-colors"
                    title="Restore Folder"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => handlePermanentDeleteFolder(folder)}
                    className="p-2 text-tv-textMuted hover:text-tv-danger hover:bg-tv-dangerBg rounded-lg transition-colors"
                    title="Delete Permanently"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}

          {/* Files in Trash */}
          {trashFiles.map((file) => {
            const daysLeft = file.days_remaining !== undefined ? file.days_remaining : computeDaysRemaining(file.deleted_at);
            const FileIconComp = resolveCategoryIcon(file.file_category);
            return (
              <div
                key={file.id}
                className="flex items-center justify-between p-4 bg-tv-card border border-tv-border rounded-xl shadow"
              >
                <div className="flex items-center space-x-3.5 truncate">
                  <div className="w-10 h-10 rounded-xl bg-tv-elevated flex items-center justify-center flex-shrink-0 text-tv-blue">
                    <FileIconComp className="w-5 h-5 flex-shrink-0" />
                  </div>
                  <div className="truncate">
                    <p className="font-semibold text-sm truncate">{file.name}</p>
                    <p className="text-xs text-tv-textMuted mt-0.5">
                      {formatFileSize(file.size_bytes)} • Deleted {new Date(file.deleted_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-3 flex-shrink-0">
                  <span
                    className={`text-xs px-2.5 py-1 rounded-full font-medium flex items-center space-x-1 ${
                      daysLeft <= 5
                        ? 'bg-tv-dangerBg text-tv-danger border border-tv-danger/30'
                        : daysLeft <= 19
                        ? 'bg-tv-warningBg text-tv-warning border border-tv-warning/30'
                        : 'bg-tv-elevated text-tv-textMuted'
                    }`}
                  >
                    <Clock className="w-3 h-3" />
                    <span>{daysLeft} days left</span>
                  </span>

                  <button
                    onClick={() => handleRestoreFile(file.id)}
                    className="p-2 text-tv-textMuted hover:text-tv-cyan hover:bg-tv-elevated rounded-lg transition-colors"
                    title="Restore File"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => handlePermanentDeleteFile(file)}
                    className="p-2 text-tv-textMuted hover:text-tv-danger hover:bg-tv-dangerBg rounded-lg transition-colors"
                    title="Delete Permanently"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
