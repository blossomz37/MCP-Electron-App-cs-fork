# Workflow visibility recovery — 2026-09-18

## Cause

FictionLab displayed `AVAILABLE WORKFLOWS 0` / `No workflows imported` and `0/3 services ready`, although all four FictionLab Docker containers were running and the database still held 16 workflow definitions in `fictionlab.workflow_definitions`.

The log repeatedly reported `MCP process error: spawn node ENOENT`. A normal macOS launch did not inherit Homebrew's executable path. Persistent MCP clients spawned `node` using the unfixed process environment, so definitions could not be fetched. The empty list was not evidence of data loss.

## Repair

At app readiness, immediately after logger initialization and before service/plugin startup, macOS now assigns `process.env.PATH` from the existing `prerequisites.getFixedEnv()` helper. This makes the app's established tool paths available to all subsequent child processes. Other platforms are unchanged.

The source fix is in `src/main/index.ts`. The same minimal change was applied to the installed FictionLab 0.9.1 compiled entry point, retaining the existing toolbar patch and all plugin files. The application was locally ad-hoc signed again and its signature verified. This is a local application repair, not a new signed upstream release; replacing the application with an upstream update can replace this patch.

Pre-repair application backup:
`~/Library/Application Support/fictionlab/backups/startup-path-20260918/FictionLab.app`

## Evidence

- Before repair: direct read-only SQL returned 16 workflow names; the live IPC workflow list returned zero.
- Compiled entry point passed `node --check`.
- `codesign --verify --deep --strict` passed after the repair.
- A normal LaunchServices launch using `/usr/bin/open /Applications/FictionLab.app` succeeded.
- The live IPC client then returned all 16 definitions.
- Native UI showed `AVAILABLE WORKFLOWS 16` and `All Systems Operational`, including Series Architect, Dramatica, Reader-View Outline, and my-first-workflow.
- No definitions were reimported, modified, or deleted. No workflows were executed.

The full source build was not run: this checkout has no installed TypeScript toolchain and differs from installed 0.9.1. Verification covers the installed compiled repair on this Mac. The misleading empty-list error presentation remains a separate UI issue.
