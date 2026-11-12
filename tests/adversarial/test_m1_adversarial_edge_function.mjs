#!/usr/bin/env node
/**
 * Empirical Adversarial Test Harness for Supabase Edge Function: trigger-conversion
 * Tests:
 * 1. CORS Preflight (OPTIONS) response headers, status, and body
 * 2. Method validation (GET, PUT, DELETE, PATCH rejection with 405)
 * 3. Secret & Service Role Key authentication enforcement (401 on missing/invalid)
 * 4. Payload normalization (Webhook { record: ... } vs Direct { file_id: ... })
 * 5. Extension filtering (Convertible vs Non-Convertible skipping with 200)
 * 6. Status filtering (pending/processing vs ready/failed/not_applicable skipping)
 * 7. GitHub Actions repository_dispatch call and error propagation
 */

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FUNCTION_PATH = path.resolve(__dirname, '../../supabase/functions/trigger-conversion/index.ts');

assert(fs.existsSync(FUNCTION_PATH), `Function file not found at ${FUNCTION_PATH}`);
const sourceCode = fs.readFileSync(FUNCTION_PATH, 'utf-8');

// Environment mock state
let mockEnv = {
  GITHUB_REPO_OWNER: 'test-owner',
  GITHUB_REPO_NAME: 'test-repo',
  GITHUB_PAT: 'ghp_secret_token_12345',
  CONVERSION_WEBHOOK_SECRET: 'test_webhook_secret',
  SUPABASE_SERVICE_ROLE_KEY: 'test_service_role_key',
};

globalThis.Deno = {
  env: {
    get(key) {
      return mockEnv[key];
    }
  }
};

let capturedHandler = null;
const mockServe = (fn) => {
  capturedHandler = fn;
};

// Prepare code for Node execution:
// Strip https import and pass mockServe
let executableCode = sourceCode
  .replace(/import\s+\{\s*serve\s*\}\s+from\s+["']https:\/\/[^"']+["'];?/, '')
  .replace(/serve\s*\(\s*async\s*\(\s*req\s*:\s*Request\s*\)\s*=>\s*\{/, 'mockServe(async (req) => {')
  .replace(/\(err\s+as\s+Error\)/g, 'err')
  .replace(/interface\s+WebhookRecord\s*\{[\s\S]*?\}/, '')
  .replace(/:\s*WebhookRecord/g, '')
  .replace(/as\s+WebhookRecord/g, '')
  .replace(/:\s*Request/g, '');

const runner = new Function('mockServe', executableCode);
runner(mockServe);

assert(typeof capturedHandler === 'function', 'Failed to capture Edge Function handler!');

// Mock global fetch for GitHub API calls
let lastFetchCall = null;
let mockFetchResponse = {
  ok: true,
  status: 204,
  text: async () => ''
};

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  lastFetchCall = { url, options };
  return mockFetchResponse;
};

// Test Suite Runner
let testsPassed = 0;
let testsFailed = 0;

async function runTest(name, fn) {
  try {
    lastFetchCall = null;
    mockFetchResponse = {
      ok: true,
      status: 204,
      text: async () => ''
    };
    await fn();
    console.log(`  ✓ ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    testsFailed++;
  }
}

console.log('\n--- Running Empirical Adversarial Tests on trigger-conversion Edge Function ---\n');

// 1. CORS Preflight (OPTIONS)
await runTest('CORS preflight: OPTIONS returns 200, "ok", and CORS headers', async () => {
  const req = new Request('http://localhost/functions/v1/trigger-conversion', {
    method: 'OPTIONS',
  });
  const res = await capturedHandler(req);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(await res.text(), 'ok');
  assert.strictEqual(res.headers.get('Access-Control-Allow-Origin'), '*');
  assert.strictEqual(res.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
  assert(res.headers.get('Access-Control-Allow-Headers').includes('authorization'));
});

// 2. Disallowed HTTP Methods
for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
  await runTest(`Method rejection: ${method} returns 405 Method Not Allowed`, async () => {
    const req = new Request('http://localhost/functions/v1/trigger-conversion', {
      method,
    });
    const res = await capturedHandler(req);
    assert.strictEqual(res.status, 405);
    const body = await res.json();
    assert.strictEqual(body.error, 'Method not allowed');
    assert.strictEqual(res.headers.get('Access-Control-Allow-Origin'), '*');
  });
}

// 3. Authentication Enforcement
await runTest('Auth: Missing Authorization header returns 401', async () => {
  const req = new Request('http://localhost/functions/v1/trigger-conversion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_id: 'f-1', name: 'test.docx' })
  });
  const res = await capturedHandler(req);
  assert.strictEqual(res.status, 401);
  const body = await res.json();
  assert.strictEqual(body.error, 'Unauthorized');
});

await runTest('Auth: Invalid token returns 401', async () => {
  const req = new Request('http://localhost/functions/v1/trigger-conversion', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer bad_secret'
    },
    body: JSON.stringify({ file_id: 'f-1', name: 'test.docx' })
  });
  const res = await capturedHandler(req);
  assert.strictEqual(res.status, 401);
});

await runTest('Auth: Valid WEBHOOK_SECRET passes auth', async () => {
  const req = new Request('http://localhost/functions/v1/trigger-conversion', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer test_webhook_secret'
    },
    body: JSON.stringify({ file_id: 'f-1', name: 'test.docx' })
  });
  const res = await capturedHandler(req);
  assert.strictEqual(res.status, 200);
  assert(lastFetchCall !== null, 'GitHub dispatch should have been triggered');
});

await runTest('Auth: Valid SUPABASE_SERVICE_ROLE_KEY passes auth', async () => {
  const req = new Request('http://localhost/functions/v1/trigger-conversion', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer test_service_role_key'
    },
    body: JSON.stringify({ file_id: 'f-2', name: 'document.pdf' })
  });
  const res = await capturedHandler(req);
  assert.strictEqual(res.status, 200);
  assert(lastFetchCall !== null);
});

// 4. Payload Normalization
await runTest('Payload: Database webhook format { record: { id, name, ... } }', async () => {
  const req = new Request('http://localhost/functions/v1/trigger-conversion', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer test_webhook_secret'
    },
    body: JSON.stringify({
      type: 'INSERT',
      table: 'files',
      record: {
        id: 'file-webhook-100',
        name: 'annual_report.docx',
        storage_path: 'space-1/original/f100/annual_report.docx',
        space_id: 'space-1',
        conversion_status: 'pending',
        file_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      }
    })
  });
  const res = await capturedHandler(req);
  assert.strictEqual(res.status, 200);
  const json = await res.json();
  assert.strictEqual(json.success, true);
  assert.strictEqual(json.file_id, 'file-webhook-100');

  // Verify GitHub dispatch payload
  assert(lastFetchCall !== null);
  const dispatchBody = JSON.parse(lastFetchCall.options.body);
  assert.strictEqual(dispatchBody.event_type, 'convert-document');
  assert.strictEqual(dispatchBody.client_payload.file_id, 'file-webhook-100');
  assert.strictEqual(dispatchBody.client_payload.file_name, 'annual_report.docx');
  assert.strictEqual(dispatchBody.client_payload.space_id, 'space-1');
  assert.strictEqual(dispatchBody.client_payload.storage_path, 'space-1/original/f100/annual_report.docx');
});

await runTest('Payload: Direct invocation format { file_id, file_name, status, ... }', async () => {
  const req = new Request('http://localhost/functions/v1/trigger-conversion', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer test_webhook_secret'
    },
    body: JSON.stringify({
      file_id: 'file-direct-200',
      file_name: 'presentation.pptx',
      storage_path: 'space-1/original/f200/presentation.pptx',
      space_id: 'space-1',
      status: 'processing',
      file_category: 'office'
    })
  });
  const res = await capturedHandler(req);
  assert.strictEqual(res.status, 200);
  const json = await res.json();
  assert.strictEqual(json.success, true);
  assert.strictEqual(json.file_id, 'file-direct-200');

  const dispatchBody = JSON.parse(lastFetchCall.options.body);
  assert.strictEqual(dispatchBody.client_payload.file_id, 'file-direct-200');
  assert.strictEqual(dispatchBody.client_payload.file_name, 'presentation.pptx');
  assert.strictEqual(dispatchBody.client_payload.file_type, 'office');
});

await runTest('Payload: Missing file_id/id returns 400 Bad Request', async () => {
  const req = new Request('http://localhost/functions/v1/trigger-conversion', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer test_webhook_secret'
    },
    body: JSON.stringify({ name: 'presentation.pptx' })
  });
  const res = await capturedHandler(req);
  assert.strictEqual(res.status, 400);
  const json = await res.json();
  assert(json.message.includes('missing id or name'));
});

await runTest('Payload: Missing name/file_name returns 400 Bad Request', async () => {
  const req = new Request('http://localhost/functions/v1/trigger-conversion', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer test_webhook_secret'
    },
    body: JSON.stringify({ file_id: 'f-123' })
  });
  const res = await capturedHandler(req);
  assert.strictEqual(res.status, 400);
});

// 5. Extension Filtering
const convertibleSamples = [
  'doc.docx', 'doc.doc', 'slides.pptx', 'slides.ppt',
  'sheet.xlsx', 'sheet.xls', 'text.odt', 'table.ods',
  'pres.odp', 'rich.rtf', 'document.pdf',
  'UPPER.DOCX', 'Mixed.Pdf', 'CAPS.XLSX'
];

for (const sample of convertibleSamples) {
  await runTest(`Extension check: ${sample} qualifies for conversion`, async () => {
    const req = new Request('http://localhost/functions/v1/trigger-conversion', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test_webhook_secret'
      },
      body: JSON.stringify({ file_id: 'f-c', name: sample, conversion_status: 'pending' })
    });
    const res = await capturedHandler(req);
    assert.strictEqual(res.status, 200);
    assert(lastFetchCall !== null, `Expected ${sample} to trigger dispatch`);
  });
}

const nonConvertibleSamples = [
  'photo.jpg', 'image.png', 'graphic.webp', 'family.gif',
  'cam.heic', 'cam.heif', 'audio.mp3', 'video.mp4',
  'archive.zip', 'script.py', 'doc.docx.bak', 'notpdf'
];

for (const sample of nonConvertibleSamples) {
  await runTest(`Extension check: ${sample} is skipped without dispatch (200 OK)`, async () => {
    const req = new Request('http://localhost/functions/v1/trigger-conversion', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test_webhook_secret'
      },
      body: JSON.stringify({ file_id: 'f-nc', name: sample, conversion_status: 'pending' })
    });
    const res = await capturedHandler(req);
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert(json.message.includes('Skipping:'));
    assert.strictEqual(lastFetchCall, null, `Non-convertible file ${sample} must NOT trigger dispatch`);
  });
}

// 6. Status Filtering
const eligibleStatuses = ['pending', 'processing'];
for (const status of eligibleStatuses) {
  await runTest(`Status check: '${status}' is eligible for dispatch`, async () => {
    const req = new Request('http://localhost/functions/v1/trigger-conversion', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test_webhook_secret'
      },
      body: JSON.stringify({ file_id: 'f-s', name: 'document.pdf', conversion_status: status })
    });
    const res = await capturedHandler(req);
    assert.strictEqual(res.status, 200);
    assert(lastFetchCall !== null, `Status ${status} should trigger dispatch`);
  });
}

const ineligibleStatuses = ['ready', 'failed', 'not_applicable', 'completed', 'unknown', 'cancelled'];
for (const status of ineligibleStatuses) {
  await runTest(`Status check: '${status}' is skipped without dispatch (200 OK)`, async () => {
    const req = new Request('http://localhost/functions/v1/trigger-conversion', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test_webhook_secret'
      },
      body: JSON.stringify({ file_id: 'f-s', name: 'document.pdf', conversion_status: status })
    });
    const res = await capturedHandler(req);
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert(json.message.includes(`conversion_status is '${status}'`));
    assert.strictEqual(lastFetchCall, null, `Ineligible status ${status} must NOT trigger dispatch`);
  });
}

// 7. GitHub Dispatch Headers, Timeout & Error Handling
await runTest('GitHub dispatch: Correct headers sent to GitHub API', async () => {
  const req = new Request('http://localhost/functions/v1/trigger-conversion', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer test_webhook_secret'
    },
    body: JSON.stringify({ file_id: 'f-gh', name: 'doc.docx', conversion_status: 'pending' })
  });
  await capturedHandler(req);
  assert(lastFetchCall !== null);
  assert.strictEqual(lastFetchCall.url, 'https://api.github.com/repos/test-owner/test-repo/dispatches');
  assert.strictEqual(lastFetchCall.options.headers['Authorization'], 'Bearer ghp_secret_token_12345');
  assert.strictEqual(lastFetchCall.options.headers['Accept'], 'application/vnd.github.v3+json');
  assert.strictEqual(lastFetchCall.options.headers['User-Agent'], 'Supabase-Conversion-Trigger');
});

await runTest('GitHub dispatch: GitHub 401 returns 500 with error details', async () => {
  mockFetchResponse = {
    ok: false,
    status: 401,
    text: async () => 'Bad credentials'
  };
  const req = new Request('http://localhost/functions/v1/trigger-conversion', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer test_webhook_secret'
    },
    body: JSON.stringify({ file_id: 'f-err', name: 'doc.docx' })
  });
  const res = await capturedHandler(req);
  assert.strictEqual(res.status, 500);
  const json = await res.json();
  assert(json.error.includes('GitHub dispatch failed (401): Bad credentials'));
});

// Restore original fetch
globalThis.fetch = originalFetch;

console.log(`\nAdversarial Edge Function Test Suite Completed: ${testsPassed} passed, ${testsFailed} failed.\n`);
assert.strictEqual(testsFailed, 0, `${testsFailed} tests failed!`);
