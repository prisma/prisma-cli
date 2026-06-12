import { spawnSync } from "node:child_process";

// Installing agent skills is contributor-machine DX; CI installs must not
// depend on it (the skills CLI's "*" matching is also broken on Windows).
if (process.env.CI) {
  console.log("CI detected; skipping agent skills installation.");
  process.exit(0);
}

const result = spawnSync(
  "skills",
  ["add", "./skills", "--skill", "*", "--agent", "universal", "claude-code", "-y"],
  { stdio: "inherit", shell: process.platform === "win32" },
);
process.exit(result.status ?? 1);
