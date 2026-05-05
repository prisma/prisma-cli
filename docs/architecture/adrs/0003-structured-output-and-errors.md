# ADR 0003 - Structured Output And Errors

## Status

Accepted

## Context

The CLI must work for humans, scripts, CI systems, and agents. Human output can
be friendly and contextual, but automation needs stable fields that do not
change with prose wording.

## Decision

The CLI treats output and errors as public contracts:

- stdout is for machine-readable data.
- stderr is for human-oriented status, prompts, and decoration.
- `--json` emits explicit success and error envelopes.
- Error codes are stable machine-readable values.
- Agents and CI should branch on structured fields, not prose.

## Consequences

- Any user-visible output change should check
  [output conventions](../../product/output-conventions.md).
- Any new error code or error envelope change should update
  [error conventions](../../product/error-conventions.md).
- Tests should assert both human and JSON behavior for commands that support
  automation.
