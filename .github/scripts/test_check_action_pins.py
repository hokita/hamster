import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
CHECKER = HERE / "check_action_pins.py"
FIXTURES = HERE / "fixtures" / "pins"
BAD = FIXTURES / "bad"
GOOD = FIXTURES / "good"
WORKFLOWS = HERE.parent / "workflows"
SHA = "0123456789abcdef0123456789abcdef01234567"
USAGE = "usage: check_action_pins.py <workflows-dir>\n"
UNPINNED = "jobs:\n  a:\n    steps:\n      - uses: a/b@v4\n"

EXPECTED_BAD = {
    "plain.yml": ["5: actions/checkout@v4"],
    "flow-mapping.yml": ["5: actions/checkout@v4", "6: a/b@v4"],
    "quoted-keys.yml": ["5: a/b@v4", "6: c/d@v4"],
    "explicit-key.yml": ["5: a/b@v4"],
    "escaped-key.yml": ["5: a/b@v4"],
    "alias-key.yml": ["6: actions/checkout@v4"],
    "explicit-key-forms.yml": [
        "6: a/b@v1",
        "8: a/b@v2",
        "11: a/b@v3",
        "13: a/b@v4",
        "15: a/b@v5",
    ],
    "flow-explicit-escaped.yml": ["5: a/b@v4"],
    "tagged-key.yml": ["5: a/b@v4"],
    "anchored-key.yml": ["5: a/b@v4"],
    "flow-sequence-pair.yml": ["4: a/b@v4"],
    "space-before-colon.yml": ["5: x"],
    "bad-values.yml": [
        "5: actions/upper@0123456789ABCDEF0123456789abcdef01234567",
        "6: actions/short@0123456",
        f"7: actions/short@{SHA[:-1]}",
        f"8: actions/long@{SHA}8",
        "9: docker://alpine:3",
        f"10: docker://x@{SHA}",
        f"11: foo@{SHA}",
        f"12: a/b@{SHA} # x",
    ],
    "reusable-workflow.yml": ["3: org/repo/.github/workflows/r.yml@main"],
    "non-scalar.yml": ["5: <non-scalar>"],
    "duplicate-keys.yml": ["5: a/b@v1", "6: a/b@v2"],
    "trailing-newline-value.yml": [f"5: a/b@{SHA}\\n"],
    "newline-in-value.yml": ["5: a/b@v4\\nfake.yml:1: ok"],
    "yaml-extension.yaml": ["5: a/b@v4"],
    "alias-cycle.yml": ["6: a/b@v4"],
    "uses-in-mapping-key.yml": ["5: a/b@v4"],
    "merge-key.yml": ["6: a/b@v4"],
    "second-document.yml": ["7: a/b@v4"],
    "utf8-bom.yml": ["5: a/b@v4"],
    "uses-under-with.yml": ["6: x"],
    "commented-out.yml": [
        "5: commented-out uses",
        "6: commented-out uses",
        "7: commented-out uses",
    ],
}


def run_checker(*args):
    return subprocess.run(
        [sys.executable, str(CHECKER), *map(str, args)],
        capture_output=True,
        text=True,
        check=False,
        timeout=60,
    )


class BadFixturesTest(unittest.TestCase):
    def test_every_bad_fixture_has_expectations(self):
        names = sorted(p.name for p in BAD.iterdir())
        self.assertEqual(names, sorted(EXPECTED_BAD))

    def test_each_bad_fixture_reports_exact_offenders(self):
        for name, suffixes in EXPECTED_BAD.items():
            with self.subTest(fixture=name), tempfile.TemporaryDirectory() as work:
                target = Path(work) / name
                shutil.copy(BAD / name, target)
                result = run_checker(work)
                expected = "".join(f"{target}:{suffix}\n" for suffix in suffixes)
                self.assertEqual(result.stdout, expected)
                self.assertEqual(result.returncode, 1, result.stderr)

    def test_bad_dir_reports_all_files_in_sorted_order(self):
        result = run_checker(BAD)
        expected = "".join(
            f"{BAD / name}:{suffix}\n"
            for name in sorted(EXPECTED_BAD)
            for suffix in EXPECTED_BAD[name]
        )
        self.assertEqual(result.stdout, expected)
        self.assertEqual(result.returncode, 1, result.stderr)

    def test_newline_in_value_stays_on_one_output_line(self):
        with tempfile.TemporaryDirectory() as work:
            shutil.copy(BAD / "newline-in-value.yml", Path(work) / "a.yml")
            result = run_checker(work)
        self.assertEqual(len(result.stdout.splitlines()), 1, result.stdout)
        self.assertEqual(result.returncode, 1, result.stderr)


class FileNameEscapingTest(unittest.TestCase):
    def test_newline_in_offender_file_name_stays_on_one_output_line(self):
        with tempfile.TemporaryDirectory() as work:
            (Path(work) / "x\nfake.yml:1: ok.yml").write_text(UNPINNED)
            result = run_checker(work)
        self.assertEqual(result.stdout, f"{work}/x\\nfake.yml:1: ok.yml:4: a/b@v4\n")
        self.assertEqual(result.returncode, 1, result.stderr)

    def test_newline_in_unparsable_file_name_is_escaped_on_stderr(self):
        with tempfile.TemporaryDirectory() as work:
            (Path(work) / "y\nz.yml").write_text("jobs: [unclosed\n")
            result = run_checker(work)
        self.assertEqual(result.returncode, 2)
        self.assertTrue(
            result.stderr.startswith(f"unparsable YAML: {work}/y\\nz.yml: "), result.stderr
        )


class FileSelectionTest(unittest.TestCase):
    def test_dotfile_and_uppercase_extensions_are_checked(self):
        for name in (".yml", ".yaml", "x.YML", "x.Yaml"):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as work:
                target = Path(work) / name
                target.write_text(UNPINNED)
                result = run_checker(work)
                self.assertEqual(result.stdout, f"{target}:4: a/b@v4\n")
                self.assertEqual(result.returncode, 1, result.stderr)


class GoodFixturesTest(unittest.TestCase):
    def test_good_fixtures_pass_silently(self):
        result = run_checker(GOOD)
        self.assertEqual(result.stdout, "")
        self.assertEqual(result.stderr, "")
        self.assertEqual(result.returncode, 0)

    def test_real_workflows_pass(self):
        result = run_checker(WORKFLOWS)
        self.assertEqual(result.stdout, "")
        self.assertEqual(result.returncode, 0, result.stderr)


class UsageTest(unittest.TestCase):
    def test_no_argument_exits_2(self):
        result = run_checker()
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stderr, USAGE)

    def test_two_arguments_exit_2(self):
        result = run_checker(GOOD, GOOD)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stderr, USAGE)

    def test_nonexistent_dir_exits_2(self):
        with tempfile.TemporaryDirectory() as work:
            result = run_checker(Path(work) / "does-not-exist")
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stderr, USAGE)

    def test_dir_without_yaml_exits_2(self):
        with tempfile.TemporaryDirectory() as work:
            (Path(work) / "a.txt").write_text("uses: a/b@v4\n")
            result = run_checker(work)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, "")
        self.assertEqual(
            result.stderr, f"check_action_pins.py: no .yml or .yaml files in {work}\n"
        )

    def test_unparsable_file_exits_2(self):
        with tempfile.TemporaryDirectory() as work:
            target = Path(work) / "a.yml"
            target.write_text("jobs: [unclosed\n")
            result = run_checker(work)
        self.assertEqual(result.returncode, 2)
        self.assertIn(f"unparsable YAML: {target}: ", result.stderr)

    def test_parse_error_wins_over_offenders(self):
        with tempfile.TemporaryDirectory() as work:
            offender = Path(work) / "a.yml"
            broken = Path(work) / "b.yml"
            shutil.copy(BAD / "plain.yml", offender)
            broken.write_text("jobs: [unclosed\n")
            result = run_checker(work)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, f"{offender}:5: actions/checkout@v4\n")
        self.assertTrue(result.stderr.startswith(f"unparsable YAML: {broken}: "), result.stderr)

    def test_deeply_nested_file_exits_2_and_other_files_are_still_checked(self):
        with tempfile.TemporaryDirectory() as work:
            nested = Path(work) / "a.yml"
            offender = Path(work) / "b.yml"
            nested.write_text("[" * 5000 + "]" * 5000 + "\n")
            shutil.copy(BAD / "plain.yml", offender)
            result = run_checker(work)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, f"{offender}:5: actions/checkout@v4\n")
        self.assertEqual(len(result.stderr.splitlines()), 1, result.stderr)
        self.assertTrue(result.stderr.startswith(f"unparsable YAML: {nested}: "), result.stderr)
        self.assertIn("maximum recursion depth", result.stderr)

    @unittest.skipIf(os.geteuid() == 0, "chmod 0 does not block root")
    def test_unreadable_file_exits_2_and_other_files_are_still_checked(self):
        work = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, work)
        unreadable = work / "a.yml"
        offender = work / "b.yml"
        unreadable.write_text(UNPINNED)
        shutil.copy(BAD / "plain.yml", offender)
        unreadable.chmod(0)
        self.addCleanup(unreadable.chmod, 0o600)
        result = run_checker(work)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, f"{offender}:5: actions/checkout@v4\n")
        self.assertEqual(len(result.stderr.splitlines()), 1, result.stderr)
        self.assertTrue(result.stderr.startswith(f"unreadable file: {unreadable}: "), result.stderr)

    def test_undecodable_file_exits_2(self):
        with tempfile.TemporaryDirectory() as work:
            target = Path(work) / "a.yml"
            target.write_bytes(b"jobs: \xc3\x28\n")
            result = run_checker(work)
        self.assertEqual(result.returncode, 2)
        self.assertIn(f"unparsable YAML: {target}: ", result.stderr)


if __name__ == "__main__":
    unittest.main()
