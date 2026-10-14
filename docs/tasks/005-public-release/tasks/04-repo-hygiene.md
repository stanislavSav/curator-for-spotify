# 04 — Repo hygiene

**Status:** done (2026-10-14)

## Goal

Make the repo ready to be public, MIT-licensed and fork-only: licence, CI, a privacy guard that runs on every commit and in CI, a forking guide, and task docs with no personal details.

## What changed (files)

| File | Change |
|------|--------|
| `LICENSE` | New. MIT. |
| `CONTRIBUTING.md` | New. Forking guide: fork and run, layout, checks, docs workflow, privacy guard, bug reports. |
| `scripts/check-public.mjs` | New. Privacy guard CLI. Default: all files from `git ls-files --cached --others --exclude-standard`. `--staged`: only staged changes, read from the index with one `git cat-file --batch`. `--markers <file>`: another markers file. Exit 0 / 1 (findings) / 2 (not a git repo). |
| `scripts/lib/check-public-rules.mjs` | New. Pure rules: `checkPath`, `scanText`, `parseMarkers`, `mask`, `isBinary`. |
| `scripts/lib/check-public-rules.test.mjs` | New. `node:test` tests (9). |
| `scripts/install-hooks.mjs` | New. Runs on `prepare`. Sets `core.hooksPath=.githooks` if it is not set. |
| `.githooks/pre-commit` | New, executable. POSIX sh: `node scripts/check-public.mjs --staged`. |
| `.github/workflows/ci.yml` | New. Push to `main` + manual run: checkout, Node from `.nvmrc` with npm cache, `npm ci`, `check:public`, guard tests, `typecheck`, `test`, `build`. |
| `.private-markers.example` | New. Format of the personal markers file. |
| `.gitignore` | Added: `.env.*` (except `.env.example`), `.private-markers`, DB files, `backups/`, keys, Spotify export folders, `coverage/`. |
| `.editorconfig`, `.nvmrc` | New. 2 spaces, LF, UTF-8, final newline. Node 22. |
| `docs/tasks/002-grilling/tasks/decisions-log.md` | Account answer and a user quote neutralised. |
| `docs/tasks/004-enrich-transparency/plan.md`, `parking-lot.md` | Library numbers and user quotes replaced with neutral wording. |
| `docs/tasks/001-research/tasks/03-playlist-usage-signals.md` | Export file names as a pattern, not a real year range. |

## Decisions

| Decision | Why |
|----------|-----|
| Rules in `scripts/lib/` with `node:test`, not Vitest. | Vitest includes only `apps/*` and `packages/*`. No config change and no new dependency. CI runs the tests. |
| Path rules always win, except an allowlist: `data/.gitkeep`, `.env.example`, `fixtures/*.sample.json`. | A private file must never pass because of its content. |
| `snapshot*.json` / `proposals*.json` are blocked by name, not only the exact names. | Copies like `proposals.old.json` hold the same data. |
| The generic secret rule needs a literal value (quoted, or an env-style line) of 20+ characters with letters and digits, and skips placeholders (`fake`, `example`, `${…}`, …). | Code like `token: tokens.refresh_token` must not fail. The current tree has no false positives. |
| Secrets are masked in the output; markers print their label. | CI logs are public. Markers come from your own local file. |
| `.private-markers` is blocked as a path too. | If `.gitignore` is changed by mistake, the file with your name in it must not be published. |
| Allowlist by line: `check-public-ignore` on the same line. | Small and visible in review. |
| Staged mode reads blobs from the index. | It checks what is committed, not what is on disk. |
| `install-hooks` keeps an existing `core.hooksPath` (any scope) and does nothing in CI or without `.git`. | It must never break `npm install` or override a user's own hooks. |
| `actions/checkout@v7`, `actions/setup-node@v7`. | Current majors (v7.0.1 from 2026-07, v7.1.0 from 2026-10). |
| No `pull_request` trigger. `workflow_dispatch` added. | PRs are disabled. A manual run helps in forks. |

## How to verify

1. `npm run check:public` → `OK`.
2. `node --test "scripts/**/*.test.mjs"` → 9 pass.
3. Scrub proof: a temporary `.private-markers` with the old library numbers (as `\b` regexes), the owner's name and `/Users/` paths. The only hits left are outside this workstream (see Parking lot) and the intended copyright line in `LICENSE`. A separate scan found no Client ID from `.env` and no real playlist names in publishable files. The markers file was deleted afterwards.
4. The hook and installer were tested in a scratch repo: hook install, CI no-op, foreign `hooksPath` kept, commit with no HEAD, a blocked commit (Client ID + `data/` file), staged-vs-disk content, and a marker hit.

## Parking lot

- `apps/server/src/features/sync/fixtures.ts` (lines 4, 23) and `mapping.test.ts` (line 21) use the owner's first name as the fake user id and display name. Replace it with a neutral one (for example `test-user` / `Test User`). Not in this workstream's files.
- `docs/tasks/005-public-release/tasks/decisions-log.md` quotes the user ("Ideally no email at all, …"). Paraphrase it if quotes should go.
- A history scan (`git log -p`) mode for the guard. Not needed before the first commit.
- Add `node --test "scripts/**/*.test.mjs"` to an npm script (needs a `package.json` change).
