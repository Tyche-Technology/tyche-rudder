import { NextResponse } from 'next/server'
import { errorType } from './error-summary'

// Route handlers can throw (missing BETTER_AUTH_SECRET, DB down, etc). Without
// this, Next.js returns its own HTML 500 page instead of our { ok, error }
// contract, which breaks every client built against that envelope.
export function withErrorEnvelope<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
) {
  return async (...args: Args): Promise<Response> => {
    try {
      return await handler(...args)
    } catch (error) {
      console.error('request_failed', { errorType: errorType(error) })
      return NextResponse.json({ ok: false, error: '서버 오류가 발생했습니다' }, { status: 500 })
    }
  }
}
