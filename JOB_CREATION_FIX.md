# Fix: Enable Job Creation from Frontend

## Issue
Users could not create jobs from the UI. The backend had the `POST /api/jobs` endpoint (employee/admin only), but there was no frontend UI to access this functionality.

## Root Cause
- Backend: `POST /api/jobs` endpoint exists at `backend/server.js:1055-1086` (Phase 13)
- Frontend: No "Create Job" button, no modal, no JavaScript to call the API

## Solution
Added complete "Create Job" UI to the Dashboard tab in `frontend/index.html`.

## Changes Made

### 1. Dashboard Header - Add "Create Job" Button (~line 537)
```html
<button onclick="showCreateJobModal()" class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-1.5 px-3 rounded-lg text-xs tracking-wide transition-all shadow flex items-center space-x-1 hidden" id="btn-create-job">
  <span class="material-icons-round text-base">add</span>
  <span>Create Job</span>
</button>
```
- Hidden by default (`hidden` class)
- Shown only for `employee`/`admin` roles via JS logic

### 2. Create Job Modal HTML (~line 2521, before `</body>`)
```html
<div id="create-job-modal" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 hidden p-4">
  <div class="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-xl">
    <!-- Vehicle dropdown (populated from /api/vehicles) -->
    <select id="create-job-vehicle" required>
      <option value="">Select a vehicle...</option>
    </select>
    <!-- Notes textarea -->
    <textarea id="create-job-notes" rows="3" placeholder="Job description, customer requests..."></textarea>
    <!-- Action buttons -->
    <button onclick="hideCreateJobModal()">Cancel</button>
    <button onclick="createJob()">Create Job</button>
  </div>
</div>
```

### 3. JavaScript Functions (after `loadDashboardJobs()`, ~line 980)

**Role Check Logic** (in `loadDashboardJobs`):
```javascript
const userStr = localStorage.getItem('garage_user');
const user = userStr ? JSON.parse(userStr) : null;
const isEmployeeOrAdmin = user && (user.role === 'employee' || user.role === 'admin');
document.getElementById('btn-create-job').classList.toggle('hidden', !isEmployeeOrAdmin);
```

**showCreateJobModal()** - Fetches vehicles from `/api/vehicles` and populates dropdown:
```javascript
function showCreateJobModal() {
  // Reset form
  // Fetch vehicles for dropdown
  fetch('/api/vehicles', { headers: { 'Authorization': `Bearer ${token}` } })
    .then(res => res.json())
    .then(vehicles => {
      select.innerHTML = vehicles.map(v => 
        `<option value="${v.id}">${v.make} ${v.model} (${v.year}) - ${v.plate_number} (${v.owner_name})</option>`
      ).join('');
    });
}
```

**hideCreateJobModal()** - Closes modal

**createJob()** - POSTs to `/api/jobs`:
```javascript
async function createJob() {
  const res = await fetch('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ vehicle_id: parseInt(vehicle_id), notes })
  });
  // On success: toast, close modal, reload dashboard
}
```

## Authorization
| Role | Can Create Job? | Backend Check |
|------|----------------|---------------|
| admin | Yes | `requireRole('employee')` passes (admin rank ≥ employee) |
| employee | Yes | `requireRole('employee')` passes |
| customer | No | `requireRole('employee')` returns 403 |

## API Contract
**POST /api/jobs**
- Headers: `Authorization: Bearer <token>`, `Content-Type: application/json`
- Body: `{ "vehicle_id": number, "notes": string }`
- Response (201): `{ "message": "Job created successfully.", "job": { "id", "vehicle_id", "status": "pending", "notes", "total_cost": 0 } }`
- Errors: 400 (missing vehicle_id), 401 (no token), 403 (customer role), 500 (DB error)

## Testing

### Backend API Test (Employee)
```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"employee@garage.com","password":"EmployeePass!2026"}' \
  | grep -o '"token":"[^"]*' | cut -d'"' -f4)

curl -s -X POST http://localhost:3000/api/jobs \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"vehicle_id":1,"notes":"Test job from API"}'
# {"message":"Job created successfully.","job":{"id":5,"vehicle_id":1,"status":"pending","notes":"Test job from API","total_cost":0}}
```

### Backend API Test (Customer - Should Fail)
```bash
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
7. Verify vehicle dropdown populated with 3 vehicles (Ford F-150, Honda Civic, Toyota Camry)
8. Select vehicle, add notes, click "Create Job"
9. Toast shows "Job created successfully!"
10. Modal closes, new job appears in "Pending" column

## Files Modified
- `frontend/index.html` - Added button, modal, and JS functions (~60 lines added)

## Related Phases
- Phase 13: Jobs Backend (added `POST /api/jobs`)
- Phase 14: Dashboard Frontend (where this UI was missing)
- Phase 15-17: Job Line Items & Completion (depends on jobs being created)