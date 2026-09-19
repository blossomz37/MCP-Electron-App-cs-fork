"""Patch staged copies of the diagnosed macOS build, not the live installation.

Usage: python3 scripts/repair-installed-macos.py EXTRACTED_ASAR STAGED_PLUGIN
Requires an app/plugin backup before the patched files are installed.
Exact-match guards intentionally reject different builds. Does not re-sign/install.
"""
from pathlib import Path
import sys


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise ValueError(f"Expected exactly one match: {old[:100]!r}")
    return text.replace(old, new, 1)


def patch(app, plugin):
    updates = {}
    updater = app / "dist/main/auto-updater.js"
    updates[updater] = replace_once(
        updater.read_text(),
        "    electron_updater_1.autoUpdater.checkForUpdatesAndNotify().catch((error) => {\n"
        "        logger_1.default.error('electron-updater checkForUpdatesAndNotify failed:', error);\n"
        "    });",
        "    // Observe the download promise too; the bundled notification helper\n"
        "    // creates a detached promise that rejects on missing macOS ZIP assets.\n"
        "    return electron_updater_1.autoUpdater.checkForUpdates()\n"
        "        .then((result) => result && result.downloadPromise)\n"
        "        .catch((error) => {\n"
        "            logger_1.default.error('electron-updater check/download failed:', error);\n"
        "        });",
    )
    entry = app / "dist/main/index.js"
    updates[entry] = replace_once(
        entry.read_text(), '"use strict";',
        '"use strict";\nrequire("./macos-tool-path");',
    )
    helper = app / "dist/main/macos-tool-path.js"
    if helper.exists():
        raise ValueError("Tool path helper already exists; inspect before reapplying")
    updates[helper] = '''"use strict";
// Finder does not inherit shell startup files. Preserve existing precedence,
// then add installed Homebrew and Docker command directories for child tools.
if (process.platform === "darwin") {
    const fs = require("fs");
    const directories = (process.env.PATH || "/usr/bin:/bin:/usr/sbin:/sbin").split(":");
    for (const directory of ["/opt/homebrew/bin", "/usr/local/bin", "/Applications/Docker.app/Contents/Resources/bin"]) {
        if (!directories.includes(directory) && fs.existsSync(directory)) {
            directories.push(directory);
        }
    }
    process.env.PATH = directories.join(":");
}
'''
    plugin_entry = plugin / "dist/index.js"
    updates[plugin_entry] = replace_once(
        plugin_entry.read_text(), "this.runner.installCrashHandlers();",
        "this.runner.installCrashHandlers({ exitProcess: false });",
    )
    runner = plugin / "bundled/workflow-runner/dist/index.js"
    runner_text = replace_once(
        runner.read_text(), "    installCrashHandlers() {",
        "    installCrashHandlers({ exitProcess = true } = {}) {",
    )
    if runner_text.count(".finally(() => process.exit(1));") != 2:
        raise ValueError("Expected exactly two runner exit handlers")
    updates[runner] = runner_text.replace(
        ".finally(() => process.exit(1));",
        ".finally(() => { if (exitProcess) process.exit(1); });",
    )
    # Validate every expected input before writing any staged output.
    for path, content in updates.items():
        path.write_text(content)
        print(path)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    patch(Path(sys.argv[1]), Path(sys.argv[2]))
