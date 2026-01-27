import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'crypto';

function generateAuthToken(password: string): string {
  const secret = process.env.AUTH_SECRET || 'chimera-default-secret';
  return createHmac('sha256', secret).update(password).digest('hex');
}

export async function POST(request: NextRequest) {
  try {
    const { password } = await request.json();
    const authPassword = process.env.AUTH_PASSWORD;

    if (!authPassword) {
      return NextResponse.json(
        { error: 'Auth not configured' },
        { status: 500 }
      );
    }

    if (password === authPassword) {
      const response = NextResponse.json({ success: true });
      const token = generateAuthToken(password);

      // Set auth cookie with token (not password)
      response.cookies.set('chimera-auth', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7, // 7 days
        path: '/',
      });

      return response;
    }

    return NextResponse.json(
      { error: 'Invalid password' },
      { status: 401 }
    );
  } catch {
    return NextResponse.json(
      { error: 'Bad request' },
      { status: 400 }
    );
  }
}

// Logout endpoint
export async function DELETE() {
  const response = NextResponse.json({ success: true });

  response.cookies.set('chimera-auth', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });

  return response;
}
