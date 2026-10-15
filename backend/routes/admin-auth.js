const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/client');
const { sign } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rate-limit');

const router = express.Router();

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Please enter your email and password.', field: 'email' });
    }

    const result = await db.execute({
      sql: 'SELECT * FROM admins WHERE email = ?',
      args: [email.toLowerCase().trim()],
    });
    const admin = result.rows[0];
    if (!admin) return res.status(400).json({ error: 'Incorrect email or password.', field: 'email' });

    const validPassword = await bcrypt.compare(password, admin.password_hash);
    if (!validPassword) return res.status(400).json({ error: 'Incorrect email or password.', field: 'password' });

    const token = sign({ id: admin.id, role: 'admin' }, '12h');
    res.json({ token, admin: { id: admin.id, email: admin.email } });
  } catch (err) {
    console.error('[admin-auth/login]', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

module.exports = router;
