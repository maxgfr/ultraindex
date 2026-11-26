import { listProducts } from "@/db/queries";

export default async function HomePage() {
  const products = await listProducts();
  return <ul>{products.map((p) => <li key={p.id}>{p.name}</li>)}</ul>;
}
