// biome-ignore-all lint/suspicious/noControlCharactersInRegex: this file parses raw terminal output, and escape/control characters are exactly what it matches.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Captures and output live in the gitignored working dir by default.
const GALLERY_DIR =
  process.env.GALLERY_DIR ??
  new URL("../../wip/gallery/", import.meta.url).pathname;
const AFTER = `${GALLERY_DIR}shots/`;

const FG = {
  30: "#3f4451",
  31: "#e05561",
  32: "#8cc265",
  33: "#d18f52",
  34: "#4aa5f0",
  35: "#c162de",
  36: "#42b3c2",
  37: "#d7dae0",
  90: "#6b7280",
  91: "#ff616e",
  92: "#a5e075",
  93: "#f0a45d",
  94: "#4dc4ff",
  95: "#de73ff",
  96: "#4cd1e0",
  97: "#ffffff",
};

function esc(s) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

const SCRIPT_EOF_ECHO = /^\^D/;
const OSC_SEQUENCE = /\x1b\][^\x07]*\x07/g;
const PRIVATE_MODE_SEQUENCE = /\x1b\[\?[0-9;]*[a-zA-Z]/g;
const CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f]/g;
const SGR_SPLIT = /(\x1b\[[0-9;]*m)/;
const SGR_MATCH = /^\x1b\[([0-9;]*)m$/;
const LEADING_NEWLINES = /^\n+/;
const TRAILING_NEWLINES = /\n+$/;

function stripNoise(raw) {
  return raw
    .replace(SCRIPT_EOF_ECHO, "")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replace(OSC_SEQUENCE, "")
    .replace(PRIVATE_MODE_SEQUENCE, "")
    .replace(CONTROL_CHARS, "");
}

function applySgrCodes(state, codes) {
  for (const c of codes) {
    if (c === 0) {
      state.color = null;
      state.bold = false;
      state.dim = false;
    } else if (c === 1) state.bold = true;
    else if (c === 2) state.dim = true;
    else if (c === 22) {
      state.bold = false;
      state.dim = false;
    } else if (c === 39) state.color = null;
    else if (FG[c]) state.color = FG[c];
  }
}

function spanStyle(state) {
  const css = [];
  if (state.color) css.push(`color:${state.color}`);
  if (state.bold) css.push("font-weight:700");
  if (state.dim) css.push("opacity:.55");
  return css.join(";");
}

function ansiToHtml(raw) {
  let out = "";
  let open = false;
  const state = { color: null, bold: false, dim: false };
  for (const part of stripNoise(raw).split(SGR_SPLIT)) {
    const m = part.match(SGR_MATCH);
    if (!m) {
      out += esc(part);
      continue;
    }
    if (open) {
      out += "</span>";
      open = false;
    }
    applySgrCodes(state, (m[1] === "" ? "0" : m[1]).split(";").map(Number));
    const style = spanStyle(state);
    if (style) {
      out += `<span style="${style}">`;
      open = true;
    }
  }
  if (open) out += "</span>";
  return out
    .replace(LEADING_NEWLINES, "")
    .replace(TRAILING_NEWLINES, "")
    .split("\n")
    .filter(
      (line) =>
        !line.includes("PN_CONTRACT_TYPED_FALLBACK") &&
        !line.includes("trace-warnings"),
    )
    .join("\n");
}

function pane(dir, name) {
  const path = join(dir, `${name}.ansi`);
  if (!existsSync(path)) return null;
  return ansiToHtml(readFileSync(path, "utf8"));
}

// [name, command, note, {beforeName?}]
const SECTIONS = [
  [
    "Help",
    [
      [
        "root-help",
        "prisma-cli --help",
        "Engine-rendered: banner, mount-ordered briefs, one Global options section, examples, docs. Group and leaf help follow the same card.",
      ],
    ],
  ],
  [
    "Platform flows",
    [
      ["auth-whoami", "prisma-cli auth whoami", ""],
      ["project-list", "prisma-cli project list", ""],
      ["project-show", "prisma-cli project show --project prisma-next-dev", ""],
      ["postgres-list", "prisma-cli postgres list (linked dir)", ""],
      [
        "postgres-show",
        "prisma-cli postgres show Development (linked dir)",
        "",
      ],
      [
        "bucket-list",
        "prisma-cli bucket list (linked dir)",
        "Standard empty state.",
      ],
      ["service-list", "prisma-cli service list (linked dir)", ""],
      ["branch-list", "prisma-cli branch list --project prisma-next-dev", ""],
      ["agent-status", "prisma-cli agent status", ""],
      ["telemetry-status", "prisma-cli telemetry status", ""],
      [
        "init",
        "prisma-cli init --framework hono (fresh app)",
        "Step runner + fields card.",
      ],
    ],
  ],
  [
    "ORM flows (same engine, scaffolded Postgres 17 project)",
    [
      ["contract-emit", "prisma-cli contract emit", ""],
      [
        "db-init",
        "prisma-cli db init --yes",
        "Step runner, masked connection string, operation tree.",
      ],
      ["db-verify", "prisma-cli db verify", ""],
      ["migration-status", "prisma-cli migration status", ""],
      ["migration-graph", "prisma-cli migration graph", "The lane drawing."],
      ["migration-log", "prisma-cli migration log", ""],
    ],
  ],
  [
    "Errors",
    [
      [
        "err-unknown",
        "prisma-cli porject lst",
        "Did-you-mean plus the --help pointer.",
      ],
      ["err-missing-arg", "prisma-cli feedback --no-interactive", ""],
      ["err-setup-required", "prisma-cli postgres list (unlinked dir)", ""],
    ],
  ],
];

const cards = SECTIONS.map(([title, shots]) => {
  const body = shots
    .map(([name, cmd, note]) => {
      const after = pane(AFTER, name);
      if (after === null) return "";
      return `
<figure class="shot" id="${name}">
  <figcaption><code class="cmd">${esc(cmd)}</code>${note ? `<span class="note">${esc(note)}</span>` : ""}</figcaption>
  <pre class="term">${after}</pre>
</figure>`;
    })
    .join("\n");
  return `<section><h2>${esc(title)}</h2>${body}</section>`;
}).join("\n");

writeFileSync(join(GALLERY_DIR, "gallery-body.html"), cards);
console.log("wrote gallery-body.html");
