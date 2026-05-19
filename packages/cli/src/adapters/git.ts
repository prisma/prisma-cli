import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GitHubRepositoryReference {
  provider: "github";
  owner: string;
  name: string;
  fullName: string;
  url: string;
}

export async function readGitOriginRemote(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["config", "--get", "remote.origin.url"], {
      cwd,
      timeout: 5_000,
    });
    const remote = stdout.trim();
    return remote.length > 0 ? remote : null;
  } catch {
    return null;
  }
}

export function parseGitHubRepositoryUrl(value: string): GitHubRepositoryReference | null {
  const input = value.trim();
  const shorthand = input.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);

  if (shorthand) {
    return toGitHubRepositoryReference(shorthand[1], shorthand[2]);
  }

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return null;
  }

  if (parsed.hostname !== "github.com") {
    return null;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:" && parsed.protocol !== "ssh:") {
    return null;
  }

  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length !== 2) {
    return null;
  }

  const [owner, rawName] = parts;
  const name = rawName.endsWith(".git") ? rawName.slice(0, -4) : rawName;

  return toGitHubRepositoryReference(owner, name);
}

function toGitHubRepositoryReference(owner: string | undefined, name: string | undefined): GitHubRepositoryReference | null {
  if (!owner || !name || owner.includes("/") || name.includes("/")) {
    return null;
  }

  return {
    provider: "github",
    owner,
    name,
    fullName: `${owner}/${name}`,
    url: `https://github.com/${owner}/${name}`,
  };
}
