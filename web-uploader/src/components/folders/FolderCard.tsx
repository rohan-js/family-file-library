import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { FolderRecord } from '../../types/library.types';
import { resolveFolderIcon } from '../common/IconResolver';
import { MoreVertical, Edit2, FolderInput, Trash2 } from 'lucide-react';

interface FolderCardProps {
  folder: FolderRecord;
  itemCount?: number;
  onRename: (folder: FolderRecord) => void;
  onMove: (folder: FolderRecord) => void;
  onDelete: (folder: FolderRecord) => void;
}

export const FolderCard: React.FC<FolderCardProps> = ({
  folder,
  itemCount,
  onRename,
  onMove,
  onDelete,
}) => {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const IconComp = resolveFolderIcon(folder.icon);
  const folderColor = folder.color || '#3B82F6';

  const handleClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.folder-actions-menu')) return;
    navigate(`/folders/${folder.id}`);
  };

  return (
    <div
      onClick={handleClick}
      className="group relative flex items-center justify-between p-4 bg-tv-card hover:bg-tv-elevated border border-tv-border hover:border-tv-cyan/50 rounded-2xl shadow cursor-pointer transition-all duration-200"
    >
      <div className="flex items-center space-x-3.5 truncate">
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-105 shadow-inner"
          style={{ backgroundColor: `${folderColor}20` }}
        >
          <IconComp className="w-5 h-5" style={{ color: folderColor }} />
        </div>

        <div className="truncate">
          <h4 className="font-semibold text-sm text-tv-textLight group-hover:text-tv-cyan truncate transition-colors">
            {folder.name}
          </h4>
          <p className="text-xs text-tv-textMuted mt-0.5">
            {typeof itemCount === 'number' ? `${itemCount} items` : 'Folder'}
          </p>
        </div>
      </div>

      {/* Action Menu */}
      <div className="folder-actions-menu relative flex-shrink-0">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen(!menuOpen);
          }}
          className="p-1.5 rounded-lg text-tv-textMuted hover:text-tv-textLight hover:bg-tv-card transition-colors"
        >
          <MoreVertical className="w-4 h-4" />
        </button>

        {menuOpen && (
          <>
            <div
              className="fixed inset-0 z-30"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
              }}
            />
            <div className="absolute right-0 mt-1 w-36 bg-tv-card border border-tv-border rounded-xl shadow-2xl py-1 z-40 text-xs text-tv-textLight">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  onRename(folder);
                }}
                className="w-full flex items-center space-x-2 px-3 py-2 hover:bg-tv-elevated transition-colors text-left"
              >
                <Edit2 className="w-3.5 h-3.5 text-tv-cyan" />
                <span>Rename</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  onMove(folder);
                }}
                className="w-full flex items-center space-x-2 px-3 py-2 hover:bg-tv-elevated transition-colors text-left"
              >
                <FolderInput className="w-3.5 h-3.5 text-tv-blue" />
                <span>Move</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  onDelete(folder);
                }}
                className="w-full flex items-center space-x-2 px-3 py-2 hover:bg-tv-dangerBg text-tv-danger transition-colors text-left"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
