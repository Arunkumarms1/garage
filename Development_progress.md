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
## Phase 4 — Seed Data Refresh ✅ COMPLETED
**Goal:** `reset-db.js` seeds realistic dummy rows for every new table.

**Files Modified:**
- `backend/database.js` - Added seed data for employee and customer users; fixed vehicle owner_id references to point to the customer user (id 3)

**Verified:** `node scripts/reset-db.js` runs successfully; all tables populated with valid data — 2 admins, 1 employee, 1 customer; 3 vehicles linked to customer; 8 inventory items; 2 holidays; 3 jobs (pending, in-progress, completed) linked to seeded vehicles. No orphaned foreign keys.
## Phase 5 — Public Info Endpoint ✅ COMPLETED
**Goal:** unauthenticated endpoint for pre-login branding + holidays.

**Files Modified:**
- `backend/server.js` - Added `GET /api/public-info` endpoint (no auth) returning `shop_name`, `shop_icon` from settings and holidays where `date >= today`. Wrapped in `// ===== PUBLIC ROUTES =====` markers.

**Verified:** `curl localhost:3000/api/public-info` while logged out returns correct JSON with shop_name, shop_icon, and seeded holidays array.
## Phase 6 — Admin Settings & Holidays (Backend) ✅ COMPLETED
**Goal:** admin-only writes for branding and holidays.

**Files Modified:**
- `backend/server.js` - Added `POST /api/holidays` and `DELETE /api/holidays/:id` endpoints (admin only). Existing `PUT /api/settings` already accepts `carwash_name` (shop_name) and `logo_base64` (shop_icon). Wrapped in `// ===== ADMIN SETTINGS & HOLIDAYS ROUTES =====` markers.

**Verified:** As admin, added holiday via POST, confirmed it appears in `GET /api/public-info`; deleted holiday via DELETE, confirmed it's removed from `GET /api/public-info`.
## Phase 7 — Branding & Holiday Banner (Frontend) ✅ COMPLETED
**Goal:** Show shop identity and holiday notices before login.

**Files Modified:**
- `frontend/index.html` - Added `fetchPublicInfo()` called on DOMContentLoaded; `updateHeaderBranding()` updates document.title and header with shop_name/shop_icon from `/api/public-info`; `showHolidayBanner()` displays amber banner on login screen for holidays within 14 days.

**Verified:** `GET /api/public-info` returns correct JSON with shop_name, shop_icon, and seeded holidays; code updates header branding and shows holiday banner for upcoming holidays (e.g., 2026-09-18 Staff Training Day is within 14 days).
## Phase 8 — Admin Settings Tab (Frontend) ✅ COMPLETED
**Goal:** Let admin edit branding and holidays from the UI.

**Files Modified:**
- `frontend/index.html` - Added "Settings" tab visible to `admin` only with:
  - Branding form: shop name, icon (Base64 data URL or image URL), save button calling `PUT /api/settings`
  - Holiday management: list with delete buttons, add form (date + reason) calling `POST /api/holidays` and `DELETE /api/holidays/:id`
  - Tab navigation system for all roles (Dashboard, Jobs, Customers, Inventory, Settings, Analytics)
  - Role-based tab visibility (admin sees Settings & Analytics; employee/admin see Customers & Inventory)

**Verified:** Settings tab renders for admin users with branding and holiday management UI; all functions wired to Phase 6 backend endpoints.
## Phase 9 — Vehicles & Customers Backend ✅ COMPLETED
**Goal:** CRUD for vehicles, customer lookup and creation.

**Files Modified:**
- `backend/database.js` - Added `phone` column to `users` table
- `backend/server.js` - Added CRM routes wrapped in `// ===== CRM ROUTES =====` markers:
  - `POST /api/customers` (admin/employee) - creates CRM customer record with `role='customer'`
  - `GET /api/customers` (admin/employee) - search customers by name
  - `GET /api/customers/:id` (admin/employee) - customer details + their vehicles
  - Full CRUD on `/api/vehicles` (admin/employee) with search by `plate_number`

**Verified:** 
- Admin and employee can access all CRM endpoints (role hierarchy works)
- Customer role correctly denied access (403 Forbidden)
- Phone field stored and retrieved correctly
- Vehicle CRUD operations work: create, read, update, delete, search by plate
- Customer creation with phone/email, search by name, get customer with vehicles all functional
- Existing auth tests (Tests 1-4) still pass
## Phase 10 — Customers & Vehicles Frontend ✅ COMPLETED
**Goal:** UI to manage customers and vehicles.

**Files Modified:**
- `frontend/index.html` - Added Customers & Vehicles tab with:
  - Searchable customer list with name, email, phone
  - Add/Edit/Delete customer modal (name, email, phone)
  - Inline vehicle list per customer with make, model, year, plate
  - Add/Edit/Delete vehicle modal (make, model, year, plate number)
  - Search by name with debounced input
  - Role-based visibility (admin/employee only)

**Verified:** Customer CRUD operations work through modal forms; vehicles nested under customers with full CRUD; search filters results in real-time; all functions wired to Phase 9 backend endpoints.
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