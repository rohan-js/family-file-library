/**
 * supabase_mock.js - In-memory PostgREST + RPC + Storage mock.
 */

const {
  sha256,
  generatePairingCode,
  generateDeviceSecret,
  generateBearerToken,
  randomUUID,
} = require('./crypto_helper');

const MAX_STORAGE_FILE_SIZE = 52428800; // 50MB (50 * 1024 * 1024)

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/markdown',
  'text/csv',
]);

class MockQueryBuilder {
  constructor(table, rows) {
    this.table = table;
    this.rows = rows;
    this.filters = [];
    this.selectedFields = null;
    this._isSingle = false;
    this._order = null;
    this._limit = null;
    this._range = null;
  }

  select(fields = '*') {
    this.selectedFields = fields;
    return this;
  }

  eq(column, value) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  neq(column, value) {
    this.filters.push((row) => row[column] !== value);
    return this;
  }

  is(column, value) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  in(column, values) {
    const set = new Set(values);
    this.filters.push((row) => set.has(row[column]));
    return this;
  }

  gt(column, value) {
    this.filters.push((row) => row[column] > value);
    return this;
  }

  gte(column, value) {
    this.filters.push((row) => row[column] >= value);
    return this;
  }

  lt(column, value) {
    this.filters.push((row) => row[column] < value);
    return this;
  }

  lte(column, value) {
    this.filters.push((row) => row[column] <= value);
    return this;
  }

  like(column, pattern) {
    const regex = new RegExp('^' + pattern.replace(/%/g, '.*').replace(/_/g, '.') + '$');
    this.filters.push((row) => typeof row[column] === 'string' && regex.test(row[column]));
    return this;
  }

  ilike(column, pattern) {
    const regex = new RegExp('^' + pattern.replace(/%/g, '.*').replace(/_/g, '.') + '$', 'i');
    this.filters.push((row) => typeof row[column] === 'string' && regex.test(row[column]));
    return this;
  }

  order(column, { ascending = true } = {}) {
    this._order = { column, ascending };
    return this;
  }

  limit(count) {
    this._limit = count;
    return this;
  }

  range(from, to) {
    this._range = { from, to };
    return this;
  }

  single() {
    this._isSingle = true;
    return this;
  }

  async execute() {
    let result = this.rows.filter((row) => this.filters.every((f) => f(row)));

    if (this._order) {
      const { column, ascending } = this._order;
      result = [...result].sort((a, b) => {
        const valA = a[column];
        const valB = b[column];
        if (valA === valB) return 0;
        if (valA === null || valA === undefined) return ascending ? -1 : 1;
        if (valB === null || valB === undefined) return ascending ? 1 : -1;
        if (valA < valB) return ascending ? -1 : 1;
        return ascending ? 1 : -1;
      });
    }

    if (this._range) {
      result = result.slice(this._range.from, this._range.to + 1);
    } else if (this._limit !== null && this._limit !== undefined) {
      result = result.slice(0, this._limit);
    }

    if (this.selectedFields && this.selectedFields !== '*') {
      const fields = this.selectedFields.split(',').map((f) => f.trim());
      result = result.map((row) => {
        const projected = {};
        for (const f of fields) {
          projected[f] = row[f];
        }
        return projected;
      });
    }

    if (this._isSingle) {
      if (result.length === 0) {
        return { data: null, error: { message: 'Row not found', code: 'PGRST116' }, status: 404 };
      }
      return { data: { ...result[0] }, error: null, status: 200 };
    }

    return { data: result.map((r) => ({ ...r })), error: null, status: 200 };
  }

  then(resolve, reject) {
    return this.execute().then(resolve, reject);
  }
}

class SupabaseMockClient {
  constructor() {
    this.reset();
  }

  reset() {
    this.tables = {
      spaces: [],
      members: [],
      invites: [],
      devices: [],
      pairing_codes: [],
      folders: [],
      files: [],
      notes: [],
      favorites: [],
      bookmarks: [],
    };
    this.storage = new Map(); // path -> { buffer, sizeBytes, mimeType, createdAt }
    this.realtimeSubscribers = new Set();
  }

  from(tableName) {
    // Dynamic view resolution
    if (tableName === 'view_active_files') {
      const activeRows = (this.tables.files || []).filter((f) => !f.deleted_at);
      return new MockQueryBuilder(tableName, activeRows);
    }

    if (tableName === 'view_trash_files') {
      const now = Date.now();
      const trashRows = (this.tables.files || [])
        .filter((f) => f.deleted_at)
        .map((f) => {
          const daysRemaining = Math.max(
            0,
            Math.ceil((new Date(f.deleted_at).getTime() + 30 * 86400 * 1000 - now) / (86400 * 1000))
          );
          return {
            ...f,
            days_remaining: daysRemaining,
          };
        });
      return new MockQueryBuilder(tableName, trashRows);
    }

    if (tableName === 'view_continue_reading') {
      const activeFiles = new Map((this.tables.files || []).filter((f) => !f.deleted_at).map((f) => [f.id, f]));
      const bookmarks = (this.tables.bookmarks || []).filter((b) => b.is_last_read && activeFiles.has(b.file_id));

      const rows = bookmarks.map((b) => {
        const file = activeFiles.get(b.file_id);
        return {
          id: b.id,
          bookmark_id: b.id,
          file_id: b.file_id,
          space_id: b.space_id,
          user_id: b.user_id,
          device_id: b.device_id,
          page_number: b.page_number,
          scroll_position: b.scroll_position,
          label: b.label,
          is_last_read: b.is_last_read,
          file_name: file.name,
          name: file.name,
          file_type: file.file_type,
          file_category: file.file_category,
          size_bytes: file.size_bytes,
          storage_path: file.storage_path,
          read_at: b.updated_at || b.created_at,
          created_at: b.created_at,
          updated_at: b.updated_at,
        };
      });

      // Default sort by read_at descending
      rows.sort((a, b) => new Date(b.read_at).getTime() - new Date(a.read_at).getTime());
      return new MockQueryBuilder(tableName, rows);
    }

    if (!this.tables[tableName]) {
      this.tables[tableName] = [];
    }
    const rows = this.tables[tableName];

    return {
      select: (fields) => new MockQueryBuilder(tableName, rows).select(fields),

      insert: (data) => {
        const items = Array.isArray(data) ? data : [data];
        const inserted = items.map((item) => {
          const row = {
            id: item.id || randomUUID(),
            created_at: item.created_at || new Date().toISOString(),
            ...item,
          };
          rows.push(row);
          this._emitRealtime('INSERT', tableName, row);
          return row;
        });

        const defaultResult = { data: Array.isArray(data) ? inserted : inserted[0], error: null, status: 201 };

        return {
          then(resolve, reject) {
            return Promise.resolve(defaultResult).then(resolve, reject);
          },
          select(fields = '*') {
            return new MockQueryBuilder(tableName, inserted).select(fields);
          },
        };
      },

      update: (data) => ({
        eq: (col, val) => {
          const updated = [];
          for (const row of rows) {
            if (row[col] === val) {
              Object.assign(row, data, { updated_at: new Date().toISOString() });
              updated.push(row);
              this._emitRealtime('UPDATE', tableName, row);
            }
          }
          const defaultResult = { data: updated, error: null, status: 200 };
          return {
            then(resolve, reject) {
              return Promise.resolve(defaultResult).then(resolve, reject);
            },
            select(fields = '*') {
              return new MockQueryBuilder(tableName, updated).select(fields);
            },
            single() {
              return new MockQueryBuilder(tableName, updated).single();
            },
          };
        },
      }),

      delete: () => ({
        eq: (col, val) => {
          const remaining = [];
          const deleted = [];
          for (const row of rows) {
            if (row[col] === val) {
              deleted.push(row);
              this._emitRealtime('DELETE', tableName, row);
            } else {
              remaining.push(row);
            }
          }
          this.tables[tableName] = remaining;
          const defaultResult = { data: deleted, error: null, status: 200 };
          return {
            then(resolve, reject) {
              return Promise.resolve(defaultResult).then(resolve, reject);
            },
            select(fields = '*') {
              return new MockQueryBuilder(tableName, deleted).select(fields);
            },
          };
        },
      }),
    };
  }

  getPublicationTables(pubName = 'supabase_realtime') {
    return ['files', 'folders', 'notes', 'favorites', 'bookmarks', 'pairing_codes'];
  }

  getReplicaIdentity(tableName) {
    return 'full';
  }

  async rpc(fnName, params = {}) {
    switch (fnName) {
      case 'request_tv_pairing_code': {
        const { p_device_identifier, p_device_name } = params;
        if (!p_device_identifier) {
          return { data: null, error: { message: 'Missing p_device_identifier' }, status: 400 };
        }
        const code = generatePairingCode();
        const secret = generateDeviceSecret();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

        this.tables.pairing_codes.push({
          id: randomUUID(),
          device_identifier: p_device_identifier,
          device_name: p_device_name || 'Living Room TV',
          code,
          device_secret_hash: sha256(secret),
          status: 'pending',
          expires_at: expiresAt,
          space_id: null,
          device_id: null,
          device_token: null,
        });

        return {
          data: {
            code,
            device_secret: secret,
            expires_at: expiresAt,
          },
          error: null,
          status: 200,
        };
      }

      case 'approve_tv_pairing_code': {
        const { p_code, p_space_id } = params;
        const normalizedCode = p_code ? String(p_code).replace(/[^A-Za-z0-9]/g, '').toUpperCase() : '';
        const now = new Date();
        const record = this.tables.pairing_codes.find(
          (c) =>
            c.code === normalizedCode &&
            c.status === 'pending' &&
            (!c.expires_at || new Date(c.expires_at) > now)
        );
        if (!record) {
          return { data: null, error: { message: 'Invalid or expired pairing code' }, status: 404 };
        }

        const deviceId = randomUUID();
        const deviceToken = generateBearerToken();

        record.status = 'approved';
        record.space_id = p_space_id;
        record.device_id = deviceId;
        record.device_token = deviceToken;

        // Register in devices table
        this.tables.devices.push({
          id: deviceId,
          space_id: p_space_id,
          device_identifier: record.device_identifier,
          device_name: record.device_name,
          device_token_hash: sha256(deviceToken),
          token_hash: sha256(deviceToken),
          created_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
          last_active_at: new Date().toISOString(),
          is_revoked: false,
          revoked_at: null,
        });

        return {
          data: {
            success: true,
            device_id: deviceId,
            device_name: record.device_name,
          },
          error: null,
          status: 200,
        };
      }

      case 'claim_tv_pairing_code': {
        const { p_device_identifier, p_device_secret } = params;
        const secretHash = sha256(p_device_secret);
        const recordIndex = this.tables.pairing_codes.findIndex(
          (c) => c.device_identifier === p_device_identifier && c.device_secret_hash === secretHash
        );

        if (recordIndex === -1) {
          return {
            data: { status: 'not_found', device_id: null, space_id: null, device_token: null },
            error: null,
            status: 200,
          };
        }

        const record = this.tables.pairing_codes[recordIndex];
        if (new Date(record.expires_at) < new Date()) {
          return {
            data: { status: 'expired', device_id: null, space_id: null, device_token: null },
            error: null,
            status: 200,
          };
        }

        if (record.status !== 'approved') {
          return {
            data: { status: record.status || 'pending', device_id: null, space_id: null, device_token: null },
            error: null,
            status: 200,
          };
        }

        const responseData = {
          status: 'approved',
          device_id: record.device_id,
          space_id: record.space_id,
          device_token: record.device_token,
        };

        // Scramble secret after successful claim to prevent replay
        record.status = 'claimed';
        record.device_secret_hash = null;

        return { data: responseData, error: null, status: 200 };
      }

      case 'accept_space_invite': {
        const { p_token, p_user_id, p_user_email, p_display_name } = params;
        const invite = this.tables.invites.find(
          (inv) => inv.token === p_token && inv.status === 'pending'
        );

        if (!invite) {
          return { data: null, error: { message: 'Invite not found or already used' }, status: 404 };
        }

        if (new Date(invite.expires_at) < new Date()) {
          invite.status = 'expired';
          return { data: null, error: { message: 'Invitation expired' }, status: 400 };
        }

        invite.status = 'accepted';
        invite.accepted_at = new Date().toISOString();

        const role = invite.role || 'member';
        const member = {
          id: randomUUID(),
          space_id: invite.space_id,
          user_id: p_user_id,
          email: p_user_email || invite.email,
          role,
          display_name: p_display_name || 'Member',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        this.tables.members.push(member);

        return {
          data: {
            success: true,
            space_id: invite.space_id,
            role,
          },
          error: null,
          status: 200,
        };
      }

      case 'has_space_access': {
        const { p_space_id, p_user_id, p_device_token } = params;
        if (p_user_id) {
          const isMember = this.tables.members.some(
            (m) => m.space_id === p_space_id && m.user_id === p_user_id
          );
          if (isMember) {
            return { data: true, error: null, status: 200 };
          }
        }

        if (p_device_token) {
          const tokenHash = sha256(p_device_token);
          const hasDevice = this.tables.devices.some(
            (d) =>
              d.space_id === p_space_id &&
              (d.device_token_hash === tokenHash || d.token_hash === tokenHash) &&
              !d.is_revoked &&
              !d.revoked_at
          );
          if (hasDevice) {
            return { data: true, error: null, status: 200 };
          }
        }

        return { data: false, error: null, status: 200 };
      }

      case 'is_space_member_user': {
        const { p_space_id, p_user_id } = params;
        const isMember = this.tables.members.some(
          (m) => m.space_id === p_space_id && m.user_id === p_user_id
        );
        return { data: Boolean(isMember), error: null, status: 200 };
      }

      case 'is_space_admin': {
        const { p_space_id, p_user_id } = params;
        const member = this.tables.members.find(
          (m) => m.space_id === p_space_id && m.user_id === p_user_id
        );
        const isAdmin = Boolean(member && (member.role === 'owner' || member.role === 'admin'));
        return { data: isAdmin, error: null, status: 200 };
      }

      case 'get_auth_device_id': {
        const { p_device_token } = params;
        const tokenHash = sha256(p_device_token);
        const dev = this.tables.devices.find(
          (d) =>
            (d.device_token_hash === tokenHash || d.token_hash === tokenHash) &&
            !d.is_revoked &&
            !d.revoked_at
        );
        return { data: dev ? dev.id : null, error: null, status: 200 };
      }

      case 'cleanup_expired_trash': {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        let filesPurged = 0;
        let foldersPurged = 0;

        const filesToPurge = [];
        this.tables.files = this.tables.files.filter((f) => {
          if (f.deleted_at && new Date(f.deleted_at) < thirtyDaysAgo) {
            filesPurged++;
            filesToPurge.push(f);
            return false;
          }
          return true;
        });

        // Also purge objects from storage
        for (const file of filesToPurge) {
          if (file.storage_path) {
            this.storage.delete(file.storage_path);
          }
          if (file.pdf_path) {
            this.storage.delete(file.pdf_path);
          }
        }

        const purgedFolderIds = new Set();
        this.tables.folders = this.tables.folders.filter((fo) => {
          if (fo.deleted_at && new Date(fo.deleted_at) < thirtyDaysAgo) {
            foldersPurged++;
            purgedFolderIds.add(fo.id);
            return false;
          }
          return true;
        });

        // Cascade deletion to child rows matching purged file IDs and folder IDs
        const purgedFileIds = new Set(filesToPurge.map((f) => f.id));
        if (purgedFileIds.size > 0) {
          if (this.tables.bookmarks) {
            this.tables.bookmarks = this.tables.bookmarks.filter((b) => !purgedFileIds.has(b.file_id));
          }
          if (this.tables.favorites) {
            this.tables.favorites = this.tables.favorites.filter((fav) => !purgedFileIds.has(fav.file_id));
          }
          if (this.tables.notes) {
            this.tables.notes = this.tables.notes.filter((n) => !purgedFileIds.has(n.file_id));
          }
        }
        if (purgedFolderIds.size > 0 && this.tables.notes) {
          this.tables.notes = this.tables.notes.filter((n) => !purgedFolderIds.has(n.folder_id));
        }

        return {
          data: { files_purged: filesPurged, folders_purged: foldersPurged },
          error: null,
          status: 200,
        };
      }

      case 'health_check_ping': {
        const cleanupRes = await this.rpc('cleanup_expired_trash');
        return {
          data: {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            active_spaces_count: this.tables.spaces.length,
            trash_files_purged: cleanupRes.data.files_purged,
            trash_folders_purged: cleanupRes.data.folders_purged,
          },
          error: null,
          status: 200,
        };
      }

      default:
        return { data: null, error: { message: `Unknown RPC: ${fnName}` }, status: 404 };
    }
  }

  // Storage Mock API
  get storageClient() {
    return {
      from: (bucketName) => {
        if (bucketName !== 'family-files') {
          throw new Error(`Bucket "${bucketName}" not found`);
        }
        return {
          upload: async (filePath, fileBuffer, options = {}) => {
            const size = Buffer.isBuffer(fileBuffer) ? fileBuffer.length : fileBuffer?.byteLength || 0;
            const contentType = options.contentType || 'application/octet-stream';

            // 1. Enforce max size limit (50MB)
            if (size > MAX_STORAGE_FILE_SIZE) {
              return {
                data: null,
                error: { message: `Payload too large. Exceeds 50MB (${MAX_STORAGE_FILE_SIZE} bytes).`, code: '413' },
                status: 413,
              };
            }

            // 2. Validate space prefix (<space_id>/...) and sanitize against path traversal
            if (!filePath || typeof filePath !== 'string') {
              return {
                data: null,
                error: { message: 'Storage path must start with <space_id>/ prefix', code: '403' },
                status: 403,
              };
            }
            const normalizedPath = filePath.replace(/\\/g, '/');
            if (normalizedPath.startsWith('/')) {
              return {
                data: null,
                error: { message: 'Storage path must start with <space_id>/ prefix', code: '403' },
                status: 403,
              };
            }
            const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            const segments = normalizedPath.split('/').filter(Boolean);
            if (
              segments.includes('..') ||
              segments.includes('.') ||
              segments.length < 2 ||
              !UUID_REGEX.test(segments[0])
            ) {
              return {
                data: null,
                error: {
                  message: 'Storage path must start with valid <space_id>/ UUID prefix without traversal',
                  code: '403',
                },
                status: 403,
              };
            }

            // 3. MIME validation (if whitelisted format check)
            if (contentType && !ALLOWED_MIME_TYPES.has(contentType) && contentType !== 'application/octet-stream') {
              return {
                data: null,
                error: { message: `MIME type "${contentType}" not allowed in bucket policy`, code: '400' },
                status: 400,
              };
            }

            this.storage.set(filePath, {
              buffer: fileBuffer,
              sizeBytes: size,
              mimeType: contentType,
              createdAt: new Date().toISOString(),
            });

            return { data: { path: filePath }, error: null, status: 200 };
          },

          download: async (filePath) => {
            const item = this.storage.get(filePath);
            if (!item) {
              return { data: null, error: { message: 'Object not found' }, status: 404 };
            }
            return { data: item.buffer, error: null, status: 200 };
          },

          remove: async (paths) => {
            const pathList = Array.isArray(paths) ? paths : [paths];
            for (const p of pathList) {
              this.storage.delete(p);
            }
            return { data: pathList, error: null, status: 200 };
          },

          createSignedUrl: async (filePath, expiresIn = 3600) => {
            return {
              data: { signedUrl: `https://mock-storage.supabase.co/object/sign/family-files/${filePath}?token=mock_signed_${expiresIn}` },
              error: null,
              status: 200,
            };
          },
        };
      },
    };
  }

  _emitRealtime(event, table, record) {
    for (const sub of this.realtimeSubscribers) {
      if (sub.table === '*' || sub.table === table) {
        sub.callback({ event, table, record });
      }
    }
  }

  subscribeRealtime(table, callback) {
    const sub = { table, callback };
    this.realtimeSubscribers.add(sub);
    return () => this.realtimeSubscribers.delete(sub);
  }
}

module.exports = {
  MAX_STORAGE_FILE_SIZE,
  ALLOWED_MIME_TYPES,
  SupabaseMockClient,
};
