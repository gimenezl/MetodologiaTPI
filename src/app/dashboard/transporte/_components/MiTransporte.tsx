'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Bus,
  CheckCircle,
  ClockCounterClockwise,
  MapPin,
  Prohibit,
  WarningCircle,
} from '@phosphor-icons/react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Dialogo } from '@/components/ui/Dialogo'
import {
  cancelarInscripcionTransporteRemota,
  ErrorTransporte,
  establecerRecorridoRemoto,
} from '@/services/transporte.client'
import type {
  InscripcionTransporte,
  Recorrido,
} from '@/services/transporte.service'

interface MiTransporteProps {
  recorridos: Recorrido[]
  inscripciones: InscripcionTransporte[]
  /**
   * Motivo por el que el alumno todavía no puede establecer un recorrido,
   * resuelto en el servidor. La pantalla lo explica; la decisión real la
   * vuelve a tomar PostgreSQL en cada intento.
   */
  impedimento?: string
  mensajeInicial?: string
}

/**
 * Formato de fecha estable entre el servidor y el navegador. Mismo criterio
 * que el resto de servicios escolares (comedor, deportes): zona horaria y
 * formato de 24 horas explícitos para que el árbol hidratado no cambie.
 */
const FORMATO_FECHA = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'America/Argentina/Buenos_Aires',
})

function fecha(valor: string | null) {
  if (!valor) return '—'
  const momento = new Date(valor)
  return Number.isNaN(momento.getTime()) ? '—' : FORMATO_FECHA.format(momento)
}

/**
 * Recorridos de transporte del alumno de la sesión (EPT-60).
 *
 * Toda operación viaja por la API; este componente nunca escribe en la base.
 * Elegir o cambiar de recorrido usan la misma operación atómica: PostgreSQL
 * decide si es un alta o un cambio, y cambiar al recorrido ya activo no hace
 * nada. El estado que se ve proviene del servidor y se vuelve a pedir después
 * de cada operación.
 */
export function MiTransporte({
  recorridos,
  inscripciones,
  impedimento,
  mensajeInicial,
}: MiTransporteProps) {
  const router = useRouter()
  const [refrescando, iniciarRefresco] = useTransition()
  const [enviando, setEnviando] = useState(false)
  const [confirmandoBaja, setConfirmandoBaja] = useState(false)
  const [error, setError] = useState<string | null>(mensajeInicial ?? null)
  const [exito, setExito] = useState<string | null>(null)

  const activa = inscripciones.find((i) => i.estado === 'ACTIVA') ?? null
  const historial = inscripciones.filter((i) => i.estado === 'CANCELADA')
  const ocupado = enviando || refrescando

  function reconciliar() {
    iniciarRefresco(() => router.refresh())
  }

  async function elegir(recorrido: Recorrido) {
    if (ocupado || activa?.servicio_id === recorrido.id) return
    setError(null)
    setExito(null)
    setEnviando(true)
    try {
      await establecerRecorridoRemoto(recorrido.id)
      setExito(
        activa
          ? `Cambiaste tu recorrido a ${recorrido.codigo}.`
          : `Te inscribiste al recorrido ${recorrido.codigo}.`
      )
      reconciliar()
    } catch (problema) {
      setError(
        problema instanceof ErrorTransporte
          ? problema.message
          : 'No pudimos completar la operación. Volvé a intentarlo.'
      )
      // Un rechazo puede significar que otra pestaña ya cambió tu recorrido:
      // se vuelve a leer el estado real en lugar de suponerlo.
      reconciliar()
    } finally {
      setEnviando(false)
    }
  }

  async function cancelar() {
    if (!activa || ocupado) return
    setError(null)
    setExito(null)
    setEnviando(true)
    try {
      await cancelarInscripcionTransporteRemota(activa.id)
      setConfirmandoBaja(false)
      setExito('Cancelaste tu recorrido de transporte. Podés elegir otro cuando quieras.')
      reconciliar()
    } catch (problema) {
      setError(
        problema instanceof ErrorTransporte
          ? problema.message
          : 'No pudimos cancelar tu recorrido. Volvé a intentarlo.'
      )
      setConfirmandoBaja(false)
      reconciliar()
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-600 mb-2">
          Servicios escolares
        </p>
        <h1 className="text-2xl font-extrabold text-neutral-900 tracking-tight">
          Transporte
        </h1>
        <p className="text-neutral-500 text-sm mt-1 max-w-[64ch]">
          Elegí tu recorrido de transporte, cambialo cuando lo necesites y cancelalo si
          ya no lo vas a usar. Solo podés tener un recorrido activo a la vez.
        </p>
      </div>

      <div
        aria-live="polite"
        aria-label="Estado de tu recorrido de transporte"
        className="space-y-3"
      >
        {error && (
          <div
            role="alert"
            className="bg-red-50 border border-red-200 rounded-2xl p-4 flex gap-3 items-start"
          >
            <WarningCircle
              size={20}
              weight="fill"
              className="text-red-500 shrink-0 mt-0.5"
            />
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}
        {exito && (
          <div className="bg-green-50 border border-green-200 rounded-2xl p-4 flex gap-3 items-start">
            <CheckCircle
              size={20}
              weight="fill"
              className="text-green-600 shrink-0 mt-0.5"
            />
            <p className="text-sm text-green-800">{exito}</p>
          </div>
        )}
        {!activa && !error && (
          <p className="text-sm text-neutral-600">
            {impedimento ?? 'Todavía no tenés un recorrido de transporte activo.'}
          </p>
        )}
      </div>

      <section aria-labelledby="transporte-recorridos-titulo" className="space-y-3">
        <h2 id="transporte-recorridos-titulo" className="sr-only">
          Recorridos disponibles
        </h2>
        <ul className="space-y-3">
          {recorridos.map((recorrido) => {
            const esElActivo = activa?.servicio_id === recorrido.id
            return (
              <li
                key={recorrido.id}
                className="bg-white rounded-2xl border border-neutral-200 p-5 sm:p-6"
              >
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-brand-50 flex items-center justify-center shrink-0">
                    <Bus size={24} weight="fill" className="text-brand-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-neutral-900 break-words">
                        {recorrido.nombre}
                      </h3>
                      {esElActivo && (
                        <Badge variant="success" dot>
                          Tu recorrido actual
                        </Badge>
                      )}
                      {!recorrido.activo && <Badge variant="outline">No disponible</Badge>}
                    </div>
                    <ol className="mt-2 flex flex-wrap items-center gap-1.5 text-sm text-neutral-600">
                      {recorrido.paradas.map((parada, indice) => (
                        <li key={parada.orden} className="flex items-center gap-1.5">
                          {indice > 0 && <span aria-hidden="true">→</span>}
                          <span className="inline-flex items-center gap-1">
                            <MapPin size={14} className="text-neutral-400" />
                            {parada.nombre}
                          </span>
                        </li>
                      ))}
                    </ol>

                    <div className="mt-4">
                      {esElActivo ? (
                        <Button
                          variant="danger"
                          onClick={() => {
                            setError(null)
                            setExito(null)
                            setConfirmandoBaja(true)
                          }}
                          disabled={ocupado}
                          aria-busy={ocupado}
                        >
                          <Prohibit size={18} weight="bold" />
                          Cancelar este recorrido
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          onClick={() => elegir(recorrido)}
                          disabled={ocupado || !recorrido.activo || Boolean(impedimento)}
                          aria-busy={ocupado}
                        >
                          <Bus size={18} weight="bold" />
                          {activa ? 'Cambiar a este recorrido' : 'Elegir este recorrido'}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      </section>

      <section aria-labelledby="transporte-historial-titulo" className="space-y-3">
        <h2
          id="transporte-historial-titulo"
          className="text-sm font-bold text-neutral-900 flex items-center gap-2"
        >
          <ClockCounterClockwise size={18} className="text-neutral-400" />
          Recorridos anteriores
        </h2>
        {historial.length === 0 ? (
          <div className="bg-white rounded-2xl border border-neutral-200 py-10 px-5 text-center">
            <p className="text-sm text-neutral-600 font-semibold">
              Todavía no cancelaste ni cambiaste de recorrido
            </p>
            <p className="text-neutral-400 text-sm mt-1">
              Cuando lo hagas, el ciclo va a quedar registrado acá. Nada se elimina.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {historial.map((inscripcion) => (
              <li
                key={inscripcion.id}
                className="bg-white rounded-2xl border border-neutral-200 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-neutral-900">
                    {inscripcion.servicio_nombre}
                  </p>
                  <p className="text-sm text-neutral-500">
                    Alta: {fecha(inscripcion.fecha_inscripcion)} · Baja:{' '}
                    {fecha(inscripcion.fecha_cancelacion)}
                  </p>
                </div>
                <Badge variant="default">Cancelado</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      {confirmandoBaja && activa && (
        <Dialogo
          tituloId="transporte-confirmar-baja"
          titulo="Cancelar tu recorrido de transporte"
          descripcion={`Tu inscripción a ${activa.servicio_nombre} queda registrada como cancelada y se conserva en el historial. Vas a poder elegir otro recorrido cuando quieras.`}
          selectorFocoInicial="[data-foco-inicial]"
          onCerrar={() => setConfirmandoBaja(false)}
        >
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              data-foco-inicial
              onClick={() => setConfirmandoBaja(false)}
              disabled={enviando}
            >
              Volver sin cancelar
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={cancelar}
              disabled={enviando}
              aria-busy={enviando}
            >
              {enviando ? 'Cancelando…' : 'Sí, cancelar mi recorrido'}
            </Button>
          </div>
        </Dialogo>
      )}
    </div>
  )
}
