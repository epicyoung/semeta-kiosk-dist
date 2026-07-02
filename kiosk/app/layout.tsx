import type { Metadata } from 'next'
import { DM_Sans } from 'next/font/google'
import './globals.css'

export const metadata: Metadata = { title: 'Semeta Booth' }

// Self-hosted at build time (next/font downloads + bundles) — zero runtime
// request to Google Fonts. Required: the kiosk is offline-first, so a CDN
// <link> would drop the brand type the moment the venue loses internet.
// adjustFontFallback gives metric-matched fallbacks = no layout shift.
// DM Sans is the ONLY family — logo and mono-style text use it too.
const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-dm-sans',
  display: 'swap',
})

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={dmSans.variable}>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, interactive-widget=resizes-content" />
      </head>
      <body>{children}</body>
    </html>
  )
}
