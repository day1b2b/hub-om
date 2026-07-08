import { NextResponse } from "next/server";

export async function syncJsonResponse(handler: () => Promise<unknown>) {
  try {
    return NextResponse.json(await handler());
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
