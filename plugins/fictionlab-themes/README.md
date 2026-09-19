# FictionLab Themes

A dependency-free appearance plugin for FictionLab 0.9.1. Open **Themes** in the sidebar.

- **Near Black & White:** quiet neutral surfaces and charcoal navigation.
- **Electric Creative:** deep indigo navigation, pale paper, ember accents, Hanken Grotesk body text, Bricolage Grotesque headings, and JetBrains Mono technical text.
- **Customize colors & fonts:** eleven color roles with native color pickers and hex entry, separate body/heading/code font selectors, and a 12–20px base interface size.

Changes preview immediately. **Apply theme** keeps the current appearance. **Cancel preview** restores the last applied appearance; leaving Themes also cancels an unapplied preview. **Reset to preset** previews the original values of the selected preset. **Save as new theme** saves a named copy and applies it. Select a saved theme from the menu to preview it. **Original FictionLab**, followed by Apply, removes the theme override.

Fonts are bundled or use system fallbacks; there are no font downloads. The font selector offers six curated families, not every font installed on the computer. Contrast warnings identify selected text/background combinations below 4.5:1; they do not prevent saving personal choices. Status colors retain their meaning in both presets.

## Build and install

Version 0.1.1 gives standard single-choice dropdowns a consistent 14px arrow inset and reserves room for the arrow. This shared rule applies across the app while a theme is active; custom dropdown widgets and native OS menus keep their own controls.

```sh
cd plugins/fictionlab-themes
npm run build
npm test
```

There are no npm dependencies to install. The distributable folder needs `plugin.json`, `package.json`, `dist/`, `dist-renderer/`, and `assets/`. Unzip the packaged release, then use FictionLab's folder installation/import flow to select the directory containing `plugin.json`. Restart FictionLab after installation if Themes does not appear.

For a manual macOS installation, quit FictionLab and copy that folder to:

```text
~/Library/Application Support/fictionlab/plugins/fictionlab-themes
```

Keep a backup of any existing plugin folder before replacing it. Restart FictionLab. Disable/uninstall through the plugin manager to remove its injected styles; saved settings remain available if you reinstall.

## Saved settings and integration

Settings are written atomically to `<userData>/plugin-settings/fictionlab-themes/themes.json`, outside the replaceable plugin code folder. Both the applied appearance and named themes survive code replacement and restart. Invalid settings are preserved and reported rather than overwritten. No manuscript, project, database, or workflow data is changed.

The backend uses FictionLab's existing plugin IPC and Electron's `insertCSS`/`removeInsertedCSS` lifecycle. The renderer is a standard plugin main view. The plugin does not patch the application archive. FictionLab plugins execute as trusted application code; manifest permissions are not a sandbox.

Theme variables cover the host shell, Dashboard, settings, dialogs, and token-based plugin views, including the installed Kanban and Workflow plugins. Native macOS dialogs/menus, embedded third-party pages, and hardcoded plugin colors can retain their own appearance. Existing fixed-pixel text does not necessarily scale with the base interface size. The previous macOS toolbar spacing fix is preserved. This release is checked on macOS arm64 with FictionLab 0.9.1; other platforms and host versions are unverified.

## Verification

Automated tests exercise the real backend with an Electron lifecycle double: preview/cancel/apply, named saving and duplicate rejection, document reload, disabling/removing CSS and listeners, reactivation, validation, and atomic settings persistence across replacement of the plugin code folder. These tests do not substitute for Electron rendering checks.

Manual checks in FictionLab 0.9.1 cover both presets, Apply/Cancel, the Dashboard, Kanban, Workflows, the customization controls, and restarting with a saved custom appearance. Screenshots are in `evidence/`. No workflow was executed or manuscript changed during verification.

Bundled fonts retain their individual OFL license notices under `assets/fonts/`.
