// The trivial real child behind the real-child spawn tests.
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const [mode, value] = process.argv.slice(2);

const idle = () => setInterval(() => {}, 60_000);

switch (mode) {
  case "exit":
    process.exit(Number(value));
    break;
  case "print":
    process.stdout.write("child-said-hello\n");
    process.stderr.write("child-said-stderr\n");
    process.exit(0);
    break;
  case "pgid":
    writeFileSync(
      value,
      execSync(`ps -o pgid= -p ${process.pid}`).toString().trim(),
    );
    process.exit(0);
    break;
  case "ready-then-exit":
    writeFileSync(value, "ready");
    setTimeout(() => process.exit(0), 400);
    break;
  case "trap-term":
    process.on("SIGTERM", () => process.exit(42));
    idle();
    writeFileSync(value, "ready");
    break;
  case "ignore-term":
    process.on("SIGTERM", () => {});
    idle();
    writeFileSync(value, "ready");
    break;
  case "idle":
    idle();
    writeFileSync(value, "ready");
    break;
  case "chatter": {
    const pause = () => new Promise((resolve) => setTimeout(resolve, 50));
    process.stdout.write("out-1\n");
    await pause();
    process.stderr.write("err-1\n");
    await pause();
    process.stdout.write("out-2\n");
    await pause();
    process.exitCode = Number(value);
    break;
  }
  case "chatter-ignore-term":
    process.on("SIGTERM", () => {});
    setInterval(() => process.stdout.write("tick\n"), 20);
    writeFileSync(value, String(process.pid));
    break;
  default:
    process.exit(9);
}
