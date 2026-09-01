import {
  type AnyCommand,
  type Cli,
  type CommandFamily,
  createCli,
  defineCommandFamily,
  telemetryCommandGroup,
  type WorkflowStep,
} from "@prisma/cli-engine";
import { createComposerFamily } from "@prisma/composer-cli/family";
import { ormCommandFamily as ormToolchainFamily } from "@prisma/orm-toolchain/cli";
import { CLI_DOCS_URL, CLI_NAME, DOCS_ERRORS_BASE_URL } from "./cli-name";
import { authLoginCommand } from "./commands/auth/login";
import { authLogoutCommand } from "./commands/auth/logout";
import { authWhoamiCommand } from "./commands/auth/whoami";
import { authWorkspaceListCommand } from "./commands/auth/workspace-list";
import { authWorkspaceLogoutCommand } from "./commands/auth/workspace-logout";
import { authWorkspaceUseCommand } from "./commands/auth/workspace-use";
import { branchListCommand } from "./commands/branch/list";
import { bucketCreateCommand } from "./commands/bucket/create";
import { bucketDeleteCommand } from "./commands/bucket/delete";
import { bucketKeyCreateCommand } from "./commands/bucket/key-create";
import { bucketKeyDeleteCommand } from "./commands/bucket/key-delete";
import { bucketKeyListCommand } from "./commands/bucket/key-list";
import { bucketListCommand } from "./commands/bucket/list";
import { feedbackCommand } from "./commands/feedback";
import { gitConnectCommand } from "./commands/git/connect";
import { gitDisconnectCommand } from "./commands/git/disconnect";
import { initCommand } from "./commands/init";
import { postgresBackupListCommand } from "./commands/postgres/backup-list";
import { postgresBackupRestoreCommand } from "./commands/postgres/backup-restore";
import { postgresConnectionCreateCommand } from "./commands/postgres/connection-create";
import { postgresConnectionDeleteCommand } from "./commands/postgres/connection-delete";
import { postgresConnectionListCommand } from "./commands/postgres/connection-list";
import { postgresConnectionRotateCommand } from "./commands/postgres/connection-rotate";
import { postgresCreateCommand } from "./commands/postgres/create";
import { postgresDeleteCommand } from "./commands/postgres/delete";
import { postgresListCommand } from "./commands/postgres/list";
import { postgresShowCommand } from "./commands/postgres/show";
import { postgresUsageCommand } from "./commands/postgres/usage";
import { projectCreateCommand } from "./commands/project/create";
import { projectDeleteCommand } from "./commands/project/delete";
import { projectEnvAddCommand } from "./commands/project/env-add";
import { projectEnvDeleteCommand } from "./commands/project/env-delete";
import { projectEnvListCommand } from "./commands/project/env-list";
import { projectEnvUpdateCommand } from "./commands/project/env-update";
import { projectLinkCommand } from "./commands/project/link";
import { projectListCommand } from "./commands/project/list";
import { projectRenameCommand } from "./commands/project/rename";
import { projectShowCommand } from "./commands/project/show";
import { projectTransferCommand } from "./commands/project/transfer";
import { serviceCreateCommand } from "./commands/service/create";
import { serviceDeleteCommand } from "./commands/service/delete";
import { serviceDomainAddCommand } from "./commands/service/domain-add";
import { serviceDomainDeleteCommand } from "./commands/service/domain-delete";
import { serviceDomainRetryCommand } from "./commands/service/domain-retry";
import { serviceDomainShowCommand } from "./commands/service/domain-show";
import { serviceDomainWaitCommand } from "./commands/service/domain-wait";
import { serviceListCommand } from "./commands/service/list";
import { serviceLogsCommand } from "./commands/service/logs";
import { serviceOpenCommand } from "./commands/service/open";
import { serviceShowCommand } from "./commands/service/show";
import { serviceVersionDeleteCommand } from "./commands/service/version-delete";
import { serviceVersionListCommand } from "./commands/service/version-list";
import { serviceVersionPromoteCommand } from "./commands/service/version-promote";
import { serviceVersionRollbackCommand } from "./commands/service/version-rollback";
import { serviceVersionShowCommand } from "./commands/service/version-show";
import { serviceVersionStartCommand } from "./commands/service/version-start";
import { serviceVersionStopCommand } from "./commands/service/version-stop";
import { skillsCommandFamily } from "./commands/skills/family";
import { getCliVersion } from "./lib/version";

export const platformCommandFamily: CommandFamily = defineCommandFamily({
  docsBaseUrl: DOCS_ERRORS_BASE_URL,
  commands: {
    login: authLoginCommand,
    logout: authLogoutCommand,
    whoami: authWhoamiCommand,
    workspaceList: authWorkspaceListCommand,
    workspaceUse: authWorkspaceUseCommand,
    workspaceLogout: authWorkspaceLogoutCommand,
    projectList: projectListCommand,
    projectShow: projectShowCommand,
    projectCreate: projectCreateCommand,
    projectLink: projectLinkCommand,
    projectRename: projectRenameCommand,
    projectDelete: projectDeleteCommand,
    projectTransfer: projectTransferCommand,
    projectEnvAdd: projectEnvAddCommand,
    projectEnvUpdate: projectEnvUpdateCommand,
    projectEnvList: projectEnvListCommand,
    projectEnvDelete: projectEnvDeleteCommand,
    postgresList: postgresListCommand,
    postgresShow: postgresShowCommand,
    postgresCreate: postgresCreateCommand,
    postgresUsage: postgresUsageCommand,
    postgresBackupRestore: postgresBackupRestoreCommand,
    postgresDelete: postgresDeleteCommand,
    postgresBackupList: postgresBackupListCommand,
    postgresConnectionList: postgresConnectionListCommand,
    postgresConnectionCreate: postgresConnectionCreateCommand,
    postgresConnectionRotate: postgresConnectionRotateCommand,
    postgresConnectionDelete: postgresConnectionDeleteCommand,
    bucketList: bucketListCommand,
    bucketCreate: bucketCreateCommand,
    bucketDelete: bucketDeleteCommand,
    bucketKeyList: bucketKeyListCommand,
    bucketKeyCreate: bucketKeyCreateCommand,
    bucketKeyDelete: bucketKeyDeleteCommand,
    branchList: branchListCommand,
    gitConnect: gitConnectCommand,
    gitDisconnect: gitDisconnectCommand,
    serviceList: serviceListCommand,
    serviceLogs: serviceLogsCommand,
    serviceCreate: serviceCreateCommand,
    serviceShow: serviceShowCommand,
    serviceOpen: serviceOpenCommand,
    serviceVersionList: serviceVersionListCommand,
    serviceVersionShow: serviceVersionShowCommand,
    serviceVersionPromote: serviceVersionPromoteCommand,
    serviceVersionRollback: serviceVersionRollbackCommand,
    serviceVersionStart: serviceVersionStartCommand,
    serviceVersionStop: serviceVersionStopCommand,
    serviceVersionDelete: serviceVersionDeleteCommand,
    serviceDelete: serviceDeleteCommand,
    serviceDomainAdd: serviceDomainAddCommand,
    serviceDomainShow: serviceDomainShowCommand,
    serviceDomainDelete: serviceDomainDeleteCommand,
    serviceDomainRetry: serviceDomainRetryCommand,
    serviceDomainWait: serviceDomainWaitCommand,
  },
});

/**
 * Composer's commands, contributed by composer's own package and run by
 * this process, mounted as shipped. Only the command definitions and
 * their handler entry functions load here; the alchemy and effect
 * constellation stays behind composer's dynamic executor imports, so
 * mounting costs an unrelated command nothing.
 */
export const composerCommandFamily: CommandFamily = createComposerFamily();

/**
 * The ORM commands, contributed by orm-toolchain's own package, mounted
 * as shipped: the family keys are the mount paths, so the shell adds
 * nothing. The family object carries its `orm` config section, its docs
 * base and its redirect table. Unlike composer's, this family's entry
 * module imports esbuild and arktype statically, so every invocation of
 * this bin pays that import; fixing that is orm-toolchain's move.
 */
export const ormCommandFamily: CommandFamily = ormToolchainFamily;

/**
 * Skill delivery for AI coding agents: one pair of commands for every
 * product, defined in this package because the skills travel in the
 * product packages and only the shell sees all of them.
 */
export { skillsCommandFamily };

/** The engine ships the three telemetry commands and the group help
 *  text that belongs to them; both halves are spread in below. */
const telemetry = telemetryCommandGroup({ docsUrl: CLI_DOCS_URL });

export const cliGroups: Readonly<
  Record<
    string,
    {
      brief: string;
      description?: string;
      workflow?: readonly WorkflowStep[];
    }
  >
> = {
  auth: {
    brief:
      "Manage authentication for the Prisma Platform. Sign in and out, inspect identity, switch workspaces",
    description:
      "Signing in opens a browser flow and stores a session for one workspace: the account-level container that holds your Projects, members, and billing. Commands act on the current session's workspace; log in once per workspace and switch with the 'workspace' subcommands. A PRISMA_SERVICE_TOKEN environment credential overrides stored sessions, which is the way to authenticate CI.",
  },
  project: {
    brief:
      "Manage Prisma Platform projects. CRUD, link a directory, transfer ownership, manage environment variables",
    description:
      "A Project groups one product or codebase. It is the child of a workspace and the parent of Branches: isolated environments, one per Git branch, each holding its own services, databases, and buckets. 'Linking' connects a local directory to a Project: the link is stored locally, and every project-scoped command run in that directory targets the linked project unless --project names another. 'create' links automatically; 'link' points a directory at an existing Project; 'show' reports the link.",
    workflow: [
      {
        run: "project create my-app",
        brief: "Create a Project, link this directory",
      },
      { run: "git connect", brief: "Connect GitHub so every push deploys" },
      {
        run: "project env add KEY=value --role preview",
        brief: "Set env vars services get at deploy",
      },
    ],
  },
  "project env": {
    brief:
      "Manage a project's environment variables. Add, update, list, and delete values per scope",
    description:
      "Variables live in scopes: production, preview (shared by every preview branch), or a single branch's override. Values reach services when they deploy, and are write-only afterwards: list shows metadata, never values.",
  },
  postgres: {
    brief:
      "Manage Prisma Postgres databases. CRUD, usage metrics, backups, and connection credentials",
    description:
      "Databases are branch-bound: each belongs to a Branch, the isolated environment for one Git branch of a project, so commands take --branch to target one. Address a database by its id (db_...) or name. Connection URLs are secrets that print exactly once, at create or rotate; nothing shows them again. 'backup' restores platform-taken backups, and 'connection' manages per-consumer credentials.",
    workflow: [
      {
        run: "postgres create app-db",
        brief: "Create a database; its URL prints once",
      },
      {
        run: "postgres connection create app-db --name ci",
        brief: "Mint one credential per consumer",
      },
      {
        run: "postgres connection rotate conn_123",
        brief: "Replace a leaked credential",
      },
    ],
  },
  "postgres backup": {
    brief:
      "Inspect and restore database backups. The platform takes them automatically",
    description:
      "The platform takes backups automatically; there is no backup-create command. Restore replaces a database's current state with a backup's contents after exact id confirmation.",
  },
  "postgres connection": {
    brief:
      "Manage database connection credentials. Create, rotate, and revoke per-consumer connection URLs",
    description:
      "A connection is one independent credential (a connection URL) for one database. Give each consumer (an app, CI, a teammate) its own, so one can be rotated or revoked without breaking the others. URLs print once, at create or rotate; list shows metadata only.",
  },
  bucket: {
    brief:
      "Manage S3-compatible object-store buckets for a project. CRUD operations and access keys",
    description:
      "A bucket is blob storage for files and uploads, bound to one Branch of a project and reachable through the standard S3 API. Access goes through S3-compatible keys minted per consumer with 'bucket key create', which prints credentials (endpoint, key id, secret) exactly once.",
    workflow: [
      {
        run: "bucket create --name uploads",
        brief: "Create a bucket in the branch",
      },
      {
        run: "bucket key create bkt_123",
        brief: "Mint S3 credentials, shown once",
      },
    ],
  },
  "bucket key": {
    brief:
      "Manage a bucket's access keys. Create, list, and revoke per-consumer S3 credentials",
    description:
      "A key is one consumer's S3-compatible credentials for one bucket, with role read or read_write. Secrets print once at create; delete revokes access immediately.",
  },
  branch: {
    brief:
      "View Platform branches: the isolated environment behind each Git branch",
    description:
      "A Branch maps to a Git branch of the connected repository. Each is an isolated environment with its own services, databases, buckets, and environment variables: the production branch serves live traffic, every other branch is a preview.",
  },
  git: {
    brief:
      "Manage the GitHub connection that deploys on push. Connect or disconnect a repository",
    description:
      "Connecting a GitHub repository turns on deploy-on-push: pushing a Git branch builds and deploys it to a matching Platform Branch. Disconnecting stops push deploys without touching anything already deployed.",
  },
  service: {
    brief:
      "Manage deployed services. Logs, versions, promote and rollback releases, custom domains",
    description:
      "A service is one HTTP application (a frontend or a backend) deployed on a Branch. Every deploy produces an immutable service version; at most one serves traffic at a time. The 'version' subcommands move which one that is: promote releases a preview build into production, rollback returns production to a previous version without rebuilding. 'logs' reads and streams output, and 'domain' attaches hostnames you own.",
    workflow: [
      {
        run: "service logs my-api --follow",
        brief: "Stream the live version's logs",
      },
      {
        run: "service version promote cpv_123",
        brief: "Release a preview build to production",
      },
      {
        run: "service version rollback my-api",
        brief: "Put production back on the previous version",
      },
    ],
  },
  "service domain": {
    brief:
      "Manage custom domains for a service. Register hostnames, drive DNS and TLS verification, inspect status",
    description:
      "Custom domains point hostnames you own at a service's production branch. After add, create the DNS record the platform reports; wait and retry drive DNS verification and TLS provisioning to done.",
    workflow: [
      {
        run: "service domain add shop.acme.com --service my-api",
        brief: "Register the hostname",
      },
      {
        run: "service domain wait shop.acme.com --service my-api",
        brief: "Block until active or failed",
      },
      {
        run: "service domain show shop.acme.com --service my-api",
        brief: "Inspect status and certificate",
      },
    ],
  },
  "service version": {
    brief:
      "Manage a service's deploy versions. List, inspect, promote, roll back, start, stop, delete",
    description:
      "Every deploy produces an immutable version; at most one serves traffic at a time on each branch. List and show inspect them. Promote and rollback choose which version serves traffic; start, stop, and delete drive one version's lifecycle.",
  },
  "auth workspace": {
    brief:
      "Manage stored workspace sessions. List them, switch the current one, end one",
    description:
      "One session is stored per workspace you log in to. List them, switch the current one, or end one without touching the others.",
  },
  contract: {
    brief:
      "Author your data contract: the PSL source of your data model. Emit, infer, format",
    description:
      "A contract is the declarative description of your application's data model, authored in PSL (Prisma Schema Language). Migrations are planned from it, and live databases are verified and signed against it. Emit generates its artifacts, infer derives a contract from an existing database, and format normalizes the source.",
  },
  db: {
    brief:
      "Run contract operations against a live database. Verify, sign, update, migrate",
    description:
      "These commands run against a live database, addressed with --db <url>. Verify checks the database against the contract (the PSL description of your data model), sign marks it as matching, and update and migrate advance its schema.",
  },
  migration: {
    brief:
      "Manage on-disk migrations derived from contract changes. Plan, inspect, check, track history",
    description:
      "A migration is an on-disk package describing one schema change, derived from edits to your contract (the PSL description of your data model). Plan writes one; the rest inspect, check integrity, and track what has run where. Apply them with 'db migrate'.",
  },
  "migration ref": {
    brief: "Manage refs: named pointers to contracts. Set, list, delete",
    description:
      "A ref is a named pointer to a contract, letting commands target a contract by a stable name. Set, list, and delete refs here.",
  },
  orm: { brief: "Initialize a Prisma ORM project" },
  skills: {
    brief:
      "Manage Prisma skills for AI coding agents. Sync and list the instruction files",
    description:
      "Agent skills are instruction files that teach AI coding agents (Claude Code, Cursor, and others) how to use the installed Prisma packages. They ship inside the packages; sync copies them into the directories the agent harnesses read.",
  },
  ...telemetry.groups,
};

export const mountedCommands: Readonly<Record<string, AnyCommand>> = {
  "auth login": authLoginCommand,
  "auth logout": authLogoutCommand,
  "auth whoami": authWhoamiCommand,
  "auth workspace list": authWorkspaceListCommand,
  "auth workspace use": authWorkspaceUseCommand,
  "auth workspace logout": authWorkspaceLogoutCommand,
  "project list": projectListCommand,
  "project show": projectShowCommand,
  "project create": projectCreateCommand,
  "project link": projectLinkCommand,
  "project rename": projectRenameCommand,
  "project delete": projectDeleteCommand,
  "project transfer": projectTransferCommand,
  "project env add": projectEnvAddCommand,
  "project env update": projectEnvUpdateCommand,
  "project env list": projectEnvListCommand,
  "project env delete": projectEnvDeleteCommand,
  "postgres list": postgresListCommand,
  "postgres show": postgresShowCommand,
  "postgres create": postgresCreateCommand,
  "postgres usage": postgresUsageCommand,
  "postgres delete": postgresDeleteCommand,
  "postgres backup list": postgresBackupListCommand,
  "postgres backup restore": postgresBackupRestoreCommand,
  "postgres connection list": postgresConnectionListCommand,
  "postgres connection create": postgresConnectionCreateCommand,
  "postgres connection rotate": postgresConnectionRotateCommand,
  "postgres connection delete": postgresConnectionDeleteCommand,
  "bucket list": bucketListCommand,
  "bucket create": bucketCreateCommand,
  "bucket delete": bucketDeleteCommand,
  "bucket key list": bucketKeyListCommand,
  "bucket key create": bucketKeyCreateCommand,
  "bucket key delete": bucketKeyDeleteCommand,
  "branch list": branchListCommand,
  "git connect": gitConnectCommand,
  "git disconnect": gitDisconnectCommand,
  "service list": serviceListCommand,
  "service logs": serviceLogsCommand,
  "service create": serviceCreateCommand,
  "service show": serviceShowCommand,
  "service open": serviceOpenCommand,
  "service version list": serviceVersionListCommand,
  "service version show": serviceVersionShowCommand,
  "service version promote": serviceVersionPromoteCommand,
  "service version rollback": serviceVersionRollbackCommand,
  "service version start": serviceVersionStartCommand,
  "service version stop": serviceVersionStopCommand,
  "service version delete": serviceVersionDeleteCommand,
  "service delete": serviceDeleteCommand,
  "service domain add": serviceDomainAddCommand,
  "service domain show": serviceDomainShowCommand,
  "service domain delete": serviceDomainDeleteCommand,
  "service domain retry": serviceDomainRetryCommand,
  "service domain wait": serviceDomainWaitCommand,
  // Composer's two product verbs, mounted at the root.
  deploy: composerCommandFamily.commands.deploy,
  dev: composerCommandFamily.commands.dev,
  // The ORM family. Written out per path: the shell owns the tree
  // (R12), so this map — not the family's own keying — is the source of
  // truth for where each command mounts.
  "contract emit": ormCommandFamily.commands["contract emit"],
  "contract infer": ormCommandFamily.commands["contract infer"],
  "db init": ormCommandFamily.commands["db init"],
  "db schema": ormCommandFamily.commands["db schema"],
  "db sign": ormCommandFamily.commands["db sign"],
  "db update": ormCommandFamily.commands["db update"],
  "db verify": ormCommandFamily.commands["db verify"],
  "db migrate": ormCommandFamily.commands["db migrate"],
  "contract format": ormCommandFamily.commands["contract format"],
  // `orm init` keeps this path: only the top-level `init` (the compute
  // config wizard) was removed, by the 2026-08-21 PM review.
  "orm init": ormCommandFamily.commands["orm init"],
  lsp: ormCommandFamily.commands.lsp,
  "migration check": ormCommandFamily.commands["migration check"],
  "migration graph": ormCommandFamily.commands["migration graph"],
  "migration list": ormCommandFamily.commands["migration list"],
  "migration log": ormCommandFamily.commands["migration log"],
  "migration new": ormCommandFamily.commands["migration new"],
  "migration plan": ormCommandFamily.commands["migration plan"],
  "migration show": ormCommandFamily.commands["migration show"],
  "migration status": ormCommandFamily.commands["migration status"],
  "migration ref delete": ormCommandFamily.commands["migration ref delete"],
  "migration ref list": ormCommandFamily.commands["migration ref list"],
  "migration ref set": ormCommandFamily.commands["migration ref set"],
  // Local utilities: no owning package, no config section, no API.
  init: initCommand,
  "skills sync": skillsCommandFamily.commands.sync,
  "skills list": skillsCommandFamily.commands.list,
  feedback: feedbackCommand,
  // The engine's consent surface, mounted whole (no command family).
  ...telemetry.commands,
};

export function buildCli(): Cli {
  return createCli({
    name: CLI_NAME,
    version: getCliVersion(),
    commandFamilies: [
      platformCommandFamily,
      composerCommandFamily,
      ormCommandFamily,
      skillsCommandFamily,
    ],
    groups: cliGroups,
    commands: mountedCommands,
    help: {
      tagline: "The Prisma Developer Platform, from your terminal",
      description:
        "Deploy your app with isolated infrastructure for every branch: a Project groups one product, and each of its Branches maps to a Git branch with its own services, databases, and buckets. The production branch serves live traffic; every other branch is a preview.",
      workflow: [
        { run: "auth login", brief: "Sign in to your Prisma workspace" },
        {
          run: "project create my-app",
          brief: "Create a Project, link this directory",
        },
        { run: "git connect", brief: "Connect GitHub so every push deploys" },
        {
          run: "deploy",
          brief: "Or build and deploy straight from this machine",
        },
      ],
      examples: ["auth login", "project list", "deploy"],
      docsUrl: CLI_DOCS_URL,
    },
    telemetry: { docsUrl: CLI_DOCS_URL },
  });
}
