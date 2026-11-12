#!/usr/bin/env python3
"""
Verification suite for Milestone 1: Supabase Backend
Validates:
1. supabase/migrations/20261111000000_family_file_library_init.sql
2. supabase/functions/trigger-conversion/index.ts
"""

import os
import re
import sys
import json
import unittest
from datetime import datetime, timedelta, timezone

MIGRATION_PATH = os.path.join(
    os.path.dirname(__file__), "..", "supabase", "migrations", "20261111000000_family_file_library_init.sql"
)
EDGE_FUNC_PATH = os.path.join(
    os.path.dirname(__file__), "..", "supabase", "functions", "trigger-conversion", "index.ts"
)


class TestSqlMigrationStructure(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.path = os.path.abspath(MIGRATION_PATH)
        assert os.path.exists(cls.path), f"Migration file not found at {cls.path}"
        with open(cls.path, "r", encoding="utf-8") as f:
            cls.content = f.read()

    def test_parentheses_and_quotes_balance(self):
        """Verify that basic structural delimiters ($$, single quotes, parens) are balanced."""
        # Check $$ dollar-quoting blocks are even
        dollar_count = self.content.count("$$")
        self.assertEqual(
            dollar_count % 2, 0, f"Unbalanced $$ blocks in SQL: count = {dollar_count}"
        )

        # Check basic parenthesis balance outside of single-quoted and dollar-quoted literals
        in_single_quote = False
        in_dollar_quote = False
        paren_depth = 0
        i = 0
        length = len(self.content)

        while i < length:
            char = self.content[i]
            if not in_single_quote and not in_dollar_quote:
                if self.content[i:i+2] == "--":
                    # skip comment line
                    nl = self.content.find("\n", i)
                    i = nl if nl != -1 else length
                    continue
                if self.content[i:i+2] == "$$":
                    in_dollar_quote = True
                    i += 2
                    continue
                if char == "'":
                    in_single_quote = True
                    i += 1
                    continue
                if char == "(":
                    paren_depth += 1
                elif char == ")":
                    paren_depth -= 1
                    self.assertGreaterEqual(
                        paren_depth, 0, f"Unmatched closing parenthesis at position {i}"
                    )
            elif in_single_quote:
                if char == "'":
                    if i + 1 < length and self.content[i + 1] == "'":
                        i += 2  # escaped quote ''
                        continue
                    in_single_quote = False
            elif in_dollar_quote:
                if self.content[i:i+2] == "$$":
                    in_dollar_quote = False
                    i += 2
                    continue
            i += 1

        self.assertEqual(paren_depth, 0, f"Unmatched opening parenthesis in SQL file, depth: {paren_depth}")

    def test_ten_tables_exist(self):
        """Verify all 10 core tables are created."""
        expected_tables = [
            "spaces", "members", "invites", "devices", "pairing_codes",
            "folders", "files", "notes", "favorites", "bookmarks"
        ]
        for tbl in expected_tables:
            pattern = rf"create table if not exists public\.{tbl}\b"
            self.assertTrue(
                re.search(pattern, self.content, re.IGNORECASE),
                f"Missing CREATE TABLE for public.{tbl}"
            )

    def test_search_path_on_handle_updated_at(self):
        """Verify handle_updated_at has set search_path = public."""
        pattern = r"create or replace function public\.handle_updated_at\(\)[\s\S]*?security definer[\s\S]*?set search_path = public"
        self.assertTrue(
            re.search(pattern, self.content, re.IGNORECASE),
            "handle_updated_at() must have security definer and set search_path = public"
        )

    def test_fts_buffer_limit_guard(self):
        """Verify files.fts has substr truncation to prevent 1MB tsvector buffer crash."""
        pattern = r"fts tsvector generated always as \(to_tsvector\('english', coalesce\(name, ''\) \|\| ' ' \|\| substr\(coalesce\(text_content, ''\), 1, 50000\)\)\) stored"
        self.assertTrue(
            re.search(pattern, self.content),
            "files.fts generated column must protect against buffer overflow with substr(coalesce(text_content, ''), 1, 50000)"
        )

    def test_redundant_indexes_removed(self):
        """Verify redundant indexes on unique constraint columns were dropped."""
        self.assertIsNone(
            re.search(r"create index if not exists idx_members_space_user on public\.members\(space_id, user_id\);", self.content),
            "idx_members_space_user should be removed (covered by uq_members_space_user)"
        )
        self.assertIsNone(
            re.search(r"create index if not exists idx_invites_token on public\.invites\(token\);", self.content),
            "idx_invites_token should be removed (covered by unique constraint)"
        )
        self.assertIsNone(
            re.search(r"create index if not exists idx_pairing_codes_code on public\.pairing_codes\(code\);", self.content),
            "idx_pairing_codes_code should be removed (covered by unique constraint)"
        )
        self.assertIsNone(
            re.search(r"create index if not exists idx_files_storage_path on public\.files\(storage_path\);", self.content),
            "idx_files_storage_path should be removed (covered by unique constraint)"
        )

    def test_bookmarks_partial_unique_indexes(self):
        """Verify partial unique indexes on bookmarks for atomic upsert."""
        self.assertTrue(
            "idx_bookmarks_unique_last_read_device" in self.content,
            "Missing idx_bookmarks_unique_last_read_device index"
        )
        self.assertTrue(
            "idx_bookmarks_unique_last_read_user" in self.content,
            "Missing idx_bookmarks_unique_last_read_user index"
        )
        self.assertTrue(
            "idx_bookmarks_user_id" in self.content,
            "Missing idx_bookmarks_user_id index"
        )

    def test_get_auth_device_id_json_guard(self):
        """Verify get_auth_device_id guards against empty string request.headers."""
        pattern = r"coalesce\(nullif\(current_setting\('request\.headers', true\), ''\), '\{\}'\)::json->>'x-device-token'"
        matches = re.findall(pattern, self.content)
        self.assertEqual(
            len(matches), 2,
            "get_auth_device_id must guard request.headers with coalesce(nullif(..., ''), '{}')::json in both null check and sha256"
        )

    def test_members_rls_security_hardening(self):
        """Verify members_insert and members_update prevent arbitrary space joining and role self-escalation."""
        # members_insert check
        insert_pattern = r'create policy "members_insert"[\s\S]*?with check \([\s\S]*?public\.is_space_admin\(space_id\)[\s\S]*?auth\.uid\(\) = user_id[\s\S]*?s\.created_by = auth\.uid\(\)[\s\S]*?not exists \(select 1 from public\.members m where m\.space_id = s\.id\)'
        self.assertTrue(
            re.search(insert_pattern, self.content),
            "members_insert policy must restrict non-admins to initial space creator"
        )

        # members_update check
        update_pattern = r'create policy "members_update"[\s\S]*?with check \([\s\S]*?public\.is_space_admin\(space_id\)[\s\S]*?role = \(select m\.role from public\.members m where m\.id = members\.id\)'
        self.assertTrue(
            re.search(update_pattern, self.content),
            "members_update policy must forbid non-admins from changing their role"
        )

    def test_devices_update_rls_hardening(self):
        """Verify devices_update allows admins to update all, while TV device can only update last_seen heartbeat without altering token hash or space."""
        device_pattern = r'create policy "devices_update"[\s\S]*?using \(public\.is_space_admin\(space_id\) or id = public\.get_auth_device_id\(\)\)[\s\S]*?device_token_hash = \(select d\.device_token_hash from public\.devices d where d\.id = devices\.id\)'
        self.assertTrue(
            re.search(device_pattern, self.content),
            "devices_update policy must restrict TV updates to own device without modifying token hash"
        )

    def test_views_have_security_invoker(self):
        """Verify all three convenience views specify WITH (security_invoker = true)."""
        views = ["view_active_files", "view_trash_files", "view_continue_reading"]
        for v in views:
            pattern = rf"create or replace view public\.{v}[\s\r\n]+with \(security_invoker = true\)"
            self.assertTrue(
                re.search(pattern, self.content),
                f"View {v} must specify WITH (security_invoker = true) to enforce RLS"
            )

    def test_request_tv_pairing_code_collision_loop(self):
        """Verify pairing code collision loop checks globally across all pairing codes."""
        pattern = r"exit when not exists \(select 1 from public\.pairing_codes where code = v_code\);"
        self.assertTrue(
            re.search(pattern, self.content),
            "request_tv_pairing_code must check 'code = v_code' globally to prevent unique key collision"
        )

    def test_approve_tv_pairing_code_sanitizes_hyphens(self):
        """Verify approve_tv_pairing_code strips hyphens and spaces."""
        pattern = r"v_clean_code := regexp_replace\(upper\(trim\(p_code\)\), '\[\\s-\]\+', '', 'g'\);"
        self.assertTrue(
            re.search(pattern, self.content),
            "approve_tv_pairing_code must sanitize hyphens and whitespace via regexp_replace"
        )

    def test_cleanup_expired_trash_enhancements(self):
        """Verify cleanup_expired_trash purges storage.objects, notes, and pairing_codes."""
        self.assertTrue(
            "delete from storage.objects" in self.content,
            "cleanup_expired_trash must delete orphaned blobs from storage.objects"
        )
        self.assertTrue(
            "bucket_id = 'family-files'" in self.content,
            "cleanup_expired_trash must target family-files bucket in storage.objects"
        )
        self.assertTrue(
            "delete from public.notes" in self.content,
            "cleanup_expired_trash must purge soft-deleted notes older than 30 days"
        )
        self.assertTrue(
            "delete from public.pairing_codes" in self.content,
            "cleanup_expired_trash must purge stale pairing codes"
        )

    def test_grants_for_helper_functions(self):
        """Verify explicit execute grants for all helper functions."""
        helpers = [
            "handle_updated_at()", "extract_space_id_from_path(text)", "get_auth_device_id()",
            "has_space_access(uuid)", "is_space_member_user(uuid)", "is_space_admin(uuid)",
            "is_tv_device(uuid)"
        ]
        for h in helpers:
            escaped = re.escape(h)
            pattern = rf"grant execute on function public\.{escaped} to anon, authenticated, service_role;"
            self.assertTrue(
                re.search(pattern, self.content),
                f"Missing explicit grant for public.{h}"
            )

    def test_realtime_publication_and_replica_identity(self):
        """Verify favorites and bookmarks are included in replica identity full and realtime publication."""
        self.assertTrue("alter table public.favorites replica identity full;" in self.content)
        self.assertTrue("alter table public.bookmarks replica identity full;" in self.content)
        self.assertTrue("alter table public.files replica identity full;" in self.content)
        self.assertTrue("alter table public.folders replica identity full;" in self.content)
        self.assertTrue("alter table public.notes replica identity full;" in self.content)
        self.assertTrue("alter table public.pairing_codes replica identity full;" in self.content)

        # Check publication addition in DO block
        for table in ["files", "folders", "notes", "favorites", "bookmarks", "pairing_codes"]:
            pattern = rf"alter publication supabase_realtime add table public\.{table};"
            self.assertTrue(
                re.search(pattern, self.content),
                f"Table {table} must be registered in supabase_realtime publication"
            )

    def test_storage_mime_types(self):
        """Verify image/heif and text/x-markdown are in allowed_mime_types."""
        self.assertTrue("'image/heif'" in self.content)
        self.assertTrue("'text/x-markdown'" in self.content)

    def test_spaces_rls_deadlock_prevention(self):
        """Verify spaces.created_by has default auth.uid() and spaces_select prevents RLS insert deadlock."""
        # 1. spaces table created_by must have default auth.uid()
        spaces_table_match = re.search(r"create table if not exists public\.spaces\s*\(([\s\S]*?)\);", self.content, re.IGNORECASE)
        self.assertIsNotNone(spaces_table_match, "public.spaces table definition not found")
        spaces_body = spaces_table_match.group(1)
        self.assertTrue(
            re.search(r"created_by uuid.*?default auth\.uid\(\)", spaces_body, re.IGNORECASE),
            "spaces.created_by column must define 'default auth.uid()' to prevent RLS insertion deadlock"
        )

        # 2. spaces_select must allow space creator to read newly inserted unbootstrapped space
        select_match = re.search(r'create policy "spaces_select"[\s\S]*?;', self.content)
        self.assertIsNotNone(select_match, "spaces_select policy not found")
        self.assertIn(
            "or created_by = auth.uid()",
            select_match.group(0),
            "spaces_select must include 'or created_by = auth.uid()' to allow INSERT ... RETURNING"
        )

        # 3. spaces_insert must restrict created_by to auth.uid() or null
        insert_match = re.search(r'create policy "spaces_insert"[\s\S]*?;', self.content)
        self.assertIsNotNone(insert_match, "spaces_insert policy not found")
        self.assertTrue(
            re.search(r"created_by is null or created_by = auth\.uid\(\)", insert_match.group(0)),
            "spaces_insert must prevent spoofing created_by to another user"
        )

    def test_pairing_codes_rls_hardening(self):
        """Verify pairing_codes_select and pairing_codes_update strictly isolate spaces and reject cross-tenant leaks."""
        # pairing_codes_select must require space_id is not null and has_space_access
        select_match = re.search(r'create policy "pairing_codes_select"[\s\S]*?;', self.content)
        self.assertIsNotNone(select_match, "pairing_codes_select policy not found")
        select_sql = select_match.group(0)
        self.assertTrue(
            "space_id is not null and public.has_space_access(space_id)" in select_sql,
            "pairing_codes_select must require (space_id is not null and public.has_space_access(space_id))"
        )
        self.assertNotIn(
            "or auth.uid() is not null",
            select_sql,
            "pairing_codes_select must NOT contain 'or auth.uid() is not null' (cross-tenant leak)"
        )

        # pairing_codes_update must require space admin and not allow space_id is null
        update_match = re.search(r'create policy "pairing_codes_update"[\s\S]*?;', self.content)
        self.assertIsNotNone(update_match, "pairing_codes_update policy not found")
        update_sql = update_match.group(0)
        self.assertTrue(
            "space_id is not null and public.is_space_admin(space_id)" in update_sql,
            "pairing_codes_update must restrict modifications to space administrators (is_space_admin)"
        )
        self.assertNotIn(
            "space_id is null",
            update_sql,
            "pairing_codes_update must NOT permit updates when space_id is null"
        )

        # pairing_codes_delete must exist and require space admin
        delete_match = re.search(r'create policy "pairing_codes_delete"[\s\S]*?;', self.content)
        self.assertIsNotNone(delete_match, "pairing_codes_delete policy not found")
        self.assertTrue(
            "space_id is not null and public.is_space_admin(space_id)" in delete_match.group(0),
            "pairing_codes_delete must restrict deletions to space administrators"
        )

    def test_accept_space_invite_rpc(self):
        """Verify accept_space_invite RPC has security definer, set search_path = public, and proper grants."""
        pattern = r"create or replace function public\.accept_space_invite\(p_token text\)[\s\S]*?security definer[\s\S]*?set search_path = public"
        self.assertTrue(
            re.search(pattern, self.content),
            "accept_space_invite(p_token text) must declare security definer and set search_path = public"
        )
        grant_pattern = r"grant execute on function public\.accept_space_invite\(text\) to authenticated, service_role;"
        self.assertTrue(
            re.search(grant_pattern, self.content),
            "Missing grant execute on public.accept_space_invite(text) to authenticated, service_role"
        )


class TestInviteAcceptanceSimulation(unittest.TestCase):
    """Simulate accept_space_invite runtime behavior and edge cases."""

    def simulate_accept_invite(self, auth_uid, auth_jwt_email, token, invites_db, members_db):
        if not auth_uid:
            raise ValueError("Authentication required to accept invitation")

        caller_email = (auth_jwt_email or "").strip().lower()
        if not caller_email:
            raise ValueError("Authenticated user has no verified email address")

        clean_token = (token or "").strip()
        if not clean_token:
            raise ValueError("Invitation token is required")

        # Find matching invite
        matching = None
        for inv in invites_db:
            if (inv.get("token") == clean_token and
                inv.get("status") == "pending" and
                inv.get("expires_at") > datetime.now(timezone.utc) and
                inv.get("email", "").lower() == caller_email):
                matching = inv
                break

        if not matching:
            raise ValueError("Invalid, expired, or unauthorized invite token")

        # Upsert member
        space_id = matching["space_id"]
        role = matching["role"]
        found_member = None
        for m in members_db:
            if m["space_id"] == space_id and m["user_id"] == auth_uid:
                found_member = m
                break

        if found_member:
            if found_member["role"] != "owner":
                found_member["role"] = role
        else:
            members_db.append({
                "id": "new-mem-uuid",
                "space_id": space_id,
                "user_id": auth_uid,
                "role": role,
                "display_name": caller_email.split("@")[0]
            })

        matching["status"] = "accepted"
        return {"success": True, "space_id": space_id, "role": role}

    def test_invite_acceptance_happy_path_and_rejection(self):
        invites = [
            {
                "id": "inv-1",
                "space_id": "space-1",
                "email": "alice@example.com",
                "role": "member",
                "status": "pending",
                "token": "valid_token_123",
                "expires_at": datetime.now(timezone.utc) + timedelta(days=5)
            },
            {
                "id": "inv-2",
                "space_id": "space-1",
                "email": "bob@example.com",
                "role": "admin",
                "status": "pending",
                "token": "expired_token_456",
                "expires_at": datetime.now(timezone.utc) - timedelta(days=1)
            }
        ]
        members = []

        # 1. Happy path
        res = self.simulate_accept_invite("user-alice", "alice@example.com", "valid_token_123", invites, members)
        self.assertTrue(res["success"])
        self.assertEqual(len(members), 1)
        self.assertEqual(members[0]["role"], "member")
        self.assertEqual(invites[0]["status"], "accepted")

        # 2. Replay attack fails
        with self.assertRaises(ValueError) as ctx:
            self.simulate_accept_invite("user-alice", "alice@example.com", "valid_token_123", invites, members)
        self.assertIn("Invalid, expired, or unauthorized", str(ctx.exception))

        # 3. Expired token fails
        with self.assertRaises(ValueError) as ctx:
            self.simulate_accept_invite("user-bob", "bob@example.com", "expired_token_456", invites, members)
        self.assertIn("Invalid, expired, or unauthorized", str(ctx.exception))

        # 4. Email mismatch fails (Eve claims Alice's token)
        invites[0]["status"] = "pending"  # reset
        with self.assertRaises(ValueError) as ctx:
            self.simulate_accept_invite("user-eve", "eve@attacker.com", "valid_token_123", invites, members)
        self.assertIn("Invalid, expired, or unauthorized", str(ctx.exception))


class TestEdgeFunctionLogic(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.path = os.path.abspath(EDGE_FUNC_PATH)
        assert os.path.exists(cls.path), f"Edge function file not found at {cls.path}"
        with open(cls.path, "r", encoding="utf-8") as f:
            cls.content = f.read()

    def test_cors_headers_and_options_method(self):
        """Verify CORS headers and OPTIONS handler are present."""
        self.assertTrue("const corsHeaders = {" in self.content)
        self.assertTrue('"Access-Control-Allow-Origin": "*"' in self.content)
        self.assertTrue('req.method === "OPTIONS"' in self.content)
        self.assertTrue('new Response("ok", { headers: corsHeaders })' in self.content)

    def test_conversion_status_column_resolution(self):
        """Verify record.conversion_status is prioritized over record.status."""
        pattern = r"record\?\.conversion_status \?\? record\?\.status \?\? \"pending\""
        self.assertTrue(
            re.search(pattern, self.content),
            "Edge Function must check record.conversion_status ?? record.status"
        )

    def test_payload_normalization(self):
        """Verify support for both webhook payload (body.record) and direct invocation (body)."""
        pattern = r"\(body\?\.record \?\? body\) as WebhookRecord"
        self.assertTrue(
            re.search(pattern, self.content),
            "Edge Function must normalize body.record ?? body"
        )

    def test_client_payload_structure(self):
        """Verify dispatch client_payload includes file_id, file_name, storage_path, space_id, file_type."""
        for field in ["file_id:", "file_name:", "name:", "storage_path:", "space_id:", "file_type:"]:
            self.assertTrue(
                field in self.content,
                f"Missing {field} in GitHub Actions client_payload"
            )

    def test_convertible_extensions_list(self):
        """Verify convertible extensions include office and PDF formats."""
        for ext in [".docx", ".doc", ".pptx", ".ppt", ".xlsx", ".xls", ".pdf"]:
            self.assertTrue(
                f'"{ext}"' in self.content,
                f"Missing extension {ext} in CONVERTIBLE_EXTENSIONS"
            )

    def test_simulated_runtime_behavior(self):
        """Simulate the edge function logic directly in Python to confirm edge-case handling."""
        convertible_extensions = [
            ".docx", ".doc", ".pptx", ".ppt", ".xlsx", ".xls",
            ".odt", ".ods", ".odp", ".rtf", ".pdf"
        ]

        def process_request(method, headers, body_json, env):
            cors_headers = {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
                "Access-Control-Allow-Methods": "POST, OPTIONS",
            }

            if method == "OPTIONS":
                return 200, "ok", cors_headers

            if method != "POST":
                return 405, {"error": "Method not allowed"}, cors_headers

            auth_header = headers.get("Authorization")
            secret = env.get("CONVERSION_WEBHOOK_SECRET")
            role_key = env.get("SUPABASE_SERVICE_ROLE_KEY")

            if secret or role_key:
                is_secret_match = secret and auth_header == f"Bearer {secret}"
                is_role_match = role_key and auth_header == f"Bearer {role_key}"
                if not is_secret_match and not is_role_match:
                    return 401, {"error": "Unauthorized"}, cors_headers

            record = body_json.get("record") if (isinstance(body_json, dict) and "record" in body_json) else body_json
            if not isinstance(record, dict):
                return 400, {"message": "Invalid record"}, cors_headers

            file_id = record.get("id") or record.get("file_id")
            file_name = record.get("name") or record.get("file_name")
            storage_path = record.get("storage_path")
            space_id = record.get("space_id")
            conversion_status = record.get("conversion_status") or record.get("status") or "pending"

            if not file_id or not file_name:
                return 400, {"message": "missing id or name"}, cors_headers

            lower_name = file_name.lower()
            is_convertible = any(lower_name.endswith(ext) for ext in convertible_extensions)
            if not is_convertible:
                return 200, {"message": f"Skipping: {file_name} does not require conversion"}, cors_headers

            if conversion_status not in ("processing", "pending"):
                return 200, {"message": f"Skipping: conversion_status is '{conversion_status}'"}, cors_headers

            client_payload = {
                "file_id": file_id,
                "file_name": file_name,
                "name": file_name,
                "storage_path": storage_path,
                "space_id": space_id,
                "file_type": record.get("file_type") or record.get("file_category")
            }
            return 200, {"success": True, "dispatched": True, "client_payload": client_payload}, cors_headers

        env = {
            "CONVERSION_WEBHOOK_SECRET": "test_secret_123",
            "SUPABASE_SERVICE_ROLE_KEY": "service_role_key_456"
        }

        # 1. Test OPTIONS preflight
        status, body, _ = process_request("OPTIONS", {}, None, env)
        self.assertEqual(status, 200)
        self.assertEqual(body, "ok")

        # 2. Test GET method not allowed
        status, body, _ = process_request("GET", {}, None, env)
        self.assertEqual(status, 405)

        # 3. Test Unauthorized
        status, body, _ = process_request("POST", {"Authorization": "Bearer wrong_secret"}, {}, env)
        self.assertEqual(status, 401)

        # 4. Test Authorized via WEBHOOK_SECRET with DB Webhook format
        db_payload = {
            "type": "INSERT",
            "table": "files",
            "schema": "public",
            "record": {
                "id": "f001-uuid",
                "name": "Family_Will.docx",
                "storage_path": "space-1/original/f001/Family_Will.docx",
                "conversion_status": "pending",
                "space_id": "s001-uuid",
                "file_category": "office"
            }
        }
        status, body, _ = process_request("POST", {"Authorization": "Bearer test_secret_123"}, db_payload, env)
        self.assertEqual(status, 200)
        self.assertTrue(body["dispatched"])
        self.assertEqual(body["client_payload"]["file_id"], "f001-uuid")
        self.assertEqual(body["client_payload"]["file_name"], "Family_Will.docx")
        self.assertEqual(body["client_payload"]["file_type"], "office")

        # 5. Test Authorized via SUPABASE_SERVICE_ROLE_KEY with Direct format
        direct_payload = {
            "file_id": "f002-uuid",
            "file_name": "Presentation.pptx",
            "storage_path": "space-1/original/f002/Presentation.pptx",
            "status": "processing",
            "space_id": "s001-uuid",
            "file_type": "application/vnd.ms-powerpoint"
        }
        status, body, _ = process_request("POST", {"Authorization": "Bearer service_role_key_456"}, direct_payload, env)
        self.assertEqual(status, 200)
        self.assertTrue(body["dispatched"])
        self.assertEqual(body["client_payload"]["file_id"], "f002-uuid")
        self.assertEqual(body["client_payload"]["file_type"], "application/vnd.ms-powerpoint")

        # 6. Test Non-convertible extension (e.g. image) -> Skipped
        img_payload = {
            "record": {
                "id": "f003-uuid",
                "name": "vacation.png",
                "storage_path": "space-1/original/f003/vacation.png",
                "conversion_status": "ready"
            }
        }
        status, body, _ = process_request("POST", {"Authorization": "Bearer test_secret_123"}, img_payload, env)
        self.assertEqual(status, 200)
        self.assertIn("does not require conversion", body["message"])

        # 7. Test Already ready docx -> Skipped
        ready_payload = {
            "record": {
                "id": "f004-uuid",
                "name": "doc.docx",
                "storage_path": "space-1/original/f004/doc.docx",
                "conversion_status": "ready"
            }
        }
        status, body, _ = process_request("POST", {"Authorization": "Bearer test_secret_123"}, ready_payload, env)
        self.assertEqual(status, 200)
        self.assertIn("conversion_status is 'ready'", body["message"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
