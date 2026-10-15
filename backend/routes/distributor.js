const express = require('express');
const db = require('../db/client');
const { requireDistributor } = require('../middleware/auth');
const { getFileUrl } = require('../utils/storage');

const router = express.Router();

// ---------- Dashboard: how many retailers this distributor referred, and
// the total value of QR codes scanned by those retailers ----------
router.get('/stats', requireDistributor, async (req, res) => {
  const [usersResult, scannedResult] = await Promise.all([
    db.execute({
      sql: `SELECT COUNT(*) as n FROM users WHERE referral_distributor_id = ? AND status = 'approved'`,
      args: [req.distributorId],
    }),
    db.execute({
      sql: `SELECT COALESCE(SUM(c.value), 0) as total FROM qr_codes c
            JOIN users u ON u.id = c.used_by
            WHERE u.referral_distributor_id = ? AND c.is_used = 1`,
      args: [req.distributorId],
    }),
  ]);

  res.json({
    referred_users: Number(usersResult.rows[0].n),
    scanned_value: Number(scannedResult.rows[0].total),
  });
});

// ---------- Users this distributor referred (same shape as admin's list) ----------
router.get('/users', requireDistributor, async (req, res) => {
  const search = `%${(req.query.search || '').trim()}%`;
  const result = await db.execute({
    sql: `SELECT id, full_name, shop_name, phone_number, email, balance, tier2_submitted_at, created_at
          FROM users WHERE referral_distributor_id = ? AND status = 'approved'
          AND (full_name LIKE ? OR shop_name LIKE ? OR email LIKE ?)
          ORDER BY created_at DESC`,
    args: [req.distributorId, search, search, search],
  });
  res.json({ users: result.rows });
});

// ---------- Full detail for one of this distributor's referred users ----------
// The WHERE clause double-checks referral_distributor_id = req.distributorId,
// not just that the user exists - so a distributor can't view another
// distributor's retailer by guessing/trying a different id.
router.get('/users/:id/full', requireDistributor, async (req, res) => {
  const userResult = await db.execute({
    sql: 'SELECT * FROM users WHERE id = ? AND referral_distributor_id = ?',
    args: [req.params.id, req.distributorId],
  });
  const user = userResult.rows[0];
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const { password_hash, ...safeUser } = user;
  safeUser.id_document_url = user.id_document_path ? await getFileUrl(user.id_document_path) : null;
  safeUser.shop_photo_url = user.shop_photo_path ? await getFileUrl(user.shop_photo_path) : null;

  const [scansResult, redemptionsResult] = await Promise.all([
    db.execute({
      sql: 'SELECT value, used_at FROM qr_codes WHERE used_by = ? ORDER BY used_at DESC LIMIT 100',
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

module.exports = router;
