'use client'

import { Button } from '@/components/ui/Button'
import type { FilaInscripcion } from './tipos'
import type { OperacionEnCurso } from './useAdministracionInscripciones'

/**
 * Acciones administrativas de una fila: «Confirmar» y «Cancelar inscripción».
 *
 * - Una inscripción cancelada no ofrece ninguna acción y lo dice, en lugar de
 *   mostrar botones deshabilitados sin explicación.
 * - Una inscripción ya confirmada no vuelve a ofrecer «Confirmar»; si otra
 *   persona la confirma mientras esta pantalla está abierta, el servidor
 *   responde que ya estaba confirmada y la pantalla lo informa.
 * - Mientras hay una operación en curso (de esta u otra fila) los botones se
 *   deshabilitan: se opera de a una.
 *
 * El nombre accesible empieza con el texto visible («Confirmar…», «Cancelar
 * inscripción…») para que quien usa control por voz lo encuentre, y termina con
 * el alumno para distinguir un botón de otro.
 */
export function AccionesInscripcionAdministrativa({
  fila,
  ocupado,
  enCurso,
  onConfirmar,
  onCancelar,
}: {
  fila: FilaInscripcion
  ocupado: boolean
  enCurso: OperacionEnCurso | null
  onConfirmar: (fila: FilaInscripcion) => void
  onCancelar: (fila: FilaInscripcion) => void
}) {
  if (fila.estado === 'CANCELADA') {
    return <p className="text-xs text-neutral-600">Sin acciones: la inscripción está cancelada.</p>
  }

  const confirmando = enCurso?.id === fila.id && enCurso.operacion === 'confirmar'

  return (
    <div className="flex flex-wrap gap-2">
      {!fila.confirmacion.confirmada && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11 xl:min-h-8"
          onClick={() => onConfirmar(fila)}
          disabled={ocupado}
          aria-busy={confirmando}
          aria-label={`Confirmar inscripción de ${fila.alumno}`}
        >
          {confirmando ? 'Confirmando…' : 'Confirmar'}
        </Button>
      )}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="min-h-11 xl:min-h-8"
        onClick={() => onCancelar(fila)}
        disabled={ocupado}
        aria-label={`Cancelar inscripción de ${fila.alumno}`}
      >
        Cancelar inscripción
      </Button>
    </div>
  )
}
