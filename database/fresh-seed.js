import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import mysql from 'mysql2/promise';
import { env } from '../src/config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

async function runFreshSeed() {
  console.log('==============================================');
  console.log('  LIBA Server: Fresh Database Reset & Seeder');
  console.log('==============================================');

  let connection;
  try {
    // 1. Connect to MySQL with multipleStatements
    connection = await mysql.createConnection({
      host: env.db.host,
      port: env.db.port,
      user: env.db.user,
      password: env.db.password,
      multipleStatements: true
    });

    console.log('[INFO] Connected to MySQL server.');

    // 2. Read schema.sql
    const schemaPath = path.join(__dirname, 'schema.sql');
    if (!fs.existsSync(schemaPath)) {
      throw new Error(`schema.sql not found at ${schemaPath}`);
    }

    console.log('[INFO] Executing database/schema.sql to recreate database & tables...');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    await connection.query(schemaSql);
    console.log('[SUCCESS] Database schema recreated successfully.\n');

    await connection.end();

    // 3. Run safe migration
    console.log('[INFO] Running migrations (migrate.js)...');
    execSync('node database/migrate.js', { cwd: rootDir, stdio: 'inherit' });

    // 4. Run add-payment-type migration
    if (fs.existsSync(path.join(__dirname, 'add-payment-type-migration.js'))) {
      execSync('node database/add-payment-type-migration.js', { cwd: rootDir, stdio: 'inherit' });
    }

    // 5. Run database seeder
    console.log('\n[INFO] Running seed data insertion (seed.js)...');
    execSync('node database/seed.js', { cwd: rootDir, stdio: 'inherit' });

    console.log('\n==============================================');
    console.log('  Fresh Database Reset & Seed Completed! ');
    console.log('==============================================');
    process.exit(0);
  } catch (error) {
    console.error('\n[ERROR] Fresh seed failed:', error.message);
    if (connection) {
      try { await connection.end(); } catch (_) {}
    }
    process.exit(1);
  }
}

runFreshSeed();
