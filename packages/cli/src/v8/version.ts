import { defineCommand, type Presentations } from "@prisma/cli-engine";
import { CliStructuredError, ok } from "@prisma/cli-engine/protocol";
import { CLI_NAME } from "../cli-name";
import { readCliVersion } from "../lib/version";

const TITLE = "Showing CLI build and environment.";

export interface VersionResult {
  readonly cli: {
    readonly name: string;
    readonly version: string;
  };
  readonly node: {
    readonly version: string;
  };
  readonly os: {
    readonly platform: string;
    readonly arch: string;
  };
}

/** The host facts the command reports. Node's `process` satisfies it,
 *  and a test supplies its own. */
export interface VersionHost {
  readonly version: string;
  readonly platform: string;
  readonly arch: string;
}

export function versionUnavailableError(): CliStructuredError {
  return new CliStructuredError(
    "VERSION.UNAVAILABLE",
    "CLI version metadata is missing from the installed package.",
    {
      why: "The bundled package.json could not be read, or it contained no version field.",
      nextActions: [
        {
          kind: "user-choice",
          label:
            "Reinstall the CLI from the npm registry, or check that the install path is intact.",
        },
      ],
    },
  );
}

export function buildVersionResult(host: VersionHost): VersionResult {
  const version = readCliVersion();
  if (!version) {
    throw versionUnavailableError();
  }
  return {
    cli: { name: CLI_NAME, version },
    node: { version: host.version },
    os: { platform: host.platform, arch: host.arch },
  };
}

function fieldRows(
  result: VersionResult,
): ReadonlyArray<{ label: string; value: string }> {
  return [
    { label: result.cli.name, value: result.cli.version },
    { label: "node", value: result.node.version },
    { label: "os", value: `${result.os.platform} ${result.os.arch}` },
  ];
}

function presentationsFor(result: VersionResult): Presentations {
  const rows = fieldRows(result);
  return {
    human: () => [
      { kind: "summary", tone: "info", text: TITLE },
      { kind: "fields", rows },
    ],
    stdout: () => rows.map((row) => `${row.label}: ${row.value}`),
  };
}

export const versionCommand = defineCommand({
  help: {
    summary: "Show CLI build and environment",
    examples: ["version", "version --json"],
  },
  handler: async (_args, ctx) => {
    const result = buildVersionResult(process);
    return ok(ctx.present({ data: result }, presentationsFor(result)));
  },
});
