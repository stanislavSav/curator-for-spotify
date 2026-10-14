# 03 — Web: Set Templates, drafts, Earlier sets

## Goal

Let the user save and manage Set Templates, save a DJ Set as a Draft, open, edit and create drafts on Spotify later, and find drafts in "Earlier sets".

## What changed

- `apps/web/src/pages/dj/TemplatesRow.tsx` (new): the Set Templates row at the top of the left panel. Built-in chips, then the user's templates (outlined chips; a green dot when the template has its own Pool; "More…" after 6). "+ Save" opens a small form: name ("My set 14 Oct"), "Include Pool" with the current Pool summary. A 409 asks "Replace it?" and then PATCHes the existing template. Right-click or ⋯ on a user chip: Rename, Update with current settings, Delete (with a confirm). Applying a template rebuilds at once.
- `apps/web/src/pages/dj/ConfigPanel.tsx`: takes the row as a `templates` slot (the built-in chips moved into `TemplatesRow`).
- `apps/web/src/pages/dj/saved.ts` (new, tested in `saved.test.ts`): `applyUserTemplate`, name suggestions, `templateNamed`, `isDraft`, `filterSets`, `countSets`.
- `apps/web/src/pages/dj/hooks.ts`: `useDjTemplates()`; `rebuild(carryFrom?)` carries a saved set's edits and AI values onto the next build.
- `apps/web/src/pages/dj/DraftHeader.tsx` (new): a draft's header with the badge "Draft — not on Spotify yet", Create on Spotify (with a confirm, job progress), Rename, Delete draft, Use these settings.
- `apps/web/src/pages/dj/EarlierSets.tsx` (new): status badges, a filter (All / Drafts / On Spotify), "Updated …" for drafts, Delete with a confirm (for created sets: "The playlist stays on Spotify").
- `apps/web/src/pages/DjPage.tsx`: Save draft next to Create on Spotify; "Update draft “…”" when the builder came from a draft; draft views hide the Applied ticks.

## Decisions

- Without its Pool, a user template keeps the current Pool and the current locked, removed and start tracks: they belong to that Pool. With its Pool, the template replaces the whole config.
- "Use these settings" now also takes the saved set's seed and carries its edits and AI values onto the rebuild (for drafts and created sets), so the rebuilt set is as close to the saved one as the Library allows.
- After Save draft, the builder counts as "from" that draft, so a later change can be saved with Update draft. Create on Spotify or Delete of that draft clears the link.
- Save forms are inline panels under the chips, not floating popovers, so the left panel's scroll area cannot clip them.

## How to verify

1. `npx vitest run apps/web` and `npx tsc -p apps/web`.
2. `PORT=8798 WEB_PORT=5184 npm run demo`, open DJ Set: save a template with and without the Pool, save it again with the same name (Replace), rename and delete it. Save a draft, edit a pair, use "Use these settings", then "Update draft". Create on Spotify shows the demo error. Delete the draft from the header or from "Earlier sets".

## Parking lot

- Keyboard navigation inside the template manage menu.
- Show what a template changes (a diff) before applying it.
