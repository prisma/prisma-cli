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

export async function resolveGitHubRepositoryId(
  repository: GitHubRepositoryReference,
): Promise<number | null> {
  const fromGh = await resolveGitHubRepositoryIdWithGh(repository);
  if (fromGh !== null) {
    return fromGh;
  }

  return resolveGitHubRepositoryIdWithPublicApi(repository);
}

async function resolveGitHubRepositoryIdWithGh(
  repository: GitHubRepositoryReference,
): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      "gh",
      ["repo", "view", repository.fullName, "--json", "databaseId"],
      { timeout: 5_000 },
    );
    const parsed = JSON.parse(stdout) as { databaseId?: unknown };
    return typeof parsed.databaseId === "number" && Number.isInteger(parsed.databaseId)
      ? parsed.databaseId
      : null;
  } catch {
    return null;
  }
}

async function resolveGitHubRepositoryIdWithPublicApi(
  repository: GitHubRepositoryReference,
): Promise<number | null> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`,
      {
        headers: {
          "user-agent": "prisma-cli",
          accept: "application/vnd.github+json",
        },
        signal: AbortSignal.timeout(5_000),
      },
    );

    if (!response.ok) {
      return null;
    }

    const parsed = await response.json() as { id?: unknown };
    return typeof parsed.id === "number" && Number.isInteger(parsed.id)
      ? parsed.id
      : null;
  } catch {
    return null;
  }
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
