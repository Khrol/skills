# test-meaningfulness

Mutation testing skill for Claude Code. Evaluates how meaningful each unit test is by finding a minimal source code change that causes exactly that test to fail while all others stay green.

## Concept

```mermaid
flowchart LR
    Q([For each test:\nis it meaningful?]) --> M[Break the code\nit exercises]
    M --> R{Which tests\nnow fail?}

    R -->|only this one| OK["✓ MEANINGFUL\ntest catches real bugs"]
    R -->|this + siblings\nbut siblings isolable| BL["BASELINE\nthis test is the root\nsiblings extend it"]
    R -->|this + siblings\nmutually entangled| CO["COUPLED\nredundant tests\nmissing separation"]
    R -->|none — test\nnever fails| SU["SUSPECT\nvacuous assertion\nor wrong target"]

    style OK fill:#d4edda,stroke:#28a745,color:#155724
    style BL fill:#fff3cd,stroke:#ffc107,color:#856404
    style CO fill:#fde8d8,stroke:#fd7e14,color:#7d3a00
    style SU fill:#f8d7da,stroke:#dc3545,color:#721c24
```

## Implementation flow

```mermaid
flowchart LR
    A([Start]) --> B[Detect\ncontext]
    B --> C{Green?}
    C -->|no| X([Fix first])
    C -->|yes| D[Enumerate\ninit-work-dir]

    D --> E1

    subgraph LOOP[" Per test · 5 attempts "]
        direction LR
        E1[Edit\nsource] --> E2[make-patch] --> E3[run-cmd\nsuite.log]
        E3 --> E4{Only\ntarget?}
        E4 -->|yes| E5[✓ Revert]
        E4 -->|no| E6[Revert]
        E6 -->|retry| E1
        E6 -->|×5| E7[BASELINE\nCOUPLED\nSUSPECT]
    end

    LOOP --> F[Coverage\ngaps] --> G[build-report] --> H([Done])
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
    role.txt             ← (BASELINE groups only) "root" | "sibling of test-NNN"
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
