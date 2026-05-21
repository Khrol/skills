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
allowed-tools: Bash(bash *scripts/*) Bash(git restore *) Bash(git diff *) Write
---

# Test Meaningfulness (Mutation Testing) Skill

You evaluate how meaningful a test suite is by attempting targeted mutation testing: for each test, find a minimal source code change that causes **exactly that one test** to fail while all others remain green.

> **References**: [sbt usage instructions](references/sbt-instructions.md)

## PR context (auto-injected)

```!
bash "${CLAUDE_SKILL_DIR}/scripts/detect-pr.sh"
```

---

## Scripts — call these directly, do not read them

All scripts are ready to use. **Never `cat` or `Read` script files — just invoke them.**

| Purpose | Exact command |
|---------|---------------|
| Init work dirs + write names | `bash "${CLAUDE_SKILL_DIR}/scripts/init-work-dir.sh" mutation-work` |
| Capture current edit as patch | `bash "${CLAUDE_SKILL_DIR}/scripts/make-patch.sh" mutation-work/test-NNN/mutation.patch` |
| Run a command + capture log | `bash "${CLAUDE_SKILL_DIR}/scripts/run-cmd.sh" mutation-work/test-NNN/suite.log "<cmd>"` |
| Revert source to last commit | `git restore <mutated-file>` |
| Build report table | `bash "${CLAUDE_SKILL_DIR}/scripts/build-report.sh" mutation-work` |

All scripts must be run **from the project root**. For framework-specific server management (e.g. sbt), see [references/](references/).

---

## Work directory layout

All intermediate and final artifacts go under `mutation-work/` in the project root. Create it at the start; never delete it mid-run.

```
mutation-work/
  test-001/
    name.txt             # full test identifier (one line)
    mutation.patch       # unified diff applied during the successful attempt
    mutation-desc.txt    # one-line markdown for the Mutation column of the report
    suite.log            # stdout+stderr of the run-all command
    outcome.txt          # OK | BASELINE | COUPLED | SUSPECT
    siblings.txt         # (BASELINE/COUPLED only) space-separated peer test numbers
  test-002/
    ...
```

**You write**: `name.txt`, `mutation.patch`, `mutation-desc.txt`, `outcome.txt`, `siblings.txt`.
**Scripts write**: `suite.log` (via redirected test runner output).

`mutation-desc.txt` format:
- OK: `` `- old line`<br>`+ new line` in `File.scala:42` ``
- BASELINE: `shared path with test-003, test-007: siblings can each be broken individually`
- COUPLED: `entangled with test-003: neither can be broken without failing the other`
- SUSPECT: `no targeted mutation found in 5 attempts`

---

## Step 1 — Detect context and collect test suite info

### PR context detection (do this first)

Read the **PR context** block above (injected by the script at skill load time).

**If it starts with `PR_DETECTED`**: you are in a PR context. Extract:
- PR number, title, URL, head branch, base branch.
- The list of changed files under `changed_files:`.

Then:
1. **Identify affected source files**: from the changed file list, collect all non-test source files.
2. **Identify affected test files**: collect any changed test files directly, plus scan for test files that import or reference the changed source files (`grep -rl` the module/class names across the test directories).
3. **Infer the test runner and run-all command** from the project structure:
   - `pytest.ini` / `pyproject.toml` / `setup.cfg` with `[tool:pytest]` → pytest. Run-all: `pytest <test-files> --tb=short -q`.
   - `package.json` with `jest` or `vitest` → Jest/Vitest. Run-all: `npx jest <pattern> --no-coverage`.
   - `build.gradle` / `pom.xml` / `build.sbt` → JUnit/ScalaTest. Infer the run-all command; for sbt see [references/sbt-instructions.md](references/sbt-instructions.md).
   - Fall back to reading any `Makefile`, `README`, or CI config (`.github/workflows/`, `Jenkinsfile`) for the actual test command used in CI.
4. **Show a brief confirmation** — one message: PR number + title, changed source files, affected test files, inferred run commands, estimated test count. Proceed immediately.
5. Skip the rest of Step 1 and go directly to Step 2.

**If it starts with `NO_PR`**: fall through to the manual interview below.

### Manual interview (non-PR context only)

Ask the user (via AskUserQuestion) for the following before doing anything else:

1. **Test subset**: Which test files or test cases to evaluate. Remind the user the suite should be small enough to run dozens of times.
2. **Run-all command**: The command to run the full test subset (e.g. `pytest tests/`, `npx jest`, `./gradlew test`).
3. **Source root**: Where the source code being tested lives.

---

## Step 2 — Start test runner server (if needed)

Some test runners use a persistent background server to avoid JVM/process startup overhead on every run. If the project uses such a runner, start the server now before any test runs. See [references/](references/) for framework-specific instructions.

---

## Step 3 — Baseline: verify the suite is green

Run the full test suite command. If any test is already failing, stop and tell the user — the baseline must be clean.

---

## Step 4 — Enumerate tests

Run the test discovery command to get the list of individual test IDs:
- pytest: `bash "${CLAUDE_SKILL_DIR}/scripts/run-cmd.sh" /dev/null "pytest <subset> --collect-only -q 2>/dev/null"`
- Other frameworks: read the test source files directly to enumerate test names, or use the framework's own list/discover command.

Parse the output into a numbered list. Show the user the list and count.

Use the Write tool to create `mutation-work/test-names.txt` with one test identifier per line (in order, no blank lines). Then initialise all work directories and name files in one call:

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/init-work-dir.sh" mutation-work
```

---

## Step 5 — For each test, find a targeted mutation

Work through each test in order, numbered `001`, `002`, …

### Setup (per test)

Directories and `name.txt` files were already created by `init-work-dir.sh`. No setup needed — proceed directly to 5a.

### 5a. Understand the test

Read the test code. Identify what function/method it exercises and what assertion it makes. As you read each source file, maintain a running **coverage map** for Step 6.

### 5b–5e. Generate and trial the mutation (up to 5 attempts)

**Generate** a mutation. Good mutations:
- Flip a comparison (`>` → `>=`, `==` → `!=`)
- Change a return value constant (`return True` → `return False`)
- Negate a condition (`if x` → `if not x`)
- Remove a single side-effect statement
- Change an arithmetic operator (`+` → `-`)

Bad mutations (forbidden):
- Deleting whole functions or changing signatures.
- **Input-specific special-casing** — do NOT add `if x == <test-input>: return wrong`. A valid mutation changes general logic, not a guard that only triggers on one test's data.

**1. Edit** the source file using the Edit tool to apply the mutation.

**2. Capture the patch** (from the git diff of the edit):
```bash
bash "${CLAUDE_SKILL_DIR}/scripts/make-patch.sh" "mutation-work/test-${N}/mutation.patch"
```

**3. Run suite** — log must go inside `mutation-work/`, never `/tmp/`:
```bash
bash "${CLAUDE_SKILL_DIR}/scripts/run-cmd.sh" "mutation-work/test-NNN/suite.log" "<run-all-cmd>"
```
The script prints the last 30 log lines + `exit_code=N` to stdout — read the result directly, do NOT `cat` the log separately.

From the printed output, determine the outcome:
- Target failed + **only** target failed → **success**. Go to "On success".
- Target did **not** fail → mutation missed. **Revert** and generate a new mutation.
- Target failed + other tests also failed → mutation too broad. **Revert** and generate a narrower mutation.

**Revert** (always after each attempt, whether success or failure) — this is a standalone bash call, never chained with anything else:
```bash
git restore <mutated-file>
```

After reverting, verify the suite is green again:
```bash
bash "${CLAUDE_SKILL_DIR}/scripts/run-cmd.sh" "mutation-work/test-NNN/verify.log" "<run-all-cmd>"
```
Must print `exit_code=0`. If not, stop and investigate before continuing.

### On success

**Separate steps — do NOT chain bash and Write tool in the same operation:**

1. Revert (bash): `git restore <mutated-file>`
2. Write tool → `mutation-work/test-NNN/outcome.txt` — content: `OK`
3. Write tool → `mutation-work/test-NNN/mutation-desc.txt` — one-line markdown, e.g. `` `- x > 0`<br>`+ x >= 0` in `Parser.scala:42` ``

### 5f. After 5 failed attempts — diagnose

Revert any applied changes. Then check directionality:

**Pick one consistently co-failing sibling test. Apply a mutation targeting that sibling. Run the full suite: does the sibling fail while the target stays green?**

**BASELINE** — sibling CAN be broken without breaking the target (one-way dependency). Normal healthy pattern: target covers the minimal path; siblings extend it.

Write these files with the Write tool — three separate Write calls, never combined with bash:
- `mutation-work/test-NNN/outcome.txt` — `BASELINE`
- `mutation-work/test-NNN/siblings.txt` — space-separated peer test numbers, e.g. `002 005`
- `mutation-work/test-NNN/mutation-desc.txt` — e.g. `shared path with test-002, test-005: siblings can each be broken individually`

**COUPLED** — sibling CANNOT be broken without also breaking the target (bidirectional entanglement). Code smell.

Write these files with the Write tool — three separate Write calls, never combined with bash:
- `mutation-work/test-NNN/outcome.txt` — `COUPLED`
- `mutation-work/test-NNN/siblings.txt` — space-separated peer test numbers
- `mutation-work/test-NNN/mutation-desc.txt` — e.g. `entangled with test-002: neither can be broken without failing the other`

**SUSPECT** — target never fails regardless of mutation, or no stable co-failure group.

Write these files with the Write tool — two separate Write calls, never combined with bash:
- `mutation-work/test-NNN/outcome.txt` — `SUSPECT`
- `mutation-work/test-NNN/mutation-desc.txt` — `no targeted mutation found in 5 attempts`

---

## Step 6 — Identify untested areas

After processing all tests, re-read each source file in the coverage map. Walk through every function, method, branch condition, and meaningful code path and check whether it was exercised.

Flag as untested:
- **Functions/methods** with no test calling them at all.
- **Branches** no test reaches (else arm, early-return guard, exception handler).
- **Input conditions** no test provides (empty input, `None`, negative numbers).

Do not flag: private helpers verified indirectly, or structurally dead code (note dead code separately).

---

## Step 7 — Build the report

### Mutation table (inline + file)

Run the report builder and save to file:

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/build-report.sh" mutation-work | tee mutation-report.md
```

Display the table inline in the conversation.

### Untested areas summary (inline)

After the table, show the **5 highest-priority gaps** inline — not the first 5 found, but the most impactful ones. Priority order: uncalled functions > untested error/edge branches > unreached conditions.

```
## Untested Areas (highest priority, up to 5)

| # | Location | What is not tested |
|---|----------|--------------------|
| 1 | `Auth.scala:58` `verifyToken()` | Never called by any test |
| 2 | `Parser.scala:23` `else` branch | No test passes an empty string |
```

If no gaps, write: "All functions and branches in the evaluated source files are exercised by at least one test."

### Full untested areas (file)

Write every gap to `untested-areas.md` (not just the top 5).

### Summary header in mutation-report.md

Prepend to `mutation-report.md`:
- Date, test command
- Counts: meaningful (OK) / BASELINE / COUPLED / SUSPECT
- Total untested gap count (link to `untested-areas.md`)

---

## Step 8 — Stop test runner server (if started in Step 2)

If a persistent server was started in Step 2, stop it now. See [references/](references/) for framework-specific instructions.

---

## Rules and constraints

- **Always revert mutations** before moving to the next test. Never leave source in a mutated state.
- **Restore immediately on any error** (test runner crash, unexpected output).
- **Do not modify test files** — only mutate source/production code.
- **Do not mutate the same line for different tests** if those tests share that code path.
- If the test suite takes more than 60 seconds per run, warn the user before starting.
- Show progress as you go: announce which test and which attempt number you are on.
