# FictionLab local startup repair — 2026-09-18

Status: installed and verified on this Mac. The app was left open.

## Changes

This is a local patch of `/Applications/FictionLab.app`, not a rebuild or an upstream release. The checkout lacks the installed build's `auto-updater` module, so rebuilding the checkout was deliberately avoided.

- Replaced the bundled notification helper call with `checkForUpdates()` and explicit handling of the returned download promise. Failed checks and failed downloads now log an error without creating an unhandled rejection. The existing in-app `update-downloaded` event remains unchanged.
- Added an early macOS-only PATH fallback for existing Homebrew and Docker command directories. Existing PATH precedence is retained.
- Added an `exitProcess` option to the installed Workflow runner's crash handlers, defaulting to true for standalone callers. The embedded plugin passes false: tracked-run failure cleanup remains, but the plugin no longer terminates the host process. This does not repair every possible uncaught host error.
- Repacked the archive, updated its `ElectronAsarIntegrity` header hash, and applied a local ad-hoc signature.

The archive content comparison verified exactly two existing JS files changed and one helper was added. No archive files were removed. Repacking also moved nested node-pty dependency files to the unpacked directory; their bytes were preserved and the generated unpacked tree was installed alongside the archive.

## Recovery

Full original app backup:

`/Users/carlo/Library/Application Support/fictionlab/backups/startup-repair-20260918-192733/FictionLab.app`

The same directory contains `plugin-dist/`, `runner-dist/`, `original-sha256.json`, `repaired-sha256.json`, and `startup-verification.txt`.

To roll back, quit FictionLab, move the repaired app aside, restore the backed-up app to `/Applications/FictionLab.app`, and restore these original plugin files:

- `plugin-dist/index.js` → `plugins/fictionlab-workflow/dist/index.js`
- `runner-dist/index.js` → `plugins/fictionlab-workflow/bundled/workflow-runner/dist/index.js`

Plugin destination paths are relative to `/Users/carlo/Library/Application Support/fictionlab/`. Rollback restores the original crash behavior too. No settings or manuscript files were edited by this repair.

## Validation

- `node --unhandled-rejections=strict scripts/test-macos-startup-repair.cjs /tmp/fictionlab-repair-staging /tmp/fictionlab-plugin-repair-staging` passed: failed checks/downloads contained, embedded host termination suppressed, standalone termination retained, PATH fallback scoped and idempotent.
- `codesign --verify --deep --strict /Applications/FictionLab.app` passed after re-signing.
- Launched the installed executable with `PATH=/usr/bin:/bin:/usr/sbin:/sbin` at 19:29:55. The updater hit the same missing-ZIP error at 19:29:57, now logged as `electron-updater check/download failed`. The app remained alive beyond one minute and its native window was verified through accessibility inspection.
- Logs confirm workflow-manager database connection, successful `list_active_workflows`, and `2 total, 2 active, 0 errors` plugins. No `spawn node ENOENT` or unhandled rejection occurred in the verified startup.
- `git diff --check` and Node syntax check passed. A full workflow execution and a future successful update install were not tested.

## Reapplying and limits

`scripts/repair-installed-macos.py` patches only staged extracted app/plugin copies and rejects unexpected inputs before writing. Back up before installation. Extraction/packing used `@electron/asar@3.2.10`, with `--unpack-dir node_modules/node-pty`. Update the Info.plist ASAR header SHA256 and re-sign after installation; merely copying the archive is insufficient.

The missing ZIP belongs to the published update and remains unresolved. App/plugin updates can overwrite this local repair. A durable upstream release should carry these fixes and publish the macOS ZIP and matching metadata. No upstream files or releases were changed.
