import React, { useState } from 'react';
import type { LibraryFile } from '../../types/models';
import { formatFileSize } from '../../lib/fileValidation';
import { resolveCategoryIcon } from '../common/IconResolver';
import { supabase } from '../../lib/supabase';
import { MoreVertical, Edit2, Trash2, Download, Eye, ExternalLink } from 'lucide-react';

interface FileCardProps {
  file: LibraryFile;
  onRename: (file: LibraryFile) => void;
  onDelete: (file: LibraryFile) => void;
}

export const FileCard: React.FC<FileCardProps> = ({ file, onRename, onDelete }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const IconComp = resolveCategoryIcon(file.file_category);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const { data, error } = await supabase.storage
        .from('family-files')
        .createSignedUrl(file.storage_path, 300);

      if (error) throw error;
      if (data?.signedUrl) {
        window.open(data.signedUrl, '_blank');
      }
    } catch (err) {
      console.error('[FileCard] Download failed:', err);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="group relative flex items-center justify-between p-4 bg-tv-card hover:bg-tv-elevated border border-tv-border hover:border-tv-cyan/40 rounded-2xl shadow transition-all duration-200">
      <div className="flex items-center space-x-3.5 truncate">
        <div className="w-11 h-11 rounded-xl bg-tv-elevated flex items-center justify-center flex-shrink-0 text-tv-cyan shadow-inner">
          <IconComp className="w-5 h-5 flex-shrink-0" />
        </div>

        <div className="truncate">
          <div className="flex items-center space-x-2 truncate">
            <h4 className="font-semibold text-sm text-tv-textLight truncate group-hover:text-tv-cyan transition-colors" title={file.name}>
              {file.name}
            </h4>
            {file.file_category === 'office' && file.conversion_status && (
              <span
                className={`text-[9px] uppercase px-1.5 py-0.5 rounded font-mono ${
                  file.conversion_status === 'ready'
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : file.conversion_status === 'pending' || file.conversion_status === 'processing'
                    ? 'bg-amber-500/20 text-amber-400'
                    : 'bg-tv-elevated text-tv-textMuted'
                }`}
              >
                {file.conversion_status === 'ready' ? 'TV Ready' : file.conversion_status}
              </span>
            )}
          </div>
          <p className="text-xs text-tv-textMuted mt-0.5">
            {formatFileSize(file.size_bytes)} • Uploaded by {file.uploader_name}
          </p>
        </div>
      </div>

      <div className="flex items-center space-x-1 flex-shrink-0">
        <button
          type="button"
          onClick={handleDownload}
          disabled={downloading}
          className="p-2 text-tv-textMuted hover:text-tv-cyan hover:bg-tv-card rounded-lg transition-colors"
          title="Download or View"
        >
          {downloading ? (
            <div className="w-4 h-4 border-2 border-tv-cyan/30 border-t-tv-cyan rounded-full animate-spin" />
          ) : (
            <Download className="w-4 h-4" />
          )}
        </button>

        {/* More Actions Menu */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen(!menuOpen)}
            className="p-2 rounded-lg text-tv-textMuted hover:text-tv-textLight hover:bg-tv-card transition-colors"
          >
            <MoreVertical className="w-4 h-4" />
          </button>

          {menuOpen && (
            <>
              <div
                className="fixed inset-0 z-30"
                onClick={() => setMenuOpen(false)}
              />
              <div className="absolute right-0 mt-1 w-36 bg-tv-card border border-tv-border rounded-xl shadow-2xl py-1 z-40 text-xs text-tv-textLight">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    handleDownload();
                  }}
                  className="w-full flex items-center space-x-2 px-3 py-2 hover:bg-tv-elevated transition-colors text-left"
                >
                  <Eye className="w-3.5 h-3.5 text-tv-cyan" />
                  <span>View File</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onRename(file);
                  }}
                  className="w-full flex items-center space-x-2 px-3 py-2 hover:bg-tv-elevated transition-colors text-left"
                >
                  <Edit2 className="w-3.5 h-3.5 text-tv-blue" />
                  <span>Rename</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete(file);
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
    </div>
  );
};
