import type { Metadata } from 'next'
import { Analytics } from '@vercel/analytics/next'
import { Toaster } from 'sonner'
import { AuthProvider } from '@/context/AuthContext'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'Educar para Transformar | Centro Educativo UTN-FRRE',
    template: '%s | Educar para Transformar',
  },
  description:
    'Centro educativo de excelencia en los niveles Inicial, Primario y Secundario con jornada extendida. Inscripciones abiertas para el ciclo lectivo 2027.',
  keywords: ['centro educativo', 'escuela', 'LAMA', 'UTN FRRE', 'inscripciones', 'educación'],
  openGraph: {
    type: 'website',
    locale: 'es_AR',
    siteName: 'Educar para Transformar',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=Geist+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <AuthProvider>
          {children}
          <Toaster
            position="bottom-right"
            toastOptions={{
              style: {
                fontFamily: 'Outfit, system-ui, sans-serif',
                borderRadius: '10px',
              },
            }}
          />
        </AuthProvider>
        <Analytics />
      </body>
    </html>
  )
}
