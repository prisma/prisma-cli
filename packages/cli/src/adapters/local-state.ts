import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AuthProviderId } from "../types/auth";
import type { GitRepositoryConnection } from "../types/project";

export interface LocalState {
  auth: {
    provider: AuthProviderId;
    userId: string;
    workspaceId: string;
  } | null;
  project: {
    rememberedByWorkspace: Record<string, RememberedProjectState>;
    lastResolved: RememberedProjectState | null;
    repositoryConnectionsByProject: Record<string, GitRepositoryConnection>;
  };
  branch: {
    active: string;
  };
  agent: {
    setupPromptDismissedAt: string | null;
  };
}

export interface RememberedProjectState {
  id: string;
  name: string;
  workspaceId: string;
}

const DEFAULT_STATE: LocalState = {
  auth: null,
  project: {
    rememberedByWorkspace: {},
    lastResolved: null,
    repositoryConnectionsByProject: {},
  },
  branch: {
    active: "preview",
  },
  agent: {
    setupPromptDismissedAt: null,
  },
};

export const DEFAULT_STATE_FILE_NAME = "state.json";

export function resolveLocalStateFilePath(stateDir: string): string {
  return path.join(stateDir, DEFAULT_STATE_FILE_NAME);
}

export class LocalStateStore {
  private readonly stateFilePath: string;

  constructor(
    stateDir: string,
    private readonly signal?: AbortSignal,
  ) {
    this.stateFilePath = resolveLocalStateFilePath(stateDir);
  }

  async read(): Promise<LocalState> {
    this.signal?.throwIfAborted();
    try {
      const raw = await readFile(this.stateFilePath, {
        encoding: "utf8",
        signal: this.signal,
      });
      const parsed = JSON.parse(raw) as Partial<LocalState>;
      return {
        auth: parsed.auth ?? structuredClone(DEFAULT_STATE.auth),
        project: {
          rememberedByWorkspace: parsed.project?.rememberedByWorkspace ?? {},
          lastResolved: parsed.project?.lastResolved ?? null,
          repositoryConnectionsByProject:
            parsed.project?.repositoryConnectionsByProject ?? {},
        },
        branch: {
          active: parsed.branch?.active ?? DEFAULT_STATE.branch.active,
        },
        agent: {
          setupPromptDismissedAt: parsed.agent?.setupPromptDismissedAt ?? null,
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return structuredClone(DEFAULT_STATE);
      }

      throw error;
    }
  }

  async write(state: LocalState): Promise<void> {
    this.signal?.throwIfAborted();
    // mkdir does not accept AbortSignal; check before the filesystem boundary.
    await mkdir(path.dirname(this.stateFilePath), { recursive: true });
    this.signal?.throwIfAborted();
    await writeFile(this.stateFilePath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
    });
    this.signal?.throwIfAborted();
  }

  async setAuthSession(
    session: NonNullable<LocalState["auth"]>,
  ): Promise<LocalState> {
    const state = await this.read();
    state.auth = session;
    await this.write(state);
    return state;
  }

  async clearAuthSession(): Promise<LocalState> {
    const state = await this.read();
    state.auth = null;
    await this.write(state);
    return state;
  }

  async setActiveBranch(active: string): Promise<LocalState> {
    const state = await this.read();
    state.branch.active = active;
    await this.write(state);
    return state;
  }

  async readRememberedProject(
    workspaceId: string,
  ): Promise<RememberedProjectState | null> {
    const state = await this.read();
    return state.project.rememberedByWorkspace[workspaceId] ?? null;
  }

  async readLastResolvedProject(): Promise<RememberedProjectState | null> {
    const state = await this.read();
    return state.project.lastResolved;
  }

  async setRememberedProject(
    project: RememberedProjectState,
  ): Promise<LocalState> {
    const state = await this.read();
    state.project.rememberedByWorkspace[project.workspaceId] = project;
    state.project.lastResolved = project;
    await this.write(state);
    return state;
  }

  async readRepositoryConnection(
    projectId: string,
  ): Promise<GitRepositoryConnection | null> {
    const state = await this.read();
    return state.project.repositoryConnectionsByProject[projectId] ?? null;
  }

  async setRepositoryConnection(
    projectId: string,
    connection: GitRepositoryConnection,
  ): Promise<LocalState> {
    const state = await this.read();
    state.project.repositoryConnectionsByProject[projectId] = connection;
    await this.write(state);
    return state;
  }

  async clearRepositoryConnection(projectId: string): Promise<LocalState> {
    const state = await this.read();
    delete state.project.repositoryConnectionsByProject[projectId];
    await this.write(state);
    return state;
  }

  async readAgentSetupPromptDismissedAt(): Promise<string | null> {
    const state = await this.read();
    return state.agent.setupPromptDismissedAt;
  }

  async setAgentSetupPromptDismissedAt(
    dismissedAt: string,
  ): Promise<LocalState> {
    const state = await this.read();
    state.agent.setupPromptDismissedAt = dismissedAt;
    await this.write(state);
    return state;
  }
}
