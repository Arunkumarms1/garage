    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js?v=3')
          .then(reg => console.log('Service Worker registered successfully!', reg.scope))
          .catch(err => console.error('Service Worker registration failed:', err));
      });
    }

    // Initialize state
    document.addEventListener('DOMContentLoaded', () => {
      // Dark Mode logic
      if (localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark');
        document.getElementById('dark-mode-icon').innerText = 'light_mode';
      } else {
        document.documentElement.classList.remove('dark');
        document.getElementById('dark-mode-icon').innerText = 'dark_mode';
      }

      // Fetch public info (branding + holidays) AND ontology data
      fetchPublicInfo();
      fetchOntologyData();

      // Check current JWT session token
      const token = localStorage.getItem('garage_token');
      const userStr = localStorage.getItem('garage_user');
      if (token && userStr) {
        try {
          const user = JSON.parse(userStr);
          showAuthUser(user, token);
        } catch (e) {
          localStorage.removeItem('garage_token');
          localStorage.removeItem('garage_user');
        }
      }
    });

    // Focus-scroll fallback for keyboard overlap on mobile
    document.body.addEventListener('focusin', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
        setTimeout(() => {
          e.target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 300);
      }
    });

    // API Base URL
    const API_BASE = '';

    // Fetch ontology data (entities + relations) - uses ontology API for all data fetching
    async function fetchOntologyData() {
      try {
        const token = localStorage.getItem('garage_token');
        const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
        const [entitiesRes, relationsRes] = await Promise.all([
          fetch('/api/ontology/entities', { headers }),
          fetch('/api/ontology/relations', { headers })
        ]);
        if (entitiesRes.ok && relationsRes.ok) {
          const entities = await entitiesRes.json();
          const relations = await relationsRes.json();
          renderOntologyData(entities, relations);
        }
      } catch (err) {
        console.warn('Failed to fetch ontology data:', err);
      }
    }

    function renderOntologyData(entities, relations) {
      let displayEl = document.getElementById('ontology-display');
      if (!displayEl) {
        const container = document.querySelector('main > div');
        if (!container) return;
        displayEl = document.createElement('div');
        displayEl.id = 'ontology-display';
        container.appendChild(displayEl);
      }
      const entitiesHtml = (entities.entities || entities).map(e => `
        <div class="bg-slate-800 border border-slate-700 p-3 shadow-sm mb-2">
          <h4 class="font-bold text-indigo-600 dark:text-indigo-400 text-sm">${e.name}</h4>
          <p class="text-xs text-slate-500 dark:text-slate-400">Attributes: ${(e.attributes || []).join(', ') || 'none'}</p>
        </div>
      `).join('');
      const relationsHtml = (relations.relations || relations).map(r => `
        <div class="bg-slate-900/50 border border-slate-700 p-3 shadow-sm mb-2">
          <p class="text-xs font-bold text-slate-700 dark:text-slate-300">${r.source || r.sourceEntity || ''} → ${r.target || r.targetEntity || ''}</p>
          <p class="text-[10px] text-slate-500 dark:text-slate-400">${r.relation || r.name || ''} (${r.cardinality || 'N:N'})</p>
        </div>
      `).join('');
      displayEl.innerHTML = `
        <div class="border-t border-slate-100 dark:border-slate-700 pt-4 space-y-3">
          <h3 class="text-sm font-bold text-indigo-600 dark:text-indigo-400">Ontology Data (API)</h3>
          <p class="text-[10px] text-slate-500 dark:text-slate-400">All data fetched from /api/ontology</p>
          <div class="text-left space-y-2 max-h-[40vh] overflow-y-auto pr-1">
            <h4 class="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Entities (${(entities.entities || entities).length})</h4>
            ${entitiesHtml}
            <h4 class="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider pt-1">Relations (${(relations.relations || relations).length})</h4>
            ${relationsHtml}
          </div>
        </div>
      `;
    }

    // Fetch public info (branding + holidays)
    async function fetchPublicInfo() {
      try {
        const res = await fetch('/api/public-info');
        if (!res.ok) return;
        const data = await res.json();
        if (data.shop_name) { document.title = data.shop_name; }
        updateHeaderBranding(data.shop_name, data.shop_icon);
        if (data.holidays && data.holidays.length > 0) { showHolidayBanner(data.holidays); }
      } catch (err) { console.warn('Failed to fetch public info:', err); }
    }

    // Update header with shop name and icon
    function updateHeaderBranding(shopName, shopIcon) {
      const headerTitle = document.querySelector('header h1');
      const logoContainer = document.querySelector('header .w-10.h-10');
      
      if (shopName && headerTitle) {
        headerTitle.textContent = shopName;
      }
      
      if (shopIcon && logoContainer) {
        // If icon is a base64 data URL or HTTP URL, use it as background image
        if (shopIcon.startsWith('data:') || shopIcon.startsWith('http')) {
          logoContainer.innerHTML = `<img src="${shopIcon}" alt="${shopName || 'Shop logo'}" class="w-full h-full object-cover rounded-full">`;
        } else {
          // Assume it's a Material Icon name
          logoContainer.innerHTML = `<span class="material-icons-round text-indigo-600 text-2xl">${shopIcon}</span>`;
        }
      }
    }

    // Show holiday banner on login screen for holidays within 14 days
    function showHolidayBanner(holidays) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const twoWeeksFromNow = new Date(today);
      twoWeeksFromNow.setDate(twoWeeksFromNow.getDate() + 14);
      
      const upcomingHolidays = holidays.filter(h => {
        const holidayDate = new Date(h.date);
        return holidayDate >= today && holidayDate <= twoWeeksFromNow;
      });
      
      if (upcomingHolidays.length === 0) return;
      
      // Only show on login screen (when auth forms are visible)
      const loginScreen = document.querySelector('main > div');
      if (!loginScreen || loginScreen.querySelector('#holiday-banner')) return;
      
      const bannerHtml = upcomingHolidays.map(h => `
        <div class="bg-amber-950/30 border border-amber-900/40 p-3 mb-4 flex items-start space-x-2.5">
          <span class="material-icons-round text-amber-600 dark:text-amber-400 text-lg mt-0.5">event</span>
          <div>
            <p class="text-xs font-bold text-white">${new Date(h.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</p>
            <p class="text-xs text-slate-600 dark:text-slate-300">${h.reason}</p>
          </div>
        </div>
      `).join('');
      
      const bannerContainer = document.createElement('div');
      bannerContainer.id = 'holiday-banner';
      bannerContainer.innerHTML = bannerHtml;
      
      // Insert at the top of the main content card
      loginScreen.insertBefore(bannerContainer, loginScreen.firstChild);
    }

    // Settings Cog (Admin Only) - opens settings tab
    function openSettings() {
      const userStr = localStorage.getItem('garage_user');
      const user = userStr ? JSON.parse(userStr) : null;
      if (user && user.role === 'admin') {
        switchAppTab('settings');
      } else {
        showToast('Admin access required', 'error', false);
      }
    }

    // Dark Mode Toggle
    function toggleDarkMode() {
      const isDark = document.documentElement.classList.toggle('dark');
      localStorage.theme = isDark ? 'dark' : 'light';
      document.getElementById('dark-mode-icon').innerText = isDark ? 'light_mode' : 'dark_mode';
    }

    // Toast Alert Helper
    function showToast(message, iconName = 'check_circle', isSuccess = true) {
      const toast = document.getElementById('toast');
      const toastIcon = document.getElementById('toast-icon');
      const toastMessage = document.getElementById('toast-message');

      toastIcon.innerText = iconName;
      toastIcon.className = `material-icons-round ${isSuccess ? 'text-green-400' : 'text-rose-400'}`;
      toastMessage.innerText = message;

      toast.style.opacity = '1';
      toast.style.transform = 'translate(-50%, 0px)';
      toast.style.pointerEvents = 'auto';

      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translate(-50%, -20px)';
        toast.style.pointerEvents = 'none';
      }, 3000);
    }

    // Google Sign-In Callback Handler
    async function handleGoogleCallback(response) {
      if (!response || !response.credential) {
        showToast('Google Sign-In failed or was cancelled.', 'error', false);
        return;
      }

      try {
        const res = await fetch('/api/auth/google', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken: response.credential })
        });
        const result = await res.json();

        if (!res.ok) {
          throw new Error(result.error || 'Google Authentication failed');
        }

        // Save session
        localStorage.setItem('garage_token', result.token);
        localStorage.setItem('garage_user', JSON.stringify(result.user));

        showAuthUser(result.user, result.token);
        showToast(result.message || 'Authenticated successfully with Google!', 'verified_user', true);
      } catch (err) {
        showToast(err.message, 'error', false);
      }
    }

    // Tab switcher
    function switchTab(tab) {
      const isLogin = tab === 'login';
      
      // Update buttons
      document.getElementById('tab-login').className = isLogin
        ? "flex-1 py-2 text-center text-xs font-bold rounded-lg transition-all bg-white dark:bg-slate-700 text-indigo-600 dark:text-white shadow-sm"
        : "flex-1 py-2 text-center text-xs font-bold rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-800 transition-all";
        
      document.getElementById('tab-register').className = !isLogin
        ? "flex-1 py-2 text-center text-xs font-bold rounded-lg transition-all bg-white dark:bg-slate-700 text-indigo-600 dark:text-white shadow-sm"
        : "flex-1 py-2 text-center text-xs font-bold rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-800 transition-all";

      // Show/Hide forms
      if (isLogin) {
        document.getElementById('form-login').classList.remove('hidden');
        document.getElementById('form-register').classList.add('hidden');
      } else {
        document.getElementById('form-login').classList.add('hidden');
        document.getElementById('form-register').classList.remove('hidden');
      }
    }

    // API Service calls
    async function handleLogin(event) {
      event.preventDefault();
      const email = document.getElementById('login-email').value;
      const password = document.getElementById('login-password').value;

      try {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Login failed');
        }

        // Save session
        localStorage.setItem('garage_token', data.token);
        localStorage.setItem('garage_user', JSON.stringify(data.user));

        showAuthUser(data.user, data.token);
        showToast('Successfully logged in!', 'verified_user', true);
      } catch (error) {
        showToast(error.message, 'error', false);
      }
    }

    async function handleRegister(event) {
      event.preventDefault();
      const name = document.getElementById('register-name').value;
      const email = document.getElementById('register-email').value;
      const password = document.getElementById('register-password').value;

      try {
        const response = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, password })
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Registration failed');
        }

        // Save session
        localStorage.setItem('garage_token', data.token);
        localStorage.setItem('garage_user', JSON.stringify(data.user));

        showAuthUser(data.user, data.token);
        showToast('Registration complete & signed in!', 'how_to_reg', true);
      } catch (error) {
        showToast(error.message, 'error', false);
      }
    }

    function showAuthUser(user, token) {
      document.getElementById('form-login').classList.add('hidden');
      document.getElementById('form-register').classList.add('hidden');
      document.getElementById('tab-login').parentElement.classList.add('hidden');
      const gContainer = document.getElementById('google-signin-container');
      if (gContainer) gContainer.classList.add('hidden');

      const mainContent = document.querySelector('main > div');
      if (mainContent) {
        mainContent.innerHTML = renderAppShell(user);
      }

      setupTabNavigation(user);
      // Show/hide settings cog based on role
      const cogBtn = document.getElementById('settings-cog');
      if (cogBtn) {
        cogBtn.classList.toggle('hidden', user.role !== 'admin');
      }
      if (user.role === 'admin') {
        loadSettingsTab();
      }
    }

    function renderAppShell(user) {
      const isAdmin = user.role === 'admin';
      const isEmployeeOrAdmin = user.role === 'employee' || user.role === 'admin';
      const isCustomer = user.role === 'customer';

      return `
        <div class="space-y-4">
          <!-- User Info Bar -->
          <header class="w-full bg-slate-900 border-b border-slate-800 px-4 py-3 flex justify-between items-center sticky top-0 z-40">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-full bg-indigo-600 text-white font-black flex items-center justify-center text-xs">${user.name.charAt(0).toUpperCase()}</div>
              <div>
                <p class="text-sm font-bold text-slate-100">${user.name}</p>
                <p class="text-xs text-slate-400">${user.email} • <span class="px-1.5 py-0.5 bg-slate-800 text-slate-300 text-[9px] uppercase font-bold">${user.role}</span></p>
              </div>
            </div>
            <button onclick="handleSignOut()" class="text-red-500 font-bold uppercase text-sm tracking-wider">Logout</button>
          </header>

          <!-- Tab Navigation -->
          <nav class="fixed bottom-0 left-0 w-full bg-slate-900 border-t border-slate-800 flex justify-around items-center h-16 px-2 z-50" id="app-tabs">
            ${isCustomer ? `<button onclick="switchAppTab('invoices')" class="min-h-[48px] py-2 px-3 text-center transition-all bg-slate-800 text-white shadow-sm flex items-center justify-center"><span class="material-icons-round text-2xl">receipt_long</span></button>` : `<button onclick="switchAppTab('dashboard')" class="min-h-[48px] py-2 px-3 text-center transition-all bg-slate-800 text-white shadow-sm flex items-center justify-center"><span class="material-icons-round text-2xl">dashboard</span></button>`}
            ${isCustomer ? '' : `<button onclick="switchAppTab('jobs')" class="min-h-[48px] py-2 px-3 text-center transition-all text-slate-400 hover:text-slate-800 flex items-center justify-center"><span class="material-icons-round text-2xl opacity-70 hover:opacity-100">work</span></button>`}
            ${isEmployeeOrAdmin ? `<button onclick="switchAppTab('customers')" class="min-h-[48px] py-2 px-3 text-center transition-all text-slate-400 hover:text-slate-800 flex items-center justify-center"><span class="material-icons-round text-2xl opacity-70 hover:opacity-100">people</span></button>` : ''}
            ${isEmployeeOrAdmin ? `<button onclick="switchAppTab('inventory')" class="min-h-[48px] py-2 px-3 text-center transition-all text-slate-400 hover:text-slate-800 flex items-center justify-center"><span class="material-icons-round text-2xl opacity-70 hover:opacity-100">inventory</span></button>` : ''}
            ${isAdmin ? `<button onclick="switchAppTab('analytics')" class="min-h-[48px] py-2 px-3 text-center transition-all text-slate-400 hover:text-slate-800 flex items-center justify-center"><span class="material-icons-round text-2xl opacity-70 hover:opacity-100">analytics</span></button>` : ''}
            ${isEmployeeOrAdmin ? `<button onclick="switchAppTab('history')" class="min-h-[48px] py-2 px-3 text-center transition-all text-slate-400 hover:text-slate-800 flex items-center justify-center"><span class="material-icons-round text-2xl opacity-70 hover:opacity-100">history</span></button>` : ''}
          </div>

          <!-- Tab Content -->
          <div id="tab-dashboard" class="app-tab-content space-y-4">
            <div class="bg-slate-900 p-4 space-y-4">
              <div class="flex items-center justify-between">
                <h3 class="font-bold text-white">Active Jobs</h3>
                <div class="flex items-center space-x-2">
                  <button onclick="showCreateJobModal()" class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-1.5 px-3 rounded-lg text-xs tracking-wide transition-all shadow flex items-center space-x-1 hidden" id="btn-create-job">
                    <span class="material-icons-round text-base">add</span>
                    <span>Create Job</span>
                  </button>
                  <button onclick="loadDashboardJobs()" class="px-3 py-1.5 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg text-xs font-bold transition-all flex items-center space-x-1">
                    <span class="material-icons-round text-base">refresh</span>
                    <span>Refresh</span>
                  </button>
                </div>
              </div>

              <!-- Kanban Board -->
              <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" id="dashboard-kanban">
                <!-- Pending Column -->
                <div class="bg-slate-900/50 p-3 min-h-[400px] flex flex-col">
                  <div class="flex items-center justify-between mb-3 pb-2 border-b border-slate-200 dark:border-slate-700">
                    <div class="flex items-center space-x-2">
                      <span class="w-2.5 h-2.5 rounded-full bg-blue-500"></span>
                      <h4 class="font-semibold text-slate-700 dark:text-slate-300 text-sm">Pending</h4>
                    </div>
                    <span id="count-pending" class="text-xs text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">0</span>
                  </div>
                  <div id="jobs-pending" class="flex-1 space-y-2 overflow-y-auto min-h-[300px]">
                    <p class="text-xs text-slate-400 dark:text-slate-500 text-center py-8">No pending jobs</p>
                  </div>
                </div>

                <!-- In Progress Column -->
                <div class="bg-slate-900/50 p-3 min-h-[400px] flex flex-col">
                  <div class="flex items-center justify-between mb-3 pb-2 border-b border-slate-200 dark:border-slate-700">
                    <div class="flex items-center space-x-2">
                      <span class="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                      <h4 class="font-semibold text-slate-700 dark:text-slate-300 text-sm">In Progress</h4>
                    </div>
                    <span id="count-in-progress" class="text-xs text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">0</span>
                  </div>
                  <div id="jobs-in-progress" class="flex-1 space-y-2 overflow-y-auto min-h-[300px]">
                    <p class="text-xs text-slate-400 dark:text-slate-500 text-center py-8">No in-progress jobs</p>
                  </div>
                </div>

                <!-- Completed Column (recent) -->
                <div class="bg-slate-900/50 p-3 min-h-[400px] flex flex-col">
                  <div class="flex items-center justify-between mb-3 pb-2 border-b border-slate-200 dark:border-slate-700">
                    <div class="flex items-center space-x-2">
                      <span class="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                      <h4 class="font-semibold text-slate-700 dark:text-slate-300 text-sm">Completed (Recent)</h4>
                    </div>
                    <span id="count-completed" class="text-xs text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">0</span>
                  </div>
                  <div id="jobs-completed" class="flex-1 space-y-2 overflow-y-auto min-h-[300px]">
                    <p class="text-xs text-slate-400 dark:text-slate-500 text-center py-8">No recent completed jobs</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div id="tab-jobs" class="app-tab-content hidden space-y-4">
            <div class="bg-slate-900 p-4 space-y-4">
              <div class="flex items-center justify-between">
                <h3 class="font-bold text-white">Job History</h3>
                <button onclick="loadJobHistory()" class="min-h-[48px] px-3 py-1.5 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg text-xs font-bold transition-all flex items-center space-x-1">
                  <span class="material-icons-round text-base">refresh</span>
                  <span>Refresh</span>
                </button>
              </div>

              <!-- Filters -->
              <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div class="relative">
                  <span class="material-icons-round absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-lg">search</span>
                  <input type="text" id="job-history-search" placeholder="Search by customer, plate, notes..." class="w-full min-h-[48px] pl-10 pr-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all" oninput="debouncedJobHistorySearch()">
                </div>
                <div class="relative">
                  <select id="job-history-status" class="w-full min-h-[48px] pl-3.5 pr-10 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all appearance-none" onchange="loadJobHistory()">
                    <option value="">All Statuses</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                  <span class="material-icons-round absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-lg pointer-events-none">keyboard_arrow_down</span>
                </div>
                <div class="relative">
                  <input type="date" id="job-history-from" class="w-full min-h-[48px] pl-3.5 pr-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all" onchange="loadJobHistory()">
                </div>
                <div class="relative">
                  <input type="date" id="job-history-to" class="w-full min-h-[48px] pl-3.5 pr-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all" onchange="loadJobHistory()">
                </div>
              </div>

              <!-- Jobs List -->
              <div id="job-history-list" class="space-y-3 max-h-[70vh] overflow-y-auto">
                <p class="text-sm text-slate-500 dark:text-slate-400 text-center py-8">Loading job history...</p>
              </div>
            </div>
          </div>

          <div id="tab-invoices" class="app-tab-content hidden space-y-4">
            <div class="bg-slate-900 p-4 space-y-4">
              <div class="flex items-center justify-between">
                <h3 class="font-bold text-white">Your Invoices</h3>
                <button onclick="loadInvoices()" class="min-h-[48px] px-3 py-1.5 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg text-xs font-bold transition-all flex items-center space-x-1">
                  <span class="material-icons-round text-base">refresh</span>
                  <span>Refresh</span>
                </button>
              </div>
              <div id="invoices-list" class="space-y-3 max-h-[70vh] overflow-y-auto">
                <p class="text-sm text-slate-500 dark:text-slate-400 text-center py-8">Loading invoices...</p>
              </div>
            </div>
          </div>

          <div id="tab-customers" class="app-tab-content hidden space-y-4">
            <div class="bg-slate-900 p-4 space-y-4">
              <div class="flex items-center justify-between">
                <h3 class="font-bold text-white">Customers & Vehicles</h3>
                <button onclick="showCustomerModal()" class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-xl text-xs tracking-wide transition-all shadow ripple-btn flex items-center space-x-1.5">
                  <span class="material-icons-round text-base">person_add</span>
                  <span>Add Customer</span>
                </button>
              </div>

              <!-- Search Bar -->
              <div class="flex gap-2">
                <div class="flex-1 relative">
                  <span class="material-icons-round absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-lg">search</span>
                  <input type="text" id="customer-search" placeholder="Search customers by name..." class="w-full min-h-[48px] pl-10 pr-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all">
                </div>
                <button onclick="loadCustomers()" class="min-h-[48px] px-4 py-2 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-xl text-xs font-bold transition-all">Refresh</button>
              </div>

              <!-- Customers List -->
              <div id="customers-list" class="space-y-3 max-h-[60vh] overflow-y-auto">
                <p class="text-sm text-slate-500 dark:text-slate-400 text-center py-8">Loading customers...</p>
              </div>
            </div>
          </div>

          <div id="tab-inventory" class="app-tab-content hidden space-y-4">
            <div class="bg-slate-900 p-4 space-y-4">
              <div class="flex items-center justify-between">
                <h3 class="font-bold text-white">Inventory Management</h3>
                <button onclick="showInventoryModal()" class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-xl text-xs tracking-wide transition-all shadow ripple-btn flex items-center space-x-1.5">
                  <span class="material-icons-round text-base">add</span>
                  <span>Add Item</span>
                </button>
              </div>

              <!-- Search Bar -->
              <div class="flex gap-2">
                <div class="flex-1 relative">
                  <span class="material-icons-round absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-lg">search</span>
                  <input type="text" id="inventory-search" placeholder="Search inventory by name..." class="w-full min-h-[48px] pl-10 pr-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all">
                </div>
                <button onclick="loadInventory()" class="min-h-[48px] px-4 py-2 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-xl text-xs font-bold transition-all">Refresh</button>
              </div>

              <!-- Inventory Table -->
              <div class="overflow-x-auto">
                <table class="w-full text-sm">
                  <thead>
                    <tr class="text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider border-b border-slate-200 dark:border-slate-700">
                      <th class="pb-2 pr-4">Item Name</th>
                      <th class="pb-2 pr-4 text-center">Quantity</th>
                      <th class="pb-2 pr-4 text-right">Cost Price</th>
                      <th class="pb-2 pr-4 text-right">Selling Price</th>
                      <th class="pb-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody id="inventory-table-body" class="divide-y divide-slate-100 dark:divide-slate-700">
                    <tr>
                      <td colspan="5" class="text-center text-slate-500 dark:text-slate-400 py-8">Loading inventory...</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <p id="inventory-empty" class="hidden text-sm text-slate-500 dark:text-slate-400 text-center py-8">No inventory items found</p>
            </div>
          </div>

          <div id="tab-settings" class="app-tab-content hidden space-y-4" data-admin-only>
            <div class="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4 space-y-6">
              <h3 class="font-bold text-white">Shop Settings</h3>
              
              <!-- Branding Section -->
              <div class="space-y-3 border-b border-slate-100 dark:border-slate-700 pb-4">
                <h4 class="font-semibold text-slate-700 dark:text-slate-300">Branding</h4>
                <div class="space-y-3">
                  <div>
                    <label class="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Shop Name</label>
                    <input type="text" id="settings-shop-name" placeholder="My Garage Workshop" class="w-full min-h-[48px] px-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all">
                  </div>
                  <div>
                    <label class="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Shop Icon (Base64 Data URL or Image URL)</label>
                    <input type="text" id="settings-shop-icon" placeholder="data:image/png;base64,... or https://example.com/logo.png" class="w-full min-h-[48px] px-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all">
                    <p class="text-[10px] text-slate-400 dark:text-slate-500 mt-1">Paste a base64 data URL or an HTTPS image URL. Leave empty to use default icon.</p>
                  </div>
                  <div>
                    <label class="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Contact Info</label>
                    <input type="text" id="settings-contact-info" placeholder="Phone, email, or address" class="w-full min-h-[48px] px-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all">
                  </div>
                  <div>
                    <label class="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">UPI ID (for invoice payment QR)</label>
                    <input type="text" id="settings-upi-id" placeholder="garage@upi" class="w-full min-h-[48px] px-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all">
                  </div>
                  <div>
                    <label class="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">UPI Name (confirmation for admin scan)</label>
                    <input type="text" id="settings-upi-name" placeholder="Garage Workshop" class="w-full min-h-[48px] px-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all">
                  </div>
                  <div>
                    <label class="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">UPI QR Image (upload or base64)</label>
                    <input type="file" id="settings-upi-image" accept="image/*" onchange="handleUpiImageUpload(this)" class="w-full text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100">
                    <p class="text-[10px] text-slate-400 dark:text-slate-500 mt-1">Upload a QR image. It will be embedded directly in invoices (no decode needed).</p>
                  </div>
                  <button onclick="saveBrandingSettings()" class="w-full min-h-[48px] bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-xl text-xs tracking-wide transition-all shadow ripple-btn">Save Branding</button>
                </div>
              </div>

              <!-- Holidays Section -->
              <div class="space-y-3">
                <div class="flex items-center justify-between">
                  <h4 class="font-semibold text-slate-700 dark:text-slate-300">Holiday Schedule</h4>
                </div>
                
                <!-- Add Holiday Form -->
                <div class="bg-slate-900/50 p-3 space-y-2">
                  <div class="grid grid-cols-2 gap-2">
                    <div>
                      <label class="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Date</label>
                      <input type="date" id="settings-holiday-date" class="w-full min-h-[48px] px-3 py-1.5 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    </div>
                    <div>
                      <label class="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Reason</label>
                      <input type="text" id="settings-holiday-reason" placeholder="Staff Training Day" class="w-full min-h-[48px] px-3 py-1.5 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    </div>
                  </div>
                  <button onclick="addHoliday()" class="w-full min-h-[48px] bg-amber-600 hover:bg-amber-700 text-white font-bold py-2 rounded-lg text-xs tracking-wide transition-all">Add Holiday</button>
                </div>

                <!-- Holiday List -->
                <div id="settings-holiday-list" class="space-y-2">
                  <p class="text-sm text-slate-500 dark:text-slate-400 text-center py-4">Loading holidays...</p>
                </div>
              </div>

              <!-- Admin QR Scanner (Admin Only) -->
              <div id="admin-qr-scanner" class="space-y-3 pt-4 border-t border-slate-100 dark:border-slate-700">
                <h4 class="font-semibold text-slate-700 dark:text-slate-300">Admin QR Operations (Admin Only)</h4>
                <p class="text-xs text-slate-500 dark:text-slate-400">Admin scan-only QR operations. Scan UPI or lookup codes directly. If empty, nothing embedded.</p>
                <div id="qr-reader-container" class="w-full rounded-xl overflow-hidden border border-slate-200 dark:border-slate-600"></div>
                <div class="flex flex-col space-y-3">
                  <p id="qr-status" class="text-xs text-slate-500 dark:text-slate-400">Ready to scan</p>
                  <button onclick="startQrScan()" class="w-full min-h-[48px] bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-xl text-xs tracking-wide transition-all shadow ripple-btn flex items-center justify-center space-x-2">
                    <span class="material-icons-round">camera_alt</span>
                    <span>Scan QR (Admin Only)</span>
                  </button>
                </div>
                <!-- Find Invoice by Number -->
                <div class="flex gap-2 pt-2">
                  <input type="number" id="invoice-lookup-input" placeholder="Invoice / Job #" class="flex-1 min-h-[48px] px-3 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all" min="1" onkeydown="if(event.key==='Enter') findInvoiceByNumber()">
                  <button onclick="findInvoiceByNumber()" class="min-h-[48px] bg-amber-600 hover:bg-amber-700 text-white font-bold px-3 py-2 rounded-xl text-xs tracking-wide transition-all shadow ripple-btn flex items-center space-x-1">
                    <span class="material-icons-round text-base">search</span>
                    <span>Find</span>
                  </button>
                </div>
              </div>

              <!-- DB Backup / Restore Section -->
              <div class="space-y-3 pt-4 border-t border-slate-100 dark:border-slate-700">
                <h4 class="font-semibold text-slate-700 dark:text-slate-300">Database Backup & Restore</h4>
                <p class="text-xs text-slate-500 dark:text-slate-400">Download or upload the full SQLite database file.</p>
                <div class="flex gap-2">
                  <button onclick="downloadDBBackup()" class="flex-1 min-h-[48px] bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 rounded-xl text-xs tracking-wide transition-all shadow ripple-btn flex items-center justify-center space-x-1.5">
                    <span class="material-icons-round text-base">download</span>
                    <span>Download DB</span>
                  </button>
                  <label class="flex-1 min-h-[48px] bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 rounded-xl text-xs tracking-wide transition-all shadow ripple-btn flex items-center justify-center space-x-1.5 cursor-pointer text-center">
                    <span class="material-icons-round text-base">upload_file</span>
                    <span>Restore DB</span>
                    <input type="file" id="db-restore-file" accept=".db,.sqlite,.sqlite3" class="hidden" onchange="uploadDBRestore(this)">
                  </label>
                </div>
                <p id="db-restore-status" class="text-[10px] text-slate-500 dark:text-slate-400 text-center hidden"></p>
              </div>
            </div>
          </div>

          <div id="tab-analytics" class="app-tab-content hidden space-y-4" data-admin-only>
            <div class="bg-slate-900 p-4 space-y-4">
              <div class="flex items-center justify-between">
                <h3 class="font-bold text-white">Financial Analytics</h3>
              </div>

              <!-- Date Range Picker -->
              <div class="flex flex-wrap items-end gap-4 bg-slate-900/50 p-4">
                <div class="flex-1 min-w-[140px]">
                  <label class="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">From</label>
                  <input type="date" id="analytics-from" class="w-full min-h-[48px] px-3.5 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all">
                </div>
                <div class="flex-1 min-w-[140px]">
                  <label class="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">To</label>
                  <input type="date" id="analytics-to" class="w-full min-h-[48px] px-3.5 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all">
                </div>
                <button onclick="fetchAnalytics()" class="min-h-[48px] bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 px-4 rounded-xl text-xs tracking-wide transition-all shadow ripple-btn flex items-center space-x-1.5 h-fit">
                  <span class="material-icons-round text-base">refresh</span>
                  <span>Refresh</span>
                </button>
                <button onclick="exportFinancialReport()" class="min-h-[48px] bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 px-4 rounded-xl text-xs tracking-wide transition-all shadow ripple-btn flex items-center space-x-1.5 h-fit">
                  <span class="material-icons-round text-base">download</span>
                  <span>Export CSV</span>
                </button>
              </div>

              <!-- Metric Cards -->
              <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <!-- Total Spend (Purchases) -->
                <div class="bg-rose-950/30 border border-rose-900/40 p-4">
                  <div class="flex items-center justify-between">
                    <div>
                      <p class="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Total Spend</p>
                      <p id="analytics-total-spend" class="text-2xl font-black text-rose-600 dark:text-rose-400 mt-1">₹0.00</p>
                    </div>
                    <span class="material-icons-round text-3xl text-rose-400 dark:text-rose-500">shopping_cart</span>
                  </div>
                </div>

                <!-- Total Earnings (Sales) -->
                <div class="bg-emerald-950/30 border border-emerald-900/40 p-4">
                  <div class="flex items-center justify-between">
                    <div>
                      <p class="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Total Earnings</p>
                      <p id="analytics-total-earnings" class="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">₹0.00</p>
                    </div>
                    <span class="material-icons-round text-3xl text-emerald-400 dark:text-emerald-500">attach_money</span>
                  </div>
                </div>

                <!-- Net Profit -->
                <div class="bg-indigo-950/30 border border-indigo-900/40 p-4">
                  <div class="flex items-center justify-between">
                    <div>
                      <p class="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Net Profit</p>
                      <p id="analytics-net-profit" class="text-2xl font-black text-indigo-600 dark:text-indigo-400 mt-1">₹0.00</p>
                    </div>
                    <span class="material-icons-round text-3xl text-indigo-400 dark:text-indigo-500">trending_up</span>
                  </div>
                </div>
              </div>

              <!-- Date range indicator -->
              <p id="analytics-date-range" class="text-xs text-slate-500 dark:text-slate-400 text-center hidden">
                Showing data for all time
              </p>
            </div>
          </div>

        <div id="tab-history" class="app-tab-content hidden space-y-4" data-admin-employee-only>
          <div class="bg-slate-900 p-4 space-y-4">
            <div class="flex items-center justify-between">
              <h3 class="font-bold text-white">Job History</h3>
                <button onclick="loadJobHistoryTab()" class="min-h-[48px] px-3 py-1.5 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg text-xs font-bold transition-all flex items-center space-x-1">
                <span class="material-icons-round text-base">refresh</span>
                <span>Refresh</span>
              </button>
            </div>

            <!-- Filters -->
            <div class="grid grid-cols-1 md:grid-cols-5 gap-3">
              <div class="relative md:col-span-2">
                <span class="material-icons-round absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-lg">search</span>
                <input type="text" id="history-search" placeholder="Search by customer name, plate number, notes..." class="w-full min-h-[48px] pl-10 pr-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all" oninput="debouncedHistorySearch()">
              </div>
              <div class="relative">
                <input type="date" id="history-from" class="w-full min-h-[48px] pl-3.5 pr-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all" onchange="loadJobHistoryTab()">
              </div>
              <div class="relative">
                <input type="date" id="history-to" class="w-full min-h-[48px] pl-3.5 pr-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all" onchange="loadJobHistoryTab()">
              </div>
              <button onclick="clearHistoryFilters()" class="min-h-[48px] px-4 py-2 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-xl text-xs font-bold transition-all flex items-center justify-center space-x-1.5 h-fit">
                <span class="material-icons-round text-base">filter_alt_off</span>
                <span>Clear</span>
              </button>
            </div>

            <!-- Jobs List -->
            <div id="history-jobs-list" class="space-y-3 max-h-[70vh] overflow-y-auto">
              <p class="text-sm text-slate-500 dark:text-slate-400 text-center py-8">Loading job history...</p>
            </div>
          </div>
        </div>
      `;
    }

    function setupTabNavigation(user) {
      const isCustomer = user.role === 'customer';
      const savedTab = sessionStorage.getItem('garage_last_tab');
      const allowedTabs = isCustomer ? ['invoices'] : [
        'dashboard', 'jobs', 'customers', 'inventory', 'analytics', 'history', 'settings'
      ].filter(t => {
        const btn = document.querySelector(`#app-tabs button[onclick*="switchAppTab('${t}')"]`);
        return btn !== null;
      });
      const defaultTab = isCustomer ? 'invoices' : 'dashboard';
      const tabToUse = (savedTab && allowedTabs.includes(savedTab)) ? savedTab : defaultTab;
      switchAppTab(tabToUse);
    }

    function switchAppTab(tabName) {
      // Hide all tab contents
      document.querySelectorAll('.app-tab-content').forEach(el => el.classList.add('hidden'));
      
      // Show selected tab
      const targetTab = document.getElementById(`tab-${tabName}`);
      if (targetTab) {
        targetTab.classList.remove('hidden');
      }

      // Update tab buttons
      document.querySelectorAll('#app-tabs button').forEach(btn => {
        const isActive = btn.onclick && btn.onclick.toString().includes(tabName);
        btn.className = isActive
          ? "min-h-[48px] py-2 px-3 text-center transition-all bg-slate-800 text-white shadow-sm flex items-center justify-center"
          : "min-h-[48px] py-2 px-3 text-center transition-all text-slate-400 hover:text-slate-800 flex items-center justify-center";
        const iconSpan = btn.querySelector('span.material-icons-round');
        if (iconSpan) {
          iconSpan.className = isActive ? "material-icons-round text-2xl" : "material-icons-round text-2xl opacity-70 hover:opacity-100";
        }
      });

      sessionStorage.setItem('garage_last_tab', tabName);

      // Load tab-specific data
      if (tabName === 'settings') {
        loadSettingsTab();
      } else if (tabName === 'customers') {
        loadCustomers();
      } else if (tabName === 'inventory') {
        loadInventory();
      } else if (tabName === 'dashboard') {
        loadDashboardJobs();
      } else if (tabName === 'jobs') {
        loadJobHistory();
      } else if (tabName === 'analytics') {
        fetchAnalytics();
      } else if (tabName === 'history') {
        loadJobHistoryTab();
      } else if (tabName === 'invoices') {
        loadInvoices();
      }
    }

    // ===== DASHBOARD TAB FUNCTIONS =====

    async function loadDashboardJobs() {
      const token = localStorage.getItem('garage_token');
      if (!token) return;

      const pendingEl = document.getElementById('jobs-pending');
      const inProgressEl = document.getElementById('jobs-in-progress');
      const completedEl = document.getElementById('jobs-completed');
      const countPendingEl = document.getElementById('count-pending');
      const countInProgressEl = document.getElementById('count-in-progress');
      const countCompletedEl = document.getElementById('count-completed');

      pendingEl.innerHTML = '<p class="text-xs text-slate-400 dark:text-slate-500 text-center py-8">Loading...</p>';
      inProgressEl.innerHTML = '<p class="text-xs text-slate-400 dark:text-slate-500 text-center py-8">Loading...</p>';
      completedEl.innerHTML = '<p class="text-xs text-slate-400 dark:text-slate-500 text-center py-8">Loading...</p>';

      try {
        // Load active jobs (pending + in-progress)
        const activeRes = await fetch('/api/jobs/active', {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!activeRes.ok) {
          const err = await activeRes.json();
          throw new Error(err.error || 'Failed to load active jobs');
        }

        const activeJobs = await activeRes.json();

        // Load recent completed jobs (last 10)
        const completedRes = await fetch('/api/jobs?status=completed', {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        let completedJobs = [];
        if (completedRes.ok) {
          completedJobs = await completedRes.json();
          completedJobs = completedJobs.slice(0, 10);
        }

        // Group active jobs by status
        const pendingJobs = activeJobs.filter(j => j.status === 'pending');
        const inProgressJobs = activeJobs.filter(j => j.status === 'in-progress');

        // Update counts
        countPendingEl.textContent = pendingJobs.length;
        countInProgressEl.textContent = inProgressJobs.length;
        countCompletedEl.textContent = completedJobs.length;

        // Render job cards
        renderJobCards(pendingJobs, 'jobs-pending');
        renderJobCards(inProgressJobs, 'jobs-in-progress');
        renderJobCards(completedJobs, 'jobs-completed', true);

      } catch (err) {
        console.error('Failed to load dashboard jobs:', err);
        pendingEl.innerHTML = `<p class="text-xs text-rose-500 dark:text-rose-400 text-center py-8">Failed to load: ${err.message}</p>`;
        inProgressEl.innerHTML = `<p class="text-xs text-rose-500 dark:text-rose-400 text-center py-8">Failed to load: ${err.message}</p>`;
        completedEl.innerHTML = `<p class="text-xs text-rose-500 dark:text-rose-400 text-center py-8">Failed to load: ${err.message}</p>`;
        showToast('Failed to load dashboard jobs', 'error', false);
      }

      // Show/hide Create Job button based on role
      const userStr = localStorage.getItem('garage_user');
      const user = userStr ? JSON.parse(userStr) : null;
      const isEmployeeOrAdmin = user && (user.role === 'employee' || user.role === 'admin');
      const btnCreateJob = document.getElementById('btn-create-job');
      if (btnCreateJob) {
        btnCreateJob.classList.toggle('hidden', !isEmployeeOrAdmin);
      }
    }

    // ===== CREATE JOB MODAL FUNCTIONS =====

    // Store customers for searchable dropdown
    let allCustomers = [];

    function showCreateJobModal() {
      const token = localStorage.getItem('garage_token');
      if (!token) return;

      // Reset form
      document.getElementById('create-job-customer-search').value = '';
      document.getElementById('create-job-customer').value = '';
      document.getElementById('create-job-plate').value = '';
      document.getElementById('create-job-make').value = '';
      document.getElementById('create-job-model').value = '';
      document.getElementById('create-job-year').value = '';
      document.getElementById('create-job-notes').value = '';
      document.getElementById('customer-dropdown').classList.add('hidden');
      document.getElementById('create-job-modal').classList.remove('hidden');

      // Fetch customers for dropdown
      fetch('/api/customers', { headers: { 'Authorization': `Bearer ${token}` } })
        .then(res => { if (!res.ok) throw new Error('Failed to load customers'); return res.json(); })
        .then(customers => {
          allCustomers = customers;
          renderCustomerDropdown(allCustomers);
        })
        .catch(err => {
          console.error('Failed to load customers:', err);
          document.getElementById('customer-dropdown').innerHTML = '<div class="px-3 py-2 text-sm text-rose-500">Failed to load customers</div>';
          document.getElementById('customer-dropdown').classList.remove('hidden');
          showToast('Failed to load customers: ' + err.message, 'error', false);
        });
    }

    function renderCustomerDropdown(customers) {
      const dropdown = document.getElementById('customer-dropdown');
      if (customers.length === 0) {
        dropdown.innerHTML = `
          <div class="px-3 py-3 space-y-2">
            <p class="text-xs text-slate-500 font-semibold">No customers found</p>
            <button onclick="showQuickAddCustomer()" class="w-full text-left px-3 py-2 bg-indigo-50 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 rounded-lg text-sm text-indigo-700 dark:text-indigo-300 font-bold transition-colors flex items-center gap-2">
              <span class="material-icons-round text-base">person_add</span>
              Add New Customer
            </button>
            <div id="quick-add-form" class="hidden space-y-2 border-t border-slate-200 dark:border-slate-700 pt-2">
              <input type="text" id="quick-add-name" placeholder="Customer Name" class="w-full px-3 py-1.5 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" required>
              <input type="tel" id="quick-add-phone" placeholder="Phone (10 digits)" class="w-full px-3 py-1.5 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" maxlength="10" inputmode="numeric" pattern="[0-9]{10}" oninput="this.value = this.value.replace(/[^0-9]/g, '').slice(0, 10)" required>
              <button onclick="submitQuickAddCustomer()" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 rounded-lg text-xs tracking-wide transition-all shadow">Save Customer</button>
            </div>
          </div>
        `;
      } else {
        dropdown.innerHTML = customers.map(c => `<button type="button" onclick="selectCustomer(${c.id}, '${c.name.replace(/'/g, "\\'")}')" class="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 dark:hover:bg-indigo-900/30 text-slate-700 dark:text-slate-200 border-b border-slate-100 dark:border-slate-700 last:border-0 transition-colors">${c.name} ${c.email ? '<span class="text-slate-400 text-xs">(' + c.email + ')</span>' : ''} ${c.phone ? '<span class="text-slate-400 text-xs">• ' + c.phone + '</span>' : ''}</button>`).join('');
      }
      // Dropdown stays hidden by default; shown only on input/focus
      dropdown.classList.add('hidden');
    }

    function filterCustomers(query) {
      const filtered = allCustomers.filter(c => {
        const q = query.toLowerCase();
        return c.name.toLowerCase().includes(q) || (c.email && c.email.toLowerCase().includes(q)) || (c.phone && c.phone.toLowerCase().includes(q));
      });
      renderCustomerDropdown(filtered);
      const dropdown = document.getElementById('customer-dropdown');
      if (dropdown && (query.trim() !== '' || document.activeElement === document.getElementById('create-job-customer-search'))) {
        dropdown.classList.remove('hidden');
      }
    }


    function showQuickAddCustomer() {
      const form = document.getElementById('quick-add-form');
      if (form) form.classList.remove('hidden');
    }

    async function submitQuickAddCustomer() {
      const name = document.getElementById('quick-add-name').value.trim();
      const phone = document.getElementById('quick-add-phone').value.trim();
      
      if (!name) { showToast('Name is required', 'error', false); return; }
      if (!phone) { showToast('Phone is required', 'error', false); return; }
      if (!/^[0-9]{10}$/.test(phone)) { showToast('Phone must be exactly 10 digits', 'error', false); return; }
      
      const token = localStorage.getItem('garage_token');
      if (!token) { showToast('Not authenticated', 'error', false); return; }
      
      try {
        const res = await fetch('/api/customers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ name, email: '', phone })
        });
        const data = await res.json();
        
        if (!res.ok) {
          throw new Error(data.error || 'Failed to create customer');
        }
        
        // Add to dropdown and select
        const customer = data.customer || { id: data.id || data.customer?.id, name, phone };
        allCustomers.push(customer);
        selectCustomer(customer.id, name);
        showToast('Customer added: ' + name, 'check_circle', true);
        
      } catch (err) {
        console.error('Quick add customer error:', err);
        showToast(err.message, 'error', false);
      }
    }

    function selectCustomer(id, name) {
      document.getElementById('create-job-customer').value = id;
      document.getElementById('create-job-customer-search').value = name;
      document.getElementById('customer-dropdown').classList.add('hidden');
    }

    function hideCreateJobModal() {
      document.getElementById('create-job-modal').classList.add('hidden');
      document.getElementById('customer-dropdown').classList.add('hidden');
      document.getElementById('create-job-customer-search').value = '';
    }

    // Close dropdowns when clicking outside
    document.addEventListener('click', function(e) {
      const customerDropdown = document.getElementById('customer-dropdown');
      const customerInput = document.getElementById('create-job-customer-search');
      if (customerDropdown && customerInput && !customerDropdown.contains(e.target) && e.target !== customerInput) {
        customerDropdown.classList.add('hidden');
      }
      const partDropdown = document.getElementById('part-dropdown');
      const partInput = document.getElementById('part-desc-search');
      if (partDropdown && partInput && !partDropdown.contains(e.target) && e.target !== partInput) {
        partDropdown.classList.add('hidden');
      }
      const laborDropdown = document.getElementById('labor-dropdown');
      const laborInput = document.getElementById('labor-desc-search');
      if (laborDropdown && laborInput && !laborDropdown.contains(e.target) && e.target !== laborInput) {
        laborDropdown.classList.add('hidden');
      }
    });

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
        
        // Get optional compressed photo
        const photoData = document.getElementById('create-job-modal').dataset.photo || null;

        // Step 2: Create job with vehicle_id
        const res = await fetch('/api/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ vehicle_id, notes, photo: photoData })
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to create job');
        }

        const result = await res.json();
        showToast('Job created successfully!', 'check_circle', true);
        document.getElementById('create-job-modal').dataset.photo = '';
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

    // Helper: Normalize plate number (trim, collapse whitespace, uppercase)
    function normalizePlate(plate) {
      return plate.trim().replace(/\s+/g, '').toUpperCase();
    }

    // Helper: Compress image to 720p base64 for low storage
    function compressImage(file, maxDim = 720, quality = 0.7) {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const img = new Image();
          img.onload = () => {
            let w = img.width;
            let h = img.height;
            if (w > maxDim || h > maxDim) {
              const ratio = Math.min(maxDim / w, maxDim / h);
              w = Math.round(w * ratio);
              h = Math.round(h * ratio);
            }
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL('image/jpeg', quality));
          };
          img.src = e.target.result;
        };
        reader.readAsDataURL(file);
      });
    }

    async function handleCreateJobPhoto(input) {
      if (input.files && input.files[0]) {
        const compressed = await compressImage(input.files[0], 720, 0.75);
        document.getElementById('create-job-modal').dataset.photo = compressed;
        input.nextElementSibling && input.nextElementSibling.classList && input.nextElementSibling.classList.add('hidden');
      }
    }

    // Camera / OCR scanning for plate number
    let plateVideoStream = null;
    let plateScanning = false;

    function startPlateScan() {
      const video = document.createElement('video');
      video.setAttribute('autoplay', '');
      video.setAttribute('playsinline', '');
      video.style.width = '100%';
      video.style.borderRadius = '0.75rem';
      video.style.backgroundColor = '#000';

      navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } })
        .then(stream => {
          plateVideoStream = stream;
          video.srcObject = stream;
          video.play();
          
          // Create scanning overlay in modal area temporarily
          const modalBody = document.querySelector('#create-job-modal > div');
          const scanOverlay = document.createElement('div');
          scanOverlay.id = 'plate-scan-overlay';
          scanOverlay.className = 'fixed inset-0 bg-black/90 z-[60] flex flex-col items-center justify-center p-6';
          scanOverlay.innerHTML = `
            <div class="w-full max-w-md bg-slate-900 rounded-2xl p-4 shadow-2xl">
              <div class="flex items-center justify-between mb-3">
                <h3 class="font-bold text-white text-sm">Scan Plate</h3>
                <button onclick="stopPlateScan()" class="text-slate-400 hover:text-white" title="Close">
                  <span class="material-icons-round text-xl">close</span>
                </button>
              </div>
              <video id="plate-video" autoplay playsinline class="w-full rounded-xl mb-3 bg-black"></video>
              <canvas id="plate-canvas" class="hidden"></canvas>
              <p class="text-xs text-slate-400 text-center mb-3">Position the plate number in the frame</p>
              <div class="flex gap-2">
                <button onclick="capturePlateFrame()" class="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-xl text-xs transition-all shadow">Capture</button>
                <button onclick="stopPlateScan()" class="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-bold py-2.5 rounded-xl text-xs transition-all">Cancel</button>
              </div>
              <p id="plate-ocr-status" class="text-xs text-slate-400 mt-2 text-center"></p>
            </div>
          `;
          document.body.appendChild(scanOverlay);
          
          // Assign video stream to overlay video element
          setTimeout(() => {
            const overlayVideo = document.getElementById('plate-video');
            if (overlayVideo && plateVideoStream) {
              overlayVideo.srcObject = plateVideoStream;
            }
          }, 100);
        })
        .catch(err => {
          console.error('Camera access denied or error:', err);
          showToast('Camera access denied or unavailable', 'error', false);
        });
    }

    function stopPlateScan() {
      if (plateVideoStream) {
        plateVideoStream.getTracks().forEach(track => track.stop());
        plateVideoStream = null;
      }
      const overlay = document.getElementById('plate-scan-overlay');
      if (overlay) overlay.remove();
      plateScanning = false;
    }

    function capturePlateFrame() {
      const video = document.getElementById('plate-video');
      const canvas = document.getElementById('plate-canvas');
      const status = document.getElementById('plate-ocr-status');
      if (!video || !canvas) return;

      // Set canvas size to match video
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      status.textContent = 'Reading plate...';
      status.className = 'text-xs text-indigo-400 mt-2 text-center';

      // Convert canvas to image data for Tesseract
      const imageData = canvas.toDataURL('image/png');
      
      if (typeof Tesseract === 'undefined') {
        status.textContent = 'OCR library not loaded';
        status.className = 'text-xs text-rose-400 mt-2 text-center';
        return;
      }

      Tesseract.recognize(
        imageData,
        'eng',
        { logger: m => { if (m.status === 'recognizing text') status.textContent = 'Reading... ' + Math.round(m.progress * 100) + '%'; } }
      ).then(({ data: { text } }) => {
        // Clean up OCR result for plate format
        let result = text.trim().toUpperCase();
        // Remove common OCR errors and whitespace
        result = result.replace(/[^A-Z0-9]/g, '').replace(/\s+/g, '');
        if (result.length < 2) {
          status.textContent = 'No plate text detected. Try again.';
          status.className = 'text-xs text-amber-400 mt-2 text-center';
        } else {
          document.getElementById('create-job-plate').value = result;
          status.textContent = 'Detected: ' + result;
          status.className = 'text-xs text-emerald-400 mt-2 text-center';
          showToast('Plate detected: ' + result, 'check_circle', true);
          setTimeout(stopPlateScan, 1500);
        }
      }).catch(err => {
        console.error('OCR error:', err);
        status.textContent = 'Read error. Try again.';
        status.className = 'text-xs text-rose-400 mt-2 text-center';
      });
    }

    // Helper: Find existing vehicle by plate, or create new
    async function findOrCreateVehicle(token, customer_id, plate_number, make, model, year) {
      const normalizedPlate = normalizePlate(plate_number);
      
      // First, try to find existing vehicle by plate
      const searchRes = await fetch(`/api/vehicles?plate_number=${encodeURIComponent(normalizedPlate)}`, {
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
      const body = { owner_id: parseInt(customer_id), plate_number: normalizedPlate };
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
          const retryRes = await fetch(`/api/vehicles?plate_number=${encodeURIComponent(normalizedPlate)}`, {
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

      const result = await createRes.json();
      // Backend returns { message: 'Vehicle created successfully.', vehicle: { id, ... } }
      return result.vehicle ? result.vehicle.id : result.id;
    }

    function renderJobCards(jobs, containerId, isCompleted = false) {
      const container = document.getElementById(containerId);
      if (!container) return;

      if (!jobs || jobs.length === 0) {
        container.innerHTML = `<p class="text-xs text-slate-400 dark:text-slate-500 text-center py-8">${isCompleted ? 'No recent completed jobs' : 'No jobs in this status'}</p>`;
        return;
      }

      container.innerHTML = jobs.map(job => `
        <div class="w-full bg-slate-900 border-b border-slate-800 p-4 active:bg-slate-800 transition-colors" onclick="showJobDetailModal(${job.id})">
          <div class="flex justify-between items-center mb-1">
            <span class="font-bold text-lg text-white">${job.make} ${job.model}</span>
            <span class="text-xs px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-300">${formatStatus(job.status)}</span>
          </div>
          <div class="text-sm text-slate-400 mb-2">${job.customer_name || 'Unknown Customer'} • ${job.plate_number}</div>
          <div class="flex justify-between items-center">
            <span class="text-slate-300 italic">${job.notes || ''}</span>
            <span class="font-bold text-blue-400">₹${Number(job.total_cost || 0).toFixed(2)}</span>
          </div>
        </div>
      `).join('');
    }

    function getStatusBadgeClass(status) {
      switch (status) {
        case 'pending': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';
        case 'in-progress': return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300';
        case 'completed': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300';
        case 'cancelled': return 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300';
        default: return 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300';
      }
    }

    function formatStatus(status) {
      return status.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
    }

    // Job Detail Modal State
    let currentJobId = null;

    async function showJobDetailModal(jobId) {
      const token = localStorage.getItem('garage_token');
      if (!token) return;

      currentJobId = jobId;

      try {
        const res = await fetch(`/api/jobs/${jobId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to load job details');
        }

        const job = await res.json();

        // Populate modal
        document.getElementById('job-detail-title').textContent = `Job #${job.id}`;
        document.getElementById('job-detail-vehicle').textContent = `${job.make} ${job.model} ${job.year ? '(' + job.year + ')' : ''} - ${job.plate_number}`;
        document.getElementById('job-detail-customer').textContent = `${job.customer_name} (${job.customer_email})`;
        document.getElementById('job-detail-status').value = job.status;
        document.getElementById('job-detail-notes').value = job.notes || '';
        document.getElementById('job-detail-total').textContent = `₹${Number(job.total_cost || 0).toFixed(2)}`;

        // Show car photo if available
        const photoContainer = document.getElementById('job-detail-photo-container');
        const photoImg = document.getElementById('job-detail-photo');
        if (job.photo && photoContainer && photoImg) {
          photoImg.src = job.photo;
          photoContainer.classList.remove('hidden');
        } else {
          if (photoContainer) photoContainer.classList.add('hidden');
        }
        document.getElementById('job-detail-created').textContent = new Date(job.created_at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });

        // Show/hide status dropdown and line items based on role (employee/admin can edit)
        const userStr = localStorage.getItem('garage_user');
        const user = userStr ? JSON.parse(userStr) : null;
        const statusSelect = document.getElementById('job-detail-status');
        const saveBtn = document.getElementById('job-detail-save');
        const addItemSection = document.querySelector('#job-detail-modal .border-t.border-slate-200.pt-4');
        if (user && (user.role === 'employee' || user.role === 'admin')) {
          statusSelect.disabled = false;
          saveBtn.classList.remove('hidden');
          if (addItemSection) {
            // Hide line items section entirely for completed jobs
            if (job.status === 'completed') {
              addItemSection.classList.add('hidden');
            } else {
              addItemSection.classList.remove('hidden');
            }
          }
          // Load job items and inventory for parts dropdown (skip for completed)
          if (job.status !== 'completed') {
            await loadJobItems(currentJobId);
            await loadPartCatalog();
            await loadLaborCatalog();
          }
        } else {
          statusSelect.disabled = true;
          saveBtn.classList.add('hidden');
          if (addItemSection) addItemSection.classList.add('hidden');
        }

        // Show/hide Generate Invoice button for completed jobs (all roles can download their own)
        const invoiceBtn = document.getElementById('job-detail-invoice');
        if (job.status === 'completed') {
          invoiceBtn.classList.remove('hidden');
        } else {
          invoiceBtn.classList.add('hidden');
        }

        document.getElementById('job-detail-modal').classList.remove('hidden');
      } catch (err) {
        console.error('Failed to load job detail:', err);
        showToast('Failed to load job details: ' + err.message, 'error', false);
      }
    }

    function hideJobDetailModal() {
      document.getElementById('job-detail-modal').classList.add('hidden');
      currentJobId = null;
    }

    async function saveJobDetail() {
      const token = localStorage.getItem('garage_token');
      if (!token || !currentJobId) return;

      const newStatus = document.getElementById('job-detail-status').value;
      const notes = document.getElementById('job-detail-notes').value.trim();

      try {
        // First get current job to check if status is changing to completed
        const currentJobRes = await fetch(`/api/jobs/${currentJobId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        let wasCompleted = false;
        if (currentJobRes.ok) {
          const currentJob = await currentJobRes.json();
          wasCompleted = currentJob.status === 'completed';
        }

        const res = await fetch(`/api/jobs/${currentJobId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ status: newStatus, notes })
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to update job');
        }

        showToast('Job updated successfully!', 'check_circle', true);
        hideJobDetailModal();
        loadDashboardJobs();

        // If job was just marked as completed, refresh analytics and history tabs
        if (!wasCompleted && newStatus === 'completed') {
          // Check which tabs are currently visible and refresh them
          const analyticsTab = document.getElementById('tab-analytics');
          const historyTab = document.getElementById('tab-history');
          
          if (analyticsTab && !analyticsTab.classList.contains('hidden')) {
            fetchAnalytics();
          }
          if (historyTab && !historyTab.classList.contains('hidden')) {
            loadJobHistoryTab();
          }
        }
      } catch (err) {
        console.error('Failed to save job:', err);
        showToast('Failed to update job: ' + err.message, 'error', false);
      }
    }

    // ===== JOB LINE ITEMS FUNCTIONS =====

    let currentItemType = 'part';

    function setItemType(type) {
      currentItemType = type;
      const partBtn = document.getElementById('btn-add-part');
      const laborBtn = document.getElementById('btn-add-labor');
      const partForm = document.getElementById('part-form');
      const laborForm = document.getElementById('labor-form');

      if (type === 'part') {
        partBtn.className = 'flex-1 px-3 py-2 text-xs font-bold rounded-lg transition-all bg-indigo-600 text-white shadow-sm';
        laborBtn.className = 'flex-1 px-3 py-2 text-xs font-bold rounded-lg transition-all bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600';
        partForm.classList.remove('hidden');
        laborForm.classList.add('hidden');
      } else {
        partBtn.className = 'flex-1 px-3 py-2 text-xs font-bold rounded-lg transition-all bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600';
        laborBtn.className = 'flex-1 px-3 py-2 text-xs font-bold rounded-lg transition-all bg-amber-600 text-white shadow-sm';
        partForm.classList.add('hidden');
        laborForm.classList.remove('hidden');
      }
    }

    function scrollToCenter(el) {
      if (!el) return;
      const modalContent = document.querySelector('#job-detail-modal > div');
      if (!modalContent) return;
      // Use requestAnimationFrame to handle keyboard opening delay
      setTimeout(() => {
        const rect = el.getBoundingClientRect();
        const contentRect = modalContent.getBoundingClientRect();
        const scrollTop = modalContent.scrollTop + (rect.top - contentRect.top) - (contentRect.height / 3) + (rect.height / 2);
        modalContent.scrollTo({ top: Math.max(0, scrollTop), behavior: 'smooth' });
      }, 150);
    }

    async function loadJobItems(jobId) {
      const token = localStorage.getItem('garage_token');
      if (!token) return;

      const listEl = document.getElementById('job-items-list');
      listEl.innerHTML = '<p class="text-xs text-slate-500 dark:text-slate-400 text-center py-4">Loading line items...</p>';

      try {
        const res = await fetch(`/api/jobs/${jobId}/items`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to load job items');
        }

        const items = await res.json();

        if (!items || items.length === 0) {
          listEl.innerHTML = '<p class="text-xs text-slate-500 dark:text-slate-400 text-center py-4">No line items yet. Add parts or labor below.</p>';
          return;
        }

        let total = 0;
        listEl.innerHTML = items.map(item => {
          const lineTotal = item.quantity * item.unit_price;
          total += lineTotal;
          const isPart = item.inventory_id !== null;
          return `
            <div class="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-3 flex items-center justify-between">
              <div class="flex-1 min-w-0">
                <div class="flex items-center space-x-2 mb-1">
                  <span class="material-icons-round text-xs ${isPart ? 'text-indigo-500' : 'text-amber-500'}">${isPart ? 'build' : 'handyman'}</span>
                  <span class="font-medium text-white text-sm truncate">${item.description}</span>
                  ${isPart ? '<span class="px-1.5 py-0.5 text-[9px] font-bold rounded bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400">Part</span>' : '<span class="px-1.5 py-0.5 text-[9px] font-bold rounded bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400">Labor</span>'}
                </div>
                <div class="flex items-center space-x-4 text-xs text-slate-500 dark:text-slate-400 ml-5">
                  <span>Qty: ${item.quantity}</span>
                  <span>@ ₹${Number(item.unit_price).toFixed(2)}</span>
                  <span class="font-medium text-white">= ₹${lineTotal.toFixed(2)}</span>
                </div>
              </div>
              <button onclick="deleteJobItem(${item.id})" class="text-rose-500 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-300 p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-900/20 ml-2 flex-shrink-0" aria-label="Delete line item">
                <span class="material-icons-round text-lg">delete</span>
              </button>
            </div>
          `;
        }).join('');

        // Update the total display
        document.getElementById('job-detail-total').textContent = `₹${total.toFixed(2)}`;

      } catch (err) {
        console.error('Failed to load job items:', err);
        listEl.innerHTML = `<p class="text-xs text-rose-500 dark:text-rose-400 text-center py-4">Failed to load: ${err.message}</p>`;
      }
    }

    let allPartCatalog = [];
    let allLaborCatalog = [];

    async function loadPartCatalog() {
      const token = localStorage.getItem('garage_token');
      if (!token) return;
      try {
        const res = await fetch('/api/inventory', { headers: { 'Authorization': `Bearer ${token}` } });
        if (res.ok) {
          allPartCatalog = await res.json();
        }
      } catch (err) {
        console.warn('Failed to load inventory for parts:', err);
      }
    }

    async function loadLaborCatalog() {
      const token = localStorage.getItem('garage_token');
      if (!token) return;
      try {
        const res = await fetch('/api/catalog?type=labor', { headers: { 'Authorization': `Bearer ${token}` } });
        if (res.ok) {
          allLaborCatalog = await res.json();
        }
      } catch (err) {
        console.warn('Failed to load labor catalog:', err);
      }
    }

    function filterPartCatalog(query) {
      const q = (query || '').toLowerCase();
      const filtered = allPartCatalog.filter(c => c.item_name.toLowerCase().includes(q));
      renderPartDropdown(filtered);
      const dropdown = document.getElementById('part-dropdown');
      const input = document.getElementById('part-desc-search');
      // Show dropdown when input is focused, when there's text, or when interacting inside dropdown; hide only when unfocused and empty
      if (dropdown && input) {
        const activeInsideDropdown = dropdown.contains(document.activeElement);
        if (document.activeElement === input || activeInsideDropdown || q !== '') {
          dropdown.classList.remove('hidden');
        } else {
          dropdown.classList.add('hidden');
        }
      }
    }

    function renderPartDropdown(items) {
      const dropdown = document.getElementById('part-dropdown');
      if (!dropdown) return;
      const listHtml = items.length > 0 ? items.map(c => `<button type="button" onclick="selectPart(${c.id}, '${c.item_name.replace(/'/g, "\\'")}', ${c.selling_price}, ${c.quantity || 0})" class="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 dark:hover:bg-indigo-900/30 text-slate-700 dark:text-slate-200 border-b border-slate-100 dark:border-slate-700 last:border-0 transition-colors">${c.item_name} <span class="text-slate-400 text-xs">(₹${Number(c.selling_price).toFixed(2)}) - Stock: ${c.quantity || 0}</span></button>`).join('') : `<div class="px-3 py-2 text-xs text-slate-500">No parts found</div>`;
      dropdown.innerHTML = `
        <div class="max-h-48 overflow-y-auto">${listHtml}</div>
        <div class="border-t border-slate-200 dark:border-slate-700 pt-2 mt-1"></div>
        <button type="button" onclick="showQuickAddPart()" class="w-full text-left px-3 py-2.5 bg-indigo-50 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 rounded-xl text-sm text-indigo-700 dark:text-indigo-300 font-bold transition-all flex items-center gap-2 shadow-sm">
          <span class="material-icons-round text-base">add_circle</span> Add New Part
        </button>
        <div id="quick-add-part-form" class="hidden space-y-2 border-t border-slate-200 dark:border-slate-700 pt-2 mt-1">
          <input type="text" id="quick-add-part-name" placeholder="Part name" onfocus="scrollToCenter(this)" class="w-full px-3.5 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all">
          <div class="grid grid-cols-2 gap-2">
            <input type="number" id="quick-add-part-qty" value="1" min="1" onfocus="scrollToCenter(this)" class="w-full px-3.5 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all">
            <input type="number" id="quick-add-part-price" step="0.01" min="0" placeholder="Unit price" onfocus="scrollToCenter(this)" class="w-full px-3.5 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all">
          </div>
          <button onclick="submitQuickAddPart()" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl text-sm tracking-wide transition-all shadow ripple-btn">Save & Add Part</button>
        </div>
      `;
      dropdown.classList.add('hidden');
    }

    function selectPart(id, desc, price, qty) {
      document.getElementById('part-desc-search').value = desc;
      document.getElementById('part-desc-id').value = id || '';
      document.getElementById('job-item-part-price').value = price || '';
      document.getElementById('part-dropdown').classList.add('hidden');
      // If selecting from inventory, also fill quantity if needed
      if (qty !== undefined) {
        document.getElementById('job-item-part-qty').value = qty > 0 ? qty : 1;
      }
    }

    function filterLaborCatalog(query) {
      const q = (query || '').toLowerCase();
      const filtered = allLaborCatalog.filter(c => c.description.toLowerCase().includes(q));
      renderLaborDropdown(filtered);
      const dropdown = document.getElementById('labor-dropdown');
      const input = document.getElementById('labor-desc-search');
      if (dropdown && input) {
        const activeInsideDropdown = dropdown.contains(document.activeElement);
        if (document.activeElement === input || activeInsideDropdown || q !== '') {
          dropdown.classList.remove('hidden');
        } else {
          dropdown.classList.add('hidden');
        }
      }
    }

    function renderLaborDropdown(items) {
      const dropdown = document.getElementById('labor-dropdown');
      if (!dropdown) return;
      const listHtml = items.length > 0 ? items.map(c => `<button type="button" onclick="selectLabor(${c.id}, '${c.description.replace(/'/g, "\\'")}', ${c.price})" class="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 dark:hover:bg-indigo-900/30 text-slate-700 dark:text-slate-200 border-b border-slate-100 dark:border-slate-700 last:border-0 transition-colors">${c.description} <span class="text-slate-400 text-xs">(₹${Number(c.price).toFixed(2)})</span></button>`).join('') : `<div class="px-3 py-2 text-xs text-slate-500">No labor items found</div>`;
      dropdown.innerHTML = `
        <div class="max-h-48 overflow-y-auto">${listHtml}</div>
        <div class="border-t border-slate-200 dark:border-slate-700 pt-2 mt-1"></div>
        <button type="button" onclick="showQuickAddLabor()" class="w-full text-left px-3 py-2.5 bg-amber-50 dark:bg-amber-900/30 hover:bg-amber-100 dark:hover:bg-amber-900/50 rounded-xl text-sm text-amber-700 dark:text-amber-300 font-bold transition-all flex items-center gap-2 shadow-sm">
          <span class="material-icons-round text-base">add_circle</span> Add New Labor
        </button>
        <div id="quick-add-labor-form" class="hidden space-y-2 border-t border-slate-200 dark:border-slate-700 pt-2 mt-1">
          <input type="text" id="quick-add-labor-desc" placeholder="Labor description" onfocus="scrollToCenter(this)" class="w-full px-3.5 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all">
          <input type="number" id="quick-add-labor-price" step="0.01" min="0.01" placeholder="Unit price" onfocus="scrollToCenter(this)" class="w-full px-3.5 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all">
          <button onclick="submitQuickAddLabor()" class="w-full bg-amber-600 hover:bg-amber-700 text-white font-bold py-3 rounded-xl text-sm tracking-wide transition-all shadow ripple-btn">Save & Add Labor</button>
        </div>
      `;
      dropdown.classList.add('hidden');
    }

    function selectLabor(id, desc, price) {
      document.getElementById('labor-desc-search').value = desc;
      document.getElementById('labor-desc-id').value = id || '';
      document.getElementById('job-item-labor-price').value = price || '';
      document.getElementById('labor-dropdown').classList.add('hidden');
    }

    function showQuickAddPart() {
      const form = document.getElementById('quick-add-part-form');
      if (form) form.classList.remove('hidden');
      scrollToCenter(form);
    }

    async function submitQuickAddPart() {
      const token = localStorage.getItem('garage_token');
      if (!token) return;
      const name = document.getElementById('quick-add-part-name').value.trim();
      const qty = parseInt(document.getElementById('quick-add-part-qty').value) || 1;
      const price = parseFloat(document.getElementById('quick-add-part-price').value) || 0;
      if (!name) { showToast('Part name is required', 'error', false); return; }
      if (price <= 0) { showToast('Unit price must be greater than 0', 'error', false); return; }
      try {
        const res = await fetch('/api/inventory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ item_name: name, quantity: qty, cost_price: price, selling_price: price })
        });
        if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Failed to create part'); }
        const data = await res.json();
        const item = data.item || data;
        // Fill dropdown and select
        allPartCatalog.push(item);
        selectPart(item.id, item.item_name, item.selling_price, item.quantity);
        document.getElementById('quick-add-part-form').classList.add('hidden');
        document.getElementById('quick-add-part-name').value = '';
        document.getElementById('quick-add-part-qty').value = '1';
        document.getElementById('quick-add-part-price').value = '';
        showToast('New part added: ' + name, 'check_circle', true);
        // Auto-trigger add to job
        await addJobItem('part');
      } catch (err) {
        console.error('Quick add part error:', err);
        showToast(err.message, 'error', false);
      }
    }

    function showQuickAddLabor() {
      const form = document.getElementById('quick-add-labor-form');
      if (form) form.classList.remove('hidden');
      scrollToCenter(form);
    }

    async function submitQuickAddLabor() {
      const token = localStorage.getItem('garage_token');
      if (!token) return;
      const desc = document.getElementById('quick-add-labor-desc').value.trim();
      const price = parseFloat(document.getElementById('quick-add-labor-price').value);
      if (!desc) { showToast('Labor description is required', 'error', false); return; }
      if (isNaN(price) || price <= 0) { showToast('Unit price must be a positive number', 'error', false); return; }
      try {
        const res = await fetch('/api/catalog', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ description: desc, price: price, type: 'labor' })
        });
        if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Failed to create labor'); }
        const data = await res.json();
        const item = data.item || data;
        allLaborCatalog.push(item);
        selectLabor(item.id, item.description || desc, item.price || price);
        document.getElementById('quick-add-labor-form').classList.add('hidden');
        document.getElementById('quick-add-labor-desc').value = '';
        document.getElementById('quick-add-labor-price').value = '';
        showToast('New labor added: ' + desc, 'check_circle', true);
        await addJobItem('labor');
      } catch (err) {
        console.error('Quick add labor error:', err);
        showToast(err.message, 'error', false);
      }
    }

    async function addJobItem(type) {
      const token = localStorage.getItem('garage_token');
      if (!token || !currentJobId) return;

      let description, quantity, unit_price, inventory_id = null;

      if (type === 'part') {
        const searchInput = document.getElementById('part-desc-search');
        description = searchInput ? searchInput.value.trim() : '';
        inventory_id = document.getElementById('part-desc-id').value ? parseInt(document.getElementById('part-desc-id').value) : null;
        quantity = parseInt(document.getElementById('job-item-part-qty').value);
        unit_price = parseFloat(document.getElementById('job-item-part-price').value);

        if (!description) {
          showToast('Please select or enter a part', 'error', false);
          return;
        }

        if (isNaN(quantity) || isNaN(unit_price)) {
          showToast('Quantity and price must be valid numbers', 'error', false);
          return;
        }
      } else {
        description = document.getElementById('labor-desc-search').value.trim();
        quantity = parseInt(document.getElementById('job-item-labor-qty').value);
        unit_price = parseFloat(document.getElementById('job-item-labor-price').value);

        if (!description) {
          showToast('Please enter a description for labor', 'error', false);
          return;
        }

        if (isNaN(quantity) || isNaN(unit_price)) {
          showToast('Quantity and price must be valid numbers', 'error', false);
          return;
        }

        if (quantity <= 0 || unit_price <= 0) {
          showToast('Labor price must be above 0 rupees and quantity positive', 'error', false);
          return;
        }
      }

      if (isNaN(quantity) || isNaN(unit_price) || quantity <= 0 || unit_price < 0) {
        showToast('Quantity and unit price must be valid positive numbers', 'error', false);
        return;
      }

      try {
        const res = await fetch(`/api/jobs/${currentJobId}/items`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ inventory_id: inventory_id || null, description, quantity, unit_price })
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to add job item');
        }

        // Upsert catalog entry (new price for new descriptions, same old price kept by backend)
        try {
          await fetch('/api/catalog', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ description, price: unit_price, type: type === 'part' ? 'part' : 'labor' })
          });
        } catch (catalogErr) {
          console.warn('Catalog update skipped:', catalogErr);
        }

        showToast(`${type === 'part' ? 'Part' : 'Labor'} added successfully!`, 'check_circle', true);

        // Reset form
        if (type === 'part') {
          document.getElementById('part-desc-search').value = '';
          document.getElementById('part-desc-id').value = '';
          document.getElementById('job-item-part-qty').value = 1;
          document.getElementById('job-item-part-price').value = '';
          document.getElementById('part-dropdown').classList.add('hidden');
        } else {
          document.getElementById('labor-desc-search').value = '';
          document.getElementById('labor-desc-id').value = '';
          document.getElementById('job-item-labor-qty').value = 1;
          document.getElementById('job-item-labor-price').value = '';
          document.getElementById('labor-dropdown').classList.add('hidden');
        }

        // Reload items and job detail (for updated total)
        await loadJobItems(currentJobId);
        await refreshJobDetailTotal();
        // Scroll to line items list after update
        const itemsList = document.getElementById('job-items-list');
        if (itemsList) scrollToCenter(itemsList);

      } catch (err) {
        console.error('Failed to add job item:', err);
        showToast('Failed to add item: ' + err.message, 'error', false);
      }
    }

    async function deleteJobItem(itemId) {
      if (!confirm('Delete this line item?')) return;

      const token = localStorage.getItem('garage_token');
      if (!token || !currentJobId) return;

      try {
        const res = await fetch(`/api/jobs/${currentJobId}/items/${itemId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to delete job item');
        }

        showToast('Line item removed', 'delete', true);
        await loadJobItems(currentJobId);
        await refreshJobDetailTotal();
        const itemsListDel = document.getElementById('job-items-list');
        if (itemsListDel) scrollToCenter(itemsListDel);

      } catch (err) {
        console.error('Failed to delete job item:', err);
        showToast('Failed to delete item: ' + err.message, 'error', false);
      }
    }

    async function refreshJobDetailTotal() {
      const token = localStorage.getItem('garage_token');
      if (!token || !currentJobId) return;

      try {
        const res = await fetch(`/api/jobs/${currentJobId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const job = await res.json();
          document.getElementById('job-detail-total').textContent = `₹${Number(job.total_cost || 0).toFixed(2)}`;
        }
      } catch (err) {
        console.warn('Failed to refresh job total:', err);
      }
    }

    // ===== INVOICE PDF FUNCTION =====

    async function downloadInvoice(jobId) {
      const token = localStorage.getItem('garage_token');
      if (!token) return;

      try {
        showToast('Generating invoice...', 'download', true);
        const res = await fetch(`/api/jobs/${jobId}/invoice`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to generate invoice');
        }

        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const now = new Date();
        const ts = `${String(now.getDate()).padStart(2,'0')}-${String(now.getMonth()+1).padStart(2,'0')}-${now.getFullYear()}--at--${String(now.getHours()).padStart(2,'0')}h${String(now.getMinutes()).padStart(2,'0')}m${String(now.getSeconds()).padStart(2,'0')}s`;
        a.download = `invoice-${jobId}--${ts}.pdf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        showToast('Invoice downloaded!', 'check_circle', true);
      } catch (err) {
        console.error('Invoice generation failed:', err);
        showToast('Failed to generate invoice: ' + err.message, 'error', false);
      }
    }

    // ===== JOB HISTORY TAB FUNCTIONS =====

    let jobHistorySearchTimeout = null;

    function debouncedJobHistorySearch() {
      clearTimeout(jobHistorySearchTimeout);
      jobHistorySearchTimeout = setTimeout(() => {
        loadJobHistory();
      }, 300);
    }

    async function loadJobHistory() {
      const token = localStorage.getItem('garage_token');
      if (!token) return;

      const listEl = document.getElementById('job-history-list');
      listEl.innerHTML = '<p class="text-sm text-slate-500 dark:text-slate-400 text-center py-8">Loading job history...</p>';

      try {
        const search = document.getElementById('job-history-search').value.trim();
        const status = document.getElementById('job-history-status').value;
        const from = document.getElementById('job-history-from').value;
        const to = document.getElementById('job-history-to').value;

        const params = new URLSearchParams();
        if (status) params.append('status', status);
        if (from) params.append('from', from);
        if (to) params.append('to', to);

        const res = await fetch(`/api/jobs?${params.toString()}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to load job history');
        }

        let jobs = await res.json();

        if (search) {
          const searchLower = search.toLowerCase();
          jobs = jobs.filter(job =>
            (job.customer_name && job.customer_name.toLowerCase().includes(searchLower)) ||
            (job.plate_number && job.plate_number.toLowerCase().includes(searchLower)) ||
            (job.notes && job.notes.toLowerCase().includes(searchLower)) ||
            (job.make && job.make.toLowerCase().includes(searchLower)) ||
            (job.model && job.model.toLowerCase().includes(searchLower))
          );
        }

        if (!jobs || jobs.length === 0) {
          listEl.innerHTML = '<p class="text-sm text-slate-500 dark:text-slate-400 text-center py-8">No jobs found matching your criteria</p>';
          return;
        }

        listEl.innerHTML = jobs.map(job => `
          <div class="w-full bg-slate-900 border-b border-slate-800 p-4 active:bg-slate-800 transition-colors cursor-pointer" onclick="showJobDetailModal(${job.id})">
            <div class="flex justify-between items-center mb-1">
              <span class="font-bold text-lg text-white">${job.make} ${job.model} ${job.year ? '(' + job.year + ')' : ''}</span>
              <span class="text-xs px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-300">${formatStatus(job.status)}</span>
            </div>
            <div class="text-sm text-slate-400 mb-2">${job.customer_name || 'Unknown Customer'} • ${job.plate_number}</div>
            <div class="flex justify-between items-center">
              <span class="text-slate-300 italic">${job.notes || ''}</span>
              <span class="font-bold text-blue-400">₹${Number(job.total_cost || 0).toFixed(2)}</span>
            </div>
          </div>
        `).join('');

      } catch (err) {
        console.error('Failed to load job history:', err);
        listEl.innerHTML = `<p class="text-sm text-rose-500 dark:text-rose-400 text-center py-8">Failed to load: ${err.message}</p>`;
        showToast('Failed to load job history', 'error', false);
      }
    }

    // ===== JOB HISTORY TAB (Admin/Employee) =====

    let historySearchTimeout = null;

    function debouncedHistorySearch() {
      clearTimeout(historySearchTimeout);
      historySearchTimeout = setTimeout(() => {
        loadJobHistoryTab();
      }, 300);
    }

    function clearHistoryFilters() {
      document.getElementById('history-search').value = '';
      document.getElementById('history-from').value = '';
      document.getElementById('history-to').value = '';
      loadJobHistoryTab();
    }

    async function loadJobHistoryTab() {
      const token = localStorage.getItem('garage_token');
      if (!token) return;

      const listEl = document.getElementById('history-jobs-list');
      listEl.innerHTML = '<p class="text-sm text-slate-500 dark:text-slate-400 text-center py-8">Loading job history...</p>';

      try {
        const search = document.getElementById('history-search').value.trim();
        const from = document.getElementById('history-from').value;
        const to = document.getElementById('history-to').value;

        const params = new URLSearchParams();
        params.append('status', 'completed');
        if (from) params.append('from', from);
        if (to) params.append('to', to);

        const res = await fetch(`/api/jobs?${params.toString()}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to load job history');
        }

        let jobs = await res.json();

        if (search) {
          const searchLower = search.toLowerCase();
          jobs = jobs.filter(job =>
            (job.customer_name && job.customer_name.toLowerCase().includes(searchLower)) ||
            (job.plate_number && job.plate_number.toLowerCase().includes(searchLower)) ||
            (job.notes && job.notes.toLowerCase().includes(searchLower)) ||
            (job.make && job.make.toLowerCase().includes(searchLower)) ||
            (job.model && job.model.toLowerCase().includes(searchLower))
          );
        }

        if (!jobs || jobs.length === 0) {
          listEl.innerHTML = '<p class="text-sm text-slate-500 dark:text-slate-400 text-center py-8">No completed jobs found matching your criteria</p>';
          return;
        }

        listEl.innerHTML = jobs.map(job => `
          <div class="w-full bg-slate-900 border-b border-slate-800 p-4 active:bg-slate-800 transition-colors cursor-pointer" onclick="showJobDetailModal(${job.id})">
            <div class="flex justify-between items-center mb-1">
              <span class="font-bold text-lg text-white">${job.make} ${job.model} ${job.year ? '(' + job.year + ')' : ''}</span>
              <span class="text-xs px-2 py-1 rounded bg-slate-800 border border-slate-700 text-emerald-400">Completed</span>
            </div>
            <div class="text-sm text-slate-400 mb-2">${job.customer_name || 'Unknown Customer'} • ${job.plate_number}</div>
            <div class="flex justify-between items-center">
              <span class="text-slate-300 italic">${job.notes || ''}</span>
              <span class="font-bold text-blue-400">₹${Number(job.total_cost || 0).toFixed(2)}</span>
            </div>
          </div>
        `).join('');

      } catch (err) {
        console.error('Failed to load job history:', err);
        listEl.innerHTML = `<p class="text-sm text-rose-500 dark:text-rose-400 text-center py-8">Failed to load: ${err.message}</p>`;
        showToast('Failed to load job history', 'error', false);
      }
    }

    // ===== INVOICES TAB (CUSTOMER ONLY) =====
    async function loadInvoices() {
      const token = localStorage.getItem('garage_token');
      if (!token) return;
      const listEl = document.getElementById('invoices-list');
      listEl.innerHTML = '<p class="text-sm text-slate-500 dark:text-slate-400 text-center py-8">Loading invoices...</p>';

      try {
        const res = await fetch('/api/jobs?status=completed', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to load invoices');
        }
        let jobs = await res.json();
        if (!jobs || jobs.length === 0) {
          listEl.innerHTML = '<p class="text-sm text-slate-500 dark:text-slate-400 text-center py-8">No completed jobs found</p>';
          return;
        }
        listEl.innerHTML = jobs.map(job => `
          <div class="w-full bg-slate-900 border-b border-slate-800 p-4 transition-colors">
            <div class="flex justify-between items-center mb-1">
              <span class="font-bold text-lg text-white">${job.make} ${job.model} ${job.year ? '(' + job.year + ')' : ''}</span>
              <span class="text-xs px-2 py-1 rounded bg-slate-800 border border-slate-700 text-emerald-400">Completed</span>
            </div>
            <div class="text-sm text-slate-400 mb-2">${job.plate_number}</div>
            <div class="flex justify-between items-center">
              <span class="text-slate-300">${new Date(job.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
              <span class="font-bold text-blue-400">₹${Number(job.total_cost || 0).toFixed(2)}</span>
            </div>
            <div class="mt-3 flex justify-end">
              <button onclick="downloadInvoice(${job.id})" class="flex items-center space-x-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-4 text-xs tracking-wide transition-all shadow ripple-btn">
                <span class="material-icons-round text-base">download</span>
                <span>Download Invoice</span>
              </button>
            </div>
          </div>
        `).join('');
      } catch (err) {
        console.error('Failed to load invoices:', err);
        listEl.innerHTML = `<p class="text-sm text-rose-500 dark:text-rose-400 text-center py-8">Failed to load: ${err.message}</p>`;
        showToast('Failed to load invoices', 'error', false);
      }
    }

    // ===== SETTINGS TAB FUNCTIONS =====
    
    async function loadSettingsTab() {
      const token = localStorage.getItem('garage_token');
      if (!token) return;

      try {
        // Fetch current settings
        const settingsRes = await fetch('/api/settings', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (settingsRes.ok) {
          const settings = await settingsRes.json();
          document.getElementById('settings-shop-name').value = settings.carwash_name || '';
          document.getElementById('settings-shop-icon').value = settings.logo_base64 || '';
          document.getElementById('settings-contact-info').value = settings.contact_info || '';
          document.getElementById('settings-upi-id').value = settings.upi_id || '';
          document.getElementById('settings-upi-name').value = settings.upi_name || '';
        }

        // Fetch holidays
        await loadHolidaysList(token);
      } catch (err) {
        console.error('Failed to load settings:', err);
        showToast('Failed to load settings', 'error', false);
      }
    }

    async function findInvoiceByNumber() {
      const input = document.getElementById('invoice-lookup-input');
      const value = input ? input.value.trim() : '';
      if (!value) {
        showToast('Please enter an invoice/job number', 'error', false);
        return;
      }
      const jobId = parseInt(value, 10);
      if (isNaN(jobId) || jobId <= 0) {
        showToast('Invalid invoice/job number', 'error', false);
        return;
      }
      const token = localStorage.getItem('garage_token');
      if (!token) return;
      try {
        const res = await fetch(`/api/jobs/${jobId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.status === 404) {
          showToast('Invoice / Job #' + jobId + ' not found', 'error', false);
          return;
        }
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to retrieve invoice');
        }
        const job = await res.json();
        showToast('Invoice #' + jobId + ' found', 'check_circle', true);
        showJobDetailModal(jobId);
      } catch (err) {
        console.error('Find invoice error:', err);
        showToast('Failed to find invoice: ' + err.message, 'error', false);
      }
    }

    async function downloadDBBackup() {
      const token = localStorage.getItem('garage_token');
      if (!token) return;
      try {
        const res = await fetch('/api/admin/db-backup', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to download DB backup');
        }
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'garage-backup.db';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        showToast('DB backup downloaded', 'check_circle', true);
      } catch (err) {
        console.error('DB download error:', err);
        showToast('DB download failed: ' + err.message, 'error', false);
      }
    }

    async function uploadDBRestore(input) {
      const file = input.files[0];
      if (!file) return;
      const token = localStorage.getItem('garage_token');
      if (!token) return;
      const statusEl = document.getElementById('db-restore-status');
      statusEl.textContent = 'Restoring DB...';
      statusEl.classList.remove('hidden');

      const formData = new FormData();
      formData.append('db_file', file);

      try {
        const res = await fetch('/api/admin/db-restore', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          body: formData
        });
        const result = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(result.error || 'Failed to restore DB');
        }
        statusEl.textContent = result.message || 'DB restored successfully. Restarting server...';
        showToast('DB restored successfully', 'check_circle', true);
      } catch (err) {
        console.error('DB restore error:', err);
        statusEl.textContent = 'DB restore failed: ' + err.message;
        showToast('DB restore failed: ' + err.message, 'error', false);
      }
    }

    async function loadHolidaysList(token) {
      const listEl = document.getElementById('settings-holiday-list');
      listEl.innerHTML = '<p class="text-sm text-slate-500 dark:text-slate-400 text-center py-4">Loading holidays...</p>';

      try {
        const res = await fetch('/api/public-info');
        if (!res.ok) throw new Error('Failed to fetch holidays');
        const data = await res.json();
        
        if (!data.holidays || data.holidays.length === 0) {
          listEl.innerHTML = '<p class="text-sm text-slate-500 dark:text-slate-400 text-center py-4">No holidays scheduled</p>';
          return;
        }

        listEl.innerHTML = data.holidays.map(h => `
          <div class="flex items-center justify-between bg-slate-50 dark:bg-slate-900/50 rounded-lg p-3">
            <div class="flex items-center space-x-3">
              <span class="material-icons-round text-amber-600 dark:text-amber-400">event</span>
              <div>
                <p class="text-sm font-medium text-white">${new Date(h.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</p>
                <p class="text-xs text-slate-500 dark:text-slate-400">${h.reason}</p>
              </div>
            </div>
            <button onclick="deleteHoliday(${h.id})" class="text-rose-500 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-300 p-1" aria-label="Delete holiday">
              <span class="material-icons-round text-lg">delete</span>
            </button>
          </div>
        `).join('');
      } catch (err) {
        console.error('Failed to load holidays:', err);
        listEl.innerHTML = '<p class="text-sm text-rose-500 dark:text-rose-400 text-center py-4">Failed to load holidays</p>';
      }
    }

    async function saveBrandingSettings() {
      const token = localStorage.getItem('garage_token');
      if (!token) return;

      const shopName = document.getElementById('settings-shop-name').value.trim();
      const shopIcon = document.getElementById('settings-shop-icon').value.trim();
      const contactInfo = document.getElementById('settings-contact-info').value.trim();
      const upiId = document.getElementById('settings-upi-id').value.trim();
      const upiName = document.getElementById('settings-upi-name').value.trim();
      const upiImageFile = document.getElementById('settings-upi-image')?.files?.[0];
      let upiImageBase64 = document.getElementById('settings-upi-image')?.dataset?.base64 || '';

      // If a new image was selected, read it as base64
      if (upiImageFile && upiImageFile.type.startsWith('image/')) {
        try {
          upiImageBase64 = await readFileAsBase64(upiImageFile);
        } catch (e) {
          console.warn('Failed to read image:', e);
          upiImageBase64 = '';
        }
      }

      try {
        const res = await fetch('/api/settings', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            carwash_name: shopName,
            logo_base64: shopIcon,
            contact_info: contactInfo,
            upi_id: upiId,
            upi_name: upiName,
            upi_image: upiImageBase64
          })
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to save settings');
        }

        showToast('Branding saved successfully!', 'check_circle', true);
        
        // Refresh header branding
        fetchPublicInfo();
      } catch (err) {
        showToast(err.message, 'error', false);
      }
    }

    async function addHoliday() {
      const token = localStorage.getItem('garage_token');
      if (!token) return;

      const date = document.getElementById('settings-holiday-date').value;
      const reason = document.getElementById('settings-holiday-reason').value.trim();

      if (!date || !reason) {
        showToast('Please fill in both date and reason', 'error', false);
        return;
      }

      try {
        const res = await fetch('/api/holidays', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ date, reason })
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to add holiday');
        }

        showToast('Holiday added!', 'event', true);
        document.getElementById('settings-holiday-date').value = '';
        document.getElementById('settings-holiday-reason').value = '';
        await loadHolidaysList(token);
        fetchPublicInfo(); // Refresh holiday banner
      } catch (err) {
        showToast(err.message, 'error', false);
      }
    }

    async function deleteHoliday(id) {
      const token = localStorage.getItem('garage_token');
      if (!token) return;

      if (!confirm('Delete this holiday?')) return;

      try {
        const res = await fetch(`/api/holidays/${id}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to delete holiday');
        }

        showToast('Holiday deleted', 'delete', true);
        await loadHolidaysList(token);
        fetchPublicInfo(); // Refresh holiday banner
      } catch (err) {
        showToast(err.message, 'error', false);
      }
    }

    // ===== ANALYTICS TAB FUNCTIONS =====

    async function fetchAnalytics() {
      const token = localStorage.getItem('garage_token');
      if (!token) return;

      const from = document.getElementById('analytics-from').value;
      const to = document.getElementById('analytics-to').value;

      try {
        const params = new URLSearchParams();
        if (from) params.append('from', from);
        if (to) params.append('to', to);

        const res = await fetch(`/api/analytics?${params.toString()}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) {
          if (res.status === 403) throw new Error('Admin access required');
          const err = await res.json();
          throw new Error(err.error || 'Failed to load analytics');
        }

        const data = await res.json();

        // Update metric cards
        document.getElementById('analytics-total-spend').textContent = `₹${Number(data.totalPurchases || 0).toFixed(2)}`;
        document.getElementById('analytics-total-earnings').textContent = `₹${Number(data.totalSales || 0).toFixed(2)}`;
        document.getElementById('analytics-net-profit').textContent = `₹${Number(data.netProfit || 0).toFixed(2)}`;

        // Update date range label
        const rangeEl = document.getElementById('analytics-date-range');
        if (from || to) {
          const fromStr = from ? new Date(from).toLocaleDateString() : 'beginning';
          const toStr = to ? new Date(to).toLocaleDateString() : 'now';
          rangeEl.textContent = `Showing data from ${fromStr} to ${toStr}`;
        } else {
          rangeEl.textContent = 'Showing data for all time';
        }
        rangeEl.classList.remove('hidden');

      } catch (err) {
        console.error('Failed to fetch analytics:', err);
        showToast('Failed to load analytics: ' + err.message, 'error', false);
      }
    }

    async function exportFinancialReport() {
      const token = localStorage.getItem('garage_token');
      if (!token) return;

      const from = document.getElementById('analytics-from').value;
      const to = document.getElementById('analytics-to').value;

      try {
        showToast('Generating report...', 'download', true);

        const params = new URLSearchParams();
        if (from) params.append('from', from);
        if (to) params.append('to', to);

        const res = await fetch(`/api/ledger/export?${params.toString()}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) {
          if (res.status === 403) throw new Error('Admin access required');
          const err = await res.json();
          throw new Error(err.error || 'Failed to export report');
        }

        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        
        // Extract filename from Content-Disposition header or generate one
        const cd = res.headers.get('Content-Disposition');
        let filename = 'financial-report.csv';
        if (cd) {
          const match = cd.match(/filename="(.+)"/);
          if (match) filename = match[1];
        }
        a.download = filename;
        
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        showToast('Report downloaded!', 'check_circle', true);
      } catch (err) {
        console.error('Export failed:', err);
        showToast('Failed to export: ' + err.message, 'error', false);
      }
    }

    // ===== CUSTOMERS & VEHICLES TAB FUNCTIONS =====

    // Modal state
    let editingCustomerId = null;
    let editingVehicleId = null;
    let currentCustomerForVehicle = null;

    async function loadCustomers(search = '') {
      const token = localStorage.getItem('garage_token');
      if (!token) return;

      const listEl = document.getElementById('customers-list');
      listEl.innerHTML = '<p class="text-sm text-slate-500 dark:text-slate-400 text-center py-8">Loading customers...</p>';

      try {
        const url = search ? `/api/customers?search=${encodeURIComponent(search)}` : '/api/customers';
        const res = await fetch(url, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to load customers');
        }

        const customers = await res.json();

        if (!customers || customers.length === 0) {
          listEl.innerHTML = '<p class="text-sm text-slate-500 dark:text-slate-400 text-center py-8">No customers found</p>';
          return;
        }

        listEl.innerHTML = customers.map(c => `
          <div class="bg-slate-900 p-4 space-y-3" data-customer-id="${c.id}">
            <div class="flex items-start justify-between">
              <div class="flex items-center space-x-3">
                <div class="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 font-bold flex items-center justify-center text-sm">
                  ${c.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p class="font-semibold text-white">${c.name}</p>
                  <p class="text-xs text-slate-500 dark:text-slate-400">${c.email || 'No email'} ${c.phone ? '• ' + c.phone : ''}</p>
                </div>
              </div>
              <div class="flex items-center space-x-1.5">
                <button onclick="showVehicleModal(${c.id}, '${c.name.replace(/'/g, "\\'")}')" class="text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 p-1.5 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20" aria-label="Add vehicle">
                  <span class="material-icons-round text-lg">directions_car</span>
                </button>
                <button onclick="editCustomer(${c.id}, '${c.name.replace(/'/g, "\\'")}', '${(c.email || '').replace(/'/g, "\\'")}', '${(c.phone || '').replace(/'/g, "\\'")}')" class="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Edit customer">
                  <span class="material-icons-round text-lg">edit</span>
                </button>
                <button onclick="deleteCustomer(${c.id}, '${c.name.replace(/'/g, "\\'")}')" class="text-rose-500 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-300 p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-900/20" aria-label="Delete customer">
                  <span class="material-icons-round text-lg">delete</span>
                </button>
              </div>
            </div>

            <!-- Vehicles for this customer -->
            <div id="vehicles-${c.id}" class="ml-10 border-l-2 border-slate-200 dark:border-slate-700 pl-4 space-y-2">
              ${c.vehicles && c.vehicles.length > 0 ? c.vehicles.map(v => `
                <div class="flex items-center justify-between py-2 bg-white dark:bg-slate-800 rounded-lg px-3">
                  <div class="flex items-center space-x-2.5">
                    <span class="material-icons-round text-slate-400 dark:text-slate-500">directions_car</span>
                    <div>
                      <p class="text-sm font-medium text-white">${v.make} ${v.model} ${v.year ? '(' + v.year + ')' : ''}</p>
                      <p class="text-xs text-slate-500 dark:text-slate-400 font-mono">${v.plate_number}</p>
                    </div>
                  </div>
                  <div class="flex items-center space-x-1.5">
                    <button onclick="editVehicle(${v.id}, ${c.id}, '${v.make.replace(/'/g, "\\'")}', '${v.model.replace(/'/g, "\\'")}', '${(v.year || '').replace(/'/g, "\\'")}', '${v.plate_number.replace(/'/g, "\\'")}')" class="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300 p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Edit vehicle">
                      <span class="material-icons-round text-base">edit</span>
                    </button>
                    <button onclick="deleteVehicle(${v.id}, '${v.plate_number.replace(/'/g, "\\'")}')" class="text-rose-500 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-300 p-1 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-900/20" aria-label="Delete vehicle">
                      <span class="material-icons-round text-base">delete</span>
                    </button>
                  </div>
                </div>
              `).join('') : '<p class="text-xs text-slate-400 dark:text-slate-500 italic py-2">No vehicles yet</p>'}
            </div>
          </div>
        `).join('');
      } catch (err) {
        console.error('Failed to load customers:', err);
        listEl.innerHTML = `<p class="text-sm text-rose-500 dark:text-rose-400 text-center py-8">Failed to load customers: ${err.message}</p>`;
      }
    }

    function showCustomerModal(customerId = null, name = '', email = '', phone = '') {
      editingCustomerId = customerId;
      document.getElementById('customer-modal-name').value = name;
      document.getElementById('customer-modal-email').value = email;
      document.getElementById('customer-modal-phone').value = phone;
      document.getElementById('customer-modal-title').textContent = customerId ? 'Edit Customer' : 'Add Customer';
      document.getElementById('customer-modal').classList.remove('hidden');
      document.getElementById('customer-modal-name').focus();
    }

    function hideCustomerModal() {
      document.getElementById('customer-modal').classList.add('hidden');
      editingCustomerId = null;
    }

    async function saveCustomer() {
      const token = localStorage.getItem('garage_token');
      if (!token) return;

      const name = document.getElementById('customer-modal-name').value.trim();
      const email = document.getElementById('customer-modal-email').value.trim();
      const phone = document.getElementById('customer-modal-phone').value.trim();

      if (!name) {
        showToast('Customer name is required', 'error', false);
        return;
      }

      try {
        const url = editingCustomerId ? `/api/customers/${editingCustomerId}` : '/api/customers';
        const method = editingCustomerId ? 'PUT' : 'POST';

        const res = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ name, email, phone })
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to save customer');
        }

        showToast(editingCustomerId ? 'Customer updated!' : 'Customer added!', 'check_circle', true);
        hideCustomerModal();
        loadCustomers(document.getElementById('customer-search').value);
      } catch (err) {
        showToast(err.message, 'error', false);
      }
    }

    function editCustomer(id, name, email, phone) {
      showCustomerModal(id, name, email, phone);
    }

    async function deleteCustomer(id, name) {
      if (!confirm(`Delete customer "${name}"? This will also remove their vehicles.`)) return;

      const token = localStorage.getItem('garage_token');
      if (!token) return;

      try {
        const res = await fetch(`/api/customers/${id}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to delete customer');
        }

        showToast('Customer deleted', 'delete', true);
        loadCustomers(document.getElementById('customer-search').value);
      } catch (err) {
        showToast(err.message, 'error', false);
      }
    }

    function showVehicleModal(customerId, customerName) {
      currentCustomerForVehicle = customerId;
      editingVehicleId = null;
      document.getElementById('vehicle-modal-customer').textContent = customerName;
      document.getElementById('vehicle-modal-make').value = '';
      document.getElementById('vehicle-modal-model').value = '';
      document.getElementById('vehicle-modal-year').value = '';
      document.getElementById('vehicle-modal-plate').value = '';
      document.getElementById('vehicle-modal-title').textContent = 'Add Vehicle';
      document.getElementById('vehicle-modal').classList.remove('hidden');
      document.getElementById('vehicle-modal-make').focus();
    }

    function hideVehicleModal() {
      document.getElementById('vehicle-modal').classList.add('hidden');
      editingVehicleId = null;
      currentCustomerForVehicle = null;
    }

    async function saveVehicle() {
      const token = localStorage.getItem('garage_token');
      if (!token || !currentCustomerForVehicle) return;

      const make = document.getElementById('vehicle-modal-make').value.trim();
      const model = document.getElementById('vehicle-modal-model').value.trim();
      const year = document.getElementById('vehicle-modal-year').value.trim();
      const plate_number = document.getElementById('vehicle-modal-plate').value.trim().toUpperCase();

      if (!make || !model || !plate_number) {
        showToast('Make, model, and plate number are required', 'error', false);
        return;
      }

      try {
        const url = editingVehicleId ? `/api/vehicles/${editingVehicleId}` : '/api/vehicles';
        const method = editingVehicleId ? 'PUT' : 'POST';

        const body = { make, model, year: year || null, plate_number };
        if (!editingVehicleId) body.owner_id = currentCustomerForVehicle;

        const res = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(body)
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to save vehicle');
        }

        showToast(editingVehicleId ? 'Vehicle updated!' : 'Vehicle added!', 'check_circle', true);
        hideVehicleModal();
        loadCustomers(document.getElementById('customer-search').value);
      } catch (err) {
        showToast(err.message, 'error', false);
      }
    }

    function editVehicle(id, customerId, make, model, year, plate) {
      currentCustomerForVehicle = customerId;
      editingVehicleId = id;
      document.getElementById('vehicle-modal-customer').textContent = document.querySelector(`[data-customer-id="${customerId}"] p.font-semibold`).textContent;
      document.getElementById('vehicle-modal-make').value = make;
      document.getElementById('vehicle-modal-model').value = model;
      document.getElementById('vehicle-modal-year').value = year;
      document.getElementById('vehicle-modal-plate').value = plate;
      document.getElementById('vehicle-modal-title').textContent = 'Edit Vehicle';
      document.getElementById('vehicle-modal').classList.remove('hidden');
      document.getElementById('vehicle-modal-make').focus();
    }

    async function deleteVehicle(id, plate) {
      if (!confirm(`Delete vehicle "${plate}"?`)) return;

      const token = localStorage.getItem('garage_token');
      if (!token) return;

      try {
        const res = await fetch(`/api/vehicles/${id}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to delete vehicle');
        }

        showToast('Vehicle deleted', 'delete', true);
        loadCustomers(document.getElementById('customer-search').value);
      } catch (err) {
        showToast(err.message, 'error', false);
      }
    }

    // ===== INVENTORY TAB FUNCTIONS =====

    let editingInventoryId = null;

    async function loadInventory(search = '') {
      const token = localStorage.getItem('garage_token');
      if (!token) return;

      const tbody = document.getElementById('inventory-table-body');
      const emptyEl = document.getElementById('inventory-empty');
      tbody.innerHTML = '<tr><td colspan="5" class="text-center text-slate-500 dark:text-slate-400 py-8">Loading inventory...</td></tr>';
      emptyEl.classList.add('hidden');

      try {
        const url = search ? `/api/inventory?search=${encodeURIComponent(search)}` : '/api/inventory';
        const res = await fetch(url, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to load inventory');
        }

        const items = await res.json();

        if (!items || items.length === 0) {
          tbody.innerHTML = '';
          emptyEl.classList.remove('hidden');
          return;
        }

        tbody.innerHTML = items.map(item => `
          <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <td class="py-3 pr-4 font-medium text-white">${item.item_name}</td>
            <td class="py-3 pr-4 text-center ${item.quantity <= 5 ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-slate-700 dark:text-slate-300'}">${item.quantity}</td>
            <td class="py-3 pr-4 text-right text-slate-700 dark:text-slate-300">₹${Number(item.cost_price).toFixed(2)}</td>
            <td class="py-3 pr-4 text-right font-medium text-white">₹${Number(item.selling_price).toFixed(2)}</td>
            <td class="py-3 text-right">
              <div class="flex items-center justify-end space-x-1.5">
                <button onclick="editInventory(${item.id}, '${item.item_name.replace(/'/g, "\\'")}', ${item.quantity}, ${item.cost_price}, ${item.selling_price})" class="text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 p-1.5 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20" aria-label="Edit item">
                  <span class="material-icons-round text-lg">edit</span>
                </button>
                <button onclick="deleteInventory(${item.id}, '${item.item_name.replace(/'/g, "\\'")}')" class="text-rose-500 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-300 p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-900/20" aria-label="Delete item">
                  <span class="material-icons-round text-lg">delete</span>
                </button>
              </div>
            </td>
          </tr>
        `).join('');
      } catch (err) {
        console.error('Failed to load inventory:', err);
        tbody.innerHTML = `<tr><td colspan="5" class="text-center text-rose-500 dark:text-rose-400 py-8">Failed to load inventory: ${err.message}</td></tr>`;
      }
    }

    function showInventoryModal(inventoryId = null, name = '', quantity = '', cost = '', price = '') {
      editingInventoryId = inventoryId;
      document.getElementById('inventory-modal-name').value = name;
      document.getElementById('inventory-modal-quantity').value = quantity;
      document.getElementById('inventory-modal-cost').value = cost;
      document.getElementById('inventory-modal-price').value = price;
      document.getElementById('inventory-modal-title').textContent = inventoryId ? 'Edit Inventory Item' : 'Add Inventory Item';
      document.getElementById('inventory-modal').classList.remove('hidden');
      document.getElementById('inventory-modal-name').focus();
    }

    function hideInventoryModal() {
      document.getElementById('inventory-modal').classList.add('hidden');
      editingInventoryId = null;
    }

    async function saveInventory() {
      const token = localStorage.getItem('garage_token');
      if (!token) return;

      const name = document.getElementById('inventory-modal-name').value.trim();
      const quantity = parseInt(document.getElementById('inventory-modal-quantity').value) || 0;
      const cost = parseFloat(document.getElementById('inventory-modal-cost').value) || 0;
      const price = parseFloat(document.getElementById('inventory-modal-price').value) || 0;

      if (!name) {
        showToast('Item name is required', 'error', false);
        return;
      }
      if (cost < 0 || price < 0) {
        showToast('Prices must be positive', 'error', false);
        return;
      }

      try {
        const url = editingInventoryId ? `/api/inventory/${editingInventoryId}` : '/api/inventory';
        const method = editingInventoryId ? 'PUT' : 'POST';

        const res = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ item_name: name, quantity, cost_price: cost, selling_price: price })
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to save inventory item');
        }

        showToast(editingInventoryId ? 'Inventory item updated!' : 'Inventory item added!', 'check_circle', true);
        hideInventoryModal();
        loadInventory(document.getElementById('inventory-search').value);
      } catch (err) {
        showToast(err.message, 'error', false);
      }
    }

    function editInventory(id, name, quantity, cost, price) {
      showInventoryModal(id, name, quantity, cost, price);
    }

    async function deleteInventory(id, name) {
      if (!confirm(`Delete inventory item "${name}"?`)) return;

      const token = localStorage.getItem('garage_token');
      if (!token) return;

      try {
        const res = await fetch(`/api/inventory/${id}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to delete inventory item');
        }

        showToast('Inventory item deleted', 'delete', true);
        loadInventory(document.getElementById('inventory-search').value);
      } catch (err) {
        showToast(err.message, 'error', false);
      }
    }

    function handleSignOut() {
      localStorage.removeItem('garage_token');
      localStorage.removeItem('garage_user');
      window.location.reload();
    }

    // Search customers on input
    document.addEventListener('DOMContentLoaded', () => {
      const customerSearch = document.getElementById('customer-search');
      if (customerSearch) {
        let debounceTimer;
        customerSearch.addEventListener('input', () => {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            loadCustomers(customerSearch.value);
          }, 300);
        });
      }

      const inventorySearch = document.getElementById('inventory-search');
      if (inventorySearch) {
        let debounceTimer;
        inventorySearch.addEventListener('input', () => {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            loadInventory(inventorySearch.value);
          }, 300);
        });
      }
    });

    // QR Scanner using Html5QrcodeScanner (end-to-end with file picker + camera)
    let html5Scanner = null;

    function initScanner() {
      const container = document.getElementById('qr-reader-container');
      if (!container) return;
      if (html5Scanner) {
        html5Scanner.clear();
        html5Scanner = null;
      }
      // Create scanner instance
      html5Scanner = new Html5QrcodeScanner('qr-reader-container', {
        fps: 10,
        qrbox: { width: 250, height: 250 },
        rememberLastUsedCamera: true
      });
      html5Scanner.render(
        (decodedText) => {
          const text = decodedText.trim();
          // Check if scanned text is an admin invoice lookup code (e.g., invoice:3)
          const invoiceMatch = text.match(/^invoice:(\d+)$/i);
          if (invoiceMatch) {
            const jobId = parseInt(invoiceMatch[1], 10);
            document.getElementById('qr-status').textContent = 'Invoice #' + jobId + ' found! Opening...';
            showToast('Opening invoice #' + jobId, 'check_circle', true);
            // Open job detail modal directly
            showJobDetailModal(jobId);
            // Stop scanner after finding
            if (html5Scanner) {
              html5Scanner.clear();
              html5Scanner = null;
            }
            return;
          }
          document.getElementById('qr-status').textContent = 'QR scanned! Saving...';
          saveQrData(text);
        },
        (error) => {
          document.getElementById('qr-status').textContent = 'Scan error: ' + (error || 'Unknown');
          console.warn('QR Scanner error:', error);
        }
      );
    }

    function startQrScan() {
      document.getElementById('qr-status').textContent = 'Starting scanner...';
      initScanner();
    }

    function handleQrSuccess(decodedText) {
      document.getElementById('qr-status').textContent = 'QR scanned successfully! Saving...';
      saveQrData(decodedText);
    }

    function saveQrData(qrData) {
      if (!qrData || typeof qrData !== 'string' || qrData.trim().length === 0) {
        document.getElementById('qr-status').textContent = 'Invalid or empty QR data. Not saved.';
        showToast('QR data is empty or invalid', 'error', false);
        return;
      }
      fetch('/api/save-qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qr_data: qrData })
      })
      .then(res => res.json())
      .then(data => {
        document.getElementById('qr-status').textContent = 'Saved! Item ID: ' + (data.id || 'N/A');
        showToast('QR saved successfully!', 'check_circle', true);
      })
      .catch(err => {
        console.error('Failed to save QR:', err);
        document.getElementById('qr-status').textContent = 'Failed to save';
        showToast('Failed to save QR', 'error', false);
      });
    }

    // Helper to read file as base64 (used by settings image upload)
    function readFileAsBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }
