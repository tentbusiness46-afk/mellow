# 5. First-Run Checklist

One-time steps after your first deploy, plus a smoke test to confirm
everything's wired up correctly.

## 1. Create the database tables (production database)

From your own machine, with a `.env` file pointed at your **production**
Turso credentials (same `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` you gave
Render):

```bash
node backend/db/init.js
```

You only need to do this once per database. If you used the same Turso
database for local dev and production, you've likely already done this.

## 2. Create the admin account (production)

Same idea — from your own machine, with `.env` pointed at production:

```bash
npm run seed-admin
```

This creates the one admin login using `ADMIN_EMAIL` / `ADMIN_PASSWORD`
from your `.env`. Make sure these match what you set in Render's
environment variables, since that's what the live app is actually running
with.

## 3. Smoke test the live app

Visit your Render URL and walk through the full loop:

- [ ] `/auth` loads, Register tab works, submitting shows the
      "Details Submitted" confirmation
- [ ] `/admin-login` — log in with your admin credentials
- [ ] Admin **Registrations** tab shows the test registration; Approve it
- [ ] Log into `/auth` (Login tab) with that retailer's credentials —
      should land on the dashboard
- [ ] Admin **QR Codes** — generate a small test batch, export the ZIP,
      confirm it downloads and contains SVG label files
- [ ] Customer app **Scan QR** — test on an actual phone (camera access
      needs a real device, and needs HTTPS, which Render gives you by
      default)
- [ ] Customer app **Redeem Balance** — submit a request; if it's the
      account's first redemption, confirm the ID/shop photo upload works
      (this is the step that needs R2 configured correctly — see
      [03-r2-setup.md](03-r2-setup.md) if it fails)
- [ ] Admin **Users** — open the test retailer, confirm you can view the
      uploaded ID document and shop photo
- [ ] Admin **Redemptions** — approve or reject the test request, confirm
      the retailer's balance updates accordingly

## 4. Ongoing: generating QR batches for print

Whenever you need new codes for a print run:

1. Admin panel → **QR Codes** → enter denomination and quantity → **Generate
   Batch**
2. Click **Export ZIP** next to that batch
3. The ZIP contains one `.svg` label per code (QR + denomination + MelloW
   branding), ready to send to a printer. SVG prints cleanly at any size.

## If something's broken

- **Registrations/QR/Redemptions pages show "Could not load..."** — check
  the Render logs (Render dashboard → your service → Logs) for the actual
  error; usually a Turso credential mismatch between local and production.
- **File uploads fail on redemption** — almost always an R2 misconfiguration.
  Re-check bucket name and API token permissions in
  [03-r2-setup.md](03-r2-setup.md).
- **App loads but login always fails** — confirm `npm run seed-admin` was
  run against the *production* database, not just your local one.
