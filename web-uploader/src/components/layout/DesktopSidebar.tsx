import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import {
  Tv,
  FolderGit2,
  Trash2,
  LogOut,
  ChevronDown,
  Plus,
} from 'lucide-react';

export const DesktopSidebar: React.FC = () => {
  const { user, spaces, activeSpace, activeRole, setActiveSpaceId, signOut } = useAuth();

  return (
    <aside className="w-64 bg-tv-card border-r border-tv-border flex flex-col justify-between h-screen sticky top-0 flex-shrink-0 select-none">
      <div>
        {/* App Branding */}
        <div className="p-5 flex items-center space-x-3 border-b border-tv-border/70">
          <div className="w-10 h-10 rounded-xl bg-tv-elevated border border-tv-cyan/40 flex items-center justify-center text-tv-cyan shadow-lg shadow-tv-cyan/10">
            <Tv className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-bold text-sm text-tv-textLight tracking-tight">Family Files</h1>
            <p className="text-[10px] text-tv-textMuted uppercase tracking-wider font-semibold">
              Android TV Companion
            </p>
          </div>
        </div>

        {/* Space Switcher */}
        <div className="p-4 border-b border-tv-border/50">
          <label className="block text-[10px] font-bold uppercase tracking-wider text-tv-textMuted mb-1.5">
            Active Space
          </label>
          <div className="relative">
            <select
              value={activeSpace?.id || ''}
              onChange={(e) => setActiveSpaceId(e.target.value)}
              className="w-full appearance-none bg-tv-bg border border-tv-border hover:border-tv-cyan/50 text-tv-textLight text-xs rounded-xl px-3 py-2.5 pr-8 focus:outline-none focus:border-tv-cyan transition-colors truncate font-medium cursor-pointer"
            >
              {spaces.map((sp) => (
                <option key={sp.id} value={sp.id}>
                  {sp.name}
                </option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 text-tv-textMuted absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="p-3 space-y-1 text-sm font-medium">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `flex items-center space-x-3 px-3.5 py-2.5 rounded-xl transition-colors ${
                isActive
                  ? 'bg-tv-elevated text-tv-cyan font-semibold border-l-4 border-tv-cyan shadow-sm'
                  : 'text-tv-textMuted hover:text-tv-textLight hover:bg-tv-elevated/60'
              }`
            }
          >
            <FolderGit2 className="w-4 h-4 flex-shrink-0" />
            <span>Library</span>
          </NavLink>

          <NavLink
            to="/pair"
            className={({ isActive }) =>
              `flex items-center space-x-3 px-3.5 py-2.5 rounded-xl transition-colors ${
                isActive
                  ? 'bg-tv-elevated text-tv-cyan font-semibold border-l-4 border-tv-cyan shadow-sm'
                  : 'text-tv-textMuted hover:text-tv-textLight hover:bg-tv-elevated/60'
              }`
            }
          >
            <Plus className="w-4 h-4 flex-shrink-0" />
            <span>Pair Android TV</span>
          </NavLink>

          <NavLink
            to="/devices"
            className={({ isActive }) =>
              `flex items-center space-x-3 px-3.5 py-2.5 rounded-xl transition-colors ${
                isActive
                  ? 'bg-tv-elevated text-tv-cyan font-semibold border-l-4 border-tv-cyan shadow-sm'
                  : 'text-tv-textMuted hover:text-tv-textLight hover:bg-tv-elevated/60'
              }`
            }
          >
            <Tv className="w-4 h-4 flex-shrink-0" />
            <span>TVs & PIN Lock</span>
          </NavLink>

          <NavLink
            to="/trash"
            className={({ isActive }) =>
              `flex items-center space-x-3 px-3.5 py-2.5 rounded-xl transition-colors ${
                isActive
                  ? 'bg-tv-elevated text-tv-cyan font-semibold border-l-4 border-tv-cyan shadow-sm'
                  : 'text-tv-textMuted hover:text-tv-textLight hover:bg-tv-elevated/60'
              }`
            }
          >
            <Trash2 className="w-4 h-4 flex-shrink-0" />
            <span>Trash (30 Days)</span>
          </NavLink>
        </nav>
      </div>

      {/* User Footer */}
      <div className="p-4 border-t border-tv-border/70 bg-tv-bg/40">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2.5 truncate">
            {user?.user_metadata?.avatar_url ? (
              <img
                src={user.user_metadata.avatar_url}
                alt="Avatar"
                className="w-8 h-8 rounded-full border border-tv-cyan/40 object-cover flex-shrink-0"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-tv-cyan/20 border border-tv-cyan/40 text-tv-cyan font-bold flex items-center justify-center text-xs flex-shrink-0">
                {(user?.email?.[0] || 'U').toUpperCase()}
              </div>
            )}
            <div className="truncate">
              <p className="text-xs font-semibold text-tv-textLight truncate">
                {user?.user_metadata?.full_name || user?.email?.split('@')[0]}
              </p>
              <p className="text-[10px] text-tv-textMuted uppercase font-mono">
                {activeRole || 'Member'}
              </p>
            </div>
          </div>

          <button
            onClick={() => signOut()}
            className="p-1.5 text-tv-textMuted hover:text-tv-danger hover:bg-tv-dangerBg rounded-lg transition-colors"
            title="Sign Out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
};
