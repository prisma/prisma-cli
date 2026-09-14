import { type CommandFamily, defineCommandFamily } from "@prisma/cli-engine";
import { DOCS_ERRORS_BASE_URL } from "../../cli-name";
import { skillsConfigSection } from "./config";
import { skillsListCommand } from "./list";
import { skillsSyncCommand } from "./sync";

/** Skill delivery is product-agnostic — the same two commands serve the
 *  ORM's skills and Composer's — so it is its own family rather than
 *  part of either product's. */
export const skillsCommandFamily: CommandFamily = defineCommandFamily({
  configSection: skillsConfigSection,
  docsBaseUrl: DOCS_ERRORS_BASE_URL,
  commands: {
    sync: skillsSyncCommand,
    list: skillsListCommand,
  },
});
