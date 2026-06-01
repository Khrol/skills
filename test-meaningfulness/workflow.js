export const meta = {
  name: 'test-meaningfulness',
  description: 'Mutation testing to evaluate test quality — find a minimal source change that breaks each test in isolation',
  phases: [
    { title: 'Setup', detail: 'verify baseline, enumerate tests, initialize work dir' },
    { title: 'Mutate', detail: 'find minimal mutation per test (sequential — mutations share source files)' },
    { title: 'Report', detail: 'build and display markdown report' },
  ],
}

// ── Schemas ──────────────────────────────────────────────────────────────────

const CONTEXT_SCHEMA = {
  type: 'object',
  properties: {
    run_cmd:     { type: 'string' },
    work_dir:    { type: 'string' },
    framework:   { type: 'string' },
    source_root: { type: 'string' },
  },
  required: ['run_cmd', 'work_dir', 'framework', 'source_root'],
}

const SETUP_SCHEMA = {
  type: 'object',
  properties: {
    tests:     { type: 'array', items: { type: 'string' } },
    framework: { type: 'string' },
    count:     { type: 'number' },
  },
  required: ['tests', 'framework', 'count'],
}

// LLM output: what mutation to try
const CANDIDATE_SCHEMA = {
  type: 'object',
  properties: {
    file_path: { type: 'string', description: 'relative path to the source file to mutate' },
    old_str:   { type: 'string', description: 'exact verbatim substring to replace' },
    new_str:   { type: 'string', description: 'replacement string' },
    reasoning: { type: 'string', description: 'one sentence explaining why this mutation targets the test' },
  },
  required: ['file_path', 'old_str', 'new_str', 'reasoning'],
}

// Deterministic MCP call results
const APPLY_SCHEMA = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    error:   { type: 'string' },
  },
  required: ['success'],
}

const RUN_SCHEMA = {
  type: 'object',
  properties: {
    exit_code:    { type: 'number' },
    failed_tests: { type: 'array', items: { type: 'string' } },
    output_tail:  { type: 'string' },
  },
  required: ['exit_code', 'failed_tests'],
}

const REVERT_SCHEMA = {
  type: 'object',
  properties: {
    success:  { type: 'boolean' },
    is_clean: { type: 'boolean' },
    error:    { type: 'string' },
  },
  required: ['success'],
}

// LLM output: which sibling to probe for diagnosis
const SIBLING_SCHEMA = {
  type: 'object',
  properties: {
    sibling_test: { type: 'string', description: 'the co-failing test to probe' },
    file_path:    { type: 'string' },
    old_str:      { type: 'string' },
    new_str:      { type: 'string' },
    reasoning:    { type: 'string' },
  },
  required: ['sibling_test', 'file_path', 'old_str', 'new_str'],
}

// ── Phase 1: Setup ────────────────────────────────────────────────────────────

phase('Setup')

// args may contain: { pr_detected, pr_summary, changed_files, run_cmd, source_root }
const ctx = await agent(
  `You are the context-collection step of a mutation testing workflow.

PR context passed in (may be null/partial): ${JSON.stringify(args)}

Your job:
1. If args already contains run_cmd, use it directly.
2. Otherwise ask the user for:
   a. Test files/pattern to evaluate
   b. Run-all command (e.g. "pytest tests/ -q", "npm test", "sbt test")
   c. Source root directory (default: ".")
3. Set work_dir to "mutation-work" unless overridden.
4. Detect framework from run_cmd if not already known.

Return the collected context.`,
  { schema: CONTEXT_SCHEMA, label: 'collect-context', phase: 'Setup' }
)

const setup = await agent(
  `You are the baseline-verification step of a mutation testing workflow.

Context: run_cmd="${ctx.run_cmd}", work_dir="${ctx.work_dir}", framework="${ctx.framework}"

Steps — use mcp__test-mutation__ tools:
1. Call verify_baseline(run_cmd="${ctx.run_cmd}", framework="${ctx.framework}")
   → If success=false, stop with an error.
2. Call enumerate_tests(run_cmd="${ctx.run_cmd}", framework="${ctx.framework}")
   → If empty on a non-pytest project, read test files for names (def test_, it(, test(, describe()).
3. Call init_work_dir(work_dir="${ctx.work_dir}", test_names=[...all test names...])
4. Return full test list, detected framework, and count.`,
  { schema: SETUP_SCHEMA, label: 'baseline-and-enumerate', phase: 'Setup' }
)

log(`Found ${setup.count} tests. Running mutation phase...`)

// ── Phase 2: Mutate ───────────────────────────────────────────────────────────
//
// The apply → save → run → revert sequence is split into separate awaited agent
// calls so the workflow guarantees the revert always runs, regardless of what
// the LLM does inside any individual step. Outcome decisions are pure JS.
//
// Tests run serially: mutations modify shared source files, so parallelism would
// cause conflicts.

phase('Mutate')

const results = []

for (let i = 0; i < setup.tests.length; i++) {
  const test    = setup.tests[i]
  const testId  = `test-${String(i + 1).padStart(3, '0')}`
  const wdArg   = `work_dir="${ctx.work_dir}", test_id="${testId}"`
  const runArgs = `${wdArg}, run_cmd="${ctx.run_cmd}", framework="${ctx.framework}"`

  let finalOutcome = null
  let finalDesc    = ''
  let attempts     = 0
  const failureLog = []  // [{failed_tests}, ...] per attempt, for diagnosis

  // ── Attempt loop ──────────────────────────────────────────────────────────
  while (finalOutcome === null && attempts < 5) {

    // STEP 1 — LLM: generate a mutation candidate
    const candidate = await agent(
      `Generate a minimal mutation to break test "${test}" without breaking any other test.
Source root: ${ctx.source_root}. Attempt ${attempts + 1} of 5.

Read the test source. Identify the function it exercises and the assertion it makes.
Propose a mutation: flip a comparison (> → >=), negate a condition, change a return
constant, remove a side-effect statement, or change an arithmetic operator.
FORBIDDEN: delete whole functions, change signatures, test-input-specific special-casing.

Return file_path (relative), old_str (exact verbatim text to replace), new_str, reasoning.`,
      { schema: CANDIDATE_SCHEMA, label: `${testId}:gen-${attempts + 1}`, phase: 'Mutate' }
    )

    // STEP 2 — apply mutation (deterministic MCP call)
    const applied = await agent(
      `Call mcp__test-mutation__apply_mutation with exactly these arguments:
  file_path: "${candidate.file_path}"
  old_str: the exact string from the candidate (copy verbatim — do not paraphrase)
  new_str: the replacement string from the candidate
Return the result object {success, error}.`,
      { schema: APPLY_SCHEMA, label: `${testId}:apply-${attempts + 1}`, phase: 'Mutate' }
    )

    if (!applied || !applied.success) {
      // old_str not found verbatim — don't count as an attempt, loop back for a new candidate
      log(`${testId} attempt ${attempts + 1}: apply failed (old_str mismatch), regenerating...`)
      continue
    }

    // STEP 3 — save patch + run suite
    const runResult = await agent(
      `Call mcp__test-mutation__save_patch(${wdArg}).
Then call mcp__test-mutation__run_suite(${runArgs}).
Return the run_suite result: {exit_code, failed_tests, output_tail}.`,
      { schema: RUN_SCHEMA, label: `${testId}:run-${attempts + 1}`, phase: 'Mutate' }
    )

    // STEP 4 — revert (GUARANTEED: always reached because it is a separate await)
    await agent(
      `Call mcp__test-mutation__revert_file(file_path="${candidate.file_path}").
This must be called unconditionally to restore the source file.`,
      { schema: REVERT_SCHEMA, label: `${testId}:revert-${attempts + 1}`, phase: 'Mutate' }
    )

    attempts++

    // STEP 5 — outcome decision (pure JS, no LLM)
    const failed = runResult ? (runResult.failed_tests || []) : []
    failureLog.push(failed)

    if (failed.length === 1 && failed[0] === test) {
      finalOutcome = 'OK'
      finalDesc    = candidate.reasoning || `\`${candidate.old_str}\` → \`${candidate.new_str}\` in ${candidate.file_path}`
    }
    // else: mutation missed or too broad → loop continues
  }

  // ── Diagnosis (only if all 5 attempts failed) ─────────────────────────────
  if (finalOutcome === null) {

    // Find the most consistently co-failing sibling (pure JS)
    const counts = {}
    for (const failed of failureLog) {
      for (const t of failed) {
        if (t !== test) counts[t] = (counts[t] || 0) + 1
      }
    }
    const topSibling = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0]

    if (topSibling) {
      // LLM: generate a mutation targeting only the sibling
      const sibCandidate = await agent(
        `Generate a minimal mutation targeting ONLY "${topSibling}", NOT "${test}".
Same mutation rules as before. Source root: ${ctx.source_root}.
Return file_path, old_str, new_str, reasoning, and set sibling_test="${topSibling}".`,
        { schema: SIBLING_SCHEMA, label: `${testId}:diag-gen`, phase: 'Mutate' }
      )

      // Deterministic: apply → run → revert for the sibling probe
      const sibApplied = await agent(
        `Call mcp__test-mutation__apply_mutation(file_path="${sibCandidate.file_path}", old_str=..., new_str=...).
Use the exact strings from the sibling candidate.`,
        { schema: APPLY_SCHEMA, label: `${testId}:diag-apply`, phase: 'Mutate' }
      )

      let diagFailed = null
      if (sibApplied && sibApplied.success) {
        const diagRun = await agent(
          `Call mcp__test-mutation__save_patch(${wdArg}).
Then call mcp__test-mutation__run_suite(${runArgs}).
Return {exit_code, failed_tests, output_tail}.`,
          { schema: RUN_SCHEMA, label: `${testId}:diag-run`, phase: 'Mutate' }
        )

        // GUARANTEED revert
        await agent(
          `Call mcp__test-mutation__revert_file(file_path="${sibCandidate.file_path}").`,
          { schema: REVERT_SCHEMA, label: `${testId}:diag-revert`, phase: 'Mutate' }
        )

        diagFailed = diagRun ? (diagRun.failed_tests || []) : []
      }

      // Deterministic diagnosis decision (pure JS)
      if (diagFailed !== null) {
        const sibFails    = diagFailed.includes(topSibling)
        const targetFails = diagFailed.includes(test)
        if (sibFails && !targetFails) {
          finalOutcome = 'BASELINE'
          finalDesc    = `${test} covers the minimal path; ${topSibling} has independent coverage`
        } else if (sibFails && targetFails) {
          finalOutcome = 'COUPLED'
          finalDesc    = `${test} and ${topSibling} are entangled — always fail together`
        } else {
          finalOutcome = 'SUSPECT'
          finalDesc    = `No stable co-failure pattern after probing sibling ${topSibling}`
        }
      } else {
        finalOutcome = 'SUSPECT'
        finalDesc    = `Could not apply sibling mutation for diagnosis`
      }
    } else {
      finalOutcome = 'SUSPECT'
      finalDesc    = `Target test never failed across all ${attempts} mutation attempts`
    }
  }

  // Write outcome (deterministic MCP call)
  await agent(
    `Call mcp__test-mutation__write_outcome(work_dir="${ctx.work_dir}", test_id="${testId}", outcome="${finalOutcome}", description=<the mutation description below>).
Description: ${finalDesc}`,
    { label: `${testId}:write`, phase: 'Mutate' }
  )

  results.push({ test, testId, outcome: finalOutcome })
  log(`${testId} → ${finalOutcome} (${setup.count - i - 1} remaining)`)
}

// ── Phase 3: Report ───────────────────────────────────────────────────────────

phase('Report')

const report = await agent(
  `You are the report-building step of a mutation testing workflow.

work_dir: ${ctx.work_dir}
run_cmd: ${ctx.run_cmd}
outcomes: ${JSON.stringify(results)}

Steps:
1. Call mcp__test-mutation__build_report(work_dir="${ctx.work_dir}") to assemble the markdown table.
2. Count outcomes from the results above and prepend this header to mutation-report.md:
   ## Mutation Testing Report
   **Command**: \`${ctx.run_cmd}\`
   **Results**: N meaningful (OK) / N BASELINE / N COUPLED / N SUSPECT
3. Read each source file that was mutated. Flag untested areas:
   - Functions/methods with no test calling them
   - Branches no test reaches (else arms, early-return guards, exception handlers)
   - Input conditions no test exercises (empty, None, negative, etc.)
   Write ALL gaps to untested-areas.md.
4. Return the full report_markdown and a summary of the top 5 gaps.`,
  { label: 'build-report', phase: 'Report' }
)

return report
