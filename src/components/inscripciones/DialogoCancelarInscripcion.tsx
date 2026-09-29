'use client'

import { useState } from 'react'
import { WarningCircle } from '@phosphor-icons/react'
import { Button } from '@/components/ui/Button'
import { Dialogo } from '@/components/ui/Dialogo'
import { EnlaceBoton } from '@/components/ui/EnlaceBoton'
import { fechaHora } from './formato'
import type { FilaInscripcion } from './tipos'
import type { Aviso, ObjetivoOperacion } from './useAdministracionInscripciones'

/**
 * Confirmación de la cancelación administrativa de una inscripción.
 *
 * Nombra a la persona, el servicio o el grupo y la consecuencia: la inscripción
 * queda cancelada, se conserva en el historial y el alumno podrá volver a
 * inscribirse. El foco inicial está en la acción que NO destruye nada. Si la
 * operación falla, el diálogo sigue abierto con el motivo dentro, para que la
 * persona reintente o vuelva sin perder el contexto.
 */
export function DialogoCancelarInscripcion({
  dominio,
  fila,
  enviando,
  onCancelar,
  onCerrar,
}: {
  dominio: string
  fila: FilaInscripcion
  enviando: boolean
  /** Devuelve el aviso de error si falló y `null` si la cancelación se hizo. */
  onCancelar: (objetivo: ObjetivoOperacion) => Promise<Aviso | null>
  onCerrar: () => void
}) {
  const [error, setError] = useState<Aviso | null>(null)
  const idVolver = `${dominio}-cancelar-volver`

  async function cancelar() {
    setError(null)
    const fallo = await onCancelar({
      id: fila.id,
      alumno: fila.alumno,
      descripcion: fila.descripcion,
    })
    if (fallo) setError(fallo)
    else onCerrar()
  }

  return (
    <Dialogo
      tituloId={`${dominio}-cancelar-titulo`}
      titulo={`Cancelar la inscripción de ${fila.alumno}`}
      descripcion={
        `Vas a cancelar, en nombre del alumno, su inscripción en ${fila.descripcion}. ` +
        'Queda cancelada, se conserva en el historial y el alumno podrá volver a inscribirse.'
      }
      selectorFocoInicial={`#${idVolver}`}
      onCerrar={() => {
        if (!enviando) onCerrar()
      }}
    >
      <div className="space-y-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-neutral-600">Alumno</dt>
          <dd className="text-neutral-900 font-medium break-words">{fila.alumno}</dd>
          <dt className="text-neutral-600">Legajo</dt>
          <dd className="text-neutral-900 break-words">{fila.legajo ?? '—'}</dd>
          <dt className="text-neutral-600">Inscripción</dt>
          <dd className="text-neutral-900 break-words">{fila.descripcion}</dd>
          <dt className="text-neutral-600">Alta</dt>
          <dd className="text-neutral-900">{fechaHora(fila.fechaAlta)}</dd>
        </dl>

        {fila.confirmacion.confirmada && (
          <p className="text-sm text-neutral-700">
            La confirmación registrada también se conserva en el historial.
          </p>
        )}

        {error && (
          <div
            role="alert"
            className="bg-red-50 border border-red-200 rounded-xl p-3 flex gap-2 items-start text-sm text-red-800"
          >
            <WarningCircle size={18} weight="fill" className="text-red-600 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="space-y-2 min-w-0">
              <p>{error.texto}</p>
              {error.iniciarSesion && (
                <EnlaceBoton href="/login" size="sm" variant="outline" className="min-h-11 sm:min-h-8">
                  Iniciar sesión
                </EnlaceBoton>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
          <Button
            id={idVolver}
            type="button"
            variant="outline"
            className="min-h-11 sm:min-h-10"
            onClick={onCerrar}
            disabled={enviando}
          >
            Volver sin cancelar
          </Button>
          <Button
            type="button"
            variant="peligro"
            className="min-h-11 sm:min-h-10"
            onClick={cancelar}
            disabled={enviando}
            aria-busy={enviando}
          >
            {enviando ? 'Cancelando…' : 'Sí, cancelar inscripción'}
          </Button>
        </div>
      </div>
    </Dialogo>
  )
}
