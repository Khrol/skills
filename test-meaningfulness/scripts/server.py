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

# server.py lives in scripts/; skill root is one level up
SKILL_DIR = Path(__file__).parent.parent
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


def _run_script(script_name: str, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["bash", str(SKILL_DIR / "scripts" / script_name), *args],
        cwd=PROJECT_ROOT,
        capture_output=True,
        text=True,
    )


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------

@mcp.tool()
def verify_baseline(run_cmd: str, framework: str = "auto") -> dict:
    """Run the full test suite and confirm it's green. Must succeed before mutation testing starts."""
    result = subprocess.run(
        run_cmd, shell=True, cwd=PROJECT_ROOT, capture_output=True, text=True
    )
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
    # pytest --collect-only -q
    if framework in ("pytest", "auto"):
        base = run_cmd.split()[0]  # e.g. "pytest" or "python -m pytest"
        # Preserve any path args but inject --collect-only -q
        collect_cmd = run_cmd + " --collect-only -q 2>/dev/null"
        result = subprocess.run(
            collect_cmd, shell=True, cwd=PROJECT_ROOT, capture_output=True, text=True
        )
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

    names_file = wd / "test-names.txt"
    names_file.write_text("\n".join(test_names) + "\n")

    result = _run_script("init-work-dir.sh", str(wd))
    dirs = sorted(wd.glob("test-*/"))
    return {
        "success": result.returncode == 0,
        "count": len(dirs),
        "work_dir": str(wd.relative_to(PROJECT_ROOT)),
        "output": result.stdout.strip(),
        "error": result.stderr.strip() if result.returncode != 0 else None,
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

    result = _run_script("make-patch.sh", str(patch_path))
    patch_content = patch_path.read_text() if patch_path.exists() and result.returncode == 0 else ""
    return {
        "success": result.returncode == 0,
        "patch_file": str(patch_path.relative_to(PROJECT_ROOT)),
        "patch_preview": patch_content[:1000] if patch_content else "",
        "error": result.stderr.strip() if result.returncode != 0 else None,
    }


@mcp.tool()
def run_suite(work_dir: str, test_id: str, run_cmd: str, framework: str = "auto") -> dict:
    """Run the full test suite, capture the log, and parse which tests failed.

    Returns structured {exit_code, failed_tests, output_tail} so Claude can
    decide the outcome without reading log files.
    """
    log_path = PROJECT_ROOT / work_dir / f"test-{test_id}" / "suite.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)

    result = _run_script("run-cmd.sh", str(log_path), run_cmd)

    log_content = log_path.read_text() if log_path.exists() else ""
    failed = _parse_failed_tests(log_content, framework)

    return {
        "exit_code": result.returncode,
        "failed_tests": failed,
        # run-cmd.sh prints the last 30 log lines to stdout — include that too
        "output_tail": result.stdout[-3000:],
        "log_file": str(log_path.relative_to(PROJECT_ROOT)),
    }


@mcp.tool()
def revert_file(file_path: str) -> dict:
    """Restore a source file to its last committed state and verify it is clean."""
    restore = subprocess.run(
        ["git", "restore", file_path],
        cwd=PROJECT_ROOT, capture_output=True, text=True,
    )
    diff = subprocess.run(
        ["git", "diff", "--exit-code", file_path],
        cwd=PROJECT_ROOT, capture_output=True, text=True,
    )
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
    """Run build-report.sh and write mutation-report.md. Returns the markdown table."""
    wd = PROJECT_ROOT / work_dir
    report_path = PROJECT_ROOT / "mutation-report.md"

    result = subprocess.run(
        f'bash "{SKILL_DIR}/scripts/build-report.sh" "{wd}" | tee "{report_path}"',
        shell=True, cwd=PROJECT_ROOT, capture_output=True, text=True,
    )

    report = report_path.read_text() if report_path.exists() else result.stdout
    return {
        "success": result.returncode == 0,
        "report_markdown": report,
        "report_file": "mutation-report.md",
        "error": result.stderr.strip() if result.returncode != 0 else None,
    }


# ---------------------------------------------------------------------------

if __name__ == "__main__":
    mcp.run()
