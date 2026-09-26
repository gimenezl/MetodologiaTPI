'use client'

import { useEffect } from 'react'
import { ArrowClockwise, WarningCircle } from '@phosphor-icons/react'
import { Button } from '@/components/ui/Button'

/**
 * Recuperación ante fallos inesperados del segmento de profesores.
 *
 * Next 16.3 recomienda `retry()`, que vuelve a pedir los datos del servidor.
 * No se muestra `error.message`: en producción es genérico y en desarrollo
 * podría traer detalle técnico. Se registra con `console.warn` porque Next en
 * desarrollo abre su diálogo de error sobre la página ante `console.error`.
 */
export default function ProfesoresError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  useEffect(() => {
    console.warn('[profesores] error no controlado en la página', { digest: error.digest })
  }, [error])

  return (
    <div className="max-w-md mx-auto mt-12 text-center" role="alert">
      <div className="w-16 h-16 rounded-2xl bg-amber-50 flex items-center justify-center mx-auto mb-4">
        <WarningCircle size={32} weight="fill" className="text-amber-500" />
      </div>
      <h1 className="text-xl font-extrabold text-neutral-900 tracking-tight">
        No pudimos mostrar los profesores
      </h1>
      <p className="text-neutral-500 text-sm mt-2">
        Ocurrió un error inesperado. Podés reintentar; si continúa, avisale al equipo técnico.
      </p>
      <Button variant="accent" className="mt-6" onClick={() => retry()}>
        <ArrowClockwise size={18} weight="bold" />
        Reintentar
      </Button>
    </div>
  )
}
