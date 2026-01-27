/**
 * Simple healthcheck endpoint for Railway
 * Returns 200 OK without any dependencies
 */

import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ status: 'ok' }, { status: 200 });
}

// Also support HEAD requests for minimal overhead
export async function HEAD() {
  return new Response(null, { status: 200 });
}
