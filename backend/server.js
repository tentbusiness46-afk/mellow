require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const adminAuthRoutes = require('./routes/admin-auth');
const userRoutes = require('./routes/user');
const couponRoutes = require('./routes/coupons');
const qrRoutes = require('./routes/qr');
const adminRoutes = require('./routes/admin');
const enquiryRoutes = require('./routes/enquiries');
const distAuthRoutes = require('./routes/dist-auth');
const distributorRoutes = require('./routes/distributor');

const app = express();
const PUBLIC = path.join(__dirname, '..', 'public');

// Render (and most hosts) put a proxy in front of the app. Without this the
// rate limiters would see the proxy's address for every visitor.
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json());

// ---------- API routes ----------
app.use('/api/auth', authRoutes);
app.use('/api/admin-auth', adminAuthRoutes);
app.use('/api/user', userRoutes);
app.use('/api/qr', couponRoutes); // must stay above qrRoutes (coupon ZIP + scan lockout)
app.use('/api/qr', qrRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/enquiries', enquiryRoutes); // website contact + partner forms; admin list under /admin
app.use('/api/dist-auth', distAuthRoutes);
app.use('/api/distributor', distributorRoutes);

// ---------- Pages ----------
//   /            the public Mellow website
//   /app         the retailer app (this is the page Capacitor wraps)
//   /admin       admin panel
//   /dist        distributor panel
// /auth and /dashboard still work, so already-installed copies of the app
// keep opening.
const PAGES = {
  '/': 'index.html',
  '/app': 'auth.html',
  '/auth': 'auth.html',
  '/dashboard': 'dashboard.html',
  '/admin': 'admin.html',
  '/admin-login': 'admin-login.html',
  '/dist': 'dist.html',
  '/dist-login': 'dist-login.html',
};

Object.entries(PAGES).forEach(([cleanPath, file]) => {
  app.get(cleanPath, (req, res) => {
    res.set('Cache-Control', 'no-cache'); // pages are always fresh; assets below are cached
    res.sendFile(path.join(PUBLIC, file));
  });
  // Old links using the .html filename still get somewhere useful.
  if (cleanPath !== '/') app.get('/' + file, (req, res) => res.redirect(301, cleanPath));
});

// ---------- Static files ----------
// Site assets (images, fonts, icons) rarely change, so let browsers keep them.
app.use(express.static(PUBLIC, {
  index: false,
  maxAge: '7d',
  setHeaders(res, file) {
    if (/\.(html|json|webmanifest)$/.test(file)) res.set('Cache-Control', 'no-cache');
  },
}));

// ---------- Fallback ----------
app.use((req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found.' });
  if (req.path.startsWith('/admin')) return res.redirect('/admin-login');
  if (req.path.startsWith('/dist')) return res.redirect('/dist-login');
  if (req.path.startsWith('/app')) return res.redirect('/app');
  res.redirect('/');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[server] Mellow running on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
});
