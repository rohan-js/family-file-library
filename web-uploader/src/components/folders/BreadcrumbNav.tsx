import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';
import type { FolderRecord } from '../../types/library.types';

interface BreadcrumbNavProps {
  currentFolderId: string | null;
  allFolders: FolderRecord[];
}

export const BreadcrumbNav: React.FC<BreadcrumbNavProps> = ({ currentFolderId, allFolders }) => {
  // Build chain from current folder up to root
  const breadcrumbChain: FolderRecord[] = [];
  let currId = currentFolderId;

  while (currId) {
    const found = allFolders.find((f) => f.id === currId);
    if (!found) break;
    breadcrumbChain.unshift(found);
    currId = found.parent_id;
  }

  return (
    <nav aria-label="Folder Breadcrumb" className="flex items-center space-x-1 text-sm text-tv-textMuted overflow-x-auto py-2">
      <Link
        to="/"
        className="flex items-center hover:text-tv-cyan transition-colors px-2 py-1 rounded-lg hover:bg-tv-card flex-shrink-0"
        title="Root Library (Inbox)"
      >
        <Home className="w-4 h-4 mr-1.5 text-tv-cyan" />
        <span className="font-semibold text-tv-textLight">Library</span>
      </Link>

      {breadcrumbChain.map((folder, index) => {
        const isLast = index === breadcrumbChain.length - 1;
        return (
          <React.Fragment key={folder.id}>
            <ChevronRight className="w-4 h-4 text-tv-border flex-shrink-0" />
            {isLast ? (
              <span className="flex items-center font-bold text-tv-cyan px-2 py-1 truncate max-w-[180px] sm:max-w-xs flex-shrink-0">
                <span
                  className="w-2.5 h-2.5 rounded-full mr-2 flex-shrink-0"
                  style={{ backgroundColor: folder.color || '#3B82F6' }}
                />
                <span className="truncate">{folder.name}</span>
              </span>
            ) : (
              <Link
                to={`/folders/${folder.id}`}
                className="flex items-center hover:text-tv-cyan transition-colors px-2 py-1 rounded-lg hover:bg-tv-card truncate max-w-[120px] sm:max-w-[160px] flex-shrink-0"
              >
                <span
                  className="w-2 h-2 rounded-full mr-1.5 flex-shrink-0"
                  style={{ backgroundColor: folder.color || '#3B82F6' }}
                />
                <span className="truncate">{folder.name}</span>
              </Link>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
};
