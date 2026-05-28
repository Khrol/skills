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
allowed-tools: Read Write mcp__test-mutation__verify_baseline mcp__test-mutation__enumerate_tests mcp__test-mutation__init_work_dir mcp__test-mutation__apply_mutation mcp__test-mutation__save_patch mcp__test-mutation__run_suite mcp__test-mutation__revert_file mcp__test-mutation__write_outcome mcp__test-mutation__build_report
---

# Test Meaningfulness (Mutation Testing) Skill

> **Setup**: This skill requires the `test-mutation` MCP server. See [scripts/server.py](scripts/server.py) and the setup section at the bottom.

You evaluate how meaningful a test suite is by finding, for each test, a minimal source code change that causes **exactly that one test** to fail while all others stay green.

## PR context (auto-injected)

```!
bash "${CLAUDE_SKILL_DIR}/scripts/detect-pr.sh"
```

---

## Step 1 — Collect context

**If PR_DETECTED** (see PR context block above):
- Extract changed source files and affected test files.
- Infer `run_cmd` from project structure (`pytest.ini` → pytest, `package.json` → jest/vitest, `build.sbt` → sbt, etc.).
- Show a one-line confirmation: PR title, changed files, inferred command. Proceed.

**If NO_PR** — ask the user for:
1. Test files / pattern to evaluate
2. Run-all command (e.g. `pytest tests/ -q`)
3. Source root directory

---

## Step 2 — Baseline + enumerate

```
verify_baseline(run_cmd, framework)   → must return success=true, stop if not
enumerate_tests(run_cmd, framework)   → get the list of test IDs
init_work_dir("mutation-work", [list of test IDs])
```

Show the user the test count. If `enumerate_tests` returns an empty list for a non-pytest project, collect test names by reading the test files directly (look for `def test_`, `it(`, `test(`, `describe(`, etc.) and pass them to `init_work_dir`.

---

## Step 3 — For each test, find a targeted mutation

Work through test-001, test-002, … in order. Up to **5 attempts** per test.

### Per attempt

**a. Understand the test** — Read the test source. Identify: what function does it exercise? what assertion does it make? Maintain a running coverage map of all source files touched (for Step 4).

**b. Generate a mutation** — Reason about a minimal change that would break this test without breaking others. Good mutations:
- Flip a comparison: `>` → `>=`, `==` → `!=`
- Negate a condition: `if x` → `if not x`
- Change a return constant: `return True` → `return False`
- Remove a single side-effect statement
- Change an arithmetic operator: `+` → `-`

**Forbidden**: deleting whole functions, changing signatures, input-specific special-casing (`if x == <test_input>: return wrong`).

**c. Apply, run, revert** — always in this order, never skipping the revert:

```
apply_mutation(file_path, old_str, new_str)
  → if success=false: fix old_str and retry without counting the attempt
save_patch("mutation-work", "NNN")
run_suite("mutation-work", "NNN", run_cmd, framework)
revert_file(file_path)   ← always, even on success
```

**d. Decide outcome from `run_suite` result**:
- `failed_tests == [this_test]` → **success** → `write_outcome(..., "OK", description)`
- `this_test not in failed_tests` → mutation missed → generate a new mutation
- `this_test in failed_tests AND len > 1` → too broad → generate a narrower mutation

### After 5 failed attempts — diagnose

Look at which tests co-failed most consistently across attempts. Pick one sibling. Apply a mutation targeting *only* the sibling. Run suite.

- **Sibling fails, target stays green** → `BASELINE` (healthy: target covers the minimal path)
- **Both fail together always** → `COUPLED` (code smell: tests are entangled)
- **No stable co-failure pattern, or target never fails** → `SUSPECT` (vacuous assertion?)

```
write_outcome("mutation-work", "NNN", outcome, description, siblings="002 005")
```

---

## Step 4 — Identify untested areas

Re-read each source file in the coverage map. Flag:
- Functions/methods with no test calling them
- Branches no test reaches (else arms, early-return guards, exception handlers)
- Input conditions no test exercises (empty, None, negative, etc.)

Write every gap to `untested-areas.md` (not just the top 5).

---

## Step 5 — Build and display the report

```
build_report("mutation-work")
```

Display the returned `report_markdown` inline. Then prepend a summary header to `mutation-report.md`:

```
## Mutation Testing Report — <date>
**Command**: `<run_cmd>`
**Results**: N meaningful (OK) / N BASELINE / N COUPLED / N SUSPECT
**Untested gaps**: N (see untested-areas.md)
```

Show the 5 highest-priority gaps inline (uncalled functions > untested error branches > unreached conditions).

---

## Rules

- **Always revert** after every attempt, whether success or failure. Never leave source mutated.
- **Never mutate test files** — only production/source code.
- Show progress: announce each test and attempt number as you go.
- If the suite takes > 60 s per run, warn the user before starting.

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
