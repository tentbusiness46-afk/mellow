// Per-code status for the QR Codes section of the admin panel:
//
//   GET /api/qr/admin/batches/:id/codes   codes in one batch (?status=all|scanned|unscanned, ?q=, ?limit=, ?offset=)
//   GET /api/qr/admin/codes/lookup?q=     find a code across every batch
//
// Mounted in server.js at /api/qr, above the older qr routes. Read-only.
const express = require('express');
const db = require('../db/client');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Codes only contain letters, digits and dashes, so anything else typed into
// the search box is dropped (this also keeps LIKE wildcards out of the query).
const cleanQuery = q => String(q || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 40);

const wrap = fn => (req, res) => fn(req, res).catch(err => {
  console.error('[codes]', err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

const SELECT = `
  SELECT c.code, c.value, c.is_used, c.used_at, c.used_by,
         u.full_name, u.shop_name, u.phone_number`;

// ---------- Codes in one batch ----------
router.get('/admin/batches/:id/codes', requireAdmin, wrap(async (req, res) => {
  const batchId = req.params.id;
  const status = ['scanned', 'unscanned'].includes(req.query.status) ? req.query.status : 'all';
  const q = cleanQuery(req.query.q);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  const batch = await db.execute({ sql: `SELECT * FROM qr_batches WHERE id = ?`, args: [batchId] });
  if (!batch.rows[0]) return res.status(404).json({ error: 'Batch not found.' });

  const totals = await db.execute({
    sql: `SELECT COUNT(*) AS total, COALESCE(SUM(is_used), 0) AS scanned FROM qr_codes WHERE batch_id = ?`,
    args: [batchId],
  });

  const where = ['c.batch_id = ?'], args = [batchId];
  if (status === 'scanned') where.push('c.is_used = 1');
  if (status === 'unscanned') where.push('c.is_used = 0');
  if (q) { where.push('c.code LIKE ?'); args.push('%' + q + '%'); }
  const whereSql = where.join(' AND ');

  const [count, rows] = await Promise.all([
    db.execute({ sql: `SELECT COUNT(*) AS n FROM qr_codes c WHERE ${whereSql}`, args }),
    db.execute({
      sql: `${SELECT} FROM qr_codes c LEFT JOIN users u ON u.id = c.used_by
            WHERE ${whereSql}
            ORDER BY ${status === 'scanned' ? 'c.used_at DESC' : 'c.rowid'}
            LIMIT ? OFFSET ?`,
      args: [...args, limit, offset],
    }),
  ]);

  const b = batch.rows[0];
  res.json({
    batch: { id: b.id, batch_number: b.batch_number || '', value: Number(b.value), quantity: Number(b.quantity), created_at: b.created_at },
    total: Number(totals.rows[0].total),
    scanned: Number(totals.rows[0].scanned),
    matches: Number(count.rows[0].n),
    codes: rows.rows,
  });
}));

// ---------- Find a code across all batches ----------
router.get('/admin/codes/lookup', requireAdmin, wrap(async (req, res) => {
  const q = cleanQuery(req.query.q);
  if (q.length < 3) return res.json({ codes: [], truncated: false });
  const rows = await db.execute({
    sql: `${SELECT}, b.batch_number, b.id AS batch_id
          FROM qr_codes c
          JOIN qr_batches b ON b.id = c.batch_id
          LEFT JOIN users u ON u.id = c.used_by
          WHERE c.code LIKE ?
          ORDER BY (c.code = ?) DESC, c.code
          LIMIT 31`,
    args: ['%' + q + '%', q],
  });
  res.json({ codes: rows.rows.slice(0, 30), truncated: rows.rows.length > 30 });
}));

module.exports = router;
