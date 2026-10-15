const jwt = require('jsonwebtoken');

function sign(payload, expiresIn = '30d') {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });
}

function verifyToken(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return null;
  }
}

// Requires a valid customer (role: "user") token
function requireUser(req, res, next) {
  const decoded = verifyToken(req);
  if (!decoded || decoded.role !== 'user') {
    return res.status(401).json({ error: 'Please log in again.' });
  }
  req.userId = decoded.id;
  next();
}

// Requires a valid admin token
function requireAdmin(req, res, next) {
  const decoded = verifyToken(req);
  if (!decoded || decoded.role !== 'admin') {
    return res.status(401).json({ error: 'Admin session expired, please log in again.' });
  }
  req.adminId = decoded.id;
  next();
}

// Requires a valid distributor token
function requireDistributor(req, res, next) {
  const decoded = verifyToken(req);
  if (!decoded || decoded.role !== 'distributor') {
    return res.status(401).json({ error: 'Please log in again.' });
  }
  req.distributorId = decoded.id;
  next();
}

module.exports = { sign, verifyToken, requireUser, requireAdmin, requireDistributor };
