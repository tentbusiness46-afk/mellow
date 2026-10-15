// Coupon support for the QR Codes section of the admin panel:
//
//   POST /api/qr/admin/generate                  - create a batch (up to 20,000 codes)
//   POST /api/qr/admin/batches/:id/coupons-link  - get a short-lived download link
//   GET  /api/qr/admin/batches/:id/coupons.zip   - ZIP of printable coupon images
//   POST /api/qr/scan                            - lockout for people guessing codes
//
// This router is mounted BEFORE routes/qr.js in server.js (see the notes that
// came with it). Because it is first, the generate handler here is the one
// that runs, and the older one in qr.js is simply never reached. The scan
// route below only does its checking and then hands the request on to the
// normal scan handler in qr.js. The XLSX export is untouched.

const { once } = require('events');
const { Readable } = require('stream');
const express = require('express');
const jwt = require('jsonwebtoken');
const archiverLib = require('archiver');
// archiver 7 exports a function; archiver 8 exports classes instead. Both work.
function createZip(options) {
  return typeof archiverLib === 'function' ? archiverLib('zip', options) : new archiverLib.ZipArchive(options);
}
const { nanoid } = require('nanoid');
const db = require('../db/client');
const { requireAdmin, requireUser } = require('../middleware/auth');
const {
  MAX_QUANTITY, MAX_BATCH_NUMBER_LENGTH, ALLOWED_VALUES, COUPON_TEMPLATES,
} = require('../config/coupons');
const { generateCouponCode } = require('../utils/coupon-code');
const { createCouponRenderer, unsupportedCharacters } = require('../utils/coupon-renderer');

const router = express.Router();

const naira = (n) => '₦' + Number(n).toLocaleString('en-NG');

function listOfAmounts() {
  const parts = ALLOWED_VALUES.map(naira);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} or ${parts[parts.length - 1]}` : parts[0];
}

// ---------- Generate a batch ----------
const INSERT_CHUNK = 500;

router.post('/admin/generate', requireAdmin, async (req, res) => {
  const batchNumber = String(req.body.batch_number ?? '').trim();
  const value = parseInt(req.body.value, 10);
  const quantity = parseInt(req.body.quantity, 10);

  if (!batchNumber) {
    return res.status(400).json({ error: 'Please enter a batch number.', field: 'batchNumber' });
  }
  if (batchNumber.length > MAX_BATCH_NUMBER_LENGTH) {
    return res.status(400).json({ error: `The batch number can be at most ${MAX_BATCH_NUMBER_LENGTH} characters.`, field: 'batchNumber' });
  }
  const unprintable = unsupportedCharacters(batchNumber);
  if (unprintable.length) {
    return res.status(400).json({
      error: `The batch number has a character that can’t be printed on the coupon: ${unprintable.join(' ')}`,
      field: 'batchNumber',
    });
  }
  if (!ALLOWED_VALUES.includes(value)) {
    return res.status(400).json({ error: `Please choose ${listOfAmounts()}.`, field: 'value' });
  }
  if (!quantity || quantity < 1 || quantity > MAX_QUANTITY) {
    return res.status(400).json({ error: `Please enter a quantity between 1 and ${MAX_QUANTITY.toLocaleString('en-NG')}.`, field: 'quantity' });
  }

  const batchId = nanoid();
  try {
    await db.execute({
      sql: 'INSERT INTO qr_batches (id, batch_number, value, quantity) VALUES (?, ?, ?, ?)',
      args: [batchId, batchNumber, value, quantity],
    });

    // Codes are unique across the whole database (the column is UNIQUE), not
    // just within this batch. Insert in chunks; a code that happens to already
    // exist is skipped (INSERT OR IGNORE) and replaced with a fresh one on the
    // next pass, so the batch always ends up with exactly `quantity` codes.
    let inserted = 0;
    let passes = 0;
    const maxPasses = Math.ceil(quantity / INSERT_CHUNK) + 50;
    while (inserted < quantity) {
      if (++passes > maxPasses) throw new Error('Could not find enough unused codes.');
      const want = Math.min(quantity - inserted, INSERT_CHUNK);
      const fresh = new Set();
      while (fresh.size < want) fresh.add(generateCouponCode());

      const results = await db.batch(
        [...fresh].map((code) => ({
          sql: 'INSERT OR IGNORE INTO qr_codes (id, code, value, batch_id) VALUES (?, ?, ?, ?)',
          args: [nanoid(), code, value, batchId],
        })),
        'write',
      );
      inserted += results.reduce((n, r) => n + r.rowsAffected, 0);
    }

    res.json({ message: `Generated ${quantity.toLocaleString('en-NG')} codes worth ${naira(value)} each.`, batch_id: batchId });
  } catch (err) {
    console.error('[qr/admin/generate]', err);
    // Don't leave a half-filled batch behind.
    try {
      await db.execute({ sql: 'DELETE FROM qr_codes WHERE batch_id = ?', args: [batchId] });
      await db.execute({ sql: 'DELETE FROM qr_batches WHERE id = ?', args: [batchId] });
    } catch (cleanupErr) {
      console.error('[qr/admin/generate cleanup]', cleanupErr);
    }
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ---------- Coupon images (ZIP) ----------
// A batch of 10,000 coupons is a few GB, far too big to build in memory and
// hand to the browser as one blob. So the ZIP is streamed straight to the
// browser's own download manager. A download started by a link can't send the
// admin's login header, so the admin panel first asks for a link that carries
// a short-lived, single-purpose token instead.
const MAX_CONCURRENT_EXPORTS = 1; // rendering is CPU-heavy
const RENDER_AHEAD = 3; // coupons rendered in parallel, ahead of the one being written
let activeExports = 0;

async function loadExportableBatch(batchId) {
  const result = await db.execute({ sql: 'SELECT * FROM qr_batches WHERE id = ?', args: [batchId] });
  const batch = result.rows[0];
  if (!batch) return { status: 404, error: 'Batch not found.' };
  if (!COUPON_TEMPLATES[batch.value]) {
    return { status: 400, error: `There is no coupon design for ${naira(batch.value)}, so images can’t be made for this batch. Use Export XLSX instead.` };
  }
  return { batch };
}

router.post('/admin/batches/:id/coupons-link', requireAdmin, async (req, res) => {
  try {
    const { batch, status, error } = await loadExportableBatch(req.params.id);
    if (error) return res.status(status).json({ error });
    if (activeExports >= MAX_CONCURRENT_EXPORTS) {
      return res.status(429).json({ error: 'Another coupon download is still being prepared. Please wait for it to finish.' });
    }
    const token = jwt.sign({ purpose: 'coupons-zip', batch: batch.id }, process.env.JWT_SECRET, { expiresIn: '2m' });
    res.json({ url: `/api/qr/admin/batches/${encodeURIComponent(batch.id)}/coupons.zip?t=${token}` });
  } catch (err) {
    console.error('[qr/coupons-link]', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Renders items a few at a time ahead of where the ZIP is being written, but
// hands them back strictly in order and never runs further ahead than
// `ahead`, so memory stays flat no matter how many coupons there are.
function renderAhead(items, render, ahead) {
  const pending = new Map();
  let started = 0;
  return async function get(i) {
    while (started < items.length && started < i + ahead) {
      const n = started++;
      const p = render(items[n]);
      p.catch(() => {}); // a failure is reported where it is awaited, below
      pending.set(n, p);
    }
    const result = await pending.get(i);
    pending.delete(i);
    return result;
  };
}

const safeName = (s) => String(s).replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'batch';

router.get('/admin/batches/:id/coupons.zip', async (req, res) => {
  let claims;
  try {
    claims = jwt.verify(String(req.query.t || ''), process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'This download link has expired. Please click Download ZIP again.' });
  }
  if (claims.purpose !== 'coupons-zip' || claims.batch !== req.params.id) {
    return res.status(401).json({ error: 'This download link is not valid. Please click Download ZIP again.' });
  }

  if (activeExports >= MAX_CONCURRENT_EXPORTS) {
    return res.status(429).json({ error: 'Another coupon download is still being prepared. Please wait for it to finish.' });
  }
  activeExports++; // taken before the first await so two requests can't both slip in
  let released = false;
  const release = () => { if (!released) { released = true; activeExports--; } };

  try {
    const { batch, status, error } = await loadExportableBatch(req.params.id);
    if (error) { release(); return res.status(status).json({ error }); }

    const codes = (await db.execute({
      sql: 'SELECT code FROM qr_codes WHERE batch_id = ? ORDER BY rowid',
      args: [batch.id],
    })).rows.map((r) => r.code);
    const renderer = await createCouponRenderer({ value: batch.value, batchNumber: batch.batch_number });

    const base = `mellow-coupons-${safeName(batch.batch_number)}-${batch.value}naira`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.zip"`);
    res.setHeader('Cache-Control', 'no-store');

    // Images are already compressed, so entries are stored as-is (fast). A ZIP
    // under 4 GB is a plain, universally readable ZIP; past that, archiver
    // switches to ZIP64 by itself (checked with a 4.4 GB test archive).
    const archive = createZip({ store: true });
    archive.pipe(res);

    let aborted = false;
    let wake;
    const abortedSignal = new Promise((resolve) => { wake = resolve; });
    res.on('close', () => {
      if (!res.writableFinished) { aborted = true; archive.abort(); wake(); } // browser cancelled
      release();
    });
    archive.on('warning', (err) => console.warn('[qr/coupons.zip]', err));

    const next = renderAhead(codes, (code) => (aborted ? null : renderer.render(code)), RENDER_AHEAD);
    const digits = String(codes.length).length;

    for (let i = 0; i < codes.length && !aborted; i++) {
      const image = await next(i);
      if (aborted) break;
      // Appended as a stream, not a Buffer: archiver reports a Buffer as "done"
      // the moment it is queued, whereas a stream only finishes once its data
      // has actually moved on towards the browser. That is what makes this loop
      // wait for a slow connection instead of piling thousands of images up in
      // memory.
      const written = once(archive, 'entry'); // set up first so the event can't be missed
      archive.append(Readable.from(image), { name: `${base}/${String(i + 1).padStart(digits, '0')}_${codes[i]}.${renderer.extension}` });
      await Promise.race([written, abortedSignal]);
    }
    if (!aborted) await archive.finalize();
  } catch (err) {
    console.error('[qr/coupons.zip]', err);
    release();
    if (!res.headersSent) res.status(500).json({ error: 'Something went wrong preparing the coupons.' });
    else res.destroy(err); // download already started: fail it rather than hand over a half-empty ZIP
  }
});

// ---------- Scan lockout ----------
// Codes are short enough that someone could try to guess valid ones, so after
// 10 different unrecognised codes in 15 minutes an account is paused for the
// rest of that window. The same wrong code twice counts once, because the
// scanner re-submits whatever is in front of the camera, and a person
// pointing it at some other QR shouldn't get locked out by that.
// Kept in memory: resets when the server restarts, which is fine for this.
const GUESS_WINDOW_MS = 15 * 60 * 1000;
const MAX_WRONG_CODES = 10;
const wrongCodes = new Map(); // userId -> Map(code -> time first seen)

function recentWrongCodes(userId, now) {
  const seen = wrongCodes.get(userId);
  if (!seen) return null;
  for (const [code, at] of seen) if (now - at > GUESS_WINDOW_MS) seen.delete(code);
  if (seen.size === 0) { wrongCodes.delete(userId); return null; }
  return seen;
}

setInterval(() => {
  const now = Date.now();
  for (const userId of [...wrongCodes.keys()]) recentWrongCodes(userId, now);
}, 10 * 60 * 1000).unref();

router.post('/scan', requireUser, (req, res, next) => {
  const now = Date.now();
  const seen = recentWrongCodes(req.userId, now);
  if (seen && seen.size >= MAX_WRONG_CODES) {
    const oldest = Math.min(...seen.values());
    const minutes = Math.max(1, Math.ceil((oldest + GUESS_WINDOW_MS - now) / 60000));
    return res.status(429).json({ error: `Too many unrecognised codes. Please try again in ${minutes} minute${minutes === 1 ? '' : 's'}.` });
  }

  const code = String(req.body?.code ?? '').trim().toUpperCase();
  res.on('finish', () => {
    if (res.statusCode !== 404 || !code) return; // 404 = "This code is not recognized."
    const t = Date.now();
    const current = recentWrongCodes(req.userId, t) || new Map();
    if (!current.has(code)) current.set(code, t);
    wrongCodes.set(req.userId, current);
  });
  next(); // on to the normal scan handler in qr.js
});

module.exports = router;
