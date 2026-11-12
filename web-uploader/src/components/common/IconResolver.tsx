import React from 'react';
import {
  Folder,
  Book,
  Film,
  Image as ImageIcon,
  Music,
  FileText,
  Briefcase,
  Heart,
  Star,
  Shield,
  Archive,
  File,
  FileCode,
  Presentation,
} from 'lucide-react';
import type { FileCategory } from '../../types/database';

export const FOLDER_ICONS: Record<
  string,
  React.ComponentType<{ className?: string; style?: React.CSSProperties }>
> = {
  folder: Folder,
  book: Book,
  film: Film,
  image: ImageIcon,
  music: Music,
  'file-text': FileText,
  briefcase: Briefcase,
  heart: Heart,
  star: Star,
  shield: Shield,
  archive: Archive,
};

export const FILE_CATEGORY_ICONS: Record<
  FileCategory,
  React.ComponentType<{ className?: string; style?: React.CSSProperties }>
> = {
  pdf: FileText,
  image: ImageIcon,
  office: Presentation,
  text: FileCode,
  other: File,
};

export function resolveFolderIcon(
  iconName: string | null | undefined
): React.ComponentType<{ className?: string; style?: React.CSSProperties }> {
  if (iconName && FOLDER_ICONS[iconName]) {
    return FOLDER_ICONS[iconName];
  }
  return Folder;
}

export function resolveCategoryIcon(
  category: FileCategory | string | null | undefined
): React.ComponentType<{ className?: string; style?: React.CSSProperties }> {
  if (category && (category in FILE_CATEGORY_ICONS)) {
    return FILE_CATEGORY_ICONS[category as FileCategory];
  }
  return File;
}
