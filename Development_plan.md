# Garage App PWA — Development Plan (v2)

*Revision of your original 7-phase plan. Same scope, restructured into 21 smaller phases — each one touches at most 1–2 files with a single concern, sized for free-tier agent limits.*

## 🎯 Context & Architecture Rules for the AI Agent
*(paste this block into every agent session, alongside the phase you're running)*

You are an AI coding assistant helping to build a Garage Workshop PWA.

**Crucial Constraints:**
1. **Free-tier limits:** Keep generations small. Only touch the file(s) and function(s)/section(s) listed under "Files" for the current phase. Do not rewrite entire files.
2. **Read before you write:** View a file's current contents before editing it. Don't assume you remember earlier phases — you may be running in a fresh session with no memory of previous ones.
3. **Current architecture:**
   - Backend: Node/Express, single file (`backend/server.js`) for all API logic. SQLite3 (`backend/database.js`).
   - Frontend: vanilla JS SPA (`frontend/index.html`). No React/Vue/Angular.
   - Styling: Tailwind CDN.
4. **Roles are hierarchical:** `admin` > `employee` > `customer`. Admin can do anything employee can — this should be a rank check, not three separate exact-match branches.
5. **Keep `server.js` navigable as it grows:** wrap each route group in comment markers — `// ===== VEHICLES ROUTES =====` … `// ===== END VEHICLES ROUTES =====`. Later phases reference these markers instead of asking you to re-scan the whole file.

## 🔧 How to Run This Plan
- One phase per agent session. Copy that phase's Goal/Files/Steps block as your prompt, together with the rules above.
- After each phase: do the Verify check, then commit to git. Small commits mean a bad phase costs you one `git reset`, not the whole day.
- If the agent starts touching files outside the phase's "Files" list, or rewrites more than the specific piece you asked for, stop and re-prompt narrower — that's free-tier budget being spent on scope it wasn't asked for.

## 🔑 Key Decisions in This Revision
A few places where the v1 draft left something open (or a gap that would've cost an agent a wasted turn). Worth reading once before you start:

- **`jobs` replaces `bookings` — it doesn't sit alongside it.** V1 said "Create `jobs` (or update `bookings`)," which is ambiguous enough that an agent could build a second, parallel system for the same concept. Your architecture doc already has customer-sourced-from-JWT bookings with a status field — that *is* a job. Phase 2 renames the table and adds the two columns it's missing.
- **No live SQL migrations anywhere in this plan.** `reset-db.js` already wipes and reseeds the whole DB, and you're pre-production. So schema changes — including the `users.role` CHECK constraint, which SQLite can't `ALTER` in place anyway — are just edits to the `CREATE TABLE` statements in `database.js`, followed by a reset. Don't let an agent write `ALTER TABLE ... ADD CONSTRAINT`; it'll fail.
- **The `owner` → `admin` rename has to sweep 3 files, not just the DB.** V1's Phase 1 only mentioned the constraint. Every `requireRole('owner')` call and every UI role check in `index.html` also needs updating, or auth breaks the moment the DB stops returning `'owner'`.
- **Inventory is deducted at job completion, not when a part is added to a job.** This way, adding or removing a line item while a job is still in progress never needs a "restock" correction — only one place in the code ever touches stock levels.
- **Labor line items are free text, not tied to your `services` table — for now.** V1 didn't say how "Labor" should be represented. Free text + manual price is the smallest version; you can wire it to `services` for preset pricing later if you want.
- **The PWA install icon won't update with `shop_icon`.** `manifest.json`'s icon is fixed at install time; dynamic branding here only covers in-app UI (header, invoice), not the home-screen icon. That's a bigger feature if you ever want it — out of scope below.

## 🗺️ Plan Overview

| # | Phase | Files touched |
|---|-------|----------------|
| 1 | Roles Migration | `database.js`, `server.js`, `index.html` |
| 2 | New Tables & Jobs Consolidation | `database.js` |
| 3 | Role Hierarchy Middleware | `server.js` |
| 4 | Seed Data Refresh | `reset-db.js` |
| 5 | Public Info Endpoint | `server.js` |
| 6 | Admin Settings & Holidays (Backend) | `server.js` |
| 7 | Branding & Holiday Banner (Frontend) | `index.html` |
| 8 | Admin Settings Tab (Frontend) | `index.html` |
| 9 | Vehicles & Customers Backend | `server.js` |
| 10 | Customers & Vehicles Frontend | `index.html` |
| 11 | Inventory Backend | `server.js` |
| 12 | Inventory Frontend | `index.html` |
| 13 | Jobs Backend | `server.js` |
| 14 | Dashboard Frontend | `index.html` |
| 15 | Job Line Items Backend | `database.js`, `server.js` |
| 16 | Job Line Items Frontend | `index.html` |
| 17 | Job Completion Logic | `server.js` |
| 18 | Invoice PDF | `index.html` |
| 19 | Analytics Backend | `server.js` |
| 20 | Analytics Dashboard Frontend | `index.html` |
| 21 | Job History Frontend | `index.html` |

---

## 🏗️ Milestone A — Foundations: Roles & Schema

### Phase 1 — Roles Migration
**Goal:** expand roles from `customer`/`owner` to `customer`/`employee`/`admin`, with `admin` fully replacing `owner`.
**Files:** `backend/database.js`, `backend/server.js`, `frontend/index.html`
- In `database.js`: update the `users` table's role CHECK constraint to `CHECK(role IN ('admin','employee','customer'))`, and update any inline seed rows (your architecture doc mentions 2 seeded owner accounts) from `'owner'` to `'admin'`.
- In `server.js` and `index.html`: replace every literal `'owner'` — `requireRole('owner')` calls, UI conditionals like `role === 'owner'` — with `'admin'`.
- Leave the JWT-issuing code alone; it already reads `role` from the DB row, so it inherits the new value automatically.
- (`scripts/reset-db.js` is handled separately in Phase 4.)

**Verify:** grep the repo for `owner` — remaining hits should only be unrelated English (e.g. "vehicle owner"), never a role check.

### Phase 2 — New Tables & Jobs Consolidation
**Goal:** add `vehicles`, `inventory`, `holidays`; evolve `bookings` into `jobs`.
**Files:** `backend/database.js`
- `vehicles`: `id`, `owner_id` (FK → `users.id`), `make`, `model`, `plate_number` (UNIQUE), `year`.
- `inventory`: `id`, `item_name`, `quantity`, `cost_price`, `selling_price`.
- `holidays`: `id`, `date`, `reason`.
- Rename the `bookings` table's `CREATE TABLE` to `jobs`, keeping its existing columns (status, notes, customer linkage), and add `vehicle_id` (FK → `vehicles.id`) and `total_cost` (REAL, default 0). Extend `status` to cover `pending` / `in-progress` / `completed` if it doesn't already.

This phase is schema-only — no endpoints yet, so the app keeps running with a couple of unused tables in the meantime.

**Verify:** delete `backend/garage.db` and restart the server (or wait for Phase 4's seed update), confirm no SQL errors on boot.

### Phase 3 — Role Hierarchy Middleware
**Goal:** let `admin` access `employee`-only routes without duplicating route definitions.
**Files:** `backend/server.js` (just the `requireRole` function)
- Replace the exact-match check with a rank comparison: `admin=3`, `employee=2`, `customer=1`. `requireRole(minRole)` passes if the caller's rank ≥ the required rank.
- Don't touch the routes that call `requireRole` — only the function body.

**Verify:** run `npm test` (`auth-security.test.js`), confirm it still passes; manually confirm an admin token can hit an employee-only route.

### Phase 4 — Seed Data Refresh
**Goal:** `reset-db.js` seeds realistic dummy rows for every new table.
**Files:** `scripts/reset-db.js`
- If this script seeds its own user rows separately from `database.js`'s startup defaults, make sure they use `admin`/`employee`/`customer` too — Phase 1 only guaranteed `database.js`'s own seed rows were fixed.
- Seeded users: at least one `admin`, one `employee`, one `customer`.
- 2–3 vehicles linked to the seeded customer(s).
- 5–8 inventory items with varied stock levels.
- 1–2 holidays dated in the future.
- 2–3 jobs linked to seeded vehicles, one per status.

**Verify:** `node scripts/reset-db.js`, then spot-check each table has rows with valid foreign keys (no orphaned `vehicle_id`/`owner_id`).

---

## 🏗️ Milestone B — Shop Branding & Holidays

### Phase 5 — Public Info Endpoint (Backend)
**Goal:** unauthenticated endpoint for pre-login branding + holidays.
**Files:** `backend/server.js`
- `GET /api/public-info` (no auth middleware) → `shop_name`, `shop_icon` from `settings`, plus holidays where `date >= today`.
- Wrap it in `// ===== PUBLIC ROUTES =====` markers.

**Verify:** `curl localhost:3000/api/public-info` while logged out, confirm the JSON shape.

### Phase 6 — Admin Settings & Holidays (Backend)
**Goal:** admin-only writes for branding and holidays.
**Files:** `backend/server.js`
- Extend the settings update endpoint (admin only) to accept `shop_name` and `shop_icon` (base64 or URL string — no file-upload handling needed).
- Add `POST /api/holidays` and `DELETE /api/holidays/:id`, admin only.

**Verify:** as admin, update `shop_name`, then re-hit `GET /api/public-info` and confirm it reflects the change.

### Phase 7 — Branding & Holiday Banner (Frontend)
**Goal:** show shop identity and holiday notices before login.
**Files:** `frontend/index.html`
- On page load, before any auth check, fetch `/api/public-info`.
- Set `document.title` and the header/logo area from `shop_name` (+ icon if present).
- On the login screen only: if a holiday falls within the next 14 days, show a small banner with its date and reason.

**Verify:** load the app logged out; title/header update, and the banner appears when a seeded holiday is within 14 days.

### Phase 8 — Admin Settings Tab (Frontend)
**Goal:** let admin edit branding and holidays from the UI.
**Files:** `frontend/index.html`
- "Settings" tab, visible to `admin` only.
- Form: shop name, icon (URL or pasted base64 — no upload picker yet), save button calling Phase 6's endpoint.
- Holiday list with delete buttons, plus a small add form (date + reason).

**Verify:** as admin, add a holiday, confirm it shows on the login screen from Phase 7.

---

## 🏗️ Milestone C — CRM: Customers & Vehicles

### Phase 9 — Vehicles & Customers Backend
**Goal:** CRUD for vehicles, customer lookup and creation.
**Files:** `backend/server.js`
- `POST /api/customers` (admin/employee) — creates a `users` row with `role='customer'` and no usable password. This is a CRM record, not a login account.
- `GET /api/customers/:id` — customer details + their vehicles.
- `GET /api/customers?search=` — search by name.
- Full CRUD on `/api/vehicles` (admin/employee), searchable by `plate_number`.
- Wrap in `// ===== CRM ROUTES =====` markers.

*Note: if your Google Sign-In flow matches users by email, a CRM-created customer may be able to log in later with zero extra work, as long as the email you collect here matches what they'll sign in with — worth a quick check rather than building an "invite" flow up front.*

**Verify:** create a customer, attach a vehicle by plate number, fetch the customer and confirm the vehicle shows up.

### Phase 10 — Customers & Vehicles Frontend
**Goal:** UI to manage customers and vehicles.
**Files:** `frontend/index.html`
- "Customers & Vehicles" tab (admin/employee).
- Form to register a new customer (name, phone/email — no password field).
- Form to link a new vehicle to a customer via plate number.
- Search/list view by name or plate.

**Verify:** register a customer + vehicle through the UI, confirm both appear in the search list.

---

## 🏗️ Milestone D — Inventory

### Phase 11 — Inventory Backend
**Goal:** CRUD for parts stock, with automatic purchase logging.
**Files:** `backend/server.js`
- Full CRUD on `/api/inventory` (admin/employee).
- On create or restock (quantity increase), insert a `purchase` row into `ledger` for `quantity × cost_price`, matching the shape your existing `sale` entries already use.

**Verify:** restock an item, confirm a new `ledger` row appears with the correct amount.

### Phase 12 — Inventory Frontend
**Goal:** UI to view and manage stock.
**Files:** `frontend/index.html`
- "Inventory" tab (admin/employee): table of `item_name`, `quantity`, `cost_price`, `selling_price`.
- Form to add a new item or restock an existing one.

*Note: decide whether `employee` should see `cost_price` (it reveals margin) — default here is that anyone with tab access sees both prices; restrict it in Phase 11's response if you want it admin-only.*

**Verify:** restock via the UI, confirm the table updates and the Phase 11 ledger entry fires.

---

## 🏗️ Milestone E — Workshop Dashboard & Jobs

### Phase 13 — Jobs Backend
**Goal:** CRUD for jobs, plus the two read variants the dashboard and history need.
**Files:** `backend/server.js`
- Full CRUD on `/api/jobs` (employee/admin), each job linked to a `vehicle_id`.
- `GET /api/jobs/active` — status in (`pending`, `in-progress`).
- `GET /api/jobs?status=completed&from=&to=` — for Phase 21's history search.
- For `customer` role: scope `GET /api/jobs` to only their own vehicles, mirroring the existing JWT-sourced identity pattern.

**Verify:** create a job against a seeded vehicle, confirm it appears in `/active`; mark it completed and confirm it drops out of `/active` and shows up in the history query.

### Phase 14 — Dashboard Frontend
**Goal:** default post-login view showing active work.
**Files:** `frontend/index.html`
- "Dashboard" tab, default view after login (employee/admin).
- List or simple Kanban (pending / in-progress / completed columns) from `/api/jobs/active`.
- Clicking a job opens notes + a status dropdown, saved via Phase 13's update endpoint.

**Verify:** change a job's status from the UI, confirm it moves/disappears correctly.

---

## 🏗️ Milestone F — Job Finalization & Invoicing

### Phase 15 — Job Line Items Backend
**Goal:** attach parts/labor to a job and track a running total.
**Files:** `backend/database.js`, `backend/server.js`
- New `job_items` table: `id`, `job_id`, `inventory_id` (nullable — null means a labor/manual line), `description`, `quantity`, `unit_price`.
- `POST /api/jobs/:id/items` and `DELETE /api/jobs/:id/items/:itemId`. Parts lines reference `inventory_id` and default `unit_price` to `selling_price`; labor lines are free-text description + manual price.
- On every add/remove, recompute `jobs.total_cost` as the sum of `quantity × unit_price` across the job's items.
- Do **not** deduct `inventory.quantity` here — that only happens at completion (Phase 17), so removing a line before then never needs a restock correction.

**Verify:** add two parts and one labor line to a job, confirm `total_cost` matches the sum.

### Phase 16 — Job Line Items Frontend
**Goal:** UI to add parts/labor inside a job.
**Files:** `frontend/index.html`
- In the job detail view: "Add Parts/Labor" section — dropdown of inventory items (auto-fills price), plus a manual labor row (description + price).
- Line-item list with running total and a delete button per line.

**Verify:** add/remove lines in the UI, confirm the displayed total matches the backend `total_cost`.

### Phase 17 — Job Completion Logic (Backend)
**Goal:** finalize a job safely — deduct stock, log the sale, block double-completion.
**Files:** `backend/server.js`
- On status → `completed`: for every `job_item` with a non-null `inventory_id`, deduct `quantity` from `inventory.quantity`. If any item lacks enough stock, reject the whole completion (no partial deductions).
- Insert a `sale` row into `ledger` for `total_cost` — this replaces whatever ledger insert already fires on a booking's "service finished" status, just now triggered by `jobs.status = 'completed'` and using the computed `total_cost` instead of a flat amount.
- Reject the request if the job is already `completed` — no double-deduction or double-logging on repeat calls.

**Verify:** complete a job with seeded stock, confirm inventory drops correctly and a `ledger` sale row appears; try completing it again and confirm it's rejected.

### Phase 18 — Invoice PDF (Frontend)
**Goal:** downloadable invoice once a job is completed.
**Files:** `frontend/index.html`
- Add `html2pdf.js` (or `jspdf`) via CDN.
- Hidden HTML template: shop name/icon (from Phase 7's public-info fetch), customer + vehicle info, line-items table, total.
- "Generate Invoice" button, visible once a job is `completed`, renders the template and downloads a PDF.

**Verify:** complete a job, generate the invoice, confirm branding, customer/vehicle info, and total all match.

---

## 🏗️ Milestone G — Analytics & Reporting

### Phase 19 — Analytics Backend
**Goal:** financial totals + CSV export, admin only.
**Files:** `backend/server.js`
- `GET /api/analytics?from=&to=` (admin only) — total earnings (sum of `sale` rows), total spend (sum of `purchase` rows), net profit, within range.
- `GET /api/ledger/export?from=&to=` (admin only) — same range as CSV (`Content-Type: text/csv`).

**Verify:** hit both endpoints over a range covering your seeded/generated ledger rows, confirm the math and the CSV formatting.

### Phase 20 — Analytics Dashboard (Frontend)
**Goal:** admin view of shop financial health.
**Files:** `frontend/index.html`
- Admin dashboard: three metric cards (Total Spend, Total Earnings, Net Profit).
- Date-range picker feeding Phase 19's endpoint.
- "Export Financial Report" button triggering the CSV download.

**Verify:** change the date range, confirm the cards update; click export, confirm a CSV downloads.

### Phase 21 — Job History (Frontend)
**Goal:** searchable archive of completed jobs.
**Files:** `frontend/index.html`
- "Job History" tab (admin/employee), backed by Phase 13's `GET /api/jobs?status=completed`.
- Filter by date range and/or customer name or plate number.
- Clicking a past job re-shows its line items with a re-download invoice option.

**Verify:** search for a completed job from earlier testing, confirm it appears and its invoice re-downloads correctly.
