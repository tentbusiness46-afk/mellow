# MelloW — Setup & Deployment Overview

Read these in order. Each file is self-contained, but this is the sequence
that actually gets you from zero to a live app.

1. **[01-local-development.md](01-local-development.md)** — install dependencies,
   create `.env`, run the app on your own machine first. Do this before anything
   else so you can catch problems while it's easy to debug. Runs against a
   local SQLite file by default — no Turso account needed yet.
2. **[01b-local-sqlite-vs-turso.md](01b-local-sqlite-vs-turso.md)** — how the
   local-file-now, real-Turso-later switch works (same code, no migration
   headaches).
3. **[02-turso-setup.md](02-turso-setup.md)** — create the free Turso database
   for production. Needed before deploying, not before local testing.
4. **[03-r2-setup.md](03-r2-setup.md)** — Cloudflare R2 bucket for storing ID
   documents and shop photos in production. Skip this while testing locally
   (`STORAGE_MODE=local` just saves files to disk instead) — only needed
   before you deploy for real, since Render's disk is wiped on every deploy.
5. **[04-render-deploy.md](04-render-deploy.md)** — deploy the Node server to
   Render's free tier.
6. **[05-first-run-checklist.md](05-first-run-checklist.md)** — the handful of
   one-time steps after deploying: seeding the admin account, generating your
   first QR batch, and a smoke-test checklist.

## What you're deploying

One Node/Express server (`backend/`) that:
- Serves the frontend — plain HTML/CSS/JS files in `public/`, no build step
- Exposes the `/api/*` routes the frontend calls
- Talks to Turso (SQLite-compatible, hosted) for all data
- Talks to Cloudflare R2 (S3-compatible) for ID/shop photo uploads in production

Nothing here needs a build step, a bundler, or a separate frontend host —
it's one Node service, one database, one bucket.
