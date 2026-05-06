import { NextResponse } from 'next/server';

export function GET() {
  return new NextResponse('ok', {
    status: 200,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8'
    }
  });
}
