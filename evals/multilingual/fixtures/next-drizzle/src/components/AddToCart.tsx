"use client";

import { API_BASE } from "@/lib/config";

const ORDERS = "/api/orders";

export function AddToCart({ productId }: { productId: number }) {
  async function add() {
    await fetch(ORDERS, {
      method: "POST",
      body: JSON.stringify({ productId }),
    });
    await fetch(`${API_BASE}/api/products/${productId}?fresh=1`);
    // await fetch("/api/ghost", { method: "DELETE" });
    console.log("fetch('/api/in-a-log') is not a call");
  }
  return <button onClick={add}>Add to cart</button>;
}
