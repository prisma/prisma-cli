/** The `project create` command. */
import { defineCommand, flag, positional } from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { createAppProvider } from "../../lib/app/app-provider";
import {
  isValidProjectSetupName,
  projectCreateFailedError,
  projectSetupNameRequiredError,
} from "../../lib/project/setup";
import { resolveActiveWorkspace } from "../resources-shared/workspace";
import { bindDirectoryToProject } from "./context";
import { setupPresentations } from "./presentation";

export const projectCreateCommand = defineCommand({
  args: {
    positionals: {
      name: positional.string({
        brief: "Project name",
        placeholder: "name",
      }),
    },
    flags: {
      region: flag.string({
        brief:
          "Prisma Compute region for the project's infrastructure; set it when data or users must stay near a location",
        placeholder: "region",
      }),
    },
  },
  help: {
    summary:
      "Create a Project and link this directory: commands run here target it",
    description:
      "Creates a Project in your workspace and links the current directory to it, so later commands resolve it without --project. A Project groups one product or codebase; its Branches are isolated environments, each with its own services, databases, and buckets. This is usually the first command after 'auth login' in a new repository.",
    examples: ["project create my-app", "project create my-app --json"],
  },
  needs: { credentials: true },
  handler: async (args, ctx) => {
    const workspace = await resolveActiveWorkspace(ctx);
    if (!isValidProjectSetupName(args.positionals.name)) {
      throw projectSetupNameRequiredError("project create");
    }

    const name = args.positionals.name.trim();
    const created = await createAppProvider(ctx.api)
      .createProject({
        name,
        region: args.flags.region,
        signal: ctx.signal,
      })
      .catch((error: unknown) => {
        /** A cancelled run is cancelled, not a failed creation. The
         *  provider flattens the underlying AbortError into a plain
         *  Error, which the engine would settle as a bug, so hand it
         *  back its own abort reason and let it settle the run as
         *  cancelled. */
        if (ctx.signal.aborted) {
          throw ctx.signal.reason;
        }
        throw projectCreateFailedError(error, name, workspace, {
          nextSteps: [
            "prisma project list",
            "prisma project link <id-or-name>",
          ],
          permissionFix:
            "Grant the token permission to create Projects in this workspace, or link an existing Project.",
          fallbackFix:
            "Retry the command, or choose an existing Project with prisma project link <id-or-name>.",
        });
      });

    const result = await bindDirectoryToProject(
      ctx,
      workspace,
      {
        id: created.id,
        name: created.name,
        ...(created.defaultRegion != null
          ? { defaultRegion: created.defaultRegion }
          : {}),
      },
      "created",
    );
    return ok(ctx.present({ data: result }, setupPresentations(result)));
  },
});
