import { flag, positional } from "@prisma/cli-engine";

/** The shared argument surface of every `service domain` command. */
export function domainTargetArgs() {
  return {
    flags: {
      service: flag.string({
        brief: "Service id or name the domain belongs to",
        placeholder: "name",
      }),
      project: flag.string({
        brief:
          "Project id or name (default: the project this directory is linked to)",
        placeholder: "id-or-name",
      }),
      branch: flag.string({
        brief: "Branch name",
        placeholder: "name",
      }),
    },
    positionals: {
      hostname: positional.string({
        brief: "Custom domain hostname",
        placeholder: "hostname",
      }),
    },
  };
}
