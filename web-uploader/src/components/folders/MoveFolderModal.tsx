import React, { useState } from 'react';
import { X, Folder as FolderIcon, Home, Check } from 'lucide-react';
import type { FolderRecord } from '../../types/library.types';
import { isDescendantOrSelf } from '../../lib/folderHierarchy';

interface MoveFolderModalProps {
  isOpen: boolean;
  folderToMove: FolderRecord;
  allFolders: FolderRecord[];
  onClose: () => void;
  onMove: (sourceFolderId: string, newParentId: string | null) => Promise<void>;
}

export const MoveFolderModal: React.FC<MoveFolderModalProps> = ({
  isOpen,
  folderToMove,
  allFolders,
  onClose,
  onMove,
}) => {
  const [selectedParentId, setSelectedParentId] = useState<string | null>(folderToMove.parent_id);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const validTargets = allFolders.filter(
    (f) => !isDescendantOrSelf(folderToMove.id, f.id, allFolders)
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedParentId === folderToMove.parent_id) {
      onClose();
      return;
    }

    if (isDescendantOrSelf(folderToMove.id, selectedParentId, allFolders)) {
      setError('Cannot move a folder into itself or one of its descendants.');
      return;
    }

    setError(null);
    setIsSubmitting(true);
    try {
      await onMove(folderToMove.id, selectedParentId);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to move folder.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-tv-card border border-tv-border rounded-2xl w-full max-w-md p-6 shadow-2xl text-tv-textLight">
        <div className="flex items-center justify-between pb-4 border-b border-tv-border">
          <h2 className="text-lg font-bold text-tv-textLight flex items-center">
            Move &ldquo;{folderToMove.name}&rdquo;
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-tv-textMuted hover:text-tv-textLight hover:bg-tv-elevated transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="my-3 p-3 text-sm text-tv-danger bg-tv-dangerBg border border-tv-danger/30 rounded-xl">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
            {/* Root library option */}
            <button
              type="button"
              onClick={() => setSelectedParentId(null)}
              className={`w-full flex items-center justify-between p-3 rounded-xl border text-sm transition-all ${
                selectedParentId === null
                  ? 'border-tv-cyan bg-tv-elevated text-tv-cyan font-semibold'
                  : 'border-tv-border text-tv-textLight hover:bg-tv-elevated/60'
              }`}
            >
              <div className="flex items-center space-x-2.5">
                <Home className="w-4 h-4 text-tv-cyan" />
                <span>Root Library</span>
              </div>
              {selectedParentId === null && <Check className="w-4 h-4 text-tv-cyan" />}
            </button>

            {validTargets.map((f) => (
              <button
                type="button"
                key={f.id}
                onClick={() => setSelectedParentId(f.id)}
                className={`w-full flex items-center justify-between p-3 rounded-xl border text-sm transition-all ${
                  selectedParentId === f.id
                    ? 'border-tv-cyan bg-tv-elevated text-tv-cyan font-semibold'
                    : 'border-tv-border text-tv-textLight hover:bg-tv-elevated/60'
                }`}
              >
                <div className="flex items-center space-x-2.5 truncate">
                  <FolderIcon
                    className="w-4 h-4 flex-shrink-0"
                    style={{ color: f.color || '#3B82F6' }}
                  />
                  <span className="truncate">{f.name}</span>
                </div>
                {selectedParentId === f.id && <Check className="w-4 h-4 text-tv-cyan flex-shrink-0" />}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-end space-x-3 pt-4 border-t border-tv-border">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm text-tv-textMuted hover:text-tv-textLight hover:bg-tv-elevated transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-tv-blue hover:bg-tv-blueHover text-white shadow-lg disabled:opacity-50 transition-all"
            >
              {isSubmitting ? 'Moving...' : 'Move Here'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
