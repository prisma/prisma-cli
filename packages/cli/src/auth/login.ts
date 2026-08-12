// biome-ignore-all lint/performance/noAwaitInLoops: Interactive paste prompting must retry sequentially.
import events from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import readline from "node:readline/promises";
import type { Readable, Writable } from "node:stream";

import {
  createManagementApiSdk,
  type ManagementApiSdk,
  AuthError as SDKAuthError,
  type TokenStorage,
} from "@prisma/management-api-sdk";
import open from "open";
import { CLIENT_ID, getApiBaseUrl } from "./client";
import { FileTokenStorage } from "./token-storage";

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
  /** Observes the verification URL as soon as it is known, before the
   *  browser opens. */
  onVerificationUrl?: (url: string) => void;
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
      onVerificationUrl: options.onVerificationUrl,
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
      ? Promise.race([
          httpResult,
          consumePastedCallback({
            input,
            output,
            signal: pasteAbort.signal,
            complete: completeOnce,
          }),
        ])
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
      const url = await readPastedCallbackUrl(rl, options);
      if (url === null) return;
      if (url === undefined) continue;

      if (await tryCompletePastedCallback(url, options)) {
        return;
      }
    }
  } finally {
    rl.close();
  }
}

async function readPastedCallbackUrl(
  rl: readline.Interface,
  options: { signal: AbortSignal; output: Writable },
): Promise<URL | null | undefined> {
  let answer: string;
  try {
    answer = await rl.question("Paste the callback URL here: ", {
      signal: options.signal,
    });
  } catch (error) {
    // The browser callback won the race and aborted us. Stop prompting.
    if ((error as { name?: string } | null)?.name === "AbortError") return null;
    throw error;
  }

  const trimmed = answer.trim().replace(/^["']|["']$/g, "");
  try {
    if (!trimmed) throw new Error("empty input");
    return new URL(trimmed);
  } catch {
    options.output.write(
      "That didn't look like a URL. Paste the full localhost callback URL and try again.\n",
    );
    return undefined;
  }
}

async function tryCompletePastedCallback(
  url: URL,
  options: { complete: (url: URL) => Promise<void>; output: Writable },
): Promise<boolean> {
  try {
    await options.complete(url);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    options.output.write(
      `Sign-in didn't complete (${message}). Paste the callback URL to try again.\n`,
    );
    return false;
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
      onVerificationUrl?: (url: string) => void;
      env?: NodeJS.ProcessEnv;
      signal?: AbortSignal;
      output?: Writable;
    },
  ) {
    this.tokenStorage =
      options.tokenStorage ??
      new FileTokenStorage(options.env, options.signal, {
        activateOnSetTokens: true,
      });
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
    try {
      // An observer must never break the login flow itself.
      this.options.onVerificationUrl?.(url);
    } catch {}

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
      --surface: #f6f7fb;
      --border: #e4e7ee;
      --success: #15803d;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --background: #050812;
        --foreground: #f6f7fb;
        --muted: #c5cad6;
        --mark-color: #ffffff;
        --surface: #0d1322;
        --border: #232a3d;
        --success: #4ade80;
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

    .skills {
      margin-top: 40px;
      padding-top: 28px;
      border-top: 1px solid var(--border);
      text-align: left;
    }

    .skills-lead {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0 0 12px;
      font-size: 15px;
      color: var(--foreground);
    }

    .skills-lead svg {
      flex: none;
      color: var(--muted);
    }

    .command {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 8px 10px 16px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
    }

    .command code {
      flex: 1;
      overflow-x: auto;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 13.5px;
      white-space: nowrap;
    }

    .command .prompt {
      color: var(--muted);
      user-select: none;
    }

    .copy {
      flex: none;
      display: grid;
      place-items: center;
      padding: 6px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
    }

    .copy:hover {
      background: var(--border);
      color: var(--foreground);
    }

    .copy .icon-check,
    .copy.copied .icon-copy {
      display: none;
    }

    .copy.copied .icon-check {
      display: block;
    }

    .copy.copied,
    .copy.copied:hover {
      color: var(--success);
    }
  </style>
</head>
<body>
  <svg class="mark" width="36" height="36" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><path d="M25.21,24.21,12.739,27.928a.525.525,0,0,1-.667-.606L16.528,5.811a.43.43,0,0,1,.809-.094l8.249,17.661A.6.6,0,0,1,25.21,24.21Zm2.139-.878L17.8,2.883h0A1.531,1.531,0,0,0,16.491,2a1.513,1.513,0,0,0-1.4.729L4.736,19.648a1.592,1.592,0,0,0,.018,1.7l5.064,7.909a1.628,1.628,0,0,0,1.83.678l14.7-4.383a1.6,1.6,0,0,0,1-2.218Z" style="fill:#0c344b;fill-rule:evenodd"/></svg>
  <main>
    <h1>You're all set.</h1>
    <p>${body}</p>
    <section class="skills">
      <div class="skills-lead">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/></svg>
        Using an AI coding agent? Add the Prisma skills:
      </div>
      <div class="command">
        <code><span class="prompt">$ </span>npx skills add prisma/skills</code>
        <button class="copy" type="button" aria-label="Copy command to clipboard">
          <svg class="icon-copy" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
          <svg class="icon-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
        </button>
      </div>
    </section>
  </main>
  <script>
    (() => {
      const command = "npx skills add prisma/skills";
      const button = document.querySelector(".copy");
      let timer;
      button.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(command);
        } catch {
          // Clipboard access denied: select the command so Cmd/Ctrl+C works.
          const range = document.createRange();
          range.selectNodeContents(document.querySelector(".command code"));
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          return;
        }
        button.classList.add("copied");
        clearTimeout(timer);
        timer = setTimeout(() => {
          button.classList.remove("copied");
        }, 2000);
      });
    })();
  </script>
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
