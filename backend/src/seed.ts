/**
 * Seed script — creates the DB tables and inserts 5 products.
 * Run with: npm run seed
 *
 * Products seeded:
 *   1. Dental Implant Kit       stock = 5   ← primary concurrency test target
 *   2. Ultrasonic Scaler        stock = 100
 *   3. Composite Resin Set      stock = 50
 *   4. Dental Bur Kit           stock = 25
 *   5. Disposable Gloves (Box)  stock = 0   ← out-of-stock test target
 */
import fs from 'fs';
import path from 'path';
import pool from './db';

async function seed(): Promise<void> {
  const schemaSQL = fs.readFileSync(
    path.join(__dirname, 'db', 'schema.sql'),
    'utf8'
  );

  console.log('📦 Running schema migrations...');
  await pool.query(schemaSQL);
  console.log('✅ Schema created');

  const products = [
    { name: 'Dental Implant Kit',      price: 4999.00, stock: 5   },
    { name: 'Ultrasonic Scaler Pro',   price: 12999.00, stock: 100 },
    { name: 'Composite Resin Set',     price: 1499.00, stock: 50  },
    { name: 'Diamond Dental Bur Kit',  price: 2299.00, stock: 25  },
    { name: 'Disposable Gloves (Box)', price: 299.00,  stock: 0   },
  ];

  console.log('🌱 Seeding products...');
  for (const p of products) {
    await pool.query(
      `INSERT INTO products (name, price, stock) VALUES ($1, $2, $3)`,
      [p.name, p.price, p.stock]
    );
    console.log(`   ✓ ${p.name} (stock: ${p.stock})`);
  }

  console.log('\n✅ Seed complete. Products:');
  const { rows } = await pool.query('SELECT id, name, price, stock FROM products ORDER BY id');
  console.table(rows);

  await pool.end();
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
