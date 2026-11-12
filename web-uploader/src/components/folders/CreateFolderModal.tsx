import React, { useState } from 'react';
import { X, Check } from 'lucide-react';
import { FOLDER_ICONS } from '../common/IconResolver';

const PRESET_COLORS = [
  '#3B82F6', // Blue
  '#00E5FF', // Cyan
  '#10B981', // Emerald
  '#F59E0B', // Amber
  '#EF4444', // Red
  '#8B5CF6', // Purple
  '#EC4899', // Pink
  '#64748B', // Slate
];

const FORBIDDEN_CHARS_REGEX = /[/\\:*?"<>|]/;
const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

interface CreateFolderModalProps {
  isOpen: boolean;
  parentId: string | null;
  onClose: () => void;
  onSubmit: (folder: { name: string; color: string; icon: string; parent_id: string | null }) => Promise<void>;
}

export const CreateFolderModal: React.FC<CreateFolderModalProps> = ({
  isOpen,
  parentId,
  onClose,
  onSubmit,
}) => {
  const [name, setName] = useState('');
  const [selectedColor, setSelectedColor] = useState('#3B82F6');
  const [selectedIcon, setSelectedIcon] = useState('folder');
  const [customHex, setCustomHex] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const validate = (): string | null => {
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 120) {
      return 'Folder name must be between 1 and 120 characters.';
    }
    if (FORBIDDEN_CHARS_REGEX.test(trimmed)) {
      return 'Folder name cannot contain special characters: / \\ : * ? " < > |';
    }
    const color = customHex ? customHex.trim() : selectedColor;
    if (color && !HEX_COLOR_REGEX.test(color)) {
      return 'Color must be a valid 6-character hex code (e.g. #3B82F6).';
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        color: customHex ? customHex.trim() : selectedColor,
        icon: selectedIcon,
        parent_id: parentId,
      });
      setName('');
      onClose();
    } catch (submitErr: any) {
      setError(submitErr.message || 'Failed to create folder.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-tv-card border border-tv-border rounded-2xl w-full max-w-md p-6 shadow-2xl text-tv-textLight">
        <div className="flex items-center justify-between pb-4 border-b border-tv-border">
          <h2 className="text-lg font-bold text-tv-textLight flex items-center">
            New Folder
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-tv-textMuted hover:text-tv-textLight hover:bg-tv-elevated transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {error && (
            <div className="p-3 text-sm text-tv-danger bg-tv-dangerBg border border-tv-danger/30 rounded-xl">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-tv-textMuted mb-1.5">
              Folder Name *
            </label>
            <input
              type="text"
              autoFocus
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              placeholder="e.g. Malayalam Documents"
              maxLength={120}
              className="w-full bg-tv-bg border border-tv-border rounded-xl px-4 py-2.5 text-tv-textLight placeholder-tv-textMuted focus:outline-none focus:border-tv-cyan focus:ring-1 focus:ring-tv-cyan text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-tv-textMuted mb-1.5">
              Color Accent
            </label>
            <div className="flex flex-wrap gap-2.5 pt-1">
              {PRESET_COLORS.map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => {
                    setSelectedColor(c);
                    setCustomHex('');
                  }}
                  className="w-7 h-7 rounded-full flex items-center justify-center transition-transform hover:scale-110 focus:outline-none shadow"
                  style={{ backgroundColor: c }}
                >
                  {selectedColor === c && !customHex && <Check className="w-4 h-4 text-white stroke-[3]" />}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-tv-textMuted mb-1.5">
              Folder Icon
            </label>
            <div className="grid grid-cols-6 gap-2 pt-1 max-h-32 overflow-y-auto p-1 bg-tv-bg/50 rounded-xl border border-tv-border">
              {Object.entries(FOLDER_ICONS).map(([key, IconComp]) => (
                <button
                  type="button"
                  key={key}
                  onClick={() => setSelectedIcon(key)}
                  className={`p-2.5 rounded-lg flex items-center justify-center border transition-all ${
                    selectedIcon === key
                      ? 'border-tv-cyan bg-tv-elevated text-tv-cyan shadow'
                      : 'border-tv-border text-tv-textMuted hover:border-tv-textMuted hover:text-tv-textLight'
                  }`}
                  title={key}
                >
                  <IconComp className="w-5 h-5" />
                </button>
              ))}
            </div>
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
              disabled={isSubmitting || !name.trim()}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-tv-blue hover:bg-tv-blueHover text-white shadow-lg disabled:opacity-50 transition-all flex items-center"
            >
              {isSubmitting ? 'Creating...' : 'Create Folder'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
