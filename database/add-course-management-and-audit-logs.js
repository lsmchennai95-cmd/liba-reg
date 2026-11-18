import { getPool } from '../src/config/database.js';

async function runPhase2Migration() {
  console.log('====================================================');
  console.log('  LIBA Server: Phase 2 Database Migrations');
  console.log('====================================================\n');

  const pool = getPool();

  try {
    // -----------------------------------------------------------------
    // 1. COURSES: Add scholarship configuration & course_type
    // -----------------------------------------------------------------
    console.log('[1/4] Checking `courses` table columns...');
    const [courseCols] = await pool.query('SHOW COLUMNS FROM `courses`');
    const courseColNames = new Set(courseCols.map(c => c.Field));

    if (!courseColNames.has('course_type')) {
      await pool.query(`
        ALTER TABLE \`courses\`
        ADD COLUMN \`course_type\` VARCHAR(50) NOT NULL DEFAULT 'Online Degree'
        AFTER \`description\`
      `);
      console.log('  -> Added `courses.course_type`');
    } else {
      console.log('  -> `courses.course_type` already exists');
    }

    if (!courseColNames.has('scholarship_amount')) {
      await pool.query(`
        ALTER TABLE \`courses\`
        ADD COLUMN \`scholarship_amount\` DECIMAL(12, 2) NOT NULL DEFAULT 40000.00
        AFTER \`course_type\`
      `);
      console.log('  -> Added `courses.scholarship_amount`');
    } else {
      console.log('  -> `courses.scholarship_amount` already exists');
    }

    if (!courseColNames.has('is_scholarship_active')) {
      await pool.query(`
        ALTER TABLE \`courses\`
        ADD COLUMN \`is_scholarship_active\` TINYINT(1) NOT NULL DEFAULT 1
        AFTER \`scholarship_amount\`
      `);
      console.log('  -> Added `courses.is_scholarship_active`');
    } else {
      console.log('  -> `courses.is_scholarship_active` already exists');
    }

    // Set sensible defaults for seeded courses if they exist
    await pool.query(`
      UPDATE \`courses\`
      SET \`scholarship_amount\` = 40000.00, \`course_type\` = 'Online Degree'
      WHERE \`id\` = 1 AND (\`course_type\` = 'Online Degree' OR \`course_type\` IS NULL)
    `);
    await pool.query(`
      UPDATE \`courses\`
      SET \`scholarship_amount\` = 30000.00, \`course_type\` = 'Online Certificate'
      WHERE \`id\` = 2
    `);
    await pool.query(`
      UPDATE \`courses\`
      SET \`scholarship_amount\` = 20000.00, \`course_type\` = 'Executive Diploma'
      WHERE \`id\` = 10
    `);
    console.log('  -> Seed course scholarship amounts verified.');

    // -----------------------------------------------------------------
    // 2. REGISTRATION_PAYMENTS: Add manual payment verification fields
    // -----------------------------------------------------------------
    console.log('\n[2/4] Checking `registration_payments` table columns...');
    const [regCols] = await pool.query('SHOW COLUMNS FROM `registration_payments`');
    const regColNames = new Set(regCols.map(c => c.Field));

    if (!regColNames.has('payment_method')) {
      await pool.query(`
        ALTER TABLE \`registration_payments\`
        ADD COLUMN \`payment_method\` VARCHAR(50) NULL DEFAULT NULL
        AFTER \`payment_gateway\`
      `);
      console.log('  -> Added `registration_payments.payment_method`');
    } else {
      console.log('  -> `registration_payments.payment_method` already exists');
    }

    if (!regColNames.has('actual_payment_date')) {
      await pool.query(`
        ALTER TABLE \`registration_payments\`
        ADD COLUMN \`actual_payment_date\` DATETIME NULL DEFAULT NULL
        AFTER \`paid_at\`
      `);
      console.log('  -> Added `registration_payments.actual_payment_date`');
    } else {
      console.log('  -> `registration_payments.actual_payment_date` already exists');
    }

    if (!regColNames.has('verified_by')) {
      await pool.query(`
        ALTER TABLE \`registration_payments\`
        ADD COLUMN \`verified_by\` BIGINT UNSIGNED NULL DEFAULT NULL
        AFTER \`actual_payment_date\`
      `);
      console.log('  -> Added `registration_payments.verified_by`');
    } else {
      console.log('  -> `registration_payments.verified_by` already exists');
    }

    if (!regColNames.has('verified_at')) {
      await pool.query(`
        ALTER TABLE \`registration_payments\`
        ADD COLUMN \`verified_at\` DATETIME NULL DEFAULT NULL
        AFTER \`verified_by\`
      `);
      console.log('  -> Added `registration_payments.verified_at`');
    } else {
      console.log('  -> `registration_payments.verified_at` already exists');
    }

    if (!regColNames.has('verification_status')) {
      await pool.query(`
        ALTER TABLE \`registration_payments\`
        ADD COLUMN \`verification_status\` ENUM('unverified', 'verified', 'rejected') NOT NULL DEFAULT 'unverified'
        AFTER \`verified_at\`
      `);
      console.log('  -> Added `registration_payments.verification_status`');
    } else {
      console.log('  -> `registration_payments.verification_status` already exists');
    }

    if (!regColNames.has('verification_notes')) {
      await pool.query(`
        ALTER TABLE \`registration_payments\`
        ADD COLUMN \`verification_notes\` TEXT NULL DEFAULT NULL
        AFTER \`verification_status\`
      `);
      console.log('  -> Added `registration_payments.verification_notes`');
    } else {
      console.log('  -> `registration_payments.verification_notes` already exists');
    }

    if (!regColNames.has('payment_proof_path')) {
      await pool.query(`
        ALTER TABLE \`registration_payments\`
        ADD COLUMN \`payment_proof_path\` VARCHAR(255) NULL DEFAULT NULL
        AFTER \`verification_notes\`
      `);
      console.log('  -> Added `registration_payments.payment_proof_path`');
    } else {
      console.log('  -> `registration_payments.payment_proof_path` already exists');
    }

    if (!regColNames.has('manual_txn_ref')) {
      await pool.query(`
        ALTER TABLE \`registration_payments\`
        ADD COLUMN \`manual_txn_ref\` VARCHAR(100) NULL DEFAULT NULL
        AFTER \`payment_proof_path\`
      `);
      await pool.query(`
        ALTER TABLE \`registration_payments\`
        ADD UNIQUE KEY \`uq_reg_manual_txn_ref\` (\`manual_txn_ref\`)
      `);
      console.log('  -> Added `registration_payments.manual_txn_ref` and UNIQUE KEY `uq_reg_manual_txn_ref`');
    } else {
      console.log('  -> `registration_payments.manual_txn_ref` already exists');
    }

    // Check indexes for registration_payments
    const [regKeys] = await pool.query('SHOW KEYS FROM `registration_payments` WHERE Key_name = "idx_reg_payments_verification"');
    if (regKeys.length === 0) {
      await pool.query('ALTER TABLE `registration_payments` ADD KEY `idx_reg_payments_verification` (`verification_status`)');
      console.log('  -> Added index `idx_reg_payments_verification`');
    }

    // -----------------------------------------------------------------
    // 3. SCHOLARSHIP_CLAIMS: Ensure course_id column & index
    // -----------------------------------------------------------------
    console.log('\n[3/4] Checking `scholarship_claims` table columns...');
    const [claimCols] = await pool.query('SHOW COLUMNS FROM `scholarship_claims`');
    const claimColNames = new Set(claimCols.map(c => c.Field));

    if (!claimColNames.has('course_id')) {
      await pool.query(`
        ALTER TABLE \`scholarship_claims\`
        ADD COLUMN \`course_id\` BIGINT UNSIGNED NULL DEFAULT NULL
        AFTER \`user_id\`
      `);
      console.log('  -> Added `scholarship_claims.course_id`');
    } else {
      console.log('  -> `scholarship_claims.course_id` already exists');
    }

    const [claimCourseKeys] = await pool.query('SHOW KEYS FROM `scholarship_claims` WHERE Key_name = "idx_scholarship_claims_course"');
    if (claimCourseKeys.length === 0) {
      await pool.query('ALTER TABLE `scholarship_claims` ADD KEY `idx_scholarship_claims_course` (`course_id`)');
      console.log('  -> Added index `idx_scholarship_claims_course`');
    }

    // Populate course_id on existing claims if null, joining strictly from enrollments (unmatched remain NULL)
    await pool.query(`
      UPDATE \`scholarship_claims\` sc
      LEFT JOIN \`enrollments\` e ON e.user_id = sc.user_id
      SET sc.course_id = e.course_id
      WHERE sc.course_id IS NULL
    `);
    console.log('  -> Existing claims course_id linkage verified (strictly from verified enrollments).');

    // -----------------------------------------------------------------
    // 4. ADMIN_AUDIT_LOGS: Create table if not exists with ON DELETE SET NULL
    // -----------------------------------------------------------------
    console.log('\n[4/4] Checking `admin_audit_logs` table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`admin_audit_logs\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`admin_id\` BIGINT UNSIGNED NULL DEFAULT NULL,
        \`admin_email\` VARCHAR(255) NULL DEFAULT NULL,
        \`action\` VARCHAR(100) NOT NULL,
        \`target_type\` VARCHAR(50) NOT NULL,
        \`target_id\` VARCHAR(50) NOT NULL,
        \`previous_value\` JSON NULL DEFAULT NULL,
        \`new_value\` JSON NULL DEFAULT NULL,
        \`notes\` TEXT NULL DEFAULT NULL,
        \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`idx_audit_admin\` (\`admin_id\`),
        KEY \`idx_audit_action\` (\`action\`),
        KEY \`idx_audit_target\` (\`target_type\`, \`target_id\`),
        KEY \`idx_audit_created\` (\`created_at\`),
        CONSTRAINT \`fk_audit_admin\` FOREIGN KEY (\`admin_id\`)
          REFERENCES \`users\` (\`id\`) ON DELETE SET NULL ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('  -> `admin_audit_logs` table created/verified with ON DELETE SET NULL.');

    console.log('\n====================================================');
    console.log('  Phase 2 Database Migrations Completed Successfully!');
    console.log('====================================================');
    process.exit(0);
  } catch (err) {
    console.error('\n[FATAL ERROR] Phase 2 migration failed:', err);
    process.exit(1);
  }
}

runPhase2Migration();

