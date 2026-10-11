import { NextRequest, NextResponse } from 'next/server';
export function proxy(request: NextRequest) {
  const nonce=Buffer.from(crypto.randomUUID()).toString('base64');
  const url=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  const policy=["default-src 'self'",`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV==='development'?" 'unsafe-eval'":''}`,"style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "font-src 'self'",`connect-src 'self' ${url.origin} wss://${url.host}`,"frame-ancestors 'none'","object-src 'none'","base-uri 'self'","form-action 'self'"].join('; ');
  const headers=new Headers(request.headers);headers.set('x-nonce',nonce);headers.set('Content-Security-Policy',policy);
  const response=NextResponse.next({request:{headers}});response.headers.set('Content-Security-Policy',policy);response.headers.set('Cache-Control','no-store');return response;
}
export const config={matcher:['/']};
