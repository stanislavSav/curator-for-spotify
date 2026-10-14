# 008 — Set Templates, DJ Set drafts, Full Backup

**Status:** done (2026-10-14)
**Started:** 2026-10-14

## Contract (main session)

- DB: `dj_templates` table; `dj_sets.status` (`draft` | `created`) and `updated_at`, added by `migrate()` in `db.ts`.
- `packages/shared/src/dj.ts`: `DjSetStatus`, `DjSetSummary.status/updatedAt`, `DjDraftRequest`, `DjDraftUpdate`, `DjTemplate`, `DjTemplateInput`.

## Workstreams

| # | Workstream | Owner | Task file |
|---|------------|-------|-----------|
| 1 | Server: template CRUD, drafts (save, update, create on Spotify later, delete), tests | subagent | `tasks/01-server-templates-drafts.md` |
| 2 | Full Backup: export/import service and endpoints, shared `backup.ts`, Setup page card, privacy-guard rule for backup files, tests | subagent | `tasks/02-full-backup.md` |
| 3 | Web: Save template / manage templates, Save draft, Draft badges, open/edit/create drafts | subagent | `tasks/03-web-templates-drafts.md` |
| 4 | Integration, demo check, docs, commit | main session | `tasks/04-integration.md` |
