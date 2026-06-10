export const meta = {
  name: 'test-meaningfulness',
  description: 'Targeted mutation testing: fixed-order per-test mutation search, coverage gaps, final report',
  phases: [
    { title: 'Baseline', detail: 'verify the suite is green before any mutation' },
    { title: 'Mutate', detail: 'one agent per test, strict sequential order' },
    { title: 'Coverage', detail: 'identify untested functions and branches' },
    { title: 'Report', detail: 'assemble mutation-report.md' },
  ],
}

// ---------------------------------------------------------------------------
// Args contract (passed by SKILL.md):
//   skillDir    absolute path to the skill directory (for scripts/)
//   projectRoot absolute path to the project under evaluation
//   workDir     work directory name relative to projectRoot (default mutation-work)
//   runAllCmd   shell command that runs the full test subset
//   tests       array of test identifiers, in order (test-001 = tests[0])
//   notes       optional framework notes (e.g. sbt client usage) appended to prompts
// ---------------------------------------------------------------------------

// Tolerate a JSON-encoded args string (the Workflow tool expects a real object).
const cfg = typeof args === 'string' ? JSON.parse(args) : args
if (!cfg || !cfg.skillDir || !cfg.projectRoot || !cfg.runAllCmd || !Array.isArray(cfg.tests) || cfg.tests.length === 0) {
  throw new Error(`mutation-workflow requires {skillDir, projectRoot, runAllCmd, tests[]} passed as a JSON OBJECT via args — got ${typeof args}: ${JSON.stringify(args).slice(0, 300)}`)
}

const workDir = cfg.workDir || 'mutation-work'
const pad = (n) => String(n).padStart(3, '0')

const ctx = `
## Execution context
- Project root: ${cfg.projectRoot} — run EVERY shell command from this directory (cd there first; the Bash working directory does not carry over from other agents).
- Skill scripts: ${cfg.skillDir}/scripts — invoke them directly, never cat/Read them.
- Work directory: ${workDir}/ (relative to the project root). All logs and artifacts go there, never /tmp.
- Run-all command: ${cfg.runAllCmd}
${cfg.notes ? '- Framework notes: ' + cfg.notes : ''}
Your final structured output is consumed by an orchestrator script — fill every field accurately; do not write a human-facing summary anywhere else.
`

// --- Schemas ----------------------------------------------------------------

const BASELINE_SCHEMA = {
  type: 'object',
  required: ['green', 'summary'],
  properties: {
    green: { type: 'boolean', description: 'true iff the run-all command exited 0 with no failing tests' },
    summary: { type: 'string', description: 'one line: pass/fail counts, or the failing test names' },
  },
}

const TEST_SCHEMA = {
  type: 'object',
  required: ['outcome', 'mutationDesc', 'siblings', 'attempts', 'suiteGreenAfter', 'sourceFilesRead'],
  properties: {
    outcome: { enum: ['OK', 'BASELINE', 'COUPLED', 'SUSPECT'] },
    mutationDesc: { type: 'string', description: 'exact content written to mutation-desc.txt' },
    siblings: { type: 'array', items: { type: 'string' }, description: 'peer test numbers like "002" (BASELINE/COUPLED only, else empty)' },
    attempts: { type: 'integer', description: 'number of mutation attempts made' },
    suiteGreenAfter: { type: 'boolean', description: 'true iff you reverted everything and re-verified the full suite passes' },
    sourceFilesRead: { type: 'array', items: { type: 'string' }, description: 'project-relative paths of all production source files you read' },
  },
}

const RECOVERY_SCHEMA = {
  type: 'object',
  required: ['green', 'detail'],
  properties: {
    green: { type: 'boolean', description: 'true iff the working tree is restored and the full suite passes' },
    detail: { type: 'string' },
  },
}

const COVERAGE_SCHEMA = {
  type: 'object',
  required: ['gaps'],
  properties: {
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        required: ['location', 'what', 'priority'],
        properties: {
          location: { type: 'string', description: 'e.g. `calc/core.py:31` `safe_div()`' },
          what: { type: 'string', description: 'what is not tested' },
          priority: { type: 'integer', description: '1 = uncalled function, 2 = untested error/edge branch, 3 = unreached input condition' },
        },
      },
    },
  },
}

const REPORT_SCHEMA = {
  type: 'object',
  required: ['reportMarkdown'],
  properties: {
    reportMarkdown: { type: 'string', description: 'full contents of mutation-report.md as written to disk' },
  },
}

// --- Prompt builders ---------------------------------------------------------

const priorSummary = (outcomes) => {
  if (outcomes.length === 0) return '(none yet — this is the first test)'
  return outcomes
    .map((o) => `- test-${o.num} \`${o.name}\`: ${o.outcome}${o.outcome === 'OK' ? ' — ' + o.mutationDesc : ''}${o.siblings && o.siblings.length ? ' (siblings: ' + o.siblings.join(', ') + ')' : ''}`)
    .join('\n')
}

const perTestPrompt = (num, name, outcomes) => `${ctx}
## Your task: find a targeted mutation for test-${num}

Test identifier: \`${name}\`
Your work directory: ${workDir}/test-${num}/ (already exists, name.txt already written).

Find a minimal production-code change that makes EXACTLY this one test fail while every other test stays green.

### Results from tests already processed (use this — do not rediscover it)
${priorSummary(outcomes)}
- If an earlier test was diagnosed COUPLED and lists test-${num} as its sibling, you may confirm with a single attempt (re-apply that test's recorded mutation idea) and mirror the COUPLED outcome instead of burning 5 attempts.
- If an earlier BASELINE root lists test-${num} as a sibling, that does not change your job: siblings are usually individually breakable (expect OK). A role.txt marking your group membership may already exist in your directory — leave it in place.
- Do not reuse a mutation line already consumed by an earlier OK test if both tests share that code path.

### Procedure
1. Read the test code for \`${name}\`. Identify the production function/branch it exercises and the assertion it makes.
2. Up to 5 attempts. Per attempt:
   a. Apply ONE minimal mutation to production source with the Edit tool. Good mutations: flip a comparison (\`>\` → \`>=\`), change a returned constant, negate a condition, remove one side-effect statement, swap an arithmetic operator. Forbidden: deleting whole functions, changing signatures, modifying test files, and input-specific special-casing (\`if x == <test-input>: return wrong\`) — mutations must change general logic.
   b. Capture the patch: \`bash "${cfg.skillDir}/scripts/make-patch.sh" "${workDir}/test-${num}/mutation.patch"\`
   c. Run the suite: \`bash "${cfg.skillDir}/scripts/run-cmd.sh" "${workDir}/test-${num}/suite.log" "<run-all command>"\` — read the printed tail + exit_code directly; do not cat the log.
   d. Classify: only \`${name}\` failed → success. Target did not fail → revert, try a different mutation. Target + others failed → revert, note WHICH others co-failed (you need this for diagnosis), try a narrower mutation.
   e. Revert (standalone command, never chained): \`git restore <mutated-file>\`
3. After every attempt (success or failure) the working tree must be back to pristine. After your final attempt, verify: \`bash "${cfg.skillDir}/scripts/run-cmd.sh" "${workDir}/test-${num}/verify.log" "<run-all command>"\` must print exit_code=0.

### On success (write with the Write tool, separate calls, never chained with bash)
- ${workDir}/test-${num}/outcome.txt → \`OK\`
- ${workDir}/test-${num}/mutation-desc.txt → one-line markdown like \`\` \`- x > 0\`<br>\`+ x >= 0\` in \`Parser.scala:42\` \`\`

### After 5 failed attempts — diagnose before giving up
Identify the consistently co-failing sibling tests from your attempts. Apply ONE mutation targeting a sibling's distinctive behaviour and run the suite: does the sibling fail while \`${name}\` stays green?
- Sibling CAN fail alone → **BASELINE** (one-way dependency; \`${name}\` is the root of the group, covering the shared path the siblings extend). Write:
  - outcome.txt → \`BASELINE\`
  - role.txt → \`root\`
  - siblings.txt → space-separated peer numbers, e.g. \`002 005\`
  - mutation-desc.txt → \`root: shared path extended by test-002, test-005 — siblings can each be broken individually\`
  - for EACH sibling: ${workDir}/test-MMM/role.txt → \`sibling of test-${num}\` (write it even if that sibling is not processed yet)
- Sibling CANNOT fail without \`${name}\` also failing → **COUPLED** (bidirectional entanglement, a code smell). Write outcome.txt → \`COUPLED\`, siblings.txt, and mutation-desc.txt like \`entangled with test-002: neither can be broken without failing the other\`.
- Target never failed under any mutation, or no stable co-failure group → **SUSPECT**. Write outcome.txt → \`SUSPECT\` and mutation-desc.txt → \`no targeted mutation found in 5 attempts\`.
Revert the diagnostic mutation and re-verify green afterwards.

Sibling numbers refer to this fixed numbering: ${outcomes.length ? 'see list above plus the remaining tests in order' : 'tests are numbered 001.. in the given order'}.
Return the structured output exactly per schema. suiteGreenAfter must reflect a real verification run, not an assumption.`

const recoveryPrompt = (num, name) => `${ctx}
## Recovery after test-${num} (\`${name}\`)

The previous agent either crashed or left the suite red. Restore safety:
1. \`git status --short\` in the project root. \`git restore <file>\` every modified production source file (NEVER touch ${workDir}/ artifacts or test files beyond restoring them if mutated).
2. Run the suite: \`bash "${cfg.skillDir}/scripts/run-cmd.sh" "${workDir}/test-${num}/recovery.log" "<run-all command>"\` — must print exit_code=0.
3. If ${workDir}/test-${num}/outcome.txt does NOT exist, write it (Write tool) with \`SUSPECT\` and write mutation-desc.txt with \`processing failed — marked SUSPECT\`. If it exists, leave it alone.
Return green=true only if step 2 printed exit_code=0.`

const coveragePrompt = (files, outcomes) => `${ctx}
## Coverage-gap analysis

The mutation phase touched these production source files:
${files.length ? files.map((f) => '- ' + f).join('\n') : '(none recorded — discover the production sources for the evaluated tests yourself)'}

Per-test outcomes for context:
${priorSummary(outcomes)}

Re-read each production source file. Walk every function, method, branch condition, and meaningful code path and check whether any test in the evaluated suite exercises it. Flag as untested:
- functions/methods no test calls at all (priority 1)
- branches no test reaches — else arms, early-return guards, exception handlers (priority 2)
- input conditions no test provides — empty input, None/null, negatives (priority 3)
Do NOT flag private helpers verified indirectly, or structurally dead code (note dead code separately in the file).

Write EVERY gap to untested-areas.md in the project root (Write tool) as a markdown table: | # | Location | What is not tested |. If there are no gaps, write that all functions and branches are exercised.
Return all gaps in the structured output.`

const reportPrompt = (counts, gapCount) => `${ctx}
## Build the final report

1. Run: \`bash "${cfg.skillDir}/scripts/build-report.sh" ${workDir}\` and capture its stdout (the markdown table).
2. Get today's date with \`date +%Y-%m-%d\`.
3. Write mutation-report.md in the project root (Write tool) with this structure:
   - Header: date, the test command (\`${cfg.runAllCmd}\`), counts — meaningful (OK): ${counts.OK}, BASELINE: ${counts.BASELINE}, COUPLED: ${counts.COUPLED}, SUSPECT: ${counts.SUSPECT}, untested gaps: ${gapCount} (link to untested-areas.md)
   - Then the table exactly as build-report.sh printed it — do not edit rows.
Return the full file contents as reportMarkdown.`

// --- Orchestration ------------------------------------------------------------

phase('Baseline')
const baseline = await agent(
  `${ctx}
Run the full test suite once to verify it is green:
\`bash "${cfg.skillDir}/scripts/run-cmd.sh" "${workDir}/baseline.log" "<run-all command>"\`
Read the printed log tail and exit_code. Do NOT fix or modify anything — just report.`,
  { schema: BASELINE_SCHEMA, label: 'baseline', phase: 'Baseline' }
)
if (!baseline || !baseline.green) {
  return { aborted: 'baseline-not-green', detail: baseline ? baseline.summary : 'baseline agent failed', outcomes: [] }
}
log(`Baseline green: ${baseline.summary}`)

phase('Mutate')
const outcomes = []
for (let i = 0; i < cfg.tests.length; i++) {
  const num = pad(i + 1)
  const name = cfg.tests[i]
  let r = await agent(perTestPrompt(num, name, outcomes), { schema: TEST_SCHEMA, label: `test-${num}`, phase: 'Mutate' })

  if (!r || !r.suiteGreenAfter) {
    log(`test-${num} left the tree unsafe — running recovery`)
    const fix = await agent(recoveryPrompt(num, name), { schema: RECOVERY_SCHEMA, label: `recover-${num}`, phase: 'Mutate' })
    if (!fix || !fix.green) {
      return { aborted: `working-tree-not-restored-after-test-${num}`, detail: fix ? fix.detail : 'recovery agent failed', outcomes }
    }
    if (!r) {
      r = { outcome: 'SUSPECT', mutationDesc: 'processing failed — marked SUSPECT', siblings: [], attempts: 0, suiteGreenAfter: true, sourceFilesRead: [] }
    }
  }
  outcomes.push({ num, name, outcome: r.outcome, mutationDesc: r.mutationDesc, siblings: r.siblings || [], sourceFilesRead: r.sourceFilesRead || [] })
  log(`test-${num} ${name}: ${r.outcome} (${r.attempts} attempts)`)
}

phase('Coverage')
const files = [...new Set(outcomes.flatMap((o) => o.sourceFilesRead))]
const coverage = await agent(coveragePrompt(files, outcomes), { schema: COVERAGE_SCHEMA, label: 'coverage', phase: 'Coverage' })
const gaps = coverage ? coverage.gaps : []

phase('Report')
const counts = { OK: 0, BASELINE: 0, COUPLED: 0, SUSPECT: 0 }
for (const o of outcomes) counts[o.outcome] = (counts[o.outcome] || 0) + 1
const report = await agent(reportPrompt(counts, gaps.length), { schema: REPORT_SCHEMA, label: 'report', phase: 'Report' })

return {
  aborted: null,
  counts,
  outcomes: outcomes.map((o) => ({ num: o.num, name: o.name, outcome: o.outcome })),
  gaps,
  reportMarkdown: report ? report.reportMarkdown : '(report agent failed — read mutation-report.md / run build-report.sh manually)',
}
