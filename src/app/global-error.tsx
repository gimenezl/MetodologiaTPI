'use client'

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif',
          background: '#ffffff',
          color: '#1a1a1a',
          padding: '1rem',
          textAlign: 'center',
        }}
      >
        <div style={{ maxWidth: 480 }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 18,
              background: '#fef3c7',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 1.5rem',
              fontSize: 36,
            }}
          >
            ⚠️
          </div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 800, margin: '0 0 0.75rem' }}>
            Ocurrió un error inesperado
          </h1>
          <p style={{ color: '#6b7280', lineHeight: 1.6, margin: '0 0 1.5rem' }}>
            Algo falló al cargar la aplicación. Podés reintentar o volver al inicio.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={() => reset()}
              style={{
                height: 48,
                padding: '0 1.5rem',
                border: 'none',
                borderRadius: 12,
                background: 'oklch(0.68 0.230 43)',
                color: '#fff',
                fontWeight: 700,
                fontSize: '1rem',
                cursor: 'pointer',
              }}
            >
              Reintentar
            </button>
            <a
              href="/"
              style={{
                height: 48,
                padding: '0 1.5rem',
                display: 'inline-flex',
                alignItems: 'center',
                borderRadius: 12,
                border: '1px solid #d4d4d8',
                color: '#374151',
                fontWeight: 700,
                fontSize: '1rem',
                textDecoration: 'none',
              }}
            >
              Volver al inicio
            </a>
          </div>
        </div>
      </body>
    </html>
  )
}
