-- ================================================================
-- SWAPPY DATABASE SCHEMA
-- Run this file once to create all tables.
-- Command: psql -U postgres -d swappy_db -f schema.sql
-- (or simply: npm run migrate)
-- ================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── USERS ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            VARCHAR(100),
  phone           VARCHAR(15) UNIQUE NOT NULL,
  email           VARCHAR(150) UNIQUE,
  avatar_initials VARCHAR(3),
  location        VARCHAR(200),
  city            VARCHAR(100),
  bio             TEXT,
  is_verified     BOOLEAN DEFAULT FALSE,
  is_id_verified  BOOLEAN DEFAULT FALSE,
  rating          DECIMAL(3,2) DEFAULT 0.00,
  review_count    INTEGER DEFAULT 0,
  total_swaps     INTEGER DEFAULT 0,
  saved_amount    INTEGER DEFAULT 0,
  is_active       BOOLEAN DEFAULT TRUE,
  last_active_at  TIMESTAMP,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

-- ─── OTP STORE ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS otps (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone       VARCHAR(15) NOT NULL,
  otp_hash    VARCHAR(255) NOT NULL,
  expires_at  TIMESTAMP NOT NULL,
  used        BOOLEAN DEFAULT FALSE,
  attempts    INTEGER DEFAULT 0,
  created_at  TIMESTAMP DEFAULT NOW()
);

-- ─── REFRESH TOKENS ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  token_hash  VARCHAR(255) NOT NULL,
  expires_at  TIMESTAMP NOT NULL,
  created_at  TIMESTAMP DEFAULT NOW()
);

-- ─── VALUE BANDS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS value_bands (
  band        CHAR(1) PRIMARY KEY,
  label       VARCHAR(20) NOT NULL,
  min_price   INTEGER NOT NULL,
  max_price   INTEGER,
  color_hex   VARCHAR(7)
);

INSERT INTO value_bands (band, label, min_price, max_price, color_hex) VALUES
  ('A', 'Band A', 500,   1499,  '#16A34A'),
  ('B', 'Band B', 1500,  3999,  '#1D4ED8'),
  ('C', 'Band C', 4000,  9999,  '#B45309'),
  ('D', 'Band D', 10000, 24999, '#7C3AED'),
  ('E', 'Band E', 25000, NULL,  '#DC2626')
ON CONFLICT (band) DO NOTHING;

-- ─── ITEMS ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS items (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  title           VARCHAR(200) NOT NULL,
  description     TEXT,
  category        VARCHAR(50) NOT NULL,
  condition       VARCHAR(20) NOT NULL CHECK (condition IN ('Like New','Excellent','Good','Fair')),
  band            CHAR(1) REFERENCES value_bands(band),
  original_price  INTEGER NOT NULL,
  wants           TEXT NOT NULL,
  emoji           VARCHAR(10) DEFAULT '📦',
  status          VARCHAR(20) DEFAULT 'pending_verification'
                  CHECK (status IN ('pending_verification','active','locked','swapped','removed')),
  ai_verified     BOOLEAN DEFAULT FALSE,
  ai_score        DECIMAL(3,2),
  views           INTEGER DEFAULT 0,
  saves           INTEGER DEFAULT 0,
  offer_count     INTEGER DEFAULT 0,
  city            VARCHAR(100),
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

-- ─── ITEM IMAGES ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS item_images (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id     UUID REFERENCES items(id) ON DELETE CASCADE,
  url         VARCHAR(500) NOT NULL,
  is_primary  BOOLEAN DEFAULT FALSE,
  type        VARCHAR(10) DEFAULT 'image' CHECK (type IN ('image','video')),
  created_at  TIMESTAMP DEFAULT NOW()
);

-- ─── SAVED ITEMS (wishlist / heart icon) ──────────────────────────
CREATE TABLE IF NOT EXISTS saved_items (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  item_id    UUID REFERENCES items(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, item_id)
);

-- ─── INTERESTS ───────────────────────────────────────────────────
-- Explicit "I want this in a swap" signal, captured from the swipe-right
-- gesture described in the deck. This is the raw data the Triangle Swap
-- matcher runs against (a real stand-in for the "AI model" the deck says
-- is needed — see triangleController.js for the matching logic).
CREATE TABLE IF NOT EXISTS interests (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID REFERENCES users(id) ON DELETE CASCADE,   -- who wants it
  item_id    UUID REFERENCES items(id) ON DELETE CASCADE,   -- the item they want
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, item_id)
);

-- ─── SWAPS (direct & multi-item) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS swaps (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type            VARCHAR(20) NOT NULL CHECK (type IN ('direct','multi','triangle')),
  status          VARCHAR(20) DEFAULT 'pending'
                  CHECK (status IN ('pending','accepted','declined','cancelled','completed','disputed')),
  initiator_id    UUID REFERENCES users(id),
  receiver_id     UUID REFERENCES users(id),
  note            TEXT,
  delivery_type   VARCHAR(20) DEFAULT 'meetup' CHECK (delivery_type IN ('meetup','delivery')),
  delivery_cost   INTEGER DEFAULT 0,
  accepted_at     TIMESTAMP,
  completed_at    TIMESTAMP,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

-- ─── SWAP ITEMS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS swap_items (
  id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  swap_id   UUID REFERENCES swaps(id) ON DELETE CASCADE,
  item_id   UUID REFERENCES items(id),
  user_id   UUID REFERENCES users(id),
  role      VARCHAR(10) CHECK (role IN ('offer','request'))
);

-- ─── TRIANGLE SWAPS ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS triangle_swaps (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  status          VARCHAR(20) DEFAULT 'pending'
                  CHECK (status IN ('pending','all_confirmed','completed','cancelled')),
  user_a_id       UUID REFERENCES users(id),
  user_b_id       UUID REFERENCES users(id),
  user_c_id       UUID REFERENCES users(id),
  item_from_a     UUID REFERENCES items(id),  -- A gives this, B receives
  item_from_b     UUID REFERENCES items(id),  -- B gives this, C receives
  item_from_c     UUID REFERENCES items(id),  -- C gives this, A receives
  confirmed_a     BOOLEAN DEFAULT FALSE,
  confirmed_b     BOOLEAN DEFAULT FALSE,
  confirmed_c     BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

-- ─── RATINGS ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ratings (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  swap_id     UUID REFERENCES swaps(id),
  rater_id    UUID REFERENCES users(id),
  ratee_id    UUID REFERENCES users(id),
  score       INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment     TEXT,
  created_at  TIMESTAMP DEFAULT NOW(),
  UNIQUE(swap_id, rater_id)
);

-- ─── NOTIFICATIONS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  type        VARCHAR(30) NOT NULL,
  title       VARCHAR(200) NOT NULL,
  body        TEXT NOT NULL,
  data        JSONB DEFAULT '{}',
  is_read     BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMP DEFAULT NOW()
);

-- ─── REPORTS / DISPUTES ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reports (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reporter_id   UUID REFERENCES users(id),
  reported_id   UUID REFERENCES users(id),
  swap_id       UUID REFERENCES swaps(id),
  item_id       UUID REFERENCES items(id),
  reason        VARCHAR(50) NOT NULL,
  description   TEXT,
  status        VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open','reviewing','resolved','dismissed')),
  resolved_by   UUID REFERENCES users(id),
  created_at    TIMESTAMP DEFAULT NOW()
);

-- ─── INDEXES ─────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_items_user_id    ON items(user_id);
CREATE INDEX IF NOT EXISTS idx_items_status     ON items(status);
CREATE INDEX IF NOT EXISTS idx_items_band       ON items(band);
CREATE INDEX IF NOT EXISTS idx_items_category   ON items(category);
CREATE INDEX IF NOT EXISTS idx_items_city       ON items(city);
CREATE INDEX IF NOT EXISTS idx_items_created_at ON items(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_swaps_initiator  ON swaps(initiator_id);
CREATE INDEX IF NOT EXISTS idx_swaps_receiver   ON swaps(receiver_id);
CREATE INDEX IF NOT EXISTS idx_swaps_status     ON swaps(status);

CREATE INDEX IF NOT EXISTS idx_notifs_user_id   ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifs_read      ON notifications(is_read);

CREATE INDEX IF NOT EXISTS idx_saved_user       ON saved_items(user_id);
CREATE INDEX IF NOT EXISTS idx_interests_user   ON interests(user_id);
CREATE INDEX IF NOT EXISTS idx_interests_item   ON interests(item_id);
CREATE INDEX IF NOT EXISTS idx_otps_phone       ON otps(phone);

-- ─── AUTO-UPDATE updated_at ──────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_items_updated_at ON items;
CREATE TRIGGER trg_items_updated_at
  BEFORE UPDATE ON items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_swaps_updated_at ON swaps;
CREATE TRIGGER trg_swaps_updated_at
  BEFORE UPDATE ON swaps
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── AUTO-UPDATE user rating after each new rating ───────────────
CREATE OR REPLACE FUNCTION refresh_user_rating()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE users
  SET
    rating       = (SELECT ROUND(AVG(score)::numeric, 2) FROM ratings WHERE ratee_id = NEW.ratee_id),
    review_count = (SELECT COUNT(*) FROM ratings WHERE ratee_id = NEW.ratee_id)
  WHERE id = NEW.ratee_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_refresh_rating ON ratings;
CREATE TRIGGER trg_refresh_rating
  AFTER INSERT ON ratings
  FOR EACH ROW EXECUTE FUNCTION refresh_user_rating();

SELECT 'Swappy schema created successfully ✅' AS status;
