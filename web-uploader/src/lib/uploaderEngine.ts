import { supabase } from './supabase';
import { determineFileCategory } from './fileValidation';
import type { UploadQueueItem } from '../types/uploader.types';

export async function uploadFileItem(
  item: UploadQueueItem,
  user: { id: string; name?: string; email?: string },
  onProgress: (percent: number, loadedBytes: number) => void
): Promise<{ fileRecordId: string; storagePath: string }> {
  const fileId = crypto.randomUUID();
  const rawExt = item.name.split('.').pop() || 'bin';
  const ext = rawExt.toLowerCase().replace(/[^a-z0-9]/g, '');
  const folderSegment = item.folderId || 'root';
  const storagePath = `${item.spaceId}/${folderSegment}/${fileId}.${ext}`;

  // 1. Upload to Supabase Storage with Progress
  const session = (await supabase.auth.getSession()).data.session;
  const token = session?.access_token || '';
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

  // In standard browser environment, use XHR for byte-level progress events
  if (typeof XMLHttpRequest !== 'undefined' && supabaseUrl && token) {
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      if (item.abortController) {
        item.abortController.signal.addEventListener('abort', () => xhr.abort());
      }

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100);
          onProgress(percent, event.loaded);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          try {
            const res = JSON.parse(xhr.responseText);
            reject(new Error(res.message || `Upload failed with status ${xhr.status}`));
          } catch {
            reject(new Error(`Storage upload failed with HTTP ${xhr.status}`));
          }
        }
      };

      xhr.onerror = () => reject(new Error('Network error during file storage upload'));
      xhr.onabort = () => reject(new Error('Upload cancelled'));

      const uploadUrl = `${supabaseUrl}/storage/v1/object/family-files/${storagePath}`;
      xhr.open('POST', uploadUrl);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.setRequestHeader('apikey', import.meta.env.VITE_SUPABASE_ANON_KEY);
      xhr.setRequestHeader('x-upsert', 'false');
      xhr.send(item.file);
    });
  } else {
    // Fallback using supabase.storage SDK
    const { error: storageError } = await supabase.storage
      .from('family-files')
      .upload(storagePath, item.file, {
        upsert: false,
        contentType: item.file.type || 'application/octet-stream',
      });

    if (storageError) {
      throw new Error(`Storage upload failed: ${storageError.message}`);
    }
    onProgress(100, item.size);
  }

  // 2. Database Record Creation in 'files' Table
  const category = determineFileCategory(item.name, item.file.type);
  const conversionStatus = category === 'office' ? 'pending' : 'ready';

  const { data: dbData, error: dbError } = await supabase
    .from('files')
    .insert({
      id: fileId,
      space_id: item.spaceId,
      folder_id: item.folderId,
      name: item.name,
      file_type: item.file.type || 'application/octet-stream',
      file_category: category,
      size_bytes: item.size,
      storage_path: storagePath,
      conversion_status: conversionStatus,
      uploader_id: user.id,
      uploader_name: user.name || user.email || 'Family Member',
    })
    .select('id, storage_path')
    .single();

  if (dbError || !dbData) {
    // Rollback storage upload if DB insert fails
    await supabase.storage.from('family-files').remove([storagePath]);
    throw new Error(`Database catalog insert failed: ${dbError?.message || 'No record created'}`);
  }

  const record = dbData as unknown as { id: string; storage_path: string };
  return { fileRecordId: record.id, storagePath: record.storage_path };
}
