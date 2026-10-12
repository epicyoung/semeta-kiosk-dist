'use client'

import * as Sentry from '@sentry/nextjs'
import NextError from 'next/error'
import { useEffect } from 'react'

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html>
      <body>
        {/* App Router ga ngasih status code buat error → 0 = pesan generik. */}
        <NextError statusCode={0} />
      </body>
    </html>
  )
}
