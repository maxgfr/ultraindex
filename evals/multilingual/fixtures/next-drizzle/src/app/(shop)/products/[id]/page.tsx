import { AddToCart } from "@/components/AddToCart";
import { getProduct } from "@/db/queries";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await getProduct(Number(id));
  return (
    <main>
      <h1>{product?.name}</h1>
      <AddToCart productId={Number(id)} />
    </main>
  );
}
