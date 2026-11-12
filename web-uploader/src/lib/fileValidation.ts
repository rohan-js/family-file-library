import type { FileCategory } from '../types/database';

export const MAX_FILE_SIZE_BYTES = 52428800; // 50MB (52,428,800 bytes)

export interface ValidationResult {
  valid: boolean;
  error: string | null;
}

export function validateUploadFile(file: File | { name: string; size: number } | null | undefined): ValidationResult {
  if (!file || file.size === 0) {
    return { valid: false, error: 'File is empty' };
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    return {
      valid: false,
      error: `File "${file.name}" exceeds 50MB limit (${sizeMb} MB > 50.0 MB)`,
    };
  }
  return { valid: true, error: null };
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function computeDaysRemaining(deletedAtIso: string): number {
  const deletedTime = new Date(deletedAtIso).getTime();
  const expireTime = deletedTime + 30 * 86400 * 1000;
  const msRemaining = expireTime - Date.now();
  return Math.max(0, Math.ceil(msRemaining / (86400 * 1000)));
}

export function determineFileCategory(filename: string, mimeType?: string): FileCategory {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const mime = (mimeType || '').toLowerCase();

  if (mime === 'application/pdf' || ext === 'pdf') {
    return 'pdf';
  }
  if (
    mime.startsWith('image/') ||
    ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif'].includes(ext)
  ) {
    return 'image';
  }
  if (
    [
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ].includes(mime) ||
    ['docx', 'doc', 'pptx', 'ppt', 'xlsx', 'xls'].includes(ext)
  ) {
    return 'office';
  }
  if (
    mime.startsWith('text/') ||
    ['txt', 'md', 'markdown', 'csv'].includes(ext)
  ) {
    return 'text';
  }
  return 'other';
}
