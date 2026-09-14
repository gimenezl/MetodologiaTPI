'use client'

import { useEffect } from 'react'
import { ArrowClockwise, WarningCircle } from '@phosphor-icons/react'
import { Button } from '@/components/ui/Button'

/**
 * Recuperación ante fallos inesperados del segmento administrativo.
 *
 * Nunca muestra `error.message`: en desarrollo Next reenvía el mensaje original
 * al navegador. En la consola solo queda el `digest`, que en producción es lo
 * que permite encontrar el error en el registro del servidor.
 *
 * Usa `unstable_retry` y no `reset`: la documentación de Next 16.2 indica que
 * `reset` solo limpia el estado del límite de error sin volver a pedir los
 * datos, así que un error de lectura en el servidor volvería a mostrarse igual.
 */
export default function AlumnosError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  useEffect(() => {
    console.error('[alumnos] error no controlado en la página', { digest: error.digest ?? null })
  }, [error])

  return (
    <div className="max-w-md mx-auto mt-12 text-center">
      <div className="w-16 h-16 rounded-2xl bg-amber-50 flex items-center justify-center mx-auto mb-4">
        <WarningCircle size={32} weight="fill" className="text-amber-500" />
      </div>
      <h1 className="text-xl font-extrabold text-neutral-900 tracking-tight">
        No pudimos mostrar los legajos académicos
      </h1>
      <p className="text-neutral-500 text-sm mt-2">
        Ocurrió un error inesperado. Podés reintentar; si continúa, avisale al
        equipo técnico.
      </p>
      <Button variant="accent" className="mt-6" onClick={() => unstable_retry()}>
        <ArrowClockwise size={18} weight="bold" />
        Reintentar
      </Button>
    </div>
  )
}
