import bcrypt from 'bcrypt';
import { query } from '../src/config/database.js';

const parseArg = (name) => {
  const prefix = `--${name}=`;
  const match = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : '';
};

const run = async () => {
  const email = (parseArg('email') || process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = parseArg('password') || process.env.ADMIN_PASSWORD || '';

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error('Error: Valid email is required via --email=<email> or ADMIN_EMAIL env var.');
    process.exit(1);
  }

  if (!password || password.length < 8) {
    console.error('Error: Password of at least 8 characters is required via --password=<password> or ADMIN_PASSWORD env var.');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const existing = await query('SELECT id, role FROM users WHERE email = ? LIMIT 1', [email]);

  if (existing.length > 0) {
    if (existing[0].role === 'student') {
      console.error(`Error: ${email} is already registered as a student account and cannot be converted.`);
      process.exit(1);
    }
    await query(
      "UPDATE users SET password_hash = ?, role = 'admin', is_active = 1, is_verified = 1, updated_at = NOW() WHERE id = ?",
      [passwordHash, existing[0].id]
    );
    console.log(`Updated existing admin user: ${email} (id=${existing[0].id})`);
  } else {
    const result = await query(
      "INSERT INTO users (email, password_hash, role, is_active, is_verified) VALUES (?, ?, 'admin', 1, 1)",
      [email, passwordHash]
    );
    console.log(`Created admin user: ${email} (id=${result.insertId})`);
  }

  process.exit(0);
};

run().catch((err) => {
  console.error('Failed to provision admin user:', err.message);
  process.exit(1);
});

