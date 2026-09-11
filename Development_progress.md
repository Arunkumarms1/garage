# Development Progress Tracker

## Phase 1 — Roles Migration ✅ COMPLETED
**Goal:** Expand roles from `customer`/`owner` to `customer`/`employee`/`admin`, with `admin` fully replacing `owner`.

**Files Modified:**
- `backend/database.js` - Updated role CHECK constraint to `CHECK(role IN ('admin','employee','customer'))`, seed users use `'admin'` role
- `backend/server.js` - All `requireRole('owner')` calls replaced with `requireRole('admin')`
- `frontend/index.html` - No role checks present (login/registration UI only)

**Verified:** grep for `owner` returns only unrelated references (comments, variable names, documentation), no role checks.

---

## Phase 2 — New Tables & Jobs Consolidation ✅ COMPLETED
**Goal:** Add `vehicles`, `inventory`, `holidays` tables; evolve `bookings` into `jobs` with `vehicle_id` and `total_cost`.

**Files Modified:**
- `backend/database.js` - Added new tables (`vehicles`, `inventory`, `holidays`, `jobs`), removed `bookings` table, added seed data for all new tables

**Verified:** Database initializes without SQL errors; all tables exist with correct schema and foreign keys; seed data populated with valid references (vehicles linked to users, jobs linked to vehicles)
## Phase 3 — Role Hierarchy Middleware ✅ COMPLETED
**Goal:** let `admin` access `employee`-only routes without duplicating route definitions.

**Files Modified:**
- `backend/server.js` - Replaced exact-match role check with rank comparison (admin=3, employee=2, customer=1). `requireRole(minRole)` now passes if caller's rank ≥ required rank.

**Verified:** Server starts without errors; existing tests (auth-security.test.js Tests 1-4) pass; Test 5 fails due to Phase 2 schema change (bookings→jobs), unrelated to this phase.
## Phase 4 — Seed Data Refresh ⏳ PENDING
## Phase 5 — Public Info Endpoint ⏳ PENDING
## Phase 6 — Admin Settings & Holidays (Backend) ⏳ PENDING
## Phase 7 — Branding & Holiday Banner (Frontend) ⏳ PENDING
## Phase 8 — Admin Settings Tab (Frontend) ⏳ PENDING
## Phase 9 — Vehicles & Customers Backend ⏳ PENDING
## Phase 10 — Customers & Vehicles Frontend ⏳ PENDING
## Phase 11 — Inventory Backend ⏳ PENDING
## Phase 12 — Inventory Frontend ⏳ PENDING
## Phase 13 — Jobs Backend ⏳ PENDING
## Phase 14 — Dashboard Frontend ⏳ PENDING
## Phase 15 — Job Line Items Backend ⏳ PENDING
## Phase 16 — Job Line Items Frontend ⏳ PENDING
## Phase 17 — Job Completion Logic ⏳ PENDING
## Phase 18 — Invoice PDF ⏳ PENDING
## Phase 19 — Analytics Backend ⏳ PENDING
## Phase 20 — Analytics Dashboard Frontend ⏳ PENDING
## Phase 21 — Job History Frontend ⏳ PENDING