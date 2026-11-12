import React from 'react';
import { useAuth } from '../../hooks/useAuth';
import { Tv, ChevronDown, LogOut } from 'lucide-react';

export const MobileHeader: React.FC = () => {
  const { user, spaces, activeSpace, setActiveSpaceId, signOut } = useAuth();

  return (
    <header className="md:hidden bg-tv-card/90 backdrop-blur-md border-b border-tv-border sticky top-0 z-30 px-4 py-3 flex items-center justify-between">
      <div className="flex items-center space-x-2.5 truncate">
        <div className="w-8 h-8 rounded-lg bg-tv-elevated border border-tv-cyan/30 flex items-center justify-center text-tv-cyan flex-shrink-0">
          <Tv className="w-4 h-4" />
        </div>

        {/* Space Selector Dropdown */}
        <div className="relative truncate">
          <select
            value={activeSpace?.id || ''}
            onChange={(e) => setActiveSpaceId(e.target.value)}
            className="appearance-none bg-tv-elevated border border-tv-border text-tv-textLight text-xs rounded-lg px-2.5 py-1.5 pr-6 font-semibold focus:outline-none focus:border-tv-cyan max-w-[170px] truncate"
          >
            {spaces.map((sp) => (
              <option key={sp.id} value={sp.id}>
                {sp.name}
              </option>
            ))}
          </select>
          <ChevronDown className="w-3.5 h-3.5 text-tv-textMuted absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
      </div>

      <div className="flex items-center space-x-2 flex-shrink-0">
        {user?.user_metadata?.avatar_url ? (
          <img
            src={user.user_metadata.avatar_url}
            alt="User"
            className="w-7 h-7 rounded-full border border-tv-cyan/30 object-cover"
          />
        ) : (
          <div className="w-7 h-7 rounded-full bg-tv-cyan/20 border border-tv-cyan/30 text-tv-cyan font-bold flex items-center justify-center text-[10px]">
            {(user?.email?.[0] || 'U').toUpperCase()}
          </div>
        )}
        <button
          onClick={() => signOut()}
          className="p-1.5 text-tv-textMuted hover:text-tv-danger rounded-lg transition-colors"
          title="Sign Out"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
