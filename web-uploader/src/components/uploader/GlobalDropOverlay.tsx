import React, { useState, useEffect } from 'react';
import { UploadCloud } from 'lucide-react';
import { useUploadQueue } from '../../hooks/useUploadQueue';

export const GlobalDropOverlay: React.FC = () => {
  const { enqueueFiles } = useUploadQueue();
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = React.useRef(0);

  useEffect(() => {
    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current += 1;
      if (e.dataTransfer?.types?.includes('Files')) {
        setIsDragging(true);
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current -= 1;
      if (dragCounter.current <= 0) {
        setIsDragging(false);
        dragCounter.current = 0;
      }
    };

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      setIsDragging(false);

      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        const filesArray = Array.from(e.dataTransfer.files);
        enqueueFiles(filesArray, null);
      }
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, [enqueueFiles]);

  if (!isDragging) return null;

  return (
    <div className="fixed inset-0 z-50 bg-tv-bg/90 backdrop-blur-md flex flex-col items-center justify-center p-6 border-4 border-dashed border-tv-cyan pointer-events-none animate-fadeIn">
      <div className="w-20 h-20 bg-tv-cyan/20 border-2 border-tv-cyan rounded-3xl flex items-center justify-center mb-4 shadow-2xl shadow-tv-cyan/20">
        <UploadCloud className="w-10 h-10 text-tv-cyan animate-bounce" />
      </div>
      <h2 className="text-2xl font-bold text-tv-textLight">Drop Files Here to Upload</h2>
      <p className="text-sm text-tv-textMuted mt-1">
        Files will be added to your current family library (up to 50MB per file).
      </p>
    </div>
  );
};
