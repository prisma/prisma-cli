/**
 * Three help cards that together touch every element a card can carry:
 * a root with tagline, description, workflow, examples, and docs; a
 * group with a brief, description, and workflow; a leaf with every
 * positional and flag kind, examples, and a family docs base URL.
 */
import {
  defineCommand,
  defineCommandFamily,
  flag,
  positional,
} from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { createTestCli } from "@prisma/cli-engine/testing";

const presentNothing = {
  human: () => [],
  stdout: () => [],
  json: () => null,
  next: () => [],
};

const link = defineCommand({
  help: {
    summary: "Link this directory to a project",
    description:
      "Writes the project id into prisma.config.ts so later commands know which project you mean.\n\nRun it once per checkout. Re-running replaces the link.",
    examples: [
      "project link",
      '{bin} project link "Acme Dashboard" --region eu',
    ],
  },
  args: {
    positionals: {
      idOrName: positional.optionalString({
        brief: "The project id or its display name",
        placeholder: "id-or-name",
      }),
      tags: positional.variadic({
        brief: "Tags to record on the link",
        placeholder: "tag",
      }),
    },
    flags: {
      region: flag.string({
        brief: "Region to prefer",
        placeholder: "region",
        alias: "r",
        default: "us",
      }),
      workspace: flag.requiredString({
        brief: "Workspace the project lives in",
        placeholder: "workspace-id",
      }),
      force: flag.boolean({ brief: "Overwrite an existing link", alias: "f" }),
      confirmLink: flag.optionalBoolean({
        brief: "Confirm or skip the link prompt",
      }),
      mode: flag.enum({
        brief: "How to link",
        values: ["copy", "reference"],
        default: "copy",
      }),
      label: flag.repeated({
        brief: "Labels, a|b style",
        placeholder: "label",
      }),
      retries: flag.number({ brief: "How many attempts" }),
    },
  },
  handler: async (_args, ctx) =>
    ok(ctx.present({ data: null }, presentNothing)),
});

const list = defineCommand({
  help: { summary: "List projects in the workspace" },
  handler: async (_args, ctx) =>
    ok(ctx.present({ data: null }, presentNothing)),
});

const whoami = defineCommand({
  help: { summary: "Show who is signed in" },
  handler: async (_args, ctx) =>
    ok(ctx.present({ data: null }, presentNothing)),
});

const family = defineCommandFamily({
  commands: { link, list },
  docsBaseUrl: "https://pris.ly/cli/errors",
});

export function helpCardsCli() {
  return createTestCli({
    commandFamilies: [family],
    commands: { "project link": link, "project list": list, whoami },
    groups: {
      project: {
        brief: "Manage projects",
        description:
          "A project is a named container for databases and their settings.",
        workflow: [
          { run: "project link", brief: "Pick the project this checkout uses" },
          { run: "{bin} project list | head", brief: "See what else exists" },
        ],
      },
    },
    help: {
      tagline: "The Prisma test CLI",
      description:
        "Works against a workspace you are signed in to.\n\nEvery command prints Markdown with --format markdown.",
      workflow: [
        { run: "whoami", brief: "Check the session" },
        { run: "project link", brief: "Link a project" },
      ],
      examples: ["whoami", "{bin} project list --json"],
      docsUrl: "https://pris.ly/cli",
    },
    now: () => new Date(0),
  });
}
