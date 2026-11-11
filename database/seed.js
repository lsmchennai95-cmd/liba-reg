import bcrypt from 'bcrypt';
import { getPool } from '../src/config/database.js';
import { env } from '../src/config/env.js';

const initialCourses = [
  {
    id: 1,
    code: 'PGDM',
    name: 'PGDM (Online) AICTE Approved',
    description: 'Post Graduate Diploma in Management - 2-year premier online programme approved by AICTE.',
    is_active: 1
  },
  {
    id: 2,
    code: 'PGP',
    name: 'PGP (Online) AI, Healthcare',
    description: 'Post Graduate Programme in Artificial Intelligence and Healthcare domains.',
    is_active: 1
  },
  {
    id: 10,
    code: 'EXEC_DIP',
    name: 'Executive Diploma Programs',
    description: 'Executive Diploma Programmes for working professionals.',
    is_active: 1
  }
];

const initialSpecializations = [
  { id: 1, course_id: 1, code: 'MKT', name: 'Marketing Management', is_active: 1 },
  { id: 2, course_id: 1, code: 'FIN', name: 'Financial Management', is_active: 1 },
  { id: 3, course_id: 1, code: 'HRM', name: 'Human Resource Management', is_active: 1 },
  { id: 4, course_id: 1, code: 'BA', name: 'Business Analytics', is_active: 1 },
  { id: 5, course_id: 1, code: 'HCM', name: 'Healthcare Management', is_active: 1 },
  { id: 6, course_id: 1, code: 'SCM', name: 'Logistics and Supply Chain Management', is_active: 1 },
  { id: 7, course_id: 2, code: 'AI_DS', name: 'AI & Data Science', is_active: 1 },
  { id: 8, course_id: 2, code: 'HCM', name: 'Healthcare Management', is_active: 1 },
  { id: 9, course_id: 10, code: 'AI_FIN', name: 'AI-Enabled Investment Analysis and Portfolio Management', is_active: 1 },
  { id: 10, course_id: 10, code: 'GEN_AI', name: 'Generative Artificial Intelligence', is_active: 1 },
  { id: 11, course_id: 10, code: 'CORP_FIN', name: 'Corporate Finance with AI', is_active: 1 },
  { id: 12, course_id: 10, code: 'HRM_ED', name: 'Human Resource Management', is_active: 1 },
  { id: 13, course_id: 10, code: 'SCM_ED', name: 'Logistics and Supply Chain Management with AI', is_active: 1 },
  { id: 14, course_id: 10, code: 'MKT_ED', name: 'Marketing Management in AI Era', is_active: 1 },
  { id: 15, course_id: 10, code: 'ALGO_TRAD', name: 'Investment Management & Algorithmic Trading', is_active: 1 }
];

const initialCourseFees = [
  { id: 1, course_id: 1, total_fee: 350000.00, registration_fee: 3100.00, admission_fee: 50000.00, tuition_fee: 275000.00 },
  { id: 2, course_id: 2, total_fee: 111642.00, registration_fee: 2250.00, admission_fee: 35000.00, tuition_fee: 150000.00 },
  { id: 3, course_id: 10, total_fee: 128428.00, registration_fee: 2500.00, admission_fee: 20000.00, tuition_fee: 120000.00 }
];

async function seedDefaultAdmin(pool) {
  console.log('\n--- Seeding Default Admin Account ---');
  const email = env.seed.adminEmail;
  const password = env.seed.adminPassword;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length < 8) {
    console.log('  [SKIP] ADMIN_EMAIL / ADMIN_PASSWORD (min 8 chars) not configured in .env; skipping default admin seed.');
    return;
  }

  const [existing] = await pool.execute(
    'SELECT id, role FROM users WHERE email = ? LIMIT 1',
    [email]
  );

  if (existing.length > 0) {
    if (existing[0].role === 'admin') {
      console.log(`  [EXISTING] Admin account already exists: ${email} (id=${existing[0].id})`);
    } else {
      console.log(`  [SKIP] ${email} already exists as a ${existing[0].role} account.`);
    }
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const [result] = await pool.execute(
    "INSERT INTO users (email, password_hash, role, is_active, is_verified) VALUES (?, ?, 'admin', 1, 1)",
    [email, passwordHash]
  );
  console.log(`  [INSERTED] Default admin created: ${email} (id=${result.insertId})`);
}

async function seedDefaultMailRecipients(pool) {
  console.log('\n--- Seeding Default Notification Recipients ---');
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

  const recipients = env.seed.notificationRecipients || [];
  if (recipients.length === 0) {
    console.log('  [SKIP] NOTIFICATION_RECIPIENTS not configured in .env; skipping default mail recipients seed.');
    return;
  }

  const [countRows] = await pool.query(
    'SELECT COUNT(*) AS total FROM registration_notification_recipients'
  );
  const existingCount = Number(countRows[0]?.total || 0);

  if (existingCount > 0) {
    console.log(`  [EXISTING] Found ${existingCount} configured recipient(s) in DB; preserving existing records.`);
    return;
  }

  for (const rec of recipients) {
    await pool.execute(
      'INSERT IGNORE INTO registration_notification_recipients (recipient_name, email, is_active) VALUES (?, ?, 1)',
      [rec.recipientName, rec.email]
    );
    console.log(`  [INSERTED] Recipient: ${rec.recipientName} <${rec.email}>`);
  }
}

async function seedDatabase() {
  const onlyArg = process.argv.slice(2).find((arg) => arg.startsWith('--only='));
  const onlyMode = onlyArg ? onlyArg.slice('--only='.length).trim().toLowerCase() : '';

  console.log('==============================================');
  console.log('  LIBA Server: Database Seeder');
  console.log('==============================================');

  const pool = getPool();

  try {
    // 1. Verify MySQL connection
    const [ping] = await pool.query('SELECT 1 as is_connected');
    if (!ping || !ping[0].is_connected) {
      throw new Error('Could not establish MySQL connection');
    }
    console.log('[INFO] MySQL connection established successfully.');

    if (onlyMode === 'admin') {
      await seedDefaultAdmin(pool);
      return;
    }

    if (onlyMode === 'mail') {
      await seedDefaultMailRecipients(pool);
      return;
    }

    // 2. Seed Courses
    console.log('--- Seeding Courses ---');
    for (const course of initialCourses) {
      const [existing] = await pool.execute(
        'SELECT id, name FROM courses WHERE id = ? OR code = ? LIMIT 1',
        [course.id, course.code]
      );

      if (existing.length > 0) {
        await pool.execute(
          `UPDATE courses 
           SET name = ?, description = ?, is_active = ? 
           WHERE id = ?`,
          [course.name, course.description, course.is_active, course.id]
        );
        console.log(`  [EXISTING] Course ID ${course.id}: ${course.name} (${course.code})`);
      } else {
        await pool.execute(
          `INSERT INTO courses (id, code, name, description, is_active)
           VALUES (?, ?, ?, ?, ?)`,
          [course.id, course.code, course.name, course.description, course.is_active]
        );
        console.log(`  [INSERTED] Course ID ${course.id}: ${course.name} (${course.code})`);
      }
    }

    // 3. Seed Specializations
    console.log('\n--- Seeding Specializations ---');
    for (const spec of initialSpecializations) {
      const [existing] = await pool.execute(
        'SELECT id, name FROM specializations WHERE id = ? LIMIT 1',
        [spec.id]
      );

      if (existing.length > 0) {
        await pool.execute(
          `UPDATE specializations 
           SET course_id = ?, code = ?, name = ?, is_active = ? 
           WHERE id = ?`,
          [spec.course_id, spec.code, spec.name, spec.is_active, spec.id]
        );
        console.log(`  [EXISTING] Specialization ID ${spec.id} (Course ${spec.course_id}): ${spec.name} [${spec.code}]`);
      } else {
        await pool.execute(
          `INSERT INTO specializations (id, course_id, code, name, is_active)
           VALUES (?, ?, ?, ?, ?)`,
          [spec.id, spec.course_id, spec.code, spec.name, spec.is_active]
        );
        console.log(`  [INSERTED] Specialization ID ${spec.id} (Course ${spec.course_id}): ${spec.name} [${spec.code}]`);
      }
    }

    // 4. Seed Course Fees
    console.log('\n--- Seeding Course Fees ---');
    for (const fee of initialCourseFees) {
      const [existing] = await pool.execute(
        'SELECT id FROM course_fees WHERE id = ? OR course_id = ? LIMIT 1',
        [fee.id, fee.course_id]
      );

      if (existing.length > 0) {
        await pool.execute(
          `UPDATE course_fees 
           SET total_fee = ?, registration_fee = ?, admission_fee = ?, tuition_fee = ? 
           WHERE id = ?`,
          [fee.total_fee, fee.registration_fee, fee.admission_fee, fee.tuition_fee, fee.id]
        );
        console.log(`  [EXISTING] Fee Config ID ${fee.id} for Course ${fee.course_id}: ₹${fee.total_fee}`);
      } else {
        await pool.execute(
          `INSERT INTO course_fees (id, course_id, total_fee, registration_fee, admission_fee, tuition_fee)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [fee.id, fee.course_id, fee.total_fee, fee.registration_fee, fee.admission_fee, fee.tuition_fee]
        );
        console.log(`  [INSERTED] Fee Config ID ${fee.id} for Course ${fee.course_id}: ₹${fee.total_fee}`);
      }
    }

    // 5. Create & Seed Counselor Scholarship Codes
    console.log('\n--- Seeding Counselor Scholarship Codes ---');
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

    // Ensure enrollment columns exist
    const [enrollCols] = await pool.query("SHOW COLUMNS FROM `enrollments` LIKE 'scholarship_amount'");
    if (enrollCols.length === 0) {
      await pool.query(
        "ALTER TABLE `enrollments` ADD COLUMN `scholarship_code` VARCHAR(20) NULL AFTER `outstanding_balance`, ADD COLUMN `scholarship_amount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00 AFTER `scholarship_code`, ADD COLUMN `original_total_fee` DECIMAL(12, 2) NULL AFTER `scholarship_amount`"
      );
    }

    const scholarshipList = [
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

    for (const [code, amount] of scholarshipList) {
      await pool.query(
        'INSERT INTO `scholarship_codes` (`code`, `amount`, `description`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `amount` = VALUES(`amount`), `description` = VALUES(`description`)',
        [code, amount, 'Counselor Scholarship Grant']
      );
    }
    console.log(`  [OK] Seeded ${scholarshipList.length} Counselor Scholarship Codes (₹1,000 - ₹50,000)`);

    // 6. Seed Default Admin & Notification Recipients (from .env)
    await seedDefaultAdmin(pool);
    await seedDefaultMailRecipients(pool);

    // 7. Verification: Count and display current records in MySQL
    console.log('\n--- Verifying Database Records ---');
    const [courses] = await pool.query('SELECT id, code, name FROM courses ORDER BY id ASC');
    console.log(`Total Courses in DB: ${courses.length}`);
    courses.forEach((c) => console.log(`  • [${c.id}] ${c.code} - ${c.name}`));

    const [specializations] = await pool.query(
      `SELECT s.id, s.code, s.name, c.code AS course_code 
       FROM specializations s 
       JOIN courses c ON c.id = s.course_id 
       ORDER BY s.id ASC`
    );
    console.log(`\nTotal Specializations in DB: ${specializations.length}`);
    specializations.forEach((s) => console.log(`  • [${s.id}] ${s.name} (${s.code}) -> Course: ${s.course_code}`));

    console.log('\n==============================================');
    console.log('  Database seeding completed successfully!');
    console.log('==============================================');
  } catch (error) {
    console.error('\n[ERROR] Database seeding failed:', error.message);
    process.exitCode = 1;
  } finally {
    // 6. Close the MySQL connection pool
    await pool.end();
    console.log('[INFO] MySQL connection pool closed.');
  }
}

seedDatabase();
