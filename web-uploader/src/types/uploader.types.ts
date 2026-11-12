export type UploadStatus = 'pending' | 'uploading' | 'completed' | 'error';

export interface UploadQueueItem {
  id: string; // Client UUID for tracking
  file: File;
  name: string;
  size: number;
  formattedSize: string;
  folderId: string | null;
  spaceId: string;
  status: UploadStatus;
  progress: number; // 0 to 100
  bytesUploaded: number;
  error: string | null;
  storagePath: string | null;
  fileRecordId: string | null;
  abortController?: AbortController;
}

export interface UploadQueueState {
  items: UploadQueueItem[];
  isUploading: boolean;
  totalBytes: number;
  uploadedBytes: number;
  aggregateProgress: number; // 0 to 100
}
