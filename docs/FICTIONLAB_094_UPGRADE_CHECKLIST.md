# FictionLab 0.9.4 upgrade — 2026-09-19

## Active checklist

- [x] Confirm installed version (0.9.1) and healthy Docker services.
- [x] Verify official ARM64 DMG SHA256 and disk-image integrity.
- [x] Quit app and back up app, user data, and PostgreSQL.
- [x] Inspect 0.9.4 signature and existing local fixes.
- [x] Install 0.9.4; apply only necessary local repairs.
- [x] Verify normal macOS launch and restart.
- [x] Verify Themes and saved settings, Dashboard, 16 workflows, and Kanban.
- [x] Verify toolbar, About icon, collapsed sidebar, and updater behavior.
- [x] Record recovery procedure and evidence; complete Kanban and commit/push.

## Verified installer

Official release: https://github.com/RLRyals/MCP-Electron-App/releases/tag/v0.9.4

`downloads-update/FictionLab-0.9.4-arm64.dmg`

SHA256: `492c5d65db9310fd0abc79aae74074de42c5c1a6c6d1a703e8ad1dc7f3370c6a`

Matches official `checksums-macos.txt`; `hdiutil verify` passed.

## Recovery and execution evidence

Installed and verified on this Mac; closeout below.

Backup: `~/Library/Application Support/fictionlab/backups/upgrade-094-20260919/` contains the working app, user data (excluding older backups), and `database.dump` (custom-format PostgreSQL archive; `pg_restore --list` passed).

The upstream app fails `codesign --verify --deep --strict` with `code has no resources but signature indicates they must be present`. The upstream toolbar and macOS updater fixes are present; startup PATH, About logo sizing, and sidebar centering repairs were absent. These three existing repairs are carried forward into the compiled app.

The first repaired copy retained quarantine attributes inside its bundle; it ended up in Trash during first launch (Carlo confirmed he clicked Move to Trash on the damaged-app warning). Its archive hash matched the repaired staging archive. Re-copied staging and removed only `com.apple.quarantine` recursively from `/Applications/FictionLab.app`; signature verification then passed and LaunchServices opened 0.9.4 successfully. No global Gatekeeper settings changed. Theme settings remain byte-identical to backup.

## Acceptance evidence

- Normal `/usr/bin/open /Applications/FictionLab.app` launch and a complete quit/relaunch passed. App bundle and Setup page report **0.9.4** on arm64.
- Dashboard: **All Systems Operational**; Postgres, Connector, Writing Server and Docker green.
- Workflows: native UI **AVAILABLE WORKFLOWS 16** and live IPC returned all 16 definitions. No workflow executed or reimported.
- Kanban: `my-first-kanban` loaded with 15 existing Done cards and this upgrade card in progress before closeout.
- Themes 0.1.2: **Applied theme: Near Black & White**, **Saved themes: 3/5** before and after restart. Settings remain byte-identical to the backup (SHA256 `db36a9b1258ff87fa09708f9f78bba83b1a3d140e3ccf163e1152ef69313503f`). No saved theme edited.
- Native UI inspected: horizontal toolbar; dropdown caret inset; compact About icon; centered collapsed rail. Screenshot: [About and sidebar](evidence/upgrade-094/about-sidebar.png).
- Check for Updates returned **You're up to date (0.9.4)**. The new-version download-link branch cannot be exercised against a newer release yet.
- Repaired installed archive SHA256: `afb6e0f3e525917ebd1dc90a05a39a9fa0fe53b415ea95945509a83271d8f729`.
- `codesign --verify --deep --strict` passes. This is local ad-hoc signing, not Developer ID signing or notarization.

## Confirmed recovery procedure

1. Quit FictionLab and confirm its main process has exited. Back up the entire app and user data (excluding recursive historical backups); use `pg_dump -Fc` for the live database and validate its archive list.
2. Compare the ARM64 DMG SHA256 with the official release checksum, then run `hdiutil verify`. Stop if either fails; acquire a fresh official installer.
3. Mount read-only, inspect the app signature, and compare any local repairs against the new compiled app. Keep the original DMG untouched.
4. Stage the new app. Carry forward only missing local fixes from the reviewed fork. Repack its archive, then ad-hoc sign the staged app with `codesign --force --deep --sign -` and verify with `codesign --verify --deep --strict`.
5. Install the staged copy. If the verified app retains quarantine and raises the same damaged-app warning, remove only its quarantine attribute: `xattr -dr com.apple.quarantine /Applications/FictionLab.app`. Do not change global Gatekeeper policy. In this run nested bundle quarantine survived re-signing and needed this separate step.
6. Launch normally; verify services, existing workflow count, Kanban, Themes and layout. Quit and relaunch before accepting the upgrade.
7. If launch or data access fails, retain the failed app for diagnosis and restore the backed-up app. Restore data only if actually changed/corrupted, after preserving the newer data too. Never restore an old database over new writing without explicit approval. The backup archive was inspected; a destructive database restore was not rehearsed.

## Remaining observations outside this upgrade

- About displays `Version 1.0.0` and unknown runtime versions despite Setup and bundle metadata correctly reporting 0.9.4. This display defect was not changed.
- Database administration has low-contrast white text on the Near Black & White workspace. Follow-up theme coverage needed; no additional plugin changes made here.
- Future upstream app replacements can remove the three local repairs. Recheck rather than blindly applying old archive contents.
- Repository source remains the existing fork revision; this task upgrades the installed app, not the source branch to upstream v0.9.4.

Kanban card: `529dc0fb-ee79-4a05-a853-18ad56668532`.
