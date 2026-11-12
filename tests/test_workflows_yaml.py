"""
Unit tests validating GitHub Actions workflow YAML definitions.

Verifies:
1. Syntax validity via PyYAML.
2. Workflow structure: names, triggers, concurrency, permissions, jobs.
3. convert-document.yml: repository_dispatch, workflow_dispatch, 6-hour cron sweeper,
   no pip cache, Indian regional font packages, default bucket 'family-files'.
4. supabase-keepalive.yml: 3-day cron, string-safe curl status checks, read permissions.
5. supabase-backup.yml: Sunday 02:00 cron, write permissions, 90-day retention, [skip ci].
"""

import unittest
from pathlib import Path
import yaml


class TestWorkflowsYaml(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.repo_root = Path(__file__).resolve().parent.parent
        cls.workflows_dir = cls.repo_root / ".github" / "workflows"
        cls.convert_yml_path = cls.workflows_dir / "convert-document.yml"
        cls.keepalive_yml_path = cls.workflows_dir / "supabase-keepalive.yml"
        cls.backup_yml_path = cls.workflows_dir / "supabase-backup.yml"

    def test_workflow_files_exist(self):
        """All three required workflow files must exist."""
        self.assertTrue(self.convert_yml_path.is_file(), f"Missing {self.convert_yml_path}")
        self.assertTrue(self.keepalive_yml_path.is_file(), f"Missing {self.keepalive_yml_path}")
        self.assertTrue(self.backup_yml_path.is_file(), f"Missing {self.backup_yml_path}")

    def test_convert_document_yaml_valid_syntax_and_structure(self):
        """convert-document.yml is valid YAML and has expected top-level keys."""
        with open(self.convert_yml_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)

        self.assertIsInstance(data, dict)
        self.assertIn("name", data)
        self.assertTrue("on" in data or True in data)
        self.assertIn("jobs", data)

        triggers = data.get("on") if "on" in data else data.get(True)
        # 1. repository_dispatch
        self.assertIn("repository_dispatch", triggers)
        self.assertIn("types", triggers["repository_dispatch"])
        self.assertIn("convert-document", triggers["repository_dispatch"]["types"])

        # 2. workflow_dispatch
        self.assertIn("workflow_dispatch", triggers)
        self.assertIn("inputs", triggers["workflow_dispatch"])
        inputs = triggers["workflow_dispatch"]["inputs"]
        self.assertIn("file_id", inputs)
        self.assertIn("all_pending", inputs)

        # 3. 6-hour cron fallback sweeper
        self.assertIn("schedule", triggers)
        crons = [s["cron"] for s in triggers["schedule"] if "cron" in s]
        self.assertIn("0 */6 * * *", crons)

        # Concurrency
        self.assertIn("concurrency", data)
        self.assertEqual(data["concurrency"].get("cancel-in-progress"), False)

        # Permissions
        self.assertIn("permissions", data)
        self.assertEqual(data["permissions"].get("contents"), "read")

        # Job steps
        job = data["jobs"]["convert-and-extract"]
        self.assertEqual(job["runs-on"], "ubuntu-latest")
        steps = job["steps"]

        step_names = [s.get("name", "") for s in steps]
        self.assertTrue(any("Python" in name for name in step_names))
        self.assertTrue(any("Font" in name or "LibreOffice" in name for name in step_names))

        # Check Python step does NOT use pip cache
        python_step = next(s for s in steps if "Python" in s.get("name", ""))
        with_block = python_step.get("with", {})
        self.assertNotIn("cache", with_block, "cache: 'pip' should be removed since no requirements.txt exists")

        # Check apt step installs Indian regional font packages and poppler
        install_step = next(s for s in steps if "Install" in s.get("name", ""))
        run_script = install_step.get("run", "")
        for expected_pkg in [
            "libreoffice-core", "poppler-utils",
            "fonts-smc", "fonts-smc-rachana", "fonts-smc-meera",
            "fonts-deva", "fonts-lohit-deva", "ttf-mscorefonts-installer"
        ]:
            self.assertIn(expected_pkg, run_script, f"Missing required package {expected_pkg}")

        # Check non-interactive debconf selection for MS fonts
        self.assertIn("debconf-set-selections", run_script)

        # Check conversion step environment default bucket
        exec_step = next(s for s in steps if "Execute" in s.get("name", ""))
        env_vars = exec_step.get("env", {})
        self.assertIn("STORAGE_BUCKET", env_vars)
        self.assertIn("family-files", env_vars["STORAGE_BUCKET"])

    def test_supabase_keepalive_yaml_valid_syntax_and_structure(self):
        """supabase-keepalive.yml is valid YAML with 3-day cron, read permissions, and string status check."""
        with open(self.keepalive_yml_path, "r", encoding="utf-8") as f:
            raw_content = f.read()
            data = yaml.safe_load(raw_content)

        self.assertIsInstance(data, dict)
        self.assertIn("name", data)
        self.assertTrue("on" in data or True in data)

        triggers = data.get("on") if "on" in data else data.get(True)
        self.assertIn("schedule", triggers)
        crons = [s["cron"] for s in triggers["schedule"] if "cron" in s]
        self.assertIn("0 4 */3 * *", crons, "Keepalive must run every 3 days at 04:00 UTC")

        self.assertIn("workflow_dispatch", triggers)

        # Permissions: contents: read
        self.assertIn("permissions", data)
        self.assertEqual(data["permissions"].get("contents"), "read")

        # Check curl status checks use string comparison '=' rather than numeric '-eq'
        job = data["jobs"]["ping-supabase"]
        run_script = job["steps"][0].get("run", "")
        self.assertIn('[ "$HTTP_CODE" = "200" ]', run_script)
        self.assertIn('[ "$HTTP_CODE" = "204" ]', run_script)
        self.assertNotIn('[ "$HTTP_CODE" -eq 200 ]', run_script, "Should not use -eq for string-safe check")

        # Check endpoints probed
        self.assertIn("health_check_ping", run_script)
        self.assertIn("spaces?select=id&limit=1", run_script)

    def test_supabase_backup_yaml_valid_syntax_and_structure(self):
        """supabase-backup.yml is valid YAML with Sunday 02:00 cron, write permissions, and 90-day artifact retention."""
        with open(self.backup_yml_path, "r", encoding="utf-8") as f:
            raw_content = f.read()
            data = yaml.safe_load(raw_content)

        self.assertIsInstance(data, dict)
        self.assertIn("name", data)
        self.assertTrue("on" in data or True in data)

        triggers = data.get("on") if "on" in data else data.get(True)
        self.assertIn("schedule", triggers)
        crons = [s["cron"] for s in triggers["schedule"] if "cron" in s]
        self.assertIn("0 2 * * 0", crons, "Backup must run weekly on Sunday at 02:00 UTC")

        self.assertIn("workflow_dispatch", triggers)

        # Permissions: contents: write for git push
        self.assertIn("permissions", data)
        self.assertEqual(data["permissions"].get("contents"), "write")

        job = data["jobs"]["backup-metadata"]
        steps = job["steps"]

        # Run backup step
        run_step = next(s for s in steps if "Run Metadata Export" in s.get("name", ""))
        self.assertIn("backup_metadata.py", run_step.get("run", ""))
        self.assertIn("--max-keep 12", run_step.get("run", ""))

        # Artifact upload step
        upload_step = next(s for s in steps if "Upload Backup" in s.get("name", ""))
        with_block = upload_step.get("with", {})
        self.assertEqual(with_block.get("name"), "supabase-metadata-backup")
        self.assertEqual(with_block.get("retention-days"), 90)

        # Git commit step
        commit_step = next(s for s in steps if "Commit and Push" in s.get("name", ""))
        commit_script = commit_step.get("run", "")
        self.assertIn("[skip ci]", commit_script)
        self.assertIn("git push", commit_script)


if __name__ == "__main__":
    unittest.main()
