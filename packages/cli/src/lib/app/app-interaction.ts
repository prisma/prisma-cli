import type {
  AppInfo,
  DeployInteraction,
  RegionInfo,
} from "@prisma/compute-sdk";

import { selectPrompt, textPrompt } from "../../shell/prompt";
import type { CommandContext } from "../../shell/runtime";

const CREATE_NEW_APP = "__create_new_app__";
export const DEFAULT_REGION = "eu-central-1";

export function createDeployInteraction(
  context: CommandContext,
): DeployInteraction {
  return {
    async selectApp(apps: AppInfo[]): Promise<string | null> {
      const sorted = apps
        .slice()
        .sort(
          (left, right) =>
            left.name.localeCompare(right.name) ||
            left.id.localeCompare(right.id),
        );

      const selection = await selectPrompt<string | null>({
        input: context.runtime.stdin,
        output: context.runtime.stderr,
        message: "Select an app",
        choices: [
          ...sorted.map((app) => ({
            label: app.name,
            value: app.id as string | null,
          })),
          {
            label: "Create a new app",
            value: CREATE_NEW_APP as string | null,
          },
        ],
      });

      return selection === CREATE_NEW_APP ? null : selection;
    },
    async provideAppName(): Promise<string> {
      return textPrompt({
        input: context.runtime.stdin,
        output: context.runtime.stderr,
        message: "App name",
        validate: (value) =>
          !value?.trim() ? "App name is required" : undefined,
      }).then((value) => value.trim());
    },
    async selectRegion(_regions: RegionInfo[]): Promise<string> {
      return DEFAULT_REGION;
    },
  };
}
