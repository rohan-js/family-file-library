import { supabase } from './supabase';
import { hashTvPin } from './crypto';
import type { UserRole } from '../types/database';

export function canManagePin(role: UserRole | string | null | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

export async function setOrUpdateTvPin(spaceId: string, newPin: string): Promise<void> {
  const pinHash = await hashTvPin(newPin, spaceId);
  const nowIso = new Date().toISOString();

  const { error } = await supabase
    .from('spaces')
    .update({
      pin_hash: pinHash,
      pin_updated_at: nowIso,
    })
    .eq('id', spaceId);

  if (error) throw error;
}

export async function clearTvPin(spaceId: string): Promise<void> {
  const nowIso = new Date().toISOString();

  const { error } = await supabase
    .from('spaces')
    .update({
      pin_hash: null,
      pin_updated_at: nowIso,
    })
    .eq('id', spaceId);

  if (error) throw error;
}
