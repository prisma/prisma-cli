# Design brief: an open-source agent registry and skill-write library

Status: design captured for a future project; nothing is built or committed to. Requested by Will Madden, 2026-08-24, following the agent-skills delivery in prisma-cli. Written for readers with no prior context.

## Background

An agent skill is a directory containing a `SKILL.md` — instructions that teach an AI coding agent (Claude Code, Cursor, Codex, Devin, …) how to work with a library or codebase. Each agent reads skills from a well-known directory in the project (`.claude/skills/`, `.cursor/skills/`, the cross-agent `.agents/skills/`), so any tool that distributes skills has to answer the same two questions: which agents exist and where do their directories live, and how do I put a skill tree into the right places for a chosen set of agents.

At least three independent tools answer those questions today with three private copies of the same knowledge:

| Tool | Registry size | Install method | Skill source | Library API |
| --- | --- | --- | --- | --- |
| [vercel-labs/skills](https://github.com/vercel-labs/skills) (`npx skills`) | ~33 agents | copies | GitHub repos | none — CLI only |
| [antfu/skills-npm](https://github.com/antfu/skills-npm) | smaller | symlinks | installed npm packages | none — CLI only |
| prisma-cli (`prisma skills sync`) | 4 agents | copies | installed npm packages (allowlist) | internal |

The registry knowledge rots on its own schedule: Windsurf became Devin Desktop in mid-2026, `.windsurfrules` gave way to `.devin/rules/`, and every one of these tools had to learn that separately. That churn — new agents appearing, old ones renaming, agents adopting the shared `.agents/` directory — is the strongest argument for maintaining the knowledge once, in the open, and it is community-sized: small, data-shaped, and PR-able.

## What the package should provide

Three capabilities, from the operator's requirements:

1. **Write a skill into the correct places for a given set of agent IDs** — `writeSkill({ root, name, source, agents: ["claude", "cursor", "codex"] })` — plus the matching `removeSkill`.
2. **The registry that enables it**: per agent, an ID, a display name, the project-level skills directory, and whether the agent reads the shared `.agents/skills/` directory. The shared-dir field is what makes the write operation smart: when every requested agent reads the shared directory, one copy there replaces N per-agent copies, and that dedup decision belongs in the package because it changes as agents adopt the convention.
3. **Read what is installed**: `listSkills({ root })` returning each skill's name, which agent directory (or the shared one) it sits in, and its raw frontmatter — enough for a caller to render status or apply its own policy.

Copies versus symlinks is a caller choice, not a package opinion. skills-npm symlinks (elegant: a link always points at the installed version, so staleness cannot exist); prisma-cli copies (required: under Yarn PnP the source lives inside a zip, which has no path to link to, and Windows symlinks need elevation). The write primitive should support both modes so both models can sit on it.

## The design spine: the package decides where, never whether

Skills are instructions an agent will follow, so whatever writes them sits inside a trust boundary. The package stays small and auditable by being strictly mechanical: `writeSkill` puts the given tree at the computed paths, full stop — no discovery, no scanning, no opinions about where skills come from or when they are stale.

Everything that makes a distributor trustworthy stays with the caller. For prisma-cli that means all of it: the hardcoded package allowlist (skills come only from Prisma-published packages, never from scanning `node_modules` — a scanner would let any transitive dependency inject instructions into the agent), the version stamps in the frontmatter, the staleness check, and the refusal to touch a directory it does not manage (unstamped or foreign-stamped `SKILL.md` is preserved byte-for-byte). Community contributors can fix the registry without ever touching a policy decision.

What prisma-cli would swap out if this package existed: its internal agent-name→directory map, the tree-copy primitive, and the raw listing — roughly the mechanical third of its skills library. What it would keep unconditionally: everything in the previous paragraph, plus its frontmatter stamp reader (deliberately hand-rolled: it reads only the two keys prisma-cli itself writes, and a parse failure classifies the directory as unmanaged, which refuses rather than deletes — a parse bug can never destroy user files).

## Strategy, in order of preference

1. **Upstream rather than found.** Propose a programmatic registry export to vercel-labs/skills (a `skills/registry` subpath exposing the agents table they already maintain — the largest and most actively maintained). No new project, canonical data, community keeps it current. Depends on the maintainers accepting a stable-API commitment for what is currently CLI-internal.
2. **Found a small neutral package.** If upstreaming stalls: the registry data plus the write/read primitives, under a neutral (non-Prisma) name and scope — ecosystem infrastructure attracts the registry PRs that are the whole point, a vendor-scoped package does not. Deliberately tiny: data, three functions, no YAML dependency (listing returns names plus raw frontmatter text), no network, no discovery.
3. **Vendor as a stopgap.** Both existing tools are MIT; copying vercel-labs' registry table with attribution and diffing against their repo occasionally costs nothing and blocks nothing.

The first conversation is with Anthony Fu: skills-npm shares the ship-skills-in-npm-packages thesis exactly, he also maintains a variant of the `skills` CLI itself, so he is positioned in both camps — and his symlink model is the concrete reason the write primitive must support both modes.

Why not just adopt skills-npm wholesale: it conflicts with settled prisma-cli rulings on every mechanism — it discovers skills across dependencies (versus the allowlist, a permanent security ruling), symlinks (versus PnP/Windows), writes `.gitignore` entries (ruled out), and auto-detects agents (ruled out) — and it exposes no library API. The overlap is the registry and the write plumbing, which is precisely the proposed extraction.

## Open questions for whenever this becomes a project

- Naming, npm scope, and governance for option 2 — neutral enough that competing tools will depend on it.
- The registry schema: is per-agent `readsSharedDir` (yes/no/only) sufficient, or do agents need per-OS or per-version variance?
- Whether `listSkills` should understand the Agent Skills spec's frontmatter at all, or stay at names plus raw text.
- Version pinning: consumers whose write path feeds agent instruction directories should pin the package exactly; whether the registry data should be separable from the code (data-only updates without a code release).
- Whether the shared-`.agents/`-dedup behavior is a default or an opt-in, since changing it later changes what files land in users' repos.
