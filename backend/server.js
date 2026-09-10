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

// Middleware to restrict access to specific roles (e.g. 'owner')
function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ error: `Forbidden: Requires ${role} role.` });
    }
    next();
  };
}

// ==========================================
// ROUTES & API ENDPOINTS
// ==========================================

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
app.post('/api/services', authenticateToken, requireRole('owner'), (req, res) => {
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
app.delete('/api/services/:id', authenticateToken, requireRole('owner'), (req, res) => {
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
app.put('/api/bookings/:id', authenticateToken, requireRole('owner'), (req, res) => {
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
app.put('/api/settings', authenticateToken, requireRole('owner'), (req, res) => {
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


// --- Ledger / Profit Analytics Endpoints ---

// GET /api/ledger (Owner reads analytics and ledger)
app.get('/api/ledger', authenticateToken, requireRole('owner'), (req, res) => {
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
app.post('/api/ledger', authenticateToken, requireRole('owner'), (req, res) => {
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
app.get('/api/admin/users', authenticateToken, requireRole('owner'), (req, res) => {
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

// Fallback to route index.html for SPA client-side routing support
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.listen(PORT, () => {
  console.log(`Garage Workshop PWA Server is running on port ${PORT}`);
});
