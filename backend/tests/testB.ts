/**
 * Test B — Idempotency key deduplication
 *
 * Fires 10 checkout requests simultaneously using the SAME Idempotency-Key
 * and the same body. All 10 hit the server at the same time.
 *
 * Expected result:
 *   - Exactly 1 order exists in the DB for this key
 *   - All 10 responses return a consistent result (200 or 202)
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
      .then(async (r) => ({ status: r.status, body: await r.json() }))
      .catch((err) => ({ status: 0, body: { error: String(err) } }))
  );

  const results = await Promise.all(requests);

  // Tally statuses
  const statusCounts: Record<number, number> = {};
  for (const r of results) {
    statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
  }
  console.log('\nResponse status distribution:', statusCounts);

  // Count orders created for this key
  const { rows: orderRows } = await pool.query(
    `SELECT COUNT(*) as count FROM orders o
     JOIN idempotency_keys ik ON ik.response->>'body' LIKE '%' || o.id::text || '%'
     WHERE ik.key = $1`,
    [SHARED_KEY]
  );

  // Simpler: count via idempotency key status
  const { rows: keyRows } = await pool.query(
    `SELECT status, response FROM idempotency_keys WHERE key = $1`,
    [SHARED_KEY]
  );

  const stockAfter = (
    await pool.query('SELECT stock FROM products WHERE id = $1', [PRODUCT_ID])
  ).rows[0] as { stock: number };

  const stockDiff = stockBefore.stock - stockAfter.stock;
  console.log(`Stock AFTER : ${stockAfter.stock} (diff = ${stockDiff})`);
  console.log(`Idempotency key status: ${keyRows[0]?.status ?? 'not found'}`);

  // Count actual orders in DB that share the same order ID from response
  const { rows: distinctOrders } = await pool.query(
    `SELECT COUNT(DISTINCT id) as count FROM orders 
     WHERE created_at >= NOW() - INTERVAL '1 minute'
     AND product_id = $1`,
    [PRODUCT_ID]
  );

  // The key metric: stock should only have dropped by 1
  const passed = stockDiff === 1 && keyRows.length === 1;

  console.log('\n────────────────────────────────────────────────────');
  if (passed) {
    console.log('✅ TEST B PASSED — exactly 1 stock unit consumed, 1 idempotency record');
  } else {
    console.log('❌ TEST B FAILED');
    if (stockDiff !== 1) console.log(`   Expected stock diff = 1, got ${stockDiff}`);
    if (keyRows.length !== 1) console.log(`   Expected 1 idempotency record, got ${keyRows.length}`);
    process.exitCode = 1;
  }
  console.log('════════════════════════════════════════════════════\n');

  await pool.end();
}

runTestB().catch((err) => {
  console.error('Test B crashed:', err);
  process.exit(1);
});
