# Session Handoff — 2026-05-20

## What this repo is

Personal Claude Code skills library. Skills live at `~/.claude/skills/` (symlinked or copied from here) and are available across all Claude Code sessions. Each skill is a directory with a `SKILL.md` entry point. The repo is at `github.com:Khrol/skills.git`.

## What was built this session

### `test-meaningfulness` skill

A mutation testing skill that evaluates how meaningful each unit test is by finding a minimal source code change that causes exactly one test to fail.

**Invocation**: `/test-meaningfulness` in any Claude Code session.

**Core loop** (per test):
1. Generate a targeted AI mutation in the source code (not in test files).
2. Apply it, run the target test — it must fail.
3. Run the full suite — only the target test must fail.
4. Revert. Retry up to 5 times.

**Test classification after 5 failed attempts**:

| Label | Meaning |
|-------|---------|
| ✓ pass | Mutation found — test is meaningful |
| **BASELINE** | One-way dependency: breaking this test also breaks siblings, but each sibling can be broken individually. The healthy minimal-path + edge-cases pattern. |
| **COUPLED** | Bidirectional entanglement: neither the target nor its siblings can be isolated. Code smell — redundant tests or missing separation of concerns. |
| **SUSPECT** | Target never fails regardless of mutation, or no stable co-failure group. Likely no real assertion. |

**Anti-cheat rule**: mutations must change general logic (flip comparison, negate condition, change return value). Adding input-specific special-cases (`if x == "test_input": return wrong`) is forbidden.

**PR context**: when invoked on a branch with an open GitHub PR, the skill auto-detects it via `scripts/detect-pr.sh` (uses `gh pr view` + `gh pr diff`). The script output is injected into the skill prompt at load time via the `!` dynamic context syntax. No interview questions — just a one-line confirmation and proceed. Falls back to manual interview if `gh` is unavailable or no open PR exists.

**Untested areas**: after processing all tests, the skill does a coverage gap analysis over all source files it read. Reports untested functions, unreached branches, and input conditions no test covers — in a second table section of the report.

**Output**: inline markdown table + `mutation-report.md` in the working directory.

## File layout

```
test-meaningfulness/
├── SKILL.md                  # Main skill instructions
└── scripts/
    └── detect-pr.sh          # gh CLI PR detection script (injected at load)
```

## Deployment

The skill lives in two places that must be kept in sync manually:

| Location | Purpose |
|----------|---------|
| `~/.claude/skills/test-meaningfulness/` | Active — picked up by Claude Code |
| `/Users/khroliz/repos/Khrol/skills/test-meaningfulness/` | Version-controlled source of truth |

To sync from repo to active: `cp -r test-meaningfulness ~/.claude/skills/`

## What could come next

- Run the skill against a real test suite (e.g. `com.automattic.proteus.StringUtilsSpec` in nosara/proteus was the motivating example — `StringUtils` has the exact BASELINE and COUPLED patterns that prompted the label design).
- Add a skill-level config for max attempts (currently hardcoded at 5).
- Consider a `context: fork` + `agent: general-purpose` variant that runs the whole analysis in a subagent to protect the main conversation context window.
- The `detect-pr.sh` script currently uses `python3` inline for JSON parsing — could use `jq` if available for fewer dependencies.
