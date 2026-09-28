import { CheckCircle } from '@phosphor-icons/react/dist/ssr'
import { Badge } from '@/components/ui/Badge'
import { fechaHora } from './formato'
import type { Confirmacion } from './tipos'

/**
 * Estado de confirmación, siempre separado del estado vigente de la inscripción.
 *
 * «Sin confirmar» NO significa pendiente de activación, inactiva ni inválida: la
 * inscripción rige desde el alta. Confirmar es una acción administrativa
 * posterior. Solo Dirección recibe estos datos, así que este componente solo se
 * monta en pantallas de Dirección.
 *
 * `motivoNoConfirmable` explica por qué una inscripción cancelada (o una
 * matrícula cerrada) no ofrece la acción, en lugar de callar.
 */
export function EstadoConfirmacion({
  confirmacion,
  motivoNoConfirmable,
}: {
  confirmacion: Confirmacion
  motivoNoConfirmable?: string
}) {
  if (confirmacion.confirmada) {
    const fecha = fechaHora(confirmacion.confirmadaEn)
    return (
      <div className="space-y-1">
        <Badge variant="info">
          <CheckCircle size={14} weight="fill" aria-hidden="true" />
          Confirmada
        </Badge>
        <p className="text-xs text-neutral-600 break-words">
          {confirmacion.confirmadaPor
            ? `Confirmada por ${confirmacion.confirmadaPor} el ${fecha}`
            : `Confirmada el ${fecha}`}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <Badge variant="outline">Sin confirmar</Badge>
      {motivoNoConfirmable && (
        <p className="text-xs text-neutral-600">{motivoNoConfirmable}</p>
      )}
    </div>
  )
}
