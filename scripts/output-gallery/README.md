# Output gallery

Captures the CLI's real terminal output under a PTY and renders it as a browsable HTML gallery — the tool behind the visual-system review on PR #172.

Usage:

```bash
zsh scripts/output-gallery/capture.zsh
node scripts/output-gallery/build.mjs
node scripts/output-gallery/page.mjs
open wip/gallery/gallery.html
```

- `capture.zsh` runs each command via `script(1)` so color renders exactly as a user sees it, writing `.ansi` files to `wip/gallery/shots/`. Cloud flows need an authenticated session; ORM flows need the scaffolded demo project (`wip/gallery/orm-demo`) and a local Postgres 17 (`docker run -d --name prisma-gallery-pg -e POSTGRES_PASSWORD=pg -p 55432:5432 postgres:17`). Shots for missing prerequisites simply capture the error — which is also part of the UX.
- `build.mjs` converts the ANSI captures to HTML panes (`gallery-body.html`).
- `page.mjs` wraps them in the page shell (`gallery.html`).

Everything is written under `wip/gallery/` (gitignored); set `GALLERY_DIR` to an absolute directory path (no trailing slash needed) to use another one.
