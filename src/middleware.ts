import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // Skip auth for health check endpoints
  const healthPaths = ['/api/health', '/api/healthz', '/api/orchestrate'];
  if (healthPaths.some(p => request.nextUrl.pathname === p) && request.method === 'GET') {
    return NextResponse.next();
  }

  // Check if auth is enabled
  const authPassword = process.env.AUTH_PASSWORD;
  if (!authPassword) {
    return NextResponse.next();
  }

  // Check for auth cookie
  const authCookie = request.cookies.get('chimera-auth');
  if (authCookie?.value === authPassword) {
    return NextResponse.next();
  }

  // Check for auth header (for API calls)
  const authHeader = request.headers.get('x-auth-password');
  if (authHeader === authPassword) {
    return NextResponse.next();
  }

  // Redirect to login page
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
