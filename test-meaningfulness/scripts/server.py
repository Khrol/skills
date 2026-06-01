#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.11"
# dependencies = ["mcp>=1.0.0"]
# ///
"""MCP server for test-meaningfulness skill.

Exposes the deterministic parts of mutation testing as tools so Claude only
handles LLM reasoning: mutation generation, failure diagnosis, coverage gaps.

Claude Code starts this automatically via .mcp.json. The server uses cwd as the
project root, which Claude Code sets to the workspace root.

  uv run /path/to/skills/test-meaningfulness/scripts/server.py
"""

import re
import subprocess
from pathlib import Path

from mcp.server.fastmcp import FastMCP

PROJECT_ROOT = Path.cwd()

mcp = FastMCP("test-mutation")


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _parse_failed_tests(output: str, framework: str) -> list[str]:
    """Extract failing test identifiers from test runner output."""
    # pytest: "FAILED tests/foo.py::TestClass::test_method"
    if framework in ("pytest", "auto"):
        matches = re.findall(r"^FAILED\s+([\w/.\-]+::[\w\[\]\-:]+)", output, re.MULTILINE)
        if matches:
            return matches

    # Jest / Vitest: "  ✕ test description (5ms)" or "  ● Suite > test"
    if framework in ("jest", "vitest", "auto"):
        matches = re.findall(
            r"^\s+[✕×✗]\s+(.+?)(?:\s+\(\d+\s*m?s\))?$", output, re.MULTILINE
        )
        if matches:
            return matches
        bullet = re.findall(r"^  ●\s+(.+)$", output, re.MULTILINE)
        if bullet:
            return bullet

    # sbt / ScalaTest: "- test name *** FAILED ***"
    if framework in ("sbt", "scalatest", "auto"):
        matches = re.findall(
            r"^\s*-\s+(.+?)\s+\*{3}\s+FAILED", output, re.MULTILINE
        )
        if matches:
            return matches

    # JUnit (Gradle/Maven): "ClassName > testMethod FAILED"
    if framework in ("junit", "gradle", "maven", "auto"):
        matches = re.findall(r"^.+>\s+(\w+)\s+FAILED", output, re.MULTILINE)
        if matches:
            return matches

    return []


def _run(cmd: str | list, **kwargs) -> subprocess.CompletedProcess:
    """Run a command from the project root, capturing output."""
    return subprocess.run(
        cmd, cwd=PROJECT_ROOT, capture_output=True, text=True, **kwargs
    )


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------

@mcp.tool()
def verify_baseline(run_cmd: str, framework: str = "auto") -> dict:
    """Run the full test suite and confirm it's green. Must succeed before mutation testing starts."""
    result = _run(run_cmd, shell=True)
    output = result.stdout + result.stderr
    failed = _parse_failed_tests(output, framework)
    return {
        "success": result.returncode == 0,
        "exit_code": result.returncode,
        "failed_tests": failed,
        "output_tail": output[-3000:],
    }


@mcp.tool()
def enumerate_tests(run_cmd: str, framework: str = "auto") -> dict:
    """Discover all test IDs using the framework's collect/list command.

    Returns names in the exact format the runner uses in failure output —
    this is critical for accurate matching later.
    """
    if framework in ("pytest", "auto"):
        result = _run(run_cmd + " --collect-only -q 2>/dev/null", shell=True)
        tests = [
            line.strip()
            for line in result.stdout.splitlines()
            if "::" in line and not line.startswith(("=", "-", "no tests", "selected"))
        ]
        if tests:
            return {"tests": tests, "framework_detected": "pytest", "count": len(tests)}

    return {
        "tests": [],
        "framework_detected": framework,
        "count": 0,
        "note": "Auto-enumeration not available for this framework — provide test list manually.",
    }


@mcp.tool()
def init_work_dir(work_dir: str, test_names: list[str]) -> dict:
    """Create the work directory structure: test-001/ … test-NNN/ with name.txt in each."""
    wd = PROJECT_ROOT / work_dir
    wd.mkdir(parents=True, exist_ok=True)

    (wd / "test-names.txt").write_text("\n".join(test_names) + "\n")

    for i, name in enumerate(test_names, start=1):
        test_dir = wd / f"test-{i:03d}"
        test_dir.mkdir(exist_ok=True)
        (test_dir / "name.txt").write_text(name + "\n")

    dirs = sorted(wd.glob("test-*/"))
    return {
        "success": True,
        "count": len(dirs),
        "work_dir": str(wd.relative_to(PROJECT_ROOT)),
    }


@mcp.tool()
def apply_mutation(file_path: str, old_str: str, new_str: str) -> dict:
    """Apply a mutation: replace old_str with new_str (first occurrence) in file_path.

    Returns success=False with an error if old_str is not found verbatim —
    the attempt should be retried with a corrected old_str, not counted as a failure.
    """
    target = PROJECT_ROOT / file_path
    if not target.exists():
        return {"success": False, "error": f"File not found: {file_path}"}

    original = target.read_text()
    if old_str not in original:
        return {
            "success": False,
            "error": (
                f"old_str not found verbatim in {file_path}. "
                "Check exact whitespace, indentation, and line endings."
            ),
        }

    target.write_text(original.replace(old_str, new_str, 1))
    return {"success": True, "file": file_path}


@mcp.tool()
def save_patch(work_dir: str, test_id: str) -> dict:
    """Capture the current git diff as mutation.patch for test-NNN."""
    patch_path = PROJECT_ROOT / work_dir / f"test-{test_id}" / "mutation.patch"
    patch_path.parent.mkdir(parents=True, exist_ok=True)

    result = _run(["git", "diff"])
    if not result.stdout.strip():
        return {"success": False, "error": "No unstaged changes found — apply a mutation first."}

    patch_path.write_text(result.stdout)
    return {
        "success": True,
        "patch_file": str(patch_path.relative_to(PROJECT_ROOT)),
        "patch_preview": result.stdout[:1000],
    }


@mcp.tool()
def run_suite(work_dir: str, test_id: str, run_cmd: str, framework: str = "auto") -> dict:
    """Run the full test suite, capture the log, and parse which tests failed.

    Returns structured {exit_code, failed_tests, output_tail} so Claude can
    decide the outcome without reading log files.
    """
    log_path = PROJECT_ROOT / work_dir / f"test-{test_id}" / "suite.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)

    result = _run(run_cmd, shell=True)
    output = result.stdout + result.stderr
    log_path.write_text(output)

    failed = _parse_failed_tests(output, framework)
    return {
        "exit_code": result.returncode,
        "failed_tests": failed,
        "output_tail": output[-3000:],
        "log_file": str(log_path.relative_to(PROJECT_ROOT)),
    }


@mcp.tool()
def revert_file(file_path: str) -> dict:
    """Restore a source file to its last committed state and verify it is clean."""
    restore = _run(["git", "restore", file_path])
    diff = _run(["git", "diff", "--exit-code", file_path])
    return {
        "success": restore.returncode == 0,
        "is_clean": diff.returncode == 0,
        "error": restore.stderr.strip() if restore.returncode != 0 else None,
    }


@mcp.tool()
def write_outcome(
    work_dir: str,
    test_id: str,
    outcome: str,
    description: str,
    siblings: str = "",
) -> dict:
    """Write outcome.txt, mutation-desc.txt, and (for BASELINE/COUPLED) siblings.txt.

    outcome: OK | BASELINE | COUPLED | SUSPECT
    description: one-line markdown for the report Mutation column
    siblings: space-separated peer test numbers, e.g. "002 005" (BASELINE/COUPLED only)
    """
    test_dir = PROJECT_ROOT / work_dir / f"test-{test_id}"
    test_dir.mkdir(parents=True, exist_ok=True)

    (test_dir / "outcome.txt").write_text(outcome.strip() + "\n")
    (test_dir / "mutation-desc.txt").write_text(description.strip() + "\n")
    if siblings.strip():
        (test_dir / "siblings.txt").write_text(siblings.strip() + "\n")

    return {
        "success": True,
        "test_dir": str(test_dir.relative_to(PROJECT_ROOT)),
        "outcome": outcome,
    }


@mcp.tool()
def build_report(work_dir: str) -> dict:
    """Build the mutation report table and write mutation-report.md."""
    wd = PROJECT_ROOT / work_dir
    report_path = PROJECT_ROOT / "mutation-report.md"

    rows = []
    for test_dir in sorted(wd.glob("test-*/"), key=lambda p: p.name):
        num = re.search(r"\d+", test_dir.name).group()
        name = (test_dir / "name.txt").read_text().strip() if (test_dir / "name.txt").exists() else "unknown"
        outcome = (test_dir / "outcome.txt").read_text().strip() if (test_dir / "outcome.txt").exists() else "?"
        desc = (test_dir / "mutation-desc.txt").read_text().strip() if (test_dir / "mutation-desc.txt").exists() else "—"

        result_col = f"Only `{name}` failed ✓" if outcome == "OK" else f"**{outcome}**"
        rows.append(f"| {num} | `{name}` | {desc} | {result_col} |")

    table = "\n".join([
        "| # | Test | Mutation | Result |",
        "|---|------|----------|--------|",
        *rows,
    ])
    report_path.write_text(table + "\n")

    return {
        "success": True,
        "report_markdown": table,
        "report_file": "mutation-report.md",
    }


# ---------------------------------------------------------------------------

if __name__ == "__main__":
    mcp.run()
