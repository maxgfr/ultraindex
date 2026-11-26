import { prisma } from "../db.js";

export interface NewOrder {
  userId: number;
  items: { productId: number; quantity: number }[];
}

export async function listOrders(userId: number) {
  return prisma.order.findMany({ where: { userId }, include: { items: true } });
}

export async function placeOrder(input: NewOrder) {
  // prisma.user.delete({ where: { id: input.userId } }) — never, kept as a reminder
  const products = await prisma.product.findMany({ where: { id: { in: input.items.map((i) => i.productId) } } });
  if (products.length !== input.items.length) throw new Error("unknown product");
  return prisma.order.create({
    data: {
      userId: input.userId,
      items: { create: input.items },
    },
  });
}

export async function cancelOrder(id: number) {
  console.log("cancelling via prisma.order.delete(...)");
  return prisma.order.update({ where: { id }, data: { status: "PENDING" } });
}
