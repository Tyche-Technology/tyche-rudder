import { getAuth } from '@/lib/better-auth'

// Lazy per-request lookup (not toNextJsHandler at module scope) so importing
// the route in tests/builds doesn't construct the auth instance eagerly.
const handler = (req: Request) => getAuth().handler(req)
export { handler as GET, handler as POST }
