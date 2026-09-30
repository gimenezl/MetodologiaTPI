'use client'

import { useEffect } from 'react'
import { ArrowClockwise, WarningCircle } from '@phosphor-icons/react'
import { Button } from '@/components/ui/Button'

/**
 * Recuperación ante fallos inesperados de las pantallas de la credencial (EPT-64).
 *
 * Nunca muestra `error.message` ni registra el contenido de la credencial: en la
 * consola solo queda el `digest`, que permite encontrar el error en el servidor.
 * Usa `unstable_retry` y no `reset`: `reset` no vuelve a pedir los datos.
 */
export default function CredencialError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  useEffect(() => {
    console.error('[credenciales-qr] error no controlado en la página', { digest: error.digest ?? null })
  }, [error])

  return (
    <div role="alert" className="mx-auto mt-12 max-w-md text-center">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50">
        <WarningCircle size={32} weight="fill" className="text-amber-700" aria-hidden="true" />
      </div>
      <h1 className="text-xl font-extrabold tracking-tight text-neutral-900">
        No pudimos mostrar la credencial
      </h1>
      <p className="mt-2 text-sm text-neutral-600">
        Ocurrió un error inesperado. Podés reintentar; si continúa, avisale al equipo técnico.
      </p>
      <Button variant="accent" className="mt-6 min-h-11" onClick={() => unstable_retry()}>
        <ArrowClockwise size={18} weight="bold" aria-hidden="true" />
        Reintentar
      </Button>
    </div>
  )
}
