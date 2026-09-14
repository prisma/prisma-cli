/**
 * The git-connection flow's structured errors. The raise sites own their
 * `GIT.*` codes (see `controllers/project.ts`); this file holds only the
 * install-wait outcome, which picks between two of them.
 */

import type { CliStructuredError } from "@prisma/cli-engine/protocol";
import type { GitHubRepositoryReference } from "../../adapters/git";
import {
  repoInstallationRequiredError,
  repoNotAccessibleError,
} from "../../controllers/project";

/**
 * The install wait's two terminal outcomes: the workspace has an
 * inspectable installation that simply does not expose the repository,
 * or it has none at all.
 */
export function installWaitFailedError(
  repository: GitHubRepositoryReference,
  installUrl: string,
  inspectableInstallationCount: number,
): CliStructuredError {
  return inspectableInstallationCount > 0
    ? repoNotAccessibleError(repository, installUrl)
    : repoInstallationRequiredError(repository, installUrl);
}
