# 3. Cloudflare R2 Setup

R2 stores the ID document and shop photo uploads collected during Tier 2
verification (first redemption request). You need this before deploying to
Render for real, because Render's filesystem is wiped on every deploy/restart
— anything saved with `STORAGE_MODE=local` would be lost. R2's free tier
(10GB storage, no egress fees) is comfortably enough for this.

You can skip this entirely while developing locally — `STORAGE_MODE=local`
just saves files to `backend/uploads/` on your own machine instead.

## Steps

1. Go to the [Cloudflare dashboard](https://dash.cloudflare.com) and sign up
   / log in (a Cloudflare account is free even without owning a domain).

2. In the left sidebar, find **R2 Object Storage** (you may need to enable
   R2 on the account the first time — it'll prompt you, still free tier).

3. Click **Create bucket**.
   - Name it `mellow-uploads` (or whatever you set `R2_BUCKET_NAME` to in
     `.env` — they must match).
   - Location: Automatic is fine.

4. **Create an API token** (this is separate from your Cloudflare login):
   - In the R2 section, go to **Manage R2 API Tokens** (or **API** in the
     account sidebar).
   - Click **Create API Token**.
   - Permissions: **Object Read & Write**, scoped to the `mellow-uploads`
     bucket specifically (don't grant account-wide access if you can scope
     it to just this bucket).
   - Save the **Access Key ID** and **Secret Access Key** it gives you —
     the secret is only shown once.

5. **Find your Account ID**: it's shown on the main Cloudflare dashboard
   overview page (right sidebar), or in the R2 section header. It's a long
   hex string, not your email.

6. Fill these into `.env`:
   ```
   STORAGE_MODE=r2
   R2_ACCOUNT_ID=<your account id>
   R2_ACCESS_KEY_ID=<access key from step 4>
   R2_SECRET_ACCESS_KEY=<secret key from step 4>
   R2_BUCKET_NAME=mellow-uploads
   ```

## Keep the bucket private

Don't turn on public bucket access. The app already handles viewing
uploaded documents securely — the admin panel requests a **presigned URL**
(a temporary, expiring link) for each file only when an admin explicitly
opens it from the Users page, rather than making the bucket world-readable.
This matters because these are ID documents and bank details.

## Testing it worked

After setting `STORAGE_MODE=r2` and restarting the server, submit a test
redemption request through the customer app (as a Tier-2-not-yet-verified
retailer) with a sample ID photo and shop photo. Then in the admin panel,
open that user under **Users** and click **View ID Document** — if it opens
the image, R2 is wired up correctly. If you get an error, double-check the
bucket name matches exactly and the API token has write+read access to it.
