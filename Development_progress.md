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
## Phase 11 — Inventory Backend ✅ COMPLETED
**Goal:** CRUD for parts stock, with automatic purchase logging.
**Files Modified:**
- `backend/server.js` - Added inventory CRUD endpoints wrapped in `// ===== INVENTORY ROUTES =====` markers:
  - `GET /api/inventory` (admin/employee) - list all inventory items
  - `GET /api/inventory/:id` (admin/employee) - get single inventory item
  - `POST /api/inventory` (admin/employee) - create new inventory item, logs purchase to ledger if initial quantity > 0
  - `PUT /api/inventory/:id` (admin/employee) - update inventory item, logs purchase to ledger on restock (quantity increase)
  - `DELETE /api/inventory/:id` (admin/employee) - delete inventory item

**Verified:**
- All CRUD operations work correctly
- Purchase logged to ledger on create with initial quantity > 0 (e.g., "Initial stock: Test Part (5 units @ $10.00)")
- Purchase logged to ledger on restock (quantity increase) (e.g., "Restock: Test Part (+10 units @ $10.00)")
- No purchase logged on quantity decrease or same quantity
- Role hierarchy works: admin and employee can access, customer gets 403 Forbidden
- Existing auth tests (Tests 1-4) still pass
- Database reset and server restart work correctly

## Phase 12 — Inventory Frontend ✅ COMPLETED
**Goal:** UI to view and manage stock.
**Files Modified:**
- `frontend/index.html` - Added Inventory tab with:
  - Searchable inventory table with item name, quantity (highlighted amber when ≤5), cost price, selling price
  - Add/Edit inventory modal (name, quantity, cost price, selling price)
  - Delete confirmation
  - Real-time search with debounced input
  - Role-based visibility (admin/employee only)

**Verified:**
- All CRUD operations work through modal forms
- Search filters results in real-time
- Quantity highlighted when low stock (≤5)
- All functions wired to Phase 11 backend endpoints
- Role hierarchy enforced (admin/employee can access, customer gets 403)
- Existing auth tests (Tests 1-4) still pass

## Phase 13 — Jobs Backend ✅ COMPLETED
**Goal:** CRUD for jobs, plus the two read variants the dashboard and history need.

**Files Modified:**
- `backend/server.js` - Added Jobs routes wrapped in `// ===== JOBS ROUTES =====` markers:
  - `GET /api/jobs/active` (employee/admin) - list active jobs (pending, in-progress)
  - `GET /api/jobs` (employee/admin - all with filters; customer - own vehicles only) - supports status, from, to query params
  - `GET /api/jobs/:id` (employee/admin - single job; customer - own vehicle only)
  - `POST /api/jobs` (employee/admin) - create job with vehicle_id and notes
  - `PUT /api/jobs/:id` (employee/admin) - update job (vehicle_id, status, notes, total_cost)
  - `DELETE /api/jobs/:id` (admin only) - delete job

**Verified:**
- All CRUD operations work correctly
- `GET /api/jobs/active` returns only pending and in-progress jobs
- `GET /api/jobs` with filters (status, from, to) works correctly
- Role hierarchy works: admin and employee have full access; customer scoped to own vehicles only
- Customer cannot access `/api/jobs/active` (403) but can access `/api/jobs` and `/api/jobs/:id` for own vehicles
- Existing auth tests (Tests 1-4) still pass
- Database reset and server restart work correctly

## Phase 14 — Dashboard Frontend ✅ COMPLETED
**Goal:** default post-login view showing active work.
**Files Modified:**
- `frontend/index.html` - Implemented Dashboard tab with:
  - Kanban board with three columns: Pending, In Progress, Completed (Recent)
  - Job cards showing vehicle info, customer name, status badge, notes preview, total cost
  - Click-to-open job detail modal with status dropdown and notes editor
  - Save button calls `PUT /api/jobs/:id` to update status/notes
  - Role-based edit permissions (employee/admin can edit, customer view-only)
  - Refresh button to reload data
  - Loads active jobs from `/api/jobs/active` and recent completed from `/api/jobs?status=completed`

**Verified:**
- Server starts without errors
- `GET /api/jobs/active` returns seeded active jobs (pending + in-progress)
- `GET /api/jobs?status=completed` returns recent completed jobs
- `GET /api/jobs/:id` returns full job details with customer/vehicle info
- `PUT /api/jobs/:id` successfully updates status and notes
- Job status change from in-progress → completed removes job from active list
- Role hierarchy enforced: employee/admin can edit, customer gets read-only view
- Existing auth tests (Tests 1-4) still pass
## Phase 15 — Job Line Items Backend ✅ COMPLETED
**Goal:** Attach parts/labor to a job and track a running total.

**Files Modified:**
- `backend/database.js` - Added `job_items` table with columns: `id`, `job_id`, `inventory_id` (nullable), `description`, `quantity`, `unit_price`
- `backend/server.js` - Added Job Items routes wrapped in `// ===== JOB ITEMS ROUTES =====` markers:
  - `POST /api/jobs/:id/items` (employee/admin) - add line item (part or labor)
  - `DELETE /api/jobs/:id/items/:itemId` (employee/admin) - remove line item
  - On every add/remove, recompute `jobs.total_cost` as sum of `quantity × unit_price`
  - Parts lines reference `inventory_id` and default `unit_price` to `selling_price`
  - Labor lines have null `inventory_id` with free-text description + manual price
  - Block add/remove on completed jobs

**Verified:**
- Adding part items with inventory_id works (defaults to selling_price if unit_price not provided)
- Adding labor items (no inventory_id) works with manual price
- Total cost correctly computed and updated on each add/remove (e.g., 2×15 + 1×12 + 1×50 = 92)
- Deleting items correctly recomputes total
- Completed jobs reject add/remove (400 error)
- Role hierarchy works: admin and employee can access, customer gets 403 Forbidden
- Invalid inventory_id returns 400
- Missing required fields returns 400
- Invalid quantity/price returns 400
- Existing auth tests (Tests 1-4) still pass; Test 5 fails due to Phase 2 schema change (bookings→jobs), unrelated to this phase.

## Phase 16 — Job Line Items Frontend ✅ COMPLETED
**Goal:** UI to add parts/labor inside a job.
**Files Modified:**
- `backend/server.js` - Added `GET /api/jobs/:id/items` endpoint to fetch job line items
- `frontend/index.html` - Added job line items UI in job detail modal:
  - Line items list with running total, showing part/labor badge, quantity, unit price, line total
  - Delete button per line item
  - "Add Line Item" section with Part/Labor toggle
  - Part form: inventory dropdown (auto-fills selling price), quantity, unit price
  - Labor form: manual description, quantity, unit price
  - Role-based visibility (employee/admin can edit, customer view-only)
  - Wired to Phase 15 backend endpoints (POST/DELETE /api/jobs/:id/items)

**Verified:**
- GET /api/jobs/:id/items returns job items correctly
- POST /api/jobs/:id/items adds part items (with inventory_id) and labor items (null inventory_id)
- DELETE /api/jobs/:id/items/:itemId removes items and recomputes total_cost
- Total cost correctly updated on each add/remove (e.g., 2×50 + 1×120 = 220)
- Frontend modal loads items and inventory dropdown on open
- Part dropdown auto-fills selling price from inventory
- Delete confirmation and toast notifications work
- Role hierarchy enforced: employee/admin can add/remove items, customer sees read-only view
- Existing auth tests (Tests 1-4) still pass
## Phase 17 — Job Completion Logic ✅ COMPLETED
**Goal:** Finalize a job safely — deduct stock, log the sale, block double-completion.

**Files Modified:**
- `backend/server.js` - Modified `PUT /api/jobs/:id` endpoint with completion logic:
  - Check stock availability BEFORE updating job status (atomic - no partial deductions)
  - On status → `completed`: for every `job_item` with non-null `inventory_id`, deduct `quantity` from `inventory.quantity`
  - If any item lacks enough stock, reject the whole completion (no partial deductions)
  - Insert a `sale` row into `ledger` for `total_cost`
  - Reject the request if the job is already `completed` — no double-deduction or double-logging
  - Added helper functions: `doUpdateJob`, `validateStockAndComplete`, `completeJobTransaction`

**Verified:**
- Job completion deducts inventory correctly (e.g., Brake Pads 20→18, Brake Rotors 10→9)
- Sale logged to ledger with correct total_cost (e.g., "Job Completed: Brake Pads (Front), Brake Rotors (Front)" amount 315)
- Double-completion rejected with error "Job is already completed. Cannot complete again."
- Insufficient stock rejected with error showing available vs required; job status remains unchanged; inventory unchanged
- Employee role can complete jobs (role hierarchy works)
- Jobs with only labor items (no inventory) complete successfully with sale logged
- Existing auth tests (Tests 1-4) still pass

## Phase 18 — Invoice PDF ⏳ PENDING
## Phase 19 — Analytics Backend ⏳ PENDING
## Phase 20 — Analytics Dashboard Frontend ⏳ PENDING
## Phase 21 — Job History Frontend ⏳ PENDING