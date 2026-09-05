"use client";

import { useEffect, useState, useRef } from "react";

// ── Types ────────────────────────────────────────────────────────────────────
interface Product {
  id: number;
  name: string;
  price: string;
  stock: number;
}

type BuyStatus =
  | { type: "idle" }
  | { type: "loading" }
  | { type: "success"; orderId: number }
  | { type: "error"; message: string }
  | { type: "out_of_stock" };

// ── ProductCard ──────────────────────────────────────────────────────────────
function ProductCard({ product }: { product: Product }) {
  const [qty, setQty] = useState(1);
  const [status, setStatus] = useState<BuyStatus>({ type: "idle" });
  // Ref holds the current idempotency key for this "buy attempt".
  // A new key is generated when the user clicks Buy fresh (not Retry).
  const idemKeyRef = useRef<string>("");

  const isOutOfStock = product.stock === 0;

  // Generate a fresh idempotency key for a brand-new buy attempt.
  function freshKey() {
    return `${product.id}-${Date.now()}-${crypto.randomUUID()}`;
  }

  async function doCheckout(idempotencyKey: string) {
    setStatus({ type: "loading" });

    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // The Idempotency-Key is set once per "attempt" and reused on
          // Retry — so a retry with the same key is safe (idempotent).
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({ productId: product.id, quantity: qty }),
      });

      const data = await res.json();

      if (res.ok) {
        setStatus({ type: "success", orderId: data.orderId });
      } else if (res.status === 409 && data.error === "out_of_stock") {
        setStatus({ type: "out_of_stock" });
      } else {
        setStatus({ type: "error", message: data.message ?? "Payment failed. Please try again." });
      }
    } catch {
      setStatus({ type: "error", message: "Network error. Please check your connection and try again." });
    }
  }

  // "Buy Now" — always a fresh idempotency key
  function handleBuy() {
    const key = freshKey();
    idemKeyRef.current = key;
    doCheckout(key);
  }

  // "Retry" — reuses the same key so the server treats it as an idempotent replay
  function handleRetry() {
    doCheckout(idemKeyRef.current);
  }

  return (
    <div className="card" id={`product-card-${product.id}`}>
      {/* Product info */}
      <div className="card-name">{product.name}</div>
      <div className="card-price">₹{parseFloat(product.price).toLocaleString("en-IN")}</div>
      <span className={`badge ${isOutOfStock ? "badge-out" : "badge-in"}`}>
        {isOutOfStock ? "Out of Stock" : `${product.stock} in stock`}
      </span>

      {/* Quantity picker — hidden while loading or after success */}
      {status.type !== "success" && !isOutOfStock && (
        <div className="qty-row">
          <label htmlFor={`qty-${product.id}`} className="qty-label">Qty:</label>
          <input
            id={`qty-${product.id}`}
            type="number"
            className="qty-input"
            min={1}
            max={product.stock}
            value={qty}
            onChange={(e) => setQty(Math.max(1, parseInt(e.target.value) || 1))}
            disabled={status.type === "loading"}
          />
        </div>
      )}

      {/* ── Buy button states ──────────────────────────────────────── */}
      {status.type === "idle" && !isOutOfStock && (
        <button
          id={`btn-buy-${product.id}`}
          className="btn btn-buy"
          onClick={handleBuy}
        >
          Buy Now
        </button>
      )}

      {status.type === "loading" && (
        // Disabled while request is in flight — prevents double-click sending two orders
        <button id={`btn-loading-${product.id}`} className="btn btn-loading" disabled>
          Processing…
        </button>
      )}

      {status.type === "success" && (
        <div className="msg msg-success" id={`msg-success-${product.id}`}>
          ✅ Order placed! Order ID: <strong>#{status.orderId}</strong>
        </div>
      )}

      {status.type === "error" && (
        <>
          <div className="msg msg-error" id={`msg-error-${product.id}`}>
            ❌ {status.message}
          </div>
          {/* Retry sends the same Idempotency-Key — safe, idempotent */}
          <button
            id={`btn-retry-${product.id}`}
            className="btn btn-retry"
            onClick={handleRetry}
          >
            Retry Payment
          </button>
        </>
      )}

      {status.type === "out_of_stock" && (
        <div className="msg msg-oos" id={`msg-oos-${product.id}`}>
          ⛔ Out of stock — this item is no longer available.
        </div>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function HomePage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/products")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load products");
        return r.json();
      })
      .then((data: Product[]) => setProducts(data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="page">
      <h1 className="page-title">DentalKart — Products</h1>
      <p className="page-sub">Professional dental supplies for clinicians across India.</p>

      {loading && <p>Loading products…</p>}
      {error && <p style={{ color: "red" }}>Error: {error}</p>}

      {!loading && !error && (
        <div className="grid">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
    </main>
  );
}
