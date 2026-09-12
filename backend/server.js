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
        const desc = `Initial stock: ${item_name} (${qty} units @ ₹${cost.toFixed(2)})`;
        
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
          const desc = `Restock: ${itemName} (+${qtyIncrease} units @ ₹${cost.toFixed(2)})`;
          
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

// ===== JOBS ROUTES =====

// GET /api/jobs/active (Employee/Admin - list active jobs: pending, in-progress)
app.get('/api/jobs/active', authenticateToken, requireRole('employee'), (req, res) => {
  db.all(
    "SELECT j.*, v.make, v.model, v.plate_number, v.year, u.name as customer_name, u.email as customer_email FROM jobs j JOIN vehicles v ON j.vehicle_id = v.id JOIN users u ON v.owner_id = u.id WHERE j.status IN ('pending', 'in-progress') ORDER BY j.created_at DESC",
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to retrieve active jobs.' });
      }
      res.json(rows);
    }
  );
});

// GET /api/jobs (Employee/Admin - all jobs with filters; Customer - own vehicles only)
app.get('/api/jobs', authenticateToken, (req, res) => {
  const { status, from, to } = req.query;
  let query = `
    SELECT j.*, v.make, v.model, v.plate_number, v.year, u.name as customer_name, u.email as customer_email
    FROM jobs j
    JOIN vehicles v ON j.vehicle_id = v.id
    JOIN users u ON v.owner_id = u.id
  `;
  let params = [];
  const conditions = [];

  // Customer role: scope to their own vehicles
  if (req.user.role === 'customer') {
    conditions.push("u.id = ?");
    params.push(req.user.id);
  }

  // Status filter
  if (status) {
    conditions.push("j.status = ?");
    params.push(status);
  }

  // Date range filter (using created_at)
  if (from) {
    conditions.push("date(j.created_at) >= date(?)");
    params.push(from);
  }
  if (to) {
    conditions.push("date(j.created_at) <= date(?)");
    params.push(to);
  }

  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }

  query += " ORDER BY j.created_at DESC";

  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to retrieve jobs.' });
    }
    res.json(rows);
  });
});

// GET /api/jobs/:id (Employee/Admin - get single job with details; Customer - own vehicle only)
app.get('/api/jobs/:id', authenticateToken, (req, res) => {
  const { id } = req.params;

  let query = `
    SELECT j.*, v.make, v.model, v.plate_number, v.year, u.name as customer_name, u.email as customer_email, u.id as customer_id
    FROM jobs j
    JOIN vehicles v ON j.vehicle_id = v.id
    JOIN users u ON v.owner_id = u.id
    WHERE j.id = ?
  `;
  let params = [id];

  // Customer role: ensure they only access their own vehicle's jobs
  if (req.user.role === 'customer') {
    query += " AND u.id = ?";
    params.push(req.user.id);
  }

  db.get(query, params, (err, job) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to retrieve job.' });
    }
    if (!job) {
      return res.status(404).json({ error: 'Job not found.' });
    }
    res.json(job);
  });
});

// POST /api/jobs (Employee/Admin - create job)
app.post('/api/jobs', authenticateToken, requireRole('employee'), (req, res) => {
  const { vehicle_id, notes } = req.body;

  if (!vehicle_id) {
    return res.status(400).json({ error: 'Vehicle ID is required.' });
  }

  // Verify vehicle exists
  db.get("SELECT id FROM vehicles WHERE id = ?", [vehicle_id], (err, vehicle) => {
    if (err) {
      return res.status(500).json({ error: 'Database error verifying vehicle.' });
    }
    if (!vehicle) {
      return res.status(400).json({ error: 'Invalid vehicle ID.' });
    }

    db.run(
      "INSERT INTO jobs (vehicle_id, status, notes, total_cost) VALUES (?, ?, ?, ?)",
      [vehicle_id, 'pending', notes || '', 0],
      function(insertErr) {
        if (insertErr) {
          return res.status(500).json({ error: 'Failed to create job.' });
        }
        res.status(201).json({
          message: 'Job created successfully.',
          job: { id: this.lastID, vehicle_id, status: 'pending', notes: notes || '', total_cost: 0 }
        });
      }
    );
  });
});

// PUT /api/jobs/:id (Employee/Admin - update job)
app.put('/api/jobs/:id', authenticateToken, requireRole('employee'), (req, res) => {
  const { id } = req.params;
  const { vehicle_id, status, notes, total_cost } = req.body;

  // Validate status if provided
  if (status && !['pending', 'in-progress', 'completed', 'cancelled'].includes(status)) {
    return res.status(400).json({ error: 'Invalid job status.' });
  }

  // If vehicle_id is being changed, verify it exists
  if (vehicle_id) {
    db.get("SELECT id FROM vehicles WHERE id = ?", [vehicle_id], (err, vehicle) => {
      if (err) {
        return res.status(500).json({ error: 'Database error verifying vehicle.' });
      }
      if (!vehicle) {
        return res.status(400).json({ error: 'Invalid vehicle ID.' });
      }
      updateJob();
    });
  } else {
    updateJob();
  }

  function updateJob() {
    // First, get current job to check if already completed
    db.get("SELECT id, status FROM jobs WHERE id = ?", [id], (err, currentJob) => {
      if (err) {
        return res.status(500).json({ error: 'Database error retrieving job.' });
      }
      if (!currentJob) {
        return res.status(404).json({ error: 'Job not found.' });
      }

      // Reject if job is already completed (prevent double-completion)
      if (currentJob.status === 'completed' && status === 'completed') {
        return res.status(400).json({ error: 'Job is already completed. Cannot complete again.' });
      }

      // If status is changing to 'completed', validate stock availability FIRST
      if (status === 'completed' && currentJob.status !== 'completed') {
        validateStockAndComplete(id, currentJob, vehicle_id, status, notes, total_cost, res);
      } else {
        // Normal update (no completion)
        doUpdateJob(id, currentJob, vehicle_id, status, notes, total_cost, res);
      }
    });
  }
});

function doUpdateJob(id, currentJob, vehicle_id, status, notes, total_cost, res) {
  const updates = [];
  const params = [];

  if (vehicle_id !== undefined) {
    updates.push("vehicle_id = ?");
    params.push(vehicle_id);
  }
  if (status !== undefined) {
    updates.push("status = ?");
    params.push(status);
  }
  if (notes !== undefined) {
    updates.push("notes = ?");
    params.push(notes);
  }
  if (total_cost !== undefined) {
    updates.push("total_cost = ?");
    params.push(parseFloat(total_cost));
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update.' });
  }

  updates.push("updated_at = datetime('now')");
  params.push(id);

  db.run(
    `UPDATE jobs SET ${updates.join(', ')} WHERE id = ?`,
    params,
    function(updateErr) {
      if (updateErr) {
        return res.status(500).json({ error: 'Failed to update job.' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Job not found.' });
      }
      res.json({ message: 'Job updated successfully.', jobId: parseInt(id) });
    }
  );
}

function validateStockAndComplete(jobId, currentJob, vehicle_id, status, notes, total_cost, res) {
  // Get all job items with inventory references
  db.all("SELECT * FROM job_items WHERE job_id = ? AND inventory_id IS NOT NULL", [jobId], (err, items) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to retrieve job items for completion.' });
    }

    // Check stock availability for all items first (no partial deductions)
    const stockChecks = items.map(item => {
      return new Promise((resolve, reject) => {
        db.get("SELECT quantity, item_name FROM inventory WHERE id = ?", [item.inventory_id], (err, inv) => {
          if (err) {
            return reject({ error: 'Database error checking inventory.' });
          }
          if (!inv) {
            return reject({ error: `Inventory item not found for job item: ${item.description}` });
          }
          if (inv.quantity < item.quantity) {
            return reject({ error: `Insufficient stock for "${inv.item_name}". Available: ${inv.quantity}, Required: ${item.quantity}` });
          }
          resolve({ inventory_id: item.inventory_id, quantity: item.quantity, item_name: inv.item_name });
        });
      });
    });

    Promise.all(stockChecks)
      .then(validatedItems => {
        // All stock checks passed - now do the full completion in a transaction
        completeJobTransaction(jobId, currentJob, vehicle_id, status, notes, total_cost, validatedItems, res);
      })
      .catch(error => {
        res.status(400).json({ error: error.error || 'Failed to complete job.' });
      });
  });
}

function completeJobTransaction(jobId, currentJob, vehicle_id, status, notes, total_cost, validatedItems, res) {
  db.serialize(() => {
    // 1. Update job status and other fields
    const updates = [];
    const params = [];

    if (vehicle_id !== undefined) {
      updates.push("vehicle_id = ?");
      params.push(vehicle_id);
    }
    if (status !== undefined) {
      updates.push("status = ?");
      params.push(status);
    }
    if (notes !== undefined) {
      updates.push("notes = ?");
      params.push(notes);
    }
    if (total_cost !== undefined) {
      updates.push("total_cost = ?");
      params.push(parseFloat(total_cost));
    }

    updates.push("updated_at = datetime('now')");
    params.push(jobId);

    db.run(
      `UPDATE jobs SET ${updates.join(', ')} WHERE id = ?`,
      params,
      function(updateErr) {
        if (updateErr) {
          return res.status(500).json({ error: 'Failed to update job.' });
        }
        if (this.changes === 0) {
          return res.status(404).json({ error: 'Job not found.' });
        }

        // 2. Deduct stock for each item
        let hasError = false;
        validatedItems.forEach(validatedItem => {
          if (hasError) return;
          
          db.run(
            "UPDATE inventory SET quantity = quantity - ? WHERE id = ?",
            [validatedItem.quantity, validatedItem.inventory_id],
            function(deductErr) {
              if (deductErr || this.changes === 0) {
                hasError = true;
                return res.status(500).json({ error: `Failed to deduct stock for "${validatedItem.item_name}".` });
              }
            }
          );
        });

        if (hasError) return;

        // 3. Get the job's total_cost for the ledger entry
        db.get("SELECT total_cost FROM jobs WHERE id = ?", [jobId], (err, job) => {
          if (err || !job) {
            return res.status(500).json({ error: 'Failed to retrieve job for ledger entry.' });
          }

          const totalCost = job.total_cost || 0;
          const today = new Date().toISOString().split('T')[0];
          const desc = `Job Completed: ${validatedItems.map(i => i.item_name).join(', ')}`;

          // 4. Insert sale into ledger
          db.run(
            "INSERT INTO ledger (type, description, amount, date) VALUES (?, ?, ?, ?)",
            ['sale', desc, totalCost, today],
            function(ledgerErr) {
              if (ledgerErr) {
                console.error("Error logging sale transaction for completed job:", ledgerErr);
                // Don't fail the completion if ledger insert fails - log and continue
              }
              res.json({ 
                message: 'Job completed successfully. Stock deducted and sale recorded.',
                jobId: parseInt(jobId),
                status: 'completed',
                total_cost: totalCost
              });
            }
          );
        });
      }
    );
  });
}

// DELETE /api/jobs/:id (Admin only - delete job)
app.delete('/api/jobs/:id', authenticateToken, requireRole('admin'), (req, res) => {
  const { id } = req.params;
  db.run("DELETE FROM jobs WHERE id = ?", [id], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Failed to delete job.' });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: 'Job not found.' });
    }
    res.json({ message: 'Job deleted successfully.' });
  });
});

// ===== JOB ITEMS ROUTES =====

// POST /api/jobs/:id/items (Employee/Admin - add line item to job)
app.post('/api/jobs/:id/items', authenticateToken, requireRole('employee'), (req, res) => {
  const { id } = req.params;
  const { inventory_id, description, quantity, unit_price } = req.body;

  if (!description || quantity === undefined || unit_price === undefined) {
    return res.status(400).json({ error: 'Description, quantity, and unit price are required.' });
  }

  const qty = parseInt(quantity);
  const price = parseFloat(unit_price);

  if (qty <= 0 || price < 0) {
    return res.status(400).json({ error: 'Quantity must be positive and unit price non-negative.' });
  }

  // Verify job exists and is not completed
  db.get("SELECT id, status FROM jobs WHERE id = ?", [id], (err, job) => {
    if (err) {
      return res.status(500).json({ error: 'Database error verifying job.' });
    }
    if (!job) {
      return res.status(404).json({ error: 'Job not found.' });
    }
    if (job.status === 'completed') {
      return res.status(400).json({ error: 'Cannot add items to a completed job.' });
    }

    // If inventory_id provided, verify it exists and use selling_price as default
    if (inventory_id) {
      db.get("SELECT id, selling_price, item_name FROM inventory WHERE id = ?", [inventory_id], (err, invItem) => {
        if (err) {
          return res.status(500).json({ error: 'Database error verifying inventory.' });
        }
        if (!invItem) {
          return res.status(400).json({ error: 'Invalid inventory ID.' });
        }

        const finalPrice = price || invItem.selling_price;
        const finalDescription = description || invItem.item_name;

        insertJobItem(invItem.id, finalDescription, qty, finalPrice);
      });
    } else {
      // Labor/manual item - no inventory reference
      insertJobItem(null, description, qty, price);
    }

    function insertJobItem(invId, desc, q, p) {
      db.run(
        "INSERT INTO job_items (job_id, inventory_id, description, quantity, unit_price) VALUES (?, ?, ?, ?, ?)",
        [id, invId, desc, q, p],
        function(insertErr) {
          if (insertErr) {
            return res.status(500).json({ error: 'Failed to add job item.' });
          }
          recomputeTotalCost(id, res, this.lastID, invId, desc, q, p);
        }
      );
    }
  });
});

// DELETE /api/jobs/:id/items/:itemId (Employee/Admin - remove line item from job)
app.delete('/api/jobs/:id/items/:itemId', authenticateToken, requireRole('employee'), (req, res) => {
  const { id, itemId } = req.params;

  // Verify job exists and is not completed
  db.get("SELECT id, status FROM jobs WHERE id = ?", [id], (err, job) => {
    if (err) {
      return res.status(500).json({ error: 'Database error verifying job.' });
    }
    if (!job) {
      return res.status(404).json({ error: 'Job not found.' });
    }
    if (job.status === 'completed') {
      return res.status(400).json({ error: 'Cannot remove items from a completed job.' });
    }

    // Verify item belongs to this job
    db.get("SELECT id FROM job_items WHERE id = ? AND job_id = ?", [itemId, id], (err, item) => {
      if (err) {
        return res.status(500).json({ error: 'Database error verifying job item.' });
      }
      if (!item) {
        return res.status(404).json({ error: 'Job item not found.' });
      }

      db.run("DELETE FROM job_items WHERE id = ?", [itemId], function(deleteErr) {
        if (deleteErr) {
          return res.status(500).json({ error: 'Failed to delete job item.' });
        }
        if (this.changes === 0) {
          return res.status(404).json({ error: 'Job item not found.' });
        }
        recomputeTotalCost(id, res);
      });
    });
  });
});

// Helper function to recompute job total_cost
function recomputeTotalCost(jobId, res, newItemId, newInvId, newDesc, newQty, newPrice) {
  db.all("SELECT * FROM job_items WHERE job_id = ?", [jobId], (err, items) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to retrieve job items for total calculation.' });
    }

    const total = items.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0);

    db.run(
      "UPDATE jobs SET total_cost = ?, updated_at = datetime('now') WHERE id = ?",
      [total, jobId],
      function(updateErr) {
        if (updateErr) {
          return res.status(500).json({ error: 'Failed to update job total.' });
        }

        if (newItemId) {
          // Return the newly created item with computed total
          res.status(201).json({
            message: 'Job item added successfully.',
            item: { id: newItemId, job_id: jobId, inventory_id: newInvId, description: newDesc, quantity: newQty, unit_price: newPrice },
            total_cost: total
          });
        } else {
          // Return updated total after deletion
          res.json({ message: 'Job item removed successfully.', total_cost: total });
        }
      }
    );
  });
}

// GET /api/jobs/:id/items (Employee/Admin/Customer - get job items)
app.get('/api/jobs/:id/items', authenticateToken, (req, res) => {
  const { id } = req.params;

  // Verify job exists and user has access
  let query = "SELECT id FROM jobs WHERE id = ?";
  let params = [id];

  if (req.user.role === 'customer') {
    query = `
      SELECT j.id FROM jobs j
      JOIN vehicles v ON j.vehicle_id = v.id
      WHERE j.id = ? AND v.owner_id = ?
    `;
    params = [id, req.user.id];
  }

  db.get(query, params, (err, job) => {
    if (err) {
      return res.status(500).json({ error: 'Database error verifying job.' });
    }
    if (!job) {
      return res.status(404).json({ error: 'Job not found or access denied.' });
    }

    db.all("SELECT * FROM job_items WHERE job_id = ? ORDER BY id", [id], (err, items) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to retrieve job items.' });
      }
      res.json(items || []);
    });
  });
});

// GET /api/jobs/:id/invoice (Employee/Admin/Customer - download invoice PDF)
app.get('/api/jobs/:id/invoice', authenticateToken, (req, res) => {
  const { id } = req.params;

  // Verify job exists and user has access (same logic as GET /api/jobs/:id)
  let query = `
    SELECT j.*, v.make, v.model, v.plate_number, v.year, u.name as customer_name, u.email as customer_email, u.phone as customer_phone, u.id as customer_id
    FROM jobs j
    JOIN vehicles v ON j.vehicle_id = v.id
    JOIN users u ON v.owner_id = u.id
    WHERE j.id = ?
  `;
  let params = [id];

  if (req.user.role === 'customer') {
    query += " AND u.id = ?";
    params.push(req.user.id);
  }

  db.get(query, params, (err, job) => {
    if (err) {
      return res.status(500).json({ error: 'Database error retrieving job.' });
    }
    if (!job) {
      return res.status(404).json({ error: 'Job not found or access denied.' });
    }
    if (job.status !== 'completed') {
      return res.status(400).json({ error: 'Invoice only available for completed jobs.' });
    }

    // Fetch job items
    db.all("SELECT * FROM job_items WHERE job_id = ? ORDER BY id", [id], (err, items) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to retrieve job items.' });
      }

      // Fetch shop settings
      db.all("SELECT key, value FROM settings WHERE key IN ('carwash_name', 'logo_base64')", (err, settingsRows) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to retrieve settings.' });
        }

        const settings = {};
        settingsRows.forEach(row => {
          settings[row.key] = row.value;
        });

        // Generate PDF
        const PDFDocument = require('pdfkit');
        const doc = new PDFDocument({ margin: 50, size: 'A4' });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="invoice-${id}.pdf"`);
        doc.pipe(res);

        // ===== HEADER =====
        const shopName = settings.carwash_name || 'Garage Workshop PWA';
        const shopIcon = settings.logo_base64 || '';

        // Shop name
        doc.fontSize(24).font('Helvetica-Bold').text(shopName, { align: 'center' });
        doc.moveDown(0.5);

        // Shop icon if base64
        if (shopIcon && shopIcon.startsWith('data:image')) {
          try {
            const base64Data = shopIcon.split(',')[1];
            const imgBuffer = Buffer.from(base64Data, 'base64');
            doc.image(imgBuffer, { width: 80, align: 'center' });
            doc.moveDown(0.5);
          } catch (e) {
            console.warn('Failed to embed logo in PDF:', e);
          }
        }

        // Invoice title
        doc.fontSize(18).font('Helvetica-Bold').text('INVOICE', { align: 'center' });
        doc.moveDown(1);

        // Invoice metadata table
        const invoiceDate = job.updated_at ? new Date(job.updated_at).toLocaleDateString() : new Date().toLocaleDateString();
        const invoiceData = [
          ['Invoice #:', id.toString()],
          ['Date:', invoiceDate],
          ['Status:', job.status.charAt(0).toUpperCase() + job.status.slice(1).replace('-', ' ')],
        ];

        let y = doc.y;
        invoiceData.forEach(([label, value]) => {
          doc.fontSize(10).font('Helvetica-Bold').text(label, 50, y, { width: 100 });
          doc.fontSize(10).font('Helvetica').text(value, 150, y, { width: 300 });
          y += 20;
        });
        doc.y = y + 10;

        // ===== CUSTOMER & VEHICLE INFO =====
        doc.fontSize(12).font('Helvetica-Bold').text('Customer Information', { underline: true });
        doc.moveDown(0.3);

        const customerInfo = [
          ['Name:', job.customer_name || ''],
          ['Email:', job.customer_email || ''],
          ['Phone:', job.customer_phone || 'N/A'],
        ];

        customerInfo.forEach(([label, value]) => {
          doc.fontSize(10).font('Helvetica-Bold').text(label, { continued: true });
          doc.font('Helvetica').text(' ' + value);
        });
        doc.moveDown(0.5);

        doc.fontSize(12).font('Helvetica-Bold').text('Vehicle Information', { underline: true });
        doc.moveDown(0.3);

        const vehicleInfo = [
          ['Make:', job.make || ''],
          ['Model:', job.model || ''],
          ['Year:', job.year || 'N/A'],
          ['Plate:', job.plate_number || ''],
        ];

        vehicleInfo.forEach(([label, value]) => {
          doc.fontSize(10).font('Helvetica-Bold').text(label, { continued: true });
          doc.font('Helvetica').text(' ' + value);
        });
        doc.moveDown(1);

        // ===== LINE ITEMS TABLE =====
        doc.fontSize(12).font('Helvetica-Bold').text('Line Items', { underline: true });
        doc.moveDown(0.5);

        // Table header
        const tableTop = doc.y;
        const col1 = 50;   // Description
        const col2 = 300;  // Qty
        const col3 = 360;  // Unit Price
        const col4 = 450;  // Total

        doc.fontSize(9).font('Helvetica-Bold');
        doc.text('Description', col1, tableTop, { width: 240 });
        doc.text('Qty', col2, tableTop, { width: 50, align: 'center' });
        doc.text('Unit Price', col3, tableTop, { width: 80, align: 'right' });
        doc.text('Total', col4, tableTop, { width: 80, align: 'right' });

        // Header line
        doc.moveTo(50, tableTop + 18).lineTo(530, tableTop + 18).stroke();

        let rowY = tableTop + 22;
        doc.fontSize(9).font('Helvetica');

        (items || []).forEach(item => {
          const lineTotal = item.quantity * item.unit_price;
          
          // Check if we need a new page
          if (rowY > 700) {
            doc.addPage();
            rowY = 50;
          }

          doc.text(item.description || 'Item', col1, rowY, { width: 240 });
          doc.text(item.quantity.toString(), col2, rowY, { width: 50, align: 'center' });
          doc.text('₹' + Number(item.unit_price).toFixed(2), col3, rowY, { width: 80, align: 'right' });
          doc.text('₹' + lineTotal.toFixed(2), col4, rowY, { width: 80, align: 'right' });
          
          rowY += 18;
        });

        // Total line
        doc.moveTo(50, rowY).lineTo(530, rowY).stroke();
        rowY += 10;

        const grandTotal = job.total_cost || 0;
        doc.fontSize(11).font('Helvetica-Bold');
        doc.text('Grand Total:', col2, rowY, { width: 190, align: 'right' });
        doc.text('₹' + Number(grandTotal).toFixed(2), col4, rowY, { width: 80, align: 'right' });

        // ===== FOOTER =====
        doc.moveDown(2);
        doc.fontSize(10).font('Helvetica').text('Thank you for your business!', { align: 'center' });
        doc.moveDown(0.5);
        doc.fontSize(8).font('Helvetica-Oblique').text('Generated by Garage Workshop PWA', { align: 'center', color: '#999' });

        doc.end();
      });
    });
  });
});

// ===== END JOB ITEMS ROUTES =====

// ===== END JOBS ROUTES =====

  // Fallback to route index.html for SPA client-side routing support
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.listen(PORT, () => {
  console.log(`Garage Workshop PWA Server is running on port ${PORT}`);
});
