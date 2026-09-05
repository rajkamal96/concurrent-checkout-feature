-- DentalKart Checkout Schema
-- Drop tables in reverse dependency order (for idempotent re-runs)
DROP TABLE IF EXISTS idempotency_keys CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS products CASCADE;

-- Products table
-- CHECK constraint is the last line of defence: Postgres will reject
-- any UPDATE that would take stock below 0, even if app logic has a bug.
CREATE TABLE products (
  id        SERIAL PRIMARY KEY,
  name      TEXT           NOT NULL,
  price     NUMERIC(10, 2) NOT NULL,
  stock     INTEGER        NOT NULL,
  CONSTRAINT stock_non_negative CHECK (stock >= 0)
);

-- Orders table
CREATE TABLE orders (
  id          SERIAL PRIMARY KEY,
  product_id  INTEGER        NOT NULL REFERENCES products(id),
  quantity    INTEGER        NOT NULL,
  status      TEXT           NOT NULL DEFAULT 'paid',
  payment_ref TEXT,
  created_at  TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- Idempotency keys table
-- key          : the Idempotency-Key header value from the client
-- request_hash : SHA-256 of the request body (productId + quantity)
--                used to detect same-key-different-body → 409
-- status       : 'processing' | 'done' | 'failed'
-- response     : cached JSON response, stored after request completes
CREATE TABLE idempotency_keys (
  key          TEXT        PRIMARY KEY,
  request_hash TEXT        NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'processing',
  response     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookup during high concurrency
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_status ON idempotency_keys(status);
