import { afterEach, describe, expect, it } from "vitest";

import { fetchSessionMetadata } from "../src/auth/session-metadata";
import {
  FAKE_WORKSPACE_API_ID,
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
  it("resolves the workspace name and authorizing account in one request", async () => {
    api = await startFakeManagementApi();

    const metadata = await fetchSessionMetadata(api.baseUrl)(CREDENTIAL);

    expect(metadata).toEqual({
      workspaceName: "Acme Inc",
      identity: {
        userId: "usr_456",
        email: "dev@example.com",
        name: "Dev",
      },
    });
    expect(api.requests).toEqual(["GET /v1/me"]);
  });

  it("keeps the workspace name when a service credential has no user", async () => {
    api = await startFakeManagementApi({
      routes: {
        "GET /v1/me": () => ({
          data: {
            user: null,
            workspace: { id: FAKE_WORKSPACE_API_ID, name: "Acme Inc" },
            credential: { type: "service", id: "skey_123", name: "CI" },
          },
        }),
      },
    });

    expect(await fetchSessionMetadata(api.baseUrl)(CREDENTIAL)).toEqual({
      workspaceName: "Acme Inc",
      identity: undefined,
    });
    expect(api.requests).toEqual(["GET /v1/me"]);
  });
});
