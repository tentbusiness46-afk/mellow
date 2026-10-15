# MelloW

A retailer rewards platform: retailers scan QR codes on stock to earn
balance, and request redemption to their bank account. Admins review
registrations, generate QR code batches, and approve/reject redemptions.

## Structure

```
mellow-app/
├── backend/
│   ├── server.js              Express app entry point
│   ├── db/
│   │   ├── client.js          Turso (libSQL) connection
│   │   ├── schema.sql         Table definitions
│   │   ├── init.js            One-time: creates tables
│   │   └── seed-admin.js      One-time: creates the admin login
│   ├── middleware/
│   │   ├── auth.js            JWT sign/verify for customer + admin
│   │   └── rate-limit.js      Login endpoint rate limiting
│   ├── routes/
│   │   ├── auth.js            Customer register/login
│   │   ├── admin-auth.js      Admin login
│   │   ├── user.js            Customer profile + redemption requests
│   │   ├── qr.js              QR scan (customer) + generate/export (admin)
│   │   └── admin.js           Registrations, users, redemptions (admin)
│   └── utils/
│       ├── storage.js         File upload abstraction (local disk / R2)
│       └── qr.js              QR code + printable label generation
├── public/                    Everything served to the browser
│   ├── auth.html              Customer login + register
│   ├── dashboard.html         Customer app (Dashboard/Scan/Redeem/History/Settings)
│   ├── admin-login.html       Admin login
│   ├── admin.html             Admin panel (Dashboard/Registrations/Users/QR Codes/Redemptions)
│   ├── manifest.json          PWA manifest
│   └── icons/                 App icons
├── docs/                      Setup & deployment guides — start at 00-overview.md
├── .env.example                Copy to .env and fill in
└── package.json
```

Each `public/*.html` file is fully self-contained (its own inline CSS/JS,
no build step, no framework) and uses tab-style client-side view switching
rather than separate pages per feature — e.g. `dashboard.html#scan` is the
Scan QR tab within the one file.

## Quick start

```bash
npm install
cp .env.example .env    # then fill in TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, JWT_SECRET, etc.
node backend/db/init.js # create tables (one time)
npm run seed-admin      # create the admin login (one time)
npm start
```

Then open `http://localhost:3000/auth` (customer app) or
`http://localhost:3000/admin-login` (admin panel).

Full setup and deployment instructions — including Turso, Cloudflare R2,
and Render — are in [`docs/00-overview.md`](docs/00-overview.md). Start
there if this is your first time setting the project up.

## Tech stack

- **Backend**: Node.js + Express
- **Database**: Turso (hosted SQLite, via `@libsql/client`)
- **File storage**: Cloudflare R2 in production, local disk for
  development (`STORAGE_MODE` in `.env` switches between them)
- **Frontend**: Vanilla HTML/CSS/JS, no framework or build step
- **Hosting**: Render (free tier)

## Notes for whoever picks this up next

- The QR code strings are 22-character random IDs from an unambiguous
  alphabet (no `0/O/1/I/l`) — see `backend/utils/qr.js`. They're
  cryptographically random, not sequential, so one code can't be guessed
  from another.
- Tier 2 verification (ID + shop photo + bank details) is collected on a
  retailer's *first* redemption request only — see `backend/routes/user.js`.
- There's a single admin account by design (no roles/permissions system) —
  see `backend/db/seed-admin.js` if that ever needs to change.
- Redemption payouts are manual: the admin marks a request "Mark Paid" in
  the panel after actually sending the bank transfer themselves — there's
  no payment API integration.
