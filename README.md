# DentalKart — Concurrent Checkout

A small e-commerce checkout that **never oversells stock** and **never creates duplicate orders**, even under high concurrency. Built as a take-home assignment for DentalKart (Senior SDE role).

---

## Run in 5 commands

```bash
# 1. Clone and enter the repo
git clone <repo-url> && cd concurrent-checkout-feature

# 2. Install backend dependencies and configure environment
cd backend && cp .env.example .env
# Edit .env — set DATABASE_URL to your Postgres connection string

# 3. Create the database tables and seed 5 products
npm install && npm run seed

# 4. Start the backend (port 3001)
npm run dev

# 5. In a second terminal — start the frontend (port 3000)
cd ../frontend && npm install && npm run dev
```

Open **http://localhost:3000** to use the app.

---

## Environment variables (`backend/.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | — | Postgres connection string (required) |
| `PORT` | `3001` | Backend port |
| `PAYMENT_MODE` | `succeed` | `succeed` \| `fail` \| `hang` (controls fake payment) |

---

## API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/products` | List all products |
| `GET` | `/products/:id` | Single product |
| `POST` | `/checkout` | Place an order (requires `Idempotency-Key` header) |
| `GET` | `/health` | Health check |

---

## Tests

Run each test while the backend is running (`npm run dev` in `backend/`).

### Test A — 50 concurrent requests, stock = 5 → exactly 5 succeed

```bash
npm run test:a
```

**Output:**
```
═══════════════════════════════════════════
TEST A — 50 concurrent requests, stock = 5
═══════════════════════════════════════════

Stock BEFORE: 5

Results (50 requests):
  ✅ 200 success       : 5
  ⛔ 409 out_of_stock  : 45
  ⚠️  Other            : 0

Stock AFTER : 0

───────────────────────────────────────────
✅ TEST A PASSED — exactly 5 succeeded, stock = 0
═══════════════════════════════════════════
```

### Test B — 10 requests with the same Idempotency-Key → 1 order

```bash
npm run test:b
```

**Output:**
```
════════════════════════════════════════════════════
TEST B — 10 concurrent requests with same Idempotency-Key
════════════════════════════════════════════════════

Shared key: test-b-idempotency-1788698538318
Stock BEFORE: 100

Response status distribution: { '200': 7, '202': 3 }
Successful (200) responses  : 7
Distinct orderIds in 200s   : 1 (ids: 6)
Orders in DB for that id    : 1
Stock AFTER : 99 (diff = 1)
Idempotency key status      : done

────────────────────────────────────────────────────
✅ TEST B PASSED — exactly 1 order in DB, 1 stock unit consumed
════════════════════════════════════════════════════
```

### Test C — Payment fails → stock unchanged

```bash
# Restart backend with: PAYMENT_MODE=fail npm run dev
npm run test:c
```

**Output:**
```
══════════════════════════════════════════════
TEST C — Payment failure → stock must be unchanged
══════════════════════════════════════════════

Stock BEFORE checkout: 50

Checkout response: HTTP 402
Response body: {
  "error": "payment_failed",
  "message": "Payment declined by provider"
}

Stock AFTER checkout: 50

──────────────────────────────────────────────
✅ TEST C PASSED — payment failed (402), stock unchanged
══════════════════════════════════════════════
```

---

## Project structure

```
concurrent-checkout-feature/
├── backend/
│   ├── src/
│   │   ├── db/
│   │   │   ├── index.ts          # pg Pool (max 20 connections)
│   │   │   └── schema.sql        # products, orders, idempotency_keys tables
│   │   ├── routes/
│   │   │   ├── products.ts       # GET /products, GET /products/:id
│   │   │   └── checkout.ts       # POST /checkout — the core correctness logic
│   │   ├── services/
│   │   │   └── payment.ts        # Fake payment (succeed / fail / hang)
│   │   ├── seed.ts               # Creates tables and seeds 5 products
│   │   └── index.ts              # Express app entry
│   ├── tests/
│   │   ├── testA.ts              # 50 concurrent → exactly 5 succeed
│   │   ├── testB.ts              # 10 same key → 1 order
│   │   └── testC.ts              # payment=fail → stock unchanged
│   └── .env.example
├── frontend/
│   └── app/
│       └── page.tsx              # Product list + all buy button states
├── DESIGN.md                     # Part 1 write-up
└── README.md                     # This file
```

---

## How the two hard problems are solved

**Overselling:** `SELECT … FOR UPDATE` inside a Postgres transaction locks the product row. A second concurrent request for the same product waits at the lock, then reads the updated stock after the first commits. Stock can never go negative — a `CHECK (stock >= 0)` constraint enforces this at the DB level too.

**Duplicate orders:** Every request must carry an `Idempotency-Key` header. The server claims it with `INSERT … ON CONFLICT DO NOTHING`. If 0 rows were inserted, the key was already seen — the cached response is returned immediately, with no stock or payment touched.

Payment runs **outside** the database transaction — this avoids holding the row-level lock during an 8-second external call.

See `DESIGN.md` for the full flow diagram and decision log.

---

## Known limitations

1. **Crash between stock deduction and payment:** If the process crashes after stock is decremented but before payment completes, the `idempotency_keys` row stays as `processing` and no order is created. Stock is unreachable until manually corrected. **Production fix:** saga/outbox pattern with a background reconciliation job that detects `processing` keys older than N minutes and triggers a stock refund.

2. **No payment webhook handler:** The assignment doesn't require one. In production, the webhook endpoint would use the same idempotency (`UPDATE orders SET status='paid' WHERE payment_ref=? AND status='pending'`) so duplicate webhooks are naturally safe.

3. **Connection pool is not tuned for 100k RPS:** The default pool of 20 connections handles the test load (50 concurrent) fine. At 100k requests/minute, you'd need connection pooling middleware (PgBouncer) in front of Postgres.

4. **No rate limiting or auth:** Out of scope per assignment rules.

5. **Stock compensation is best-effort:** If the compensation `UPDATE` (stock put-back on payment failure) itself fails, stock is permanently lost. Production fix: transactional outbox — write the compensation event to the DB atomically, then process it reliably.

6. **`Promise.race` does not cancel the underlying payment call:** After the 6-second timeout fires and stock is returned, the `fakePayment()` call continues running silently in the background. With a real provider, this means a charge could succeed *after* the timeout — resulting in a customer who was charged but received no order. Production fix: use `AbortController` + `fetch` signal to actually abort the HTTP call, then reconcile via the provider's webhook.