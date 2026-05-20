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
allowed-tools: Bash(bash *) Bash(gh *)
---

# Test Meaningfulness (Mutation Testing) Skill

You evaluate how meaningful a test suite is by attempting targeted mutation testing: for each test, find a minimal source code change that causes **exactly that one test** to fail while all others remain green.

> **References**: [sbt usage instructions](references/sbt-instructions.md)

## PR context (auto-injected)

```!
bash "${CLAUDE_SKILL_DIR}/scripts/detect-pr.sh"
```

## Step 1 — Detect context and collect test suite info

### PR context detection (do this first)

Read the **PR context** block above (injected by the script at skill load time).

**If it starts with `PR_DETECTED`**: you are in a PR context. Extract:
- PR number, title, URL, head branch, base branch.
- The list of changed files under `changed_files:`.

Then:
1. **Identify affected source files**: from the changed file list, collect all non-test source files.
2. **Identify affected test files**: collect any changed test files directly, plus scan for test files that import or reference the changed source files (`grep -rl` the module/class names across the test directories).
3. **Infer the test runner and commands** from the project structure:
   - `pytest.ini` / `pyproject.toml` / `setup.cfg` with `[tool:pytest]` → pytest. Run-all: `pytest <test-files> --tb=no -q`. Run-one: `pytest <file>::<TestClass>::<test_method> --tb=short -q`.
   - `package.json` with `jest` or `vitest` → Jest/Vitest. Run-all: `npx jest <pattern> --no-coverage`. Run-one: `npx jest --testNamePattern="<name>" <file>`.
   - `build.gradle` / `pom.xml` → JUnit. Infer the right `./gradlew test` or `mvn test -Dtest=<Class>#<method>` pattern.
   - Fall back to reading any `Makefile`, `README`, or CI config (`.github/workflows/`, `Jenkinsfile`) for the actual test command used in CI.
4. **Show a brief confirmation** — one message: PR number + title, changed source files, affected test files, inferred run commands, estimated test count. Proceed immediately.
5. Skip the rest of Step 1 and go directly to Step 2.

**If it starts with `NO_PR`**: fall through to the manual interview below.

### Manual interview (non-PR context only)

Ask the user (via AskUserQuestion) for the following before doing anything else:

1. **Test subset**: Which test files or test cases to evaluate (e.g. `tests/test_auth.py`, or a glob). Remind the user the suite should be small enough to run dozens of times within a reasonable time frame.
2. **Run-all command**: The command to run the full test subset (e.g. `pytest tests/test_auth.py -x --tb=no -q`).
3. **Run-one command template**: The command to run a single test by name (e.g. `pytest tests/test_auth.py::TestLogin::test_success -x --tb=short -q`). Note the pattern so you can substitute test names later.
4. **Source root**: Where the source code being tested lives (e.g. `src/`, `lib/`, `.`). This is needed to locate files to mutate.

If the user supplies some of this info upfront in their message, infer what you can and only ask for what's missing.

## Step 2 — Baseline: verify the suite is green

Run the full test suite command. If any test is already failing, stop and tell the user — the baseline must be clean before mutation testing makes sense.

## Step 3 — Enumerate tests

Run the test discovery command to get the list of individual test IDs. For pytest: `pytest <subset> --collect-only -q 2>/dev/null`. For Jest: `jest --listTests`. Parse the output into a list of individual test identifiers. Show the user the list and count before proceeding.

## Step 4 — For each test, find a targeted mutation

Work through each test one at a time. For each test:

### 4a. Understand the test

Read the test code. Identify:
- What function/method/behavior it exercises.
- What assertion it makes.
- Which source file(s) it imports from.

As you read each source file, maintain a running **coverage map**: for each source file, record which functions, methods, branches, and meaningful code paths are exercised by at least one test. You will use this at the end to identify gaps.

### 4b. Generate a mutation (AI-driven, up to 5 attempts)

Read the relevant source file. Reason about what minimal change would break the specific assertion this test makes **without touching any logic that other tests depend on exclusively**. Good mutations:
- Flip a comparison (`>` → `>=`, `==` → `!=`)
- Change a return value constant (`return True` → `return False`, `return 0` → `return 1`)
- Negate a condition (`if x` → `if not x`)
- Remove a single side-effect statement (e.g. remove an append or assignment)
- Change an arithmetic operator (`+` → `-`)

Bad mutations:
- Deleting whole functions, changing function signatures, modifying shared state used by many tests.
- **Input-specific special-casing** — do NOT add conditionals that check for the exact input values used in the target test (e.g., `if x == "foo": return wrong_result`). This is cheating: it manufactures a failure for one test by hardcoding its data rather than finding a real structural flaw. A valid mutation must change the general logic of the function, not add a guard that only triggers on one test's specific inputs.

### 4c. Apply the mutation

Use the Edit tool to apply the change to the source file. Keep track of what you changed so you can revert it precisely.

### 4d. Run the target test

Run the single-test command for this test. If it **does not fail**: this mutation doesn't target this test. Revert immediately and generate a new mutation (go to 4b). Count this as attempt N.

### 4e. Run the full suite

If the target test failed: run the full suite command. Check the output:
- If **only the target test fails**: success. Record the diff and the result summary. Revert the mutation and move to the next test.
- If **other tests also fail**: this mutation is too broad. Revert immediately and generate a narrower mutation (go to 4b). Count this as attempt N.

### 4f. After 5 failed attempts

If no targeted mutation was found in 5 attempts, revert any applied changes, then **diagnose why** before assigning a label.

#### Diagnose: BASELINE vs SUSPECT

**Check the directionality of co-failures.** When every mutation that breaks the target test also breaks a consistent set of sibling tests, verify whether the relationship is one-way:

- Pick one of the consistently co-failing sibling tests.
- Apply a mutation specifically targeting that sibling (not the target test).
- Run the full suite: does the sibling fail while the **target test stays green**?

**BASELINE** — assign this label when the sibling CAN be broken without breaking the target test (one-way dependency). This is the normal and healthy **minimal-path + edge-cases pattern**:
- The target test covers the minimal/happy-path behavior.
- The sibling tests extend that path with additional inputs or complexity.
- Any mutation to the shared code path breaks the target AND the siblings, because the siblings depend on the minimal path too.
- But the siblings can be broken individually (e.g., by targeting the extra logic unique to each).
- This is not a problem — it's intentional design. The target test documents the baseline contract.
- Record which sibling tests share the path (e.g., "BASELINE — shared path with tests 2, 3, 4").

**COUPLED** — assign this label when there IS a stable group of co-failing tests but the one-way check fails (the sibling cannot be broken without also breaking the target test). This means the tests are bidirectionally entangled over the same code path — no test in the group can be isolated:
- Every mutation that breaks the target also breaks the siblings.
- Attempting to break a sibling also breaks the target.
- Unlike BASELINE, there is no clean hierarchy: no test in the group is "more minimal" than the others.
- This is a code smell — tests that cannot be decoupled indicate the code itself lacks separation of concerns, or the tests are redundant.
- Record the full group (e.g., "COUPLED — entangled with tests 8, 9: neither can be broken in isolation").

**SUSPECT** — assign this label when:
- The target test **never fails** regardless of mutation (assertion is vacuous, or the test doesn't call the mutated code).
- Collateral failures are inconsistent across attempts — no stable sibling group.
- The test only checks that no exception is raised with no value assertion.

**Always revert mutations before moving to the next test.** Verify revert by re-running the target test and confirming it passes.

## Step 5 — Identify untested areas

After processing all tests, re-read each source file that appeared in the coverage map. Walk through every function, method, branch condition, and meaningful code path and check whether it was exercised by at least one test in the suite.

Flag as untested:
- **Functions/methods** with no test calling them at all.
- **Branches** within tested functions that no test reaches (e.g., the `else` arm of a condition, an early-return guard, an exception handler, a loop that runs zero times).
- **Code paths** that are only reachable with specific input conditions no test provides (e.g., empty input, `None`, negative numbers, maximum values).

Do not flag:
- Private helpers that are only called by already-tested functions and whose behavior is verified indirectly through those tests.
- Dead code that is structurally unreachable (note it separately if you spot it).

## Step 6 — Build the report

After processing all tests, produce:

1. **Inline markdown table** in the conversation:

```
| Test | Mutation (diff) | Result |
|------|----------------|--------|
| `test_foo` | `- return True`<br>`+ return False` in `auth.py:42` | Only `test_foo` failed ✓ |
| `test_bar` | `- if x > 0`<br>`+ if x >= 0` in `parser.py:17` | Only `test_bar` failed ✓ |
| `test_minimal` | BASELINE — shared path with `test_edge1`, `test_edge2`: any mutation to the shared chain fails all three; each sibling can be broken independently | — |
| `test_eight` | COUPLED — entangled with `test_nine`: neither can be broken without failing the other; no separation of concerns | — |
| `test_baz` | SUSPECT — no targeted mutation found in 5 attempts | — |
```

2. **Untested areas section** — after the table, add a second section:

```
## Untested Areas

| Location | What is not tested |
|----------|--------------------|
| `auth.py:58` `verify_token()` | Function is never called by any test |
| `parser.py:23` `else` branch | No test passes an empty string, so this branch is never reached |
| `utils.py:10` `camel_to_snake()` — `None` input path | Guard at line 12 never exercised |
```

If no gaps are found, write: "All functions and branches in the evaluated source files are exercised by at least one test."

3. **File output**: Write both the mutation table and the untested areas section (plus a summary header with date, test command, and counts of meaningful/baseline/coupled/suspect tests and untested area count) to `mutation-report.md` in the current working directory.

## Rules and constraints

- **Always revert mutations** before moving to the next test. Never leave the source in a mutated state.
- **Restore immediately on any error** (test runner crash, unexpected output). Use the Edit tool with the original string to revert.
- **Do not modify test files** — only mutate source/production code.
- **Do not mutate the same line for different tests** if those tests share that code path — instead find a mutation specific to each test's unique path.
- If the test suite takes more than 60 seconds per run, warn the user before starting — the full process may be very slow.
- After every revert, run the single-test command one more time to confirm the test is green again before moving on.
- Show progress as you go: announce which test you're working on and which attempt number you're on.
