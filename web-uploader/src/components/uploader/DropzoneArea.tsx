import React, { useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { useUploadQueue } from '../../hooks/useUploadQueue';

interface DropzoneAreaProps {
  targetFolderId?: string | null;
  className?: string;
}

export const DropzoneArea: React.FC<DropzoneAreaProps> = ({
  targetFolderId = null,
  className = '',
}) => {
  const { enqueueFiles } = useUploadQueue();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const filesArray = Array.from(e.dataTransfer.files);
      enqueueFiles(filesArray, targetFolderId);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const filesArray = Array.from(e.target.files);
      enqueueFiles(filesArray, targetFolderId);
      // Reset input value so re-selecting same file triggers change
      e.target.value = '';
    }
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => fileInputRef.current?.click()}
      className={`border-2 border-dashed rounded-2xl p-6 sm:p-8 text-center cursor-pointer transition-all duration-200 ${
        isDragOver
          ? 'border-tv-cyan bg-tv-cyan/10 scale-[1.01]'
          : 'border-tv-border hover:border-tv-cyan/50 bg-tv-card/60 hover:bg-tv-card'
      } ${className}`}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileInputChange}
        className="hidden"
        accept="image/*,application/pdf,.docx,.pptx,.xlsx,.txt,.md"
      />

      <div className="w-12 h-12 bg-tv-elevated rounded-xl flex items-center justify-center mx-auto mb-3 text-tv-cyan">
        <UploadCloud className="w-6 h-6 animate-bounce" />
      </div>

      <h3 className="font-semibold text-sm text-tv-textLight">
        Click to upload or drag and drop
      </h3>
      <p className="text-xs text-tv-textMuted mt-1">
        PDF, Images, Office docs, Text files (up to 50MB per file)
      </p>
    </div>
  );
};
