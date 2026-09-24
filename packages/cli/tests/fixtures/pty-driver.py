# Runs a command under a pseudo-terminal, answers the first prompt with
# Enter, and reports whether the process exited on its own. Output:
# one JSON object on stdout.
import fcntl, json, os, pty, select, signal, struct, subprocess, sys, termios, time

PROMPT, SETTLED = b"Proceed?", b"[settled"
argv = sys.argv[1:]
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 100, 0, 0))
child = subprocess.Popen(argv, stdin=slave, stdout=slave, stderr=slave, close_fds=True)
os.close(slave)

out = b""
deadline = time.monotonic() + 20
answered = settled = False
exited = None
while time.monotonic() < deadline:
    ready, _, _ = select.select([master], [], [], 0.1)
    if ready:
        try:
            chunk = os.read(master, 4096)
        except OSError:
            chunk = b""
        out += chunk
    if not answered and PROMPT in out:
        time.sleep(0.3)
        os.write(master, b"\r")
        answered = True
    if not settled and SETTLED in out:
        settled = True
        deadline = time.monotonic() + 5
    exited = child.poll()
    if exited is not None:
        break

if exited is None:
    child.send_signal(signal.SIGKILL)
    child.wait()
print(json.dumps({
    "answered": answered,
    "settled": settled,
    "exitedOnItsOwn": exited is not None,
    "exitCode": exited,
    "output": out.decode("utf-8", "replace")[-2000:],
}))
