/**
 * Test A — Concurrent stock safety
 *
 * Fires 50 checkout requests simultaneously at the product with stock = 5.
 * Each request has a unique Idempotency-Key.
 *
 * Expected result:
 *   - Exactly 5 requests succeed (HTTP 200)
 *   - Exactly 45 requests fail with out_of_stock (HTTP 409)
 *   - Final stock in the DB is exactly 0, never negative
 */
import pool from '../src/db';

const BASE_URL = process.env.API_URL ?? 'http://localhost:3001';
const PRODUCT_ID = 1; // Dental Implant Kit — stock = 5
const CONCURRENCY = 50;

async function runTestA(): Promise<void> {
  console.log('═══════════════════════════════════════════');
  console.log('TEST A — 50 concurrent requests, stock = 5');
  console.log('═══════════════════════════════════════════\n');

  // Record stock before
  const before = await pool.query('SELECT stock FROM products WHERE id = $1', [PRODUCT_ID]);
  const stockBefore = (before.rows[0] as { stock: number }).stock;
  console.log(`Stock BEFORE: ${stockBefore}`);

  // Fire all 50 requests simultaneously
  const requests = Array.from({ length: CONCURRENCY }, (_, i) =>
    fetch(`${BASE_URL}/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `test-a-${Date.now()}-${i}`,
      },
      body: JSON.stringify({ productId: PRODUCT_ID, quantity: 1 }),
    })
      .then(async (r) => ({ status: r.status, body: await r.json() }))
      .catch((err) => ({ status: 0, body: { error: String(err) } }))
  );

  const results = await Promise.all(requests);

  // Tally results
  const successes = results.filter((r) => r.status === 200);
  const outOfStock = results.filter((r) => r.status === 409);
  const others = results.filter((r) => r.status !== 200 && r.status !== 409);

  // Record stock after
  const after = await pool.query('SELECT stock FROM products WHERE id = $1', [PRODUCT_ID]);
  const stockAfter = (after.rows[0] as { stock: number }).stock;

  console.log(`\nResults (${CONCURRENCY} requests):`);
  console.log(`  ✅ 200 success       : ${successes.length}`);
  console.log(`  ⛔ 409 out_of_stock  : ${outOfStock.length}`);
  console.log(`  ⚠️  Other            : ${others.length}`);
  console.log(`\nStock AFTER : ${stockAfter}`);

  // Assertions
  const passed =
    successes.length === 5 &&
    stockAfter === 0 &&
    others.length === 0;

  console.log('\n───────────────────────────────────────────');
  if (passed) {
    console.log('✅ TEST A PASSED — exactly 5 succeeded, stock = 0');
  } else {
    console.log('❌ TEST A FAILED');
    if (successes.length !== 5) console.log(`   Expected 5 successes, got ${successes.length}`);
    if (stockAfter !== 0)       console.log(`   Expected stock = 0, got ${stockAfter}`);
    if (others.length > 0)      console.log(`   Unexpected responses: ${JSON.stringify(others)}`);
    process.exitCode = 1;
  }
  console.log('═══════════════════════════════════════════\n');

  await pool.end();
}

runTestA().catch((err) => {
  console.error('Test A crashed:', err);
  process.exit(1);
});
