import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

async function generateAuthToken(password: string): Promise<string> {
  const secret = process.env.AUTH_SECRET || 'chimera-default-secret';
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(password));
  return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function middleware(request: NextRequest) {
  // Skip auth for health check endpoints
  const healthPaths = ['/api/health', '/api/healthz'];
  if (healthPaths.some(p => request.nextUrl.pathname === p) && request.method === 'GET') {
    return NextResponse.next();
  }

  // Check if auth is enabled
  const authPassword = process.env.AUTH_PASSWORD;
  if (!authPassword) {
    return NextResponse.next();
  }

  // Check for auth cookie (now stores HMAC token, not password)
  const authCookie = request.cookies.get('chimera-auth');
  if (authCookie?.value) {
    const expectedToken = await generateAuthToken(authPassword);
    if (authCookie.value === expectedToken) {
      return NextResponse.next();
    }
  }

  // Check for auth header (for API calls — accepts HMAC token, not plaintext password)
  const authHeader = request.headers.get('x-auth-token');
  if (authHeader) {
    const expectedToken = await generateAuthToken(authPassword);
    if (authHeader === expectedToken) {
      return NextResponse.next();
    }
  }

  // For API routes, return 401 JSON instead of redirect
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: 'Unauthorized. Please re-login.' },
      { status: 401 }
    );
  }

  // Redirect to login page for non-API routes
  if (!request.nextUrl.pathname.startsWith('/login')) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - login page
     * - api/auth (auth endpoints)
     * - api/health, api/healthz (health checks)
     */
    '/((?!_next/static|_next/image|favicon.ico|login|api/auth|api/health|api/healthz).*)',
  ],
};
