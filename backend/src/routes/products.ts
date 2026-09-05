import { Router, Request, Response } from 'express';
import pool from '../db';

const router = Router();

// GET /products — list all products
router.get('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, price, stock FROM products ORDER BY id'
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /products error:', err);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// GET /products/:id — single product
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id, 10);

  if (isNaN(id)) {
    res.status(400).json({ error: 'Product ID must be a number' });
    return;
  }

  try {
    const { rows } = await pool.query(
      'SELECT id, name, price, stock FROM products WHERE id = $1',
      [id]
    );

    if (rows.length === 0) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('GET /products/:id error:', err);
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

export default router;
