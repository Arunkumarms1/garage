# INSTRUCTIONS — Garage PWA

## Completed (all 21 phases ✅)
1 Roles | 2 Schema | 3 Middleware | 4 Seeds | 5 Public | 6 Admin/Holidays | 7 Branding | 8 Settings | 9 CRM | 10 Frontend CRM | 11 Inventory | 12 Inv Frontend | 13 Jobs | 14 Dashboard | 15 Line Items | 16 Line Frontend | 17 Completion | 18 Invoice PDF | 19 Analytics | 20 Dashboard | 21 Job History

## Architecture (compact)
- Monorepo: Node/Express (`backend/server.js`, 2158 lines) + vanilla JS SPA (`frontend/index.html`, 3472 lines) + SQLite (`backend/garage.db`).
- Auth: JWT (7d), `pbkdf2Sync` (sha512, 1000 iters), roles `admin`(3) > `employee`(2) > `customer`(1).
- DB seed: `database.js` creates tables; `reset-db.js` wipes/reseeds.

## File Index (>1000 lines, non-node_modules)
- `backend/server.js` (2158) — all API logic
- `frontend/index.html` (3472) — SPA
- `package-lock.json` (4072) — deps
- `agentproxy/` — separate proxy module (ignore for garage edits)

## Cache Bust Strategy (PWA)
- `sw.js` uses versioned `CACHE_NAME` (`garageworkshop-v3`). Old caches deleted on activate.
- `app.js` registers `/sw.js?v=3` (bump `?v=` and `CACHE_NAME` on every deploy that updates assets).
- Static assets (`app.js`, `icons/*.png`) use `Stale-While-Revalidate`: serve cached instantly, update in background. No manual hard-refresh needed.
- `index.html` references `app.js?v=3` (bump version in HTML when deploying updated JS).

## Branch Check (MANDATORY)
Before any deploy, verify the remote branch matches the local working branch (`visual-tweaks`). Run: `git branch -v` — must show `* visual-tweaks ... up to date with 'origin/visual-tweaks'`. If not checked out on remote, do not proceed with deploy.

## Deploy Rule
When user says "deploy": agent MUST `git commit`, `git push`, then run `deploy.sh`. Sequence: commit → push → deploy. Never skip.

## Version Alignment & Cache Bust (MANDATORY)
When bumping version (`UI_VERSION` in `frontend/app.js` and `/api/version` in `backend/server.js`):
- Update BOTH files together.
- Bump `frontend/index.html` `app.js?v=X` to `v=X+1`.
- Bump `frontend/app.js` `/sw.js?v=X` to `v=X+1`.
- Bump `frontend/sw.js` `CACHE_NAME` (`garageworkshop-vX`) to `v=X+1`.
- This is how we deploy from now on.

## OS Difference (CRITICAL)
- **Dev/localhost**: Linux (this container/environment). Port 3000. `node backend/server.js`.
- **Remote deploy**: Ubuntu (`ubuntu@68.233.102.48` via SSH in `deploy.sh`). Different OS. Do not assume same paths/users. `deploy.sh` handles it.

## Testing (token-friendly commands)
```bash
# Chain in SINGLE bash call
node backend/server.js & sleep 3 && curl -s http://localhost:3000/api/public-info
# Full test with token
TOKEN=$(curl -s -X POST ... | grep ...) && curl -s -H "Authorization: Bearer $TOKEN" ...
# Kill
pkill -9 -f "node backend/server.js"
```
- Verify: server starts, endpoint JSON correct, auth 401/403, `npm test` (auth-security), `node scripts/reset-db.js` (no SQL errors, no orphaned FKs).
- After each phase: `git add .`, `git commit -m "phase 'N' completed"`, `git push`.

## Key Files for Reference
- `ARCHITECTURE.md` — architecture
- `Development_plan.md` — full phase details (keep, do not delete without approval)
- `Development_progress.md` — completed phase list
- `TESTING_INSTRUCTIONS.md` — full test patterns
- `JOB_CREATION_FIX.md` — create job modal + `findOrCreateVehicle()` logic
- `deploy.sh` — remote deploy: `ssh ubuntu@68.233.102.48 "cd garage && git pull && npm install && pm2 restart garage-api"`

## Live / Version Reload Loop Warning
When bumping app version (`UI_VERSION` in `frontend/app.js` and `/api/version` in `backend/server.js`), update BOTH files together. If server version > UI version, `checkLiveStatus()` reloads continuously.

## Rules for Agents
- Only touch files listed for current phase. Read before write.
- Wrap route groups in `// ===== GROUP =====` ... `// ===== END GROUP =====` in `server.js`.
- Schema changes: edit `CREATE TABLE` in `database.js`, then reset DB (`node scripts/reset-db.js`). Do NOT write `ALTER TABLE`.
- Complete phases: 1–21 ✅. Any new work starts after Phase 21.
