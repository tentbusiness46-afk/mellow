# 2. Turso Setup

You don't need this to develop locally — `TURSO_DATABASE_URL=file:...`
runs against a local SQLite file with the exact same code (see
[01b-local-sqlite-vs-turso.md](01b-local-sqlite-vs-turso.md)). Do this step
when you're ready to deploy for real, or if you want your local dev
environment talking to a shared/remote database.

Turso is a hosted SQLite-compatible database with a generous free tier
(500 databases, 9GB storage, 1 billion row reads/month on the free plan —
comfortably enough for 500 retailers). This is where every table lives:
users, admins, QR codes, redemption requests.

## Option A — Web dashboard (no CLI)

1. Go to [turso.tech](https://turso.tech) and sign up (GitHub login is
   fastest).
2. From the dashboard, click **Create Database**.
3. Give it a name, e.g. `mellow-prod`. Pick a region close to your users
   (e.g. closest to Nigeria if that's your primary market).
4. Once created, open the database and find:
   - **Database URL** — looks like `libsql://mellow-prod-yourname.turso.io`
   - Click **Create Token** (or similar) to generate an **auth token** — a
     long string starting with `ey...`
5. Put both into your `.env`:
   ```
   TURSO_DATABASE_URL=libsql://mellow-prod-yourname.turso.io
   TURSO_AUTH_TOKEN=ey...
   ```

## Option B — CLI (faster if you're comfortable with a terminal)

1. Install the Turso CLI:
   ```bash
   curl -sSfL https://get.tur.so/install.sh | bash
   ```
   (On Windows, use WSL, or see turso.tech/docs for the Windows install method.)

2. Sign up / log in:
   ```bash
   turso auth signup
   ```

3. Create the database:
   ```bash
   turso db create mellow-prod
   ```

4. Get the URL:
   ```bash
   turso db show mellow-prod --url
   ```

5. Create an auth token:
   ```bash
   turso db tokens create mellow-prod
   ```

6. Put both values into `.env` as shown above.

## Creating the tables

Once `.env` has valid Turso credentials, run this once (from the project
root, after `npm install`):

```bash
node backend/db/init.js
```

This runs `backend/db/schema.sql` against your database — creates the
`users`, `admins`, `qr_batches`, `qr_codes`, and `redemption_requests`
tables. Safe to re-run; it uses `CREATE TABLE IF NOT EXISTS`.

## Inspecting your data later

The Turso web dashboard has a built-in SQL console under your database's
**Studio** tab — useful for spot-checking data without writing a script.
Or with the CLI:

```bash
turso db shell mellow-prod
```

then plain SQL, e.g. `SELECT * FROM users LIMIT 10;`.

## One database for local + production?

You can use the same Turso database for both local development and your
live Render deployment (they're both just talking to the same hosted DB
over the network) — but it means your local testing writes real data
alongside production. For anything beyond initial testing, create a second
database (e.g. `mellow-dev`) and point your local `.env` at that instead,
keeping `mellow-prod` for the real deployment.
