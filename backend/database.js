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
      phone TEXT,
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

  // 3. Create Vehicles Table
  db.run(`
    CREATE TABLE IF NOT EXISTS vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL,
      make TEXT NOT NULL,
      model TEXT NOT NULL,
      plate_number TEXT NOT NULL UNIQUE,
      year INTEGER,
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // 4. Create Inventory Table
  db.run(`
    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_name TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      cost_price REAL NOT NULL,
      selling_price REAL NOT NULL
    )
  `);

  // 5. Create Holidays Table
  db.run(`
    CREATE TABLE IF NOT EXISTS holidays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      reason TEXT NOT NULL
    )
  `);

  // 6. Create Jobs Table (replaces bookings)
  db.run(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL,
      status TEXT CHECK(status IN ('pending', 'in-progress', 'completed', 'cancelled')) DEFAULT 'pending',
      notes TEXT,
      total_cost REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
    )
  `);

  // 6b. Create Job Items Table
  db.run(`
    CREATE TABLE IF NOT EXISTS job_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      inventory_id INTEGER,
      description TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_price REAL NOT NULL,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
      FOREIGN KEY (inventory_id) REFERENCES inventory(id) ON DELETE SET NULL
    )
  `);

  // 6. Create Items Table (QR data storage)
  db.run(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      qr_data TEXT NOT NULL
    )
  `);

  // 6c. Create Services Table
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
      db.run("INSERT INTO settings (key, value) VALUES ('upi_id', 'garage@upi')"); // Default UPI ID
      db.run("INSERT INTO settings (key, value) VALUES ('upi_name', 'Garage Workshop')"); // Default UPI name
      db.run("INSERT INTO settings (key, value) VALUES ('upi_image', '')"); // Default empty UPI image
      console.log("Seeded default settings.");
    }
  });

  // Seed default users if empty
  db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
    if (err) console.error("Error checking users count:", err);
    if (row && row.count === 0) {
      const ownerHash = hashPassword('SuperStrongAdminPassword!2026');
      const employeeHash = hashPassword('EmployeePass!2026');
      const customerHash = hashPassword('CustomerPass!2026');

      // Replicating admin user with admin@carwash.com for compliance with existing test file expectations, 
      // but also adding admin@garage.com for workshop context consistency.
      db.run("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)", 
        ['Garage Owner', 'admin@carwash.com', ownerHash, 'admin']);
      db.run("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)", 
        ['Garage Workshop Owner', 'admin@garage.com', ownerHash, 'admin']);
      db.run("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)", 
        ['John Mechanic', 'employee@garage.com', employeeHash, 'employee']);
      db.run("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)", 
        ['Jane Customer', 'customer@garage.com', customerHash, 'customer']);
      console.log("Seeded default users (admin, employee, customer).");
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

  // Seed default vehicles if empty
  db.get("SELECT COUNT(*) as count FROM vehicles", (err, row) => {
    if (err) console.error("Error checking vehicles count:", err);
    if (row && row.count === 0) {
      // Seed vehicles for the customer user (id 4, after 2 admins + 1 employee)
      db.run("INSERT INTO vehicles (owner_id, make, model, plate_number, year) VALUES (?, ?, ?, ?, ?)",
        [4, 'Toyota', 'Camry', 'ABC-123', 2020]);
      db.run("INSERT INTO vehicles (owner_id, make, model, plate_number, year) VALUES (?, ?, ?, ?, ?)",
        [4, 'Honda', 'Civic', 'XYZ-789', 2019]);
      db.run("INSERT INTO vehicles (owner_id, make, model, plate_number, year) VALUES (?, ?, ?, ?, ?)",
        [4, 'Ford', 'F-150', 'TRK-456', 2021]);
      console.log("Seeded default vehicles.");
    }
  });

  // Seed default inventory if empty
  db.get("SELECT COUNT(*) as count FROM inventory", (err, row) => {
    if (err) console.error("Error checking inventory count:", err);
    if (row && row.count === 0) {
      db.run("INSERT INTO inventory (item_name, quantity, cost_price, selling_price) VALUES (?, ?, ?, ?)",
        ['Synthetic Oil 5W-30 (1L)', 50, 8.50, 15.00]);
      db.run("INSERT INTO inventory (item_name, quantity, cost_price, selling_price) VALUES (?, ?, ?, ?)",
        ['Oil Filter', 30, 5.00, 12.00]);
      db.run("INSERT INTO inventory (item_name, quantity, cost_price, selling_price) VALUES (?, ?, ?, ?)",
        ['Brake Pads (Front)', 20, 25.00, 55.00]);
      db.run("INSERT INTO inventory (item_name, quantity, cost_price, selling_price) VALUES (?, ?, ?, ?)",
        ['Brake Rotors (Front)', 10, 40.00, 85.00]);
      db.run("INSERT INTO inventory (item_name, quantity, cost_price, selling_price) VALUES (?, ?, ?, ?)",
        ['Air Filter', 25, 6.00, 18.00]);
      db.run("INSERT INTO inventory (item_name, quantity, cost_price, selling_price) VALUES (?, ?, ?, ?)",
        ['Spark Plugs (set of 4)', 15, 12.00, 30.00]);
      db.run("INSERT INTO inventory (item_name, quantity, cost_price, selling_price) VALUES (?, ?, ?, ?)",
        ['Coolant (1L)', 20, 7.00, 14.00]);
      db.run("INSERT INTO inventory (item_name, quantity, cost_price, selling_price) VALUES (?, ?, ?, ?)",
        ['Transmission Fluid (1L)', 10, 10.00, 22.00]);
      console.log("Seeded default inventory.");
    }
  });

  // Seed default holidays if empty
  db.get("SELECT COUNT(*) as count FROM holidays", (err, row) => {
    if (err) console.error("Error checking holidays count:", err);
    if (row && row.count === 0) {
      const futureDate1 = new Date();
      futureDate1.setDate(futureDate1.getDate() + 7);
      const futureDate2 = new Date();
      futureDate2.setDate(futureDate2.getDate() + 30);
      db.run("INSERT INTO holidays (date, reason) VALUES (?, ?)",
        [futureDate1.toISOString().split('T')[0], 'Staff Training Day']);
      db.run("INSERT INTO holidays (date, reason) VALUES (?, ?)",
        [futureDate2.toISOString().split('T')[0], 'Annual Maintenance']);
      console.log("Seeded default holidays.");
    }
  });

  // Seed default jobs if empty
  db.get("SELECT COUNT(*) as count FROM jobs", (err, row) => {
    if (err) console.error("Error checking jobs count:", err);
    if (row && row.count === 0) {
      db.run("INSERT INTO jobs (vehicle_id, status, notes, total_cost) VALUES (?, ?, ?, ?)",
        [1, 'pending', 'Customer requested oil change', 0]);
      db.run("INSERT INTO jobs (vehicle_id, status, notes, total_cost) VALUES (?, ?, ?, ?)",
        [2, 'in-progress', 'Brake inspection in progress', 120.00]);
      db.run("INSERT INTO jobs (vehicle_id, status, notes, total_cost) VALUES (?, ?, ?, ?)",
        [3, 'completed', 'Full service completed', 245.00]);
      console.log("Seeded default jobs.");
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
