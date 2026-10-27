/**
 * The listings address resolution reads, answered the way the Management
 * API filters them: `/v1/projects` by `logicalId`, a Project's branches
 * by `gitName`,
 * and `/v1/services`, `/v1/databases`, `/v1/buckets` by `projectId`,
 * `logicalId` and `branchId`.
 */

export interface FakeRow {
  readonly id: string;
  readonly name: string;
  readonly projectId: string;
  readonly branchId: string | null;
  readonly logicalId: string | null;
}

export interface FakeProjectRow {
  readonly id: string;
  readonly name: string;
  readonly logicalId: string | null;
  readonly workspace: { readonly id: string; readonly name: string };
}

export interface FakeBranchRow {
  readonly id: string;
  readonly gitName: string;
  readonly isDefault: boolean;
  readonly role: "production" | "preview";
}

export interface AddressFixture {
  readonly projects: readonly FakeProjectRow[];
  readonly branches: Readonly<Record<string, readonly FakeBranchRow[]>>;
  readonly services?: readonly FakeRow[];
  readonly databases?: readonly FakeRow[];
  readonly buckets?: readonly FakeRow[];
}

export interface Page<T> {
  readonly data: readonly T[];
  readonly pagination: { readonly hasMore: false; readonly nextCursor: null };
}

function page<T>(data: readonly T[]): Page<T> {
  return { data, pagination: { hasMore: false, nextCursor: null } };
}

const ROW_PATHS = {
  "/v1/services": "services",
  "/v1/databases": "databases",
  "/v1/buckets": "buckets",
} as const;

/** The page the API would answer `GET <path>` with, or undefined for a
 *  path address resolution does not read. */
export function addressListing(
  fixture: AddressFixture,
  path: string,
  params: {
    readonly path?: Record<string, string>;
    readonly query?: Record<string, unknown>;
  } = {},
): Page<unknown> | undefined {
  const query = params.query ?? {};
  if (path === "/v1/projects") {
    return page(
      query.logicalId === undefined
        ? fixture.projects
        : fixture.projects.filter(
            (project) => project.logicalId === query.logicalId,
          ),
    );
  }
  if (path === "/v1/projects/{projectId}/branches") {
    const branches = fixture.branches[params.path?.projectId ?? ""] ?? [];
    return page(
      query.gitName === undefined
        ? branches
        : branches.filter((branch) => branch.gitName === query.gitName),
    );
  }
  if (path in ROW_PATHS) {
    const rows = fixture[ROW_PATHS[path as keyof typeof ROW_PATHS]] ?? [];
    return page(
      rows.filter(
        (row) =>
          (query.projectId === undefined ||
            row.projectId === query.projectId) &&
          (query.logicalId === undefined ||
            row.logicalId === query.logicalId) &&
          (query.branchId === undefined || row.branchId === query.branchId),
      ),
    );
  }
  return undefined;
}
