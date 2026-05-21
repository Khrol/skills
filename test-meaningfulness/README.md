# test-meaningfulness

Mutation testing skill for Claude Code. Evaluates how meaningful each unit test is by finding a minimal source code change that causes exactly that test to fail while all others stay green.

## Flow

```mermaid
flowchart TD
    A([Start]) --> B[Detect context\nPR or manual interview]
    B --> C[Start test runner server\nif needed — see references/]
    C --> D[Run full suite — must be green]
    D --> E[Enumerate tests\nWrite test-names.txt]
    E --> F[init-work-dir.sh\ncreates test-NNN/ dirs + name.txt]
    F --> G

    subgraph G[For each test — up to 5 attempts]
        direction TB
        G1[5a. Read test + source\nupdate coverage map] --> G2
        G2[5b. Edit source file\napply mutation] --> G3
        G3[make-patch.sh\ncapture git diff → mutation.patch] --> G4
        G4[run-cmd.sh\nrun-all → suite.log] --> G5{Result?}
        G5 -->|only target failed| G6[✓ Success]
        G5 -->|target did not fail| G7[Revert\ngit restore]
        G5 -->|other tests also failed| G7
        G7 -->|attempt < 5| G2
        G7 -->|attempt = 5| G8[Diagnose\nBASELINE / COUPLED / SUSPECT]
        G6 --> G9[Revert\ngit restore]
    end

    G --> H[Write outcome.txt\nmutation-desc.txt\nsibling.txt]
    H --> I[Step 6: Identify untested areas\nwalk coverage map]
    I --> J[build-report.sh\nmutation-report.md]
    J --> K[Stop test runner server\nif started]
    K --> L([Done])
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
