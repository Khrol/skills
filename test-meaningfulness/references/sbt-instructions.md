# Running sbt Commands in a Persistent Session

sbt starts a JVM on every invocation — typically 5–15 seconds of overhead. For workflows that run many commands (e.g. mutation testing), this adds up fast.

Since sbt 1.1, sbt automatically starts a server in the background when you run it. Subsequent calls in the **same project directory** detect the running server and connect to it, skipping JVM startup.

## Start the server (once)

**Must be run from the directory containing `build.sbt`** — sbt binds the server to that directory; `-client` calls from any other directory will not find it.

Keep a named pipe open so sbt's interactive shell doesn't see EOF and exit. Derive file names from the project path so multiple parallel instances never share files:

```bash
cd /path/to/project                         # directory that contains build.sbt
SBT_KEY=$(echo "$PWD" | cksum | cut -d' ' -f1)   # unique per project directory
FIFO="/tmp/sbt-fifo-${SBT_KEY}"
LOG="/tmp/sbt-log-${SBT_KEY}.log"
PID_FILE="/tmp/sbt-pid-${SBT_KEY}"
mkfifo "$FIFO"
# Open write-end first (blocks until a reader appears), then start sbt as reader.
# Using a background keeper avoids `exec 3>` which zsh rejects inside && chains.
( while true; do sleep 10; done ) > "$FIFO" &
echo $! > "$PID_FILE"                       # save keeper PID for cleanup
sbt < "$FIFO" > "$LOG" 2>&1 &
echo $! >> "$PID_FILE"                      # save sbt PID for cleanup
# Wait for the server to be ready — active.json appears when it accepts connections
until [ -f "project/target/active.json" ]; do sleep 2; done
```

## Send commands (fast, no JVM startup)

```bash
sbt -client "testOnly com.foo.BarSpec"
sbt -client "testOnly com.foo.BazSpec"
sbt -client compile
```

Each `-client` call returns in ~1–2 s instead of 10–15 s.

## Shut the server down

```bash
sbt -client shutdown
kill $(cat "$PID_FILE") 2>/dev/null   # stops keeper + sbt
rm -f "$FIFO" "$PID_FILE"
```

## Usage in `test-meaningfulness` skill

Use the bundled scripts from the skill's `scripts/` directory — do not repeat the manual setup above.

**Step 2 — Start server** (run from the directory containing `build.sbt`):
```bash
bash "${CLAUDE_SKILL_DIR}/scripts/sbt-start.sh" /path/to/project
```

**Run-all command** to pass to `run-cmd.sh`:
```
sbt -client test
```

**Step 8 — Stop server**:
```bash
bash "${CLAUDE_SKILL_DIR}/scripts/sbt-stop.sh" /path/to/project
```

## Caveats

| Issue | Notes |
|-------|-------|
| `sbt "exit" &` does NOT work | `exit` shuts the server down — the keeper+pipe approach above is required. |
| `exec 3>"$FIFO"` in a `&&` chain | zsh rejects this syntax; use the background keeper loop instead. |
| Server crash | Delete `project/target/active.json` and restart. |
| Classpath changes | Run `sbt -client reload` after editing `build.sbt` or adding dependencies. |
| CI environments | No warm server to connect to; `-client` still works but gives no speedup. |
