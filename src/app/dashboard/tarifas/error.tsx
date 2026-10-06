'use client'

import { useEffect } from 'react'
import { ArrowClockwise, WarningCircle } from '@phosphor-icons/react'
import { Button } from '@/components/ui/Button'

/** Recuperación ante fallos inesperados del segmento de tarifas. */
export default function TarifasError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  useEffect(() => {
    console.warn('[tarifas] error no controlado en la página', error.digest ?? '')
  }, [error])

  return (
    <div className="max-w-md mx-auto mt-12 text-center">
      <div className="w-16 h-16 rounded-2xl bg-amber-50 flex items-center justify-center mx-auto mb-4">
        <WarningCircle size={32} weight="fill" className="text-amber-500" aria-hidden="true" />
      </div>
      <h1 className="text-xl font-extrabold text-neutral-900 tracking-tight">
        No pudimos mostrar las tarifas
      </h1>
      <p className="text-neutral-500 text-sm mt-2">
        Ocurrió un error inesperado. Podés reintentar; si continúa, avisale al equipo técnico.
      </p>
      <Button variant="accent" className="mt-6" onClick={() => retry()}>
        <ArrowClockwise size={18} weight="bold" aria-hidden="true" />
        Reintentar
      </Button>
    </div>
  )
}
