# 04 — Integration (main session)

## What changed

- Demo guard blocks `POST /api/dj/sets/:id/create` (creating a Draft on Spotify); `POST /api/dj/drafts` stays allowed. The test covers both.
- `.gitignore`: Full Backup file names (`spotify-curator-backup*.json*`, `*.curator-backup.json*`), on top of the privacy-guard rule.
- README: DJ row mentions Set Templates and drafts; new "Full Backup" feature row; privacy note on Full Backup files.

## Checked

- Typecheck, 338 Vitest tests (+1 live skipped), 11 guard tests, `check:public`, build.
- API round trip in the demo:
  - Saving a template returns 201; saving a draft returns 201 with status `draft`; creating that draft on Spotify returns 403 in demo mode.
  - The export is an attachment `spotify-curator-backup-<date>.json` with no auth data, and `library` is null when it is not asked for.
  - Re-importing that file previews every item as "unchanged".
  - The test template and draft were deleted afterwards.
- The web agent checked the templates and drafts UI, and the backup agent checked the backup card (preview, choices, import, DJ settings restore), each on demo side ports.
