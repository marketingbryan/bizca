-- Bizca — shared multi-tenant schema.
-- Every business table carries company_id: one company can never read another's rows.

CREATE TABLE IF NOT EXISTS companies (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  domain        TEXT NOT NULL,
  locale        TEXT NOT NULL DEFAULT 'en',
  settings      JSONB NOT NULL DEFAULT '{}'::jsonb,  -- brevoApiKey, autoSend, requireConsent, allowOverride, fallbackOwner
  privacy_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name           TEXT NOT NULL DEFAULT '',
  email          TEXT NOT NULL,
  password_hash  TEXT,
  role           TEXT NOT NULL DEFAULT 'seller',
  status         TEXT NOT NULL DEFAULT 'active',
  email_verified BOOLEAN NOT NULL DEFAULT false,
  verify_token   TEXT,
  verify_sent_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (lower(email));
CREATE INDEX IF NOT EXISTS users_company_idx ON users (company_id);

CREATE TABLE IF NOT EXISTS events (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  start_date    DATE,
  end_date      DATE,
  status        TEXT NOT NULL DEFAULT 'open',
  preset        JSONB NOT NULL DEFAULT '{}'::jsonb,
  brevo_list_id INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_company_idx ON events (company_id);

-- kind: 'source' | 'segment'
CREATE TABLE IF NOT EXISTS picklists (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  value      TEXT NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS picklists_company_idx ON picklists (company_id, kind);

CREATE TABLE IF NOT EXISTS rules (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  priority   INTEGER NOT NULL DEFAULT 1,
  countries  JSONB NOT NULL DEFAULT '[]'::jsonb,
  segments   JSONB NOT NULL DEFAULT '[]'::jsonb,
  owner_id   TEXT,
  active     BOOLEAN NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS rules_company_idx ON rules (company_id);

CREATE TABLE IF NOT EXISTS leads (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  event_id      TEXT,
  owner_id      TEXT,
  created_by    TEXT,
  first_name    TEXT DEFAULT '',
  last_name     TEXT DEFAULT '',
  company_name  TEXT DEFAULT '',
  role_title    TEXT DEFAULT '',
  email         TEXT DEFAULT '',
  phone         TEXT DEFAULT '',
  website       TEXT DEFAULT '',
  address       TEXT DEFAULT '',
  source        TEXT DEFAULT '',
  country       TEXT DEFAULT '',
  segment       TEXT DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'To finalize',
  override_flag BOOLEAN NOT NULL DEFAULT false,
  error         TEXT,
  card_image    TEXT,
  consent_at    TIMESTAMPTZ,
  consent_sig   TEXT,
  captured_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leads_company_idx ON leads (company_id);
CREATE INDEX IF NOT EXISTS leads_owner_idx ON leads (company_id, owner_id);

CREATE TABLE IF NOT EXISTS sync_log (
  id         BIGSERIAL PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  lead_id    TEXT,
  dest       TEXT,
  ok         BOOLEAN,
  msg        TEXT,
  ts         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sync_log_company_idx ON sync_log (company_id, ts DESC);
