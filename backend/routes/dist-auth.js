const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/client');
const { sign } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rate-limit');

const router = express.Router();

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { phone_number, password } = req.body;
    if (!phone_number || !password) {
      return res.status(400).json({ error: 'Please enter your phone number and password.', field: 'phone_number' });
    }

    const result = await db.execute({
      sql: 'SELECT * FROM distributors WHERE phone_number = ?',
      args: [phone_number.trim()],
    });
    const distributor = result.rows[0];
    if (!distributor) return res.status(400).json({ error: 'Incorrect phone number or password.', field: 'phone_number' });

    const validPassword = await bcrypt.compare(password, distributor.password_hash);
    if (!validPassword) return res.status(400).json({ error: 'Incorrect phone number or password.', field: 'password' });

    const token = sign({ id: distributor.id, role: 'distributor' });
    res.json({ token, distributor: { id: distributor.id, full_name: distributor.full_name } });
  } catch (err) {
    console.error('[dist-auth/login]', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

module.exports = router;
