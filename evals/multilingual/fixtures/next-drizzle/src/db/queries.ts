import { eq } from "drizzle-orm";
import { db } from "./index";
import { orders, products } from "./schema";

export async function listProducts() {
  return db.select().from(products);
}

export async function getProduct(id: number) {
  const rows = await db.select().from(products).where(eq(products.id, id));
  return rows[0];
}

export async function renameProduct(id: number, name: string) {
  await db.update(products).set({ name }).where(eq(products.id, id));
}

export async function deleteProduct(id: number) {
  await db.delete(products).where(eq(products.id, id));
}

export async function placeOrder(userId: number, productId: number) {
  return db.insert(orders).values({ userId, productId }).returning();
}

export async function findUser(email: string) {
  return db.query.users.findFirst({ where: (u, { eq: is }) => is(u.email, email) });
}

// db.delete(users) — commented out on purpose.
console.log("db.insert(products) is only a log line");
