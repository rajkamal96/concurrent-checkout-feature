/**
 * Test C — Payment failure → stock unchanged
 *
 * Switches PAYMENT_MODE to 'fail', records stock before,
 * runs a checkout, then verifies stock is identical after.
 *
 * Note: This test requires the server to be started with PAYMENT_MODE=fail.
 * The test script sends an extra query param to hint the mode, but the real
 * test is: run `PAYMENT_MODE=fail npm run dev` then `npm run test:c`.
 */
import pool from '../src/db';

const BASE_URL = process.env.API_URL ?? 'http://localhost:3001';
const PRODUCT_ID = 3; // Composite Resin Set — stock = 50

async function runTestC(): Promise<void> {
  console.log('══════════════════════════════════════════════');
  console.log('TEST C — Payment failure → stock must be unchanged');
  console.log('══════════════════════════════════════════════\n');
  console.log('⚠️  Make sure server is running with PAYMENT_MODE=fail');
  console.log('   (kill current server and run: PAYMENT_MODE=fail npm run dev)\n');

  const before = await pool.query('SELECT stock FROM products WHERE id = $1', [PRODUCT_ID]);
  const stockBefore = (before.rows[0] as { stock: number }).stock;
  console.log(`Stock BEFORE checkout: ${stockBefore}`);

  const key = `test-c-${Date.now()}`;
  const response = await fetch(`${BASE_URL}/checkout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    },
    body: JSON.stringify({ productId: PRODUCT_ID, quantity: 1 }),
  });

  const body = await response.json();
  console.log(`\nCheckout response: HTTP ${response.status}`);
  console.log('Response body:', JSON.stringify(body, null, 2));

  const after = await pool.query('SELECT stock FROM products WHERE id = $1', [PRODUCT_ID]);
  const stockAfter = (after.rows[0] as { stock: number }).stock;
  console.log(`\nStock AFTER checkout: ${stockAfter}`);

  const passed = response.status === 402 && stockBefore === stockAfter;

  console.log('\n──────────────────────────────────────────────');
  if (passed) {
    console.log('✅ TEST C PASSED — payment failed (402), stock unchanged');
  } else {
    console.log('❌ TEST C FAILED');
    if (response.status !== 402) console.log(`   Expected HTTP 402, got ${response.status}`);
    if (stockBefore !== stockAfter) console.log(`   Stock changed! Before=${stockBefore}, After=${stockAfter}`);
    process.exitCode = 1;
  }
  console.log('══════════════════════════════════════════════\n');

  await pool.end();
}

runTestC().catch((err) => {
  console.error('Test C crashed:', err);
  process.exit(1);
});
