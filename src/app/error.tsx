'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { House, ArrowClockwise, WarningCircle } from '@phosphor-icons/react'
import { Button } from '@/components/ui/Button'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Registramos el error para diagnóstico
    console.error(error)
  }, [error])

  return (
    <main className="min-h-[100dvh] flex items-center justify-center bg-white relative overflow-hidden px-4">
      {/* Degradado sutil de fondo */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `radial-gradient(ellipse 60% 50% at 50% 40%, oklch(0.95 0.020 43) 0%, transparent 70%)`,
        }}
        aria-hidden="true"
      />

      <div className="relative z-10 text-center max-w-lg">
        <div className="w-20 h-20 rounded-2xl bg-amber-50 flex items-center justify-center mx-auto mb-6">
          <WarningCircle size={44} weight="fill" className="text-amber-500" />
        </div>

        <h1 className="text-2xl md:text-3xl font-extrabold text-neutral-900 tracking-tight">
          Ocurrió un error inesperado
        </h1>
        <p className="mt-3 text-neutral-500 leading-relaxed">
          Algo falló al procesar tu solicitud. Podés reintentar o volver al inicio.
          Si el problema persiste, contactanos.
        </p>

        <div className="mt-8 flex flex-wrap gap-3 justify-center">
          <Button size="lg" variant="accent" onClick={() => reset()} className="shadow-lg shadow-accent-500/25">
            <ArrowClockwise size={18} weight="bold" />
            Reintentar
          </Button>
          <Link href="/">
            <Button size="lg" variant="ghost" className="text-neutral-700 border border-neutral-300 hover:bg-neutral-100">
              <House size={18} weight="fill" />
              Volver al inicio
            </Button>
          </Link>
        </div>
      </div>
    </main>
  )
}
