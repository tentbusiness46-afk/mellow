const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const { nanoid } = require('nanoid');
const db = require('../db/client');
const { requireAdmin } = require('../middleware/auth');
const { getFileUrl, saveFile, readLocalFile, STORAGE_MODE } = require('../utils/storage');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

// ---------- Dashboard overview ----------
router.get('/stats', requireAdmin, async (req, res) => {
  const [pendingRegs, pendingRedemptions, totalUsers, unusedCodes, totalDistributors] = await Promise.all([
    db.execute(`SELECT COUNT(*) as n FROM users WHERE status = 'pending'`),
    db.execute(`SELECT COUNT(*) as n, COALESCE(SUM(amount), 0) as total FROM redemption_requests WHERE status = 'pending'`),
    db.execute(`SELECT COUNT(*) as n FROM users WHERE status = 'approved'`),
    db.execute(`SELECT COUNT(*) as n, COALESCE(SUM(value), 0) as total FROM qr_codes WHERE is_used = 0`),
    db.execute(`SELECT COUNT(*) as n FROM distributors`),
  ]);

  res.json({
    pending_registrations: Number(pendingRegs.rows[0].n),
    pending_redemptions: Number(pendingRedemptions.rows[0].n),
    pending_redemptions_value: Number(pendingRedemptions.rows[0].total),
    total_users: Number(totalUsers.rows[0].n),
    unused_codes: Number(unusedCodes.rows[0].n),
    unused_codes_value: Number(unusedCodes.rows[0].total),
    total_distributors: Number(totalDistributors.rows[0].n),
  });
});

// ---------- Registrations ----------
router.get('/registrations', requireAdmin, async (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
  const result = await db.execute({
    sql: `SELECT id, full_name, phone_number, shop_name, shop_state, shop_city, shop_address, retailer_type,
          stocking_mellow, stocking_since, referral_source, email, status, rejection_reason, created_at
          FROM users WHERE status = ? ORDER BY created_at DESC`,
    args: [status],
  });
  res.json({ registrations: result.rows });
});

router.post('/registrations/:id/approve', requireAdmin, async (req, res) => {
  const result = await db.execute({
    sql: `UPDATE users SET status = 'approved', rejection_reason = NULL WHERE id = ? AND status = 'pending'`,
    args: [req.params.id],
  });
  if (result.rowsAffected !== 1) return res.status(404).json({ error: 'Registration not found or already reviewed.' });
  res.json({ message: 'Registration approved. The retailer can now log in.' });
});

router.post('/registrations/:id/reject', requireAdmin, async (req, res) => {
  const { reason } = req.body;
  if (!reason || !reason.trim()) return res.status(400).json({ error: 'Please provide a rejection reason.', field: 'reason' });

  const result = await db.execute({
    sql: `UPDATE users SET status = 'rejected', rejection_reason = ? WHERE id = ? AND status = 'pending'`,
    args: [reason.trim(), req.params.id],
  });
  if (result.rowsAffected !== 1) return res.status(404).json({ error: 'Registration not found or already reviewed.' });
  res.json({ message: 'Registration rejected.' });
});

// ---------- Users ----------
router.get('/users', requireAdmin, async (req, res) => {
  const search = `%${(req.query.search || '').trim()}%`;
  const result = await db.execute({
    sql: `SELECT id, full_name, shop_name, phone_number, email, balance, tier2_submitted_at, created_at
          FROM users WHERE status = 'approved' AND (full_name LIKE ? OR shop_name LIKE ? OR email LIKE ?)
          ORDER BY created_at DESC`,
    args: [search, search, search],
  });
  res.json({ users: result.rows });
});

router.get('/users/:id', requireAdmin, async (req, res) => {
  const result = await db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [req.params.id] });
  const user = result.rows[0];
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const { password_hash, ...safeUser } = user;
  safeUser.id_document_url = user.id_document_path ? await getFileUrl(user.id_document_path) : null;
  safeUser.shop_photo_url = user.shop_photo_path ? await getFileUrl(user.shop_photo_path) : null;

  res.json({ user: safeUser });
});

// Combined profile + scan history + redemption history, for the admin.html
// User Detail view (opened by clicking a retailer in the Users list).
router.get('/users/:id/full', requireAdmin, async (req, res) => {
  const userResult = await db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [req.params.id] });
  const user = userResult.rows[0];
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const { password_hash, ...safeUser } = user;
  safeUser.id_document_url = user.id_document_path ? await getFileUrl(user.id_document_path) : null;
  safeUser.shop_photo_url = user.shop_photo_path ? await getFileUrl(user.shop_photo_path) : null;

  const [scansResult, redemptionsResult] = await Promise.all([
    db.execute({
      sql: 'SELECT code, value, used_at FROM qr_codes WHERE used_by = ? ORDER BY used_at DESC LIMIT 100',
      args: [req.params.id],
    }),
    db.execute({
      sql: `SELECT id, amount, status, rejection_reason, created_at, resolved_at
            FROM redemption_requests WHERE user_id = ? ORDER BY created_at DESC`,
      args: [req.params.id],
    }),
  ]);

  res.json({ user: safeUser, scans: scansResult.rows, redemptions: redemptionsResult.rows });
});

// Admin explicitly confirms the submitted ID/bank details are legitimate.
// Deliberately separate from tier2_submitted_at (set automatically when the
// customer submits) - this is the actual human review step.
router.post('/users/:id/verify', requireAdmin, async (req, res) => {
  const userResult = await db.execute({ sql: 'SELECT tier2_submitted_at FROM users WHERE id = ?', args: [req.params.id] });
  const user = userResult.rows[0];
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (!user.tier2_submitted_at) {
    return res.status(400).json({ error: 'This retailer hasn\u2019t submitted verification documents yet.' });
  }

  await db.execute({
    sql: `UPDATE users SET tier2_verified_at = datetime('now') WHERE id = ?`,
    args: [req.params.id],
  });
  res.json({ message: 'Marked as verified.' });
});

// Undo, in case it was confirmed by mistake.
router.post('/users/:id/unverify', requireAdmin, async (req, res) => {
  const result = await db.execute({
    sql: 'UPDATE users SET tier2_verified_at = NULL WHERE id = ?',
    args: [req.params.id],
  });
  if (result.rowsAffected !== 1) return res.status(404).json({ error: 'User not found.' });
  res.json({ message: 'Verification removed.' });
});

// ---------- Redemption requests ----------
router.get('/redemptions', requireAdmin, async (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
  const result = await db.execute({
    sql: `SELECT r.id, r.amount, r.status, r.rejection_reason, r.created_at, r.resolved_at,
                 u.id as user_id, u.full_name, u.shop_name, u.phone_number, u.balance,
                 u.bank_name, u.account_number, u.account_name
          FROM redemption_requests r JOIN users u ON u.id = r.user_id
          WHERE r.status = ? ORDER BY r.created_at ASC`,
    args: [status],
  });
  res.json({ redemptions: result.rows });
});

router.post('/redemptions/:id/approve', requireAdmin, async (req, res) => {
  const reqResult = await db.execute({ sql: 'SELECT * FROM redemption_requests WHERE id = ?', args: [req.params.id] });
  const redemption = reqResult.rows[0];
  if (!redemption || redemption.status !== 'pending') {
    return res.status(404).json({ error: 'Request not found or already reviewed.' });
  }

  const userResult = await db.execute({ sql: 'SELECT balance FROM users WHERE id = ?', args: [redemption.user_id] });
  if (Number(userResult.rows[0]?.balance ?? 0) < redemption.amount) {
    return res.status(400).json({ error: "Retailer's balance is lower than the requested amount." });
  }

  await db.execute({
    sql: 'UPDATE users SET balance = balance - ? WHERE id = ?',
    args: [redemption.amount, redemption.user_id],
  });
  await db.execute({
    sql: `UPDATE redemption_requests SET status = 'approved', resolved_at = datetime('now') WHERE id = ?`,
    args: [req.params.id],
  });

  res.json({ message: 'Marked as paid and balance deducted.' });
});

router.post('/redemptions/:id/reject', requireAdmin, async (req, res) => {
  const { reason } = req.body;
  if (!reason || !reason.trim()) return res.status(400).json({ error: 'Please provide a rejection reason.', field: 'reason' });

  const result = await db.execute({
    sql: `UPDATE redemption_requests SET status = 'rejected', rejection_reason = ?, resolved_at = datetime('now')
          WHERE id = ? AND status = 'pending'`,
    args: [reason.trim(), req.params.id],
  });
  if (result.rowsAffected !== 1) return res.status(404).json({ error: 'Request not found or already reviewed.' });
  res.json({ message: 'Redemption request rejected.' });
});

// ---------- Distributors ----------
// Added manually by admin - no self-registration. Login is by phone number;
// password is generated here (first 4 letters of name + last 4 digits of
// phone) and returned once in the response for the admin to hand off, since
// only the bcrypt hash is ever stored after that.
function generateDistributorPassword(fullName, phoneNumber) {
  const namePart = fullName.replace(/[^a-zA-Z]/g, '').slice(0, 4).toLowerCase();
  const digits = phoneNumber.replace(/\D/g, '');
  const phonePart = digits.slice(-4);
  return namePart + phonePart;
}

router.get('/distributors', requireAdmin, async (req, res) => {
  const result = await db.execute(`
    SELECT d.id, d.full_name, d.phone_number, d.place, d.associated_since, d.created_at,
           COUNT(u.id) as referred_count
    FROM distributors d
    LEFT JOIN users u ON u.referral_distributor_id = d.id AND u.status = 'approved'
    GROUP BY d.id
    ORDER BY d.created_at DESC
  `);
  res.json({ distributors: result.rows });
});

router.get('/distributors/:id', requireAdmin, async (req, res) => {
  const result = await db.execute({ sql: 'SELECT * FROM distributors WHERE id = ?', args: [req.params.id] });
  const distributor = result.rows[0];
  if (!distributor) return res.status(404).json({ error: 'Distributor not found.' });

  const { password_hash, ...safeDistributor } = distributor;
  safeDistributor.id_document_url = distributor.id_document_path ? await getFileUrl(distributor.id_document_path) : null;

  res.json({ distributor: safeDistributor });
});

// Distributor profile + the retailers they referred, for the admin.html
// Distributor Detail view (opened by clicking a distributor in the list).
router.get('/distributors/:id/full', requireAdmin, async (req, res) => {
  const result = await db.execute({ sql: 'SELECT * FROM distributors WHERE id = ?', args: [req.params.id] });
  const distributor = result.rows[0];
  if (!distributor) return res.status(404).json({ error: 'Distributor not found.' });

  const { password_hash, ...safeDistributor } = distributor;
  safeDistributor.id_document_url = distributor.id_document_path ? await getFileUrl(distributor.id_document_path) : null;

  const usersResult = await db.execute({
    sql: `SELECT id, full_name, shop_name, phone_number, email, balance, tier2_submitted_at, created_at
          FROM users WHERE referral_distributor_id = ? AND status = 'approved'
          ORDER BY created_at DESC`,
    args: [req.params.id],
  });

  res.json({ distributor: safeDistributor, users: usersResult.rows });
});

router.post('/distributors', requireAdmin, upload.single('id_document'), async (req, res) => {
  try {
    const { full_name, phone_number, place, associated_since, bank_name, account_number, account_name } = req.body;

    if (!full_name || !full_name.trim()) return res.status(400).json({ error: 'Please enter the distributor\u2019s name.', field: 'full_name' });
    if (!phone_number || !/^[0-9+\s-]{7,15}$/.test(phone_number)) {
      return res.status(400).json({ error: 'Please enter a valid phone number.', field: 'phone_number' });
    }
    if (!place || !place.trim()) return res.status(400).json({ error: 'Please enter a place.', field: 'place' });
    if (!associated_since || !associated_since.trim()) return res.status(400).json({ error: 'Please enter how long they\u2019ve been associated with Mellow.', field: 'associated_since' });
    if (!bank_name || !bank_name.trim()) return res.status(400).json({ error: 'Please enter a bank name.', field: 'bank_name' });
    if (!account_number || !/^\d{10}$/.test(account_number)) {
      return res.status(400).json({ error: 'Please enter a valid 10-digit account number.', field: 'account_number' });
    }
    if (!account_name || !account_name.trim()) return res.status(400).json({ error: 'Please enter the account name.', field: 'account_name' });
    if (!req.file) return res.status(400).json({ error: 'Please upload a government ID.', field: 'id_document' });

    const existing = await db.execute({ sql: 'SELECT id FROM distributors WHERE phone_number = ?', args: [phone_number.trim()] });
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'A distributor with this phone number already exists.', field: 'phone_number' });
    }

    const idKey = await saveFile(req.file.buffer, req.file.originalname, 'distributor-ids');
    const password = generateDistributorPassword(full_name, phone_number);
    const passwordHash = await bcrypt.hash(password, 10);
    const id = nanoid();

    await db.execute({
      sql: `INSERT INTO distributors
        (id, full_name, phone_number, place, associated_since, bank_name, account_number, account_name, id_document_path, password_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id, full_name.trim(), phone_number.trim(), place.trim(), associated_since.trim(),
        bank_name.trim(), account_number.trim(), account_name.trim(), idKey, passwordHash,
      ],
    });

    res.json({
      message: 'Distributor added.',
      phone_number: phone_number.trim(),
      password, // shown once here - only the hash is stored, so this is the only chance to see it
    });
  } catch (err) {
    console.error('[admin/distributors create]', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ---------- Local-mode file serving (ID docs / shop photos) ----------
// Only reachable with a valid admin token; irrelevant when STORAGE_MODE=r2
// since getFileUrl() returns a direct presigned R2 URL instead.
router.get('/files/:key(*)', requireAdmin, (req, res) => {
  if (STORAGE_MODE !== 'local') return res.status(404).end();
  try {
    const buffer = readLocalFile(req.params.key);
    res.send(buffer);
  } catch (err) {
    res.status(404).json({ error: 'File not found.' });
  }
});

module.exports = router;
