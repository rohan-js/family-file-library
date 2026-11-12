import { useEffect, useCallback } from 'react';
import { flushSharedFiles } from '../lib/idb';

interface UseShareTargetOptions {
  onFilesReceived: (files: File[]) => void;
}

export function useShareTarget({ onFilesReceived }: UseShareTargetOptions) {
  const checkPendingSharedFiles = useCallback(async () => {
    try {
      const files = await flushSharedFiles();
      if (files && files.length > 0) {
        onFilesReceived(files);

        // Clean up ?shared=true from URL
        if (typeof window !== 'undefined') {
          const url = new URL(window.location.href);
          if (url.searchParams.has('shared') || url.searchParams.has('shared_error')) {
            url.searchParams.delete('shared');
            url.searchParams.delete('shared_error');
            window.history.replaceState({}, '', url.pathname + url.search);
          }
        }
      }
    } catch (err) {
      console.error('[useShareTarget] Failed to consume shared files:', err);
    }
  }, [onFilesReceived]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // 1. Check on initial mount
    checkPendingSharedFiles();

    // 2. Listen for messages from Service Worker
    const handleSwMessage = (event: MessageEvent) => {
      if (event.data?.type === 'FILES_SHARED') {
        checkPendingSharedFiles();
      }
    };
    navigator.serviceWorker?.addEventListener('message', handleSwMessage);

    // 3. Listen for window focus/visibility changes
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkPendingSharedFiles();
      }
    };
    window.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', checkPendingSharedFiles);

    return () => {
      navigator.serviceWorker?.removeEventListener('message', handleSwMessage);
      window.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', checkPendingSharedFiles);
    };
  }, [checkPendingSharedFiles]);
}
