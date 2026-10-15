// Run once to create tables: node backend/db/init.js
// Safe to run again - every statement uses IF NOT EXISTS.
const fs = require('fs');
const path = require('path');
const db = require('./client');

// Takes out "-- comments" first, then splits on the semicolons that end a
// statement. Doing it in this order matters: a semicolon inside a comment
// (e.g. "phone_number; password is...") must not be treated as the end of one.
function splitStatements(sql) {
  const withoutComments = sql
    .split('\n')
    .map((line) => {
      const i = line.indexOf('--');
      return i === -1 ? line : line.slice(0, i);
    })
    .join('\n');
  return withoutComments
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function init() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const statements = splitStatements(schema);

  for (const statement of statements) {
    await db.execute(statement);
  }

  console.log(`[db] Ran ${statements.length} schema statements successfully.`);
  process.exit(0);
}

init().catch((err) => {
  console.error('[db] Failed to initialize schema:', err);
  process.exit(1);
});
