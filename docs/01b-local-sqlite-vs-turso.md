# Local SQLite → Turso: How This Works

You can build and test this entire app against a plain local SQLite file,
with zero Turso account, zero network dependency, and **zero code
changes** — then point the exact same code at a real Turso database when
you're ready to deploy. This works because Turso's client library
(`@libsql/client`) speaks both "local file" and "remote database" through
the same connection string.

## Local mode (default for development)

In `.env`:

```
TURSO_DATABASE_URL=file:./backend/db/local.db
TURSO_AUTH_TOKEN=
```

That's it. `TURSO_AUTH_TOKEN` stays blank — it's only meaningful for
remote connections. When you run:

```bash
node backend/db/init.js
```

it creates `backend/db/local.db` — a real SQLite file on your disk — and
runs the schema against it. `npm run seed-admin` and the app itself work
completely normally from here. You can inspect this file with any SQLite
tool (`sqlite3 backend/db/local.db`, DB Browser for SQLite, the SQLite
VS Code extension, etc.) if you want to poke at the data directly.

This file is already excluded in `.gitignore` — it's local test data, not
something to commit.

## Switching to Turso for production

When you're ready to deploy (see [02-turso-setup.md](02-turso-setup.md)),
you get a `libsql://...` URL and an auth token from Turso. Change `.env`
(locally, to test the switch) or your Render environment variables
(for the real deploy) to:

```
TURSO_DATABASE_URL=libsql://your-db-name-your-org.turso.io
TURSO_AUTH_TOKEN=ey...
```

Then run the schema against it once:

```bash
node backend/db/init.js
```

Nothing in `backend/` needs to change — `db/client.js` doesn't care
whether the URL is `file:` or `libsql:`, it just passes it straight to
the client. Every route, every query, identical either way.

## Do you need to migrate your local test data?

Usually no — local data is throwaway test data (fake retailers, test QR
codes) and you'd rather start production with a clean database anyway.
If you genuinely have real data on the local file you need to carry over
(unlikely during initial development, more relevant if you'd been running
a pilot locally), the local file is a real SQLite database, so:

```bash
sqlite3 backend/db/local.db .dump > dump.sql
turso db shell your-db-name < dump.sql
```

This is a one-time manual step, not something the app does automatically.
