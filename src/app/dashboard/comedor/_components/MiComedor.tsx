'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  CheckCircle,
  ClockCounterClockwise,
  ForkKnife,
  Prohibit,
  WarningCircle,
} from '@phosphor-icons/react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Dialogo } from '@/components/ui/Dialogo'
import {
  cancelarInscripcionRemota,
  ErrorComedor,
  inscribirEnServicioRemoto,
} from '@/services/comedor.client'
import type {
  InscripcionServicio,
  ServicioEscolar,
} from '@/services/comedor.service'

interface MiComedorProps {
  servicio: ServicioEscolar | null
  inscripciones: InscripcionServicio[]
  /**
   * Motivo por el que el alumno todavía no puede inscribirse, resuelto en el
   * servidor. La pantalla lo explica; la decisión real la vuelve a tomar
   * PostgreSQL en cada intento.
   */
  impedimento?: string
  mensajeInicial?: string
}

/**
 * Formato de fecha estable entre el servidor y el navegador.
 *
 * `timeZone` explícito: sin él, el servidor formatea en la zona del proceso y
 * el navegador en la de la persona, así que una misma inscripción se vería con
 * dos horas distintas según el dispositivo y React descartaría el árbol
 * hidratado. El centro educativo está en Argentina, que es la referencia
 * correcta para todas las fechas del servicio.
 *
 * `hour12: false`: en formato de 12 horas, Node y los navegadores separan el
 * «a. m.» con caracteres de espacio distintos (uno usa el espacio estrecho sin
 * separación U+202F). La diferencia es invisible en pantalla, pero React la ve
 * y vuelve a generar el árbol. El horario de 24 horas evita el problema de
 * raíz y además es el uso corriente en el país.
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
 * Inscripción propia del alumno al comedor (EPT-28).
 *
 * Toda operación viaja por la API; este componente nunca escribe en la base.
 * El estado que muestra proviene del servidor y se vuelve a pedir después de
 * cada operación, de modo que lo que se ve es lo que quedó persistido.
 */
export function MiComedor({
  servicio,
  inscripciones,
  impedimento,
  mensajeInicial,
}: MiComedorProps) {
  const router = useRouter()
  const [refrescando, iniciarRefresco] = useTransition()
  const [enviando, setEnviando] = useState(false)
  const [confirmandoBaja, setConfirmandoBaja] =
    useState<InscripcionServicio | null>(null)
  const [error, setError] = useState<string | null>(mensajeInicial ?? null)
  const [exito, setExito] = useState<string | null>(null)

  const activa = inscripciones.find((i) => i.estado === 'ACTIVA') ?? null
  const historial = inscripciones.filter((i) => i.estado === 'CANCELADA')
  const ocupado = enviando || refrescando

  function reconciliar() {
    iniciarRefresco(() => router.refresh())
  }

  async function inscribirse() {
    if (!servicio || ocupado) return
    setError(null)
    setExito(null)
    setEnviando(true)
    try {
      await inscribirEnServicioRemoto(servicio.id)
      setExito('Te inscribiste al comedor.')
      reconciliar()
    } catch (problema) {
      setError(
        problema instanceof ErrorComedor
          ? problema.message
          : 'No pudimos completar tu inscripción. Volvé a intentarlo.'
      )
      // Un rechazo por duplicado puede significar que otra pestaña ya te
      // inscribió: se vuelve a leer el estado real en lugar de suponerlo.
      reconciliar()
    } finally {
      setEnviando(false)
    }
  }

  async function cancelar(inscripcion: InscripcionServicio) {
    if (ocupado) return
    setError(null)
    setExito(null)
    setEnviando(true)
    try {
      await cancelarInscripcionRemota(inscripcion.id)
      setConfirmandoBaja(null)
      setExito('Cancelaste tu inscripción al comedor. Podés volver a inscribirte.')
      reconciliar()
    } catch (problema) {
      setError(
        problema instanceof ErrorComedor
          ? problema.message
          : 'No pudimos cancelar tu inscripción. Volvé a intentarlo.'
      )
      setConfirmandoBaja(null)
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
          Comedor
        </h1>
        <p className="text-neutral-500 text-sm mt-1 max-w-[64ch]">
          Consultá tu inscripción al comedor escolar, inscribite si todavía no lo
          hiciste y cancelá cuando lo necesites. Podés volver a inscribirte después de
          cancelar.
        </p>
      </div>

      <div
        aria-live="polite"
        aria-label="Estado de tu inscripción al comedor"
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
      </div>

      <section
        aria-labelledby="comedor-estado-titulo"
        className="bg-white rounded-2xl border border-neutral-200 p-5 sm:p-6"
      >
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-brand-50 flex items-center justify-center shrink-0">
            <ForkKnife size={24} weight="fill" className="text-brand-600" />
          </div>
          <div className="min-w-0 flex-1">
            <h2
              id="comedor-estado-titulo"
              className="font-bold text-neutral-900 break-words"
            >
              {servicio?.nombre ?? 'Comedor escolar'}
            </h2>
            <p className="mt-1">
              {activa ? (
                <Badge variant="success" dot>
                  Inscripción activa
                </Badge>
              ) : (
                <Badge variant="outline">Sin inscripción activa</Badge>
              )}
            </p>
            {activa ? (
              <dl className="mt-4 grid gap-3 sm:grid-cols-2 text-sm">
                <div>
                  <dt className="text-neutral-500">Legajo</dt>
                  <dd className="font-semibold text-neutral-900 break-words">
                    {activa.legajo_nro ?? '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-neutral-500">Fecha de inscripción</dt>
                  <dd className="font-semibold text-neutral-900">
                    {fecha(activa.fecha_inscripcion)}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-neutral-600 mt-3 leading-relaxed">
                {impedimento ??
                  'Todavía no estás inscripto al comedor. Cuando te inscribas vas a ver acá tu legajo y la fecha de alta.'}
              </p>
            )}
          </div>
        </div>

        <div className="mt-5 flex flex-col sm:flex-row gap-2">
          {activa ? (
            <Button
              variant="danger"
              onClick={() => {
                setError(null)
                setExito(null)
                setConfirmandoBaja(activa)
              }}
              disabled={ocupado}
              aria-busy={ocupado}
              fullWidth
              className="sm:w-auto"
            >
              <Prohibit size={18} weight="bold" />
              Cancelar mi inscripción
            </Button>
          ) : (
            <Button
              onClick={inscribirse}
              disabled={ocupado || !servicio || Boolean(impedimento)}
              aria-busy={ocupado}
              fullWidth
              className="sm:w-auto"
            >
              <ForkKnife size={18} weight="bold" />
              {enviando ? 'Inscribiendo…' : 'Inscribirme al comedor'}
            </Button>
          )}
        </div>
      </section>

      <section aria-labelledby="comedor-historial-titulo" className="space-y-3">
        <h2
          id="comedor-historial-titulo"
          className="text-sm font-bold text-neutral-900 flex items-center gap-2"
        >
          <ClockCounterClockwise size={18} className="text-neutral-400" />
          Inscripciones anteriores
        </h2>
        {historial.length === 0 ? (
          <div className="bg-white rounded-2xl border border-neutral-200 py-10 px-5 text-center">
            <p className="text-sm text-neutral-600 font-semibold">
              Todavía no cancelaste ninguna inscripción
            </p>
            <p className="text-neutral-400 text-sm mt-1">
              Cuando canceles, el ciclo va a quedar registrado acá. Nada se elimina.
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
                    Alta: {fecha(inscripcion.fecha_inscripcion)}
                  </p>
                  <p className="text-sm text-neutral-500">
                    Baja: {fecha(inscripcion.fecha_cancelacion)}
                  </p>
                </div>
                <Badge variant="default">Cancelada</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      {confirmandoBaja && (
        <Dialogo
          tituloId="comedor-confirmar-baja"
          titulo="Cancelar tu inscripción al comedor"
          descripcion="Tu inscripción queda registrada como cancelada y se conserva en el historial. Vas a poder volver a inscribirte cuando quieras."
          selectorFocoInicial="[data-foco-inicial]"
          onCerrar={() => setConfirmandoBaja(null)}
        >
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              data-foco-inicial
              onClick={() => setConfirmandoBaja(null)}
              disabled={enviando}
            >
              Volver sin cancelar
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={() => cancelar(confirmandoBaja)}
              disabled={enviando}
              aria-busy={enviando}
            >
              {enviando ? 'Cancelando…' : 'Sí, cancelar mi inscripción'}
            </Button>
          </div>
        </Dialogo>
      )}
    </div>
  )
}
