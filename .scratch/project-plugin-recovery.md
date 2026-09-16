# Project and plugin checks — September 16, 2026

## Reported issues

Carlo could not create a project, and the Kanban and Workflow plugins had disappeared and would not reload.

## Plugin recovery

Both installed plugin folders remained present under `~/Library/Application Support/fictionlab/plugins/`:

- `fictionlab-kanban` 1.1.4
- `fictionlab-workflow` 1.4.0

At 16:23:31, `main.log` recorded an app quit attempt, deactivation of both plugins, plugin-registry cleanup, and database-pool closure. The application continued to handle UI requests afterward. The UI displayed “No Plugins Found,” although the packages were still installed. Why that quit attempt did not terminate the application was not conclusively established.

Quit the app normally, then relaunched `/Applications/FictionLab.app/Contents/MacOS/FictionLab` with these directories prepended to its inherited PATH:

```text
/opt/homebrew/bin:/usr/local/bin:/Applications/Docker.app/Contents/Resources/bin
```

This is a session-only workaround for the previously observed missing Node/Docker executable errors. No application bundle or global environment settings were changed.

Verified after restart:

- Logs show both plugins activated successfully at 16:29:05–16:29:09.
- Kanban displays `my-first-kanban` with the completed setup/documentation card in Done.
- Workflows displays the existing `my-first-workflow` version 0.1.0.
- Workflow backend `list_active_workflows` calls succeed.

The plugin listing briefly showed Workflow as inactive while startup was still progressing; subsequent activation logs and the functioning Workflow view confirmed recovery.

## Project creation

Carlo specified the final project name **Superposition** and existing folder `/Users/carlo/BOOKHUB/superposition` (superseding an earlier proposed name).

Used the native app UI: Workflows → No Project Selected → Create New Project. Disabled **Initialize workspace structure**, because this is an existing writing workspace. No genre pack or template initialization was requested.

Creation succeeded:

- Database: `mcp_writing_db`, table `public.projects`
- ID: `1`
- `project_name`: `Superposition`
- `folder_location`: `/Users/carlo/BOOKHUB/superposition`
- Saved at 16:32:09 local time
- The helper returned success at 16:32:14, roughly six seconds after submission.

The temporary “Creating…” state was not a permanent hang. An initial hypothesis about a stuck helper was superseded by the completion log. However, that log says `Project created successfully: undefined`, suggesting the returned project's shape or ID extraction still needs investigation.

Verified the project appears in the dropdown. Clicking it displays `Project "Superposition" selected`, but the header still says `No Project Selected`. Registration is complete; active-project selection is not verified as working and remains a reproducible UI/state defect.

The version 0.7.1 source also exposes a project selector on Dashboard, while the inspected project-creation event listener is in the Workflow plugin. The core `file-new-project` action is a TODO. Developer review should check every visible creation entry point rather than assuming they share the working Workflow dialog.

## Remaining developer work

1. Investigate quitting/cleanup leaving a live app with an emptied plugin registry; ensure cancelled or interrupted quits preserve/recover plugin state.
2. Resolve Node and Docker executable paths consistently for Finder launches.
3. Normalize project-creation responses and make selected-project state agree with the header and workflow context.
4. Wire all visible New Project actions to a functioning dialog.

This session recovered the plugins and registered the requested project. It did not patch/rebuild the application, run an AI workflow, or modify manuscript contents. Other database migrations had changed since the earlier Kanban setup; no migrations were applied during this recovery session.
