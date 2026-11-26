"use client";

import { useEffect, useState } from "react";

export function CartView() {
  const [items, setItems] = useState<unknown[]>([]);
  useEffect(() => {
    fetch("/api/products?limit=10")
      .then((r) => r.json())
      .then(setItems);
  }, []);
  async function rename(id: number, name: string) {
    await fetch(`/api/products/${id}`, { method: "PATCH", body: JSON.stringify({ name }) });
  }
  async function remove(id: number) {
    await fetch("/api/products/" + id, { method: "delete" });
    await fetch("https://api.stripe.com/v1/refunds", { method: "POST" });
  }
  return <div onClick={() => rename(1, "x")} onDoubleClick={() => remove(1)}>{items.length}</div>;
}
