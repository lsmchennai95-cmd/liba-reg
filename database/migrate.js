import { getPool } from '../src/config/database.js';

async function runMigration() {
  console.log('==============================================');
  console.log('  LIBA Server: Safe Schema Migration');
  console.log('==============================================');

  const pool = getPool();

  try {
    // 1. Add is_verified to users if not present and ensure default is_active is 0
    const [cols] = await pool.query("SHOW COLUMNS FROM `users` LIKE 'is_verified'");
    if (cols.length === 0) {
      await pool.query(
        "ALTER TABLE `users` ADD COLUMN `is_verified` TINYINT(1) NOT NULL DEFAULT 0 AFTER `is_active`"
      );
      console.log('[MIGRATION] Added `is_verified` column to `users` table.');
    } else {
      console.log('[MIGRATION] `is_verified` column already exists in `users`.');
    }

    // Ensure is_active default in users is 0
    await pool.query(
      "ALTER TABLE `users` MODIFY COLUMN `is_active` TINYINT(1) NOT NULL DEFAULT 0"
    );
    console.log('[MIGRATION] Verified `users.is_active` default is 0.');

    // 2. Create user_otps table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`user_otps\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`user_id\` BIGINT UNSIGNED NOT NULL,
        \`otp_hash\` VARCHAR(255) NOT NULL,
        \`purpose\` ENUM('registration', 'password_reset') NOT NULL DEFAULT 'registration',
        \`expires_at\` DATETIME NOT NULL,
        \`attempts\` INT UNSIGNED NOT NULL DEFAULT 0,
        \`max_attempts\` INT UNSIGNED NOT NULL DEFAULT 5,
        \`is_used\` TINYINT(1) NOT NULL DEFAULT 0,
        \`last_sent_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`idx_user_otps_user\` (\`user_id\`),
        KEY \`idx_user_otps_lookup\` (\`user_id\`, \`purpose\`, \`is_used\`),
        CONSTRAINT \`fk_user_otps_user\` FOREIGN KEY (\`user_id\`)
          REFERENCES \`users\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('[MIGRATION] `user_otps` table verified/created.');

    // 3. Update application_status enum in student_profiles
    await pool.query(`
      ALTER TABLE \`student_profiles\` 
      MODIFY COLUMN \`application_status\` 
      ENUM('pending_verification', 'email_verified', 'awaiting_payment', 'payment_pending', 'payment_failed', 'submitted', 'scholarship_submitted', 'pending_review', 'under_scrutiny', 'approved', 'rejected') 
      NOT NULL DEFAULT 'pending_verification'
    `);
    console.log('[MIGRATION] Updated `student_profiles.application_status` enum options.');

    // 4. Ensure executive diploma specializations exist
    const additionalSpecs = [
      [11, 10, 'CORP_FIN', 'Corporate Finance with AI', 1],
      [12, 10, 'HRM_ED', 'Human Resource Management', 1],
      [13, 10, 'SCM_ED', 'Logistics and Supply Chain Management with AI', 1],
      [14, 10, 'MKT_ED', 'Marketing Management in AI Era', 1],
      [15, 10, 'ALGO_TRAD', 'Investment Management & Algorithmic Trading', 1]
    ];

    for (const spec of additionalSpecs) {
      await pool.query(
        'INSERT IGNORE INTO `specializations` (`id`, `course_id`, `code`, `name`, `is_active`) VALUES (?, ?, ?, ?, ?)',
        spec
      );
    }
    console.log('[MIGRATION] Executive diploma specializations verified.');

    // 5. Create scholarship_codes table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`scholarship_codes\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`code\` VARCHAR(20) NOT NULL UNIQUE,
        \`amount\` DECIMAL(12, 2) NOT NULL,
        \`description\` VARCHAR(255) NOT NULL DEFAULT 'Counselor Scholarship Grant',
        \`is_active\` TINYINT(1) NOT NULL DEFAULT 1,
        \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_scholarship_code\` (\`code\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('[MIGRATION] `scholarship_codes` table verified/created.');

    // Seed 50 Counselor Scholarship codes
    const scholarshipCodes = [
      ['980454', 1000], ['234426', 2000], ['543913', 3000], ['482008', 4000], ['749836', 5000],
      ['767070', 6000], ['342214', 7000], ['473616', 8000], ['494814', 9000], ['461181', 10000],
      ['968258', 11000], ['689088', 12000], ['959491', 13000], ['331709', 14000], ['409993', 15000],
      ['835230', 16000], ['178799', 17000], ['144914', 18000], ['336605', 19000], ['851759', 20000],
      ['857133', 21000], ['230959', 22000], ['526430', 23000], ['380357', 24000], ['736439', 25000],
      ['587766', 26000], ['835644', 27000], ['454779', 28000], ['659998', 29000], ['125392', 30000],
      ['795503', 31000], ['479921', 32000], ['103735', 33000], ['436626', 34000], ['150940', 35000],
      ['466088', 36000], ['261758', 37000], ['156938', 38000], ['406423', 39000], ['295476', 40000],
      ['129958', 41000], ['258541', 42000], ['408838', 43000], ['144069', 44000], ['830377', 45000],
      ['328121', 46000], ['565814', 47000], ['286563', 48000], ['279530', 49000], ['585311', 50000]
    ];

    for (const [code, amount] of scholarshipCodes) {
      await pool.query(
        'INSERT IGNORE INTO `scholarship_codes` (`code`, `amount`, `description`) VALUES (?, ?, ?)',
        [code, amount, 'Counselor Scholarship Grant']
      );
    }
    console.log('[MIGRATION] 50 Counselor scholarship codes populated.');

    // 6. Create student_academics table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`student_academics\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`user_id\` BIGINT UNSIGNED NOT NULL,
        \`student_profile_id\` BIGINT UNSIGNED NULL,
        \`twelfth_school\` VARCHAR(255) NULL,
        \`twelfth_board\` VARCHAR(100) NULL,
        \`twelfth_stream\` VARCHAR(100) NULL,
        \`twelfth_year\` VARCHAR(10) NULL,
        \`twelfth_percentage\` VARCHAR(20) NULL,
        \`ug_degree\` VARCHAR(100) NULL,
        \`ug_college\` VARCHAR(255) NULL,
        \`ug_specialization\` VARCHAR(150) NULL,
        \`ug_year\` VARCHAR(10) NULL,
        \`ug_percentage\` VARCHAR(20) NULL,
        \`certifications\` JSON NULL,
        \`certificate_uploads\` JSON NULL,
        \`promo_code\` VARCHAR(20) NULL,
        \`scholarship_amount\` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        \`scholarship_status\` ENUM('not_applied', 'applied', 'approved', 'rejected') NOT NULL DEFAULT 'not_applied',
        \`applied_at\` DATETIME NULL,
        \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_student_academics_user\` (\`user_id\`),
        KEY \`idx_student_academics_profile\` (\`student_profile_id\`),
        CONSTRAINT \`fk_student_academics_user\` FOREIGN KEY (\`user_id\`)
          REFERENCES \`users\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('[MIGRATION] `student_academics` table verified/created.');

    // Check certificate_uploads column
    const [certUploadCols] = await pool.query("SHOW COLUMNS FROM `student_academics` LIKE 'certificate_uploads'");
    if (certUploadCols.length === 0) {
      await pool.query(
        "ALTER TABLE `student_academics` ADD COLUMN `certificate_uploads` JSON NULL AFTER `certifications`"
      );
      console.log('[MIGRATION] Added `certificate_uploads` column to `student_academics`.');
    }

    // 7. Create registration_payments table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`registration_payments\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`user_id\` BIGINT UNSIGNED NOT NULL,
        \`student_profile_id\` BIGINT UNSIGNED NULL,
        \`course_id\` BIGINT UNSIGNED NOT NULL,
        \`original_reg_fee\` DECIMAL(12, 2) NOT NULL,
        \`scholarship_code\` VARCHAR(50) NULL,
        \`scholarship_discount\` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        \`final_reg_fee\` DECIMAL(12, 2) NOT NULL,
        \`order_id\` VARCHAR(100) NOT NULL UNIQUE,
        \`transaction_id\` VARCHAR(100) NULL UNIQUE,
        \`payment_gateway\` VARCHAR(50) NOT NULL DEFAULT 'ccavenue',
        \`payment_status\` ENUM('pending', 'successful', 'failed') NOT NULL DEFAULT 'pending',
        \`paid_at\` DATETIME NULL,
        \`raw_response\` TEXT NULL,
        \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`idx_reg_payments_user\` (\`user_id\`),
        KEY \`idx_reg_payments_order\` (\`order_id\`),
        CONSTRAINT \`fk_reg_payments_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('[MIGRATION] `registration_payments` table verified/created.');

    // 8. Financial separation: Reset enrollments.total_fee back to original course fee
    await pool.query(`
      UPDATE enrollments e
      JOIN course_fees cf ON cf.course_id = e.course_id
      SET e.total_fee = cf.total_fee,
          e.outstanding_balance = cf.total_fee - e.amount_paid
    `);
    console.log('[MIGRATION] Ensured `enrollments.total_fee` reflects full course fee, separate from registration fee.');

    // 9. Create registration_notification_recipients table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`registration_notification_recipients\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`recipient_name\` VARCHAR(150) NOT NULL,
        \`email\` VARCHAR(255) NOT NULL,
        \`is_active\` TINYINT(1) NOT NULL DEFAULT 1,
        \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_reg_notif_recipient_email\` (\`email\`),
        KEY \`idx_reg_notif_recipient_active\` (\`is_active\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('[MIGRATION] `registration_notification_recipients` table verified/created.');

    // 10. Create registration_notification_outbox table (duplicate prevention & retry queue)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`registration_notification_outbox\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`user_id\` BIGINT UNSIGNED NOT NULL,
        \`student_id\` VARCHAR(50) NULL DEFAULT NULL,
        \`application_no\` VARCHAR(50) NULL DEFAULT NULL,
        \`payload\` JSON NOT NULL,
        \`recipients_snapshot\` JSON NULL DEFAULT NULL,
        \`status\` ENUM('pending', 'processing', 'sent', 'failed', 'skipped') NOT NULL DEFAULT 'pending',
        \`attempts\` INT UNSIGNED NOT NULL DEFAULT 0,
        \`max_attempts\` INT UNSIGNED NOT NULL DEFAULT 3,
        \`last_error\` TEXT NULL DEFAULT NULL,
        \`next_retry_at\` DATETIME NULL DEFAULT NULL,
        \`sent_at\` DATETIME NULL DEFAULT NULL,
        \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_reg_notif_outbox_user\` (\`user_id\`),
        KEY \`idx_reg_notif_outbox_status_retry\` (\`status\`, \`next_retry_at\`),
        CONSTRAINT \`fk_reg_notif_outbox_user\` FOREIGN KEY (\`user_id\`)
          REFERENCES \`users\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('[MIGRATION] `registration_notification_outbox` table verified/created.');

    // 11. Ensure registration_payments.payment_status supports 'cancelled' and default gateway is 'ccavenue'
    await pool.query(`
      ALTER TABLE \`registration_payments\`
      MODIFY COLUMN \`payment_gateway\` VARCHAR(50) NOT NULL DEFAULT 'ccavenue',
      MODIFY COLUMN \`payment_status\` ENUM('pending', 'successful', 'failed', 'cancelled') NOT NULL DEFAULT 'pending'
    `);
    console.log('[MIGRATION] Verified `registration_payments.payment_status` and default `payment_gateway` = ccavenue.');

    // 12. Add CCAvenue / payment_hdfc_p transaction columns to registration_payments while preserving Razorpay history
    const ccavenueColumns = [
      ['request_type', "VARCHAR(50) NULL DEFAULT 'payment_initiation' AFTER `payment_type`"],
      ['tid', 'VARCHAR(100) NULL AFTER `request_type`'],
      ['merchant_id', 'VARCHAR(100) NULL AFTER `tid`'],
      ['currency', "VARCHAR(10) NOT NULL DEFAULT 'INR' AFTER `order_id`"],
      ['redirect_url', 'VARCHAR(500) NULL AFTER `currency`'],
      ['cancel_url', 'VARCHAR(500) NULL AFTER `redirect_url`'],
      ['language', "VARCHAR(10) NOT NULL DEFAULT 'EN' AFTER `cancel_url`"],
      ['amount', 'DECIMAL(12, 2) NULL AFTER `final_reg_fee`'],
      ['billing_name', 'VARCHAR(255) NULL AFTER `language`'],
      ['billing_email', 'VARCHAR(255) NULL AFTER `billing_name`'],
      ['courses', 'VARCHAR(255) NULL AFTER `billing_email`'],
      ['student_id', 'VARCHAR(50) NULL AFTER `student_profile_id`'],
      ['tracking_id', 'VARCHAR(100) NULL AFTER `transaction_id`'],
      ['bank_ref_no', 'VARCHAR(100) NULL AFTER `tracking_id`'],
      ['payment_mode', 'VARCHAR(100) NULL AFTER `bank_ref_no`'],
      ['gateway_response', 'TEXT NULL AFTER `raw_response`']
    ];

    for (const [colName, colDef] of ccavenueColumns) {
      const [existingCol] = await pool.query('SHOW COLUMNS FROM `registration_payments` LIKE ?', [colName]);
      if (existingCol.length === 0) {
        await pool.query(`ALTER TABLE \`registration_payments\` ADD COLUMN \`${colName}\` ${colDef}`);
        console.log(`[MIGRATION] Added \`${colName}\` column to \`registration_payments\`.`);
      }
    }

    const ccavenueIndexes = [
      ['uq_reg_payments_tid', 'UNIQUE INDEX `uq_reg_payments_tid` (`tid`)'],
      ['idx_reg_payments_tracking', 'INDEX `idx_reg_payments_tracking` (`tracking_id`)'],
      ['idx_reg_payments_gateway', 'INDEX `idx_reg_payments_gateway` (`payment_gateway`)'],
      ['idx_reg_payments_student_id', 'INDEX `idx_reg_payments_student_id` (`student_id`)']
    ];

    for (const [idxName, idxSql] of ccavenueIndexes) {
      const [existingIdx] = await pool.query('SHOW INDEX FROM `registration_payments` WHERE Key_name = ?', [idxName]);
      if (existingIdx.length === 0) {
        await pool.query(`ALTER TABLE \`registration_payments\` ADD ${idxSql}`);
        console.log(`[MIGRATION] Added index \`${idxName}\` on \`registration_payments\`.`);
      }
    }

    // Backfill `amount`, `student_id`, and `courses` on existing rows safely without touching historical Razorpay status/ids
    await pool.query(`
      UPDATE \`registration_payments\` rp
      LEFT JOIN \`student_profiles\` sp ON sp.user_id = rp.user_id
      LEFT JOIN \`courses\` c ON c.id = rp.course_id
      SET
        rp.amount = COALESCE(rp.amount, rp.final_reg_fee),
        rp.student_id = COALESCE(rp.student_id, sp.student_id),
        rp.courses = COALESCE(rp.courses, c.name)
    `);
    console.log('[MIGRATION] Backfilled CCAvenue metadata columns on existing `registration_payments` records.');

    console.log('\n[SUCCESS] All database migrations applied successfully!');
    process.exit(0);
  } catch (err) {
    console.error('[ERROR] Database migration failed:', err);
    process.exit(1);
  }
}

runMigration();
