-- MelloW database schema (Turso / libSQL, SQLite-compatible)

CREATE TABLE IF NOT EXISTS users (
  id                TEXT PRIMARY KEY,
  full_name         TEXT NOT NULL,
  phone_number      TEXT NOT NULL,
  shop_name         TEXT NOT NULL,
  shop_state        TEXT NOT NULL,
  shop_city         TEXT NOT NULL,
  shop_address      TEXT,
  retailer_type     TEXT NOT NULL,
  stocking_mellow   INTEGER NOT NULL DEFAULT 0,
  stocking_since    TEXT,
  referral_source   TEXT NOT NULL,
  referral_distributor_id TEXT REFERENCES distributors(id),
  email             TEXT UNIQUE NOT NULL,
  password_hash     TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  rejection_reason  TEXT,
  balance           INTEGER NOT NULL DEFAULT 0,

  -- Tier 2, filled in on first redemption request
  id_document_path  TEXT,
  shop_photo_path   TEXT,
  bank_name         TEXT,
  account_number    TEXT,
  account_name      TEXT,
  tier2_consent     INTEGER NOT NULL DEFAULT 0,
  tier2_submitted_at TEXT,
  tier2_verified_at TEXT, -- set only when admin explicitly confirms the ID/bank details are legitimate (separate from tier2_submitted_at, which just means the customer sent them)

  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_referral_distributor ON users(referral_distributor_id);

CREATE TABLE IF NOT EXISTS admins (
  id             TEXT PRIMARY KEY,
  email          TEXT UNIQUE NOT NULL,
  password_hash  TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Added manually by admin (Name, phone, place, time associated, bank details,
-- government ID photo). Login is by phone_number; password is system-generated
-- at creation time (first 4 letters of name + last 4 digits of phone) and
-- shown once to the admin to hand off - only the hash is stored here.
CREATE TABLE IF NOT EXISTS distributors (
  id                TEXT PRIMARY KEY,
  full_name         TEXT NOT NULL,
  phone_number      TEXT UNIQUE NOT NULL,
  place             TEXT NOT NULL,
  associated_since  TEXT NOT NULL,
  bank_name         TEXT NOT NULL,
  account_number    TEXT NOT NULL,
  account_name      TEXT NOT NULL,
  id_document_path  TEXT NOT NULL,
  password_hash     TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_distributors_phone ON distributors(phone_number);

CREATE TABLE IF NOT EXISTS qr_batches (
  id            TEXT PRIMARY KEY,
  batch_number  TEXT NOT NULL DEFAULT '',
  value         INTEGER NOT NULL,
  quantity      INTEGER NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS qr_codes (
  id          TEXT PRIMARY KEY,
  code        TEXT UNIQUE NOT NULL,
  value       INTEGER NOT NULL,
  batch_id    TEXT NOT NULL REFERENCES qr_batches(id),
  is_used     INTEGER NOT NULL DEFAULT 0,
  used_by     TEXT REFERENCES users(id),
  used_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_qr_codes_code ON qr_codes(code);
CREATE INDEX IF NOT EXISTS idx_qr_codes_batch ON qr_codes(batch_id);
CREATE INDEX IF NOT EXISTS idx_qr_codes_used ON qr_codes(is_used);

CREATE TABLE IF NOT EXISTS redemption_requests (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id),
  amount            INTEGER NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  rejection_reason  TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_redemptions_user ON redemption_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_redemptions_status ON redemption_requests(status);


-- Website contact form + trade partner applications (shown in /admin > Enquiries)
CREATE TABLE IF NOT EXISTS enquiries (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,                 -- contact | partner
  name        TEXT NOT NULL,
  email       TEXT,
  phone       TEXT,
  topic       TEXT,                          -- department (contact) or business model (partner)
  business    TEXT,
  city        TEXT,
  message     TEXT,
  status      TEXT NOT NULL DEFAULT 'new',   -- new | read | replied | archived
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_enquiries_status ON enquiries(status, created_at);
