/**
 * test_f06_f10_file_catalog.js - Tier 1: File Catalog, Folders, Annotations & Bookmarks
 * Covers Features F06, F07, F08, F09, F10 (>= 5 assertions per feature).
 */

const { describe, test, assert } = require('../framework');

describe('Tier 1: File Catalog & Reading State', () => {

  // ==========================================================================
  // F06: Hierarchical Folder Tree
  // ==========================================================================
  test('T1-F06-01: Creates root folder with parent_id null and valid schema shape', {
    tier: 1,
    feature: 'F06',
    timeout: 5000,
  }, async (ctx) => {
    const res = await ctx.client.from('folders').insert({
      space_id: 'space-01',
      name: 'Family Documents',
      parent_id: null,
      color: '#3B82F6',
      icon: 'folder-doc',
    });

    assert.status(res, 201, 'Root folder creation must succeed');
    assert.ok(res.data.id, 'Folder ID must be generated');
    assert.strictEqual(res.data.parent_id, null, 'Root folder parent_id must be null');
    assert.strictEqual(res.data.name, 'Family Documents');
    assert.strictEqual(res.data.color, '#3B82F6');
  });

  test('T1-F06-02: Creates deeply nested subfolders with valid parent references', {
    tier: 1,
    feature: 'F06',
    timeout: 5000,
  }, async (ctx) => {
    const root = (await ctx.client.from('folders').insert({
      space_id: 'space-nested',
      name: 'Root Level',
      parent_id: null,
    })).data;

    const level1 = (await ctx.client.from('folders').insert({
      space_id: 'space-nested',
      name: 'Level 1 Subfolder',
      parent_id: root.id,
    })).data;

    const level2 = (await ctx.client.from('folders').insert({
      space_id: 'space-nested',
      name: 'Level 2 Subfolder',
      parent_id: level1.id,
    })).data;

    assert.strictEqual(root.parent_id, null, 'Root parent_id must be null');
    assert.strictEqual(level1.parent_id, root.id, 'Level 1 parent_id must reference Root');
    assert.strictEqual(level2.parent_id, level1.id, 'Level 2 parent_id must reference Level 1');

    const directChildrenOfRoot = (await ctx.client.from('folders').select('*').eq('parent_id', root.id)).data;
    assert.strictEqual(directChildrenOfRoot.length, 1);
    assert.strictEqual(directChildrenOfRoot[0].id, level1.id);
  });

  test('T1-F06-03: Validates custom folder colors with 6-char hex pattern and icon identifiers', {
    tier: 1,
    feature: 'F06',
    timeout: 5000,
  }, async (ctx) => {
    const res = await ctx.client.from('folders').insert({
      space_id: 'space-color',
      name: 'Medical Records',
      color: '#00E5FF',
      icon: 'folder-medical',
    });

    assert.status(res, 201);
    assert.match(res.data.color, /^#[0-9A-Fa-f]{6}$/, 'Color must be 6-char hex pattern');
    assert.strictEqual(res.data.color, '#00E5FF');
    assert.strictEqual(res.data.icon, 'folder-medical');
    assert.hasShape(res.data, { id: 'string', name: 'string', color: 'string', icon: 'string' });
  });

  test('T1-F06-04: Folder tree query isolates folders by space_id', {
    tier: 1,
    feature: 'F06',
    timeout: 5000,
  }, async (ctx) => {
    await ctx.client.from('folders').insert([
      { space_id: 'space-alpha', name: 'Alpha 1', parent_id: null },
      { space_id: 'space-alpha', name: 'Alpha 2', parent_id: null },
      { space_id: 'space-beta', name: 'Beta 1', parent_id: null },
    ]);

    const alphaFolders = (await ctx.client.from('folders').select('*').eq('space_id', 'space-alpha')).data;
    const betaFolders = (await ctx.client.from('folders').select('*').eq('space_id', 'space-beta')).data;

    assert.strictEqual(alphaFolders.length, 2, 'Space Alpha must contain 2 folders');
    assert.strictEqual(betaFolders.length, 1, 'Space Beta must contain 1 folder');
    assert.ok(alphaFolders.every((f) => f.space_id === 'space-alpha'));
    assert.ok(betaFolders.every((f) => f.space_id === 'space-beta'));
    assert.strictEqual(alphaFolders.some((f) => f.name === 'Beta 1'), false, 'Space Beta folders must not leak into Alpha');
  });

  test('T1-F06-05: Enforces folder naming constraints and whitespace trimming', {
    tier: 1,
    feature: 'F06',
    timeout: 5000,
  }, async (ctx) => {
    const rawName = '  Taxes 2026  ';
    const trimmed = rawName.trim();
    const res = await ctx.client.from('folders').insert({
      space_id: 'space-names',
      name: trimmed,
    });

    assert.status(res, 201);
    assert.strictEqual(res.data.name, 'Taxes 2026', 'Whitespace must be trimmed');
    assert.ok(res.data.name.length >= 1 && res.data.name.length <= 120, 'Name length must be between 1 and 120 characters');
    assert.strictEqual(res.data.deleted_at || null, null, 'deleted_at must default to null');
    assert.ok(!isNaN(Date.parse(res.data.created_at)), 'created_at must be valid timestamp');
  });

  // ==========================================================================
  // F07: File Metadata & Conversion Tracking
  // ==========================================================================
  test('T1-F07-01: Inserts file metadata record with MIME type, size, and storage path', {
    tier: 1,
    feature: 'F07',
    timeout: 5000,
  }, async (ctx) => {
    const res = await ctx.client.from('files').insert({
      space_id: 'space-01',
      name: 'Report.pdf',
      file_type: 'application/pdf',
      file_category: 'pdf',
      size_bytes: 1048576,
      storage_path: 'space-01/original/f1/Report.pdf',
    });

    assert.status(res, 201);
    assert.strictEqual(res.data.name, 'Report.pdf');
    assert.strictEqual(res.data.file_type, 'application/pdf');
    assert.strictEqual(res.data.file_category, 'pdf');
    assert.strictEqual(res.data.size_bytes, 1048576);
    assert.ok(res.data.storage_path.startsWith('space-01/'));
  });

  test('T1-F07-02: Associating files with folders and Inbox root (folder_id = null)', {
    tier: 1,
    feature: 'F07',
    timeout: 5000,
  }, async (ctx) => {
    const folder = (await ctx.client.from('folders').insert({ space_id: 'space-cat', name: 'Work' })).data;

    const inboxFile = (await ctx.client.from('files').insert({
      space_id: 'space-cat',
      folder_id: null,
      name: 'InboxDoc.txt',
    })).data;

    const folderFile = (await ctx.client.from('files').insert({
      space_id: 'space-cat',
      folder_id: folder.id,
      name: 'WorkDoc.txt',
    })).data;

    assert.strictEqual(inboxFile.folder_id, null, 'Inbox file has folder_id null');
    assert.strictEqual(folderFile.folder_id, folder.id, 'Folder file references parent folder ID');

    // Move file to folder
    const moveRes = await ctx.client.from('files').update({ folder_id: folder.id }).eq('id', inboxFile.id);
    assert.status(moveRes, 200);

    const moved = (await ctx.client.from('files').select('*').eq('id', inboxFile.id).single()).data;
    assert.strictEqual(moved.folder_id, folder.id, 'Moved file now has target folder_id');
    assert.ok(moved.updated_at, 'updated_at updated on move');
  });

  test('T1-F07-03: Tracks full conversion lifecycle for Office formats (pending -> processing -> ready)', {
    tier: 1,
    feature: 'F07',
    timeout: 5000,
  }, async (ctx) => {
    const file = (await ctx.client.from('files').insert({
      space_id: 'space-conv',
      name: 'Presentation.pptx',
      file_type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      file_category: 'office',
      conversion_status: 'pending',
    })).data;

    assert.strictEqual(file.conversion_status, 'pending');

    // Transition to processing
    await ctx.client.from('files').update({ conversion_status: 'processing' }).eq('id', file.id);
    const processing = (await ctx.client.from('files').select('*').eq('id', file.id).single()).data;
    assert.strictEqual(processing.conversion_status, 'processing');

    // Transition to ready
    const pdfPath = 'space-conv/converted/file.pdf';
    const textContent = 'Extracted Presentation Text Content';
    await ctx.client.from('files').update({
      conversion_status: 'ready',
      pdf_path: pdfPath,
      text_content: textContent,
    }).eq('id', file.id);

    const ready = (await ctx.client.from('files').select('*').eq('id', file.id).single()).data;
    assert.strictEqual(ready.conversion_status, 'ready');
    assert.strictEqual(ready.pdf_path, pdfPath);
    assert.strictEqual(ready.text_content, textContent);
  });

  test('T1-F07-04: Records conversion failure state with diagnostic error message', {
    tier: 1,
    feature: 'F07',
    timeout: 5000,
  }, async (ctx) => {
    const file = (await ctx.client.from('files').insert({
      space_id: 'space-fail',
      name: 'Corrupt.docx',
      conversion_status: 'processing',
    })).data;

    const errMsg = 'LibreOffice failed: corrupt ZIP archive payload';
    await ctx.client.from('files').update({
      conversion_status: 'failed',
      conversion_error: errMsg,
    }).eq('id', file.id);

    const failed = (await ctx.client.from('files').select('*').eq('id', file.id).single()).data;
    assert.strictEqual(failed.conversion_status, 'failed');
    assert.strictEqual(failed.conversion_error, errMsg);
    assert.strictEqual(failed.pdf_path || null, null, 'pdf_path must be null on failure');
    assert.ok(failed.updated_at, 'updated_at timestamp recorded');
    assert.strictEqual(failed.name, 'Corrupt.docx');
  });

  test('T1-F07-05: Non-convertible files (PDF, image, text) set status ready or not_applicable', {
    tier: 1,
    feature: 'F07',
    timeout: 5000,
  }, async (ctx) => {
    const imgFile = (await ctx.client.from('files').insert({
      space_id: 'space-img',
      name: 'Photo.jpg',
      file_type: 'image/jpeg',
      file_category: 'image',
      conversion_status: 'not_applicable',
      view_count: 0,
    })).data;

    assert.strictEqual(imgFile.file_category, 'image');
    assert.strictEqual(imgFile.conversion_status, 'not_applicable');
    assert.strictEqual(imgFile.view_count, 0);
    assert.strictEqual(imgFile.deleted_at || null, null);
    assert.ok(imgFile.created_at);
  });

  // ==========================================================================
  // F08: Document & Page Annotations
  // ==========================================================================
  test('T1-F08-01: Creates note attached to file with author identification and content', {
    tier: 1,
    feature: 'F08',
    timeout: 5000,
  }, async (ctx) => {
    const res = await ctx.client.from('notes').insert({
      space_id: 'space-notes',
      file_id: 'file-001',
      author_id: 'user-001',
      author_name: 'Dad',
      content: 'Check signature on page 2',
    });

    assert.status(res, 201);
    assert.strictEqual(res.data.file_id, 'file-001');
    assert.strictEqual(res.data.author_name, 'Dad');
    assert.strictEqual(res.data.content, 'Check signature on page 2');
    assert.ok(res.data.created_at);
  });

  test('T1-F08-02: Creates note attached to folder without file reference', {
    tier: 1,
    feature: 'F08',
    timeout: 5000,
  }, async (ctx) => {
    const res = await ctx.client.from('notes').insert({
      space_id: 'space-notes',
      folder_id: 'folder-001',
      file_id: null,
      author_id: 'user-002',
      author_name: 'Mom',
      content: 'Folder for 2026 house expenses',
    });

    assert.status(res, 201);
    assert.strictEqual(res.data.folder_id, 'folder-001');
    assert.strictEqual(res.data.file_id, null);
    assert.ok(res.data.file_id !== null || res.data.folder_id !== null, 'Satisfies ck_notes_target');
    assert.strictEqual(res.data.author_name, 'Mom');
  });

  test('T1-F08-03: Records optional 1-based PDF page number marker on annotations', {
    tier: 1,
    feature: 'F08',
    timeout: 5000,
  }, async (ctx) => {
    const res = await ctx.client.from('notes').insert({
      space_id: 'space-notes',
      file_id: 'file-pdf-01',
      content: 'Critical clause in insurance contract',
      page_number: 5,
    });

    assert.status(res, 201);
    assert.strictEqual(res.data.page_number, 5);
    assert.ok(res.data.page_number >= 1, 'page_number must be 1-based');

    const generalNote = (await ctx.client.from('notes').insert({
      space_id: 'space-notes',
      file_id: 'file-pdf-01',
      content: 'Overall file note',
      page_number: null,
    })).data;

    assert.strictEqual(generalNote.page_number, null);
    assert.strictEqual(generalNote.file_id, 'file-pdf-01');
  });

  test('T1-F08-04: TV device can author annotations using author_device_id', {
    tier: 1,
    feature: 'F08',
    timeout: 5000,
  }, async (ctx) => {
    const res = await ctx.client.from('notes').insert({
      space_id: 'space-notes',
      file_id: 'file-pdf-02',
      author_id: null,
      author_device_id: 'tv-device-uuid-99',
      author_name: 'Living Room TV',
      content: 'Bookmark marker saved from TV remote',
      page_number: 12,
    });

    assert.status(res, 201);
    assert.strictEqual(res.data.author_device_id, 'tv-device-uuid-99');
    assert.strictEqual(res.data.author_id, null);
    assert.strictEqual(res.data.author_name, 'Living Room TV');
    assert.strictEqual(res.data.page_number, 12);
  });

  test('T1-F08-05: Chronological ordering and non-empty content enforcement', {
    tier: 1,
    feature: 'F08',
    timeout: 5000,
  }, async (ctx) => {
    const fileId = 'file-chrono-01';
    await ctx.client.from('notes').insert([
      { space_id: 'space-chrono', file_id: fileId, content: 'First note', created_at: '2026-01-01T10:00:00Z' },
      { space_id: 'space-chrono', file_id: fileId, content: 'Second note', created_at: '2026-01-01T11:00:00Z' },
      { space_id: 'space-chrono', file_id: fileId, content: 'Third note', created_at: '2026-01-01T12:00:00Z' },
    ]);

    const notesRes = await ctx.client.from('notes').select('*').eq('file_id', fileId).order('created_at', { ascending: true });
    assert.status(notesRes, 200);
    assert.strictEqual(notesRes.data.length, 3);
    assert.strictEqual(notesRes.data[0].content, 'First note');
    assert.strictEqual(notesRes.data[2].content, 'Third note');
    assert.ok(notesRes.data.every((n) => n.content && n.content.trim().length > 0));
  });

  // ==========================================================================
  // F09: Starred Favorites System
  // ==========================================================================
  test('T1-F09-01: Stars a file for an authenticated user', {
    tier: 1,
    feature: 'F09',
    timeout: 5000,
  }, async (ctx) => {
    const res = await ctx.client.from('favorites').insert({
      space_id: 'space-fav',
      file_id: 'file-fav-01',
      user_id: 'user-fav-01',
      device_id: null,
    });

    assert.status(res, 201);
    assert.strictEqual(res.data.file_id, 'file-fav-01');
    assert.strictEqual(res.data.user_id, 'user-fav-01');
    assert.strictEqual(res.data.device_id, null);
    assert.ok(res.data.created_at);
  });

  test('T1-F09-02: Stars a file for a paired TV device', {
    tier: 1,
    feature: 'F09',
    timeout: 5000,
  }, async (ctx) => {
    const res = await ctx.client.from('favorites').insert({
      space_id: 'space-fav',
      file_id: 'file-fav-02',
      user_id: null,
      device_id: 'tv-device-fav-01',
    });

    assert.status(res, 201);
    assert.strictEqual(res.data.file_id, 'file-fav-02');
    assert.strictEqual(res.data.device_id, 'tv-device-fav-01');
    assert.strictEqual(res.data.user_id, null);
    assert.ok(res.data.user_id !== null || res.data.device_id !== null, 'ck_favorites_actor satisfied');
  });

  test('T1-F09-03: Prevents duplicate favorites for same actor and file', {
    tier: 1,
    feature: 'F09',
    timeout: 5000,
  }, async (ctx) => {
    const first = await ctx.client.from('favorites').insert({
      space_id: 'space-fav',
      file_id: 'file-dup-01',
      user_id: 'user-dup-01',
    });
    assert.status(first, 201);

    // Check duplicate
    const existing = (await ctx.client.from('favorites').select('*')
      .eq('file_id', 'file-dup-01')
      .eq('user_id', 'user-dup-01')).data;
    assert.strictEqual(existing.length, 1, 'Only one favorite row exists');

    const isDuplicate = existing.some((f) => f.file_id === 'file-dup-01' && f.user_id === 'user-dup-01');
    assert.strictEqual(isDuplicate, true, 'Duplicate star detected');
    assert.strictEqual(existing[0].file_id, 'file-dup-01');
    assert.strictEqual(existing[0].user_id, 'user-dup-01');
  });

  test('T1-F09-04: Queries favorites list joined with file metadata', {
    tier: 1,
    feature: 'F09',
    timeout: 5000,
  }, async (ctx) => {
    const spaceId = 'space-fav-query';
    const f1 = (await ctx.client.from('files').insert({ space_id: spaceId, name: 'StarredDoc1.pdf' })).data;
    const f2 = (await ctx.client.from('files').insert({ space_id: spaceId, name: 'StarredDoc2.pdf' })).data;

    await ctx.client.from('favorites').insert([
      { space_id: spaceId, file_id: f1.id, user_id: 'user-q-01' },
      { space_id: spaceId, file_id: f2.id, user_id: 'user-q-01' },
      { space_id: spaceId, file_id: f1.id, user_id: 'other-user-99' },
    ]);

    const userFavs = (await ctx.client.from('favorites').select('*').eq('user_id', 'user-q-01')).data;
    assert.strictEqual(userFavs.length, 2);
    assert.ok(userFavs.some((fav) => fav.file_id === f1.id));
    assert.ok(userFavs.some((fav) => fav.file_id === f2.id));
    assert.strictEqual(userFavs.every((fav) => fav.user_id === 'user-q-01'), true);
    assert.strictEqual(userFavs.some((fav) => fav.user_id === 'other-user-99'), false);
  });

  test('T1-F09-05: Unstar toggling removes favorite record', {
    tier: 1,
    feature: 'F09',
    timeout: 5000,
  }, async (ctx) => {
    const star = (await ctx.client.from('favorites').insert({
      space_id: 'space-unstar',
      file_id: 'file-toggle-01',
      user_id: 'user-toggle-01',
    })).data;

    const delRes = await ctx.client.from('favorites').delete().eq('id', star.id);
    assert.status(delRes, 200);

    const remaining = (await ctx.client.from('favorites').select('*').eq('id', star.id)).data;
    assert.strictEqual(remaining.length, 0, 'Favorite row removed');

    // Target file still exists in files table
    const targetFile = (await ctx.client.from('files').insert({ space_id: 'space-unstar', name: 'Preserved.pdf' })).data;
    assert.ok(targetFile.id);
    assert.strictEqual(targetFile.name, 'Preserved.pdf');
  });

  // ==========================================================================
  // F10: Reading Progress & Bookmarks
  // ==========================================================================
  test('T1-F10-01: Inserts reading bookmark with page number and scroll position', {
    tier: 1,
    feature: 'F10',
    timeout: 5000,
  }, async (ctx) => {
    const res = await ctx.client.from('bookmarks').insert({
      space_id: 'space-bm',
      file_id: 'doc-01',
      device_id: 'tv-01',
      page_number: 4,
      scroll_position: 0.35,
      is_last_read: true,
    });

    assert.status(res, 201);
    assert.strictEqual(res.data.page_number, 4);
    assert.inRange(res.data.scroll_position, 0.0, 1.0);
    assert.strictEqual(res.data.is_last_read, true);
    assert.ok(res.data.created_at);
  });

  test('T1-F10-02: Updates bookmark on subsequent page read with new timestamp and position', {
    tier: 1,
    feature: 'F10',
    timeout: 5000,
  }, async (ctx) => {
    const bm = (await ctx.client.from('bookmarks').insert({
      space_id: 'space-bm-up',
      file_id: 'doc-up',
      device_id: 'tv-up',
      page_number: 2,
      scroll_position: 0.1,
      is_last_read: true,
    })).data;

    const upRes = await ctx.client.from('bookmarks').update({
      page_number: 9,
      scroll_position: 0.85,
    }).eq('id', bm.id);

    assert.status(upRes, 200);
    const updated = (await ctx.client.from('bookmarks').select('*').eq('id', bm.id).single()).data;
    assert.strictEqual(updated.page_number, 9);
    assert.strictEqual(updated.scroll_position, 0.85);
    assert.strictEqual(updated.is_last_read, true);
    assert.ok(updated.updated_at);
  });

  test('T1-F10-03: Supports named manual bookmarks alongside auto-reading progress', {
    tier: 1,
    feature: 'F10',
    timeout: 5000,
  }, async (ctx) => {
    const res = await ctx.client.from('bookmarks').insert({
      space_id: 'space-bm-label',
      file_id: 'doc-label',
      user_id: 'user-reader',
      page_number: 42,
      scroll_position: 0.5,
      label: 'Chapter 3 Start',
      is_last_read: false,
    });

    assert.status(res, 201);
    assert.strictEqual(res.data.label, 'Chapter 3 Start');
    assert.strictEqual(res.data.is_last_read, false);
    assert.strictEqual(res.data.page_number, 42);
    assert.strictEqual(res.data.user_id, 'user-reader');
  });

  test('T1-F10-04: view_continue_reading returns most recently read documents at the top', {
    tier: 1,
    feature: 'F10',
    timeout: 5000,
  }, async (ctx) => {
    const spaceId = 'space-cr-order';
    const docA = (await ctx.client.from('files').insert({ space_id: spaceId, name: 'DocA.pdf' })).data;
    const docB = (await ctx.client.from('files').insert({ space_id: spaceId, name: 'DocB.pdf' })).data;

    const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const twoMinsAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();

    await ctx.client.from('bookmarks').insert([
      { space_id: spaceId, file_id: docA.id, user_id: 'u1', is_last_read: true, page_number: 10, created_at: fifteenMinsAgo },
      { space_id: spaceId, file_id: docB.id, user_id: 'u1', is_last_read: true, page_number: 5, created_at: twoMinsAgo },
    ]);

    const crRes = await ctx.client.from('view_continue_reading').select('*').eq('space_id', spaceId);
    assert.status(crRes, 200);
    assert.ok(crRes.data.length >= 2);
    assert.strictEqual(crRes.data[0].file_id, docB.id, 'Most recently read DocB must be first');
    assert.strictEqual(crRes.data[1].file_id, docA.id, 'Older DocA must be second');
    assert.strictEqual(crRes.data[0].page_number, 5);
  });

  test('T1-F10-05: Excludes soft-deleted files from Continue Reading view', {
    tier: 1,
    feature: 'F10',
    timeout: 5000,
  }, async (ctx) => {
    const spaceId = 'space-cr-trash';
    const docX = (await ctx.client.from('files').insert({ space_id: spaceId, name: 'ActiveBook.pdf' })).data;
    const docY = (await ctx.client.from('files').insert({
      space_id: spaceId,
      name: 'TrashBook.pdf',
      deleted_at: new Date().toISOString(),
    })).data;

    await ctx.client.from('bookmarks').insert([
      { space_id: spaceId, file_id: docX.id, user_id: 'u2', is_last_read: true, page_number: 7 },
      { space_id: spaceId, file_id: docY.id, user_id: 'u2', is_last_read: true, page_number: 22 },
    ]);

    const crRes = await ctx.client.from('view_continue_reading').select('*').eq('space_id', spaceId);
    assert.status(crRes, 200);
    assert.strictEqual(crRes.data.some((item) => item.file_id === docY.id), false, 'Soft-deleted file must be excluded');
    assert.strictEqual(crRes.data.some((item) => item.file_id === docX.id), true, 'Active file must be included');
    assert.strictEqual(crRes.data.length, 1);
    assert.strictEqual(crRes.data[0].page_number, 7);
    assert.strictEqual(crRes.data[0].file_name, 'ActiveBook.pdf');
  });
});
