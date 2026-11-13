import { getPool } from '../config/database.js';

async function migrateScholarshipTimer() {
  console.log('========================================================');
  console.log('  Migration: Scholarship Timer System & Settings');
  console.log('========================================================');

  const pool = getPool();

  try {
    // 1. Ensure `registration_fee_paid` in `users`
    const [userCols] = await pool.query("SHOW COLUMNS FROM `users` LIKE 'registration_fee_paid'");
    if (userCols.length === 0) {
      await pool.query(
        "ALTER TABLE `users` ADD COLUMN `registration_fee_paid` TINYINT(1) NOT NULL DEFAULT 0 AFTER `is_verified`"
      );
      console.log('[MIGRATION] Added `registration_fee_paid` column to `users` table.');
    } else {
      console.log('[MIGRATION] `users.registration_fee_paid` column already exists.');
    }

    // 2. Create `system_settings` table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`system_settings\` (
        \`setting_key\` VARCHAR(50) NOT NULL,
        \`setting_value\` VARCHAR(255) NOT NULL,
        \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`setting_key\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('[MIGRATION] Verified `system_settings` table.');

    // Seed default scholarship_timer_hours = 2
    await pool.query(`
      INSERT INTO \`system_settings\` (\`setting_key\`, \`setting_value\`)
      VALUES ('scholarship_timer_hours', '2')
      ON DUPLICATE KEY UPDATE \`setting_value\` = COALESCE(\`setting_value\`, '2');
    `);
    console.log('[MIGRATION] Verified default setting `scholarship_timer_hours` = 2.');

    // 3. Create or update `scholarship_claims` table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`scholarship_claims\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`user_id\` BIGINT UNSIGNED NOT NULL,
        \`total_discount\` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        \`status\` ENUM('active', 'expired', 'locked_in', 'used') NOT NULL DEFAULT 'active',
        \`expires_at\` DATETIME NOT NULL,
        \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`idx_scholarship_claims_user_status\` (\`user_id\`, \`status\`),
        KEY \`idx_scholarship_claims_expires\` (\`expires_at\`),
        CONSTRAINT \`fk_scholarship_claims_user\` FOREIGN KEY (\`user_id\`)
          REFERENCES \`users\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('[MIGRATION] Verified `scholarship_claims` table.');

    console.log('\n[SUCCESS] Scholarship Timer migration completed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('[ERROR] Scholarship timer migration failed:', err);
    process.exit(1);
  }
}

migrateScholarshipTimer();

