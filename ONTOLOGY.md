# Garage PWA — Domain Ontology

Phase: Post-21 (new work). Formal domain ontology for Garage Workshop PWA.

---

## 1. Taxonomy (Concept Hierarchy)

```
Entity
├── Actor / User
│   ├── Admin (rank 3)
│   ├── Employee (rank 2)
│   └── Customer (rank 1)
├── Asset
│   └── Vehicle (make, model, plate, year, owner)
├── Work
│   └── Job (pending → in-progress → completed → cancelled)
│       └── JobItem (line item: part / labor)
├── Material
│   └── Inventory (qty, cost_price, selling_price)
├── Reference / Catalog
│   ├── Service (name, price)
│   └── LineCatalog (description, price, type: part|labor)
├── Transaction
│   └── Ledger (sale | purchase, amount, date, job_ref)
└── Config / Context
    ├── Settings (key-value)
    ├── Holiday (date, reason)
    └── QRItem (scanned data)
```

---

## 2. Entity Properties (Attributes)

| Entity | Key Attributes |
|--------|---------------|
| User | id, name, email, role, phone, picture |
| Vehicle | id, owner_id (FK User), make, model, plate_number, year |
| Job | id, vehicle_id (FK Vehicle), status, notes, total_cost, photo, created_at, updated_at |
| JobItem | id, job_id (FK Job), inventory_id (FK Inventory, nullable), description, quantity, unit_price |
| Inventory | id, item_name, quantity, cost_price, selling_price |
| Service | id, name, price |
| LineCatalog | id, description, price, type (part \| labor) |
| Ledger | id, type (sale \| purchase), description, amount, date, job_id (nullable FK Job) |
| Settings | key, value |
| Holiday | id, date, reason |
| QRItem | id, qr_data |

---

## 3. Relationships (Object Properties)

```
User --owns--> Vehicle (1:N)
Vehicle --has--> Job (1:N)
Job --composed_of--> JobItem (1:N)
JobItem --references--> Inventory (N:1, optional)  [part items]
JobItem --references--> LineCatalog (conceptual)  [labor / description]
Job --produces--> Ledger (1:1, sale on status='completed')
Inventory --restocks--> Ledger (N:1, purchase when qty increases)
User --authorized_for--> Action (role-based)
```

---

## 4. State Machine (Job Lifecycle)

```
[pending] --update--> [in-progress]
[in-progress] --update--> [completed]  (validates stock, deducts inventory, logs sale)
[in-progress] --update--> [cancelled]
[completed] --restore--> [in-progress]  (restores inventory, deletes ledger entry)
[completed] --update--> [cancelled]  (blocked; requires restore first? actually allowed if not re-completing)
```

Note: Re-completion blocked (`currentJob.status === 'completed' && status === 'completed'`).
Leaving completed restores inventory and clears previous ledger (`DELETE FROM ledger WHERE job_id = ?`).

---

## 5. Role-Based Access Ontology

Actions mapped to minimum role rank (`admin > employee > customer`):

| Action | Entity | Min Role | Notes |
|--------|--------|----------|-------|
| READ (public) | Service, Settings, Holiday | none | Public info endpoint |
| READ (own) | Job, JobItem, Ledger | customer | Scoped by user/vehicle |
| READ (all) | Job, Vehicle, User, Inventory | employee | Admin reads all |
| CREATE | User (register) | none | Defaults to customer |
| CREATE | Vehicle, Job, JobItem, Inventory, Service, Catalog, Ledger, Holiday | employee | Admin/Employee |
| UPDATE | Job (status) | employee | Customer can see own only |
| UPDATE (complete) | Job + Inventory + Ledger | employee | Transactional: stock check → deduct → log sale |
| DELETE | User, Vehicle, Job, Inventory, Service, Catalog, Holiday | admin | Admin only for sensitive deletes |

---

## 6. Transaction Integrity (Ontology Constraints)

- **Referential Integrity:** `vehicle_id` → `vehicles.id` (ON DELETE CASCADE). `inventory_id` in `job_items` → `inventory.id` (ON DELETE SET NULL) — allows orphaned labor lines if inventory deleted.
- **Stock Constraint:** Job completion only allowed if `SUM(job_items.quantity) <= inventory.quantity` for all referenced inventory items.
- **Ledger Consistency:** Sale entry created automatically on job completion (`type='sale'`, amount=`job.total_cost`, `date=now()`, `job_id=job.id`). Purchase entry created on inventory restock (`qty_increase * cost_price`). Initial inventory seed also creates purchase.
- **Unique Constraints:** `users.email`, `vehicles.plate_number`, `settings.key`.

---

## 7. Analysis of Gaps / Extensions

Current ontology is relational/SQL-native. Potential extensions:

1. **Semantic Layer:** Export entities to JSON-LD (`@context`, `@type`) for web ontology interoperability.
2. **Knowledge Graph:** Link User → Vehicle → Job → Inventory via graph edges; enable recommendation ("customers with Toyota often need oil filter").
3. **State Ontology:** Formalize status transitions as rules (SPARQL/OWL restrictions) rather than server-side `if` checks.
4. **Catalog Ontology:** Separate `part` and `labor` into sub-classes with different pricing rules (parts use inventory reference, labor uses catalog reference only).
5. **Event Ontology:** Add `Event` entity for audit (who created/updated job, when inventory deducted, when ledger updated) — currently implicit in `updated_at`.

---

## 8. Plan to Implement / Maintain Ontology

Step 1: ✅ Documented in `ONTOLOGY.md` (this file).
Step 2: Create `ontology.json` (machine-readable schema) referencing entities, properties, relations.
Step 3: Update `database.js` comments to reference ontology entity names (e.g., `// ===== JOB ENTITY =====`).
Step 4: If user approves, create `ontology/` folder with `ontology.json` and `relations.dot` (Graphviz).

Next action required: Confirm if `ontology.json` and `relations.dot` are needed, or if `ONTOLOGY.md` is sufficient.
