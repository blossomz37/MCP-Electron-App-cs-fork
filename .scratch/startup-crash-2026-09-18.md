# FictionLab startup crash diagnosis — 2026-09-18

## Confirmed cause

The installed `/Applications/FictionLab.app` (bundle version 0.7.1) exits with code 1 after its automatic update download fails. The Workflow plugin turns that unrelated update failure into a fatal application exit.

Reproduced at 18:51 local time by launching the installed executable with a Finder-like PATH (`/usr/bin:/bin:/usr/sbin:/sbin`). The window starts loading, the updater discovers version 0.9.1, and the process exits within seconds.

1. The updater sees only DMG entries for the update. Its Mac download path raises `ERR_UPDATER_ZIP_FILE_NOT_FOUND` / `ZIP file not provided`.
2. Installed `dist/main/auto-updater.js` calls `checkForUpdatesAndNotify().catch(...)`. In the bundled `electron-updater/out/AppUpdater.js:294`, a detached `downloadPromise.then(...)` has no rejection handler; the outer catch does not contain this failure.
3. The installed Workflow plugin calls `runner.installCrashHandlers()` during activation (`plugins/fictionlab-workflow/dist/index.js:106`).
4. Its bundled runner handles every process-wide `unhandledRejection`, calls `failTrackedRuns`, and unconditionally executes `process.exit(1)` in `bundled/workflow-runner/dist/index.js:330-334`.
5. Captured stderr shows the updater exception followed by `[WorkflowRunner] Unhandled rejection`; the launched process returns exit code 1.

Plugin paths above are relative to `/Users/carlo/Library/Application Support/fictionlab/`.

## Other findings

- Deep, strict code-signature verification succeeds for the installed app and the earlier local app copy. The earlier signing problem is not the present failure.
- A Finder-like PATH also produces `spawn node ENOENT` in workflow MCP clients. Node exists at `/opt/homebrew/bin/node`. This is a separate workflow startup defect; fixing PATH alone does not address the confirmed updater-triggered exit.
- Persistent evidence: `/Users/carlo/Library/Application Support/fictionlab/logs/main.log`, including the 18:49 and 18:51 startup failures.
- Diagnosis used the installed app archive, not an assumption that this checkout matches the installed build. Extracted diagnostic copies are in `/tmp/fictionlab-diagnosis/`.

## Repair targets

- Host application: handle update-check and download failures explicitly, avoiding the detached notification promise in this bundled updater implementation.
- Workflow plugin: leave host process termination to Electron; an embedded runner must not exit the entire application on an unrelated rejected promise.
- Release packaging: provide the macOS ZIP artifact and matching update metadata required by the updater.
- Separately resolve executable paths for Finder launches.

Diagnosis complete. No application binaries, plugin code, settings, or project data were manually changed. Reproduction ran normal application startup, including its existing plugin activation hooks. Repairs and post-repair validation remain separate work.
