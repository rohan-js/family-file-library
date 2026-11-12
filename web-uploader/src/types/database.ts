export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type UserRole = 'owner' | 'admin' | 'member';
export type InviteStatus = 'pending' | 'accepted' | 'rejected' | 'expired';
export type DeviceType = 'android_tv' | 'phone' | 'tablet' | 'web';
export type PairingStatus = 'pending' | 'approved' | 'claimed' | 'expired' | 'rejected';
export type FileCategory = 'pdf' | 'image' | 'office' | 'text' | 'other';
export type ConversionStatus = 'pending' | 'processing' | 'ready' | 'failed' | 'not_applicable';

export interface Database {
  public: {
    Tables: {
      spaces: {
        Row: {
          id: string;
          name: string;
          created_by: string | null;
          pin_hash: string | null;
          pin_updated_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          created_by?: string | null;
          pin_hash?: string | null;
          pin_updated_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          created_by?: string | null;
          pin_hash?: string | null;
          pin_updated_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      members: {
        Row: {
          id: string;
          space_id: string;
          user_id: string;
          role: UserRole;
          display_name: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          space_id: string;
          user_id: string;
          role?: UserRole;
          display_name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          space_id?: string;
          user_id?: string;
          role?: UserRole;
          display_name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      invites: {
        Row: {
          id: string;
          space_id: string;
          email: string;
          invited_by: string;
          role: 'admin' | 'member';
          status: InviteStatus;
          token: string;
          expires_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          space_id: string;
          email: string;
          invited_by: string;
          role?: 'admin' | 'member';
          status?: InviteStatus;
          token?: string;
          expires_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          space_id?: string;
          email?: string;
          invited_by?: string;
          role?: 'admin' | 'member';
          status?: InviteStatus;
          token?: string;
          expires_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      devices: {
        Row: {
          id: string;
          space_id: string;
          device_identifier: string;
          device_name: string;
          device_type: DeviceType;
          auth_user_id: string | null;
          device_token_hash: string;
          last_seen_at: string | null;
          paired_by: string | null;
          paired_at: string;
          is_revoked: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          space_id: string;
          device_identifier: string;
          device_name: string;
          device_type?: DeviceType;
          auth_user_id?: string | null;
          device_token_hash: string;
          last_seen_at?: string | null;
          paired_by?: string | null;
          paired_at?: string;
          is_revoked?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          space_id?: string;
          device_identifier?: string;
          device_name?: string;
          device_type?: DeviceType;
          auth_user_id?: string | null;
          device_token_hash?: string;
          last_seen_at?: string | null;
          paired_by?: string | null;
          paired_at?: string;
          is_revoked?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      pairing_codes: {
        Row: {
          id: string;
          code: string;
          device_identifier: string;
          device_name: string;
          device_secret_hash: string;
          status: PairingStatus;
          space_id: string | null;
          approved_by: string | null;
          device_credentials: {
            device_id: string;
            space_id: string;
            device_token: string;
          } | null;
          expires_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          code: string;
          device_identifier: string;
          device_name?: string;
          device_secret_hash: string;
          status?: PairingStatus;
          space_id?: string | null;
          approved_by?: string | null;
          device_credentials?: Json | null;
          expires_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          code?: string;
          device_identifier?: string;
          device_name?: string;
          device_secret_hash?: string;
          status?: PairingStatus;
          space_id?: string | null;
          approved_by?: string | null;
          device_credentials?: Json | null;
          expires_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      folders: {
        Row: {
          id: string;
          space_id: string;
          parent_id: string | null;
          name: string;
          color: string | null;
          icon: string | null;
          created_by: string | null;
          deleted_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          space_id: string;
          parent_id?: string | null;
          name: string;
          color?: string | null;
          icon?: string | null;
          created_by?: string | null;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          space_id?: string;
          parent_id?: string | null;
          name?: string;
          color?: string | null;
          icon?: string | null;
          created_by?: string | null;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      files: {
        Row: {
          id: string;
          space_id: string;
          folder_id: string | null;
          name: string;
          file_type: string;
          file_category: FileCategory;
          size_bytes: number;
          storage_path: string;
          pdf_path: string | null;
          text_content: string | null;
          conversion_status: ConversionStatus;
          conversion_error: string | null;
          uploader_id: string | null;
          uploader_name: string;
          view_count: number;
          last_viewed_at: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
          created_at: string;
          updated_at: string;
          fts: unknown | null;
        };
        Insert: {
          id?: string;
          space_id: string;
          folder_id?: string | null;
          name: string;
          file_type: string;
          file_category: FileCategory;
          size_bytes: number;
          storage_path: string;
          pdf_path?: string | null;
          text_content?: string | null;
          conversion_status?: ConversionStatus;
          conversion_error?: string | null;
          uploader_id?: string | null;
          uploader_name?: string;
          view_count?: number;
          last_viewed_at?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          space_id?: string;
          folder_id?: string | null;
          name?: string;
          file_type?: string;
          file_category?: FileCategory;
          size_bytes?: number;
          storage_path?: string;
          pdf_path?: string | null;
          text_content?: string | null;
          conversion_status?: ConversionStatus;
          conversion_error?: string | null;
          uploader_id?: string | null;
          uploader_name?: string;
          view_count?: number;
          last_viewed_at?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      notes: {
        Row: {
          id: string;
          space_id: string;
          file_id: string | null;
          folder_id: string | null;
          author_id: string | null;
          author_device_id: string | null;
          author_name: string;
          content: string;
          page_number: number | null;
          deleted_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          space_id: string;
          file_id?: string | null;
          folder_id?: string | null;
          author_id?: string | null;
          author_device_id?: string | null;
          author_name?: string;
          content: string;
          page_number?: number | null;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          space_id?: string;
          file_id?: string | null;
          folder_id?: string | null;
          author_id?: string | null;
          author_device_id?: string | null;
          author_name?: string;
          content?: string;
          page_number?: number | null;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      favorites: {
        Row: {
          id: string;
          space_id: string;
          file_id: string;
          user_id: string | null;
          device_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          space_id: string;
          file_id: string;
          user_id?: string | null;
          device_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          space_id?: string;
          file_id?: string;
          user_id?: string | null;
          device_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      bookmarks: {
        Row: {
          id: string;
          space_id: string;
          file_id: string;
          user_id: string | null;
          device_id: string | null;
          page_number: number;
          scroll_position: number;
          label: string | null;
          is_last_read: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          space_id: string;
          file_id: string;
          user_id?: string | null;
          device_id?: string | null;
          page_number: number;
          scroll_position?: number;
          label?: string | null;
          is_last_read?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          space_id?: string;
          file_id?: string;
          user_id?: string | null;
          device_id?: string | null;
          page_number?: number;
          scroll_position?: number;
          label?: string | null;
          is_last_read?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      view_active_files: {
        Row: Database['public']['Tables']['files']['Row'];
        Relationships: [];
      };
      view_trash_files: {
        Row: Database['public']['Tables']['files']['Row'] & {
          days_remaining: number;
        };
        Relationships: [];
      };
      view_continue_reading: {
        Row: {
          bookmark_id: string;
          space_id: string;
          file_id: string;
          device_id: string | null;
          page_number: number;
          scroll_position: number;
          read_at: string;
          file_name: string;
          file_type: string;
          file_category: FileCategory;
          pdf_path: string | null;
          storage_path: string;
        };
        Relationships: [];
      };
    };
    Functions: {
      request_tv_pairing_code: {
        Args: {
          p_device_identifier: string;
          p_device_name?: string;
        };
        Returns: {
          code: string;
          device_secret: string;
          expires_at: string;
        };
      };
      approve_tv_pairing_code: {
        Args: {
          p_code: string;
          p_space_id: string;
        };
        Returns: {
          success: boolean;
          device_id: string;
          device_name: string;
        };
      };
      claim_tv_pairing_code: {
        Args: {
          p_device_identifier: string;
          p_device_secret: string;
        };
        Returns: {
          status: 'pending' | 'approved' | 'claimed' | 'expired' | 'not_found';
          device_id?: string;
          space_id?: string;
          device_token?: string;
        };
      };
      accept_space_invite: {
        Args: {
          p_token: string;
        };
        Returns: {
          success: boolean;
          space_id: string;
          member_id: string;
          role: string;
        };
      };
      health_check_ping: {
        Args: Record<string, never>;
        Returns: {
          status: string;
          timestamp: string;
          active_spaces_count: number;
          trash_files_purged: number;
          trash_folders_purged: number;
        };
      };
      cleanup_expired_trash: {
        Args: Record<string, never>;
        Returns: Array<{
          purged_files_count: number;
          purged_folders_count: number;
        }>;
      };
    };
  };
}
