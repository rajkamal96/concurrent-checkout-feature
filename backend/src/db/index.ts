import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

// Single shared pool for the process.
// Max 60 connections: handles 50 concurrent test requests smoothly
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 60,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle Postgres client', err);
});

export default pool;
