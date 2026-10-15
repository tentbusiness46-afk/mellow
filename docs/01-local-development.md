# 1. Local Development

Get this running on your own machine before touching Render or R2 — it's
much faster to debug here.

## Prerequisites

- Node.js 18 or newer (`node --version` to check)
- That's it for the database — by default this runs against a local
  SQLite file, no Turso account needed yet. See
  [01b-local-sqlite-vs-turso.md](01b-local-sqlite-vs-turso.md) for how that
  works and how you switch to real Turso later with no code changes.

## Steps

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Create your `.env` file**

   ```bash
   cp .env.example .env
   ```

   Open `.env` and fill in:
   - `JWT_SECRET` — any long random string. Generate one with:
     ```bash
     openssl rand -hex 32
     ```
   - `TURSO_DATABASE_URL` — leave the default `file:./backend/db/local.db`
     as-is for now; that runs against a local SQLite file with no Turso
     account needed. Leave `TURSO_AUTH_TOKEN` blank too.
   - `ADMIN_EMAIL` / `ADMIN_PASSWORD` — whatever you want your one admin
     login to be
   - Leave `STORAGE_MODE=local` for now — this saves uploaded ID/shop photos
     to `backend/uploads/` on your machine instead of Cloudflare R2, so you
     don't need R2 set up just to test locally.

3. **Create the database tables**

   ```bash
   node backend/db/init.js
   ```

   You should see `[db] Ran N schema statements successfully.` This creates
   `backend/db/local.db` on first run.

4. **Create the admin account**

   ```bash
   npm run seed-admin
   ```

   This reads `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env` and creates that
   admin login. Re-running it later just updates the password.

5. **(Optional) Create a ready-to-use test retailer**

   ```bash
   npm run seed-test-data
   ```

   Skips the register-then-approve flow for quick testing. Creates (or
   resets) a pre-approved retailer:
   - Email: `retailer@test.com`
   - Password: `test1234`
   - Starting balance: ₦2,500
   - Tier 2 verification not yet submitted, so you can test that flow on
     first redemption request

6. **Start the server**

   ```bash
   npm start
   ```

   Or, for auto-restart on file changes while you're developing:

   ```bash
   npm run dev
   ```

7. **Open it**

   - Customer app: `http://localhost:3000/auth`
   - Admin panel: `http://localhost:3000/admin-login`

## Testing the full loop locally

1. Register a retailer account at `/auth`.
2. Log into the admin panel and approve that registration under
   **Registrations**.
3. Log into the customer app with the retailer's email/password.
4. In the admin panel, go to **QR Codes**, generate a small batch (e.g.
   value `500`, quantity `5`), and export the ZIP.
5. Open one of the `.svg` label files from the ZIP on your screen (or print
   it), then use **Scan QR** in the customer app to scan it — you'll need to
   test this on an actual phone or a laptop with a webcam, since it needs
   real camera access.
6. Request a redemption from the customer app, then approve/reject it from
   the admin **Redemptions** tab.

## Common issues

- **"Could not reach the server"** on every page — the Node server isn't
  running, or you opened the HTML files directly from disk (`file://`)
  instead of through `http://localhost:3000`. These pages need to be served
  by the Node app to reach the API.
- **Camera doesn't work on Scan tab** — browsers only allow camera access
  over `https://` or on `localhost`. `http://localhost:3000` is fine; a
  different device on your network (e.g. `http://192.168.x.x:3000`) will not
  get camera access without HTTPS.
- **`node backend/db/init.js` fails** — almost always a wrong/missing Turso
  credential in `.env`.
