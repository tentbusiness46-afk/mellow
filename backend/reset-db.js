// Clears all test data from the MelloW database. Keeps the tables and the admin login.
// Put this in your backend folder and run:   node reset-db.js
// It asks you to confirm before deleting anything. Stop the server first.
require('dotenv').config();
const readline = require('readline');
const db = require('./db/client');

// Child tables first. Add or remove names here if your schema differs.
const TABLES_TO_CLEAR = ['redemption_requests', 'qr_codes', 'qr_batches', 'users', 'distributors'];

(async () => {
  const where = process.env.TURSO_DATABASE_URL || '(TURSO_DATABASE_URL is not set)';
  console.log('Database:', where);
  const existing = (await db.execute("SELECT name FROM sqlite_master WHERE type='table'")).rows.map((r) => r.name);

  for (const t of TABLES_TO_CLEAR) {
    if (!existing.includes(t)) continue;
    const n = (await db.execute(`SELECT COUNT(*) AS n FROM ${t}`)).rows[0].n;
    console.log(`  ${t}: ${n} rows`);
  }
  console.log('\nThese rows will be deleted. Admin accounts are kept.');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('Type RESET to continue: ', async (answer) => {
    rl.close();
    if (answer.trim() !== 'RESET') { console.log('Cancelled. Nothing was deleted.'); process.exit(0); }
    for (const t of TABLES_TO_CLEAR) {
      if (existing.includes(t)) await db.execute(`DELETE FROM ${t}`);
    }
    console.log('Done. Test data cleared.');
    process.exit(0);
  });
})().catch((e) => { console.error('Failed:', e.message); process.exit(1); });
