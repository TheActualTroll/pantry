-- Migration number: 0014
-- Web push notifications and household-item stock checks.
-- Portable SQLite / D1.

-- Per-household product metadata. `kind` overrides the default derived from the
-- catalog (Open Products Facts => household, everything else => food).
-- Stock level answers (none / half / full) apply to household items, not food.
CREATE TABLE household_product_meta (
  household_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  kind TEXT NULL CHECK (kind IS NULL OR kind IN ('food', 'household')),
  full_quantity REAL NULL CHECK (full_quantity IS NULL OR full_quantity > 0),
  stock_level TEXT NULL CHECK (stock_level IS NULL OR stock_level IN ('none', 'half', 'full')),
  stock_level_at TEXT NULL,
  check_interval_days INTEGER NOT NULL DEFAULT 14 CHECK (check_interval_days BETWEEN 1 AND 365),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (household_id, product_id),
  FOREIGN KEY (household_id) REFERENCES households (id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
);

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT NULL,
  created_at TEXT NOT NULL,
  last_success_at TEXT NULL,
  FOREIGN KEY (user_id) REFERENCES "user" (id) ON DELETE CASCADE
);

CREATE INDEX push_subscriptions_user_id_idx ON push_subscriptions (user_id);

CREATE TABLE notification_preferences (
  user_id TEXT PRIMARY KEY,
  expiry_enabled INTEGER NOT NULL DEFAULT 1 CHECK (expiry_enabled IN (0, 1)),
  low_stock_enabled INTEGER NOT NULL DEFAULT 1 CHECK (low_stock_enabled IN (0, 1)),
  stock_checks_enabled INTEGER NOT NULL DEFAULT 1 CHECK (stock_checks_enabled IN (0, 1)),
  expiry_lead_days INTEGER NOT NULL DEFAULT 3 CHECK (expiry_lead_days BETWEEN 0 AND 14),
  notify_hour INTEGER NOT NULL DEFAULT 9 CHECK (notify_hour BETWEEN 0 AND 23),
  timezone TEXT NOT NULL DEFAULT 'UTC',
  last_run_on TEXT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES "user" (id) ON DELETE CASCADE
);

-- Dedupe: one row per notification already sent, so a daily run never repeats it.
CREATE TABLE notification_events (
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('expiry', 'low_stock', 'stock_check')),
  ref_key TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (user_id, kind, ref_key),
  FOREIGN KEY (user_id) REFERENCES "user" (id) ON DELETE CASCADE
);

CREATE INDEX notification_events_sent_at_idx ON notification_events (sent_at);
