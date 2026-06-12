import type { AppDeployAllResult, AppDeployResult } from "../../src/types/app";

/**
 * Narrows a deploy result to the single-app shape; throws on deploy-all.
 * Only type-only src imports here, so test files can import this statically
 * without loading the CLI module graph before vi.doMock calls apply.
 */
export function asSingleDeployResult<T extends { result: AppDeployResult | AppDeployAllResult }>(
  success: T,
): T & { result: AppDeployResult } {
  if ("deployments" in success.result) {
    throw new Error("Expected a single-app deploy result, got a deploy-all result.");
  }
  return success as T & { result: AppDeployResult };
}
