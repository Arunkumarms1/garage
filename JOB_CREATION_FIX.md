# Fix: Enable Job Creation from Frontend

## Issue
Users could not create jobs from the UI. The backend had the `POST /api/jobs` endpoint (employee/admin only), but there was no frontend UI to access this functionality.

## Root Cause
- Backend: `POST /api/jobs` endpoint exists at `backend/server.js:1055-1086` (Phase 13)
- Frontend: No "Create Job" button, no modal, no JavaScript to call the API

## Solution
Added complete "Create Job" UI to the Dashboard tab in `frontend/index.html` with typable vehicle fields (not dropdown) for better UX - allows creating jobs for new vehicles not in the system.

---

## Changes Made

### 1. Dashboard Header - Add "Create Job" Button (~line 537)
```html
<button onclick="showCreateJobModal()" class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-1.5 px-3 rounded-lg text-xs tracking-wide transition-all shadow flex items-center space-x-1 hidden" id="btn-create-job">
  <span class="material-icons-round text-base">add</span>
  <span>Create Job</span>
</button>
```
- Hidden by default (`hidden` class)
- Shown only for `employee`/`admin` roles via JS logic in `loadDashboardJobs()`

---

### 2. Create Job Modal HTML (~line 2605, before `</body>`)
**Typable fields instead of dropdown:**
```html
<div id="create-job-modal" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 hidden p-4">
  <div class="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-xl">
    <div class="flex items-center justify-between">
      <h3 class="font-bold text-lg text-slate-900 dark:text-white">Create New Job</h3>
      <button onclick="hideCreateJobModal()" class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-1">
        <span class="material-icons-round text-2xl">close</span>
      </button>
    </div>
    <div class="space-y-3">
      <!-- Customer (required) + Plate Number (required) -->
      <div class="grid grid-cols-2 gap-2">
        <div>
          <label class="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Customer <span class="text-rose-500">*</span></label>
          <select id="create-job-customer" class="w-full px-3 py-1.5 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" required>
            <option value="">Loading customers...</option>
          </select>
        </div>
        <div>
          <label class="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Plate Number <span class="text-rose-500">*</span></label>
          <input type="text" id="create-job-plate" placeholder="ABC-1234" class="w-full px-3 py-1.5 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" style="text-transform: uppercase;" required>
        </div>
      </div>
      <!-- Make (optional) + Model (optional) -->
      <div class="grid grid-cols-2 gap-2">
        <div>
          <label class="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Make</label>
          <input type="text" id="create-job-make" placeholder="Toyota" class="w-full px-3 py-1.5 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500">
        </div>
        <div>
          <label class="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Model</label>
          <input type="text" id="create-job-model" placeholder="Camry" class="w-full px-3 py-1.5 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500">
        </div>
      </div>
      <!-- Year (optional) -->
      <div>
        <label class="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Year</label>
        <input type="number" id="create-job-year" placeholder="2020" min="1900" max="2099" class="w-full px-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all">
      </div>
      <!-- Notes -->
      <div>
        <label class="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Notes</label>
        <textarea id="create-job-notes" rows="3" class="w-full px-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all" placeholder="Job description, customer requests..."></textarea>
      </div>
    </div>
    <div class="flex space-x-2 pt-2">
      <button onclick="hideCreateJobModal()" class="flex-1 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 font-bold py-2.5 rounded-xl text-xs tracking-wide transition-all">Cancel</button>
      <button onclick="createJob()" class="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-xl text-xs tracking-wide transition-all shadow ripple-btn">Create Job</button>
    </div>
  </div>
</div>
```

---

### 3. JavaScript Functions (after `loadDashboardJobs()`, ~line 982)

#### Role Check Logic (in `loadDashboardJobs` ~line 972):
```javascript
const userStr = localStorage.getItem('garage_user');
const user = userStr ? JSON.parse(userStr) : null;
const isEmployeeOrAdmin = user && (user.role === 'employee' || user.role === 'admin');
const btnCreateJob = document.getElementById('btn-create-job');
if (btnCreateJob) {
  btnCreateJob.classList.toggle('hidden', !isEmployeeOrAdmin);
}
```

#### showCreateJobModal() - Fetches customers from `/api/customers` (~line 984):
```javascript
function showCreateJobModal() {
  const token = localStorage.getItem('garage_token');
  if (!token) return;

  // Reset form
  document.getElementById('create-job-customer').value = '';
  document.getElementById('create-job-plate').value = '';
  document.getElementById('create-job-make').value = '';
  document.getElementById('create-job-model').value = '';
  document.getElementById('create-job-year').value = '';
  document.getElementById('create-job-notes').value = '';
  document.getElementById('create-job-customer').innerHTML = '<option value="">Loading customers...</option>';
  document.getElementById('create-job-modal').classList.remove('hidden');

  // Fetch customers for dropdown
  fetch('/api/customers', { headers: { 'Authorization': `Bearer ${token}` } })
    .then(res => { if (!res.ok) throw new Error('Failed to load customers'); return res.json(); })
    .then(customers => {
      const select = document.getElementById('create-job-customer');
      select.innerHTML = '<option value="">Select a customer...</option>' + 
        customers.map(c => `<option value="${c.id}">${c.name} ${c.email ? '(' + c.email + ')' : ''} ${c.phone ? '• ' + c.phone : ''}</option>`).join('');
    })
    .catch(err => {
      console.error('Failed to load customers:', err);
      document.getElementById('create-job-customer').innerHTML = '<option value="">Failed to load customers</option>';
      showToast('Failed to load customers: ' + err.message, 'error', false);
    });
}
```

#### hideCreateJobModal() - Closes modal (~line 1017):
```javascript
function hideCreateJobModal() {
  document.getElementById('create-job-modal').classList.add('hidden');
}
```

#### createJob() - Two-step: Find/Create Vehicle → Create Job (~line 1020):
```javascript
async function createJob() {
  const token = localStorage.getItem('garage_token');
  if (!token) return;

  const customer_id = document.getElementById('create-job-customer').value;
  const plate_number = document.getElementById('create-job-plate').value.trim().toUpperCase();
  const make = document.getElementById('create-job-make').value.trim();
  const model = document.getElementById('create-job-model').value.trim();
  const year = document.getElementById('create-job-year').value ? parseInt(document.getElementById('create-job-year').value) : null;
  const notes = document.getElementById('create-job-notes').value.trim();

  // Validation: customer and plate required
  if (!customer_id) { showToast('Please select a customer', 'error', false); return; }
  if (!plate_number) { showToast('Please enter plate number', 'error', false); return; }

  const createBtn = document.querySelector('#create-job-modal button[onclick="createJob()"]');
  const originalBtnText = createBtn ? createBtn.innerHTML : '';

  try {
    // Show loading state
    if (createBtn) {
      createBtn.disabled = true;
      createBtn.innerHTML = '<span class="material-icons-round text-base animate-spin">refresh</span><span>Creating...</span>';
    }

    // Step 1: Find existing vehicle by plate, or create new
    const vehicle_id = await findOrCreateVehicle(token, customer_id, plate_number, make, model, year);
    
    // Step 2: Create job with vehicle_id
    const res = await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ vehicle_id, notes })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to create job');
    }

    const result = await res.json();
    showToast('Job created successfully!', 'check_circle', true);
    hideCreateJobModal();
    loadDashboardJobs();
  } catch (err) {
    console.error('Failed to create job:', err);
    showToast('Failed to create job: ' + err.message, 'error', false);
  } finally {
    // Restore button
    if (createBtn) {
      createBtn.disabled = false;
      createBtn.innerHTML = originalBtnText;
    }
  }
}
```

#### findOrCreateVehicle() - Helper to reuse existing or create new (~line 1075):
```javascript
// Helper: Find existing vehicle by plate, or create new
async function findOrCreateVehicle(token, customer_id, plate_number, make, model, year) {
  // First, try to find existing vehicle by plate
  const searchRes = await fetch(`/api/vehicles?plate_number=${encodeURIComponent(plate_number)}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (searchRes.ok) {
    const vehicles = await searchRes.json();
    if (vehicles && vehicles.length > 0) {
      // Verify it belongs to the selected customer
      const existing = vehicles.find(v => v.owner_id == customer_id);
      if (existing) return existing.id;
      // Plate exists but different customer - let backend handle 400 on create
    }
  }

  // Create new vehicle
  const body = { owner_id: parseInt(customer_id), plate_number };
  if (make) body.make = make;
  if (model) body.model = model;
  if (year) body.year = year;

  const createRes = await fetch('/api/vehicles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(body)
  });

  if (!createRes.ok) {
    const err = await createRes.json();
    // If duplicate plate error, try to find it again (race condition)
    if (err.error && err.error.includes('plate_number')) {
      const retryRes = await fetch(`/api/vehicles?plate_number=${encodeURIComponent(plate_number)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (retryRes.ok) {
        const vehicles = await retryRes.json();
        const existing = vehicles.find(v => v.owner_id == customer_id);
        if (existing) return existing.id;
      }
    }
    throw new Error(err.error || 'Failed to create vehicle');
  }

  const vehicle = await createRes.json();
  return vehicle.id;
}
```

---

## Authorization
| Role | Can Create Job? | Backend Check |
|------|----------------|---------------|
| admin | Yes | `requireRole('employee')` passes (admin rank ≥ employee) |
| employee | Yes | `requireRole('employee')` passes |
| customer | No | `requireRole('employee')` returns 403 |

---

## API Contract

### POST /api/jobs
- Headers: `Authorization: Bearer <token>`, `Content-Type: application/json`
- Body: `{ "vehicle_id": number, "notes": string }`
- Response (201): `{ "message": "Job created successfully.", "job": { "id", "vehicle_id", "status": "pending", "notes", "total_cost": 0 } }`
- Errors: 400 (missing vehicle_id), 401 (no token), 403 (customer role), 500 (DB error)

### Supporting APIs Used by Frontend
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/customers` | GET | Populate customer dropdown |
| `/api/vehicles?plate_number=X` | GET | Check if vehicle exists |
| `/api/vehicles` | POST | Create new vehicle (if not found) |

---

## Vehicle Reuse Logic
```
User enters plate number
        │
        ▼
GET /api/vehicles?plate_number=X
        │
        ├─ Found for selected customer → Reuse vehicle_id
        │
        └─ Not found OR different customer → POST /api/vehicles
                │
                ├─ Success → Return new vehicle.id
                │
                └─ Duplicate plate error → Retry GET → Reuse if found
```

---

## Testing

### Backend API Tests
```bash
# Login as employee
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"employee@garage.com","password":"EmployeePass!2026"}' \
  | grep -o '"token":"[^"]*' | cut -d'"' -f4)

# Test customer list
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/customers

# Test vehicle search by plate
curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:3000/api/vehicles?plate_number=ABC-123"

# Test vehicle creation
curl -s -X POST http://localhost:3000/api/vehicles \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"owner_id":4,"make":"BMW","model":"X5","plate_number":"BMW-001","year":2023}'

# Test duplicate plate handling
curl -s -X POST http://localhost:3000/api/vehicles \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"owner_id":4,"make":"BMW","model":"X5","plate_number":"BMW-001"}'
# Returns: {"error":"A vehicle with this plate number already exists."}

# Test job creation
curl -s -X POST http://localhost:3000/api/jobs \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"vehicle_id":4,"notes":"Test job"}'

# Test customer blocked (403)
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"customer@garage.com","password":"CustomerPass!2026"}' \
  | grep -o '"token":"[^"]*' | cut -d'"' -f4)

curl -s -X POST http://localhost:3000/api/jobs \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"vehicle_id":1,"notes":"Test job"}'
# {"error":"Forbidden: Requires employee role or higher."}
```

### Frontend Manual Test
1. Start server: `node backend/server.js`
2. Open `frontend/index.html` in browser
3. Login as `employee@garage.com` / `EmployeePass!2026`
4. Navigate to **Dashboard** tab
5. Verify "Create Job" button appears next to "Refresh"
6. Click "Create Job" → modal opens
7. Verify **customer dropdown** populated with customers
8. Fill **Plate Number** (required), optionally Make/Model/Year/Notes
9. Click "Create Job"
10. Button shows loading spinner
11. Toast shows "Job created successfully!"
12. Modal closes, new job appears in "Pending" column
13. **Test reuse**: Create another job with same plate → should reuse vehicle, create new job

---

## Files Modified
- `frontend/index.html` - Added button, modal with typable fields, and JS functions (~120 lines added)

## Related Phases
- Phase 13: Jobs Backend (added `POST /api/jobs`)
- Phase 14: Dashboard Frontend (where this UI was missing)
- Phase 15-17: Job Line Items & Completion (depends on jobs being created)