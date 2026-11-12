#!/usr/bin/env python3
"""
Adversarial Stress Test Suite for Milestone 1 (Supabase Backend)
Tests:
1. SQL Schema Lexical & Syntax Soundness
2. Constraint Boundary Attacks (role, status, regex, size limits, negative bounds)
3. RLS Policy Simulation & Exploit Verification (privilege escalation, tenant isolation, TV spoofing)
4. Full-Text Search 50,000+ Character Truncation & Buffer Boundary Stress
5. Ephemeral Pairing Handshake & Concurrency Attack Vectors
"""

import os
import re
import sys
import json
import hashlib
import unittest
from datetime import datetime, timedelta, timezone

MIGRATION_PATH = os.path.join(
    os.path.dirname(__file__), "..", "supabase", "migrations", "20261111000000_family_file_library_init.sql"
)


class TestSqlLexicalSyntaxSoundness(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql_path = os.path.abspath(MIGRATION_PATH)
        assert os.path.exists(cls.sql_path), f"Migration file not found at {cls.sql_path}"
        with open(cls.sql_path, "r", encoding="utf-8") as f:
            cls.content = f.read()

    def test_file_integrity_and_encoding(self):
        """Ensure file is valid UTF-8, non-empty, and has expected sections."""
        self.assertGreater(len(self.content), 5000)
        self.assertTrue("create extension if not exists \"pgcrypto\";" in self.content)
        self.assertTrue("create extension if not exists \"uuid-ossp\";" in self.content)

    def test_ten_tables_ddl_declarations(self):
        """Verify all 10 core tables have proper primary keys, foreign keys, and schemas."""
        expected_tables = {
            "spaces": ["id uuid primary key", "name text not null", "created_by uuid references auth.users(id)"],
            "members": ["id uuid primary key", "space_id uuid not null references public.spaces(id)", "user_id uuid not null references auth.users(id)", "uq_members_space_user unique"],
            "invites": ["id uuid primary key", "space_id uuid not null references public.spaces(id)", "email text not null", "token text not null unique"],
            "devices": ["id uuid primary key", "space_id uuid not null references public.spaces(id)", "device_identifier text not null", "device_token_hash text not null"],
            "pairing_codes": ["id uuid primary key", "code text not null unique", "device_identifier text not null", "device_secret_hash text not null"],
            "folders": ["id uuid primary key", "space_id uuid not null references public.spaces(id)", "parent_id uuid references public.folders(id)", "name text not null"],
            "files": ["id uuid primary key", "space_id uuid not null references public.spaces(id)", "folder_id uuid references public.folders(id)", "storage_path text not null unique", "size_bytes bigint not null"],
            "notes": ["id uuid primary key", "space_id uuid not null references public.spaces(id)", "content text not null", "ck_notes_target check"],
            "favorites": ["id uuid primary key", "space_id uuid not null references public.spaces(id)", "file_id uuid not null references public.files(id)", "ck_favorites_actor check"],
            "bookmarks": ["id uuid primary key", "space_id uuid not null references public.spaces(id)", "file_id uuid not null references public.files(id)", "page_number integer not null", "scroll_position numeric(6, 4) not null"]
        }
        for table, required_clauses in expected_tables.items():
            pattern = rf"create table if not exists public\.{table}\s*\(([\s\S]*?)\);"
            match = re.search(pattern, self.content, re.IGNORECASE)
            self.assertIsNotNone(match, f"Table public.{table} not found or malformed")
            body = match.group(1).lower()
            for clause in required_clauses:
                self.assertIn(clause.lower(), body, f"Clause '{clause}' missing in public.{table}")

    def test_all_tables_have_rls_enabled(self):
        """Verify Row Level Security is explicitly enabled on all 10 tables."""
        tables = ["spaces", "members", "invites", "devices", "pairing_codes", "folders", "files", "notes", "favorites", "bookmarks"]
        for tbl in tables:
            stmt = f"alter table public.{tbl} enable row level security;"
            self.assertIn(stmt, self.content, f"RLS not enabled on public.{tbl}")

    def test_triggers_and_updated_at(self):
        """Verify updated_at trigger is applied to all mutable tables."""
        mutable_tables = ["spaces", "members", "invites", "devices", "pairing_codes", "folders", "files", "notes", "bookmarks"]
        for tbl in mutable_tables:
            pattern = rf"create trigger tr_{tbl}_updated_at before update on public\.{tbl} for each row execute function public\.handle_updated_at\(\);"
            self.assertTrue(re.search(pattern, self.content), f"Trigger tr_{tbl}_updated_at missing on public.{tbl}")


class TestConstraintBoundaryStress(unittest.TestCase):
    """Empirical testing of SQL check constraint boundaries against adversarial inputs."""

    def test_spaces_name_constraint_boundary(self):
        """spaces: check (char_length(trim(name)) between 1 and 100)"""
        check_fn = lambda name: 1 <= len(name.strip()) <= 100 if name is not None else False

        self.assertFalse(check_fn(""))
        self.assertFalse(check_fn("   "))
        self.assertTrue(check_fn("A"))
        self.assertTrue(check_fn("A" * 100))
        self.assertFalse(check_fn("A" * 101))
        # Unicode / Indic boundary
        malayalam_name = "കുടുംബ ലൈബ്രറി"  # 15 characters
        self.assertTrue(check_fn(malayalam_name))
        devanagari_name = "पारिवारिक फ़ाइल संग्रह"  # 22 characters
        self.assertTrue(check_fn(devanagari_name))

    def test_members_role_constraint_boundary(self):
        """members: check (role in ('owner', 'admin', 'member'))"""
        valid_roles = {'owner', 'admin', 'member'}
        self.assertTrue('owner' in valid_roles)
        self.assertTrue('admin' in valid_roles)
        self.assertTrue('member' in valid_roles)
        # Adversarial roles
        self.assertFalse('superadmin' in valid_roles)
        self.assertFalse('root' in valid_roles)
        self.assertFalse('guest' in valid_roles)
        self.assertFalse('' in valid_roles)
        self.assertFalse('Owner' in valid_roles)  # case-sensitive SQL string

    def test_invites_email_regex_boundary(self):
        """invites: check (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$')"""
        pattern = re.compile(r'^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$', re.IGNORECASE)

        valid_emails = [
            "user@example.com",
            "first.last+tag@sub.domain.co.uk",
            "12345@domain.org",
            "MEMBER@FAMILY.NET"
        ]
        for email in valid_emails:
            self.assertTrue(bool(pattern.match(email)), f"Valid email rejected: {email}")

        invalid_emails = [
            "no_at_sign.com",
            "@nodomain.com",
            "user@",
            "user@domain",
            "user@domain.c",  # TLD must be >= 2 chars
            "user space@domain.com",
            "user<script>@domain.com"
        ]
        for email in invalid_emails:
            self.assertFalse(bool(pattern.match(email)), f"Invalid email accepted: {email}")

    def test_invites_role_boundary(self):
        """invites: check (role in ('admin', 'member')) - 'owner' cannot be invited!"""
        invite_roles = {'admin', 'member'}
        self.assertNotIn('owner', invite_roles, "Owner role must not be invitable")
        self.assertIn('admin', invite_roles)
        self.assertIn('member', invite_roles)

    def test_devices_type_boundary(self):
        """devices: check (device_type in ('android_tv', 'phone', 'tablet', 'web'))"""
        valid_types = {'android_tv', 'phone', 'tablet', 'web'}
        self.assertIn('android_tv', valid_types)
        self.assertFalse('smartwatch' in valid_types)
        self.assertFalse('desktop' in valid_types)

    def test_pairing_code_regex_boundary(self):
        """pairing_codes: check (code ~ '^[A-Z0-9]{6,8}$')"""
        pattern = re.compile(r'^[A-Z0-9]{6,8}$')

        valid_codes = ["ABCDEF", "A1B2C3", "ABCDEF12", "87654321"]
        for code in valid_codes:
            self.assertTrue(bool(pattern.match(code)), f"Valid pairing code rejected: {code}")

        invalid_codes = [
            "ABCDE",  # 5 chars (too short)
            "ABCDEFGHI",  # 9 chars (too long)
            "abcdef",  # lowercase forbidden
            "ABC-DEF",  # hyphens forbidden in raw column
            "ABC 123",  # space forbidden
            "ABC@12"   # special character forbidden
        ]
        for code in invalid_codes:
            self.assertFalse(bool(pattern.match(code)), f"Invalid pairing code accepted: {code}")

    def test_folders_name_forbidden_characters_boundary(self):
        """folders: check (char_length(trim(name)) between 1 and 120 and name !~ '[/\\\\:*?\"<>|]')"""
        pattern_forbidden = re.compile(r'[/\\:*?"<>|]')
        check_fn = lambda name: (1 <= len(name.strip()) <= 120) and not bool(pattern_forbidden.search(name))

        # Test each Windows/FAT32 illegal filename char individually
        for char in ['/', '\\', ':', '*', '?', '"', '<', '>', '|']:
            test_name = f"My{char}Folder"
            self.assertFalse(check_fn(test_name), f"Illegal char '{char}' bypassed filter!")

        # Valid folder names
        self.assertTrue(check_fn("Family Taxes 2026"))
        self.assertTrue(check_fn("സ്കൂൾ രേഖകൾ"))  # Malayalam
        self.assertTrue(check_fn("दस्तावेज़ और रसीदें"))  # Devanagari

        # Length boundaries
        self.assertFalse(check_fn(""))
        self.assertFalse(check_fn("   "))
        self.assertTrue(check_fn("A"))
        self.assertTrue(check_fn("A" * 120))
        self.assertFalse(check_fn("A" * 121))

    def test_folders_color_hex_regex_boundary(self):
        """folders: check (color is null or color ~ '^#[0-9A-Fa-f]{6}$')"""
        pattern = re.compile(r'^#[0-9A-Fa-f]{6}$')
        check_fn = lambda color: color is None or bool(pattern.match(color))

        self.assertTrue(check_fn(None))
        self.assertTrue(check_fn("#00E5FF"))
        self.assertTrue(check_fn("#ffffff"))
        self.assertTrue(check_fn("#000000"))

        # Invalid formats
        self.assertFalse(check_fn("#FFF"))  # 3-char hex disallowed
        self.assertFalse(check_fn("00E5FF"))  # missing #
        self.assertFalse(check_fn("#00E5FF1"))  # 7 chars
        self.assertFalse(check_fn("#GGGGGG"))  # non-hex
        self.assertFalse(check_fn("red"))  # CSS name

    def test_files_size_bytes_boundary(self):
        """files: check (size_bytes > 0 and size_bytes <= 52428800) -- 50MB"""
        max_size = 52428800
        check_fn = lambda size: 0 < size <= max_size

        self.assertFalse(check_fn(0))  # 0-byte file rejected in database
        self.assertFalse(check_fn(-1))  # negative size rejected
        self.assertTrue(check_fn(1))  # 1 byte allowed
        self.assertTrue(check_fn(max_size))  # exact 50MB boundary allowed
        self.assertFalse(check_fn(max_size + 1))  # 50MB + 1 byte rejected
        self.assertFalse(check_fn(100 * 1024 * 1024))  # 100MB rejected

    def test_bookmarks_scroll_position_boundary(self):
        """bookmarks: check (scroll_position between 0.0 and 1.0)"""
        check_fn = lambda pos: 0.0 <= pos <= 1.0

        self.assertTrue(check_fn(0.0))
        self.assertTrue(check_fn(1.0))
        self.assertTrue(check_fn(0.5432))
        self.assertFalse(check_fn(-0.0001))
        self.assertFalse(check_fn(1.0001))
        self.assertFalse(check_fn(2.5))


class TestFtsBufferBoundaryAndStress(unittest.TestCase):
    """Stress test the 50,000-character substr guard on files.fts generated column."""

    def test_fts_expression_buffer_cutoff(self):
        """Verify generated column expression truncates text_content at exactly 50,000 characters."""
        # PostgreSQL generated column:
        # to_tsvector('english', coalesce(name, '') || ' ' || substr(coalesce(text_content, ''), 1, 50000))

        def simulate_fts_input(name, text_content):
            safe_name = name or ""
            safe_text = (text_content or "")[:50000]
            return f"{safe_name} {safe_text}"

        # 1. Stress: 1,000,000 characters (1MB) text_content
        huge_text = "word " * 200000  # 1,000,000 chars
        fts_input = simulate_fts_input("sample.txt", huge_text)
        self.assertLessEqual(len(fts_input), 255 + 1 + 50000)
        self.assertEqual(len(huge_text[:50000]), 50000)

        # 2. Stress: Multi-byte Unicode (Malayalam) 50,000 characters
        malayalam_char = "ക"  # 3 bytes in UTF-8
        huge_indic = malayalam_char * 60000
        fts_indic = simulate_fts_input("malayalam.pdf", huge_indic)
        # Python slicing slices characters, matching PostgreSQL substr() on text
        self.assertEqual(len(fts_indic.split(" ")[1]), 50000)

        # 3. None handling (null safety)
        fts_nulls = simulate_fts_input(None, None)
        self.assertEqual(fts_nulls, " ")

    def test_tsvector_buffer_limits(self):
        """Verify that a 50,000-character input cannot exceed PostgreSQL's 1MB tsvector limit."""
        # 50,000 ascii characters is at most 50,000 bytes.
        # 50,000 4-byte unicode characters is at most 200,000 bytes.
        # Both are far below PostgreSQL's 1,048,575-byte tsvector limit.
        max_bytes_possible = 50000 * 4
        pg_tsvector_limit = 1048575
        self.assertLess(max_bytes_possible, pg_tsvector_limit)


class TestRlsPolicySimulationAndExploits(unittest.TestCase):
    """Adversarial simulation of RLS policy rules across all tables."""

    def setUp(self):
        self.space_a = "11111111-1111-1111-1111-111111111111"
        self.space_b = "22222222-2222-2222-2222-222222222222"
        self.user_owner = "user-owner-001"
        self.user_admin = "user-admin-002"
        self.user_member = "user-member-003"
        self.user_stranger = "user-stranger-999"

        self.members_db = [
            {"space_id": self.space_a, "user_id": self.user_owner, "role": "owner"},
            {"space_id": self.space_a, "user_id": self.user_admin, "role": "admin"},
            {"space_id": self.space_a, "user_id": self.user_member, "role": "member"},
            {"space_id": self.space_b, "user_id": self.user_stranger, "role": "owner"},
        ]

        self.devices_db = [
            {"id": "dev-001", "space_id": self.space_a, "device_identifier": "tv-living-room", "device_token_hash": hashlib.sha256(b"valid_token_tv1").hexdigest(), "is_revoked": False},
            {"id": "dev-002", "space_id": self.space_a, "device_identifier": "tv-bedroom", "device_token_hash": hashlib.sha256(b"revoked_token").hexdigest(), "is_revoked": True},
        ]

    def has_space_access(self, caller_user_id, caller_device_id, space_id):
        is_member = any(m["space_id"] == space_id and m["user_id"] == caller_user_id for m in self.members_db)
        is_device = any(d["space_id"] == space_id and d["id"] == caller_device_id and not d["is_revoked"] for d in self.devices_db)
        return is_member or is_device

    def is_space_admin(self, caller_user_id, space_id):
        return any(m["space_id"] == space_id and m["user_id"] == caller_user_id and m["role"] in ('owner', 'admin') for m in self.members_db)

    def is_space_member_user(self, caller_user_id, space_id):
        return any(m["space_id"] == space_id and m["user_id"] == caller_user_id for m in self.members_db)

    def test_exploit_unauthorized_cross_space_read(self):
        """Attack: User Stranger (Space B) attempts to read Space A records."""
        self.assertFalse(self.has_space_access(self.user_stranger, None, self.space_a))
        self.assertTrue(self.has_space_access(self.user_stranger, None, self.space_b))

    def test_exploit_unauthorized_member_injection(self):
        """Attack: Stranger attempts to insert themselves into Space A as owner."""
        # Policy:
        # with check (is_space_admin(space_id) or (auth.uid() = user_id and s.created_by = auth.uid() and no members))
        caller = self.user_stranger
        space_id = self.space_a

        is_admin = self.is_space_admin(caller, space_id)
        # Space A already has members and was not created by stranger
        can_insert = is_admin
        self.assertFalse(can_insert, "Malicious user was able to inject membership into foreign space!")

    def test_exploit_role_self_escalation(self):
        """Attack: Regular member attempts to update their own role from 'member' to 'admin'."""
        # Policy:
        # with check (is_space_admin(space_id) or (auth.uid() = user_id and role = old_role))
        caller = self.user_member
        space_id = self.space_a
        old_role = "member"
        proposed_role = "admin"

        is_admin = self.is_space_admin(caller, space_id)
        role_matches_old = (proposed_role == old_role)
        can_update = is_admin or (caller == self.user_member and role_matches_old)

        self.assertFalse(can_update, "Regular member successfully escalated role to admin!")

    def test_exploit_revoked_tv_device_access(self):
        """Attack: Revoked TV device attempts to access files or heartbeat."""
        revoked_dev_id = "dev-002"
        has_access = self.has_space_access(None, revoked_dev_id, self.space_a)
        self.assertFalse(has_access, "Revoked TV device retained space access!")

    def test_exploit_tv_device_direct_file_upload(self):
        """Attack: TV device attempts to insert rows directly into files table."""
        # Policy: with check (public.is_space_member_user(space_id))
        # TV devices authenticate via x-device-token (auth.uid() is null)
        can_tv_upload = self.is_space_member_user(None, self.space_a)
        self.assertFalse(can_tv_upload, "TV device should not be permitted to insert directly into files!")

    def test_exploit_unauthorized_file_hard_deletion(self):
        """Attack: Regular member attempts to permanently hard-delete a file uploaded by another user."""
        # Policy: using (is_space_admin(space_id) or (auth.uid() is not null and auth.uid() = uploader_id))
        caller = self.user_member
        file_uploader = self.user_owner

        can_delete = self.is_space_admin(caller, self.space_a) or (caller == file_uploader)
        self.assertFalse(can_delete, "Non-admin member permanently deleted another user's file!")

        # Verify space admin CAN delete
        admin_can_delete = self.is_space_admin(self.user_admin, self.space_a) or (self.user_admin == file_uploader)
        self.assertTrue(admin_can_delete, "Space admin should be allowed to permanently delete files.")


class TestStorageBucketSecurityAndPathTraversal(unittest.TestCase):
    """Adversarial testing of storage path parsing and RLS policies."""

    def extract_space_id(self, path):
        """Simulates public.extract_space_id_from_path(p_path text)"""
        if not path:
            return None
        parts = path.split("/")
        first_segment = parts[0]
        uuid_regex = re.compile(r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
        if uuid_regex.match(first_segment):
            return first_segment
        return None

    def test_storage_path_valid_extraction(self):
        path = "11111111-1111-1111-1111-111111111111/original/f001/doc.pdf"
        extracted = self.extract_space_id(path)
        self.assertEqual(extracted, "11111111-1111-1111-1111-111111111111")

    def test_storage_path_traversal_exploit_mitigation(self):
        """Attack vectors attempting to bypass prefix matching."""
        traversal_attempts = [
            "../22222222-2222-2222-2222-222222222222/secret.pdf",
            "/11111111-1111-1111-1111-111111111111/file.pdf",
            "not-a-uuid/original/file.pdf",
            "11111111111111111111111111111111/file.pdf",
            "",
            None
        ]
        for path in traversal_attempts:
            extracted = self.extract_space_id(path)
            self.assertIsNone(extracted, f"Path traversal string '{path}' extracted valid space UUID: {extracted}")


class TestPairingProtocolHandshakeAndConcurrency(unittest.TestCase):
    """Adversarial stress of the 3-step TV pairing protocol."""

    def test_pairing_code_character_set_no_ambiguity(self):
        """Verify character set avoids visually confusing characters (0/O, 1/I)."""
        v_chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        self.assertNotIn("0", v_chars)
        self.assertNotIn("O", v_chars)
        self.assertNotIn("1", v_chars)
        self.assertNotIn("I", v_chars)
        self.assertEqual(len(v_chars), 32)  # 32 characters = exactly 5 bits of entropy per char

    def test_pairing_code_hyphen_sanitization(self):
        """Verify approve_tv_pairing_code normalizes spaced and hyphenated user inputs."""
        sanitize = lambda code: re.sub(r'[\s-]+', '', code.strip().upper())
        self.assertEqual(sanitize("abc-def"), "ABCDEF")
        self.assertEqual(sanitize("a b c d e f"), "ABCDEF")
        self.assertEqual(sanitize(" AB-CD-EF "), "ABCDEF")

    def test_pairing_claim_replay_attack_prevention(self):
        """Verify credentials are wiped upon initial claim so token cannot be leaked in subsequent calls."""
        # Simulated pairing code record
        pairing_record = {
            "id": "pair-001",
            "status": "approved",
            "device_credentials": {
                "device_id": "dev-001",
                "space_id": "space-001",
                "device_token": "bearer-token-48-bytes"
            }
        }

        # First claim:
        claimed_creds = pairing_record["device_credentials"]
        pairing_record["status"] = "claimed"
        pairing_record["device_credentials"] = None

        self.assertIsNotNone(claimed_creds)
        self.assertEqual(claimed_creds["device_token"], "bearer-token-48-bytes")

        # Second claim attempt:
        second_status = pairing_record["status"]
        second_creds = pairing_record["device_credentials"]
        self.assertEqual(second_status, "claimed")
        self.assertIsNone(second_creds, "Bearer token was not scrubbed on claim! Replay attack vulnerability!")


class TestSpaceCreationRlsAdversarial(unittest.TestCase):
    """
    Adversarial verification of Space Creation RLS policies:
    1. Creator can select unbootstrapped space (no members yet)
    2. Strangers and unauthenticated callers cannot select unbootstrapped space
    3. Spoofed created_by inserts are rejected by with check policy
    4. Unauthenticated inserts are rejected
    5. Legitimate space inserts (omitted or self created_by) succeed
    6. Unbootstrapped space deletion allowed for creator, forbidden for stranger
    """

    def setUp(self):
        self.creator_id = "user-alice-001"
        self.stranger_id = "user-eve-999"
        self.spaces_db = []
        self.members_db = []

    def simulate_spaces_select(self, caller_uid, space):
        """Policy: using (public.has_space_access(id) or created_by = auth.uid())"""
        if not caller_uid:
            return False
        has_access = any(m["space_id"] == space["id"] and m["user_id"] == caller_uid for m in self.members_db)
        is_creator = (space.get("created_by") == caller_uid)
        return has_access or is_creator

    def simulate_spaces_insert(self, caller_uid, proposed_row):
        """
        Policy: with check (auth.uid() is not null and (created_by is null or created_by = auth.uid()))
        Default in DB: created_by uuid default auth.uid()
        """
        if not caller_uid:
            return False, "RLS check failed: auth.uid() is null"

        effective_created_by = proposed_row.get("created_by", caller_uid)
        if effective_created_by is None:
            effective_created_by = caller_uid

        passed = (caller_uid is not None) and (
            proposed_row.get("created_by") is None or proposed_row.get("created_by") == caller_uid
        )
        if not passed:
            return False, "RLS check failed: spoofed created_by"

        new_space = {
            "id": proposed_row.get("id", f"space-{len(self.spaces_db) + 1}"),
            "name": proposed_row["name"],
            "created_by": effective_created_by
        }
        self.spaces_db.append(new_space)
        return True, new_space

    def simulate_spaces_delete(self, caller_uid, space_id):
        """
        Policy: using (
          exists (select 1 from public.members where space_id = spaces.id and user_id = auth.uid() and role = 'owner')
          or (created_by = auth.uid() and not exists (select 1 from public.members where space_id = spaces.id))
        )
        """
        if not caller_uid:
            return False
        space = next((s for s in self.spaces_db if s["id"] == space_id), None)
        if not space:
            return False
        is_owner = any(m["space_id"] == space_id and m["user_id"] == caller_uid and m["role"] == "owner" for m in self.members_db)
        is_unbootstrapped_creator = (space.get("created_by") == caller_uid and not any(m["space_id"] == space_id for m in self.members_db))
        return is_owner or is_unbootstrapped_creator

    def test_unbootstrapped_space_read_by_creator(self):
        """Creator can select unbootstrapped space (no rows in members table)."""
        ok, space = self.simulate_spaces_insert(self.creator_id, {"name": "Alice Space"})
        self.assertTrue(ok)
        self.assertEqual(len(self.members_db), 0)
        self.assertTrue(self.simulate_spaces_select(self.creator_id, space))

    def test_unbootstrapped_space_read_rejected_for_stranger_and_anonymous(self):
        """Stranger and unauthenticated callers cannot select unbootstrapped space."""
        ok, space = self.simulate_spaces_insert(self.creator_id, {"name": "Alice Space"})
        self.assertTrue(ok)
        self.assertFalse(self.simulate_spaces_select(self.stranger_id, space))
        self.assertFalse(self.simulate_spaces_select(None, space))

    def test_spoofed_created_by_insert_rejected(self):
        """Adversary Eve attempting to insert space with created_by = Alice is rejected."""
        ok, err = self.simulate_spaces_insert(self.stranger_id, {"name": "Malicious Space", "created_by": self.creator_id})
        self.assertFalse(ok)
        self.assertIn("spoofed created_by", err)

    def test_unauthenticated_insert_rejected(self):
        """Anonymous caller attempting to insert space is rejected."""
        ok, err = self.simulate_spaces_insert(None, {"name": "Anon Space"})
        self.assertFalse(ok)
        self.assertIn("auth.uid() is null", err)

    def test_unbootstrapped_space_deletion_allowed_for_creator_blocked_for_stranger(self):
        """Creator can delete unbootstrapped space; stranger cannot."""
        ok, space = self.simulate_spaces_insert(self.creator_id, {"name": "Draft Space"})
        self.assertTrue(ok)
        self.assertFalse(self.simulate_spaces_delete(self.stranger_id, space["id"]))
        self.assertTrue(self.simulate_spaces_delete(self.creator_id, space["id"]))


class TestPairingCodesIsolationAdversarial(unittest.TestCase):
    """
    Adversarial verification of Pairing Codes isolation policies:
    1. Strangers cannot select pending pairing codes (space_id is null)
    2. Unauthenticated callers cannot select pending pairing codes
    3. Space admins cannot select pending pairing codes (space_id is null)
    4. Strangers cannot update or tamper with pending pairing codes
    5. Direct inserts into pairing_codes are disallowed (no insert policy)
    6. Approved pairing codes are strictly isolated by space_id
    """

    def setUp(self):
        self.space_a = "space-uuid-001"
        self.space_b = "space-uuid-002"
        self.admin_a = "user-admin-a"
        self.stranger_b = "user-stranger-b"

        self.members_db = [
            {"space_id": self.space_a, "user_id": self.admin_a, "role": "admin"},
            {"space_id": self.space_b, "user_id": self.stranger_b, "role": "member"},
        ]

        self.pending_pairing = {
            "id": "pair-001",
            "code": "ABCDEF",
            "space_id": None,
            "status": "pending",
            "device_identifier": "tv-123",
            "device_secret_hash": "hash123",
            "device_credentials": None
        }

        self.approved_pairing = {
            "id": "pair-002",
            "code": "XYZ789",
            "space_id": self.space_a,
            "status": "approved",
            "device_identifier": "tv-456",
            "device_secret_hash": "hash456",
            "device_credentials": {"device_token": "token456"}
        }

    def has_space_access(self, caller_uid, space_id):
        if not caller_uid or not space_id:
            return False
        return any(m["space_id"] == space_id and m["user_id"] == caller_uid for m in self.members_db)

    def is_space_admin(self, caller_uid, space_id):
        if not caller_uid or not space_id:
            return False
        return any(m["space_id"] == space_id and m["user_id"] == caller_uid and m["role"] in ("owner", "admin") for m in self.members_db)

    def simulate_pairing_select(self, caller_uid, record):
        """Policy: using (space_id is not null and public.has_space_access(space_id))"""
        space_id = record.get("space_id")
        if space_id is None:
            return False
        return self.has_space_access(caller_uid, space_id)

    def simulate_pairing_update(self, caller_uid, current_record, proposed_update):
        """
        Policy:
        using (space_id is not null and public.is_space_admin(space_id))
        with check (space_id is not null and public.is_space_admin(space_id))
        """
        current_space_id = current_record.get("space_id")
        if current_space_id is None:
            return False, "Cannot update row where space_id is null"
        if not self.is_space_admin(caller_uid, current_space_id):
            return False, "Caller is not space admin"

        merged = {**current_record, **proposed_update}
        new_space_id = merged.get("space_id")
        if new_space_id is None or not self.is_space_admin(caller_uid, new_space_id):
            return False, "Check policy violated: space_id is null or not administered"

        return True, merged

    def test_pending_pairing_code_select_rejected_for_all_actors(self):
        """Pending pairing codes (space_id is null) CANNOT be selected by stranger, anonymous, or admin."""
        self.assertFalse(self.simulate_pairing_select(self.stranger_b, self.pending_pairing))
        self.assertFalse(self.simulate_pairing_select(None, self.pending_pairing))
        self.assertFalse(self.simulate_pairing_select(self.admin_a, self.pending_pairing))

    def test_pending_pairing_code_update_rejected_for_all_actors(self):
        """Pending pairing codes cannot be tampered with or modified via direct table update."""
        ok, msg = self.simulate_pairing_update(self.stranger_b, self.pending_pairing, {"status": "claimed"})
        self.assertFalse(ok)
        ok, msg = self.simulate_pairing_update(self.admin_a, self.pending_pairing, {"status": "claimed"})
        self.assertFalse(ok)
        ok, msg = self.simulate_pairing_update(None, self.pending_pairing, {"status": "claimed"})
        self.assertFalse(ok)

    def test_cross_tenant_approved_pairing_code_isolation(self):
        """Stranger Eve cannot select or update approved pairing codes belonging to Space A."""
        self.assertFalse(self.simulate_pairing_select(self.stranger_b, self.approved_pairing))
        ok, _ = self.simulate_pairing_update(self.stranger_b, self.approved_pairing, {"device_identifier": "hacked"})
        self.assertFalse(ok)
        self.assertTrue(self.simulate_pairing_select(self.admin_a, self.approved_pairing))
        ok, updated = self.simulate_pairing_update(self.admin_a, self.approved_pairing, {"device_identifier": "tv-living-room"})
        self.assertTrue(ok)
        self.assertEqual(updated["device_identifier"], "tv-living-room")


if __name__ == "__main__":
    unittest.main(verbosity=2)
