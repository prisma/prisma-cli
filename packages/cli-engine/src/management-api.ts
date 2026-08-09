import type { ManagementApiClient as SdkClient } from "@prisma/management-api-sdk";

/**
 * The SDK's typed client, re-exported so consumers never import
 * @prisma/management-api-sdk directly.
 */
export type ManagementApiClient = SdkClient;
