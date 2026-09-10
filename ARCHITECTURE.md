# Architecture

## Overview

**Monorepo layout:** Node/Express backend + single-file vanilla JS PWA frontend + SQLite DB.

## Backend (`backend/`)

- **`server.js`** — Express server, all API logic + auth in one file. Port `3000`.
  - **Auth:** JWT (7d expiry, `jsonwebtoken`), passwords hashed via `crypto.pbkdf2Sync` (1000 iters, sha512). Three flows: register, login, Google Sign-In (`google-auth-library` validates ID tokens). Roles: `customer` | `owner`.
  - **Middleware:** `authenticateToken` (verifies Bearer JWT) → `requireRole(role)`.
  - **Endpoints:** auth (register/login/google), services (public read / owner CRUD), bookings (customer only sees own via email match; owner sees all + status updates), settings (key-value, owner writes), ledger (owner-only P&L: `totalSales - totalPurchases`; auto-logs a `sale` when a booking is "service finished"), admin users (owner reads users + service counts).
- **`database.js`** — SQLite3 (`backend/garage.db`). Tables: `users`, `settings`, `bookings`, `services`, `ledger`. Auto-creates tables + seeds defaults (settings, 2 owners, ledger, services, bookings) on startup.

## Frontend (`frontend/`)

- **`index.html`** — single-page app (SPA). Tailwind CDN, Material Icons, Google Identity Services. Served statically; `app.get('*')` falls back to it for client-side routing.
- **`sw.js`** — service worker: cache-first for static assets, network-first for API calls.
- **`manifest.json`** — PWA manifest.

## Support files

- **`scripts/reset-db.js`** — deletes and re-seeds `garage.db`.
- **`tests/auth-security.test.js`** — auth/security test suite (`npm test`).

## Data flow notes

- Customer identity in bookings is sourced from the JWT, never client input (server.js:289).
- No dev framework — plain fetch + DOM manipulation in `index.html`.