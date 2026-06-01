---
name: test-meaningfulness
description: >
  Evaluates the meaningfulness of unit tests through targeted mutation testing.
  For each test in a given suite, finds a minimal code change (mutation) that causes
  exactly that test to fail while all other tests pass. Reports a table with
  tests, diffs, and execution results. Mark tests where no targeted mutation can be
  found as 'suspect'. Use when the user asks to evaluate test quality, test
  meaningfulness, or run mutation testing. Also use during PR review or final
  stages of pull request development to verify that new or changed tests are
  actually catching the intended behaviour and are not vacuous.
allowed-tools: Read Workflow
---

# Test Meaningfulness (Mutation Testing) Skill

> **Setup**: This skill requires the `test-mutation` MCP server. See [scripts/server.py](scripts/server.py) and the setup section at the bottom.

## PR context (auto-injected)

```!
echo "SKILL_DIR=${CLAUDE_SKILL_DIR}"
```

```!
bash "${CLAUDE_SKILL_DIR}/scripts/detect-pr.sh"
```

---

## Step 1 — Collect context

**If PR_DETECTED** (see PR context block above):
- Extract changed source files, affected test files, and infer `run_cmd` from project structure (`pytest.ini` → pytest, `package.json` → jest/vitest, `build.sbt` → sbt, etc.).
- Show a one-line confirmation: PR title, changed files, inferred command.

**If NO_PR** — ask the user for: test files/pattern, run-all command, source root.

---

## Step 2 — Run the mutation workflow

Call the Workflow tool with:
- `scriptPath`: `<SKILL_DIR>/workflow.js` (use the SKILL_DIR printed above)
- `args`: an object with the PR context collected above, for example:
  ```json
  {
    "pr_detected": true,
    "pr_summary": "PR #42: add cart discount logic",
    "changed_files": ["src/cart.py", "tests/test_cart.py"],
    "run_cmd": "pytest tests/ -q",
    "source_root": "src"
  }
  ```
  Set `pr_detected: false` and omit PR fields if no PR was found.

The workflow handles baseline verification, per-test mutation finding (sequential, with context isolation per test), untested-area analysis, and report generation. Display the returned report inline when it completes.

---

## Setup: MCP server

The server uses [PEP 723 inline dependencies](https://peps.python.org/pep-0723/) so `uv run` installs `mcp` automatically on first launch — no manual `pip install` needed.

Add to your project's `.mcp.json` (or global `~/.claude/mcp.json`):

```json
{
  "mcpServers": {
    "test-mutation": {
      "command": "uv",
      "args": ["run", "/absolute/path/to/skills/test-meaningfulness/scripts/server.py"]
    }
  }
}
```

`uv` must be on `PATH`. The server's working directory is set to the project root by Claude Code automatically.
