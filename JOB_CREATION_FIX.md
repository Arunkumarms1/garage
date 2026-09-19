# Job Creation Fix — Reference

## Issue
No frontend UI for `POST /api/jobs` (Phase 13 backend existed, Phase 14 UI missing).

## Fix
Added `Create Job` button + modal in `frontend/index.html`. Uses `findOrCreateVehicle()` to reuse/create vehicles by plate.

## API Contract (`POST /api/jobs`)
Body: `{ "vehicle_id": number, "notes": string }`
Response: `{ job: { id, vehicle_id, status: "pending", notes, total_cost: 0 } }`
Auth: employee/admin (`requireRole('employee')`). Customer → 403.

## Key Functions
- `showCreateJobModal()` — fetches customers, resets form
- `createJob()` — validates, calls `findOrCreateVehicle()`, then `POST /api/jobs`
- `findOrCreateVehicle()` — searches by plate, creates if missing

## File Modified
`frontend/index.html` (~120 lines added: button, modal, JS).
