import type { Metadata } from 'next'
import { Gothic_A1, IBM_Plex_Mono } from 'next/font/google'
import 'pretendard/dist/web/variable/pretendardvariable.css'
import './globals.css'

// next/font self-hosts both families at build time — no request to Google
// at runtime (design doc §10). Pretendard is not a Google font, so it comes
// in as a plain CSS import instead of a next/font loader.
const displayFont = Gothic_A1({
  weight: ['500', '700', '800'],
  subsets: ['latin'],
  variable: '--font-display-src',
})

const monoFont = IBM_Plex_Mono({
  weight: ['400', '500'],
  subsets: ['latin'],
  variable: '--font-mono-src',
})

export const metadata: Metadata = {
  title: 'Rudder',
}

// Reads the saved theme before first paint so the app never flashes light
// before switching to dark. suppressHydrationWarning on <html> covers the
// data-theme attribute this script sets outside of React.
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('rudder-theme');if(t)document.documentElement.dataset.theme=t}catch(e){}})()`

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ko" data-theme="light" suppressHydrationWarning className={`${displayFont.variable} ${monoFont.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
