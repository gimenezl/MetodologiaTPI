'use client'

import { useEffect } from 'react'
import { ArrowClockwise, WarningCircle } from '@phosphor-icons/react'
import { Button } from '@/components/ui/Button'

/**
 * Límite de error de `/dashboard/cursos`. Cubre fallos inesperados que el
 * componente de servidor no pudo traducir a un estado de dominio.
 */
export default function CursosError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[cursos] error no controlado en la página', error)
  }, [error])

  return (
    <div className="max-w-md mx-auto mt-12 text-center">
      <div className="w-16 h-16 rounded-2xl bg-amber-50 flex items-center justify-center mx-auto mb-4">
        <WarningCircle size={32} weight="fill" className="text-amber-500" />
      </div>
      <h1 className="text-xl font-extrabold text-neutral-900 tracking-tight">
        No pudimos mostrar los cursos
      </h1>
      <p className="text-neutral-500 text-sm mt-2">
        Ocurrió un error inesperado al cargar la sección. Podés reintentar; si el problema
        sigue, avisale al equipo técnico.
      </p>
      <Button variant="accent" className="mt-6" onClick={() => reset()}>
        <ArrowClockwise size={18} weight="bold" />
        Reintentar
      </Button>
    </div>
  )
}
