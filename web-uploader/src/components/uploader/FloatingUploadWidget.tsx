import React, { useState } from 'react';
import { useUploadQueue } from '../../hooks/useUploadQueue';
import {
  UploadCloud,
  ChevronUp,
  ChevronDown,
  X,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
} from 'lucide-react';

export const FloatingUploadWidget: React.FC = () => {
  const {
    items,
    isUploading,
    aggregateProgress,
    cancelUpload,
    retryUpload,
    removeQueueItem,
    clearCompleted,
  } = useUploadQueue();

  const [isExpanded, setIsExpanded] = useState(false);

  if (items.length === 0) return null;

  const completedCount = items.filter((i) => i.status === 'completed').length;
  const errorCount = items.filter((i) => i.status === 'error').length;
  const uploadingCount = items.filter(
    (i) => i.status === 'uploading' || i.status === 'pending'
  ).length;

  return (
    <div className="fixed bottom-20 md:bottom-6 right-4 md:right-6 z-40 max-w-sm w-full animate-fadeIn">
      <div className="bg-tv-card border border-tv-border rounded-2xl shadow-2xl overflow-hidden backdrop-blur-md">
        {/* Header Bar / Summary Pill */}
        <div
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center justify-between p-3.5 cursor-pointer bg-tv-elevated/70 hover:bg-tv-elevated transition-colors border-b border-tv-border/50"
        >
          <div className="flex items-center space-x-3 truncate">
            <div
              className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                isUploading
                  ? 'bg-tv-cyan/20 text-tv-cyan'
                  : errorCount > 0
                  ? 'bg-tv-dangerBg text-tv-danger'
                  : 'bg-emerald-500/20 text-emerald-400'
              }`}
            >
              <UploadCloud
                className={`w-4 h-4 ${isUploading ? 'animate-pulse' : ''}`}
              />
            </div>
            <div className="truncate">
              <p className="text-xs font-semibold text-tv-textLight truncate">
                {isUploading
                  ? `Uploading ${uploadingCount} file${uploadingCount > 1 ? 's' : ''} (${aggregateProgress}%)`
                  : errorCount > 0
                  ? `${errorCount} upload error${errorCount > 1 ? 's' : ''}`
                  : `All ${completedCount} upload${completedCount > 1 ? 's' : ''} completed`}
              </p>
              {isUploading && (
                <div className="w-32 bg-tv-bg rounded-full h-1 mt-1 overflow-hidden">
                  <div
                    className="bg-tv-cyan h-full transition-all duration-300"
                    style={{ width: `${aggregateProgress}%` }}
                  />
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-1 text-tv-textMuted flex-shrink-0">
            {completedCount > 0 && !isUploading && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  clearCompleted();
                }}
                className="text-[10px] uppercase font-semibold hover:text-tv-cyan px-2 py-1 rounded"
              >
                Clear
              </button>
            )}
            <button className="p-1 hover:text-tv-textLight">
              {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Detailed Item List */}
        {isExpanded && (
          <div className="max-h-60 overflow-y-auto p-2 space-y-2 divide-y divide-tv-border/30">
            {items.map((item) => (
              <div key={item.id} className="pt-2 first:pt-0">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-medium text-tv-textLight truncate max-w-[180px]" title={item.name}>
                    {item.name}
                  </span>
                  <div className="flex items-center space-x-1.5 flex-shrink-0">
                    <span className="text-[10px] text-tv-textMuted">{item.formattedSize}</span>
                    {item.status === 'completed' && (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    )}
                    {item.status === 'error' && (
                      <button
                        onClick={() => retryUpload(item.id)}
                        className="text-tv-cyan hover:underline p-0.5"
                        title="Retry Upload"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {item.status === 'uploading' && (
                      <button
                        onClick={() => cancelUpload(item.id)}
                        className="text-tv-danger hover:underline p-0.5"
                        title="Cancel"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {(item.status === 'completed' || item.status === 'error') && (
                      <button
                        onClick={() => removeQueueItem(item.id)}
                        className="text-tv-textMuted hover:text-tv-textLight p-0.5"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Progress bar or error message */}
                {item.status === 'uploading' && (
                  <div className="w-full bg-tv-bg rounded-full h-1 overflow-hidden mt-1">
                    <div
                      className="bg-tv-cyan h-full transition-all duration-200"
                      style={{ width: `${item.progress}%` }}
                    />
                  </div>
                )}
                {item.status === 'error' && item.error && (
                  <p className="text-[10px] text-tv-danger flex items-center space-x-1 mt-0.5 truncate">
                    <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">{item.error}</span>
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
