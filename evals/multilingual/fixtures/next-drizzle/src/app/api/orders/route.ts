import { NextResponse } from "next/server";
import { placeOrder } from "@/db/queries";

export async function POST(req: Request) {
  const { userId, productId } = await req.json();
  return NextResponse.json(await placeOrder(userId, productId), { status: 201 });
}
