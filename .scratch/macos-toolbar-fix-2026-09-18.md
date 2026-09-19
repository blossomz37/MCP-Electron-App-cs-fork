# macOS toolbar spacing repair

User requested a focused fix for the crowded upper-left corner, rather than layout customization controls.

Cause: `top-bar.css` sets the toolbar to `flex-direction: column` for Windows' two-row structure. The Mac renderer supplies three direct children expecting a single row, but never overrides that direction. The window uses `hiddenInset`, with no reserved horizontal space for the native window buttons. Sidebar/content offsets also inherit the Windows 80px toolbar height.

Changed `src/renderer/components/TopBar.ts` to identify macOS on the document root during initialization. Added scoped CSS in `src/renderer/styles/top-bar.css` for a 56px horizontal toolbar, 96px left clearance, aligned controls, matching sidebar/content offsets, and horizontally scrollable action overflow. Other platforms retain existing styles.

Applied the same two changes to the installed 0.9.1 archive without rebuilding the older checkout. Full pre-change app backup:

`/Users/carlo/Library/Application Support/fictionlab/backups/macos-toolbar-20260918-195600/FictionLab.app`

Compared archive file contents before installation: only `dist/renderer/components/TopBar.js` and `dist/renderer/styles/top-bar.css` changed. Repacked with node-pty unpacked, updated the ASAR integrity header hash, and re-signed locally. Deep/strict signature verification passed.

Normal Quit closed the window but left the process running; sent SIGTERM to that exact remaining app process before installation. Relaunched successfully. No settings or author files edited.

Native visual verification: Dashboard heading, Refresh, project selector, and service indicator are arranged in one row at the inspected window size; sidebar starts below the toolbar. Workflow view also fits its Import and Refresh actions; navigated back to Dashboard. The 96px native-control clearance is supplied by CSS; the computer-use screenshot's upper-left overlay obscures the native buttons themselves. No manual narrow-window resize or Windows/Linux runtime check was performed. `git diff --check` passed; no full application rebuild was run.

Complete. A later app replacement can overwrite the installed copy; source changes and this record preserve the repair.
