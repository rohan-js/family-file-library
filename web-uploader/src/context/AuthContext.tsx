import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { SpaceWithMembership } from '../types/models';
import type { Database, UserRole } from '../types/database';

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  spaces: SpaceWithMembership[];
  activeSpace: SpaceWithMembership | null;
  activeRole: UserRole | null;
  isAdmin: boolean;
  isOwner: boolean;
  setActiveSpaceId: (id: string) => void;
  refreshSpaces: (targetUserId?: string) => Promise<void>;
  createSpace: (name: string) => Promise<SpaceWithMembership>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function fetchUserSpaces(userId: string): Promise<SpaceWithMembership[]> {
  const { data, error } = await supabase
    .from('members')
    .select(`
      role,
      display_name,
      space_id,
      spaces (
        id,
        name,
        created_by,
        pin_hash,
        pin_updated_at,
        created_at,
        updated_at
      )
    `)
    .eq('user_id', userId);

  if (error) {
    console.error('[AuthContext] Error fetching user spaces:', error);
    throw error;
  }
  const rawRows = (data || []) as any[];

  return rawRows
    .filter((row) => row.spaces !== null)
    .map((row) => {
      const sp = row.spaces as Database['public']['Tables']['spaces']['Row'];
      return {
        ...sp,
        role: row.role as UserRole,
        display_name: row.display_name,
      };
    });
}

export async function createFamilySpace(
  spaceName: string,
  user: { id: string; user_metadata?: { full_name?: string } }
): Promise<SpaceWithMembership> {
  // Step 1: Create Space
  const { data: spaceData, error: spaceError } = await supabase
    .from('spaces')
    .insert({
      name: spaceName.trim(),
      created_by: user.id,
    })
    .select()
    .single();

  if (spaceError) throw spaceError;
  const space = spaceData as unknown as Database['public']['Tables']['spaces']['Row'];

  // Step 2: Establish Owner Membership
  const displayName = user.user_metadata?.full_name || 'Family Owner';
  const { error: memberError } = await supabase
    .from('members')
    .insert({
      space_id: space.id,
      user_id: user.id,
      role: 'owner',
      display_name: displayName,
    });

  if (memberError) {
    // Attempt cleanup of orphaned space if membership insert fails
    await supabase.from('spaces').delete().eq('id', space.id);
    throw memberError;
  }

  return {
    ...space,
    role: 'owner',
    display_name: displayName,
  };
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [spaces, setSpaces] = useState<SpaceWithMembership[]>([]);
  const [activeSpaceId, setActiveSpaceIdState] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('family_active_space_id');
    }
    return null;
  });

  const refreshSpaces = useCallback(
    async (targetUserId?: string) => {
      const uid = targetUserId || user?.id;
      if (!uid) {
        setSpaces([]);
        return;
      }
      try {
        const userSpaces = await fetchUserSpaces(uid);
        setSpaces(userSpaces);

        // Auto-select or maintain active space
        if (userSpaces.length > 0) {
          const stored = typeof window !== 'undefined' ? localStorage.getItem('family_active_space_id') : null;
          const exists = userSpaces.some((s) => s.id === stored);
          if (!exists || !stored) {
            const defaultId = userSpaces[0].id;
            setActiveSpaceIdState(defaultId);
            if (typeof window !== 'undefined') {
              localStorage.setItem('family_active_space_id', defaultId);
            }
          }
        } else {
          setActiveSpaceIdState(null);
          if (typeof window !== 'undefined') {
            localStorage.removeItem('family_active_space_id');
          }
        }
      } catch (err) {
        console.error('[AuthProvider] Failed to fetch spaces:', err);
      }
    },
    [user?.id]
  );

  useEffect(() => {
    // 1. Initial session check
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        refreshSpaces(session.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    // 2. Auth state subscription
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);

      if (event === 'SIGNED_IN' && newSession?.user) {
        await refreshSpaces(newSession.user.id);
      } else if (event === 'SIGNED_OUT') {
        setSpaces([]);
        setActiveSpaceIdState(null);
        if (typeof window !== 'undefined') {
          localStorage.removeItem('family_active_space_id');
        }
      }
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [refreshSpaces]);

  const setActiveSpaceId = (id: string) => {
    setActiveSpaceIdState(id);
    if (typeof window !== 'undefined') {
      localStorage.setItem('family_active_space_id', id);
    }
  };

  const activeSpace = useMemo(() => {
    return spaces.find((s) => s.id === activeSpaceId) || null;
  }, [spaces, activeSpaceId]);

  const activeRole = activeSpace?.role || null;
  const isAdmin = activeRole === 'owner' || activeRole === 'admin';
  const isOwner = activeRole === 'owner';

  const handleCreateSpace = async (name: string): Promise<SpaceWithMembership> => {
    if (!user) throw new Error('Must be logged in to create a space');
    const newSpace = await createFamilySpace(name, user);
    await refreshSpaces(user.id);
    setActiveSpaceId(newSpace.id);
    return newSpace;
  };

  const handleSignIn = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/`,
        queryParams: { access_type: 'offline', prompt: 'select_account' },
      },
    });
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        spaces,
        activeSpace,
        activeRole,
        isAdmin,
        isOwner,
        setActiveSpaceId,
        refreshSpaces,
        createSpace: handleCreateSpace,
        signInWithGoogle: handleSignIn,
        signOut: handleSignOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
