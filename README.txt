MELLOW - integrated site + app (drop into your project folder, keep the same folder names)

backend/server.js               replaces your server.js (also mounts coupon routes above qr routes)
backend/routes/enquiries.js     NEW - website forms + admin endpoints (creates its own table on first use)
backend/db/schema.sql           replaces schema.sql (adds the enquiries table for fresh databases)
public/                         replaces the whole public folder (website + app + admin + dist)

URLs:  /  website   |  /app  retailer app (Capacitor)  |  /admin  |  /dist
       /auth and /dashboard still work for already-installed copies.

Capacitor: set server.url to https://YOUR-DOMAIN/app (or bundle public/ and use auth.html as the entry).
No new npm packages are needed.
