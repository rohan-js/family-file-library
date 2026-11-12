import type { FolderRecord } from '../types/library.types';

/**
 * Returns true if targetFolderId is identical to sourceFolderId OR
 * if targetFolderId is a descendant of sourceFolderId.
 * This prevents cyclical folder trees (e.g. moving /A into /A/B).
 */
export function isDescendantOrSelf(
  sourceFolderId: string,
  targetFolderId: string | null,
  allFolders: FolderRecord[]
): boolean {
  if (!targetFolderId) return false; // Root is never a descendant
  if (sourceFolderId === targetFolderId) return true;

  let currentId: string | null = targetFolderId;
  const visited = new Set<string>();

  while (currentId) {
    if (visited.has(currentId)) break; // Prevent infinite loop in corrupt tree
    visited.add(currentId);

    if (currentId === sourceFolderId) return true;
    const parent = allFolders.find((f) => f.id === currentId);
    currentId = parent?.parent_id || null;
  }

  return false;
}
