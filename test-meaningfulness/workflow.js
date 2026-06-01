export const meta = {
  name: 'test-meaningfulness',
  description: 'Mutation testing to evaluate test quality — find a minimal source change that breaks each test in isolation',
  phases: [
    { title: 'Setup', detail: 'verify baseline, enumerate tests, initialize work dir' },
    { title: 'Mutate', detail: 'find minimal mutation per test (sequential — mutations share source files)' },
    { title: 'Report', detail: 'build and display markdown report' },
  ],
}

const CONTEXT_SCHEMA = {
  type: 'object',
  properties: {
    run_cmd: { type: 'string' },
    work_dir: { type: 'string' },
    framework: { type: 'string' },
    source_root: { type: 'string' },
  },
  required: ['run_cmd', 'work_dir', 'framework', 'source_root'],
}

const SETUP_SCHEMA = {
  type: 'object',
  properties: {
    tests: { type: 'array', items: { type: 'string' } },
    framework: { type: 'string' },
    count: { type: 'number' },
  },
  required: ['tests', 'framework', 'count'],
}

const MUTATION_SCHEMA = {
  type: 'object',
  properties: {
    test_name: { type: 'string' },
    test_id: { type: 'string' },
    outcome: { type: 'string', enum: ['OK', 'BASELINE', 'COUPLED', 'SUSPECT'] },
    mutation_desc: { type: 'string' },
  },
  required: ['test_name', 'test_id', 'outcome', 'mutation_desc'],
}

// args may contain: { pr_detected, pr_summary, changed_files, run_cmd, source_root }
// passed from SKILL.md after PR detection

phase('Setup')

const ctx = await agent(
  `You are the context-collection step of a mutation testing workflow.

PR context passed in (may be null/partial): ${JSON.stringify(args)}

Your job:
1. If args already contains run_cmd (inferred from PR context), use it directly.
2. Otherwise ask the user for:
   a. Test files/pattern to evaluate
   b. Run-all command (e.g. "pytest tests/ -q", "npm test", "sbt test")
   c. Source root directory (default: ".")
3. Set work_dir to "mutation-work" unless overridden.
4. Detect framework from run_cmd if not already known (pytest.ini → pytest, package.json scripts → jest/vitest, build.sbt → sbt, etc.).

Return the collected context.`,
  { schema: CONTEXT_SCHEMA, label: 'collect-context', phase: 'Setup' }
)

const setup = await agent(
  `You are the baseline-verification step of a mutation testing workflow.

Context:
- run_cmd: ${ctx.run_cmd}
- work_dir: ${ctx.work_dir}
- framework: ${ctx.framework}

Steps — use mcp__test-mutation__ tools:
1. Call verify_baseline(run_cmd="${ctx.run_cmd}", framework="${ctx.framework}")
   → If success=false, report the failure message and stop with an error.
2. Call enumerate_tests(run_cmd="${ctx.run_cmd}", framework="${ctx.framework}")
   → If the list is empty on a non-pytest project, read test files directly for test names
     (look for def test_, it(, test(, describe( patterns) and use those names.
3. Call init_work_dir(work_dir="${ctx.work_dir}", test_names=[...all test names...])
4. Return the full list of test IDs, detected framework, and count.`,
  { schema: SETUP_SCHEMA, label: 'baseline-and-enumerate', phase: 'Setup' }
)

log(`Found ${setup.count} tests. Running mutation phase sequentially (shared source files)...`)

// Phase 2: Mutate
// Must run serially — each agent applies then reverts a source mutation.
// Two concurrent agents would conflict on the same files.
phase('Mutate')

const results = []
for (let i = 0; i < setup.tests.length; i++) {
  const test = setup.tests[i]
  const testId = `test-${String(i + 1).padStart(3, '0')}`

  const result = await agent(
    `You are finding a targeted mutation for one specific test.

Target test: "${test}"
Test slot: ${testId}
work_dir: ${ctx.work_dir}
run_cmd: ${ctx.run_cmd}
framework: ${ctx.framework}
source_root: ${ctx.source_root}

## Goal
Find a minimal source code change that makes ONLY "${test}" fail while all other tests pass.

## Algorithm — up to 5 attempts

For each attempt:

**a. Understand the test** — Read the test source. Identify: what function does it exercise? what assertion does it make?

**b. Generate a mutation** — a minimal change that breaks this test without affecting others:
   - Flip a comparison: > → >=, == → !=
   - Negate a condition: if x → if not x
   - Change a return constant: return True → return False
   - Remove a single side-effect statement
   - Change an arithmetic operator: + → -
   FORBIDDEN: deleting whole functions, changing signatures, test-input-specific special-casing.

**c. Apply → run → revert** — always in this order, never skip the revert:
   apply_mutation(file_path, old_str, new_str)
     → if success=false: the old_str wasn't found verbatim — fix it and retry WITHOUT counting the attempt
   save_patch("${ctx.work_dir}", "${testId}")
   run_suite("${ctx.work_dir}", "${testId}", "${ctx.run_cmd}", "${ctx.framework}")
   revert_file(file_path)   ← ALWAYS call this, even after a successful outcome

**d. Decide from run_suite result:**
   - failed_tests == ["${test}"] only → SUCCESS → write_outcome(..., "OK", description) and return
   - "${test}" not in failed_tests → mutation missed → new attempt
   - "${test}" in failed_tests AND others also failed → too broad → narrower mutation

## After 5 failed attempts — diagnose

Look at which tests co-failed most consistently across the attempts. Pick the most common sibling. Apply a mutation targeting ONLY that sibling. Run suite.
- Sibling fails, "${test}" stays green → BASELINE
- Both always fail together → COUPLED
- No stable co-failure pattern, or target never fails → SUSPECT

Call: write_outcome("${ctx.work_dir}", "${testId}", outcome, description, siblings="NNN NNN")
Return the final outcome.`,
    { schema: MUTATION_SCHEMA, label: `mutate:${testId}`, phase: 'Mutate' }
  )

  results.push(result)
  log(`${testId} done: ${result ? result.outcome : 'null'} — ${setup.count - i - 1} remaining`)
}

// Phase 3: Report
phase('Report')

const report = await agent(
  `You are the report-building step of a mutation testing workflow.

work_dir: ${ctx.work_dir}
run_cmd: ${ctx.run_cmd}

Steps:
1. Call build_report("${ctx.work_dir}") to assemble the mutation-report.md markdown table.
2. Count outcomes from the returned data and prepend this header to mutation-report.md:
   ## Mutation Testing Report
   **Command**: \`${ctx.run_cmd}\`
   **Results**: N meaningful (OK) / N BASELINE / N COUPLED / N SUSPECT
3. Read each source file that was mutated. Flag untested areas:
   - Functions/methods with no test calling them
   - Branches no test reaches (else arms, early-return guards, exception handlers)
   - Input conditions no test exercises (empty, None, negative, etc.)
   Write ALL gaps to untested-areas.md (not just the top 5).
4. Return the full report_markdown string and a brief summary of the top 5 gaps.`,
  { label: 'build-report', phase: 'Report' }
)

return report
