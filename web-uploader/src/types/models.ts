import type { Database } from './database';

export type Space = Database['public']['Tables']['spaces']['Row'];
export type Member = Database['public']['Tables']['members']['Row'];
export type Device = Database['public']['Tables']['devices']['Row'];
export type Folder = Database['public']['Tables']['folders']['Row'];
export type LibraryFile = Database['public']['Tables']['files']['Row'];
export type Note = Database['public']['Tables']['notes']['Row'];
export type Bookmark = Database['public']['Tables']['bookmarks']['Row'];
export type Favorite = Database['public']['Tables']['favorites']['Row'];

export interface SpaceWithMembership extends Space {
  role: 'owner' | 'admin' | 'member';
  display_name: string | null;
}
