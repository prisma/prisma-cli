import { readFileSync, writeFileSync } from "node:fs";

const GALLERY_DIR =
  process.env.GALLERY_DIR ??
  new URL("../../wip/gallery/", import.meta.url).pathname;
const body = readFileSync(`${GALLERY_DIR}gallery-body.html`, "utf8");

const html = `<title>Prisma CLI output gallery</title>
<style>
:root {
  --ground: #f4f5f7; --ink: #1c232b; --muted: #5b6672; --accent: #0e7f8f;
  --panel-border: #d6dbe1; --chip-bg: #e7ecef;
  --term-bg: #0d1117; --term-fg: #d7dae0; --term-border: #2a3038;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --ground: #12161b; --ink: #dde3e9; --muted: #8a93a0; --accent: #4cd1e0;
    --panel-border: #262d35; --chip-bg: #21282f;
  }
}
:root[data-theme="dark"] {
  --ground: #12161b; --ink: #dde3e9; --muted: #8a93a0; --accent: #4cd1e0;
  --panel-border: #262d35; --chip-bg: #21282f;
}
* { box-sizing: border-box; }
body {
  background: var(--ground); color: var(--ink);
  font: 15px/1.55 -apple-system, "SF Pro Text", "Segoe UI", system-ui, sans-serif;
  margin: 0; padding: 0 20px 80px;
}
main { max-width: 880px; margin: 0 auto; }
header.page { padding: 44px 0 8px; }
header.page h1 { font-size: 28px; letter-spacing: -0.02em; margin: 0 0 10px; text-wrap: balance; }
header.page p.lede { color: var(--muted); max-width: 62ch; margin: 0; }
nav.toc { display: flex; flex-wrap: wrap; gap: 8px; margin: 22px 0 8px; position: sticky; top: 0; padding: 10px 0; background: var(--ground); z-index: 5; }
nav.toc a { font-size: 12.5px; text-decoration: none; color: var(--ink); background: var(--chip-bg); border: 1px solid var(--panel-border); padding: 4px 10px; border-radius: 999px; }
nav.toc a:hover, nav.toc a:focus-visible { border-color: var(--accent); color: var(--accent); outline: none; }
h2 { font-size: 19px; letter-spacing: -0.01em; margin: 44px 0 6px; }
figure.shot { margin: 24px 0; }
figure.shot figcaption { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; margin: 0 0 6px 2px; }
code.cmd { font: 12.5px/1.4 ui-monospace, "SF Mono", Menlo, monospace; color: var(--accent); font-weight: 600; }
.note { font-size: 13px; color: var(--muted); }
pre.term {
  background: var(--term-bg); color: var(--term-fg);
  border: 1px solid var(--term-border); border-radius: 8px;
  padding: 12px 14px; margin: 0;
  font: 12.5px/1.5 ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  overflow-x: auto; tab-size: 8; max-height: 620px; overflow-y: auto;
}
.small { font-size: 13px; color: var(--muted); max-width: 68ch; }
</style>
<main>
<header class="page">
  <h1>Prisma CLI output gallery</h1>
  <p class="lede">Real PTY captures of the major commands' primary flows on the current visual system (prisma/prisma-cli#172): engine-rendered help, the block renderer's cards, tables, trees and step runners, and the error surfaces.</p>
</header>
<nav class="toc">
  <a href="#root-help">Help</a>
  <a href="#auth-whoami">Platform</a>
  <a href="#contract-emit">ORM</a>
  <a href="#err-unknown">Errors</a>
</nav>
${body}
<p class="small">Captured with wip/gallery/capture-after.sh (script(1) PTY); ORM flows against a throwaway Postgres 17 container, cloud flows against Will's workspace, read-only. Re-run the harness and republish this file to refresh.</p>
</main>`;

writeFileSync(`${GALLERY_DIR}gallery.html`, html);
console.log("wrote gallery.html");
