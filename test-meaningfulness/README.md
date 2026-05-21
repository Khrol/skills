# test-meaningfulness

Mutation testing skill for Claude Code. Evaluates how meaningful each unit test is by finding a minimal source code change that causes exactly that test to fail while all others stay green.

## Flow

```mermaid
flowchart TD
    A([Start]) --> B[Detect context + infer run-all cmd]
    B --> C[Start server if needed]
    C --> D{Suite green?}
    D -->|no| STOP([Stop — fix baseline first])
    D -->|yes| E[Enumerate tests\ninit-work-dir.sh]

    E --> F

    subgraph F[For each test · up to 5 attempts]
        F1[Edit source] --> F2[make-patch.sh]
        F2 --> F3[run-cmd.sh → suite.log]
        F3 --> F4{Failures?}
        F4 -->|only target| F5[✓ git restore\nwrite OK]
        F4 -->|missed / too broad| F6[git restore]
        F6 -->|retry| F1
        F6 -->|5 attempts| F7[Diagnose\nBASELINE · COUPLED · SUSPECT]
    end

    F --> G[Untested areas analysis]
    G --> H[build-report.sh]
    H --> I[Stop server]
    I --> J([Done])
```

## Work directory

```
mutation-work/
  test-names.txt         ← written by AI with Write tool
  test-001/
    name.txt             ← from test-names.txt via init-work-dir.sh
    mutation.patch       ← from make-patch.sh
    mutation-desc.txt    ← written by AI with Write tool
    suite.log            ← from run-cmd.sh
    outcome.txt          ← OK | BASELINE | COUPLED | SUSPECT
    siblings.txt         ← (BASELINE/COUPLED only)
  test-002/
    ...
mutation-report.md       ← from build-report.sh
untested-areas.md        ← written by AI with Write tool
```

## Scripts

| Script | Purpose |
|--------|---------|
| `init-work-dir.sh` | Create `test-NNN/` dirs and write `name.txt` from `test-names.txt` |
| `make-patch.sh` | Capture `git diff` of current edit into a patch file |
| `run-cmd.sh` | Run any shell command, capture log, print tail + exit code |
| `build-report.sh` | Assemble markdown table from all `test-NNN/outcome.txt` files |
| `sbt-start.sh` | Start sbt persistent server (sbt projects — see `references/`) |
| `sbt-stop.sh` | Stop sbt persistent server |

## References

- [sbt usage instructions](references/sbt-instructions.md)
