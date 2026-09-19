# Building our own FictionLab plugins

Research date: 2026-09-18. Target: installed FictionLab **0.9.1**, Apple Silicon.

## Conclusion

We can build independently packaged plugins with their own navigation entry, UI, backend operations, settings, and access to FictionLab's database and supported MCP servers. A new screen does not require rebuilding the 0.9.1 app. React is optional. Start with a small, read-only feature and validate installation, navigation, cleanup, and update persistence before adding manuscript mutations.

This guide is based on inspection, not a newly installed proof-of-concept. No plugin was created or installed during this research.

## Evidence and version boundary

The installed archive is the primary implementation reference:

`/Applications/FictionLab.app/Contents/Resources/app.asar`

SHA256 at inspection: `fa82fdd238c405920bd0222700c62c3267d711c352de37a12a2f70b8e33d54d6`.

The checkout was at `4e8512b` before this guide. Its plugin types and renderer wiring lag the installed app: the checkout manually registers Kanban and Workflows, whereas installed 0.9.1 uses a generic plugin view loader. Do not compile a new plugin against those older types without checking the runtime contract.

Primary references:

- [Upstream development guide at v0.9.1](https://github.com/RLRyals/MCP-Electron-App/blob/v0.9.1/docs/plugin-development-guide.md) — useful introduction, but not sufficient as an exact runtime contract.
- Installed `dist/main/plugin-loader.js`: discovery, manifest validation, exports, bundled dependencies.
- Installed `dist/main/plugin-context.js`: actual services and permissions; `dist/main/plugin-registry.js`: activation and cleanup.
- Installed `dist/renderer/services/pluginViewLoader.js`: current UI registration contract; `dist/renderer/components/ViewRouter.js`: view lifecycle.
- Installed `dist/main/index.js`, handler `plugin:get-renderer-url`: bundle resolution and directory containment.
- Installed `dist/preload/preload.js`: renderer bridge.
- Installed `dist/main/plugin-update-swap.js`: folder replacement/update behavior.
- Installed examples: `/Users/carlo/Library/Application Support/fictionlab/plugins/fictionlab-kanban/` and `fictionlab-workflow/`.

At inspection the plugin manifests reported Kanban **1.2.0** and Workflow **1.5.3**. Package metadata and class version fields can lag the manifest (Kanban's class still says 1.1.1). Keep our own manifest, package, and class versions synchronized. The earlier locally patched Workflow version is not a pristine upstream reference.

Extracted inspection copies are temporarily at `/tmp/fictionlab-091-plugin-reference/`; re-extract from the installed archive if absent. The archive paths above are the durable source locators.

## How a plugin works

```text
plugin.json
  ├─ entry.main → CommonJS backend → onActivate(context)
  │                                  └─ namespaced IPC handlers → host services
  └─ entry.renderer + ui.mainView → browser ES module → view class
                                                      └─ mount / unmount
                                                           ↕
                                              window.electronAPI.invoke
```

The backend runs inside Electron's main process. The modern plugin view runs inside the host renderer, sharing its document. These are trusted extensions, not sandboxed third-party programs. Scope CSS to the plugin root and keep backend work off the UI thread when it is expensive.

The host scans `app.getPath('userData')/plugins`. On this Mac that is:

`/Users/carlo/Library/Application Support/fictionlab/plugins/`

It discovers plugin directories containing `plugin.json`, validates manifests, loads backend exports, orders dependencies, and activates plugins. Hidden/backup/staging directories are skipped. Use a distinct plugin ID; do not overwrite existing plugins to experiment.

## Minimal package contract

```text
fictionlab-author-tools/
  plugin.json
  package.json                 # CommonJS package, or omit type
  dist/index.js                # Backend CommonJS
  dist-renderer/index.js       # Self-contained browser ES module
  README.md
  node_modules/                # Only if required at runtime and not bundled
```

Illustrative manifest, not an installed plugin:

```json
{
  "id": "fictionlab-author-tools",
  "name": "Author Tools",
  "version": "0.1.0",
  "description": "Small author utilities for FictionLab",
  "author": "Carlo Santiago",
  "fictionLabVersion": ">=0.9.1 <0.10.0",
  "pluginType": "utility",
  "entry": { "main": "dist/index.js", "renderer": "dist-renderer/index.js" },
  "permissions": { "database": false, "mcp": [], "fileSystem": false },
  "ui": {
    "mainView": "carlo-author-tools",
    "mainViewLabel": "Author Tools",
    "mainViewIcon": "📝"
  }
}
```

The narrow host version range is a proposed initial support policy, not proof of compatibility with every 0.9.x build. Broaden it after testing.

Backend sketch:

```js
class AuthorToolsPlugin {
  constructor() {
    this.id = 'fictionlab-author-tools';
    this.name = 'Author Tools';
    this.version = '0.1.0';
  }
  async onActivate(context) {
    this.context = context;
    context.ipc.handle('status', async () => ({
      appVersion: context.services.environment.getAppVersion()
    }));
  }
  async onDeactivate() {
    this.context?.ipc.removeHandler('status');
    this.context = null;
  }
}
module.exports = AuthorToolsPlugin;
```

Renderer sketch (browser ESM, not CommonJS):

```js
export default class AuthorToolsView {
  async mount(container) {
    const panel = document.createElement('section');
    panel.className = 'carlo-author-tools';
    panel.textContent = 'Loading…';
    container.replaceChildren(panel);
    this.panel = panel;
    try {
      const status = await window.electronAPI.invoke(
        'plugin:fictionlab-author-tools:status'
      );
      if (this.panel === panel) panel.textContent = `FictionLab ${status.appVersion}`;
    } catch (error) {
      if (this.panel === panel) panel.textContent = `Unable to load: ${error.message}`;
    }
  }
  async unmount() {
    this.panel?.remove();
    this.panel = null;
  }
  getTopBarConfig() { return { title: 'Author Tools', actions: [] }; }
}
```

The loader needs an active plugin, `entry.renderer`, and `ui.mainView`. It dynamically imports the renderer bundle and expects a default-exported class whose prototype has `mount`. Supply `unmount` for cleanup. Optional `getTopBarConfig` and `handleAction` support toolbar actions. Unique view IDs matter; do not reuse `kanban`, `workflows`, or host routes.

Build TypeScript backend code as CommonJS, leaving `electron` external. Bundle UI code for browsers as ESM, including any React/runtime dependencies it uses; do not leave bare npm imports for the file-based browser loader. A simple UI can use plain DOM and avoid a framework. Keep runtime dependencies self-contained rather than assuming the host's node_modules will resolve for an external plugin.

Version bumps matter: renderer imports use `?v=<manifest.version>` to invalidate the module cache. Restart the app for backend changes; do not treat renderer refresh as a complete plugin reload.

## Services we can use

| Capability | Actual 0.9.1 behavior / design implication |
| --- | --- |
| Backend IPC | `context.ipc.handle('operation', handler)` prefixes `plugin:<id>:`. Renderer invokes the full name. Validate arguments and return serializable values; surface failures. |
| Settings | `context.config.get/set/has/delete/all/clear`; JSON-backed. Suitable for small settings, not secrets or manuscript authority. |
| Database | `context.services.database.query(sql, params)` returns **rows**, not pg's full result. Transactions receive a raw pg client. `createPluginSchema/getPluginSchema` use `plugin_<id_with_underscores>`. |
| Files | `readFile/writeFile/exists/mkdir/readdir/delete/stat`. Boolean or `readonly` permission gates the wrapper, but paths are not confined to an author project. Use explicit absolute approved project paths. |
| MCP | `context.services.mcp.callTool(serverId, toolName, args)` enforces the declared server list. `workflow-manager` and `kanban` use special stdio clients; other mapped servers use HTTP `/api/tool-call`. A new arbitrary server requires checking host endpoint support, not just adding its name to the manifest. |
| Workflow helpers | Available with workflow-manager permission; include import/delete/source lookup and runtime version-history helpers. Avoid duplicating the existing workflow runner when only a new sequence is needed. |
| Identity | Runtime provides `context.services.identity.getCurrentUser()`. Older checkout types omit this. |
| Environment | App version, userData, development flag, and process environment lookup. Do not log credentials. |
| UI | Menu registration, notifications, and modern `showView(viewId)` routing exist. Use the exact mainView ID. |
| AI | No general model-generation service appears in the inspected PluginContext. Reuse supported workflows/MCP or deliberately design a provider integration; do not assume an LLM API exists because the host has AI features. |

## Important documentation gaps

1. **Modern screens:** prefer the generic ESM view loader. Older webview/HTML and separate-window paths still exist but are not the modern Kanban/Workflow screen pattern.
2. **Workspace name is misleading:** `context.workspace.root` equals the app's userData directory, not the selected novel folder. Resolve and verify the intended project separately before file operations.
3. **Some methods are placeholders:** `context.ipc.send` only logs; `context.ui.showDialog` returns `{response: 0}` without opening a dialog; `updateStatusBarItem` only logs. Never treat that dialog return as user consent.
4. **Event push:** Kanban uses `BrowserWindow.webContents.send` directly, with renderer `electronAPI.on/off`; it does not rely on the placeholder context sender. Prefer request/response first; add narrowly named push events only when needed.
5. **Permissions are not isolation:** backend modules load with Node `require`; the raw database pool is exposed; schema restriction uses a limited SQL regex. The generic renderer bridge accepts channel names. Design trusted plugins and explicit operation boundaries, not a security claim based on manifest flags.
6. **Permission formats vary:** simple booleans and server arrays work; MCP additionally understands `{enabled, servers}`. Other object-shaped permissions in Workflow are often accepted via truthiness, not uniform validation. Prefer the simple typed forms for ours.
7. **Durability needs deliberate handling:** config and `getPluginDataPath()` live inside the installed plugin directory. The inspected folder-update swap replaces that directory and does not merge old config/data. Keep durable author data outside it or implement and verify migration/backup before updates. Do not equate atomic code replacement with preserved settings.
8. **Activation failure cleanup:** activation exceptions set an error state; the registry's normal deactivate path only runs for active plugins. Roll back partially registered handlers/resources inside our activation catch block.
9. **Host lifecycle belongs to the host:** no `process.exit`, app quit, or global crash-handler ownership in a plugin. Our earlier failure showed how an unrelated updater rejection can terminate the app when a plugin does this.

## What the existing plugins teach us

**Kanban is the better small reference.** Its backend registers domain-specific IPC handlers that call the Kanban MCP server. The renderer bundles its own React UI and default-exports a view class. It holds a PostgreSQL LISTEN connection for live updates, releases it on deactivation, and has refresh fallbacks. Copy the architecture, not every feature or permission.

**Workflow is an advanced integration reference.** It injects MCP and Electron adapters into a bundled runner, exposes workflow operations through IPC, and runs an IDE socket bridge. It also installs a global Claude skill during activation. That side effect is not a requirement of plugins and should not be copied into our starter. The existing `/Users/carlo/.myagents/skills/run-workflow/` is relevant if the goal is a new workflow rather than a new plugin screen.

The loader can materialize packages from a plugin's `bundled/` directory into its node_modules. This is useful for intentional shared packages, not needed for a first utility.

## Recommended development and acceptance sequence

1. Choose one author-facing operation. Check whether an existing Workflow definition already covers it; use a plugin when we need a persistent screen, custom interaction, or integration.
2. Create a separate source folder/repository and a distinct ID. Build a manifest/backend/renderer package against the inspected 0.9.1 contracts. No host rebuild for a normal plugin view.
3. First prove one sidebar view and one read-only IPC round trip. The snippets above are a contract sketch; they have not been installed or runtime-tested.
4. Test unknown/invalid inputs, dependency failure, navigation away during pending work, repeated mount/unmount, activation failure rollback, and handler cleanup.
5. Install a built copy into the actual userData plugins directory, then restart. Keep a clean package backup and inspect plugin logs. Do not modify the only working installation in place during development.
6. Add persistence with a defined storage path and versioned migration. Test restart and a real update with existing settings/data.
7. For manuscript edits, show a proposal and diff, require explicit Apply, block stale targets, and preserve an exact backup. Markdown remains creative authority; database/index results are derived references.
8. Package compiled outputs, manifest, required dependencies/assets, and concise install/rollback instructions. Do not bundle credentials, local config, or author files. Verify on this Mac before claiming portability.

Proposed first useful plugin: a **read-only manuscript/context inspector** for an explicitly chosen project, listing source files and basic counts. An NPE/ghost-draft review screen is a plausible later feature, but its creative rules and AI execution contract need a separate brief.

Research complete. Next decision: the first plugin's single useful job. Building/installing it is the next task; this guide does not claim that proof has already been run.
