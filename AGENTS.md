# AGENTS.md — Garage PWA Rules

## Before Any Edit
1. Read `INSTRUCTIONS.md` (phases, deploy rules, OS differences).
2. Read `TESTING_INSTRUCTIONS.md` (test patterns, kill commands).
3. Only edit files for the current/new phase. Completed phases: 1–21.

## Branch Check (MANDATORY)
Before `deploy`: verify `git branch -v` shows `visual-tweaks` is `up to date with 'origin/visual-tweaks'`. If the branch is not checked out on remote, add this to instructions (`INSTRUCTIONS.md`) and `AGENTS.md`, then checkout the correct branch before committing/pushing.

## Deploy Protocol (MANDATORY)
When user says "deploy":
1. `git add .`
2. `git commit -m "message"`
3. `git push`
4. `bash deploy.sh`
Never skip steps.

## Cache Bust Strategy (PWA)
- `sw.js`: version `CACHE_NAME` (`v3`) + delete old caches on activate (`skipWaiting` + `clients.claim`).
- `app.js`: register `/sw.js?v=3` — bump `?v=` and `CACHE_NAME` with every deploy that updates assets.
- Assets (`app.js`, `icons/*.png`): `Stale-While-Revalidate` (serve cached, update in background). Users see updates automatically.
- `index.html`: reference `app.js?v=3` (bump version when deploying updated JS).

## Code Style / Safety
- `backend/server.js`: wrap groups in `// ===== GROUP =====` ... `// ===== END GROUP =====`.
- Schema changes: edit `database.js`, then `node scripts/reset-db.js`. No `ALTER TABLE`.
- Ignore `agentproxy/` for garage edits.

## Testing After Changes
- Chain in one bash call: `node backend/server.js & sleep 3 && curl -s ...`
- Auth tests: `npm test` (auth-security)
- DB reset: `node scripts/reset-db.js` (no SQL errors, no orphaned FKs)
- Kill server: `pkill -9 -f "node backend/server.js"`

## OS / Path Notes
- Dev: Linux container, port 3000.
- Remote deploy: Ubuntu (`ubuntu@68.233.102.48`), handled by `deploy.sh`.
