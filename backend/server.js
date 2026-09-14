const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { OAuth2Client } = require('google-auth-library');
const { db, hashPassword, verifyPassword } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'garage-workshop-pwa-super-secret-key-2026';

const GOOGLE_CLIENT_ID = '603122845820-cmodpjdq3uhvpl179o92v7eeo9tll9lp.apps.googleusercontent.com';
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// Helper to normalize plate number (trim, collapse whitespace, remove non-alphanumeric, uppercase)
function normalizePlate(plate) {
  return plate.trim().replace(/\s+/g, '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
}

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
    // Server-side role verification: always check current DB role
    db.get("SELECT role FROM users WHERE id = ?", [user.id], (err, row) => {
      if (err || !row) {
        return res.status(403).json({ error: 'Forbidden: User verification failed.' });
      }
      req.user.role = row.role;
      next();
    });
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
  db.get("SELECT id FROM users WHERE email = ?", [finalEmail], (err, existingUser) => {
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
      if (['carwash_name', 'is_open', 'logo_base64', 'theme_color', 'contact_info', 'upi_id', 'upi_name', 'upi_image'].includes(key)) {
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
      COUNT(j.id) as total_services
    FROM users u
    LEFT JOIN vehicles v ON u.id = v.owner_id
    LEFT JOIN jobs j ON v.id = j.vehicle_id AND j.status = 'completed'
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

// DELETE /api/admin/users/:id (Admin only - delete user and their vehicles)
app.delete('/api/admin/users/:id', authenticateToken, requireRole('admin'), (req, res) => {
  const { id } = req.params;

  db.get("SELECT id, role FROM users WHERE id = ?", [id], (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Database error verifying user.' });
    }
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    // Prevent deleting yourself? Not required, but safe to allow.

    // Delete vehicles for this user first
    db.run("DELETE FROM vehicles WHERE owner_id = ?", [id], function(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to delete user vehicles.' });
      }

      db.run("DELETE FROM users WHERE id = ?", [id], function(deleteErr) {
        if (deleteErr) {
          return res.status(500).json({ error: 'Failed to delete user.' });
        }
        if (this.changes === 0) {
          return res.status(404).json({ error: 'User not found.' });
        }
        res.json({ message: 'User and associated vehicles deleted.' });
      });
    });
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
  if (!name) {
    return res.status(400).json({ error: 'Name is required.' });
  }
  // Phone must be exactly 10 digits if provided; generate placeholder email if empty
  let finalEmail = email || `customer-${(phone || 'unknown').replace(/[^0-9]/g, '')}@garage.local`;
  let finalPhone = phone || null;
  
  // Enforce 10-digit phone if provided
  if (finalPhone && !/^[0-9]{10}$/.test(finalPhone.replace(/[^0-9]/g, ''))) {
    return res.status(400).json({ error: 'Phone must be exactly 10 digits.' });
  }
  // Clean phone to exactly 10 digits
  finalPhone = finalPhone ? finalPhone.replace(/[^0-9]/g, '').slice(0, 10) : null;
  if (finalPhone && finalPhone.length !== 10) {
    return res.status(400).json({ error: 'Phone must be exactly 10 digits.' });
  }

  db.get("SELECT id FROM users WHERE email = ?", [finalEmail], (err, existingUser) => {
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
      [name, finalEmail, password_hash, finalPhone, role],
      function(insertErr) {
        if (insertErr) {
          return res.status(500).json({ error: 'Failed to create customer.' });
        }
        res.status(201).json({
          message: 'Customer created successfully.',
          customer: { id: this.lastID, name, email: finalEmail, phone: finalPhone, role }
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

// PUT /api/customers/:id (Admin only - update customer)
app.put('/api/customers/:id', authenticateToken, requireRole('admin'), (req, res) => {
  const { id } = req.params;
  const { name, email, phone } = req.body;

  db.get("SELECT id FROM users WHERE id = ? AND role = 'customer'", [id], (err, customer) => {
    if (err) {
      return res.status(500).json({ error: 'Database error verifying customer.' });
    }
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found.' });
    }

    // Check email uniqueness if email is being changed
    if (email !== undefined && email !== '') {
      db.get("SELECT id FROM users WHERE email = ? AND id != ?", [email, id], (err, existing) => {
        if (err) {
          return res.status(500).json({ error: 'Database error checking email uniqueness.' });
        }
        if (existing) {
          return res.status(400).json({ error: 'A user with this email already exists.' });
        }
        applyUpdate();
      });
    } else {
      applyUpdate();
    }

    function applyUpdate() {
      const updates = [];
      const params = [];
      if (name !== undefined) { updates.push("name = ?"); params.push(name); }
      if (email !== undefined) { updates.push("email = ?"); params.push(email); }
      if (phone !== undefined) { updates.push("phone = ?"); params.push(phone || null); }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'No fields to update.' });
      }
      params.push(id);

      db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params, function(updateErr) {
        if (updateErr) {
          return res.status(500).json({ error: 'Failed to update customer.' });
        }
        if (this.changes === 0) {
          return res.status(404).json({ error: 'Customer not found.' });
        }
        res.json({ message: 'Customer updated successfully.' });
      });
    }
  });
});

// DELETE /api/customers/:id (Admin only - delete customer and vehicles)
app.delete('/api/customers/:id', authenticateToken, requireRole('admin'), (req, res) => {
  const { id } = req.params;

  db.get("SELECT id FROM users WHERE id = ? AND role = 'customer'", [id], (err, customer) => {
    if (err) {
      return res.status(500).json({ error: 'Database error verifying customer.' });
    }
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found.' });
    }

    // Delete vehicles for this customer first (SQLite foreign keys may not be enforced)
    db.run("DELETE FROM vehicles WHERE owner_id = ?", [id], function(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to delete customer vehicles.' });
      }

      db.run("DELETE FROM users WHERE id = ? AND role = 'customer'", [id], function(deleteErr) {
        if (deleteErr) {
          return res.status(500).json({ error: 'Failed to delete customer.' });
        }
        if (this.changes === 0) {
          return res.status(404).json({ error: 'Customer not found.' });
        }
        res.json({ message: 'Customer and associated vehicles deleted.' });
      });
    });
  });
});

// POST /api/vehicles (Admin/Employee - create vehicle)
app.post('/api/vehicles', authenticateToken, requireRole('employee'), (req, res) => {
  const { owner_id, make, model, plate_number, year } = req.body;
  if (!owner_id || !make || !model || !plate_number) {
    return res.status(400).json({ error: 'Owner ID, make, model, and plate number are required.' });
  }

  const normalizedPlate = normalizePlate(plate_number);

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
      [owner_id, make, model, normalizedPlate, year || null],
      function(insertErr) {
        if (insertErr) {
          if (insertErr.message.includes('UNIQUE constraint failed: vehicles.plate_number')) {
            return res.status(400).json({ error: 'A vehicle with this plate number already exists.' });
          }
          return res.status(500).json({ error: 'Failed to create vehicle.' });
        }
        res.status(201).json({
          message: 'Vehicle created successfully.',
          vehicle: { id: this.lastID, owner_id, make, model, plate_number: normalizedPlate, year }
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
    const normalizedPlate = normalizePlate(plate_number);
    // Normalize stored plate: remove spaces, dashes, and other non-alphanumeric for comparison
    query += " WHERE REPLACE(REPLACE(UPPER(v.plate_number), ' ', ''), '-', '') LIKE ?";
    params.push(`%${normalizedPlate}%`);
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

  const normalizedPlate = normalizePlate(plate_number);

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
      [owner_id, make, model, normalizedPlate, year || null, id],
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
        res.json({ message: 'Vehicle updated successfully.', vehicle: { id, owner_id, make, model, plate_number: normalizedPlate, year } });
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
        const desc = `Initial stock: ${item_name} (${qty} units @ Rs.${cost.toFixed(2)})`;
        
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
          const desc = `Restock: ${itemName} (+${qtyIncrease} units @ Rs.${cost.toFixed(2)})`;
          
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
  const { status, from, to, plate_number } = req.query;
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
  // Plate number filter (primary lookup mechanism)
  if (plate_number) {
    const normalizedPlate = normalizePlate(plate_number);
    conditions.push("REPLACE(REPLACE(UPPER(v.plate_number), ' ', ''), '-', '') LIKE ?");
    params.push(`%${normalizedPlate}%`);
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

      // Fetch shop settings (include UPI settings for QR confirmation)
      db.all("SELECT key, value FROM settings WHERE key IN ('carwash_name', 'logo_base64', 'contact_info', 'upi_id', 'upi_name', 'upi_image')", async (err, settingsRows) => {
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
        const invoiceDate = job.updated_at ? new Date(job.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
        const statusLabel = job.status.charAt(0).toUpperCase() + job.status.slice(1).replace('-', ' ');

        const headerY = 40;
        const shopIcon = settings.logo_base64 || '';
        const contactInfo = settings.contact_info || '';

        // Embedded uploaded logo (if provided); otherwise no icon
        if (shopIcon && shopIcon.startsWith('data:image')) {
          try {
            const base64Data = shopIcon.split(',')[1];
            const imgBuffer = Buffer.from(base64Data, 'base64');
            doc.image(imgBuffer, 50, headerY + 5, { width: 55, height: 55, align: 'left' });
          } catch (e) {
            console.warn('Failed to embed logo in PDF:', e);
          }
        }

        // Header text
        doc.fillColor('#333');
        doc.fontSize(20).font('Helvetica-Bold').text(shopName, 120, headerY + 5, { width: 350, align: 'left' });
        doc.fontSize(10).font('Helvetica').fillColor('#666').text('Professional Auto Workshop', 120, headerY + 30, { width: 350, align: 'left' });

        // Date bar (light beige)
        const dateBarY = headerY + 65;
        doc.rect(50, dateBarY, 495, 30).fill('#f8f6f0');
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#666').text('Date:', 390, dateBarY + 8);
        doc.font('Helvetica').fillColor('#333').text(' ' + invoiceDate, 425, dateBarY + 8);

        // ===== CUSTOMER & VEHICLE INFO =====
        const infoY = dateBarY + 45;
        const colLeft = 50;
        const colRight = 320;

        // Invoiced to (customer info)
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#333').text('Invoiced to:', colLeft, infoY);
        doc.strokeColor('#eeeeee').moveTo(colLeft, infoY + 14).lineTo(colLeft + 220, infoY + 14).stroke('#eeeeee');
        doc.fillColor('#333').fontSize(9).font('Helvetica');
        doc.text('Name: ' + (job.customer_name || 'N/A'), colLeft, infoY + 22);
        doc.text('Email: ' + (job.customer_email || 'N/A'), colLeft, infoY + 38);
        doc.text('Phone: ' + (job.customer_phone || 'N/A'), colLeft, infoY + 54);

        // Vehicle info (no heading)
        doc.fillColor('#333').fontSize(9).font('Helvetica');
        doc.text('Make: ' + (job.make || 'N/A'), colRight, infoY + 22);
        doc.text('Model: ' + (job.model || 'N/A'), colRight, infoY + 38);
        doc.text('Year: ' + (job.year || 'N/A'), colRight, infoY + 54);
        doc.text('Plate: ' + (job.plate_number || 'N/A'), colRight, infoY + 70);

        doc.strokeColor('#eeeeee').moveTo(colLeft, infoY + 95).lineTo(550, infoY + 95).stroke('#eeeeee');

        // ===== LINE ITEMS TABLE =====
        const tableTop = infoY + 110;
        const col1 = 50;   // Description
        const col2 = 310;  // Qty
        const col3 = 370;  // Unit Price
        const col4 = 450;  // Total

        // Light grey header row
        doc.rect(50, tableTop - 8, 495, 22).fill('#e6e6e6');
        doc.fillColor('#333').fontSize(9).font('Helvetica-Bold');
        doc.text('DESCRIPTION', col1, tableTop, { width: 230, align: 'left' });
        doc.text('QTY', col2, tableTop, { width: 40, align: 'center' });
        doc.text('UNIT PRICE', col3, tableTop, { width: 80, align: 'right' });
        doc.text('TOTAL', col4, tableTop, { width: 80, align: 'right' });

        // Rows
        let rowY = tableTop + 26;
        doc.fontSize(9).font('Helvetica');
        (items || []).forEach((item, idx) => {
          const lineTotal = item.quantity * item.unit_price;

          if (rowY > 720) {
            doc.addPage();
            // Repeat table header on new page
            doc.rect(50, 50 - 8, 495, 22).fill('#e6e6e6');
            doc.fillColor('#333').fontSize(9).font('Helvetica-Bold');
            doc.text('DESCRIPTION', col1, 50, { width: 230, align: 'left' });
            doc.text('QTY', col2, 50, { width: 40, align: 'center' });
            doc.text('UNIT PRICE', col3, 50, { width: 80, align: 'right' });
            doc.text('TOTAL', col4, 50, { width: 80, align: 'right' });
            rowY = 58;
          }

          doc.fillColor('#444');
          doc.font('Helvetica');
          doc.text(item.description || 'Item', col1, rowY, { width: 230, align: 'left' });
          doc.text(String(item.quantity), col2, rowY, { width: 40, align: 'center' });
          doc.text('Rs. ' + Number(item.unit_price).toFixed(2), col3, rowY, { width: 80, align: 'right' });
          doc.text('Rs. ' + lineTotal.toFixed(2), col4, rowY, { width: 80, align: 'right' });

          // Row bottom border
          doc.strokeColor('#eeeeee').moveTo(50, rowY + 14).lineTo(545, rowY + 14).stroke('#eeeeee');

          rowY += 16;
        });

        // Grand total
        rowY += 12;
        const grandTotal = job.total_cost || 0;
        doc.fillColor('#111').fontSize(16).font('Helvetica-Bold');
        doc.text('GRAND TOTAL  Rs. ' + Number(grandTotal).toFixed(2), 50, rowY, { width: 495, align: 'right' });

        // ===== FOOTER =====
        const footerY = rowY + 50;
        doc.strokeColor('#dddddd').moveTo(50, footerY).lineTo(545, footerY).stroke('#dddddd');
        doc.fillColor('#555').fontSize(11).font('Helvetica');
        doc.text('Thank you for choosing us!', 50, footerY + 10, { width: 495, align: 'right' });
        doc.fontSize(10);
        doc.text(shopName, 50, footerY + 26, { width: 495, align: 'right' });
        doc.text('Professional Auto Services', 50, footerY + 42, { width: 495, align: 'right' });
        doc.text('Invoice #: ' + id.toString() + '  |  Status: ' + statusLabel, 50, footerY + 58, { width: 495, align: 'right' });
        if (contactInfo) {
          doc.fontSize(9).fillColor('#888');
          doc.text(contactInfo, 50, footerY + 74, { width: 495, align: 'right' });
        }

        // Verify saved QR data and include if present
        db.get("SELECT qr_data FROM items ORDER BY id DESC LIMIT 1", async (itemErr, itemRow) => {
          const savedQrData = (itemRow && itemRow.qr_data && itemRow.qr_data.trim().length > 0) ? itemRow.qr_data.trim() : null;

          // ===== QR CODES (visibility-controlled) =====
          const isAdmin = req.user.role === 'admin';
          const isEmployee = req.user.role === 'employee';
          const isOwnInvoice = job.customer_id === req.user.id;
          const isStaff = isAdmin || isEmployee;

          const showUpiQr = isStaff || isOwnInvoice;
          const showAdminLookupQr = isAdmin || isEmployee || isOwnInvoice;

          const upiId = settings.upi_id || '';
          const upiName = settings.upi_name || 'Garage Workshop';
          const upiString = upiId ? `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(upiName)}&am=${grandTotal}` : 'UPI Payment';
          const adminLookupString = `invoice:${id}`;

          const upiImage = settings.upi_image || '';
          const hasUpiImage = upiImage && upiImage.trim().length > 0;

          try {
            let adminBuffer = adminLookupString ? await QRCode.toBuffer(adminLookupString) : null;

            const qrY = footerY + 90;

            if (showUpiQr && hasUpiImage) {
              try {
                // Embed saved UPI QR image directly (base64 or URL)
                if (upiImage.startsWith('data:image')) {
                  const base64Data = upiImage.split(',')[1];
                  const imgBuffer = Buffer.from(base64Data, 'base64');
                  doc.image(imgBuffer, 50, qrY, { width: 100, height: 100 });
                } else if (upiImage.startsWith('http')) {
                  doc.image(upiImage, 50, qrY, { width: 100, height: 100 });
                }
                doc.fontSize(9).font('Helvetica-Bold').fillColor('#333');
                doc.text('Scan to Pay (UPI)', 160, qrY + 10, { width: 200, align: 'left' });
                doc.font('Helvetica').fontSize(8).fillColor('#666');
                doc.text(upiName ? `Name: ${upiName}` : 'UPI Payment', 160, qrY + 30);
                doc.text(upiId ? `UPI ID: ${upiId}` : '', 160, qrY + 45);
                doc.text('Admin scan confirmation: name shown above.', 160, qrY + 60, { width: 200, align: 'left' });
              } catch (imgErr) {
                console.warn('Failed to embed saved UPI image:', imgErr);
                // Fallback to text description only
                doc.fontSize(9).font('Helvetica-Bold').fillColor('#333');
                doc.text('Scan to Pay (UPI) - Image not loaded', 50, qrY + 10, { width: 200, align: 'left' });
              }
            } else if (showUpiQr && !hasUpiImage) {
              // If no saved image but staff/customer can see, show instructions
              doc.fontSize(9).font('Helvetica-Bold').fillColor('#666');
              doc.text('UPI payment info not configured.', 50, qrY + 10, { width: 200, align: 'left' });
            }

            if (showAdminLookupQr && adminBuffer) {
              const adminX = showUpiQr ? 340 : 50;
              doc.image(adminBuffer, adminX, qrY, { width: 100, height: 100 });
              doc.fontSize(9).font('Helvetica-Bold').fillColor('#333');
              doc.text(isAdmin ? 'Admin Lookup QR' : 'Scan to Find Invoice', adminX + 110, qrY + 10, { width: 180, align: 'left' });
              doc.font('Helvetica').fontSize(8).fillColor('#666');
              doc.text(`Invoice #${id}`, adminX + 110, qrY + 30);
            }

            // Embed saved scanned QR data if verified non-empty
            if (savedQrData) {
              try {
                const savedBuffer = await QRCode.toBuffer(savedQrData);
                const savedY = (showUpiQr || showAdminLookupQr) ? qrY + 130 : qrY;
                doc.image(savedBuffer, 50, savedY, { width: 80, height: 80 });
                doc.fontSize(9).font('Helvetica-Bold').fillColor('#333');
                doc.text('Saved QR Data', 140, savedY + 10, { width: 300, align: 'left' });
                doc.font('Helvetica').fontSize(8).fillColor('#666');
                doc.text(savedQrData, 140, savedY + 25, { width: 300, align: 'left' });
              } catch (savedErr) {
                console.warn('Failed to embed saved QR data:', savedErr);
              }
            }
          } catch (qrErr) {
            console.warn('Failed to embed invoice QR codes:', qrErr);
          }

          doc.end();
        });
      });
    });
  });
});

// ===== END JOB ITEMS ROUTES =====

// ===== END JOBS ROUTES =====

// ===== ANALYTICS ROUTES =====

// GET /api/analytics?from=&to= (Admin only - financial totals)
app.get('/api/analytics', authenticateToken, requireRole('admin'), (req, res) => {
  const { from, to } = req.query;
  let query = `
    SELECT 
      SUM(CASE WHEN type = 'sale' THEN amount ELSE 0 END) as totalSales,
      SUM(CASE WHEN type = 'purchase' THEN amount ELSE 0 END) as totalPurchases
    FROM ledger
  `;
  let params = [];
  const conditions = [];

  if (from) {
    conditions.push("date >= ?");
    params.push(from);
  }
  if (to) {
    conditions.push("date <= ?");
    params.push(to);
  }

  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }

  db.get(query, params, (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to retrieve analytics.' });
    }
    const totalSales = row.totalSales || 0;
    const totalPurchases = row.totalPurchases || 0;
    res.json({
      totalSales,
      totalPurchases,
      netProfit: totalSales - totalPurchases,
      from: from || null,
      to: to || null
    });
  });
});

// GET /api/ledger/export?from=&to= (Admin only - CSV export)
app.get('/api/ledger/export', authenticateToken, requireRole('admin'), (req, res) => {
  const { from, to } = req.query;
  let query = "SELECT id, type, description, amount, date FROM ledger";
  let params = [];
  const conditions = [];

  if (from) {
    conditions.push("date >= ?");
    params.push(from);
  }
  if (to) {
    conditions.push("date <= ?");
    params.push(to);
  }

  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }

  query += " ORDER BY date ASC, id ASC";

  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to retrieve ledger for export.' });
    }

    const fromStr = from || 'all';
    const toStr = to || 'all';
    const filename = `ledger-export-${fromStr}-to-${toStr}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const csvRows = [
      ['id', 'type', 'description', 'amount', 'date'].join(',')
    ];

    rows.forEach(row => {
      const escapedDesc = `"${String(row.description).replace(/"/g, '""')}"`;
      csvRows.push([row.id, row.type, escapedDesc, row.amount, row.date].join(','));
    });

    res.send(csvRows.join('\n'));
  });
});

// ===== END ANALYTICS ROUTES =====

// ===== QR SCANNING & PDF ROUTES =====

// POST /api/save-qr (Save scanned QR data)
app.post('/api/save-qr', (req, res) => {
  const { qr_data } = req.body;
  if (!qr_data) {
    return res.status(400).json({ error: 'qr_data is required.' });
  }
  db.run("INSERT INTO items (qr_data) VALUES (?)", [qr_data], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Failed to save QR data.' });
    }
    res.json({ id: this.lastID, qr_data });
  });
});

// GET /api/generate-pdf/:id (Generate PDF with embedded QR image and raw text)
app.get('/api/generate-pdf/:id', (req, res) => {
  const { id } = req.params;
  db.get("SELECT qr_data FROM items WHERE id = ?", [id], async (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to retrieve QR data.' });
    }
    if (!row) {
      return res.status(404).json({ error: 'Item not found.' });
    }

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 50, size: 'A4' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="qr-pdf-${id}.pdf"`);
    doc.pipe(res);

    // Title
    doc.fontSize(20).font('Helvetica-Bold').text('QR Code Document', 50, 50);
    doc.fontSize(12).font('Helvetica').text('Scanned from item ID: ' + id, 50, 80);

    try {
      const buffer = await QRCode.toBuffer(row.qr_data, { errorCorrectionLevel: 'M' });
      doc.image(buffer, 50, 120, { width: 200, height: 200 });
      doc.fontSize(10).font('Helvetica').text('Embedded QR Image', 50, 330);
    } catch (qrErr) {
      doc.fontSize(10).fillColor('#cc0000').text('Failed to generate QR image.', 50, 330);
      console.warn('QR buffer generation failed:', qrErr);
    }

    // Raw text
    doc.moveDown();
    doc.fontSize(12).font('Helvetica-Bold').text('Raw QR Data:', 50, 360);
    doc.fontSize(10).font('Helvetica').text(row.qr_data || '', 50, 380, { width: 450, align: 'left' });

    doc.end();
  });
});

// ===== END QR SCANNING & PDF ROUTES =====

  // Fallback to route index.html for SPA client-side routing support
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.listen(PORT, () => {
  console.log(`Garage Workshop PWA Server is running on port ${PORT}`);
});
