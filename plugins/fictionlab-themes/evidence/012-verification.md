# Themes 0.1.2 verification — 2026-09-19

## Automated

`npm --prefix plugins/fictionlab-themes run build` and `npm --prefix plugins/fictionlab-themes test` passed. Six tests cover:

- Strict color/font/size validation and preset text contrast.
- Atomic storage, invalid-file preservation, and persistence outside the replaceable code directory.
- Real backend handlers with an Electron lifecycle double: preview/cancel/apply, duplicate and empty name rejection, rename persistence, five-theme boundary, invalid reference rejection without mutation, deletion of inactive and active themes, CSS retention, reload, disable cleanup, reactivation, and over-limit legacy library management.
- Exact legacy-byte backup before the first migrated write; all six legacy entries preserved in an over-limit fixture.
- Distinct named identities for identical appearances, exact-match migration inference, and unnamed customization.
- Dark native color scheme, semantic status contrast on preset workspace/card surfaces, distinct hover colors (including black/white extremes), caret spacing and focus rules.

## Native FictionLab 0.9.1, macOS arm64

- Existing custom theme `new-2-me` correctly inferred as applied; neither built-in light preset incorrectly marked Applied.
- Saved-theme count showed 2/5. The selected custom name and applied label survived restart.
- Inline Rename opened with the existing name; saving that unchanged name succeeded. Actual rename and duplicate rejection were exercised in backend tests.
- Delete opened an explicit confirmation; Cancel preserved the user's theme. Actual deletion was exercised only on test fixtures.
- Dark preview retained the separate original applied label. Applying Dark updated the label and appearance. Cancel later restored the named custom theme and dropdown selection.
- Dark mode visually checked on Themes, Dashboard, Kanban, and Workflows, including the collapsed icon rail. Workflow list retained all 16 definitions. Native selects remained usable.
- Original custom appearance was restored after dark-mode checks and verified in the screenshot. A later independent settings change selected Electric Creative; that latest selection was left intact. Both pre-existing custom entries were preserved exactly.
- Screenshots: `012-dark-applied.png` and `012-custom-applied.png`. The dark screenshot predates a final spacing adjustment grouping Rename/Delete beside the selector; the custom screenshot shows the final layout.

## Delivery and limits

Plugin code and original settings backed up under:
`~/Library/Application Support/fictionlab/backups/themes-012-20260919-092132/`

The automatic migration also created an exact `themes.json.v1-<unique-id>.bak` beside settings. Rollback to 0.1.1 requires restoring the v1 settings backup because it cannot read schema v2.

No host application archive or workflow definitions changed. Compatibility remains `>=0.9.1 <0.10.0`; Windows and other app versions are unverified. Internal host CSS names remain an integration dependency. Custom mixed-brightness surfaces may still require manual contrast adjustment.

The parent application build was accidentally invoked once and stopped because its TypeScript toolchain is absent; it did not compile the application. The plugin's dependency-free build and tests above are the relevant successful checks.
