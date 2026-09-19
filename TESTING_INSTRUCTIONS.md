# Testing — Compact

## Chain commands in ONE bash call (critical — server hangs if split)
```bash
node backend/server.js & sleep 3 && curl -s http://localhost:3000/api/public-info
```

## Login + multi-endpoint
```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" -d '{"email":"admin@garage.com","password":"SuperStrongAdminPassword!2026"}' | grep -o '"token":"[^"]*' | cut -d'"' -f4) && echo "Token: $TOKEN" && curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/analytics
```

## Kill server
```bash
pkill -9 -f "node backend/server.js"
```

## Git after phase
```bash
git add . && git commit -m "phase 'N' completed" && git push
```

## Checklist (per phase)
- [ ] Server starts (no errors)
- [ ] Endpoint returns expected JSON
- [ ] Auth: 401/403 where required
- [ ] DB: `node scripts/reset-db.js` runs, no SQL errors, no orphaned FKs
- [ ] `npm test` passes (auth-security)
- [ ] Frontend: no console errors
