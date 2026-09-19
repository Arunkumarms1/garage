# AGENTS.md — Garage PWA Rules

## Before Any Edit
1. Read `INSTRUCTIONS.md` (phases, deploy rules, OS differences).
2. Read `TESTING_INSTRUCTIONS.md` (test patterns, kill commands).
3. Only edit files for the current/new phase. Completed phases: 1–21.

## Deploy Protocol (MANDATORY)
When user says "deploy":
1. `git add .`
2. `git commit -m "message"`
3. `git push`
4. `bash deploy.sh`
Never skip steps.

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
