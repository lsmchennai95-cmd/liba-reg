import { getPool } from '../config/database.js';

async function run() {
  const pool = getPool();
  try {
    const [cols] = await pool.query(
      "SHOW COLUMNS FROM `student_profiles` LIKE 'application_status'"
    );

    if (cols.length === 0) {
      throw new Error('Column student_profiles.application_status not found');
    }

    const currentType = String(cols[0].Type || '');
    if (currentType.includes("'scholarship_submitted'")) {
      console.log("[MIGRATION] 'scholarship_submitted' is already present in student_profiles.application_status.");
      return;
    }

    await pool.query(`
      ALTER TABLE \`student_profiles\`
      MODIFY COLUMN \`application_status\`
      ENUM('pending_verification', 'email_verified', 'awaiting_payment', 'payment_pending', 'payment_failed', 'submitted', 'scholarship_submitted', 'pending_review', 'under_scrutiny', 'approved', 'rejected')
      NOT NULL DEFAULT 'pending_verification'
    `);

    console.log("[MIGRATION] Safely added 'scholarship_submitted' to student_profiles.application_status.");
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error('[ERROR] Migration failed:', err);
  process.exit(1);
});

