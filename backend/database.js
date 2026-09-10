const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');

const dbPath = path.resolve(__dirname, 'garage.db');
const db = new sqlite3.Database(dbPath);

// Helper to hash password using Node's native crypto (safe from native build issues)
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

db.serialize(() => {
  // 1. Create Users Table
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      picture TEXT,
      role TEXT CHECK(role IN ('admin','employee','customer')) NOT NULL
    )
  `);

  // 2. Create Settings Table
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // 3. Create Bookings Table
  db.run(`
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT NOT NULL,
      customer_email TEXT,
      license_plate TEXT,
      vehicle_type TEXT NOT NULL,
      service TEXT NOT NULL,
      pricing REAL NOT NULL,
      booking_time TEXT NOT NULL,
      status TEXT CHECK(status IN ('pending', 'booked', 'service finished', 'cancelled')) DEFAULT 'pending'
    )
  `, (err) => {
    if (!err) {
      // Ensure the customer_email column is added if the table already existed
      db.run("ALTER TABLE bookings ADD COLUMN customer_email TEXT", (alterErr) => {
        // Safe to ignore if column already exists
      });
    }
  });

  // 3b. Create Services Table
  db.run(`
    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price REAL NOT NULL
    )
  `);

  // 4. Create Ledger Table
  db.run(`
    CREATE TABLE IF NOT EXISTS ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT CHECK(type IN ('sale', 'purchase')) NOT NULL,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      date TEXT NOT NULL
    )
  `);

  // --- Seed Data Setup ---
  
  // Seed settings if they don't exist
  db.get("SELECT COUNT(*) as count FROM settings", (err, row) => {
    if (err) console.error("Error checking settings count:", err);
    if (row && row.count === 0) {
      db.run("INSERT INTO settings (key, value) VALUES ('carwash_name', 'Garage Workshop PWA')");
      db.run("INSERT INTO settings (key, value) VALUES ('is_open', 'true')");
      db.run("INSERT INTO settings (key, value) VALUES ('logo_base64', '')"); // Default empty logo
      db.run("INSERT INTO settings (key, value) VALUES ('theme_color', 'indigo')"); // Default theme color
      console.log("Seeded default settings.");
    }
  });

  // Seed default users if empty
  db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
    if (err) console.error("Error checking users count:", err);
    if (row && row.count === 0) {
      const ownerHash = hashPassword('SuperStrongAdminPassword!2026');

      // Replicating admin user with admin@carwash.com for compliance with existing test file expectations, 
      // but also adding admin@garage.com for workshop context consistency.
      db.run("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)", 
        ['Garage Owner', 'admin@carwash.com', ownerHash, 'admin']);
      db.run("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)", 
        ['Garage Workshop Owner', 'admin@garage.com', ownerHash, 'admin']);
      console.log("Seeded default admin users.");
    }
  });

  // Seed default ledger transactions if empty
  db.get("SELECT COUNT(*) as count FROM ledger", (err, row) => {
    if (err) console.error("Error checking ledger count:", err);
    if (row && row.count === 0) {
      const today = new Date().toISOString().split('T')[0];
      db.run("INSERT INTO ledger (type, description, amount, date) VALUES (?, ?, ?, ?)",
        ['sale', 'Full Synthetic Oil Change - License ABC-123', 85.00, today]);
      db.run("INSERT INTO ledger (type, description, amount, date) VALUES (?, ?, ?, ?)",
        ['purchase', 'Premium Brake Pads & Rotors Inventory Restock', 150.00, today]);
      db.run("INSERT INTO ledger (type, description, amount, date) VALUES (?, ?, ?, ?)",
        ['sale', 'Front Brake Service & Inspection - License XYZ-789', 240.00, today]);
      console.log("Seeded default ledger transactions.");
    }
  });

  // Seed default services if empty
  db.get("SELECT COUNT(*) as count FROM services", (err, row) => {
    if (err) console.error("Error checking services count:", err);
    if (row && row.count === 0) {
      db.run("INSERT INTO services (name, price) VALUES ('Full Synthetic Oil Change', 85.00)");
      db.run("INSERT INTO services (name, price) VALUES ('Standard Brake Service', 120.00)");
      db.run("INSERT INTO services (name, price) VALUES ('Engine Diagnostics & Tune-up', 150.00)");
      console.log("Seeded default services.");
    }
  });

  // Seed default bookings if empty
  db.get("SELECT COUNT(*) as count FROM bookings", (err, row) => {
    if (err) console.error("Error checking bookings count:", err);
    if (row && row.count === 0) {
      const today = new Date();
      const bookingTime1 = new Date(today.getTime() + 2 * 3600000).toISOString(); // 2 hours from now
      const bookingTime2 = new Date(today.getTime() + 24 * 3600000).toISOString(); // tomorrow

      db.run("INSERT INTO bookings (customer_name, customer_email, license_plate, vehicle_type, service, pricing, booking_time, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ['Jane Smith', 'jane@example.com', 'WASH-777', 'SUV', 'Engine Diagnostics & Tune-up', 150.00, bookingTime1, 'booked']);
      db.run("INSERT INTO bookings (customer_name, customer_email, license_plate, vehicle_type, service, pricing, booking_time, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ['Robert Johnson', 'robert@example.com', 'ECO-101', 'Sedan', 'Full Synthetic Oil Change', 85.00, bookingTime2, 'pending']);
      console.log("Seeded default bookings.");
    }
  });
});

module.exports = {
  db,
  hashPassword,
  verifyPassword: (password, storedPasswordHash) => {
    try {
      const [salt, hash] = storedPasswordHash.split(':');
      const verifyHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
      return hash === verifyHash;
    } catch (e) {
      return false;
    }
  }
};
