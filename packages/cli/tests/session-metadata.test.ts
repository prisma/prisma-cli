import { afterEach, describe, expect, it } from "vitest";

import {
  fetchSessionIdentity,
  fetchWorkspaceName,
} from "../src/auth/session-metadata";
import {
  FAKE_WORKSPACE_ID,
  type FakeManagementApi,
  startFakeManagementApi,
} from "./helpers/fake-management-api";

const CREDENTIAL = {
  token: "test-access-token",
  refreshToken: undefined,
  expiresAt: undefined,
};

let api: FakeManagementApi | undefined;

afterEach(async () => {
  await api?.close();
  api = undefined;
});

describe("login session metadata", () => {
  it("resolves the workspace name and authorizing account through the API", async () => {
    api = await startFakeManagementApi();

    const [workspaceName, identity] = await Promise.all([
      fetchWorkspaceName(api.baseUrl)(CREDENTIAL, FAKE_WORKSPACE_ID),
      fetchSessionIdentity(api.baseUrl)(CREDENTIAL, FAKE_WORKSPACE_ID),
    ]);

    expect(workspaceName).toBe("Acme Inc");
    expect(identity).toEqual({
      userId: "usr_456",
      email: "dev@example.com",
      name: "Dev",
    });
    expect([...api.requests].sort()).toEqual(
      [`GET /v1/me`, `GET /v1/workspaces/${FAKE_WORKSPACE_ID}`].sort(),
    );
  });
});
