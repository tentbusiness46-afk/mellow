// Website enquiries: the contact form and the trade-partner application on
// the public Mellow website (/) land here and show up in /admin > Enquiries.
//
//   POST   /api/enquiries                     public, rate limited
//   GET    /api/enquiries/admin               list (?status=new|read|replied|archived|all, ?kind=contact|partner)
//   GET    /api/enquiries/admin/count         number of unread ("new") enquiries, for the sidebar badge
//   PATCH  /api/enquiries/admin/:id           { status }
//   DELETE /api/enquiries/admin/:id
//
// The table is created on first use, so no separate migration is needed.
// (The same CREATE TABLE is also in schema.sql for fresh databases.)
const express = require('express');
const rateLimit = require('express-rate-limit');
const { nanoid } = require('nanoid');
const db = require('../db/client');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

const STATUSES = ['new', 'read', 'replied', 'archived'];
const KINDS = ['contact', 'partner'];

let ready;
function ensureTable() {
  if (!ready) {
    ready = (async () => {
      await db.execute(`CREATE TABLE IF NOT EXISTS enquiries (
        id          TEXT PRIMARY KEY,
        kind        TEXT NOT NULL,
        name        TEXT NOT NULL,
        email       TEXT,
        phone       TEXT,
        topic       TEXT,
        business    TEXT,
        city        TEXT,
        message     TEXT,
        status      TEXT NOT NULL DEFAULT 'new',
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
      await db.execute(`CREATE INDEX IF NOT EXISTS idx_enquiries_status ON enquiries(status, created_at)`);
    })().catch(err => { ready = null; throw err; });
  }
  return ready;
}

const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const wrap = fn => (req, res) => fn(req, res).catch(err => {
  console.error('[enquiries]', err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

const submitLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many messages sent. Please try again in a few minutes.' },
});

// ---------- Public: submit ----------
router.post('/', submitLimiter, wrap(async (req, res) => {
  const b = req.body || {};
  if (b.website) return res.json({ ok: true }); // honeypot - bots fill hidden fields, people don't

  const kind = KINDS.includes(b.kind) ? b.kind : 'contact';
  const email = clean(b.email, 160);
  const phone = clean(b.phone, 40);
  const message = clean(b.message, 3000);

  let name, topic, business, city;
  if (kind === 'partner') {
    name = clean(b.name, 120);
    business = clean(b.business, 160);
    city = clean(b.city, 160);
    topic = clean(b.topic, 60); // Retailer | Distributor
    if (!name || !business || !phone || !email || !city || !topic) {
      return res.status(400).json({ error: 'Please fill in all the required fields.' });
    }
  } else {
    name = [clean(b.first, 60), clean(b.last, 60)].filter(Boolean).join(' ') || clean(b.name, 120);
    topic = clean(b.topic, 60); // Distributor/Wholesales | Retail Shops
    if (!name) return res.status(400).json({ error: 'Please tell us your name.' });
    if (!email && !phone) return res.status(400).json({ error: 'Please give us an email address or phone number so we can reply.' });
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'That email address does not look right.' });
  }

  await ensureTable();
  await db.execute({
    sql: `INSERT INTO enquiries (id, kind, name, email, phone, topic, business, city, message)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [nanoid(12), kind, name, email || null, phone || null, topic || null, business || null, city || null, message || null],
  });
  res.json({ ok: true });
}));

// ---------- Admin ----------
router.get('/admin/count', requireAdmin, wrap(async (req, res) => {
  await ensureTable();
  const r = await db.execute(`SELECT COUNT(*) AS n FROM enquiries WHERE status = 'new'`);
  res.json({ new: Number(r.rows[0].n) });
}));

router.get('/admin', requireAdmin, wrap(async (req, res) => {
  await ensureTable();
  const where = [], args = [];
  if (STATUSES.includes(req.query.status)) { where.push('status = ?'); args.push(req.query.status); }
  if (KINDS.includes(req.query.kind)) { where.push('kind = ?'); args.push(req.query.kind); }
  const r = await db.execute({
    sql: `SELECT id, kind, name, email, phone, topic, business, city, message, status, created_at
          FROM enquiries ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
          ORDER BY created_at DESC LIMIT 500`,
    args,
  });
  res.json({ enquiries: r.rows });
}));

router.patch('/admin/:id', requireAdmin, wrap(async (req, res) => {
  const status = req.body && req.body.status;
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  await ensureTable();
  const r = await db.execute({ sql: `UPDATE enquiries SET status = ? WHERE id = ?`, args: [status, req.params.id] });
  if (!r.rowsAffected) return res.status(404).json({ error: 'Enquiry not found.' });
  res.json({ ok: true });
}));

router.delete('/admin/:id', requireAdmin, wrap(async (req, res) => {
  await ensureTable();
  await db.execute({ sql: `DELETE FROM enquiries WHERE id = ?`, args: [req.params.id] });
  res.json({ ok: true });
}));

module.exports = router;
