import events from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";

import {
  createManagementApiSdk,
  type ManagementApiSdk,
  type TokenStorage,
  AuthError as SDKAuthError,
} from "@prisma/management-api-sdk";
import open from "open";

import { CLIENT_ID, getApiBaseUrl } from "./client";
import { FileTokenStorage } from "../../adapters/token-storage";

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export interface LoginOptions {
  tokenStorage?: TokenStorage;
  clientId?: string;
  apiBaseUrl?: string;
  authBaseUrl?: string;
  hostname?: string;
  port?: number;
  openUrl?: (url: string) => Promise<unknown> | unknown;
  env?: NodeJS.ProcessEnv;
}

export async function login(options: LoginOptions = {}): Promise<void> {
  const hostname = options.hostname ?? "localhost";
  const port = options.port ?? 0;
  const server = http.createServer();
  server.listen({ host: hostname, port });

  try {
    const addressInfo = await events
      .once(server, "listening")
      .then(() => server.address() as AddressInfo);

    const state = new LoginState({
      hostname,
      port: addressInfo.port,
      tokenStorage: options.tokenStorage,
      clientId: options.clientId,
      apiBaseUrl: options.apiBaseUrl,
      authBaseUrl: options.authBaseUrl,
      openUrl: options.openUrl,
      env: options.env,
    });

    const authResult = new Promise<void>((resolve, reject) => {
      server.on("request", async (req, res) => {
        const url = new URL(`http://${state.host}${req.url}`);
        if (url.pathname !== "/auth/callback") {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }

        try {
          await state.handleCallback(url);
        } catch (error) {
          res.statusCode = 400;
          const message = error instanceof Error ? error.message : String(error);
          res.end(message);
          reject(error);
          return;
        }

        res.setHeader("Content-Type", "text/html");
        res.end(
          `<html><body style="font-family:system-ui;max-width:400px;margin:80px auto;text-align:center"><h2>✓ Signed in</h2><p>You may now close this tab and return to the terminal.</p></body></html>`,
        );
        resolve();
      });
    });

    await state.openLoginPage();
    await authResult;
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
}

class LoginState {
  private latestVerifier?: string;
  private latestState?: string;
  private readonly sdk: ManagementApiSdk;
  private readonly openUrl: (url: string) => Promise<unknown> | unknown;

  constructor(
    private readonly options: {
      hostname: string;
      port: number;
      tokenStorage?: TokenStorage;
      clientId?: string;
      apiBaseUrl?: string;
      authBaseUrl?: string;
      openUrl?: (url: string) => Promise<unknown> | unknown;
      env?: NodeJS.ProcessEnv;
    },
  ) {
    const tokenStorage = options.tokenStorage ?? new FileTokenStorage(options.env);
    this.sdk = createManagementApiSdk({
      clientId: options.clientId ?? CLIENT_ID,
      redirectUri: `http://${options.hostname}:${options.port}/auth/callback`,
      tokenStorage,
      apiBaseUrl: options.apiBaseUrl ?? getApiBaseUrl(options.env),
      authBaseUrl: options.authBaseUrl,
    });
    this.openUrl = options.openUrl ?? open;
  }

  async openLoginPage(): Promise<void> {
    const { url, state, verifier } = await this.sdk.getLoginUrl({
      scope: "workspace:admin offline_access",
      additionalParams: {
        utm_source: "prisma-cli",
        utm_medium: "command-login",
        utm_campaign: "prisma-cli",
      },
    });

    this.latestState = state;
    this.latestVerifier = verifier;

    await this.openUrl(url);
  }

  async handleCallback(url: URL): Promise<void> {
    if (url.pathname !== "/auth/callback") {
      throw new AuthError("Not a callback URL");
    }

    const params = url.searchParams;
    const error = params.get("error");
    if (error) {
      const desc = params.get("error_description");
      throw new AuthError(desc ? `${error}: ${desc}` : error);
    }

    if (!this.latestVerifier) throw new AuthError("No verifier found");
    if (!this.latestState) throw new AuthError("No state found");

    try {
      await this.sdk.handleCallback({
        callbackUrl: url,
        verifier: this.latestVerifier,
        expectedState: this.latestState,
      });
    } catch (error) {
      if (error instanceof SDKAuthError) {
        throw new AuthError(error.message);
      }
      throw new AuthError(error instanceof Error ? error.message : "Unknown error during login");
    }
  }

  get host(): string {
    return `${this.options.hostname}:${this.options.port}`;
  }
}
