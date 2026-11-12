import React, { useState } from 'react';
import { X } from 'lucide-react';

interface RenameModalProps {
  isOpen: boolean;
  initialName: string;
  itemType: 'file' | 'folder';
  onClose: () => void;
  onSubmit: (newName: string) => Promise<void>;
}

export const RenameModal: React.FC<RenameModalProps> = ({
  isOpen,
  initialName,
  itemType,
  onClose,
  onSubmit,
}) => {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name cannot be empty.');
      return;
    }
    if (trimmed.length > 120) {
      setError('Name must be 120 characters or fewer.');
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      await onSubmit(trimmed);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to rename item.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-tv-card border border-tv-border rounded-2xl w-full max-w-sm p-6 shadow-2xl text-tv-textLight">
        <div className="flex items-center justify-between pb-4 border-b border-tv-border">
          <h2 className="text-lg font-bold">Rename {itemType === 'folder' ? 'Folder' : 'File'}</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-tv-textMuted hover:text-tv-textLight hover:bg-tv-elevated transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="my-3 p-3 text-xs text-tv-danger bg-tv-dangerBg border border-tv-danger/30 rounded-xl">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <input
            type="text"
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            maxLength={120}
            className="w-full bg-tv-bg border border-tv-border rounded-xl px-4 py-2.5 text-tv-textLight focus:outline-none focus:border-tv-cyan text-sm"
          />

          <div className="flex items-center justify-end space-x-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm text-tv-textMuted hover:text-tv-textLight hover:bg-tv-elevated transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !name.trim()}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-tv-blue hover:bg-tv-blueHover text-white shadow-lg disabled:opacity-50 transition-all"
            >
              {isSubmitting ? 'Saving...' : 'Rename'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
