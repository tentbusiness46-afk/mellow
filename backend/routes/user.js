const express = require('express');
const multer = require('multer');
const { nanoid } = require('nanoid');
const db = require('../db/client');
const { requireUser } = require('../middleware/auth');
const { saveFile } = require('../utils/storage');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

// Returns everything the Account page needs, plus the fields the rest of
// the app already relied on (balance, tier2_submitted). Never returns
// password_hash or the raw file storage keys/paths - those are admin-only
// (see backend/routes/admin.js), since a retailer doesn't need the literal
// storage key for their own uploaded documents.
router.get('/me', requireUser, async (req, res) => {
  const result = await db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [req.userId] });
  const user = result.rows[0];
  if (!user) return res.status(404).json({ error: 'Account not found.' });

  let referral_distributor = null;
  if (user.referral_distributor_id) {
    const distResult = await db.execute({
      sql: 'SELECT full_name, phone_number, place FROM distributors WHERE id = ?',
      args: [user.referral_distributor_id],
    });
    if (distResult.rows[0]) referral_distributor = distResult.rows[0];
  }

  res.json({
    id: user.id,
    full_name: user.full_name,
    phone_number: user.phone_number,
    shop_name: user.shop_name,
    shop_state: user.shop_state,
    shop_city: user.shop_city,
    shop_address: user.shop_address,
    retailer_type: user.retailer_type,
    stocking_mellow: !!user.stocking_mellow,
    stocking_since: user.stocking_since,
    referral_source: user.referral_source,
    referral_distributor: referral_distributor,
    email: user.email,
    balance: user.balance,
    tier2_submitted: !!user.tier2_submitted_at,
    tier2_verified: !!user.tier2_verified_at,
    bank_name: user.bank_name,
    account_number: user.account_number,
    account_name: user.account_name,
    created_at: user.created_at,
  });
});

router.get('/redemptions', requireUser, async (req, res) => {
  const result = await db.execute({
    sql: 'SELECT id, amount, status, rejection_reason, created_at, resolved_at FROM redemption_requests WHERE user_id = ? ORDER BY created_at DESC',
    args: [req.userId],
  });
  res.json({ redemptions: result.rows });
});

// Scan history for the Home page - every QR code this retailer has redeemed,
// most recent first. Capped at 50 so the feed doesn't grow unbounded for a
// retailer who's been scanning for a year.
router.get('/scans', requireUser, async (req, res) => {
  const result = await db.execute({
    sql: `SELECT value, used_at FROM qr_codes WHERE used_by = ? ORDER BY used_at DESC LIMIT 50`,
    args: [req.userId],
  });
  res.json({ scans: result.rows });
});

// Handles both the first-ever redemption request (which also collects Tier 2
// verification: ID doc, shop photo, bank details, consent) and subsequent
// ones (which only need the amount, since Tier 2 info is already on file).
router.post('/redeem', requireUser, upload.fields([
  { name: 'id_document', maxCount: 1 },
  { name: 'shop_photo', maxCount: 1 },
]), async (req, res) => {
  try {
    const userResult = await db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [req.userId] });
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: 'Account not found.' });

    const amount = parseInt(req.body.amount, 10);
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Please enter a valid amount.', field: 'amount' });
    }

    const pendingResult = await db.execute({
      sql: `SELECT COALESCE(SUM(amount), 0) as pending_total FROM redemption_requests WHERE user_id = ? AND status = 'pending'`,
      args: [req.userId],
    });
    const pendingTotal = Number(pendingResult.rows[0].pending_total);
    const available = user.balance - pendingTotal;

    if (amount > available) {
      return res.status(400).json({ error: `You can request up to \u20a6${available}.`, field: 'amount' });
    }

    const needsTier2 = !user.tier2_submitted_at;

    if (needsTier2) {
      const { bank_name, account_number, account_name, consent } = req.body;
      const idFile = req.files?.id_document?.[0];
      const shopFile = req.files?.shop_photo?.[0];

      if (!idFile) return res.status(400).json({ error: 'Please upload a valid government ID.', field: 'id_document' });
      if (!shopFile) return res.status(400).json({ error: 'Please upload a photo of your shop/storefront.', field: 'shop_photo' });
      if (!bank_name || !bank_name.trim()) return res.status(400).json({ error: 'Please enter your bank name.', field: 'bank_name' });
      if (!account_number || !/^\d{10}$/.test(account_number)) {
        return res.status(400).json({ error: 'Please enter a valid 10-digit account number.', field: 'account_number' });
      }
      if (!account_name || !account_name.trim()) return res.status(400).json({ error: 'Please enter the account name.', field: 'account_name' });
      if (consent !== 'true' && consent !== true) {
        return res.status(400).json({ error: 'Please accept the data usage & terms to continue.', field: 'consent' });
      }

      const idKey = await saveFile(idFile.buffer, idFile.originalname, 'id-documents');
      const shopKey = await saveFile(shopFile.buffer, shopFile.originalname, 'shop-photos');

      await db.execute({
        sql: `UPDATE users SET id_document_path = ?, shop_photo_path = ?, bank_name = ?, account_number = ?,
              account_name = ?, tier2_consent = 1, tier2_submitted_at = datetime('now') WHERE id = ?`,
        args: [idKey, shopKey, bank_name.trim(), account_number.trim(), account_name.trim(), req.userId],
      });
    }

    await db.execute({
      sql: `INSERT INTO redemption_requests (id, user_id, amount, status) VALUES (?, ?, ?, 'pending')`,
      args: [nanoid(), req.userId, amount],
    });

    res.json({ message: 'Your redemption request has been submitted.' });
  } catch (err) {
    console.error('[user/redeem]', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

module.exports = router;
