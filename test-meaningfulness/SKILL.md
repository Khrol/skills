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
allowed-tools: Bash(bash *scripts/*) Bash(git restore *) Bash(git diff *) Write Workflow
---

# Test Meaningfulness (Mutation Testing) Skill

You evaluate how meaningful a test suite is via targeted mutation testing: for each test, find a minimal source code change that causes **exactly that one test** to fail while all others remain green.

The execution order is NOT yours to decide. All mutation work is orchestrated by a fixed, deterministic workflow script bundled with this skill (`scripts/mutation-workflow.js`). Your job is only: (1) gather the inputs it needs, (2) launch it via the Workflow tool, (3) present its results. Do not re-implement the per-test loop yourself when the Workflow tool is available — the script encodes the order, the retry limits, the revert discipline, and the recovery path.

> **References**: [sbt usage instructions](references/sbt-instructions.md)

**Hard requirement**: this skill needs the Workflow tool. If it is not available in this environment, do NOT improvise a manual loop — stop immediately and tell the user: "This skill requires the Workflow tool, which is not available here. Please upgrade Claude Code to a version that supports workflows."

## PR context (auto-injected)

```!
bash "${CLAUDE_SKILL_DIR}/scripts/detect-pr.sh"
```

---

## Step 1 — Detect context and collect inputs

### PR context detection (do this first)

Read the **PR context** block above (injected at skill load time).

**If it starts with `PR_DETECTED`**: you are in a PR context. Extract PR number, title, URL, branches, and the `changed_files:` list. Then:
1. **Affected source files**: all non-test source files from the changed list.
2. **Affected test files**: changed test files, plus test files referencing the changed sources (`grep -rl` the module/class names across test directories).
3. **Infer the run-all command** from project structure:
   - `pytest.ini` / `pyproject.toml` / `setup.cfg` with `[tool:pytest]` → pytest. Run-all: `pytest <test-files> --tb=short -q`.
   - `package.json` with `jest` or `vitest` → `npx jest <pattern> --no-coverage`.
   - `build.gradle` / `pom.xml` / `build.sbt` → JUnit/ScalaTest; for sbt see [references/sbt-instructions.md](references/sbt-instructions.md).
   - Fall back to `Makefile`, `README`, or CI config for the actual CI test command.
4. **Show a brief confirmation** — one message: PR number + title, changed sources, affected tests, inferred command, estimated test count. Proceed immediately.

**If it starts with `NO_PR`**: ask the user (via AskUserQuestion) before doing anything else:
1. **Test subset** — which test files/cases (remind them it must be small enough to run dozens of times).
2. **Run-all command** — e.g. `pytest tests/`, `npx jest`, `./gradlew test`.
3. **Source root** — where the code under test lives.

If a single suite run takes more than 60 seconds, warn the user before starting.

---

## Step 2 — Start test runner server (if needed)

Some runners use a persistent background server to avoid per-run startup overhead (e.g. sbt). If the project uses one, start it now — see [references/](references/). Note the client run command: it becomes `runAllCmd`, and any usage caveats go into the workflow's `notes` arg.

---

## Step 3 — Enumerate tests and initialise the work directory

1. Discover individual test IDs:
   - pytest: `bash "${CLAUDE_SKILL_DIR}/scripts/run-cmd.sh" /dev/null "pytest <subset> --collect-only -q 2>/dev/null"`
   - Other frameworks: read the test sources or use the framework's list/discover command.
2. Show the user the numbered list and count. This order is final — `test-001` is the first entry, and the workflow processes them in exactly this order.
3. Write `mutation-work/test-names.txt` (Write tool; one identifier per line, no blanks), then:
   ```bash
   bash "${CLAUDE_SKILL_DIR}/scripts/init-work-dir.sh" mutation-work
   ```

---

## Step 4 — Launch the workflow

Resolve the two absolute paths you need:

```bash
echo "skillDir=${CLAUDE_SKILL_DIR}" && pwd
```

Then invoke the **Workflow tool** with the bundled script — pass `scriptPath`, never inline a script of your own:

```
Workflow({
  scriptPath: "<skillDir>/scripts/mutation-workflow.js",
  args: {
    skillDir: "<absolute skill dir>",
    projectRoot: "<absolute project root>",
    workDir: "mutation-work",
    runAllCmd: "<run-all command from Step 1>",
    tests: ["<test id 1>", "<test id 2>", ...],   // exact order shown to the user in Step 3
    notes: "<optional framework notes, e.g. sbt client command quirks>",
    failGrep: "<optional grep -E pattern for failure lines in the suite log; default '^FAILED' fits pytest>",
    failField: "<optional awk field of the test id on those lines; default 2>"
  }
})
```

The script deterministically runs: **Baseline** (suite must be green, else it aborts) → **Mutate** (one sub-agent per test, strictly sequential, ≤5 attempts each, forced revert + green re-verification after every test, automatic recovery agent if a test agent leaves the tree dirty) → **Coverage** (untested functions/branches → `untested-areas.md`) → **Report** (`build-report.sh` → `mutation-report.md`).

The workflow runs in the background; wait for its completion notification. Do not edit project files or run the suite yourself while it runs.

---

## Step 5 — Present the results

The workflow returns `{aborted, counts, outcomes, gaps, reportMarkdown}`.

- **If `aborted` is set**: tell the user what happened (`baseline-not-green` → the suite must be fixed first; `working-tree-not-restored-after-test-NNN` → manual `git status`/`git restore` needed) and show `detail` plus any partial `outcomes`. Stop.
- **Otherwise**:
  1. Display `reportMarkdown` (the mutation table) inline.
  2. Below it, show the **5 highest-priority gaps** from `gaps` (priority 1 = uncalled functions, then untested error/edge branches, then unreached input conditions):

     ```
     ## Untested Areas (highest priority, up to 5)

     | # | Location | What is not tested |
     |---|----------|--------------------|
     | 1 | `Auth.scala:58` `verifyToken()` | Never called by any test |
     ```

     If `gaps` is empty: "All functions and branches in the evaluated source files are exercised by at least one test."
  3. Mention the on-disk artifacts: `mutation-report.md`, `untested-areas.md`, `mutation-work/`.

---

## Step 6 — Stop test runner server (if started in Step 2)

See [references/](references/) for framework-specific shutdown.

---

## Work directory layout (written by the workflow's agents)

```
mutation-work/
  test-names.txt         # you write this in Step 3
  baseline.log
  test-001/
    name.txt             # from init-work-dir.sh
    mutation.patch       # diff applied during the successful attempt
    mutation-desc.txt    # one-line markdown for the report's Mutation column
    suite.log            # run-all output of the decisive attempt
    outcome.txt          # OK | BASELINE | COUPLED | SUSPECT
    siblings.txt         # (BASELINE/COUPLED only) space-separated peer numbers
    role.txt             # (BASELINE groups only) "root" | "sibling of test-NNN"
  ...
mutation-report.md
untested-areas.md
```

