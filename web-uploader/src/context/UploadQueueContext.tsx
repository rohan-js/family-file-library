import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import type { UploadQueueItem } from '../types/uploader.types';
import { validateUploadFile, formatFileSize } from '../lib/fileValidation';
import { uploadFileItem } from '../lib/uploaderEngine';
import { useAuth } from '../hooks/useAuth';
import { useShareTarget } from '../hooks/useShareTarget';

interface UploadQueueContextValue {
  items: UploadQueueItem[];
  isUploading: boolean;
  aggregateProgress: number;
  enqueueFiles: (files: File[], targetFolderId?: string | null) => void;
  cancelUpload: (id: string) => void;
  retryUpload: (id: string) => void;
  removeQueueItem: (id: string) => void;
  clearCompleted: () => void;
}

const UploadQueueContext = createContext<UploadQueueContextValue | undefined>(undefined);

export const UploadQueueProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, activeSpace } = useAuth();
  const [items, setItems] = useState<UploadQueueItem[]>([]);
  const isProcessingRef = useRef<boolean>(false);

  const enqueueFiles = useCallback(
    (files: File[], targetFolderId?: string | null) => {
      if (!activeSpace) {
        console.warn('[UploadQueue] Cannot enqueue files: No active space selected.');
        return;
      }

      const newItems: UploadQueueItem[] = files.map((file) => {
        const validation = validateUploadFile(file);
        const item: UploadQueueItem = {
          id: 'upload-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9),
          file,
          name: file.name,
          size: file.size,
          formattedSize: formatFileSize(file.size),
          folderId: targetFolderId !== undefined ? targetFolderId : null,
          spaceId: activeSpace.id,
          status: validation.valid ? 'pending' : 'error',
          progress: 0,
          bytesUploaded: 0,
          error: validation.error,
          storagePath: null,
          fileRecordId: null,
        };
        return item;
      });

      setItems((prev) => [...prev, ...newItems]);
    },
    [activeSpace]
  );

  // Hook into Web Share Target ingestion from Service Worker & IndexedDB!
  useShareTarget({
    onFilesReceived: useCallback(
      (sharedFiles: File[]) => {
        console.log('[UploadQueue] Received shared files via Web Share Target:', sharedFiles.length);
        enqueueFiles(sharedFiles, null);
      },
      [enqueueFiles]
    ),
  });

  // Process pending uploads in queue
  useEffect(() => {
    if (isProcessingRef.current || !user || !activeSpace) return;

    const pendingItem = items.find((i) => i.status === 'pending');
    if (!pendingItem) return;

    isProcessingRef.current = true;
    const abortController = new AbortController();

    // Mark as uploading
    setItems((prev) =>
      prev.map((i) =>
        i.id === pendingItem.id
          ? { ...i, status: 'uploading', abortController }
          : i
      )
    );

    const currentUser = {
      id: user.id,
      name: user.user_metadata?.full_name,
      email: user.email,
    };

    uploadFileItem(
      { ...pendingItem, abortController },
      currentUser,
      (percent, loadedBytes) => {
        setItems((prev) =>
          prev.map((i) =>
            i.id === pendingItem.id
              ? { ...i, progress: percent, bytesUploaded: loadedBytes }
              : i
          )
        );
      }
    )
      .then(({ fileRecordId, storagePath }) => {
        setItems((prev) =>
          prev.map((i) =>
            i.id === pendingItem.id
              ? {
                  ...i,
                  status: 'completed',
                  progress: 100,
                  bytesUploaded: i.size,
                  fileRecordId,
                  storagePath,
                }
              : i
          )
        );
      })
      .catch((err) => {
        setItems((prev) =>
          prev.map((i) =>
            i.id === pendingItem.id
              ? { ...i, status: 'error', error: err.message || 'Upload failed' }
              : i
          )
        );
      })
      .finally(() => {
        isProcessingRef.current = false;
      });
  }, [items, user, activeSpace]);

  const cancelUpload = (id: string) => {
    setItems((prev) =>
      prev.map((i) => {
        if (i.id === id) {
          if (i.abortController) {
            i.abortController.abort();
          }
          return { ...i, status: 'error', error: 'Upload cancelled by user' };
        }
        return i;
      })
    );
  };

  const retryUpload = (id: string) => {
    setItems((prev) =>
      prev.map((i) =>
        i.id === id
          ? { ...i, status: 'pending', progress: 0, bytesUploaded: 0, error: null }
          : i
      )
    );
  };

  const removeQueueItem = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const clearCompleted = () => {
    setItems((prev) => prev.filter((i) => i.status !== 'completed'));
  };

  const isUploading = items.some((i) => i.status === 'uploading');
  const activeItems = items.filter((i) => i.status !== 'error');
  const totalBytes = activeItems.reduce((acc, i) => acc + i.size, 0);
  const uploadedBytes = activeItems.reduce((acc, i) => acc + i.bytesUploaded, 0);
  const aggregateProgress =
    totalBytes > 0 ? Math.round((uploadedBytes / totalBytes) * 100) : 0;

  return (
    <UploadQueueContext.Provider
      value={{
        items,
        isUploading,
        aggregateProgress,
        enqueueFiles,
        cancelUpload,
        retryUpload,
        removeQueueItem,
        clearCompleted,
      }}
    >
      {children}
    </UploadQueueContext.Provider>
  );
};

export const useUploadQueue = () => {
  const ctx = useContext(UploadQueueContext);
  if (!ctx) throw new Error('useUploadQueue must be used within an UploadQueueProvider');
  return ctx;
};
