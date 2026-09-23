'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  CheckCircle,
  ClockCounterClockwise,
  Prohibit,
  SoccerBall,
  UserPlus,
  WarningCircle,
} from '@phosphor-icons/react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Dialogo } from '@/components/ui/Dialogo'
import { MENSAJE_SIN_HORARIO, mensajeConflicto } from '@/lib/horarios'
import { cn } from '@/lib/utils'
import {
  cancelarInscripcionDeportivaRemota,
  ErrorDeportes,
  inscribirEnGrupoRemoto,
} from '@/services/deportes.client'
import type {
  CompatibilidadPorGrupo,
  GrupoDeportivo,
  HorariosPorGrupo,
  InscripcionDeportiva,
} from '@/services/deportes.service'
import { fecha, nombreNivel } from './formato'
import { ListaFranjas } from './ListaFranjas'

/** Máximo de deportes activos por alumno. La autoridad es PostgreSQL (P5577). */
const MAXIMO_DEPORTES = 2

/**
 * Mismos textos que devuelve el servidor ante cada rechazo, para que la
 * pantalla y la API nunca digan cosas distintas. Se repiten acá porque el
 * módulo de servicio es solo de servidor.
 */
const MOTIVOS = {
  mismoDeporte:
    'Ya estás inscripto en otro grupo de este deporte. Si querés cambiar de grupo, primero cancelá esa inscripción.',
  limiteDos:
    'Ya tenés dos deportes activos, que es el máximo permitido. Cancelá uno para inscribirte en otro.',
  sinPlazas: 'El grupo ya no tiene plazas disponibles.',
} as const

interface MisDeportesProps {
  grupos: GrupoDeportivo[]
  inscripciones: InscripcionDeportiva[]
  /** Franjas activas por grupo (EPT-12). */
  horarios: HorariosPorGrupo
  /**
   * Compatibilidad horaria calculada por PostgreSQL con la misma función que
   * decide el alta. `null` si no se pudo consultar: el alta la verifica igual.
   */
  compatibilidad: CompatibilidadPorGrupo | null
  nivelNombre: string | null
  /** Motivo, resuelto en el servidor, por el que el alumno aún no puede inscribirse. */
  impedimento?: string
  mensajeInicial?: string
}

type Aviso =
  | { tipo: 'exito'; texto: string }
  | { tipo: 'error'; texto: string; sesionVencida?: boolean }

/**
 * Inscripción deportiva del alumno (EPT-34).
 *
 * Toda operación viaja por la API; este componente nunca escribe en la base.
 * Lo que muestra proviene del servidor y se vuelve a pedir después de cada
 * operación —también tras un rechazo—, de modo que lo que se ve es lo que quedó
 * persistido. La disponibilidad es informativa: el alta la vuelve a verificar
 * PostgreSQL con el grupo bloqueado, así que una plaza que otro ocupó primero
 * se rechaza con un mensaje claro en lugar de prometerse.
 */
export function MisDeportes({
  grupos,
  inscripciones,
  horarios,
  compatibilidad,
  nivelNombre,
  impedimento,
  mensajeInicial,
}: MisDeportesProps) {
  const router = useRouter()
  const [refrescando, iniciarRefresco] = useTransition()
  const [enviando, setEnviando] = useState<string | null>(null)
  const [confirmandoBaja, setConfirmandoBaja] = useState<InscripcionDeportiva | null>(null)
  const [aviso, setAviso] = useState<Aviso | null>(
    mensajeInicial ? { tipo: 'error', texto: mensajeInicial } : null
  )
  const regionAviso = useRef<HTMLDivElement>(null)
  // Cuenta los resultados de operaciones. El mensaje inicial no la incrementa,
  // así que al cargar la página el foco no se mueve.
  const [resultados, setResultados] = useState(0)

  const activas = inscripciones.filter((inscripcion) => inscripcion.estado === 'ACTIVA')
  const historial = inscripciones.filter((inscripcion) => inscripcion.estado === 'CANCELADA')
  const deportesActivos = new Set(activas.map((inscripcion) => inscripcion.deporte_id))
  const limiteAlcanzado = activas.length >= MAXIMO_DEPORTES
  const ocupado = enviando !== null || refrescando

  // Tras una operación, el foco va al resultado: el control que la disparó
  // puede desaparecer al actualizarse la lista, y así el lector de pantalla
  // anuncia lo que ocurrió sin que la persona pierda su lugar.
  useEffect(() => {
    if (resultados > 0) regionAviso.current?.focus()
  }, [resultados])

  function reconciliar() {
    iniciarRefresco(() => router.refresh())
  }

  function avisoDeError(problema: unknown, respaldo: string): Aviso {
    if (problema instanceof ErrorDeportes) {
      return {
        tipo: 'error',
        texto:
          problema.estado === 401
            ? 'Tu sesión venció. Iniciá sesión nuevamente para continuar.'
            : problema.message,
        sesionVencida: problema.estado === 401,
      }
    }
    return { tipo: 'error', texto: respaldo }
  }

  /**
   * Sin sesión no hay estado que releer: refrescar llevaría al login y borraría
   * el aviso antes de que la persona lo lea. El aviso ofrece el enlace.
   */
  function sesionVencida(problema: unknown) {
    return problema instanceof ErrorDeportes && problema.estado === 401
  }

  async function inscribirse(grupo: GrupoDeportivo) {
    if (ocupado) return
    setAviso(null)
    setEnviando(grupo.grupo_id)
    let releer = true
    try {
      await inscribirEnGrupoRemoto(grupo.grupo_id)
      setAviso({
        tipo: 'exito',
        texto: `Te inscribiste en ${grupo.deporte_nombre} (${grupo.grupo_nombre}).`,
      })
    } catch (problema) {
      releer = !sesionVencida(problema)
      setAviso(avisoDeError(problema, 'No pudimos completar tu inscripción. Volvé a intentarlo.'))
    } finally {
      setEnviando(null)
      setResultados((cantidad) => cantidad + 1)
      // Éxito o rechazo, se vuelve a leer el estado real: un rechazo por cupo o
      // por límite puede deberse a otra pestaña o a otro alumno.
      if (releer) reconciliar()
    }
  }

  async function cancelar(inscripcion: InscripcionDeportiva) {
    if (ocupado) return
    setAviso(null)
    setEnviando(inscripcion.id)
    let releer = true
    try {
      await cancelarInscripcionDeportivaRemota(inscripcion.id)
      setConfirmandoBaja(null)
      setAviso({
        tipo: 'exito',
        texto: `Cancelaste tu inscripción en ${inscripcion.deporte_nombre}. La plaza quedó libre.`,
      })
    } catch (problema) {
      releer = !sesionVencida(problema)
      setConfirmandoBaja(null)
      setAviso(avisoDeError(problema, 'No pudimos cancelar tu inscripción. Volvé a intentarlo.'))
    } finally {
      setEnviando(null)
      setResultados((cantidad) => cantidad + 1)
      if (releer) reconciliar()
    }
  }

  /**
   * Por qué no se puede pedir este grupo ahora, o `undefined` si se puede. El
   * orden es el mismo en que PostgreSQL evalúa las reglas, así que el motivo
   * anticipado es el que el alta devolvería.
   */
  function motivoBloqueo(grupo: GrupoDeportivo): string | undefined {
    if (impedimento) return impedimento
    if (deportesActivos.has(grupo.deporte_id)) return MOTIVOS.mismoDeporte
    if (limiteAlcanzado) return MOTIVOS.limiteDos
    if (grupo.disponibles <= 0) return MOTIVOS.sinPlazas
    if ((horarios[grupo.grupo_id] ?? []).length === 0) return MENSAJE_SIN_HORARIO
    const conflicto = compatibilidad?.[grupo.grupo_id]?.conflicto
    if (conflicto) return mensajeConflicto(conflicto)
    return undefined
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-600 mb-2">
          Actividades deportivas
        </p>
        <h1 className="text-2xl font-extrabold text-neutral-900 tracking-tight">Deportes</h1>
        <p className="text-neutral-500 text-sm mt-1 max-w-[64ch]">
          Inscribite en los grupos deportivos de tu nivel. Podés tener hasta dos deportes
          activos a la vez, siempre que sus horarios no se superpongan, y cancelar cuando lo
          necesites; al cancelar, tu plaza y tu horario quedan libres.
        </p>
      </header>

      <div
        ref={regionAviso}
        tabIndex={-1}
        aria-live="polite"
        aria-label="Resultado de tu última operación"
        className="space-y-3 outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded-2xl"
      >
        {aviso?.tipo === 'error' && (
          <div
            role="alert"
            className="bg-red-50 border border-red-200 rounded-2xl p-4 flex gap-3 items-start"
          >
            <WarningCircle size={20} weight="fill" className="text-red-500 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="text-sm text-red-800">
              <p>{aviso.texto}</p>
              {aviso.sesionVencida && (
                <Link
                  href="/login?redirect=%2Fdashboard%2Fdeportes"
                  className="inline-block mt-2 font-semibold underline underline-offset-2"
                >
                  Iniciar sesión
                </Link>
              )}
            </div>
          </div>
        )}
        {aviso?.tipo === 'exito' && (
          <div
            role="status"
            className="bg-green-50 border border-green-200 rounded-2xl p-4 flex gap-3 items-start"
          >
            <CheckCircle size={20} weight="fill" className="text-green-600 shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-sm text-green-800">{aviso.texto}</p>
          </div>
        )}
      </div>

      <section
        aria-label="Tu situación deportiva"
        aria-busy={refrescando}
        className="bg-white rounded-2xl border border-neutral-200 p-5 grid gap-4 sm:grid-cols-2"
      >
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Tu nivel</p>
          <p className="text-lg font-bold text-neutral-900 mt-1">{nombreNivel(nivelNombre)}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
            Deportes activos
          </p>
          <p className="text-lg font-bold text-neutral-900 mt-1">
            {activas.length} de {MAXIMO_DEPORTES}
          </p>
          {limiteAlcanzado && (
            <p className="text-sm text-amber-700 mt-1">{MOTIVOS.limiteDos}</p>
          )}
        </div>
        {refrescando && (
          <p className="sm:col-span-2 text-sm text-neutral-500" role="status">
            Actualizando tus deportes…
          </p>
        )}
      </section>

      <section aria-labelledby="deportes-activos-titulo" className="space-y-3">
        <h2 id="deportes-activos-titulo" className="text-lg font-bold text-neutral-900">
          Mis deportes activos
        </h2>
        {activas.length === 0 ? (
          <div className="bg-white rounded-2xl border border-neutral-200 py-8 px-5 text-center">
            <p className="text-sm text-neutral-600 font-semibold">
              Todavía no estás inscripto en ningún deporte
            </p>
            <p className="text-neutral-500 text-sm mt-1">
              Elegí un grupo de la lista de abajo para inscribirte.
            </p>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {activas.map((inscripcion) => (
              <li
                key={inscripcion.id}
                className="bg-white rounded-2xl border border-brand-200 p-5 flex flex-col gap-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-bold text-neutral-900 break-words">
                      {inscripcion.deporte_nombre}
                    </h3>
                    <Badge variant="success" dot>
                      Activa
                    </Badge>
                  </div>
                  <p className="text-sm text-neutral-600 mt-1 break-words">
                    {inscripcion.grupo_nombre} · {nombreNivel(inscripcion.nivel_nombre)}
                  </p>
                  <p className="text-xs text-neutral-500 mt-1">
                    Desde {fecha(inscripcion.fecha_inscripcion)}
                  </p>
                  <ListaFranjas
                    franjas={horarios[inscripcion.grupo_id] ?? []}
                    className="mt-2"
                  />
                </div>
                <Button
                  variant="danger"
                  size="sm"
                  className="self-start"
                  onClick={() => {
                    setAviso(null)
                    setConfirmandoBaja(inscripcion)
                  }}
                  disabled={ocupado}
                  aria-label={`Cancelar mi inscripción en ${inscripcion.deporte_nombre}, ${inscripcion.grupo_nombre}`}
                >
                  <Prohibit size={16} weight="bold" aria-hidden="true" />
                  Cancelar inscripción
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="deportes-grupos-titulo" className="space-y-3">
        <h2 id="deportes-grupos-titulo" className="text-lg font-bold text-neutral-900">
          Grupos disponibles para tu nivel
        </h2>

        {impedimento && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-900">
            {impedimento}
          </div>
        )}

        {!impedimento && compatibilidad === null && grupos.length > 0 && (
          <div
            role="status"
            className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-900"
          >
            No pudimos consultar la compatibilidad horaria de los grupos. Podés inscribirte igual:
            al confirmar, verificamos que los horarios no se superpongan con tus otros deportes.
          </div>
        )}

        {grupos.length === 0 ? (
          <div className="bg-white rounded-2xl border border-neutral-200 py-10 px-5 text-center">
            <SoccerBall size={36} className="text-neutral-300 mx-auto mb-3" aria-hidden="true" />
            <p className="text-sm text-neutral-600 font-semibold">
              No hay grupos deportivos disponibles para tu nivel
            </p>
            <p className="text-neutral-500 text-sm mt-1">
              Cuando la dirección abra grupos para tu nivel, vas a verlos acá.
            </p>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {grupos.map((grupo) => {
              const inscripto = grupo.inscripcion_propia_id !== null
              const motivo = inscripto ? undefined : motivoBloqueo(grupo)
              const idMotivo = `motivo-${grupo.grupo_id}`
              const porcentaje = grupo.cupo > 0 ? Math.min(100, (grupo.ocupados / grupo.cupo) * 100) : 100
              const sinPlazas = grupo.disponibles <= 0
              const franjas = horarios[grupo.grupo_id] ?? []
              const conflicto = inscripto ? null : compatibilidad?.[grupo.grupo_id]?.conflicto

              return (
                <li
                  key={grupo.grupo_id}
                  className={cn(
                    'bg-white rounded-2xl border p-5 flex flex-col gap-3',
                    inscripto ? 'border-brand-300' : 'border-neutral-200'
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-bold text-neutral-900 break-words">
                        {grupo.deporte_nombre}
                      </h3>
                      {inscripto && (
                        <Badge variant="success" dot>
                          Inscripto
                        </Badge>
                      )}
                      {!inscripto && sinPlazas && <Badge variant="danger">Sin plazas</Badge>}
                      {franjas.length === 0 && <Badge variant="warning">Sin horario</Badge>}
                      {conflicto && <Badge variant="danger">Horario superpuesto</Badge>}
                    </div>
                    <p className="text-sm text-neutral-600 mt-1 break-words">{grupo.grupo_nombre}</p>
                    <p className="text-xs text-neutral-500 mt-1 break-words">
                      Profesor responsable: {grupo.profesor_nombre} {grupo.profesor_apellido}
                    </p>
                    <ListaFranjas franjas={franjas} className="mt-2" />
                  </div>

                  <div>
                    <p className="text-sm text-neutral-700">
                      Plazas disponibles:{' '}
                      <span className="font-semibold">
                        {grupo.disponibles} de {grupo.cupo}
                      </span>
                    </p>
                    <div className="h-2 bg-neutral-100 rounded-full overflow-hidden mt-1.5" aria-hidden="true">
                      <div
                        className={cn(
                          'h-full rounded-full',
                          sinPlazas ? 'bg-red-500' : porcentaje >= 80 ? 'bg-amber-500' : 'bg-green-500'
                        )}
                        style={{ width: `${porcentaje}%` }}
                      />
                    </div>
                  </div>

                  {inscripto ? (
                    <p className="text-sm text-brand-700 font-medium">
                      Ya estás inscripto en este grupo.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <Button
                        variant="accent"
                        size="sm"
                        className={cn('self-start', motivo && 'opacity-50 cursor-not-allowed')}
                        aria-disabled={motivo ? true : undefined}
                        aria-describedby={motivo ? idMotivo : undefined}
                        disabled={ocupado}
                        aria-busy={enviando === grupo.grupo_id}
                        onClick={() => {
                          if (motivo) return
                          void inscribirse(grupo)
                        }}
                        aria-label={`Inscribirme en ${grupo.deporte_nombre}, ${grupo.grupo_nombre}`}
                      >
                        <UserPlus size={16} weight="bold" aria-hidden="true" />
                        {enviando === grupo.grupo_id ? 'Inscribiendo…' : 'Inscribirme'}
                      </Button>
                      {motivo && (
                        <p id={idMotivo} className="text-xs text-neutral-600">
                          {motivo}
                        </p>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="deportes-historial-titulo" className="space-y-3">
        <h2
          id="deportes-historial-titulo"
          className="text-sm font-bold text-neutral-900 flex items-center gap-2"
        >
          <ClockCounterClockwise size={18} className="text-neutral-400" aria-hidden="true" />
          Inscripciones anteriores
        </h2>
        {historial.length === 0 ? (
          <p className="text-sm text-neutral-500">
            Todavía no cancelaste ninguna inscripción. Cuando lo hagas, va a quedar registrada acá.
          </p>
        ) : (
          <ul className="space-y-2">
            {historial.map((inscripcion) => (
              <li
                key={inscripcion.id}
                className="bg-white rounded-2xl border border-neutral-200 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-neutral-900 break-words">
                    {inscripcion.deporte_nombre} · {inscripcion.grupo_nombre}
                  </p>
                  <p className="text-sm text-neutral-500">
                    Alta: {fecha(inscripcion.fecha_inscripcion)} · Baja:{' '}
                    {fecha(inscripcion.fecha_cancelacion)}
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
          tituloId="deportes-confirmar-baja"
          titulo={`Cancelar tu inscripción en ${confirmandoBaja.deporte_nombre}`}
          descripcion="Tu plaza en el grupo queda libre para otra persona y la inscripción se conserva en tu historial. Si querés volver, vas a poder inscribirte de nuevo mientras haya plazas."
          selectorFocoInicial="[data-foco-inicial]"
          onCerrar={() => setConfirmandoBaja(null)}
        >
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              data-foco-inicial
              onClick={() => setConfirmandoBaja(null)}
              disabled={enviando !== null}
            >
              Volver sin cancelar
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={() => cancelar(confirmandoBaja)}
              disabled={enviando !== null}
              aria-busy={enviando !== null}
            >
              {enviando !== null ? 'Cancelando…' : 'Sí, cancelar mi inscripción'}
            </Button>
          </div>
        </Dialogo>
      )}
    </div>
  )
}
