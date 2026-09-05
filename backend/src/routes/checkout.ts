import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import pool from '../db';
import { fakePayment, paymentTimeout } from '../services/payment';

const router = Router();

// Payment timeout in milliseconds.
// The assignment says the provider can hang for up to 8 s,
// so we cut it off at 6 s to give headroom for compensation.
const PAYMENT_TIMEOUT_MS = 6_000;

/**
 * Build a deterministic hash of the request body.
 * Used to detect same-key-different-body (→ 409 Conflict).
 */
function hashBody(productId: number, quantity: number): string {
  return crypto
    .createHash('sha256')
    .update(`${productId}:${quantity}`)
    .digest('hex');
}

/**
 * POST /checkout
 *
 * Required header : Idempotency-Key  (any unique string, e.g. UUID)
 * Required body   : { productId: number, quantity: number }
 *
 * Returns:
 *   200 { orderId, status }               — success
 *   400                                   — bad input / missing header
 *   402                                   — payment failed or timed out
 *   404                                   — product not found
 *   409 { error: 'out_of_stock' }         — not enough stock
 *   409 { error: 'key_conflict' }         — same key, different body
 *   202                                   — same key still processing
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  // ── 1. Validate inputs ─────────────────────────────────────────────────────
  const idempotencyKey = req.headers['idempotency-key'];
  if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim() === '') {
    res.status(400).json({ error: 'Missing or empty Idempotency-Key header' });
    return;
  }

  const { productId, quantity } = req.body as { productId?: unknown; quantity?: unknown };

  if (typeof productId !== 'number' || !Number.isInteger(productId) || productId <= 0) {
    res.status(400).json({ error: 'productId must be a positive integer' });
    return;
  }

  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity <= 0) {
    res.status(400).json({ error: 'quantity must be a positive integer' });
    return;
  }

  const requestHash = hashBody(productId, quantity);

  // ── 2. Idempotency check ───────────────────────────────────────────────────
  // Attempt to claim the key atomically.
  // ON CONFLICT DO NOTHING means if the key already exists, rowCount = 0.
  const insertResult = await pool.query(
    `INSERT INTO idempotency_keys (key, request_hash, status)
     VALUES ($1, $2, 'processing')
     ON CONFLICT (key) DO NOTHING`,
    [idempotencyKey, requestHash]
  );

  if (insertResult.rowCount === 0) {
    // Key already exists — fetch the existing record
    const { rows } = await pool.query(
      `SELECT request_hash, status, response FROM idempotency_keys WHERE key = $1`,
      [idempotencyKey]
    );
    const existing = rows[0];

    // Same key, different body → 409
    if (existing.request_hash !== requestHash) {
      res.status(409).json({ error: 'key_conflict', message: 'Idempotency-Key already used with a different request body' });
      return;
    }

    // Same key, same body, still processing → 202
    if (existing.status === 'processing') {
      res.status(202).json({ message: 'Request is still being processed' });
      return;
    }

    // Same key, same body, already completed → replay cached response
    const cached = existing.response as { statusCode: number; body: Record<string, unknown> };
    res.status(cached.statusCode).json(cached.body);
    return;
  }

  // ── 3. Reserve stock atomically (SELECT … FOR UPDATE) ─────────────────────
  // We acquire a row-level lock on the product row.
  // Any other concurrent transaction trying to lock the same row WAITS here.
  // This ensures exactly one transaction at a time can read-then-modify stock.
  //
  // The transaction is kept SHORT on purpose — we commit as soon as stock is
  // decremented, BEFORE calling the external payment provider.
  // Holding FOR UPDATE across an 8-second HTTP call would block every other
  // checkout for the same product for 8 seconds.
  const client = await pool.connect();
  let stockReserved = false;

  try {
    await client.query('BEGIN');

    const { rows: productRows } = await client.query(
      `SELECT id, name, stock FROM products WHERE id = $1 FOR UPDATE`,
      [productId]
    );

    if (productRows.length === 0) {
      await client.query('ROLLBACK');
      await updateIdempotencyKey(idempotencyKey, 'failed', 404, { error: 'Product not found' });
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    const product = productRows[0] as { id: number; name: string; stock: number };

    if (product.stock < quantity) {
      await client.query('ROLLBACK');
      await updateIdempotencyKey(idempotencyKey, 'failed', 409, { error: 'out_of_stock', message: 'Not enough stock available' });
      res.status(409).json({ error: 'out_of_stock', message: 'Not enough stock available' });
      return;
    }

    // Decrement stock — protected by the FOR UPDATE lock above
    await client.query(
      `UPDATE products SET stock = stock - $1 WHERE id = $2`,
      [quantity, productId]
    );

    await client.query('COMMIT');
    stockReserved = true;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {}); // best-effort rollback
    await updateIdempotencyKey(idempotencyKey, 'failed', 500, { error: 'Internal server error' });
    throw err; // let global error handler respond
  } finally {
    client.release();
  }

  // ── 4. Call payment provider (OUTSIDE the DB transaction) ─────────────────
  // Stock is already decremented and committed. If payment fails, we compensate
  // by adding the stock back. This two-phase approach avoids holding the
  // FOR UPDATE lock during a potentially long external call.
  try {
    const paymentResult = await Promise.race([
      fakePayment(),
      paymentTimeout(PAYMENT_TIMEOUT_MS),
    ]);

    // ── 5. Create the order ────────────────────────────────────────────────
    const { rows: orderRows } = await pool.query(
      `INSERT INTO orders (product_id, quantity, status, payment_ref)
       VALUES ($1, $2, 'paid', $3)
       RETURNING id`,
      [productId, quantity, paymentResult.ref]
    );

    const orderId = (orderRows[0] as { id: number }).id;
    const responseBody = { orderId, status: 'paid' };

    await updateIdempotencyKey(idempotencyKey, 'done', 200, responseBody);
    res.status(200).json(responseBody);

  } catch (paymentErr) {
    // Payment failed or timed out — put the stock back
    if (stockReserved) {
      await pool
        .query(`UPDATE products SET stock = stock + $1 WHERE id = $2`, [quantity, productId])
        .catch((compensationErr) => {
          // Log for production alerting — this is the known limitation
          console.error('CRITICAL: Stock compensation failed!', compensationErr);
        });
    }

    const errMessage = paymentErr instanceof Error ? paymentErr.message : 'Payment failed';
    await updateIdempotencyKey(idempotencyKey, 'failed', 402, { error: 'payment_failed', message: errMessage });
    res.status(402).json({ error: 'payment_failed', message: errMessage });
  }
});

/**
 * Helper: update an idempotency key's status and cache the response.
 */
async function updateIdempotencyKey(
  key: string,
  status: 'done' | 'failed',
  statusCode: number,
  body: Record<string, unknown>
): Promise<void> {
  await pool.query(
    `UPDATE idempotency_keys SET status = $1, response = $2 WHERE key = $3`,
    [status, JSON.stringify({ statusCode, body }), key]
  );
}

export default router;
