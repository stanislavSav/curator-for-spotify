# 01 — Server: Set Templates and drafts

## Goal

Let the user save their own Set Templates, and save a DJ Set as a Draft that is created on Spotify later.

## What changed

- `features/dj/sets.ts`: summaries have `status` (from the row) and `updatedAt`. New `saveDjDraft`, `updateDjDraft`, `deleteDjSet`, `createDjDraftOnSpotify`. `saveDjSetResult` moves `updated_at` when the set is a draft, so sheet edits and AI passes on a draft count as changes.
- `features/dj/templates.ts`: list, get, create, update, delete. `templateConfig()` strips tracks and, without the Pool, stores the default Pool.
- `features/dj/schema.ts`: `djDraftSchema`, `djDraftUpdateSchema`, `djTemplateInputSchema`, `djTemplatePatchSchema` (all use `incomingConfig`).
- Routes under `/api/dj`:

| Route | Answer |
|-------|--------|
| `GET /templates` | `DjTemplate[]`, newest first |
| `POST /templates` | 201 `DjTemplate`; 400 invalid; 409 name exists (case-insensitive) |
| `PATCH /templates/:id` | `DjTemplate` (any subset of name, includePool, config); 400, 404, 409 |
| `DELETE /templates/:id` | 204; 404 |
| `POST /drafts` | 201 `DjSetRecord` with status `draft`; no Spotify call |
| `PUT /sets/:id` | `DjSetRecord`; 409 for a created set ("Created sets can't be replaced; save a new draft.") and while the draft is being created |
| `POST /sets/:id/create` | 202 `{ job, setId }` (job kind `create-dj-set`); 409 when created or a create runs; 403 in demo mode |
| `DELETE /sets/:id` | 204 for any status; 404; 409 while the draft is being created |

## Decisions

| Question | Answer |
|----------|--------|
| What does a template store? | Settings only. `startTrackId`, `lockedTrackIds` and `excludedTrackIds` are always empty. Without "Include Pool" the Pool is the default and is ignored on apply. |
| PATCH `includePool: true` without a config | Keeps the stored Pool (the default when it was off). The page sends the config with it. |
| Name conflict | Trimmed names compare without case, in JS (SQLite `lower()` only folds ASCII). Built-in templates live in the web app and are not checked. |
| Draft timestamps | `updatedAt` is null until the first change. Rename, replace, a transition edit and an AI pass set it. Creating on Spotify keeps `createdAt` and `updatedAt`. |
| Create a draft later | Uses the draft as it was when the job started. A failed create leaves the draft as a draft. |
| Delete | Removes only the record in the app. **A created playlist stays on Spotify**; the user deletes it there. |
| Old rows | `status` defaults to `created`. A `created` row without a playlist id (an old failed create) stays as it is. |
| Demo mode | `POST /drafts` and `PUT /sets/:id` are local and work. `POST /sets/:id/create` answers 403 with the demo message in the route, because the guard only blocks `POST /api/dj/sets`. |

## How to verify

- `npx vitest run apps/server/src/features/dj`
- `npx tsc -p apps/server`

## Parking lot

- Add `POST /api/dj/sets/:id/create` to `BLOCKED` in `apps/server/src/demo/guard.ts` (outside this workstream; the route checks demo mode itself for now).
- Sort "Earlier sets" by last change (`updatedAt ?? createdAt`) instead of `createdAt`.
