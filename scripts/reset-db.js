const fs = require('fs');
const path = require('path');

const dbPath = path.resolve(__dirname, '../backend/garage.db');

console.log('--- Garage Database Reset & Seed Script ---');

try {
  // 1. Delete the existing database file if it exists
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
    console.log('✔ Successfully deleted existing database file (garage.db).');
  } else {
    console.log('ℹ No existing database file found at:', dbPath);
  }

  // 2. Recreate and seed the database by importing the database module
  console.log('⏳ Initializing new database and running seed queries...');
  
  // Clear require cache for the database module just in case
  delete require.cache[require.resolve('../backend/database.js')];
  
  const { db } = require('../backend/database.js');

  // Let the serialized operations and async seed queries finish
  setTimeout(() => {
    db.close((err) => {
      if (err) {
        console.error('✖ Error closing database during reset:', err.message);
        process.exit(1);
      }
      console.log('✔ Database reset and seeded successfully!');
      process.exit(0);
    });
  }, 1000);
} catch (error) {
  console.error('✖ An error occurred during database reset:', error);
  process.exit(1);
}
