# Testing Instructions & Workflow

## Server Testing Strategy

### Start Server & Test Endpoint (One-Liner)
```bash
cd /data/data/com.termux/files/home/garage/garage && node backend/server.js & sleep 2 && curl -s http://localhost:3000/api/public-info
```

### Manual Testing Steps
1. Start server in background: `node backend/server.js &`
2. Wait 2 seconds for startup: `sleep 2`
3. Test endpoint: `curl -s http://localhost:3000/api/<endpoint>`
4. Kill server when done: `pkill -f "node backend/server.js"`

### Frontend Testing
- Open `frontend/index.html` directly in browser (file:// protocol works for static assets)
- Or serve via: `npx serve frontend` (if needed)
- Check browser console for errors
- Verify header branding updates and holiday banner appears

## Git Workflow (After Each Phase)

```bash
git add .
git commit -m "phase 'N' completed"
git push
```

Replace `N` with the phase number (e.g., `phase '7' completed`).

## Verification Checklist Per Phase

### Backend Phases
- [ ] Server starts without errors
- [ ] New endpoint returns expected JSON
- [ ] Auth middleware works (401/403 where appropriate)
- [ ] Database queries execute without SQL errors
- [ ] Run existing tests: `npm test` (if test file exists)

### Frontend Phases
- [ ] No console errors on page load
- [ ] Feature works in both light/dark mode
- [ ] Responsive on mobile viewport
- [ ] Auth state handled correctly (logged in vs logged out)

### Database Phases
- [ ] `node scripts/reset-db.js` runs successfully
- [ ] All tables created with correct schema
- [ ] Foreign keys valid (no orphaned references)
- [ ] Seed data populated correctly

## Common Issues & Fixes

| Issue | Fix |
|-------|-----|
| Port 3000 in use | `pkill -f "node backend/server.js"` then restart |
| SQLite errors | Delete `backend/garage.db` and run `node scripts/reset-db.js` |
| Frontend not updating | Hard refresh (Ctrl+Shift+R) or clear cache |
| Auth token expired | Log out and log back in via UI |

## Phase Completion Template

After completing a phase:
1. Run verification steps above
2. Update `Development_progress.md` with ✅ COMPLETED
3. Run git workflow:
   ```bash
   git add .
   git commit -m "phase 'X' completed"
   git push
   ```