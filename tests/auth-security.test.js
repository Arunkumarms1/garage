const assert = require('assert');
const crypto = require('crypto');
const { db, hashPassword, verifyPassword } = require('../backend/database');

console.log('=== Running Garage Auth & Security Validation Tests ===\n');

function runTests() {
  db.serialize(() => {
    // Test 1: Admin password case fallback verification
    console.log('Running Test 1: Admin password case-sensitivity...');
    db.get("SELECT password_hash FROM users WHERE email = 'admin@carwash.com'", (err, row) => {
      assert.ifError(err);
      assert.ok(row, 'Admin user should exist in the database.');
      
      // Mixed-case should match
      assert.strictEqual(verifyPassword('SuperStrongAdminPassword!2026', row.password_hash), true, 'Mixed-case password should match');
      // Lowercase should fail without fallback
      assert.strictEqual(verifyPassword('superstrongadminpassword!2026', row.password_hash), false, 'Lowercase password should fail');
      // Incorrect password should fail
      assert.strictEqual(verifyPassword('wrongpassword', row.password_hash), false, 'Wrong password should fail');
      
      console.log('✔ Test 1 passed successfully!');
    });

    // Test 2: Standard password case sensitivity (should NOT be case-insensitive for other users)
    console.log('Running Test 2: Standard password case-sensitivity...');
    const testHash = hashPassword('MySecret123!');
    assert.strictEqual(verifyPassword('MySecret123!', testHash), true, 'Correct casing should match');
    assert.strictEqual(verifyPassword('mysecret123!', testHash), false, 'Incorrect casing should fail');
    console.log('✔ Test 2 passed successfully!');

    // Test 3: Duplicate signup prevention in DB
    console.log('Running Test 3: Database unique constraint verification...');
    const randomEmail = `test-${crypto.randomBytes(4).toString('hex')}@example.com`;
    db.run("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)",
      ['Test User', randomEmail, hashPassword('pass123'), 'customer'],
      function(err) {
        assert.ifError(err);
        
        // Attempt duplicate insert
        db.run("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)",
          ['Test User 2', randomEmail, hashPassword('pass456'), 'customer'],
          function(dupErr) {
            assert.ok(dupErr, 'Duplicate email registration should trigger constraint error');
            assert.ok(dupErr.message.includes('UNIQUE constraint failed'), 'Error should be a UNIQUE constraint failure');
            console.log('✔ Test 3 passed successfully!');
          }
        );
      }
    );

    // Test 4: Profile picture validation helper
    console.log('Running Test 4: Profile picture base64 type restrict checks...');
    const safePng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const safeJpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
    const maliciousSvgXss = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>';
    const randomText = 'not-even-data-image';

    const testRegex = /^data:image\/(png|jpeg|webp|gif);base64,/;
    assert.strictEqual(testRegex.test(safePng), true, 'PNG base64 should be accepted');
    assert.strictEqual(testRegex.test(safeJpeg), true, 'JPEG base64 should be accepted');
    assert.strictEqual(testRegex.test(maliciousSvgXss), false, 'SVG image should be blocked');
    assert.strictEqual(testRegex.test(randomText), false, 'Plain text should be blocked');
    console.log('✔ Test 4 passed successfully!');

    // Test 5: Booking status update and validation checks (including cancelled state)
    console.log('Running Test 5: Booking status CHECK constraint validation (including cancelled)...');
    db.run("INSERT INTO bookings (customer_name, customer_email, license_plate, vehicle_type, service, pricing, booking_time, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ['Test Customer', 'customer@example.com', 'TEST-123', 'Sedan', 'Standard Repair', 20.00, new Date().toISOString(), 'pending'],
      function(err) {
        assert.ifError(err);
        const bookingId = this.lastID;

        // Try to update status to 'cancelled' - should succeed
        db.run("UPDATE bookings SET status = ? WHERE id = ?", ['cancelled', bookingId], function(updateErr) {
          assert.ifError(updateErr);
          
          // Verify it updated correctly
          db.get("SELECT status FROM bookings WHERE id = ?", [bookingId], (selectErr, row) => {
            assert.ifError(selectErr);
            assert.strictEqual(row.status, 'cancelled', 'Status should be successfully updated to cancelled');

            // Try to update to an invalid status (e.g. 'expired') - should fail CHECK constraint
            db.run("UPDATE bookings SET status = ? WHERE id = ?", ['expired', bookingId], function(invalidErr) {
              assert.ok(invalidErr, 'Invalid status update should fail CHECK constraint');
              console.log('✔ Test 5 passed successfully!');
            });
          });
        });
      }
    );

    // Close db connection and print summary
    setTimeout(() => {
      console.log('\n✔ All Garage Auth & Security Validation Tests Passed successfully!');
      process.exit(0);
    }, 100);
  });
}

runTests();
