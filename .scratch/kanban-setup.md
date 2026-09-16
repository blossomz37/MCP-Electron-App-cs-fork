# FictionLab Kanban setup — September 16, 2026

Created `my-first-kanban` for Carlo and verified that it opened in the installed FictionLab 0.7.1 application with three empty columns:

| Display name | Stored status | Position |
|---|---|---|
| To Do | `backlog` | 0 |
| In Progress | `in_progress` | 1 |
| Done | `done` | 2 |

Board ID: `db1557e8-8292-4c15-b602-62c32dacdb6b`.

## Initial problem

The plugin package inspected was `dist/fictionlab-kanban-plugin (10)`. Its board handlers call the Kanban MCP backend, which expects PostgreSQL tables under the `fictionlab` schema.

The running database contained no Kanban tables and no `fictionlab.active_workflows` table, which the Kanban cards table references. Installing the plugin had not produced those tables on this installation.

## Database and backup

- Container: `fictionlab-postgres`
- Database: `mcp_writing_db`
- Database user: `writer`
- Host connection: `localhost:5433`
- Persistent Docker volume: `docker_postgres_data`
- Container data directory: `/var/lib/postgresql/data`

Before changing the database, created a full custom-format `pg_dump` backup with file permissions `0600`:

`/Users/carlo/Library/Application Support/fictionlab/backups/kanban-setup-20260916-161611/before-kanban.dump`

The same backup directory contains:

- `setup.sql`: the exact SQL applied, including the migrations and board creation.
- `result.log`: PostgreSQL output and migration notices.

The backup was created successfully; a restore rehearsal was not performed. No database passwords or tokens are recorded in this note.

## Changes applied

Applied these existing migration files from:

`/Users/carlo/Library/Application Support/fictionlab/repositories/mcp-writing-servers/migrations/`

1. `032_fictionlab_schema_migration.sql` — creates the workflow schema and tables required by the Kanban foreign key, plus the migration's bundled functions and view.
2. `042_kanban_tables.sql` — creates boards, columns, cards, links, comments, activity, and triggers.
3. `043_kanban_cards_add_due_at.sql` — adds card due dates and their index.
4. `044_kanban_identities.sql` — creates identities and replaces the hardcoded human-assignee rule with identity-based handling.
5. `047_kanban_cards_pr_ref_unique.sql` — adds the card deduplication index.

All migrations and the new board were applied in one transaction with `ON_ERROR_STOP=1`. Before migration 032, an explicit guard confirmed that the two legacy tables it would drop (`public.workflow_version_locks` and `public.workflow_approvals`) did not exist. No existing tables were removed.

The bundled migrations also seeded their standard `dev-backlog` board and `rebecca` human identity. Those defaults were retained.

Created the requested board directly in PostgreSQL because the inspected board handler exposed read operations, not board creation:

- Board key/name: `my-first-kanban`
- Created by: `carlo`
- Columns: the three listed above, with `is_agent_pickup=false`
- Added `carlo` / `Carlo` as a human identity, using `ON CONFLICT DO NOTHING`
- Created no cards

This was a bounded Kanban setup, not a full database migration/update. Other pending migrations were not applied.

## macOS launch workaround

After database setup, the app still showed “No kanban boards found.” Its log repeatedly reported `spawn node ENOENT`.

Quit FictionLab normally and launched its executable directly with these directories prepended to the inherited `PATH`:

```text
/opt/homebrew/bin
/usr/local/bin
/Applications/Docker.app/Contents/Resources/bin
```

Executable:

`/Applications/FictionLab.app/Contents/MacOS/FictionLab`

Launch output was appended to:

`/Users/carlo/Library/Application Support/fictionlab/logs/local-launch.log`

This changed the environment of that launch only. It did not modify the application bundle, global shell settings, or Finder's launch environment. Reopening from Finder may reproduce the missing-tool errors; a permanent application fix remains outstanding.

## Verification and remaining limits

- PostgreSQL confirmed the board and all three columns were saved.
- Invoked the actual Kanban `BoardHandlers.handleGetBoard` implementation inside `fictionlab-mcp-servers`, using its database connection. It returned the correct board and three columns, each with zero cards.
- After relaunch, app logs confirmed successful `list_boards`, `list_identities`, `get_board`, and `list_cards` calls.
- The native app displayed `my-first-kanban` selected, with To Do, In Progress, and Done visible.
- Card creation, movement, and persistence across another restart were not tested.
- A separate workflow-manager error remained: `column awr.completed_node_ids does not exist`. It was not addressed as part of creating this Kanban board.

No application source code or port configuration was changed for this setup. No changes were pushed to the upstream repository.
