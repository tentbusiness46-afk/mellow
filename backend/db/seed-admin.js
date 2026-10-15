// Creates (or updates the password of) the single admin account from .env
// Run with: npm run seed-admin
const bcrypt = require('bcryptjs');
const { nanoid } = require('nanoid');
const db = require('./client');
require('dotenv').config();

async function seed() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.error('[seed-admin] Set ADMIN_EMAIL and ADMIN_PASSWORD in .env first.');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const existing = await db.execute({
    sql: 'SELECT id FROM admins WHERE email = ?',
    args: [email],
  });

  if (existing.rows.length > 0) {
    await db.execute({
      sql: 'UPDATE admins SET password_hash = ? WHERE email = ?',
      args: [passwordHash, email],
    });
    console.log(`[seed-admin] Updated password for existing admin: ${email}`);
  } else {
    await db.execute({
      sql: 'INSERT INTO admins (id, email, password_hash) VALUES (?, ?, ?)',
      args: [nanoid(), email, passwordHash],
    });
    console.log(`[seed-admin] Created admin account: ${email}`);
  }

  process.exit(0);
}

seed().catch((err) => {
  console.error('[seed-admin] Failed:', err);
  process.exit(1);
});
