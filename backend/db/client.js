// This client works identically whether TURSO_DATABASE_URL points at:
//   - a local file, e.g. file:./backend/db/local.db   (local dev, no account needed)
//   - a remote Turso database, e.g. libsql://xxx.turso.io   (production)
// Same code, same queries, either way - only the .env value changes.
const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');
require('dotenv').config();

if (!process.env.TURSO_DATABASE_URL) {
  console.error('[db] TURSO_DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
}

// If using local file mode, make sure the containing folder exists -
// libSQL won't create it for you on a fresh clone.
if (process.env.TURSO_DATABASE_URL && process.env.TURSO_DATABASE_URL.startsWith('file:')) {
  const filePath = process.env.TURSO_DATABASE_URL.replace(/^file:/, '');
  const dir = path.dirname(path.resolve(process.cwd(), filePath));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

module.exports = db;
