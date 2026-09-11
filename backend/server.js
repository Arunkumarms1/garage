const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const { db, hashPassword, verifyPassword } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'garage-workshop-pwa-super-secret-key-2026';

const GOOGLE_CLIENT_ID = '603122845820-cmodpjdq3uhvpl179o92v7eeo9tll9lp.apps.googleusercontent.com';
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

app.use(cors());
app.use(express.json({ limit: '10mb' })); // Support Base64 logo uploads
app.use(express.static(path.join(__dirname, '../frontend')));

// ==========================================
// AUTHENTICATION & AUTHORIZATION ARCHITECTURE
// ==========================================

const AuthService = {
  // Sign standard local session/JWT
  signToken(user) {
    return jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
  },

  // Verify Google token
  async verifyGoogleToken(googleIdToken) {
    const ticket = await googleClient.verifyIdToken({
      idToken: googleIdToken,
      audience: GOOGLE_CLIENT_ID
    });
    return ticket.getPayload(); // { email, name, picture, sub (google_id) }
  }
};

// Middleware to protect routes and verify JWT
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Access token required. Please log in.' });
  }
  
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Token is invalid or expired. Please re-authenticate.' });
    }
    req.user = user;
    next();
  });
}

// Role hierarchy: admin > employee > customer
const ROLE_RANK = {
  admin: 3,
  employee: 2,
  customer: 1
};

// Middleware to restrict access by minimum role rank
function requireRole(minRole) {
  return (req, res, next) => {
    if (!req.user || !ROLE_RANK[req.user.role]) {
      return res.status(403).json({ error: 'Forbidden: Invalid role.' });
    }
    if (ROLE_RANK[req.user.role] < ROLE_RANK[minRole]) {
      return res.status(403).json({ error: `Forbidden: Requires ${minRole} role or higher.` });
    }
    next();
  };
}

// ==========================================
// ROUTES & API ENDPOINTS
// ==========================================

// ===== PUBLIC ROUTES =====

// GET /api/public-info (No auth - pre-login branding + holidays)
app.get('/api/public-info', (req, res) => {
  const today = new Date().toISOString().split('T')[0];

  // Get settings (shop_name, shop_icon)
  db.all("SELECT key, value FROM settings WHERE key IN ('carwash_name', 'logo_base64')", (err, settingsRows) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to retrieve settings.' });
    }

    const settings = {};
    settingsRows.forEach(row => {
      settings[row.key] = row.value;
    });

    // Get upcoming holidays (date >= today)
    db.all("SELECT id, date, reason FROM holidays WHERE date >= ? ORDER BY date ASC", [today], (err, holidayRows) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to retrieve holidays.' });
      }

      res.json({
        shop_name: settings.carwash_name || 'Garage Workshop PWA',
        shop_icon: settings.logo_base64 || '',
        holidays: holidayRows
      });
    });
  });
});

// ===== END PUBLIC ROUTES =====

// --- Auth Endpoints ---

// User Registration
app.post('/api/auth/register', (req, res) => {
  const { name, email, password } = req.body;
  
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required.' });
  }

  // Pre-check if a user with this email already exists
  db.get("SELECT id FROM users WHERE email = ?", [email], (err, existingUser) => {
    if (err) {
      return res.status(500).json({ error: 'Database error occurred during registration check.' });
    }
    if (existingUser) {
      return res.status(400).json({ error: 'An account with this email already exists.' });
    }

    const assignedRole = 'customer'; // Force all public registrations to 'customer'
    const password_hash = hashPassword(password);

    db.run(
      "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)",
      [name, email, password_hash, assignedRole],
      function(insertErr) {
        if (insertErr) {
          if (insertErr.message.includes('UNIQUE constraint failed: users.email')) {
            return res.status(400).json({ error: 'An account with this email already exists.' });
          }
          return res.status(500).json({ error: 'Database error occurred during registration.' });
        }

        const user = { id: this.lastID, name, email, role: assignedRole, picture: null };
        const token = AuthService.signToken(user);

        res.status(201).json({
          message: 'Registration successful',
          token,
          user
        });
      }
    );
  });
});

// User Login
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  db.get("SELECT * FROM users WHERE email = ?", [email], (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Database error during login.' });
    }
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = AuthService.signToken(user);
    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        picture: user.picture
      }
    });
  });
});

// Google Sign-In Swappable API Entrypoint
app.post('/api/auth/google', async (req, res) => {
  const { idToken } = req.body;
  if (!idToken) {
    return res.status(400).json({ error: 'Google ID Token is required.' });
  }

  try {
    const googleUser = await AuthService.verifyGoogleToken(idToken);
    const { email, name, picture } = googleUser;

    if (!email) {
      return res.status(400).json({ error: 'Email address not received from Google.' });
    }

    db.get("SELECT * FROM users WHERE email = ?", [email], (err, user) => {
      if (err) {
        return res.status(500).json({ error: 'Database error during Google Sign-In.' });
      }

      if (user) {
        // User exists, check if we need to update the picture
        if (picture && user.picture !== picture) {
          db.run("UPDATE users SET picture = ? WHERE id = ?", [picture, user.id]);
          user.picture = picture;
        }
        
        // Sign and return JWT token
        const token = AuthService.signToken(user);
        return res.json({
          message: 'Google Login successful',
          token,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            picture: user.picture
          }
        });
      } else {
        // User does not exist, create a new customer account
        const randomPassword = crypto.randomBytes(32).toString('hex');
        const password_hash = hashPassword(randomPassword);
        const role = 'customer';

        db.run(
          "INSERT INTO users (name, email, password_hash, picture, role) VALUES (?, ?, ?, ?, ?)",
          [name || 'Google User', email, password_hash, picture || null, role],
          function(insertErr) {
            if (insertErr) {
              return res.status(500).json({ error: 'Failed to create user during Google Sign-In.' });
            }

            const newUser = {
              id: this.lastID,
              name: name || 'Google User',
              email,
              role,
              picture: picture || null
            };
            const token = AuthService.signToken(newUser);

            return res.status(201).json({
              message: 'Google Registration successful',
              token,
              user: newUser
            });
          }
        );
      }
    });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});


// --- Services Endpoints ---

// GET /api/services (Public - list all available services)
app.get('/api/services', (req, res) => {
  db.all("SELECT * FROM services ORDER BY price ASC", (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to retrieve services.' });
    }
    res.json(rows);
  });
});

// POST /api/services (Owner adds a new service)
app.post('/api/services', authenticateToken, requireRole('admin'), (req, res) => {
  const { name, price } = req.body;
  if (!name || price === undefined) {
    return res.status(400).json({ error: 'Service name and price are required.' });
  }

  db.run("INSERT INTO services (name, price) VALUES (?, ?)", [name, parseFloat(price)], function(err) {
    if (err) return res.status(500).json({ error: 'Failed to add service.' });
    res.status(201).json({ message: 'Service added.', service: { id: this.lastID, name, price } });
  });
});

// DELETE /api/services/:id (Owner deletes a service)
app.delete('/api/services/:id', authenticateToken, requireRole('admin'), (req, res) => {
  const { id } = req.params;
  db.run("DELETE FROM services WHERE id = ?", [id], function(err) {
    if (err) return res.status(500).json({ error: 'Failed to delete service.' });
    res.json({ message: 'Service deleted.' });
  });
});

// --- Bookings Endpoints ---

// GET /api/bookings (Owner reads all, Customer reads their own)
app.get('/api/bookings', authenticateToken, (req, res) => {
  let query = "SELECT * FROM bookings ORDER BY booking_time DESC";
  let params = [];

  if (req.user.role === 'customer') {
    // Secure isolation: Customers only fetch their own bookings matching their email
    query = "SELECT * FROM bookings WHERE customer_email = ? ORDER BY booking_time DESC";
    params = [req.user.email];
  }

  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to retrieve bookings.' });
    }
    res.json(rows);
  });
});

// POST /api/bookings (Schedules a booking)
app.post('/api/bookings', authenticateToken, (req, res) => {
  const { license_plate, vehicle_type, service, pricing, booking_time } = req.body;
  const customer_name = req.user.name; // Sourced securely from token
  const customer_email = req.user.email; // Sourced securely from token

  if (!vehicle_type || !service || !pricing || !booking_time) {
    return res.status(400).json({ error: 'Missing booking details (vehicle type, service, pricing, time).' });
  }

  db.run(
    "INSERT INTO bookings (customer_name, customer_email, license_plate, vehicle_type, service, pricing, booking_time, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [customer_name, customer_email, license_plate || '', vehicle_type, service, pricing, booking_time, 'pending'],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to save booking.' });
      }
      res.status(201).json({
        message: 'Booking request submitted successfully.',
        booking: {
          id: this.lastID,
          customer_name,
          customer_email,
          license_plate: license_plate || '',
          vehicle_type,
          service,
          pricing,
          booking_time,
          status: 'pending'
        }
      });
    }
  );
});

// PUT /api/bookings/:id (Owner updates status)
app.put('/api/bookings/:id', authenticateToken, requireRole('admin'), (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!status || !['pending', 'booked', 'service finished', 'cancelled'].includes(status)) {
    return res.status(400).json({ error: 'Invalid booking status.' });
  }

  // Fetch the booking details first to create a ledger transaction if finished
  db.get("SELECT * FROM bookings WHERE id = ?", [id], (err, booking) => {
    if (err || !booking) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    db.serialize(() => {
      // 1. Update Booking Status
      db.run("UPDATE bookings SET status = ? WHERE id = ?", [status, id], function(updateErr) {
        if (updateErr) {
          return res.status(500).json({ error: 'Failed to update booking status.' });
        }

        // 2. If finished, log a "sale" transaction in the Ledger automatically (if not already logged)
        if (status === 'service finished' && booking.status !== 'service finished') {
          const today = new Date().toISOString().split('T')[0];
          const desc = `Booking Finished: ${booking.service} (Lic: ${booking.license_plate})`;
          
          db.run(
            "INSERT INTO ledger (type, description, amount, date) VALUES (?, ?, ?, ?)",
            ['sale', desc, booking.pricing, today],
            function(ledgerErr) {
              if (ledgerErr) {
                console.error("Error logging sale transaction for finished booking:", ledgerErr);
              }
            }
          );
        }

        res.json({
          message: `Booking has been updated to ${status}.`,
          bookingId: id,
          status
        });
      });
    });
  });
});


// --- Settings Endpoints ---

// GET /api/settings (Public - read status/name/logo)
app.get('/api/settings', (req, res) => {
  db.all("SELECT * FROM settings", (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to retrieve settings.' });
    }
    
    // Transform key-value rows to clean JSON object
    const settingsObj = {};
    rows.forEach(row => {
      settingsObj[row.key] = row.value;
    });
    
    res.json(settingsObj);
  });
});

// PUT /api/settings (Owner only)
app.put('/api/settings', authenticateToken, requireRole('admin'), (req, res) => {
  const settingsUpdate = req.body; // Expecting { carwash_name, is_open, logo_base64, theme_color }

  db.serialize(() => {
    const stmt = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    
    let errorOccurred = false;
    for (const [key, value] of Object.entries(settingsUpdate)) {
      if (['carwash_name', 'is_open', 'logo_base64', 'theme_color'].includes(key)) {
        stmt.run(key, String(value), (err) => {
          if (err) errorOccurred = true;
        });
      }
    }
    
    stmt.finalize((err) => {
      if (err || errorOccurred) {
        return res.status(500).json({ error: 'Failed to save settings.' });
      }
      res.json({ message: 'Settings updated successfully.', updated: settingsUpdate });
    });
  });
});


// ===== ADMIN SETTINGS & HOLIDAYS ROUTES =====

// POST /api/holidays (Admin only - add holiday)
app.post('/api/holidays', authenticateToken, requireRole('admin'), (req, res) => {
  const { date, reason } = req.body;
  if (!date || !reason) {
    return res.status(400).json({ error: 'Date and reason are required.' });
  }
  db.run("INSERT INTO holidays (date, reason) VALUES (?, ?)", [date, reason], function(err) {
    if (err) return res.status(500).json({ error: 'Failed to add holiday.' });
    res.status(201).json({ message: 'Holiday added.', holiday: { id: this.lastID, date, reason } });
  });
});

// DELETE /api/holidays/:id (Admin only - delete holiday)
app.delete('/api/holidays/:id', authenticateToken, requireRole('admin'), (req, res) => {
  const { id } = req.params;
  db.run("DELETE FROM holidays WHERE id = ?", [id], function(err) {
    if (err) return res.status(500).json({ error: 'Failed to delete holiday.' });
    if (this.changes === 0) return res.status(404).json({ error: 'Holiday not found.' });
    res.json({ message: 'Holiday deleted.' });
  });
});

// ===== END ADMIN SETTINGS & HOLIDAYS ROUTES =====


// --- Ledger / Profit Analytics Endpoints ---

// GET /api/ledger (Owner reads analytics and ledger)
app.get('/api/ledger', authenticateToken, requireRole('admin'), (req, res) => {
  db.all("SELECT * FROM ledger ORDER BY date DESC, id DESC", (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to retrieve ledger.' });
    }

    // Perform profit & loss analytics calculation on-the-fly
    let totalSales = 0;
    let totalPurchases = 0;

    rows.forEach(item => {
      if (item.type === 'sale') {
        totalSales += item.amount;
      } else if (item.type === 'purchase') {
        totalPurchases += item.amount;
      }
    });

    res.json({
      transactions: rows,
      analytics: {
        totalSales,
        totalPurchases,
        netProfit: totalSales - totalPurchases
      }
    });
  });
});

// POST /api/ledger (Owner adds a sale or purchase manually)
app.post('/api/ledger', authenticateToken, requireRole('admin'), (req, res) => {
  const { type, description, amount, date } = req.body;

  if (!type || !description || amount === undefined || !date) {
    return res.status(400).json({ error: 'Type, description, amount, and date are required.' });
  }

  if (!['sale', 'purchase'].includes(type)) {
    return res.status(400).json({ error: 'Type must be either "sale" or "purchase".' });
  }

  db.run(
    "INSERT INTO ledger (type, description, amount, date) VALUES (?, ?, ?, ?)",
    [type, description, parseFloat(amount), date],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to insert ledger entry.' });
      }
      res.status(201).json({
        message: 'Ledger entry added successfully.',
        entry: {
          id: this.lastID,
          type,
          description,
          amount,
          date
        }
      });
    }
  );
});

// --- Users Endpoints ---

// GET /api/admin/users (Owner gets all users and their wash counts)
app.get('/api/admin/users', authenticateToken, requireRole('admin'), (req, res) => {
  const query = `
    SELECT 
      u.id, u.name, u.email, u.role, u.picture,
      COUNT(b.id) as total_services
    FROM users u
    LEFT JOIN bookings b ON u.name = b.customer_name AND b.status = 'service finished'
    GROUP BY u.id
    ORDER BY total_services DESC
  `;
  
  db.all(query, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to retrieve users.' });
    }
    res.json(rows);
  });
});

// PUT /api/users/me/picture (Customer/Owner updates their own picture)
app.put('/api/users/me/picture', authenticateToken, (req, res) => {
  const { picture } = req.body;
  if (!picture || !/^data:image\/(png|jpeg|webp|gif);base64,/.test(picture)) {
    return res.status(400).json({ error: 'Valid Base64 image (PNG, JPEG, WEBP, or GIF) required.' });
  }

  // Approx size check for Base64 (50kb = ~68000 chars)
  if (picture.length > 70000) {
    return res.status(400).json({ error: 'Image size exceeds 50KB limit.' });
  }

  db.run("UPDATE users SET picture = ? WHERE id = ?", [picture, req.user.id], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Failed to update profile picture.' });
    }
    res.json({ message: 'Profile picture updated successfully.', picture });
  });
});

// ===== CRM ROUTES =====

// POST /api/customers (Admin/Employee - create CRM customer record)
app.post('/api/customers', authenticateToken, requireRole('employee'), (req, res) => {
  const { name, email, phone } = req.body;
  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required.' });
  }

  db.get("SELECT id FROM users WHERE email = ?", [email], (err, existingUser) => {
    if (err) {
      return res.status(500).json({ error: 'Database error during customer creation check.' });
    }
    if (existingUser) {
      return res.status(400).json({ error: 'A user with this email already exists.' });
    }

    // Create customer with no usable password (CRM record only)
    const randomPassword = crypto.randomBytes(32).toString('hex');
    const password_hash = hashPassword(randomPassword);
    const role = 'customer';

    db.run(
      "INSERT INTO users (name, email, password_hash, phone, role) VALUES (?, ?, ?, ?, ?)",
      [name, email, password_hash, phone || null, role],
      function(insertErr) {
        if (insertErr) {
          return res.status(500).json({ error: 'Failed to create customer.' });
        }
        res.status(201).json({
          message: 'Customer created successfully.',
          customer: { id: this.lastID, name, email, phone, role }
        });
      }
    );
  });
});

// GET /api/customers (Admin/Employee - search customers by name)
app.get('/api/customers', authenticateToken, requireRole('employee'), (req, res) => {
  const { search } = req.query;
  let query = "SELECT id, name, email, phone, role FROM users WHERE role = 'customer'";
  let params = [];

  if (search) {
    query += " AND name LIKE ?";
    params.push(`%${search}%`);
  }
  query += " ORDER BY name ASC";

  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to retrieve customers.' });
    }
    res.json(rows);
  });
});

// GET /api/customers/:id (Admin/Employee - get customer details + vehicles)
app.get('/api/customers/:id', authenticateToken, requireRole('employee'), (req, res) => {
  const { id } = req.params;

  db.get("SELECT id, name, email, phone, role FROM users WHERE id = ? AND role = 'customer'", [id], (err, customer) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to retrieve customer.' });
    }
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found.' });
    }

    db.all("SELECT * FROM vehicles WHERE owner_id = ?", [id], (err, vehicles) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to retrieve vehicles.' });
      }
      res.json({ ...customer, vehicles });
    });
  });
});

// POST /api/vehicles (Admin/Employee - create vehicle)
app.post('/api/vehicles', authenticateToken, requireRole('employee'), (req, res) => {
  const { owner_id, make, model, plate_number, year } = req.body;
  if (!owner_id || !make || !model || !plate_number) {
    return res.status(400).json({ error: 'Owner ID, make, model, and plate number are required.' });
  }

  // Verify owner exists and is a customer
  db.get("SELECT id FROM users WHERE id = ? AND role = 'customer'", [owner_id], (err, owner) => {
    if (err) {
      return res.status(500).json({ error: 'Database error verifying owner.' });
    }
    if (!owner) {
      return res.status(400).json({ error: 'Invalid customer ID.' });
    }

    db.run(
      "INSERT INTO vehicles (owner_id, make, model, plate_number, year) VALUES (?, ?, ?, ?, ?)",
      [owner_id, make, model, plate_number.toUpperCase(), year || null],
      function(insertErr) {
        if (insertErr) {
          if (insertErr.message.includes('UNIQUE constraint failed: vehicles.plate_number')) {
            return res.status(400).json({ error: 'A vehicle with this plate number already exists.' });
          }
          return res.status(500).json({ error: 'Failed to create vehicle.' });
        }
        res.status(201).json({
          message: 'Vehicle created successfully.',
          vehicle: { id: this.lastID, owner_id, make, model, plate_number: plate_number.toUpperCase(), year }
        });
      }
    );
  });
});

// GET /api/vehicles (Admin/Employee - list vehicles, searchable by plate_number)
app.get('/api/vehicles', authenticateToken, requireRole('employee'), (req, res) => {
  const { plate_number } = req.query;
  let query = "SELECT v.*, u.name as owner_name FROM vehicles v JOIN users u ON v.owner_id = u.id";
  let params = [];

  if (plate_number) {
    query += " WHERE v.plate_number LIKE ?";
    params.push(`%${plate_number.toUpperCase()}%`);
  }
  query += " ORDER BY v.make, v.model";

  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to retrieve vehicles.' });
    }
    res.json(rows);
  });
});

// GET /api/vehicles/:id (Admin/Employee - get single vehicle)
app.get('/api/vehicles/:id', authenticateToken, requireRole('employee'), (req, res) => {
  const { id } = req.params;
  db.get(
    "SELECT v.*, u.name as owner_name FROM vehicles v JOIN users u ON v.owner_id = u.id WHERE v.id = ?",
    [id],
    (err, vehicle) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to retrieve vehicle.' });
      }
      if (!vehicle) {
        return res.status(404).json({ error: 'Vehicle not found.' });
      }
      res.json(vehicle);
    }
  );
});

// PUT /api/vehicles/:id (Admin/Employee - update vehicle)
app.put('/api/vehicles/:id', authenticateToken, requireRole('employee'), (req, res) => {
  const { id } = req.params;
  const { owner_id, make, model, plate_number, year } = req.body;

  if (!make || !model || !plate_number) {
    return res.status(400).json({ error: 'Make, model, and plate number are required.' });
  }

  // Verify owner exists if provided
  if (owner_id) {
    db.get("SELECT id FROM users WHERE id = ? AND role = 'customer'", [owner_id], (err, owner) => {
      if (err) {
        return res.status(500).json({ error: 'Database error verifying owner.' });
      }
      if (!owner) {
        return res.status(400).json({ error: 'Invalid customer ID.' });
      }
      updateVehicle();
    });
  } else {
    updateVehicle();
  }

  function updateVehicle() {
    db.run(
      "UPDATE vehicles SET owner_id = ?, make = ?, model = ?, plate_number = ?, year = ? WHERE id = ?",
      [owner_id, make, model, plate_number.toUpperCase(), year || null, id],
      function(updateErr) {
        if (updateErr) {
          if (updateErr.message.includes('UNIQUE constraint failed: vehicles.plate_number')) {
            return res.status(400).json({ error: 'A vehicle with this plate number already exists.' });
          }
          return res.status(500).json({ error: 'Failed to update vehicle.' });
        }
        if (this.changes === 0) {
          return res.status(404).json({ error: 'Vehicle not found.' });
        }
        res.json({ message: 'Vehicle updated successfully.', vehicle: { id, owner_id, make, model, plate_number: plate_number.toUpperCase(), year } });
      }
    );
  }
});

// DELETE /api/vehicles/:id (Admin/Employee - delete vehicle)
app.delete('/api/vehicles/:id', authenticateToken, requireRole('employee'), (req, res) => {
  const { id } = req.params;
  db.run("DELETE FROM vehicles WHERE id = ?", [id], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Failed to delete vehicle.' });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: 'Vehicle not found.' });
    }
    res.json({ message: 'Vehicle deleted successfully.' });
  });
});

// ===== END CRM ROUTES =====

// ===== INVENTORY ROUTES =====

// GET /api/inventory (Admin/Employee - list all inventory items)
app.get('/api/inventory', authenticateToken, requireRole('employee'), (req, res) => {
  db.all("SELECT * FROM inventory ORDER BY item_name ASC", (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to retrieve inventory.' });
    }
    res.json(rows);
  });
});

// GET /api/inventory/:id (Admin/Employee - get single inventory item)
app.get('/api/inventory/:id', authenticateToken, requireRole('employee'), (req, res) => {
  const { id } = req.params;
  db.get("SELECT * FROM inventory WHERE id = ?", [id], (err, item) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to retrieve inventory item.' });
    }
    if (!item) {
      return res.status(404).json({ error: 'Inventory item not found.' });
    }
    res.json(item);
  });
});

// POST /api/inventory (Admin/Employee - create new inventory item)
app.post('/api/inventory', authenticateToken, requireRole('employee'), (req, res) => {
  const { item_name, quantity, cost_price, selling_price } = req.body;
  if (!item_name || quantity === undefined || cost_price === undefined || selling_price === undefined) {
    return res.status(400).json({ error: 'Item name, quantity, cost price, and selling price are required.' });
  }

  const qty = parseInt(quantity);
  const cost = parseFloat(cost_price);
  const sell = parseFloat(selling_price);

  if (qty < 0 || cost < 0 || sell < 0) {
    return res.status(400).json({ error: 'Quantity and prices must be non-negative.' });
  }

  db.run(
    "INSERT INTO inventory (item_name, quantity, cost_price, selling_price) VALUES (?, ?, ?, ?)",
    [item_name, qty, cost, sell],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to create inventory item.' });
      }

      // If initial quantity > 0, log a purchase in ledger
      if (qty > 0) {
        const today = new Date().toISOString().split('T')[0];
        const amount = qty * cost;
        const desc = `Initial stock: ${item_name} (${qty} units @ $${cost.toFixed(2)})`;
        
        db.run(
          "INSERT INTO ledger (type, description, amount, date) VALUES (?, ?, ?, ?)",
          ['purchase', desc, amount, today],
          (ledgerErr) => {
            if (ledgerErr) {
              console.error("Error logging initial stock purchase:", ledgerErr);
            }
          }
        );
      }

      res.status(201).json({
        message: 'Inventory item created successfully.',
        item: { id: this.lastID, item_name, quantity: qty, cost_price: cost, selling_price: sell }
      });
    }
  );
});

// PUT /api/inventory/:id (Admin/Employee - update inventory item, log purchase on restock)
app.put('/api/inventory/:id', authenticateToken, requireRole('employee'), (req, res) => {
  const { id } = req.params;
  const { item_name, quantity, cost_price, selling_price } = req.body;

  if (!item_name || quantity === undefined || cost_price === undefined || selling_price === undefined) {
    return res.status(400).json({ error: 'Item name, quantity, cost price, and selling price are required.' });
  }

  const newQty = parseInt(quantity);
  const cost = parseFloat(cost_price);
  const sell = parseFloat(selling_price);

  if (newQty < 0 || cost < 0 || sell < 0) {
    return res.status(400).json({ error: 'Quantity and prices must be non-negative.' });
  }

  // Get current quantity to detect restock
  db.get("SELECT quantity, item_name FROM inventory WHERE id = ?", [id], (err, currentItem) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to retrieve current inventory.' });
    }
    if (!currentItem) {
      return res.status(404).json({ error: 'Inventory item not found.' });
    }

    const oldQty = currentItem.quantity;
    const itemName = currentItem.item_name;
    const qtyIncrease = newQty - oldQty;

    db.run(
      "UPDATE inventory SET item_name = ?, quantity = ?, cost_price = ?, selling_price = ? WHERE id = ?",
      [item_name, newQty, cost, sell, id],
      function(updateErr) {
        if (updateErr) {
          return res.status(500).json({ error: 'Failed to update inventory item.' });
        }
        if (this.changes === 0) {
          return res.status(404).json({ error: 'Inventory item not found.' });
        }

        // If quantity increased (restock), log a purchase in ledger
        if (qtyIncrease > 0) {
          const today = new Date().toISOString().split('T')[0];
          const amount = qtyIncrease * cost;
          const desc = `Restock: ${itemName} (+${qtyIncrease} units @ $${cost.toFixed(2)})`;
          
          db.run(
            "INSERT INTO ledger (type, description, amount, date) VALUES (?, ?, ?, ?)",
            ['purchase', desc, amount, today],
            (ledgerErr) => {
              if (ledgerErr) {
                console.error("Error logging restock purchase:", ledgerErr);
              }
            }
          );
        }

        res.json({
          message: 'Inventory item updated successfully.',
          item: { id: parseInt(id), item_name, quantity: newQty, cost_price: cost, selling_price: sell }
        });
      }
    );
  });
});

// DELETE /api/inventory/:id (Admin/Employee - delete inventory item)
app.delete('/api/inventory/:id', authenticateToken, requireRole('employee'), (req, res) => {
  const { id } = req.params;
  db.run("DELETE FROM inventory WHERE id = ?", [id], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Failed to delete inventory item.' });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: 'Inventory item not found.' });
    }
    res.json({ message: 'Inventory item deleted successfully.' });
  });
});

// ===== END INVENTORY ROUTES =====

// Fallback to route index.html for SPA client-side routing support
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.listen(PORT, () => {
  console.log(`Garage Workshop PWA Server is running on port ${PORT}`);
});
