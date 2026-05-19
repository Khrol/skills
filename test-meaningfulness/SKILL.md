---
name: test-meaningfulness
description: >
  Evaluates the meaningfulness of unit tests through targeted mutation testing.
  For each test in a given suite, finds a minimal code change (mutation) that causes
  exactly that test to fail while all other tests pass. Reports a table with
  tests, diffs, and execution results. Mark tests where no targeted mutation can be
  found as 'suspect'. Use when the user asks to evaluate test quality, test
  meaningfulness, or run mutation testing.
---

# Test Meaningfulness (Mutation Testing) Skill

You evaluate how meaningful a test suite is by attempting targeted mutation testing: for each test, find a minimal source code change that causes **exactly that one test** to fail while all others remain green.

## Step 1 — Collect test suite info

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

### 4b. Generate a mutation (AI-driven, up to 5 attempts)

Read the relevant source file. Reason about what minimal change would break the specific assertion this test makes **without touching any logic that other tests depend on exclusively**. Good mutations:
- Flip a comparison (`>` → `>=`, `==` → `!=`)
- Change a return value constant (`return True` → `return False`, `return 0` → `return 1`)
- Negate a condition (`if x` → `if not x`)
- Remove a single side-effect statement (e.g. remove an append or assignment)
- Change an arithmetic operator (`+` → `-`)

Bad mutations: deleting whole functions, changing function signatures, modifying shared state used by many tests.

### 4c. Apply the mutation

Use the Edit tool to apply the change to the source file. Keep track of what you changed so you can revert it precisely.

### 4d. Run the target test

Run the single-test command for this test. If it **does not fail**: this mutation doesn't target this test. Revert immediately and generate a new mutation (go to 4b). Count this as attempt N.

### 4e. Run the full suite

If the target test failed: run the full suite command. Check the output:
- If **only the target test fails**: success. Record the diff and the result summary. Revert the mutation and move to the next test.
- If **other tests also fail**: this mutation is too broad. Revert immediately and generate a narrower mutation (go to 4b). Count this as attempt N.

### 4f. After 5 failed attempts

If no targeted mutation was found in 5 attempts, revert any applied changes, mark this test as **SUSPECT** in the report, and move on. A suspect test may indicate:
- The test is not actually verifying the code (e.g., it only checks that no exception is raised with no real assertion)
- The test is so coupled to other tests that any breaking change breaks the whole suite
- The functionality is so tightly interwoven that isolated mutations aren't possible

**Always revert mutations before moving to the next test.** Verify revert by re-running the target test and confirming it passes.

## Step 5 — Build the report

After processing all tests, produce:

1. **Inline markdown table** in the conversation:

```
| Test | Mutation (diff) | Result |
|------|----------------|--------|
| `test_foo` | `- return True`<br>`+ return False` in `auth.py:42` | Only `test_foo` failed ✓ |
| `test_bar` | `- if x > 0`<br>`+ if x >= 0` in `parser.py:17` | Only `test_bar` failed ✓ |
| `test_baz` | SUSPECT — no targeted mutation found in 5 attempts | — |
```

2. **File output**: Write the same table (plus a summary header with date, test command, and counts of meaningful/suspect tests) to `mutation-report.md` in the current working directory.

## Rules and constraints

- **Always revert mutations** before moving to the next test. Never leave the source in a mutated state.
- **Restore immediately on any error** (test runner crash, unexpected output). Use the Edit tool with the original string to revert.
- **Do not modify test files** — only mutate source/production code.
- **Do not mutate the same line for different tests** if those tests share that code path — instead find a mutation specific to each test's unique path.
- If the test suite takes more than 60 seconds per run, warn the user before starting — the full process may be very slow.
- After every revert, run the single-test command one more time to confirm the test is green again before moving on.
- Show progress as you go: announce which test you're working on and which attempt number you're on.
