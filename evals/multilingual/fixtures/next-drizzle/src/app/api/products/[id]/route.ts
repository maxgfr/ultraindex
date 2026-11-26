import { NextResponse } from "next/server";
import { deleteProduct, getProduct, renameProduct } from "@/db/queries";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return NextResponse.json(await getProduct(Number(id)));
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const { name } = await req.json();
  await renameProduct(Number(id), name);
  return new NextResponse(null, { status: 204 });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  await deleteProduct(Number(id));
  return new NextResponse(null, { status: 204 });
}

export const dynamic = "force-dynamic";
