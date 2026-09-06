/**
 * Test B — Idempotency key deduplication
 *
 * Fires 10 checkout requests simultaneously using the SAME Idempotency-Key
 * and the same body. All 10 hit the server at the same time.
 *
 * Expected result:
 *   - Exactly 1 order exists in the DB for this key
 *   - All 200 responses carry the same orderId
 *   - Stock is decremented by exactly 1 (not 10)
 */
import pool from '../src/db';

const BASE_URL = process.env.API_URL ?? 'http://localhost:3001';
const PRODUCT_ID = 2; // Ultrasonic Scaler Pro — stock = 100 (won't run out)
const SHARED_KEY = `test-b-idempotency-${Date.now()}`;
const CONCURRENCY = 10;

async function runTestB(): Promise<void> {
  console.log('════════════════════════════════════════════════════');
  console.log('TEST B — 10 concurrent requests with same Idempotency-Key');
  console.log('════════════════════════════════════════════════════\n');
  console.log(`Shared key: ${SHARED_KEY}`);

  const stockBefore = (
    await pool.query('SELECT stock FROM products WHERE id = $1', [PRODUCT_ID])
  ).rows[0] as { stock: number };
  console.log(`Stock BEFORE: ${stockBefore.stock}`);

  // Fire all 10 with the same key simultaneously
  const requests = Array.from({ length: CONCURRENCY }, () =>
    fetch(`${BASE_URL}/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': SHARED_KEY,
      },
      body: JSON.stringify({ productId: PRODUCT_ID, quantity: 1 }),
    })
      .then(async (r) => ({ status: r.status, body: await r.json() as Record<string, unknown> }))
      .catch((err) => ({ status: 0, body: { error: String(err) } as Record<string, unknown> }))
  );

  const results = await Promise.all(requests);

  // Tally statuses
  const statusCounts: Record<number, number> = {};
  for (const r of results) {
    statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
  }
  console.log('\nResponse status distribution:', statusCounts);

  // ── Check 1: All 200 responses must carry the same orderId ─────────────────
  const successResponses = results.filter((r) => r.status === 200);
  const orderIds = successResponses.map((r) => (r.body as { orderId?: number }).orderId);
  const uniqueOrderIds = new Set(orderIds);

  console.log(`\nSuccessful (200) responses  : ${successResponses.length}`);
  console.log(`Unique orderIds in 200s     : ${[...uniqueOrderIds].join(', ') || 'none'}`);

  // ── Check 2: Verify exactly 1 row in orders table for this orderId ──────────
  let orderCountInDb = 0;
  if (uniqueOrderIds.size === 1) {
    const [theOrderId] = uniqueOrderIds;
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS count FROM orders WHERE id = $1`,
      [theOrderId]
    );
    orderCountInDb = parseInt((rows[0] as { count: string }).count, 10);
  }
  console.log(`Orders in DB for that id    : ${orderCountInDb}`);

  // ── Check 3: Stock diff ─────────────────────────────────────────────────────
  const stockAfter = (
    await pool.query('SELECT stock FROM products WHERE id = $1', [PRODUCT_ID])
  ).rows[0] as { stock: number };
  const stockDiff = stockBefore.stock - stockAfter.stock;

  console.log(`Stock AFTER : ${stockAfter.stock} (diff = ${stockDiff})`);

  // ── Check 4: Idempotency key record ────────────────────────────────────────
  const { rows: keyRows } = await pool.query(
    `SELECT status FROM idempotency_keys WHERE key = $1`,
    [SHARED_KEY]
  );
  console.log(`Idempotency key status      : ${keyRows[0]?.status ?? 'not found'}`);

  // ── Assertion ───────────────────────────────────────────────────────────────
  const passed =
    uniqueOrderIds.size === 1 &&   // all 200 responses agree on one orderId
    orderCountInDb === 1 &&         // that orderId exists exactly once in the DB
    stockDiff === 1 &&              // stock decreased by exactly 1 (not 10)
    keyRows.length === 1;           // one idempotency record

  console.log('\n────────────────────────────────────────────────────');
  if (passed) {
    console.log('✅ TEST B PASSED — exactly 1 order in DB, 1 stock unit consumed');
  } else {
    console.log('❌ TEST B FAILED');
    if (uniqueOrderIds.size !== 1)
      console.log(`   Expected all 200 responses to share 1 orderId, got ${uniqueOrderIds.size} unique ids`);
    if (orderCountInDb !== 1)
      console.log(`   Expected 1 order row in DB, got ${orderCountInDb}`);
    if (stockDiff !== 1)
      console.log(`   Expected stock diff = 1, got ${stockDiff}`);
    if (keyRows.length !== 1)
      console.log(`   Expected 1 idempotency record, got ${keyRows.length}`);
    process.exitCode = 1;
  }
  console.log('════════════════════════════════════════════════════\n');

  await pool.end();
}

runTestB().catch((err) => {
  console.error('Test B crashed:', err);
  process.exit(1);
});
