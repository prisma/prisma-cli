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
  default:
    process.exit(9);
}
