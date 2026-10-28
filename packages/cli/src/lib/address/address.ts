/**
 * Addresses as command subjects. Prisma Composer names everything it
 * deploys with an address such as `shop.api`, whose first `.`-separated
 * part is the app. A subject names one by `@`, an optional environment
 * and `:`, then the address: `@pr-42:shop.api`, `@shop.catalog`,
 * `@shop`. The app is the Project's `logicalId`; the full address is the
 * service, database or bucket row's `logicalId`.
 */
import {
  CliStructuredError,
  type NextAction,
} from "@prisma/cli-engine/protocol";
import type { ManagementApiClient } from "@prisma/management-api-sdk";
import { CLI_NAME } from "../../cli-name";
import { formatCommandArgument } from "../../command-arguments";
import { listProjectBranches } from "../branch/list";

const PRODUCTION_ENVIRONMENT = "production";
const WHITESPACE = /\s/;

const DEPLOY_LIST_COMMAND = `${CLI_NAME} deploy list`;
const BRANCH_LIST_COMMAND = `${CLI_NAME} branch list`;

/** The kinds that live on one Branch. A Project spans every Branch. */
export type BranchScopedKind = "service" | "database" | "bucket";

const BRANCH_SCOPED_KINDS: readonly BranchScopedKind[] = [
  "service",
  "database",
  "bucket",
];

const KIND_GROUP: Readonly<Record<BranchScopedKind, string>> = {
  service: "service",
  database: "postgres",
  bucket: "bucket",
};

/** A subject written as `@`, an optional environment and `:`, then an
 *  address. */
export interface AddressSubject {
  /** The subject as typed, `@` included. */
  readonly text: string;
  /** The environment before `:`; undefined when the subject names none. */
  readonly environment: string | undefined;
  readonly address: string;
  readonly appName: string;
}

/** The service, database or bucket row an address subject names. */
export interface AddressMatch {
  readonly id: string;
  /** The subject as typed, `@` included. */
  readonly text: string;
  /** The environment named, `production` when none was. */
  readonly environment: string;
  readonly project: { readonly id: string; readonly name: string };
  readonly branch: {
    readonly id: string;
    readonly gitName: string;
    readonly isDefault: boolean;
  };
}

/** The `--project` and `--branch` values a command was given. */
export interface ScopeFlags {
  readonly project?: string | undefined;
  readonly branch?: string | undefined;
}

/** What a command acts on: the subject and scope flags as typed, or, for
 *  an address, the row id with the Project id and Branch git name the
 *  address names, plus the match itself. */
export interface ResolvedSubject {
  readonly ref: string;
  readonly project: string | undefined;
  readonly branch: string | undefined;
  readonly match: AddressMatch | undefined;
}

type Api = Pick<ManagementApiClient, "GET">;

export function isAddress(subject: string): boolean {
  return subject.startsWith("@");
}

export function parseAddress(subject: string): AddressSubject {
  if (!isAddress(subject)) {
    throw malformedAddressError(subject, "It does not start with '@'.");
  }
  if (WHITESPACE.test(subject)) {
    throw malformedAddressError(subject, "It contains a space.");
  }
  const body = subject.slice(1);
  const colon = body.indexOf(":");
  const environment = colon === -1 ? undefined : body.slice(0, colon);
  const address = colon === -1 ? body : body.slice(colon + 1);
  if (environment === "") {
    throw malformedAddressError(
      subject,
      "The environment before ':' is empty. Leave out the ':' to name production.",
    );
  }
  if (address === "") {
    throw malformedAddressError(subject, "The address is empty.");
  }
  const segments = address.split(".");
  if (segments.some((segment) => segment === "")) {
    throw malformedAddressError(
      subject,
      `The address "${address}" has an empty part between dots.`,
    );
  }
  return { text: subject, environment, address, appName: segments[0] ?? "" };
}

/** Where a match lives, for a consent question: `in production (branch
 *  main)` or `in environment pr-42 (branch pr-42)`. */
export function describeEnvironment(match: AddressMatch): string {
  const branch = `(branch ${match.branch.gitName})`;
  if (match.environment === PRODUCTION_ENVIRONMENT) {
    return `in production ${branch}`;
  }
  if (match.branch.isDefault) {
    return `in environment ${match.environment}, which is production ${branch}`;
  }
  return `in environment ${match.environment} ${branch}`;
}

/** The Project an address subject names. It must be the app name alone,
 *  with no environment: a Project spans every environment, so
 *  `@pr-42:shop` must never reach a command that acts on all of them. */
export async function resolveProjectAddress(
  api: Api,
  subject: string,
  signal: AbortSignal,
): Promise<{ readonly id: string; readonly name: string }> {
  const parsed = parseAddress(subject);
  if (parsed.environment !== undefined) {
    throw projectEnvironmentError(parsed);
  }
  if (parsed.address !== parsed.appName) {
    throw projectGivenRowAddressError(parsed);
  }
  return findProject(api, parsed, signal);
}

/** The service, database or bucket row an address subject names. */
export async function resolveBranchScopedAddress(
  api: Api,
  kind: BranchScopedKind,
  subject: string,
  signal: AbortSignal,
): Promise<AddressMatch> {
  const parsed = parseAddress(subject);
  if (parsed.address === parsed.appName) {
    throw addressNamesProjectError(parsed, kind);
  }
  const project = await findProject(api, parsed, signal);
  const branch = await findBranch(api, parsed, project, signal);
  const rows = await listRows(api, kind, parsed, project.id, branch.id, signal);

  if (rows.length > 1) {
    throw rowsAmbiguousError(parsed, kind, rows);
  }
  const [row] = rows;
  if (row !== undefined) {
    return {
      id: row.id,
      text: parsed.text,
      environment: parsed.environment ?? PRODUCTION_ENVIRONMENT,
      project,
      branch,
    };
  }

  for (const otherKind of BRANCH_SCOPED_KINDS.filter(
    (other) => other !== kind,
  )) {
    // biome-ignore lint/performance/noAwaitInLoops: the first kind that holds the address answers; there is no reason to ask about the next one.
    const others = await listRows(
      api,
      otherKind,
      parsed,
      project.id,
      branch.id,
      signal,
    );
    if (others.length > 0) {
      throw wrongKindError(parsed, kind, otherKind);
    }
  }
  throw rowNotFoundError(parsed, kind, project, branch);
}

/** The hand-over: a subject that is an address becomes the row id, the
 *  Project id and the Branch git name it names, exactly what the user
 *  could have typed instead. Any other subject passes through with the
 *  flags it came with. */
export async function resolveBranchScopedSubject(
  api: Api,
  kind: BranchScopedKind,
  subject: string,
  signal: AbortSignal,
  flags: ScopeFlags = {},
): Promise<ResolvedSubject> {
  if (!isAddress(subject)) {
    return {
      ref: subject,
      project: flags.project,
      branch: flags.branch,
      match: undefined,
    };
  }
  rejectScopeFlags(subject, flags);
  const match = await resolveBranchScopedAddress(api, kind, subject, signal);
  return {
    ref: match.id,
    project: match.project.id,
    branch: match.branch.gitName,
    match,
  };
}

/** The Project id an address subject names, or the subject unchanged. */
export async function resolveProjectSubject(
  api: Api,
  subject: string,
  signal: AbortSignal,
): Promise<string> {
  if (!isAddress(subject)) {
    return subject;
  }
  const project = await resolveProjectAddress(api, subject, signal);
  return project.id;
}

function rejectScopeFlags(subject: string, flags: ScopeFlags): void {
  const given = [
    ...(flags.project !== undefined ? ["--project"] : []),
    ...(flags.branch !== undefined ? ["--branch"] : []),
  ];
  if (given.length === 0) {
    return;
  }
  throw new CliStructuredError(
    "ADDRESS.USAGE_ERROR",
    `${given.join(" and ")} cannot be combined with an address`,
    {
      why: `"${subject}" already names its Project and Branch, so ${given.join(" and ")} would name them a second time.`,
      meta: { address: subject, flags: given },
      nextActions: [
        userChoice(
          `Drop ${given.join(" and ")}, or pass an id or name instead of the address.`,
        ),
      ],
    },
  );
}

interface Page<T> {
  readonly data: readonly T[];
  readonly pagination: {
    readonly hasMore: boolean;
    readonly nextCursor: string | null;
  };
}

interface ApiErrorBody {
  readonly error?: {
    readonly code?: string;
    readonly message?: string;
    readonly hint?: string;
  };
}

interface PageResponse<T> {
  readonly data?: Page<T> | undefined;
  readonly error?: ApiErrorBody | undefined;
  readonly response: Response;
}

async function listAllPages<T>(
  summary: string,
  fetchPage: (cursor: string | undefined) => Promise<PageResponse<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | undefined;
  do {
    // biome-ignore lint/performance/noAwaitInLoops: each page is fetched with the cursor the previous page returned.
    const { data, error, response } = await fetchPage(cursor);
    if (error || !data) {
      throw addressApiError(summary, response, error);
    }
    rows.push(...data.data);
    cursor = data.pagination.hasMore
      ? (data.pagination.nextCursor ?? undefined)
      : undefined;
  } while (cursor);
  return rows;
}

interface LogicalRow {
  readonly id: string;
  readonly name: string;
  readonly logicalId: string | null;
}

async function findProject(
  api: Api,
  subject: AddressSubject,
  signal: AbortSignal,
): Promise<AddressMatch["project"]> {
  const projects = await listAllPages<LogicalRow>(
    "Failed to look up the app's Project",
    (cursor) =>
      api.GET("/v1/projects", {
        params: { query: { logicalId: subject.appName, cursor } },
        signal,
      }),
  );
  const matches = projects.filter(
    (project) => project.logicalId === subject.appName,
  );
  if (matches.length > 1) {
    throw new CliStructuredError(
      "ADDRESS.AMBIGUOUS",
      `Several Projects are named "${subject.appName}"`,
      {
        why: `"${subject.text}" names app "${subject.appName}", and more than one Project in this workspace has it.`,
        meta: { address: subject.text, matches: idsAndNames(matches) },
        nextActions: [
          userChoice(
            `Pass a Project id instead of the address: ${matches.map((project) => project.id).join(", ")}.`,
          ),
        ],
      },
    );
  }
  const [project] = matches;
  if (project === undefined) {
    throw new CliStructuredError(
      "ADDRESS.NOT_FOUND",
      `No Project for app "${subject.appName}"`,
      {
        why: `"${subject.text}" names app "${subject.appName}", and no Project in this workspace was deployed for it.`,
        meta: { address: subject.text, app: subject.appName },
        nextActions: [
          userChoice(
            "Check the app name, or that you are signed in to the workspace the app was deployed to.",
          ),
          runCommand(`${CLI_NAME} project list`),
        ],
      },
    );
  }
  return { id: project.id, name: project.name };
}

/** No environment, or `production`, is the Project's default Branch;
 *  any other environment is the Branch with that git name. */
async function findBranch(
  api: Api,
  subject: AddressSubject,
  project: AddressMatch["project"],
  signal: AbortSignal,
): Promise<AddressMatch["branch"]> {
  const environment = subject.environment ?? PRODUCTION_ENVIRONMENT;
  const production = environment === PRODUCTION_ENVIRONMENT;
  const branches = await listProjectBranches(api, {
    projectId: project.id,
    gitName: production ? undefined : environment,
    signal,
  });
  const branch = production
    ? branches.find((candidate) => candidate.isDefault)
    : branches.find((candidate) => candidate.gitName === environment);
  if (branch === undefined) {
    throw new CliStructuredError(
      "ADDRESS.NOT_FOUND",
      `No branch for environment "${environment}"`,
      {
        why: production
          ? `Project "${project.name}" (${project.id}) has no default branch. Production is the default branch.`
          : `Project "${project.name}" (${project.id}) has no branch whose git name is "${environment}".`,
        meta: {
          address: subject.text,
          environment,
          projectId: project.id,
        },
        nextActions: [
          userChoice(
            "Use an environment from the Project's branch list: a branch's git name, or production for the default branch.",
          ),
          runCommand(`${BRANCH_LIST_COMMAND} --project ${project.id}`),
        ],
      },
    );
  }
  return {
    id: branch.id,
    gitName: branch.gitName,
    isDefault: branch.isDefault,
  };
}

/** The API filters by `logicalId` and `branchId`; the rows are checked
 *  again here so an API that ignored a filter cannot widen the match. */
async function listRows(
  api: Api,
  kind: BranchScopedKind,
  subject: AddressSubject,
  projectId: string,
  branchId: string,
  signal: AbortSignal,
): Promise<LogicalRow[]> {
  const filters = { projectId, logicalId: subject.address, branchId };
  const rows = await listAllPages<LogicalRow & { branchId: string | null }>(
    `Failed to look up ${kind}s by address`,
    (cursor) => {
      const init = { params: { query: { ...filters, cursor } }, signal };
      switch (kind) {
        case "service":
          return api.GET("/v1/services", init);
        case "database":
          return api.GET("/v1/databases", init);
        case "bucket":
          return api.GET("/v1/buckets", init);
      }
    },
  );
  return rows.filter(
    (row) => row.logicalId === subject.address && row.branchId === branchId,
  );
}

function idsAndNames(
  rows: readonly LogicalRow[],
): { id: string; name: string }[] {
  return rows.map((row) => ({ id: row.id, name: row.name }));
}

function malformedAddressError(
  subject: string,
  why: string,
): CliStructuredError {
  return new CliStructuredError(
    "ADDRESS.USAGE_ERROR",
    `"${subject}" is not a valid address`,
    {
      why: `${why} Name a deployed resource with @, then an optional environment and ':', then its address, such as @shop.api for production or @pr-42:shop.api.`,
      meta: { address: subject },
      nextActions: [
        userChoice(
          "Fix the address, or pass the id or name instead. Addresses that were deployed are listed by the command below, run in the app's directory.",
        ),
        runCommand(DEPLOY_LIST_COMMAND),
      ],
    },
  );
}

function projectEnvironmentError(subject: AddressSubject): CliStructuredError {
  const projectAddress = `@${subject.appName}`;
  return new CliStructuredError(
    "ADDRESS.USAGE_ERROR",
    `A Project's address takes no environment: "${subject.text}"`,
    {
      why: `A Project spans every environment of app "${subject.appName}", so naming one environment would still act on all of them. Write ${projectAddress}.`,
      meta: { address: subject.text },
      nextActions: [userChoice(`Pass ${projectAddress} to name the Project.`)],
    },
  );
}

function projectGivenRowAddressError(
  subject: AddressSubject,
): CliStructuredError {
  const projectAddress = `@${subject.appName}`;
  return new CliStructuredError(
    "ADDRESS.WRONG_KIND",
    `"${subject.text}" names something inside app "${subject.appName}", not its Project`,
    {
      why: `A Project's address is the app name alone, ${projectAddress}. "${subject.address}" names a service, database or bucket inside it.`,
      meta: {
        address: subject.text,
        expected: "project",
        actual: "service, database or bucket",
      },
      nextActions: [
        userChoice(
          `Pass ${projectAddress} to name the Project, or use a service, postgres or bucket command for "${subject.text}".`,
        ),
      ],
    },
  );
}

function addressNamesProjectError(
  subject: AddressSubject,
  kind: BranchScopedKind,
): CliStructuredError {
  const projectCommand = `${CLI_NAME} project show @${subject.appName}`;
  return new CliStructuredError(
    "ADDRESS.WRONG_KIND",
    `"${subject.text}" names the app's Project, not a ${kind}`,
    {
      why: `The app name alone, "${subject.appName}", is the Project's address. A ${kind}'s address continues past it, such as @${subject.appName}.<name>.`,
      meta: { address: subject.text, expected: kind, actual: "project" },
      nextActions: [
        userChoice(`Name the ${kind} inside the app, or inspect the Project.`),
        runCommand(projectCommand),
      ],
    },
  );
}

function wrongKindError(
  subject: AddressSubject,
  expected: BranchScopedKind,
  actual: BranchScopedKind,
): CliStructuredError {
  return new CliStructuredError(
    "ADDRESS.WRONG_KIND",
    `"${subject.text}" is a ${actual}, not a ${expected}`,
    {
      why: `The address names a ${actual}. The ${KIND_GROUP[actual]} commands act on it.`,
      meta: { address: subject.text, expected, actual },
      nextActions: [
        userChoice(
          `Use a '${CLI_NAME} ${KIND_GROUP[actual]}' command for ${formatCommandArgument(subject.text)}.`,
        ),
        runCommand(`${CLI_NAME} ${KIND_GROUP[actual]} --help`),
      ],
    },
  );
}

function rowNotFoundError(
  subject: AddressSubject,
  kind: BranchScopedKind,
  project: AddressMatch["project"],
  branch: AddressMatch["branch"],
): CliStructuredError {
  return new CliStructuredError(
    "ADDRESS.NOT_FOUND",
    `Nothing is deployed at "${subject.text}"`,
    {
      why: `No service, database or bucket on branch "${branch.gitName}" of Project "${project.name}" (${project.id}) has address "${subject.address}".`,
      meta: {
        address: subject.text,
        expected: kind,
        projectId: project.id,
        branchId: branch.id,
      },
      nextActions: [
        userChoice(
          "Check the address and environment against what the app deployed; the command below lists them, run in the app's directory.",
        ),
        runCommand(DEPLOY_LIST_COMMAND),
      ],
    },
  );
}

function rowsAmbiguousError(
  subject: AddressSubject,
  kind: BranchScopedKind,
  rows: readonly LogicalRow[],
): CliStructuredError {
  return new CliStructuredError(
    "ADDRESS.AMBIGUOUS",
    `Several ${kind} rows have address "${subject.text}"`,
    {
      why: `More than one ${kind} on the branch carries address "${subject.address}", so the address does not pick one.`,
      meta: { address: subject.text, matches: idsAndNames(rows) },
      nextActions: [
        userChoice(
          `Pass one of the ids instead: ${rows.map((row) => row.id).join(", ")}.`,
        ),
      ],
    },
  );
}

function addressApiError(
  summary: string,
  response: Response,
  error: ApiErrorBody | undefined,
): CliStructuredError {
  const status = response.status;
  const apiCode = error?.error?.code;
  return new CliStructuredError("ADDRESS.API_ERROR", summary, {
    why:
      error?.error?.message ??
      `The Management API returned status ${status || "unknown"}.`,
    meta: {
      ...(status ? { status } : {}),
      ...(apiCode !== undefined ? { apiCode } : {}),
    },
    nextActions: [
      userChoice(
        error?.error?.hint ??
          "Re-run with --log-level verbose for the underlying API response details.",
      ),
    ],
  });
}

function userChoice(label: string): NextAction {
  return { kind: "user-choice", label };
}

function runCommand(command: string): NextAction {
  return { kind: "run-command", label: command, command };
}
