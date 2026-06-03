import events from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import readline from "node:readline/promises";
import type { Readable, Writable } from "node:stream";

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
  signal?: AbortSignal;
  input?: Readable;
  output?: Writable;
}

export async function login(options: LoginOptions = {}): Promise<void> {
  const hostname = options.hostname ?? "localhost";
  const port = options.port ?? 0;
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stderr;
  const interactive = (input as NodeJS.ReadStream).isTTY === true;
  const server = http.createServer();
  server.listen({ host: hostname, port });

  const pasteAbort = new AbortController();

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
      signal: options.signal,
      output,
    });

    let completed = false;
    let completion: Promise<void> | undefined;

    // The browser redirect and a pasted callback URL can both deliver the same
    // auth code. Funnel both through one in-flight promise so the token
    // exchange runs at most once; clear it on failure so a retry can try again.
    const completeOnce = (url: URL): Promise<void> => {
      if (!completion) {
        completion = state.handleCallback(url).then(
          () => {
            completed = true;
          },
          (error) => {
            completion = undefined;
            throw error;
          },
        );
      }
      return completion;
    };

    const httpResult = new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        reject(options.signal?.reason);
      };
      options.signal?.addEventListener("abort", onAbort, { once: true });
      const settle = (callback: () => void) => {
        options.signal?.removeEventListener("abort", onAbort);
        callback();
      };

      server.on("request", async (req, res) => {
        const url = new URL(`http://${state.host}${req.url}`);
        if (url.pathname !== "/auth/callback") {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }

        if (completed) {
          // The paste path already completed the token exchange. Render the
          // success page anyway so a late browser callback isn't left dangling.
          const workspaceName = await state.resolveWorkspaceName();
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(renderSuccessPage(workspaceName));
          return;
        }

        try {
          await completeOnce(url);
          const workspaceName = await state.resolveWorkspaceName();
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(renderSuccessPage(workspaceName));
          settle(resolve);
        } catch (error) {
          res.statusCode = 400;
          const message =
            error instanceof Error ? error.message : String(error);
          res.end(message);
          settle(() => reject(error));
          return;
        }
      });
    });

    options.signal?.throwIfAborted();
    // Only race the paste flow when stdin is a TTY we can actually prompt on.
    // Without one (CI, pipes, tests) the browser callback is the only path.
    const callbackResult = interactive
      ? Promise.race([httpResult, consumePastedCallback({
        input,
        output,
        signal: pasteAbort.signal,
        complete: completeOnce,
      })])
      : httpResult;

    await Promise.all([state.openLoginPage(interactive), callbackResult]);
  } finally {
    pasteAbort.abort();
    if (server.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
}

async function consumePastedCallback(options: {
  input: Readable;
  output: Writable;
  signal: AbortSignal;
  complete: (url: URL) => Promise<void>;
}): Promise<void> {
  // Defensive: callers only start this on a TTY. Without one there is nowhere
  // to paste, so let the browser callback be the only path that resolves.
  const input = options.input as NodeJS.ReadStream;
  if (!input.isTTY) return;

  const rl = readline.createInterface({
    input: options.input,
    output: options.output,
  });
  try {
    // Keep prompting until a paste completes sign-in. A premature Enter or a
    // wrong paste shows a hint and re-asks instead of ending the whole login;
    // the browser callback stays open the whole time and can still win.
    for (;;) {
      let answer: string;
      try {
        answer = await rl.question("Paste the callback URL here: ", {
          signal: options.signal,
        });
      } catch (error) {
        // The browser callback won the race and aborted us. Stop prompting.
        if ((error as { name?: string } | null)?.name === "AbortError") return;
        throw error;
      }

      const trimmed = answer.trim().replace(/^["']|["']$/g, "");
      let url: URL;
      try {
        if (!trimmed) throw new Error("empty input");
        url = new URL(trimmed);
      } catch {
        options.output.write(
          "That didn't look like a URL. Paste the full localhost callback URL and try again.\n",
        );
        continue;
      }

      try {
        await options.complete(url);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        options.output.write(
          `Sign-in didn't complete (${message}). Paste the callback URL to try again.\n`,
        );
        continue;
      }
    }
  } finally {
    rl.close();
  }
}

class LoginState {
  private latestVerifier?: string;
  private latestState?: string;
  private readonly sdk: ManagementApiSdk;
  private readonly openUrl: (url: string) => Promise<unknown> | unknown;
  private readonly tokenStorage: TokenStorage;
  private readonly output?: Writable;

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
      signal?: AbortSignal;
      output?: Writable;
    },
  ) {
    this.tokenStorage =
      options.tokenStorage ?? new FileTokenStorage(options.env, options.signal);
    this.sdk = createManagementApiSdk({
      clientId: options.clientId ?? CLIENT_ID,
      redirectUri: `http://${options.hostname}:${options.port}/auth/callback`,
      tokenStorage: this.tokenStorage,
      apiBaseUrl: options.apiBaseUrl ?? getApiBaseUrl(options.env),
      authBaseUrl: options.authBaseUrl,
    });
    this.openUrl = options.openUrl ?? open;
    this.output = options.output;
  }

  async openLoginPage(interactive: boolean): Promise<void> {
    this.options.signal?.throwIfAborted();
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

    this.options.signal?.throwIfAborted();
    // Browser launch cannot consume AbortSignal; check immediately before and after the boundary.

    // The instructions describe the paste fallback, which only exists on a TTY.
    if (interactive) {
      this.printLoginInstructions(url);
    }

    try {
      await this.openUrl(url);
    } catch (error) {
      // On a TTY the user can finish via the pasted-URL prompt, so a failed
      // browser launch is non-fatal. Without one there is no fallback — surface
      // the failure instead of waiting on a callback that will never arrive.
      if (!interactive) throw error;
    }
    this.options.signal?.throwIfAborted();
  }

  private printLoginInstructions(url: string): void {
    const output = this.output;
    if (!output) return;

    output.write(
      `\nOpen this URL to sign in: ${url}\n\n` +
        `If the browser opens on another machine, finish sign-in there. When it\n` +
        `redirects to localhost, copy the full localhost URL from the address bar\n` +
        `and paste it here.\n\n`,
    );
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
      throw new AuthError(
        error instanceof Error ? error.message : "Unknown error during login",
      );
    }
  }

  async resolveWorkspaceName(): Promise<string | null> {
    try {
      const tokens = await this.tokenStorage.getTokens();
      if (!tokens?.workspaceId) {
        return null;
      }

      const { data } = await this.sdk.client.GET("/v1/workspaces/{id}", {
        params: { path: { id: tokens.workspaceId } },
        signal: this.options.signal,
      });
      const name = data?.data?.name;
      return typeof name === "string" && name.trim().length > 0
        ? name.trim()
        : null;
    } catch {
      this.options.signal?.throwIfAborted();
      return null;
    }
  }

  get host(): string {
    return `${this.options.hostname}:${this.options.port}`;
  }
}

function renderSuccessPage(workspaceName: string | null): string {
  const body = workspaceName
    ? `Your terminal is now connected to your ${escapeHtml(workspaceName)} workspace. Head back to your terminal to continue.`
    : "Your terminal is now connected to your Prisma workspace. Head back to your terminal to continue.";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Prisma Developer Platform</title>
  <style>
    :root {
      color-scheme: light dark;
      --background: #ffffff;
      --foreground: #1f2430;
      --muted: #4f5665;
      --mark-color: #050812;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --background: #050812;
        --foreground: #f6f7fb;
        --muted: #c5cad6;
        --mark-color: #ffffff;
      }
    }

    * {
      box-sizing: border-box;
    }

    body {
      min-height: 100vh;
      margin: 0;
      background: var(--background);
      color: var(--foreground);
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      display: grid;
      grid-template-rows: 128px 1fr;
    }

    .mark {
      align-self: end;
      justify-self: center;
      width: 36px;
      height: 36px;
      color: var(--mark-color);
    }

    .mark path {
      fill: currentColor !important;
    }

    main {
      align-self: center;
      justify-self: center;
      width: min(520px, calc(100vw - 48px));
      margin-top: -128px;
      text-align: center;
    }

    h1 {
      margin: 0 0 12px;
      font-size: 26px;
      line-height: 1.2;
      font-weight: 700;
      letter-spacing: 0;
    }

    p {
      margin: 0 auto;
      max-width: 480px;
      color: var(--muted);
      font-size: 15px;
      line-height: 1.55;
      letter-spacing: 0;
    }
  </style>
</head>
<body>
  <svg class="mark" width="36" height="36" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><path d="M25.21,24.21,12.739,27.928a.525.525,0,0,1-.667-.606L16.528,5.811a.43.43,0,0,1,.809-.094l8.249,17.661A.6.6,0,0,1,25.21,24.21Zm2.139-.878L17.8,2.883h0A1.531,1.531,0,0,0,16.491,2a1.513,1.513,0,0,0-1.4.729L4.736,19.648a1.592,1.592,0,0,0,.018,1.7l5.064,7.909a1.628,1.628,0,0,0,1.83.678l14.7-4.383a1.6,1.6,0,0,0,1-2.218Z" style="fill:#0c344b;fill-rule:evenodd"/></svg>
  <main>
    <h1>You're all set.</h1>
    <p>${body}</p>
  </main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}
