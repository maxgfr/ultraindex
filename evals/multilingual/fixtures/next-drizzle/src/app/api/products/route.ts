import { NextResponse } from "next/server";
import { listProducts } from "@/db/queries";

export async function GET() {
  return NextResponse.json(await listProducts());
}

export const POST = async (req: Request) => {
  const body = await req.json();
  return NextResponse.json(body, { status: 201 });
};

// export async function DELETE() {}
