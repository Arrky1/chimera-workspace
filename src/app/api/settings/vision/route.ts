import { NextRequest, NextResponse } from 'next/server';
import { getRawVisionText, setVisionContext } from '@/lib/chat-store';

export async function GET() {
  return NextResponse.json({ vision: getRawVisionText() });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { vision } = body;

    if (typeof vision !== 'string') {
      return NextResponse.json({ error: 'vision must be a string' }, { status: 400 });
    }

    setVisionContext(vision);
    return NextResponse.json({ ok: true, vision: getRawVisionText() });
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}
