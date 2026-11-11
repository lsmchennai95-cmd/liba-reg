import { query } from '../src/config/database.js';

async function run() {
  try {
    await query("ALTER TABLE registration_payments ADD COLUMN payment_type VARCHAR(50) DEFAULT 'registration_fee' AFTER payment_gateway");
    console.log("Successfully added payment_type to registration_payments");
  } catch (e) {
    console.log("registration_payments payment_type:", e.message);
  }

  try {
    await query("ALTER TABLE payments ADD COLUMN payment_type VARCHAR(50) DEFAULT 'course_fee' AFTER payment_method");
    console.log("Successfully added payment_type to payments");
  } catch (e) {
    console.log("payments payment_type:", e.message);
  }

  process.exit(0);
}

run();

