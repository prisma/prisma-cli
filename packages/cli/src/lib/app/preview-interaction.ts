import type { DeployInteraction, RegionInfo, ServiceInfo } from "@prisma/compute-sdk";

import { selectPrompt, textPrompt } from "../../shell/prompt";
import type { CommandContext } from "../../shell/runtime";

const CREATE_NEW_APP = "__create_new_app__";
export const PREVIEW_DEFAULT_REGION = "eu-central-1";

export function createPreviewDeployInteraction(context: CommandContext): DeployInteraction {
  return {
    async selectService(services: ServiceInfo[]): Promise<string | null> {
      const sorted = services
        .slice()
        .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));

      const selection = await selectPrompt<string | null>({
        input: context.runtime.stdin,
        output: context.runtime.stderr,
        message: "Select an app",
        choices: [
          ...sorted.map((service) => ({
            label: service.name,
            value: service.id as string | null,
          })),
          {
            label: "Create a new app",
            value: CREATE_NEW_APP as string | null,
          },
        ],
      });

      return selection === CREATE_NEW_APP ? null : selection;
    },
    async provideServiceName(): Promise<string> {
      return textPrompt({
        input: context.runtime.stdin,
        output: context.runtime.stderr,
        message: "App name",
        placeholder: "hello-world",
        validate: (value) => (!value?.trim() ? "App name is required" : undefined),
      }).then((value) => value.trim());
    },
    async selectRegion(_regions: RegionInfo[]): Promise<string> {
      return PREVIEW_DEFAULT_REGION;
    },
  };
}
