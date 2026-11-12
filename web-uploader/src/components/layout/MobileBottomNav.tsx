import React from 'react';
import { NavLink } from 'react-router-dom';
import { FolderGit2, Tv, PlusCircle, Trash2 } from 'lucide-react';

export const MobileBottomNav: React.FC = () => {
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-tv-card/95 backdrop-blur-lg border-t border-tv-border px-2 py-1.5 flex items-center justify-around select-none">
      <NavLink
        to="/"
        end
        className={({ isActive }) =>
          `flex flex-col items-center py-1 px-3 rounded-xl text-[10px] font-semibold transition-colors ${
            isActive ? 'text-tv-cyan' : 'text-tv-textMuted hover:text-tv-textLight'
          }`
        }
      >
        <FolderGit2 className="w-5 h-5 mb-0.5" />
        <span>Library</span>
      </NavLink>

      <NavLink
        to="/pair"
        className={({ isActive }) =>
          `flex flex-col items-center py-1 px-3 rounded-xl text-[10px] font-semibold transition-colors ${
            isActive ? 'text-tv-cyan' : 'text-tv-textMuted hover:text-tv-textLight'
          }`
        }
      >
        <PlusCircle className="w-5 h-5 mb-0.5" />
        <span>Pair TV</span>
      </NavLink>

      <NavLink
        to="/devices"
        className={({ isActive }) =>
          `flex flex-col items-center py-1 px-3 rounded-xl text-[10px] font-semibold transition-colors ${
            isActive ? 'text-tv-cyan' : 'text-tv-textMuted hover:text-tv-textLight'
          }`
        }
      >
        <Tv className="w-5 h-5 mb-0.5" />
        <span>Devices</span>
      </NavLink>

      <NavLink
        to="/trash"
        className={({ isActive }) =>
          `flex flex-col items-center py-1 px-3 rounded-xl text-[10px] font-semibold transition-colors ${
            isActive ? 'text-tv-cyan' : 'text-tv-textMuted hover:text-tv-textLight'
          }`
        }
      >
        <Trash2 className="w-5 h-5 mb-0.5" />
        <span>Trash</span>
      </NavLink>
    </nav>
  );
};
