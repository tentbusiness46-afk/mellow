# 4. Deploying to Render

Render's free tier works for this — one Node web service, no separate
static host needed since Express serves the frontend files directly.

## Before you start

Have these ready (from the earlier steps):
- A Git repository (GitHub/GitLab/Bitbucket) with this project pushed to it.
  Render deploys from a repo, not a local folder upload.
- Your Turso `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`
- Your R2 credentials (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`)
- A `JWT_SECRET` (generate with `openssl rand -hex 32` if you haven't)
- The admin email/password you want in production

**Double-check `.gitignore` includes `.env`** before pushing — you don't
want real credentials committed to the repo. Render takes environment
variables through its own dashboard instead (see below).

## Steps

1. Go to [render.com](https://render.com) and sign up / log in (GitHub
   login makes connecting your repo a one-click step).

2. From the dashboard, click **New +** → **Web Service**.

3. Connect your Git repository and select this project's repo.

4. Configure the service:
   - **Name**: `mellow-app` (or whatever you like — this becomes part of
     your default `*.onrender.com` URL)
   - **Region**: closest to your users
   - **Branch**: `main` (or whichever branch you deploy from)
   - **Root Directory**: leave blank unless this project lives in a
     subfolder of the repo
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free

5. **Add environment variables** — scroll to the **Environment** section
   and add each of these as a key/value pair (same names as `.env`):
   ```
   NODE_ENV=production
   JWT_SECRET=<your generated secret>
   TURSO_DATABASE_URL=<your turso url>
   TURSO_AUTH_TOKEN=<your turso token>
   ADMIN_EMAIL=<your admin email>
   ADMIN_PASSWORD=<your admin password>
   STORAGE_MODE=r2
   R2_ACCOUNT_ID=<your r2 account id>
   R2_ACCESS_KEY_ID=<your r2 access key>
   R2_SECRET_ACCESS_KEY=<your r2 secret key>
   R2_BUCKET_NAME=mellow-uploads
   ```
   Render sets `PORT` itself — don't add it manually, `server.js` already
   reads `process.env.PORT` with a fallback.

6. Click **Create Web Service**. Render will build and deploy — first
   deploy usually takes a few minutes. Watch the build logs for errors.

7. Once live, Render gives you a URL like
   `https://mellow-app.onrender.com`. Visit
   `https://mellow-app.onrender.com/auth` to confirm the customer app
   loads, and `/admin-login` for the admin panel.

## After the first deploy

You still need to run the database setup and admin seed **once** — these
are one-time scripts, not part of the normal server startup. See
[05-first-run-checklist.md](05-first-run-checklist.md) for exactly how to
run them against your production database (you can run them from your own
machine, pointed at the same Turso credentials — no need to SSH into
Render).

## Free tier behavior to know about

- Render's free web services **spin down after ~15 minutes of no traffic**
  and take 30–60 seconds to wake back up on the next request. Your retailers
  will notice this as a slow first load if the app hasn't been used
  recently. This is fine for testing/early usage; if it becomes a problem
  at scale, Render's paid tier removes the spin-down.
- Every deploy wipes the filesystem — this is exactly why `STORAGE_MODE=r2`
  matters in production; `STORAGE_MODE=local` would lose all uploaded ID
  photos on the next deploy.

## Redeploying after code changes

Push to the branch Render is watching (e.g. `main`) — it auto-deploys on
every push by default. You can also trigger a manual deploy from the Render
dashboard.
