import type { Diagnostic } from "@prisma/cli-engine/protocol";
import type { PrismaCliPackageCommandFormatter } from "../../lib/agent/cli-command";
import type { InitConfigFormat, InitSettingRow } from "../../types/init";
import type { ProjectCommandContext } from "../project/context";

export type { InitConfigFormat, InitSettingRow };

/**
 * `unauthenticated` is the one status the legacy command had no name
 * for: it auto-launched a browser login instead. Init now reads the
 * auth state and says so.
 */
export type InitLinkStatus =
  | "linked"
  | "already-linked"
  | "skipped"
  | "declined"
  | "unauthenticated"
  | "failed";

export interface InitLinkState {
  readonly status: InitLinkStatus;
  readonly project: { readonly id: string; readonly name: string } | null;
}

export type InitTypesStatus =
  | "installed"
  | "already-installed"
  | "skipped"
  | "declined"
  | "failed";

export interface InitTypesState {
  readonly status: InitTypesStatus;
  readonly package: string;
  /** Human-runnable install command for hints when not installed. */
  readonly installCommand: string | null;
}

export interface InitResult {
  readonly configPath: string;
  readonly format: InitConfigFormat;
  /** True when init converted an existing prisma.compute.json to TypeScript. */
  readonly converted: boolean;
  readonly directory: string;
  /**
   * App identity pinned by the written config. Null when a conversion
   * transported a config that does not pin a single fully-resolved app.
   */
  readonly app: {
    readonly name: string;
    readonly framework: string;
    readonly httpPort: number;
    readonly entry?: string;
    readonly region?: string;
  } | null;
  readonly settings: readonly InitSettingRow[];
  readonly types: InitTypesState;
  readonly link: InitLinkState;
}

/** The parsed flag surface, one property per declared flag. */
export interface InitFlags {
  readonly framework: string | undefined;
  readonly entry: string | undefined;
  readonly httpPort: string | undefined;
  readonly region: string | undefined;
  readonly name: string | undefined;
  readonly link: boolean | undefined;
  readonly project: string | undefined;
  readonly install: boolean | undefined;
  readonly configFormat: "ts" | "json" | undefined;
}

/**
 * What each step of the wizard needs. `engine.cwd` is the directory the
 * step acts on, which is not always the invocation directory: a
 * conversion discovered in an ancestor installs types and writes the
 * project pin where the config lives.
 */
export interface InitStepContext {
  readonly engine: ProjectCommandContext;
  readonly formatCommand: PrismaCliPackageCommandFormatter;
  /** Records a finding on the outcome; the legacy `warnings` channel. */
  readonly record: (diagnostic: Diagnostic) => void;
}
