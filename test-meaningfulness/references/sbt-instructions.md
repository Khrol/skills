# Running sbt Commands in a Persistent Session

sbt starts a JVM on every invocation — typically 5–15 seconds of overhead. For workflows that run many commands (e.g. mutation testing), this adds up fast.

Since sbt 1.1, sbt automatically starts a server in the background when you run it. Subsequent calls in the **same project directory** detect the running server and connect to it, skipping JVM startup.

## Start the server (once)

**Must be run from the directory containing `build.sbt`** — sbt binds the server to that directory; `-client` calls from any other directory will not find it.

Keep a named pipe open so sbt's interactive shell doesn't see EOF and exit:

```bash
cd /path/to/project                         # directory that contains build.sbt
FIFO=$(mktemp -u /tmp/sbt-XXXX)
mkfifo "$FIFO"
exec 3>"$FIFO"                              # keep write-end open (prevents EOF)
sbt < "$FIFO" > /tmp/sbt-server.log 2>&1 &
echo $! > /tmp/sbt-server.pid
sleep 15                                    # wait for JVM + server to be ready
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
exec 3>&-          # close the write-end of the pipe
rm "$FIFO"
```

## Usage in `test-meaningfulness` skill

```bash
# 1. Start the server once — from the directory that contains build.sbt
cd /path/to/project   # e.g. nosara/.claude/worktrees/my-branch/proteus
FIFO=$(mktemp -u /tmp/sbt-XXXX); mkfifo "$FIFO"; exec 3>"$FIFO"
sbt < "$FIFO" > /tmp/sbt-server.log 2>&1 &
sleep 15

# 2. The skill then calls (fast) — also from the same directory:
sbt -client "testOnly com.foo.SomeSpec"
sbt -client test

# 3. Cleanup
sbt -client shutdown; exec 3>&-; rm "$FIFO"
```

## Caveats

| Issue | Notes |
|-------|-------|
| `sbt "exit" &` does NOT work | `exit` shuts the server down — the pipe approach above is required. |
| Server crash | Delete `project/target/active.json` and restart. |
| Classpath changes | Run `sbt -client reload` after editing `build.sbt` or adding dependencies. |
| CI environments | No warm server to connect to; `-client` still works but gives no speedup. |
