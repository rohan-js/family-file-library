#!/usr/bin/env python3
"""
Adversarial Empirical Stress Test Suite for accept_space_invite RPC
Milestone 1: Supabase Backend (Challenger 2, Round 2)

Tests:
1. SQL Static Analysis & Contract Verification
2. Relational Execution Simulation (SQLite engine with exact SQL logic)
3. Concurrent Thread Stress Test (Race Condition & Replay Attack)
4. Comprehensive Adversarial Edge Case Matrix (50+ scenarios)
"""

import os
import re
import sys
import uuid
import sqlite3
import unittest
import threading
from datetime import datetime, timedelta, timezone

MIGRATION_PATH = os.path.join(
    os.path.dirname(__file__), "..", "supabase", "migrations", "20261111000000_family_file_library_init.sql"
)


class TestSqlStaticAnalysis(unittest.TestCase):
    """Static analysis of public.accept_space_invite in the SQL migration file."""

    @classmethod
    def setUpClass(cls):
        cls.path = os.path.abspath(MIGRATION_PATH)
        assert os.path.exists(cls.path), f"Migration file not found at {cls.path}"
        with open(cls.path, "r", encoding="utf-8") as f:
            cls.content = f.read()

        # Extract accept_space_invite function body
        func_match = re.search(
            r"create or replace function public\.accept_space_invite\((.*?)\)[\s\S]*?as \$\$(.*?)\$\$",
            cls.content,
            re.IGNORECASE | re.DOTALL,
        )
        assert func_match, "accept_space_invite function definition not found in migration"
        cls.func_sig = func_match.group(1).strip()
        cls.func_body = func_match.group(2).strip()

    def test_function_signature_and_security(self):
        """Verify signature, security definer, and set search_path = public."""
        self.assertIn("p_token text", self.func_sig)
        func_block = re.search(
            r"create or replace function public\.accept_space_invite\(p_token text\)[\s\S]*?returns jsonb[\s\S]*?security definer[\s\S]*?set search_path = public",
            self.content,
            re.IGNORECASE,
        )
        self.assertIsNotNone(
            func_block,
            "accept_space_invite must specify 'returns jsonb', 'security definer', and 'set search_path = public'"
        )

    def test_authentication_guard(self):
        """Verify strict authentication guard at start of function."""
        self.assertIn("if auth.uid() is null then", self.func_body)
        self.assertIn("raise exception 'Authentication required to accept invitation';", self.func_body)

    def test_caller_email_extraction_and_fallback(self):
        """Verify caller email extraction from JWT with auth.users fallback and lower(trim())."""
        pattern = r"v_caller_email\s*:=\s*lower\(trim\(coalesce\(\s*auth\.jwt\(\)->>'email',\s*\(select email from auth\.users where id = auth\.uid\(\)\)\s*\)\)\);"
        self.assertTrue(
            re.search(pattern, self.func_body),
            "Caller email extraction must sanitize with lower(trim(coalesce(auth.jwt()->>'email', (select email from auth.users where id = auth.uid()))))"
        )
        self.assertIn("raise exception 'Authenticated user has no verified email address';", self.func_body)

    def test_token_sanitization_and_validation(self):
        """Verify token input is trimmed and checked for null/empty."""
        self.assertIn("v_clean_token := trim(p_token);", self.func_body)
        self.assertIn("if v_clean_token is null or v_clean_token = '' then", self.func_body)
        self.assertIn("raise exception 'Invitation token is required';", self.func_body)

    def test_row_locking_and_query_predicates(self):
        """Verify for update locking and strict validation conditions."""
        self.assertIn("for update;", self.func_body, "Must include 'for update' lock to prevent concurrency race")
        self.assertIn("where token = v_clean_token", self.func_body)
        self.assertIn("and status = 'pending'", self.func_body)
        self.assertIn("and expires_at > now()", self.func_body)
        self.assertIn("and lower(email) = v_caller_email", self.func_body)
        self.assertIn("raise exception 'Invalid, expired, or unauthorized invite token';", self.func_body)

    def test_membership_upsert_and_owner_downgrade_prevention(self):
        """Verify on conflict do update preserves owner role."""
        self.assertIn("on conflict (space_id, user_id) do update set", self.func_body)
        pattern = r"role\s*=\s*case\s*when\s+members\.role\s*=\s*'owner'\s+then\s+'owner'[\s\S]*?else\s+excluded\.role\s+end"
        self.assertTrue(
            re.search(pattern, self.func_body),
            "Membership upsert must strictly prevent owner downgrade: case when members.role = 'owner' then 'owner' else excluded.role end"
        )
        self.assertIn("returning id into v_member_id;", self.func_body)

    def test_invitation_status_transition(self):
        """Verify invitation status is transitioned to 'accepted' with updated_at."""
        pattern = r"update public\.invites\s+set\s+status\s*=\s*'accepted',\s*updated_at\s*=\s*now\(\)\s+where id\s*=\s*v_invite\.id;"
        self.assertTrue(
            re.search(pattern, self.func_body),
            "Invite status must transition to 'accepted' with updated_at = now() where id = v_invite.id"
        )

    def test_security_grants(self):
        """Verify execution grants are given ONLY to authenticated and service_role, NEVER anon."""
        grant_pattern = r"grant execute on function public\.accept_space_invite\(text\) to authenticated, service_role;"
        self.assertTrue(
            re.search(grant_pattern, self.content),
            "Must grant execute to authenticated, service_role"
        )
        # Ensure anon is not granted
        anon_grant = re.search(r"grant execute on function public\.accept_space_invite.*to.*anon", self.content)
        self.assertIsNone(anon_grant, "Public/anon must NOT be granted execute on accept_space_invite")


class SqliteInviteSimulator:
    """Relational SQL simulation replicating PostgreSQL schema and accept_space_invite PL/pgSQL function."""

    def __init__(self):
        self.conn = sqlite3.connect(":memory:", check_same_thread=False)
        self.lock = threading.Lock()
        self._init_schema()

    def _init_schema(self):
        with self.conn:
            self.conn.execute("""
                CREATE TABLE auth_users (
                    id TEXT PRIMARY KEY,
                    email TEXT NOT NULL
                );
            """)
            self.conn.execute("""
                CREATE TABLE spaces (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    created_by TEXT NOT NULL
                );
            """)
            self.conn.execute("""
                CREATE TABLE members (
                    id TEXT PRIMARY KEY,
                    space_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
                    display_name TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                    UNIQUE(space_id, user_id)
                );
            """)
            self.conn.execute("""
                CREATE TABLE invites (
                    id TEXT PRIMARY KEY,
                    space_id TEXT NOT NULL,
                    email TEXT NOT NULL,
                    invited_by TEXT NOT NULL,
                    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
                    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'expired')),
                    token TEXT NOT NULL UNIQUE,
                    expires_at TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                    UNIQUE(space_id, email)
                );
            """)

    def accept_space_invite(self, auth_uid, jwt_claims, p_token):
        """Executes the exact relational SQL steps of accept_space_invite."""
        # 1. Ensure caller is authenticated
        if not auth_uid:
            raise ValueError("Authentication required to accept invitation")

        # 2. Extract and validate caller email from JWT claims (or auth.users fallback)
        jwt_email = (jwt_claims.get("email") if jwt_claims else None)
        if jwt_email:
            v_caller_email = jwt_email.strip().lower()
        else:
            cur = self.conn.execute("SELECT email FROM auth_users WHERE id = ?", (auth_uid,))
            row = cur.fetchone()
            v_caller_email = row[0].strip().lower() if row and row[0] else None

        if not v_caller_email:
            raise ValueError("Authenticated user has no verified email address")

        # 3. Sanitize token input
        v_clean_token = p_token.strip() if p_token is not None else None
        if not v_clean_token:
            raise ValueError("Invitation token is required")

        # Transaction with row-level locking simulation
        with self.lock:
            with self.conn:
                # 4. Locate and lock pending invitation record
                # Note: expires_at stored as ISO UTC string
                cur = self.conn.execute(
                    """
                    SELECT id, space_id, email, role, status, expires_at
                    FROM invites
                    WHERE token = ?
                      AND status = 'pending'
                      AND expires_at > datetime('now')
                      AND lower(email) = ?
                    """,
                    (v_clean_token, v_caller_email)
                )
                invite_row = cur.fetchone()
                if not invite_row:
                    raise ValueError("Invalid, expired, or unauthorized invite token")

                invite_id, space_id, inv_email, inv_role, _, _ = invite_row

                # Compute display name
                jwt_name = jwt_claims.get("name") if jwt_claims else None
                jwt_full_name = jwt_claims.get("full_name") if jwt_claims else None
                display_name = (
                    (jwt_name.strip() if jwt_name and jwt_name.strip() else None) or
                    (jwt_full_name.strip() if jwt_full_name and jwt_full_name.strip() else None) or
                    v_caller_email.split("@")[0]
                )

                # 5. Insert or update membership in target space
                new_member_id = str(uuid.uuid4())
                cur = self.conn.execute(
                    """
                    INSERT INTO members (id, space_id, user_id, role, display_name, updated_at)
                    VALUES (?, ?, ?, ?, ?, datetime('now'))
                    ON CONFLICT(space_id, user_id) DO UPDATE SET
                        role = CASE
                            WHEN members.role = 'owner' THEN 'owner'
                            ELSE excluded.role
                        END,
                        updated_at = datetime('now')
                    RETURNING id, role;
                    """,
                    (new_member_id, space_id, auth_uid, inv_role, display_name)
                )
                upserted_id, final_role = cur.fetchone()

                # 6. Transition invitation status to 'accepted'
                self.conn.execute(
                    """
                    UPDATE invites
                    SET status = 'accepted', updated_at = datetime('now')
                    WHERE id = ?
                    """,
                    (invite_id,)
                )

                # 7. Return success payload
                return {
                    "success": True,
                    "space_id": space_id,
                    "member_id": upserted_id,
                    "role": inv_role,
                    "final_member_role": final_role
                }


class TestRelationalSimulation(unittest.TestCase):
    """Adversarial stress-testing using the relational SQL simulator."""

    def setUp(self):
        self.sim = SqliteInviteSimulator()
        # Seed test data
        with self.sim.conn:
            self.sim.conn.execute("INSERT INTO auth_users (id, email) VALUES ('u-creator', 'creator@family.local')")
            self.sim.conn.execute("INSERT INTO auth_users (id, email) VALUES ('u-alice', 'alice@family.local')")
            self.sim.conn.execute("INSERT INTO auth_users (id, email) VALUES ('u-eve', 'eve@attacker.local')")
            self.sim.conn.execute("INSERT INTO spaces (id, name, created_by) VALUES ('s-01', 'Our Home Space', 'u-creator')")
            self.sim.conn.execute("INSERT INTO members (id, space_id, user_id, role, display_name) VALUES ('m-owner', 's-01', 'u-creator', 'owner', 'Creator')")

    def test_happy_path_acceptance(self):
        """Test valid pending invite accepted by matching authenticated user."""
        token = "valid_tok_001"
        fut_date = (datetime.now(timezone.utc) + timedelta(days=5)).strftime("%Y-%m-%d %H:%M:%S")
        with self.sim.conn:
            self.sim.conn.execute(
                "INSERT INTO invites (id, space_id, email, invited_by, role, status, token, expires_at) "
                "VALUES ('inv-01', 's-01', 'alice@family.local', 'u-creator', 'member', 'pending', ?, ?)",
                (token, fut_date)
            )

        res = self.sim.accept_space_invite(
            auth_uid="u-alice",
            jwt_claims={"email": "alice@family.local", "name": "Alice Cooper"},
            p_token=token
        )
        self.assertTrue(res["success"])
        self.assertEqual(res["space_id"], "s-01")
        self.assertEqual(res["role"], "member")

        # Verify DB state: invite is accepted
        cur = self.sim.conn.execute("SELECT status FROM invites WHERE id = 'inv-01'")
        self.assertEqual(cur.fetchone()[0], "accepted")

        # Verify DB state: Alice is member
        cur = self.sim.conn.execute("SELECT role, display_name FROM members WHERE space_id = 's-01' AND user_id = 'u-alice'")
        mem = cur.fetchone()
        self.assertIsNotNone(mem)
        self.assertEqual(mem[0], "member")
        self.assertEqual(mem[1], "Alice Cooper")

    def test_case_insensitivity_matrix(self):
        """Test diverse case mixing in invite email vs JWT email."""
        cases = [
            ("Alice@Family.Local", "alice@family.local"),
            ("bob@gmail.com", "BOB@GMAIL.COM"),
            ("Charlie.Brown+tag@Example.COM", "charlie.brown+tag@example.com"),
        ]
        fut_date = (datetime.now(timezone.utc) + timedelta(days=5)).strftime("%Y-%m-%d %H:%M:%S")

        for idx, (inv_email, caller_email) in enumerate(cases):
            tok = f"case_token_{idx}"
            uid = f"user_{idx}"
            with self.sim.conn:
                self.sim.conn.execute("INSERT INTO auth_users (id, email) VALUES (?, ?)", (uid, caller_email))
                self.sim.conn.execute(
                    "INSERT INTO invites (id, space_id, email, invited_by, role, status, token, expires_at) "
                    "VALUES (?, 's-01', ?, 'u-creator', 'member', 'pending', ?, ?)",
                    (f"inv_case_{idx}", inv_email, tok, fut_date)
                )

            res = self.sim.accept_space_invite(
                auth_uid=uid,
                jwt_claims={"email": caller_email},
                p_token=tok
            )
            self.assertTrue(res["success"], f"Failed for inv={inv_email}, caller={caller_email}")

    def test_token_trimming(self):
        """Test that tokens with leading/trailing whitespace are properly trimmed and accepted."""
        tok = "clean_tok_whitespace"
        fut_date = (datetime.now(timezone.utc) + timedelta(days=5)).strftime("%Y-%m-%d %H:%M:%S")
        with self.sim.conn:
            self.sim.conn.execute(
                "INSERT INTO invites (id, space_id, email, invited_by, role, status, token, expires_at) "
                "VALUES ('inv-ws', 's-01', 'alice@family.local', 'u-creator', 'member', 'pending', ?, ?)",
                (tok, fut_date)
            )

        res = self.sim.accept_space_invite(
            auth_uid="u-alice",
            jwt_claims={"email": "alice@family.local"},
            p_token=f"  \t {tok} \n "
        )
        self.assertTrue(res["success"])

    def test_rejection_expired_token(self):
        """Test that an expired invite is strictly rejected."""
        tok = "expired_tok_001"
        past_date = (datetime.now(timezone.utc) - timedelta(hours=2)).strftime("%Y-%m-%d %H:%M:%S")
        with self.sim.conn:
            self.sim.conn.execute(
                "INSERT INTO invites (id, space_id, email, invited_by, role, status, token, expires_at) "
                "VALUES ('inv-exp', 's-01', 'alice@family.local', 'u-creator', 'member', 'pending', ?, ?)",
                (tok, past_date)
            )

        with self.assertRaises(ValueError) as ctx:
            self.sim.accept_space_invite(
                auth_uid="u-alice",
                jwt_claims={"email": "alice@family.local"},
                p_token=tok
            )
        self.assertIn("Invalid, expired, or unauthorized", str(ctx.exception))

    def test_rejection_email_mismatch(self):
        """Test that attacker (Eve) attempting to use Alice's token is rejected."""
        tok = "alice_secret_tok"
        fut_date = (datetime.now(timezone.utc) + timedelta(days=5)).strftime("%Y-%m-%d %H:%M:%S")
        with self.sim.conn:
            self.sim.conn.execute(
                "INSERT INTO invites (id, space_id, email, invited_by, role, status, token, expires_at) "
                "VALUES ('inv-alice', 's-01', 'alice@family.local', 'u-creator', 'member', 'pending', ?, ?)",
                (tok, fut_date)
            )

        # Eve calls with Alice's token
        with self.assertRaises(ValueError) as ctx:
            self.sim.accept_space_invite(
                auth_uid="u-eve",
                jwt_claims={"email": "eve@attacker.local"},
                p_token=tok
            )
        self.assertIn("Invalid, expired, or unauthorized", str(ctx.exception))

        # Alice's invite remains pending and untouched
        cur = self.sim.conn.execute("SELECT status FROM invites WHERE id = 'inv-alice'")
        self.assertEqual(cur.fetchone()[0], "pending")

    def test_rejection_replay_attack(self):
        """Test that claiming an already accepted token raises an error."""
        tok = "replay_tok_001"
        fut_date = (datetime.now(timezone.utc) + timedelta(days=5)).strftime("%Y-%m-%d %H:%M:%S")
        with self.sim.conn:
            self.sim.conn.execute(
                "INSERT INTO invites (id, space_id, email, invited_by, role, status, token, expires_at) "
                "VALUES ('inv-replay', 's-01', 'alice@family.local', 'u-creator', 'member', 'accepted', ?, ?)",
                (tok, fut_date)
            )

        with self.assertRaises(ValueError) as ctx:
            self.sim.accept_space_invite(
                auth_uid="u-alice",
                jwt_claims={"email": "alice@family.local"},
                p_token=tok
            )
        self.assertIn("Invalid, expired, or unauthorized", str(ctx.exception))

    def test_rejection_non_pending_statuses(self):
        """Test that rejected, expired, or arbitrary status tokens are blocked."""
        fut_date = (datetime.now(timezone.utc) + timedelta(days=5)).strftime("%Y-%m-%d %H:%M:%S")
        for status in ["rejected", "expired"]:
            tok = f"tok_status_{status}"
            user_email = f"user_{status}@family.local"
            with self.sim.conn:
                self.sim.conn.execute("INSERT INTO auth_users (id, email) VALUES (?, ?)", (f"u-{status}", user_email))
                self.sim.conn.execute(
                    "INSERT INTO invites (id, space_id, email, invited_by, role, status, token, expires_at) "
                    "VALUES (?, 's-01', ?, 'u-creator', 'member', ?, ?, ?)",
                    (f"inv-{status}", user_email, status, tok, fut_date)
                )

            with self.assertRaises(ValueError) as ctx:
                self.sim.accept_space_invite(
                    auth_uid=f"u-{status}",
                    jwt_claims={"email": user_email},
                    p_token=tok
                )
            self.assertIn("Invalid, expired, or unauthorized", str(ctx.exception))

    def test_space_owner_cannot_be_downgraded(self):
        """Test that if space owner accepts an invite with 'member' or 'admin', role remains 'owner'."""
        fut_date = (datetime.now(timezone.utc) + timedelta(days=5)).strftime("%Y-%m-%d %H:%M:%S")
        with self.sim.conn:
            self.sim.conn.execute(
                "INSERT INTO invites (id, space_id, email, invited_by, role, status, token, expires_at) "
                "VALUES ('inv-owner-test', 's-01', 'creator@family.local', 'u-creator', 'member', 'pending', 'tok-owner-member', ?)",
                (fut_date,)
            )

        res = self.sim.accept_space_invite(
            auth_uid="u-creator",
            jwt_claims={"email": "creator@family.local"},
            p_token="tok-owner-member"
        )
        self.assertTrue(res["success"])
        # Final role in DB must be 'owner'
        self.assertEqual(res["final_member_role"], "owner")

        cur = self.sim.conn.execute("SELECT role FROM members WHERE space_id = 's-01' AND user_id = 'u-creator'")
        self.assertEqual(cur.fetchone()[0], "owner")

    def test_member_role_upgrade_to_admin(self):
        """Test that an existing member can be upgraded to admin via admin invite."""
        fut_date = (datetime.now(timezone.utc) + timedelta(days=5)).strftime("%Y-%m-%d %H:%M:%S")
        with self.sim.conn:
            # Alice is already member
            self.sim.conn.execute(
                "INSERT INTO members (id, space_id, user_id, role, display_name) "
                "VALUES ('m-alice', 's-01', 'u-alice', 'member', 'Alice')"
            )
            self.sim.conn.execute(
                "INSERT INTO invites (id, space_id, email, invited_by, role, status, token, expires_at) "
                "VALUES ('inv-alice-admin', 's-01', 'alice@family.local', 'u-creator', 'admin', 'pending', 'tok-alice-admin', ?)",
                (fut_date,)
            )

        res = self.sim.accept_space_invite(
            auth_uid="u-alice",
            jwt_claims={"email": "alice@family.local"},
            p_token="tok-alice-admin"
        )
        self.assertTrue(res["success"])
        self.assertEqual(res["final_member_role"], "admin")

        cur = self.sim.conn.execute("SELECT role FROM members WHERE space_id = 's-01' AND user_id = 'u-alice'")
        self.assertEqual(cur.fetchone()[0], "admin")

    def test_missing_or_empty_inputs(self):
        """Test unauthenticated callers, missing email, missing token."""
        # 1. Unauthenticated
        with self.assertRaises(ValueError) as ctx:
            self.sim.accept_space_invite(None, {"email": "alice@test.com"}, "some_tok")
        self.assertIn("Authentication required", str(ctx.exception))

        # 2. Missing email in JWT and DB
        with self.assertRaises(ValueError) as ctx:
            self.sim.accept_space_invite("u-noemail", {}, "some_tok")
        self.assertIn("no verified email address", str(ctx.exception))

        # 3. Empty token
        with self.assertRaises(ValueError) as ctx:
            self.sim.accept_space_invite("u-alice", {"email": "alice@test.com"}, "   ")
        self.assertIn("Invitation token is required", str(ctx.exception))

        with self.assertRaises(ValueError) as ctx:
            self.sim.accept_space_invite("u-alice", {"email": "alice@test.com"}, None)
        self.assertIn("Invitation token is required", str(ctx.exception))


class TestConcurrencyAndRaceConditions(unittest.TestCase):
    """Stress test concurrent attempts to accept the same invitation token."""

    def test_concurrent_replay_race_condition(self):
        """Spin up 20 concurrent threads trying to accept the exact same invite."""
        sim = SqliteInviteSimulator()
        token = "shared_concurrent_token"
        fut_date = (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%d %H:%M:%S")

        with sim.conn:
            sim.conn.execute("INSERT INTO auth_users (id, email) VALUES ('u-bob', 'bob@family.local')")
            sim.conn.execute("INSERT INTO spaces (id, name, created_by) VALUES ('s-race', 'Race Space', 'u-bob')")
            sim.conn.execute(
                "INSERT INTO invites (id, space_id, email, invited_by, role, status, token, expires_at) "
                "VALUES ('inv-race', 's-race', 'bob@family.local', 'u-bob', 'admin', 'pending', ?, ?)",
                (token, fut_date)
            )

        results = []
        errors = []

        def worker():
            try:
                res = sim.accept_space_invite(
                    auth_uid="u-bob",
                    jwt_claims={"email": "bob@family.local"},
                    p_token=token
                )
                results.append(res)
            except Exception as e:
                errors.append(str(e))

        threads = [threading.Thread(target=worker) for _ in range(20)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        # Exactly 1 thread must succeed
        self.assertEqual(len(results), 1, f"Expected exactly 1 success, got {len(results)}")
        # 19 threads must fail with invalid/expired/unauthorized invite token
        self.assertEqual(len(errors), 19)
        for err in errors:
            self.assertIn("Invalid, expired, or unauthorized", err)

        # Invite status must be 'accepted'
        cur = sim.conn.execute("SELECT status FROM invites WHERE id = 'inv-race'")
        self.assertEqual(cur.fetchone()[0], "accepted")

        # Members count for bob in this space must be exactly 1
        cur = sim.conn.execute("SELECT count(*) FROM members WHERE space_id = 's-race' AND user_id = 'u-bob'")
        self.assertEqual(cur.fetchone()[0], 1)


class TestEdgeCaseAdversarialMatrix(unittest.TestCase):
    """Deep adversarial matrix testing injection attacks, boundary limits, and lookalike attacks."""

    def setUp(self):
        self.sim = SqliteInviteSimulator()
        with self.sim.conn:
            self.sim.conn.execute("INSERT INTO auth_users (id, email) VALUES ('u-creator', 'creator@family.local')")
            self.sim.conn.execute("INSERT INTO auth_users (id, email) VALUES ('u-target', 'alice@family.local')")
            self.sim.conn.execute("INSERT INTO spaces (id, name, created_by) VALUES ('s-matrix', 'Matrix Space', 'u-creator')")

    def test_sql_injection_resilience(self):
        """Verify SQL injection payloads in token argument are safely handled without data leak or injection."""
        injection_payloads = [
            "' OR '1'='1",
            "'; DROP TABLE invites; --",
            "admin'--",
            "' UNION SELECT * FROM auth_users --",
            "\\'; DROP TABLE members; --",
            "1' or '1' = '1",
            "'; SHUTDOWN; --",
            "\" OR \"\"=\"",
        ]
        fut_date = (datetime.now(timezone.utc) + timedelta(days=5)).strftime("%Y-%m-%d %H:%M:%S")
        with self.sim.conn:
            self.sim.conn.execute(
                "INSERT INTO invites (id, space_id, email, invited_by, role, status, token, expires_at) "
                "VALUES ('inv-inj', 's-matrix', 'alice@family.local', 'u-creator', 'member', 'pending', 'clean_token_safe', ?)",
                (fut_date,)
            )

        for payload in injection_payloads:
            with self.assertRaises(ValueError) as ctx:
                self.sim.accept_space_invite(
                    auth_uid="u-target",
                    jwt_claims={"email": "alice@family.local"},
                    p_token=payload
                )
            self.assertIn("Invalid, expired, or unauthorized", str(ctx.exception))

        # Ensure invites table is intact
        cur = self.sim.conn.execute("SELECT count(*) FROM invites WHERE id = 'inv-inj'")
        self.assertEqual(cur.fetchone()[0], 1)

    def test_expiry_boundary_conditions(self):
        """Verify boundary timestamps around now(): expired by seconds vs valid by seconds."""
        now_utc = datetime.now(timezone.utc)

        # Expired offsets
        expired_deltas = [
            timedelta(seconds=-1),
            timedelta(seconds=-10),
            timedelta(minutes=-5),
            timedelta(hours=-1),
            timedelta(days=-30),
        ]
        for idx, delta in enumerate(expired_deltas):
            tok = f"exp_tok_{idx}"
            uid = f"u_exp_{idx}"
            u_email = f"user_exp_{idx}@test.local"
            ts_str = (now_utc + delta).strftime("%Y-%m-%d %H:%M:%S")
            with self.sim.conn:
                self.sim.conn.execute("INSERT INTO auth_users (id, email) VALUES (?, ?)", (uid, u_email))
                self.sim.conn.execute(
                    "INSERT INTO invites (id, space_id, email, invited_by, role, status, token, expires_at) "
                    "VALUES (?, 's-matrix', ?, 'u-creator', 'member', 'pending', ?, ?)",
                    (f"inv-exp-{idx}", u_email, tok, ts_str)
                )

            with self.assertRaises(ValueError):
                self.sim.accept_space_invite(uid, {"email": u_email}, tok)

        # Valid future offsets
        valid_deltas = [
            timedelta(seconds=30),
            timedelta(minutes=10),
            timedelta(hours=2),
            timedelta(days=7),
        ]
        for idx, delta in enumerate(valid_deltas):
            tok = f"val_tok_{idx}"
            uid = f"u_val_{idx}"
            u_email = f"user_val_{idx}@test.local"
            ts_str = (now_utc + delta).strftime("%Y-%m-%d %H:%M:%S")
            with self.sim.conn:
                self.sim.conn.execute("INSERT INTO auth_users (id, email) VALUES (?, ?)", (uid, u_email))
                self.sim.conn.execute(
                    "INSERT INTO invites (id, space_id, email, invited_by, role, status, token, expires_at) "
                    "VALUES (?, 's-matrix', ?, 'u-creator', 'member', 'pending', ?, ?)",
                    (f"inv-val-{idx}", u_email, tok, ts_str)
                )

            res = self.sim.accept_space_invite(uid, {"email": u_email}, tok)
            self.assertTrue(res["success"])

    def test_display_name_precedence_matrix(self):
        """Verify priority order: name > full_name > email local part."""
        fut_date = (datetime.now(timezone.utc) + timedelta(days=5)).strftime("%Y-%m-%d %H:%M:%S")

        scenarios = [
            ({"name": "Alice A", "full_name": "Alice Full", "email": "alice1@matrix.local"}, "Alice A"),
            ({"name": "", "full_name": "Alice Full", "email": "alice2@matrix.local"}, "Alice Full"),
            ({"name": "   ", "full_name": "Alice Full", "email": "alice3@matrix.local"}, "Alice Full"),
            ({"name": None, "full_name": "Alice Full", "email": "alice4@matrix.local"}, "Alice Full"),
            ({"name": None, "full_name": None, "email": "alice5@matrix.local"}, "alice5"),
            ({"name": "  ", "full_name": "   ", "email": "alice6@matrix.local"}, "alice6"),
        ]

        for idx, (claims, expected_name) in enumerate(scenarios):
            tok = f"name_tok_{idx}"
            uid = f"u_name_{idx}"
            u_email = claims["email"]
            with self.sim.conn:
                self.sim.conn.execute("INSERT INTO auth_users (id, email) VALUES (?, ?)", (uid, u_email))
                self.sim.conn.execute(
                    "INSERT INTO invites (id, space_id, email, invited_by, role, status, token, expires_at) "
                    "VALUES (?, 's-matrix', ?, 'u-creator', 'member', 'pending', ?, ?)",
                    (f"inv-name-{idx}", u_email, tok, fut_date)
                )

            res = self.sim.accept_space_invite(uid, claims, tok)
            self.assertTrue(res["success"])

            cur = self.sim.conn.execute("SELECT display_name FROM members WHERE space_id = 's-matrix' AND user_id = ?", (uid,))
            actual_name = cur.fetchone()[0]
            self.assertEqual(actual_name, expected_name, f"Failed scenario {idx}: expected {expected_name}, got {actual_name}")

    def test_lookalike_attacker_emails(self):
        """Verify lookalike email attacks fail."""
        lookalikes = [
            "alice@family.local.attacker.com",
            "alice@family.local.net",
            "alice@family.loca",
            "alicee@family.local",
            "aalice@family.local",
            "malice@family.local",
            "attacker@family.local",
        ]
        tok = "target_alice_token"
        fut_date = (datetime.now(timezone.utc) + timedelta(days=5)).strftime("%Y-%m-%d %H:%M:%S")
        with self.sim.conn:
            self.sim.conn.execute(
                "INSERT INTO invites (id, space_id, email, invited_by, role, status, token, expires_at) "
                "VALUES ('inv-target-alice', 's-matrix', 'alice@family.local', 'u-creator', 'member', 'pending', ?, ?)",
                (tok, fut_date)
            )

        for idx, evil_email in enumerate(lookalikes):
            evil_uid = f"u-evil-{idx}"
            with self.assertRaises(ValueError):
                self.sim.accept_space_invite(evil_uid, {"email": evil_email}, tok)

        # Legitimate Alice can still claim it
        res = self.sim.accept_space_invite("u-target", {"email": "alice@family.local"}, tok)
        self.assertTrue(res["success"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
