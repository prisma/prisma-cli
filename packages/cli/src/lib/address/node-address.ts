/**
 * Node addresses as command subjects: `@<environment>:<address>`, the name
 * Prisma Composer gives every node it deploys (`@pr-42:shop.api`,
 * `@shop.catalog`, `@shop`). The first `.`-separated segment of the
 * address is the app, which is the Project's `logicalId`; the full
 * address is the service, database or bucket row's `logicalId`.
 */
import {
  CliStructuredError,
  type NextAction,
} from "@prisma/cli-engine/protocol";
import type { ManagementApiClient } from "@prisma/management-api-sdk";
import { CLI_NAME } from "../../cli-name";
import { formatCommandArgument } from "../../command-arguments";

const PRODUCTION_ENVIRONMENT = "production";
const WHITESPACE = /\s/;

const DEPLOY_LIST_COMMAND = `${CLI_NAME} deploy list`;
const BRANCH_LIST_COMMAND = `${CLI_NAME} branch list`;

export type NodeKind = "service" | "database" | "bucket";

const NODE_KINDS: readonly NodeKind[] = ["service", "database", "bucket"];

/** The command group that acts on each kind. */
const KIND_GROUP: Readonly<Record<NodeKind, string>> = {
  service: "service",
  database: "postgres",
  bucket: "bucket",
};

export interface NodeAddress {
  /** The subject exactly as typed, `@` included. */
  readonly text: string;
  /** The environment before `:`; undefined when the subject names none. */
  readonly environment: string | undefined;
  readonly address: string;
  readonly appName: string;
}

export interface AddressedProject {
  readonly id: string;
  readonly name: string;
}

export interface AddressedBranch {
  readonly id: string;
  readonly gitName: string;
}

export interface AddressedNode {
  readonly id: string;
  readonly project: AddressedProject;
  readonly branch: AddressedBranch;
}

/** The `--project` and `--branch` values a command was given. */
export interface SubjectScope {
  readonly project?: string | undefined;
  readonly branch?: string | undefined;
}

/** What the command acts on: the subject and scope flags as typed, or,
 *  for an address, the row id with the Project id and Branch git name
 *  the address names. */
export interface ScopedSubject {
  readonly ref: string;
  readonly project: string | undefined;
  readonly branch: string | undefined;
}

type Api = Pick<ManagementApiClient, "GET">;

export function isNodeAddress(subject: string): boolean {
  return subject.startsWith("@");
}

export function parseNodeAddress(subject: string): NodeAddress {
  if (!isNodeAddress(subject)) {
    throw malformedAddressError(subject, "An address starts with '@'.");
  }
  if (WHITESPACE.test(subject)) {
    throw malformedAddressError(subject, "An address contains no spaces.");
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
    throw malformedAddressError(subject, "The address after '@' is empty.");
  }
  const segments = address.split(".");
  if (segments.some((segment) => segment === "")) {
    throw malformedAddressError(
      subject,
      `"${address}" has an empty part between dots.`,
    );
  }
  return { text: subject, environment, address, appName: segments[0] ?? "" };
}

/** A destructive command's consent token is the subject as typed when
 *  it is an address; otherwise the command's own token. */
export function consentToken(
  subject: string | undefined,
  fallback: string,
): string {
  return subject !== undefined && isNodeAddress(subject) ? subject : fallback;
}

/** The Project an address names. It must be the app name alone, with no
 *  environment: a Project spans every environment, so `@pr-42:shop`
 *  must never reach a command that would act on all of them. */
export async function resolveProjectAddress(
  api: Api,
  subject: string,
  signal: AbortSignal,
): Promise<AddressedProject> {
  const parsed = parseNodeAddress(subject);
  if (parsed.environment !== undefined) {
    throw projectEnvironmentError(parsed);
  }
  if (parsed.address !== parsed.appName) {
    throw projectNodeAddressError(parsed);
  }
  return findProject(api, parsed, signal);
}

/** The service, database or bucket row an address names. */
export async function resolveNodeAddress(
  api: Api,
  kind: NodeKind,
  subject: string,
  signal: AbortSignal,
): Promise<AddressedNode> {
  const parsed = parseNodeAddress(subject);
  if (parsed.address === parsed.appName) {
    throw addressNamesProjectError(parsed, kind);
  }
  const project = await findProject(api, parsed, signal);
  const branch = await findBranch(api, parsed, project, signal);
  const rows = await listNodes(api, kind, parsed, project, branch, signal);

  if (rows.length > 1) {
    throw ambiguousError(parsed, kind, rows);
  }
  const [row] = rows;
  if (row !== undefined) {
    return { id: row.id, project, branch };
  }

  for (const otherKind of NODE_KINDS.filter((other) => other !== kind)) {
    // biome-ignore lint/performance/noAwaitInLoops: the first kind that holds the address answers; there is no reason to ask about the next one.
    const others = await listNodes(
      api,
      otherKind,
      parsed,
      project,
      branch,
      signal,
    );
    if (others.length > 0) {
      throw wrongKindError(parsed, kind, otherKind);
    }
  }
  throw nodeNotFoundError(parsed, kind, project, branch);
}

/** The hand-over: a subject that is an address becomes the row id, the
 *  Project id and the Branch git name it names, exactly what the user
 *  could have typed instead. Any other subject passes through with the
 *  flags it came with. */
export async function resolveScopedSubject(
  api: Api,
  kind: NodeKind,
  subject: string,
  scope: SubjectScope,
  signal: AbortSignal,
): Promise<ScopedSubject> {
  if (!isNodeAddress(subject)) {
    return { ref: subject, project: scope.project, branch: scope.branch };
  }
  rejectScopeFlags(subject, scope);
  const node = await resolveNodeAddress(api, kind, subject, signal);
  return {
    ref: node.id,
    project: node.project.id,
    branch: node.branch.gitName,
  };
}

/** The Project id an address names, or the subject unchanged. */
export async function resolveProjectSubject(
  api: Api,
  subject: string,
  signal: AbortSignal,
): Promise<string> {
  if (!isNodeAddress(subject)) {
    return subject;
  }
  const project = await resolveProjectAddress(api, subject, signal);
  return project.id;
}

function rejectScopeFlags(subject: string, scope: SubjectScope): void {
  const given = [
    ...(scope.project !== undefined ? ["--project"] : []),
    ...(scope.branch !== undefined ? ["--branch"] : []),
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
  address: NodeAddress,
  signal: AbortSignal,
): Promise<AddressedProject> {
  const projects = await listAllPages<LogicalRow>(
    "Failed to look up the app's Project",
    (cursor) =>
      api.GET("/v1/projects", {
        params: { query: { logicalId: address.appName, cursor } },
        signal,
      }),
  );
  const matches = projects.filter(
    (project) => project.logicalId === address.appName,
  );
  if (matches.length > 1) {
    throw new CliStructuredError(
      "ADDRESS.AMBIGUOUS",
      `Several Projects are named "${address.appName}"`,
      {
        why: `"${address.text}" names app "${address.appName}", and more than one Project in this workspace has it.`,
        meta: {
          address: address.text,
          projectIds: matches.map((project) => project.id),
        },
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
      `No Project for app "${address.appName}"`,
      {
        why: `"${address.text}" names app "${address.appName}", and no Project in this workspace was deployed for it.`,
        meta: { address: address.text, app: address.appName },
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

interface BranchRow {
  readonly id: string;
  readonly gitName: string;
  readonly isDefault: boolean;
}

async function findBranch(
  api: Api,
  address: NodeAddress,
  project: AddressedProject,
  signal: AbortSignal,
): Promise<AddressedBranch> {
  const branches = await listAllPages<BranchRow>(
    "Failed to list the Project's branches",
    (cursor) =>
      api.GET("/v1/projects/{projectId}/branches", {
        params: { path: { projectId: project.id }, query: { cursor } },
        signal,
      }),
  );
  const environment = address.environment ?? PRODUCTION_ENVIRONMENT;
  const branch =
    environment === PRODUCTION_ENVIRONMENT
      ? branches.find((candidate) => candidate.isDefault)
      : branches.find((candidate) => candidate.gitName === environment);
  if (branch === undefined) {
    const listCommand = `${BRANCH_LIST_COMMAND} --project ${project.id}`;
    throw new CliStructuredError(
      "ADDRESS.NOT_FOUND",
      `No branch for environment "${environment}"`,
      {
        why:
          environment === PRODUCTION_ENVIRONMENT
            ? `Project "${project.name}" (${project.id}) has no default branch, which is where production lives.`
            : `Project "${project.name}" (${project.id}) has no branch whose git name is "${environment}".`,
        meta: {
          address: address.text,
          environment,
          projectId: project.id,
        },
        nextActions: [
          userChoice("Use an environment from the Project's branch list."),
          runCommand(listCommand),
        ],
      },
    );
  }
  return { id: branch.id, gitName: branch.gitName };
}

async function listNodes(
  api: Api,
  kind: NodeKind,
  address: NodeAddress,
  project: AddressedProject,
  branch: AddressedBranch,
  signal: AbortSignal,
): Promise<LogicalRow[]> {
  const filters = {
    projectId: project.id,
    logicalId: address.address,
    branchId: branch.id,
  };
  const summary = `Failed to look up ${kind}s by address`;
  const rows = await listAllPages<LogicalRow & { branchId: string | null }>(
    summary,
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
    (row) => row.logicalId === address.address && row.branchId === branch.id,
  );
}

function malformedAddressError(
  subject: string,
  why: string,
): CliStructuredError {
  return new CliStructuredError(
    "ADDRESS.USAGE_ERROR",
    `"${subject}" is not a valid address`,
    {
      why: `${why} An address is @<address> for production, or @<environment>:<address>, such as @shop.api or @pr-42:shop.api.`,
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

function projectEnvironmentError(address: NodeAddress): CliStructuredError {
  const projectAddress = `@${address.appName}`;
  return new CliStructuredError(
    "ADDRESS.WRONG_KIND",
    `"${address.text}" names one environment, not a Project`,
    {
      why: `A Project spans every environment of app "${address.appName}", so its address carries none. Write ${projectAddress}.`,
      meta: { address: address.text, expected: "project" },
      nextActions: [userChoice(`Pass ${projectAddress} to name the Project.`)],
    },
  );
}

function projectNodeAddressError(address: NodeAddress): CliStructuredError {
  const projectAddress = `@${address.appName}`;
  return new CliStructuredError(
    "ADDRESS.WRONG_KIND",
    `"${address.text}" names a node inside app "${address.appName}", not its Project`,
    {
      why: `A Project's address is the app name alone, ${projectAddress}. "${address.address}" names a service, database or bucket inside it.`,
      meta: { address: address.text, expected: "project" },
      nextActions: [
        userChoice(
          `Pass ${projectAddress} to name the Project, or use a service, postgres or bucket command for "${address.text}".`,
        ),
      ],
    },
  );
}

function addressNamesProjectError(
  address: NodeAddress,
  kind: NodeKind,
): CliStructuredError {
  const projectCommand = `${CLI_NAME} project show @${address.appName}`;
  return new CliStructuredError(
    "ADDRESS.WRONG_KIND",
    `"${address.text}" names the app's Project, not a ${kind}`,
    {
      why: `The app name alone, "${address.appName}", is the Project's address. A ${kind}'s address continues past it, such as @${address.appName}.<name>.`,
      meta: { address: address.text, expected: kind, actual: "project" },
      nextActions: [
        userChoice(`Name the ${kind} inside the app, or inspect the Project.`),
        runCommand(projectCommand),
      ],
    },
  );
}

function wrongKindError(
  address: NodeAddress,
  expected: NodeKind,
  actual: NodeKind,
): CliStructuredError {
  const command = `${CLI_NAME} ${KIND_GROUP[actual]} --help`;
  return new CliStructuredError(
    "ADDRESS.WRONG_KIND",
    `"${address.text}" is a ${actual}, not a ${expected}`,
    {
      why: `The address names a ${actual}. The ${KIND_GROUP[actual]} commands act on it.`,
      meta: { address: address.text, expected, actual },
      nextActions: [
        userChoice(
          `Use a '${CLI_NAME} ${KIND_GROUP[actual]}' command for ${formatCommandArgument(address.text)}.`,
        ),
        runCommand(command),
      ],
    },
  );
}

function nodeNotFoundError(
  address: NodeAddress,
  kind: NodeKind,
  project: AddressedProject,
  branch: AddressedBranch,
): CliStructuredError {
  return new CliStructuredError(
    "ADDRESS.NOT_FOUND",
    `Nothing is deployed at "${address.text}"`,
    {
      why: `No service, database or bucket on branch "${branch.gitName}" of Project "${project.name}" (${project.id}) has address "${address.address}".`,
      meta: {
        address: address.text,
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

function ambiguousError(
  address: NodeAddress,
  kind: NodeKind,
  rows: readonly LogicalRow[],
): CliStructuredError {
  return new CliStructuredError(
    "ADDRESS.AMBIGUOUS",
    `Several ${kind} rows have address "${address.text}"`,
    {
      why: `More than one ${kind} on the branch carries address "${address.address}", so the address does not pick one.`,
      meta: {
        address: address.text,
        matches: rows.map((row) => ({ id: row.id, name: row.name })),
      },
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
