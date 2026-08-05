'use client'

// Every route under (app) shares one Shell instance so GET /auth/me runs
// once per session, not once per navigation. `page` is derived from the
// pathname instead of threading a prop through every page.tsx.
import { usePathname } from 'next/navigation'
import { Shell } from '@/ui/shell'
import { pageFromPathname } from '@/ui/nav'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  return <Shell page={pageFromPathname(pathname)}>{children}</Shell>
}
