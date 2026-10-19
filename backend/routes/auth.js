const express = require('express');
const bcrypt = require('bcryptjs');
const { nanoid } = require('nanoid');
const db = require('../db/client');
const { sign } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rate-limit');

const router = express.Router();

const RETAILER_TYPES = ['standalone shop', 'market stall', 'supermarket', 'distributor', 'other'];
const REFERRAL_SOURCES = ['distributor referral', 'social media', 'saw it in another shop', 'other'];

function badRequest(res, field, message) {
  return res.status(400).json({ error: message, field });
}

router.post('/register', async (req, res) => {
  try {
    const {
      full_name,
      phone_number,
      shop_name,
      shop_state,
      shop_city,
      shop_address,
      retailer_type,
      stocking_mellow,
      stocking_since,
      referral_source,
      referral_distributor_phone,
      email,
      password,
    } = req.body;

    if (!full_name || !full_name.trim()) return badRequest(res, 'full_name', 'Please enter your full name.');
    if (!phone_number || !/^[0-9+\s-]{7,15}$/.test(phone_number)) {
      return badRequest(res, 'phone_number', 'Please enter a valid phone number.');
    }
    if (!shop_name || !shop_name.trim()) return badRequest(res, 'shop_name', 'Please enter your shop/business name.');
    if (!shop_state || !shop_state.trim()) return badRequest(res, 'shop_state', 'Please enter your state.');
    if (!shop_city || !shop_city.trim()) return badRequest(res, 'shop_city', 'Please enter your city or LGA.');
    if (stocking_mellow === undefined || stocking_mellow === null) {
      return badRequest(res, 'stocking_mellow', 'Please let us know if you currently stock Mellow.');
    }
    if (!REFERRAL_SOURCES.includes(referral_source)) {
      return badRequest(res, 'referral_source', 'Please tell us how you heard about Mellow.');
    }
    const viaDistributor = referral_source === 'distributor referral';
    if (viaDistributor && (!referral_distributor_phone || !referral_distributor_phone.trim())) {
      return badRequest(res, 'referral_distributor_phone', "Please enter your referring distributor's phone number.");
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return badRequest(res, 'email', 'Please enter a valid email address.');
    }
    if (!password || password.length < 6) {
      return badRequest(res, 'password', 'Password must be at least 6 characters.');
    }

    const existing = await db.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: [email.toLowerCase()] });
    if (existing.rows.length > 0) {
      return badRequest(res, 'email', 'An account with this email already exists.');
    }

    // Only retailers who came through a distributor need one on record.
    let distributorId = null;
    if (viaDistributor) {
      const distributorResult = await db.execute({
        sql: 'SELECT id FROM distributors WHERE phone_number = ?',
        args: [referral_distributor_phone.trim()],
      });
      const distributor = distributorResult.rows[0];
      if (!distributor) {
        return badRequest(res, 'referral_distributor_phone', 'No distributor found with this phone number. Please check and try again.');
      }
      distributorId = distributor.id;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const id = nanoid();

    await db.execute({
      sql: `INSERT INTO users
        (id, full_name, phone_number, shop_name, shop_state, shop_city, shop_address, retailer_type,
         stocking_mellow, stocking_since, referral_source, referral_distributor_id, email, password_hash, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      args: [
        id,
        full_name.trim(),
        phone_number.trim(),
        shop_name.trim(),
        shop_state.trim(),
        shop_city.trim(),
        (shop_address || '').trim(),
        'other', // retailer type is no longer asked; column is NOT NULL
        stocking_mellow ? 1 : 0,
        stocking_mellow ? (stocking_since || '').trim() : null,
        referral_source,
        distributorId,
        email.toLowerCase().trim(),
        passwordHash,
      ],
    });

    res.json({ message: 'Your details have been submitted for review.' });
  } catch (err) {
    console.error('[auth/register]', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return badRequest(res, 'email', 'Please enter your email and password.');
    }

    const result = await db.execute({
      sql: 'SELECT * FROM users WHERE email = ?',
      args: [email.toLowerCase().trim()],
    });
    const user = result.rows[0];

    if (!user) return badRequest(res, 'email', 'Incorrect email or password.');

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) return badRequest(res, 'password', 'Incorrect email or password.');

    if (user.status === 'pending') {
      return res.status(403).json({ error: 'Your registration is still under review. You will be able to log in once approved.', status: 'pending' });
    }
    if (user.status === 'rejected') {
      return res.status(403).json({
        error: 'Your registration was not approved.',
        reason: user.rejection_reason || null,
        status: 'rejected',
      });
    }

    const token = sign({ id: user.id, role: 'user' });
    res.json({
      token,
      user: {
        id: user.id,
        full_name: user.full_name,
        shop_name: user.shop_name,
        balance: user.balance,
        tier2_submitted: !!user.tier2_submitted_at,
      },
    });
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

module.exports = router;
