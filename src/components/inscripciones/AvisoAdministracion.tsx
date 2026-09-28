'use client'

import { useEffect, useRef } from 'react'
import { CheckCircle, Info, WarningCircle } from '@phosphor-icons/react'
import { EnlaceBoton } from '@/components/ui/EnlaceBoton'
import type { Aviso } from './useAdministracionInscripciones'

/**
 * Anuncia el resultado de una operación administrativa.
 *
 * La región de estado (`role="status"`) está siempre montada, porque los lectores
 * de pantalla solo anuncian los cambios de una región que ya existía. El éxito y
 * el «ya estaba confirmada» (informativo, sin alarma) van ahí. Un error se monta
 * como alerta (`role="alert"`) y solo existe mientras hay un error, de modo que
 * «no hay ninguna alerta» sigue significando que no pasó nada malo.
 *
 * Si el aviso queda fuera de la vista —la operación se hizo sobre una fila
 * lejana—, se lo acerca sin mover el foco.
 */
export function AvisoAdministracion({ aviso }: { aviso: Aviso | null }) {
  const contenedor = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (aviso) contenedor.current?.scrollIntoView({ block: 'nearest' })
  }, [aviso])

  return (
    <div ref={contenedor} className="space-y-3 scroll-mt-4">
      <div role="status" className="space-y-3">
        {aviso && aviso.tipo !== 'error' && (
          <div
            className={
              aviso.tipo === 'exito'
                ? 'bg-green-50 border border-green-200 rounded-2xl p-4 flex gap-3 items-start'
                : 'bg-brand-50 border border-brand-200 rounded-2xl p-4 flex gap-3 items-start'
            }
          >
            {aviso.tipo === 'exito' ? (
              <CheckCircle size={20} weight="fill" className="text-green-600 shrink-0 mt-0.5" aria-hidden="true" />
            ) : (
              <Info size={20} weight="fill" className="text-brand-600 shrink-0 mt-0.5" aria-hidden="true" />
            )}
            <p className={aviso.tipo === 'exito' ? 'text-sm text-green-800' : 'text-sm text-brand-800'}>
              {aviso.texto}
            </p>
          </div>
        )}
      </div>
      {aviso?.tipo === 'error' && (
        <div
          role="alert"
          className="bg-red-50 border border-red-200 rounded-2xl p-4 flex gap-3 items-start"
        >
          <WarningCircle size={20} weight="fill" className="text-red-600 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="space-y-3 min-w-0">
            <p className="text-sm text-red-800">{aviso.texto}</p>
            {aviso.iniciarSesion && (
              <EnlaceBoton href="/login" size="sm" variant="outline" className="min-h-11 sm:min-h-8">
                Iniciar sesión
              </EnlaceBoton>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
