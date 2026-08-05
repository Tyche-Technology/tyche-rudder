import { createAuthClient } from 'better-auth/react'
import { adminClient } from 'better-auth/client/plugins'

// adminClient() only wires the client-side type inference for the admin
// plugin's actions (setRole/banUser/unbanUser) and the role/banned fields on
// useSession()'s user — the server instance (src/lib/better-auth.ts) is what
// actually enables the plugin. Default baseURL resolves to /api/auth, which
// matches where src/app/api/auth/[...all]/route.ts mounts it.
export const authClient = createAuthClient({ plugins: [adminClient()] })
