# CLI Help Standard

## Purpose

This document defines the standard every command's `--help` text must meet, and why the bar is set where it is. The formatting and card-structure rules live in `cli-style-guide.md`; this document is the contract for the words.

## Why Help Is a Manual, Not a Summary

The CLI's help is the one interface every consumer is guaranteed to have. Documentation sites go stale or unread, and agent skills may not be installed. `--help` ships with the binary, matches the installed version exactly, and is the first thing both a new user and an AI agent reach for. So the CLI must be self-documenting: help text carries enough of the product model that a reader can act correctly without any other source.

The reader to write for is an AI coding agent that has never heard of Prisma. That reader is also the strictest proxy for a new human user. It does not know what a workspace, Project, Branch, contract, or skill is. It cannot infer that "linking" stores a local pointer, or that a "version" is immutable and one serves traffic. Every term it cannot resolve from the card in front of it costs a round trip: a doc lookup, a wrong invocation, a retried command. That churn is the thing this standard exists to eliminate. When help defines its own terms, an agent reads one card and issues the right command; when it does not, the agent guesses.

The same rule protects against a quieter failure: help that paraphrases the command name. "prisma deploy — Deploy" tells the reader nothing the invocation did not. Text earns its place by adding intent (when to run this, what it operates on, what happens next), never by restating the grammar.

## The Standard

Definitions of each surface: a group's *brief* is the one-line text on its parent card; its *description* is the prose on its own card. A command's *summary* is its row on the group card; its *description* is the prose on its own card.

1. Every row stands alone. A summary must be understandable by a reader who will never open the leaf card. If it depends on a term the reader cannot know, define the term in place, usually by stating the consequence: "Link this directory to a Project: commands run here target it by default".
2. Group briefs are a short lead, then scope. Name what lives beneath: "Manage S3-compatible object-store buckets for a project. CRUD operations and access keys". "CRUD" may stand in for the common verbs; operations a reader would not guess (link, transfer, promote) are named.
3. Group descriptions define every term their rows and flags rely on: what the resource is, what it belongs to, and the lifecycle words the subcommands use. If a row says "linked", "version", or "scope", the group card says what that means.
4. Commands that are self-describing stay short. "project list — List all projects in your workspace" needs no description. Add prose only where it carries intent the invocation does not.
5. Flag briefs state what the flag does and, when it exists for a distinct situation, when to reach for it. Defaults are spelled out in plain language: "(default: the project this directory is linked to)", never "(default: the resolved project)".
6. Internal vocabulary never leaks. "Binding", "resolved", "pinned", and "active" are implementation terms; help uses the plain phrase or defines the word in the same card.
7. Concepts are defined at first use, in one clause. A Project groups one product or codebase inside a workspace. A Branch maps to a Git branch and is an isolated environment with its own services, databases, and buckets. A service version is one immutable deploy; one serves traffic at a time.
8. Groups with a common multi-command path declare a Workflow section: ordered, copy-pastable steps whose purpose column states action and consequence, standing alone like any row.
9. Current product names only. Prisma ORM is called Prisma ORM; retired names such as "Prisma Next" never appear.

## What This Buys

1. Self-documenting: the installed binary is the reference for its own version; no doc site round trip.
2. Agent-ready without skills: an agent with no Prisma skill installed can go from `prisma --help` to a correct, safe invocation by reading cards, because each card teaches the model it needs.
3. Less churn for everyone: fewer wrong invocations, fewer retries, fewer support questions that are really vocabulary questions.

## Enforcement

New and changed commands must meet this standard before they merge; review help text against it the way behavior is reviewed against the product docs. The repository `AGENTS.md` binds agents working in this repo to the same rule.
