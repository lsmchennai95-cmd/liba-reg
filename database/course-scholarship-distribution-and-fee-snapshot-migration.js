import { getPool } from '../src/config/database.js';

export async function runPhase44Migration() {
  console.log('=====================================================');
  console.log('  LIBA Server: Phase 4.4 Schema Migration');
  console.log('  - Course Scholarship Distribution Table');
  console.log('  - Immutable Enrollment Fee Snapshot Fields');
  console.log('  - Scholarship Claim Calculation Snapshot Fields');
  console.log('=====================================================');

  const pool = getPool();

  try {
    // 1. Create course_scholarship_distributions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`course_scholarship_distributions\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`course_id\` BIGINT UNSIGNED NOT NULL,
        \`category\` VARCHAR(50) NOT NULL,
        \`amount\` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        \`is_active\` TINYINT(1) NOT NULL DEFAULT 1,
        \`eligibility_config\` JSON NULL DEFAULT NULL,
        \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_course_category\` (\`course_id\`, \`category\`),
        KEY \`idx_csd_course\` (\`course_id\`),
        CONSTRAINT \`fk_csd_course\` FOREIGN KEY (\`course_id\`)
          REFERENCES \`courses\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('[MIGRATION 4.4] Verified `course_scholarship_distributions` table.');

    // 2. Add original_total_fee and registration_fee to enrollments if missing
    const [enrollCols] = await pool.query('SHOW COLUMNS FROM `enrollments`');
    const enrollColNames = new Set(enrollCols.map(c => c.Field));

    if (!enrollColNames.has('original_total_fee')) {
      await pool.query(
        "ALTER TABLE `enrollments` ADD COLUMN `original_total_fee` DECIMAL(12, 2) NULL AFTER `total_fee`"
      );
      enrollColNames.add('original_total_fee');
      console.log('[MIGRATION 4.4] Added `original_total_fee` snapshot column to `enrollments`.');
    } else {
      console.log('[MIGRATION 4.4] `enrollments.original_total_fee` already exists.');
    }

    if (!enrollColNames.has('registration_fee')) {
      const afterClause = enrollColNames.has('original_total_fee') ? 'AFTER `original_total_fee`' : 'AFTER `total_fee`';
      await pool.query(
        `ALTER TABLE \`enrollments\` ADD COLUMN \`registration_fee\` DECIMAL(12, 2) NULL ${afterClause}`
      );
      enrollColNames.add('registration_fee');
      console.log('[MIGRATION 4.4] Added `registration_fee` snapshot column to `enrollments`.');
    } else {
      console.log('[MIGRATION 4.4] `enrollments.registration_fee` already exists.');
    }

    // Backfill historical enrollments safely without overwriting existing snapshots
    // a. Backfill registration_fee from successful registration payment if available
    await pool.query(`
      UPDATE \`enrollments\` e
      JOIN (
        SELECT user_id, final_reg_fee, original_reg_fee
        FROM \`registration_payments\`
        WHERE payment_status = 'successful'
        ORDER BY id DESC
      ) rp ON rp.user_id = e.user_id
      SET e.registration_fee = COALESCE(rp.final_reg_fee, rp.original_reg_fee)
      WHERE e.registration_fee IS NULL
    `);

    // b. Backfill remaining NULL registration_fee from course_fees
    await pool.query(`
      UPDATE \`enrollments\` e
      JOIN \`course_fees\` cf ON cf.course_id = e.course_id
      SET e.registration_fee = cf.registration_fee
      WHERE e.registration_fee IS NULL
    `);

    // c. Backfill remaining NULL original_total_fee from course_fees or total_fee
    await pool.query(`
      UPDATE \`enrollments\` e
      JOIN \`course_fees\` cf ON cf.course_id = e.course_id
      SET e.original_total_fee = COALESCE(cf.total_fee, e.total_fee)
      WHERE e.original_total_fee IS NULL
    `);
    console.log('[MIGRATION 4.4] Safely backfilled historical `enrollments` fee snapshots.');

    // 3. Add snapshot columns to scholarship_claims
    const [claimCols] = await pool.query('SHOW COLUMNS FROM `scholarship_claims`');
    const claimColNames = new Set(claimCols.map(c => c.Field));

    if (!claimColNames.has('max_scholarship')) {
      await pool.query(
        "ALTER TABLE `scholarship_claims` ADD COLUMN `max_scholarship` DECIMAL(12, 2) NULL AFTER `course_id`"
      );
      console.log('[MIGRATION 4.4] Added `max_scholarship` column to `scholarship_claims`.');
    }

    if (!claimColNames.has('calculation_snapshot')) {
      await pool.query(
        "ALTER TABLE `scholarship_claims` ADD COLUMN `calculation_snapshot` JSON NULL AFTER `total_discount`"
      );
      console.log('[MIGRATION 4.4] Added `calculation_snapshot` column to `scholarship_claims`.');
    }

    // 4. Seed default course_scholarship_distributions for all existing courses
    const [courses] = await pool.query('SELECT id, code, name, scholarship_amount, is_scholarship_active FROM `courses`');

    for (const c of courses) {
      const maxSch = parseFloat(c.scholarship_amount) || 0;
      const isExec = String(c.code).includes('EXEC') || String(c.code).includes('EDP') || String(c.name).toUpperCase().includes('EXECUTIVE');

      // Distribution templates based on course type
      let distRows = [];
      if (isExec || maxSch <= 0) {
        distRows = [
          ['twelfth', 0, 0, { min_percentage: 65, label: '12th Qualification' }],
          ['ug', 0, 0, { min_percentage: 65, label: 'Undergraduate Qualification' }],
          ['certification', 0, 0, { required: true, label: 'Additional Certification' }],
          ['counselor', 0, 0, { promo_required: true, label: 'Counselor Scholarship Code' }]
        ];
      } else if (String(c.code).includes('PGP')) {
        distRows = [
          ['twelfth', 5000, 1, { min_percentage: 65, label: '12th Qualification' }],
          ['ug', 5000, 1, { min_percentage: 65, label: 'Undergraduate Qualification' }],
          ['certification', 2500, 1, { required: true, label: 'Additional Certification' }],
          ['counselor', 2500, 1, { promo_required: true, label: 'Counselor Scholarship Code' }]
        ];
      } else {
        // PGDM or default (standard 40k or 50k allocation)
        if (maxSch >= 50000) {
          distRows = [
            ['twelfth', 15000, 1, { min_percentage: 65, label: '12th Qualification' }],
            ['ug', 15000, 1, { min_percentage: 65, label: 'Undergraduate Qualification' }],
            ['certification', 5000, 1, { required: true, label: 'Additional Certification' }],
            ['counselor', 15000, 1, { promo_required: true, label: 'Counselor Scholarship Code' }]
          ];
        } else {
          // 40,000 cap default
          distRows = [
            ['twelfth', 10000, 1, { min_percentage: 65, label: '12th Qualification' }],
            ['ug', 15000, 1, { min_percentage: 65, label: 'Undergraduate Qualification' }],
            ['certification', 5000, 1, { required: true, label: 'Additional Certification' }],
            ['counselor', 10000, 1, { promo_required: true, label: 'Counselor Scholarship Code' }]
          ];
        }
      }

      for (const [cat, amt, act, cfg] of distRows) {
        await pool.query(
          `INSERT INTO \`course_scholarship_distributions\` 
            (\`course_id\`, \`category\`, \`amount\`, \`is_active\`, \`eligibility_config\`, \`created_at\`, \`updated_at\`)
           VALUES (?, ?, ?, ?, ?, NOW(), NOW())
           ON DUPLICATE KEY UPDATE \`updated_at\` = \`updated_at\``,
          [c.id, cat, amt, act, JSON.stringify(cfg)]
        );
      }
    }
    console.log('[MIGRATION 4.4] Seeded course scholarship distributions for all courses.');
    console.log('\n[SUCCESS] Phase 4.4 Database migration completed successfully!');
    return true;
  } catch (err) {
    console.error('[ERROR] Phase 4.4 migration failed:', err);
    throw err;
  }
}

// Allow direct CLI execution
if (process.argv[1] && process.argv[1].includes('course-scholarship-distribution-and-fee-snapshot-migration.js')) {
  runPhase44Migration()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
