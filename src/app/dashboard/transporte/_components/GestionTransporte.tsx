'use client'

import { useId, useMemo, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Bus, CheckCircle, MapPin, PencilSimple, WarningCircle } from '@phosphor-icons/react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Dialogo } from '@/components/ui/Dialogo'
import { Input } from '@/components/ui/Input'
import { cn } from '@/lib/utils'
import { actualizarRecorridoRemoto, ErrorTransporte } from '@/services/transporte.client'
import type {
  InscripcionTransporte,
  Recorrido,
} from '@/services/transporte.service'

interface GestionTransporteProps {
  recorridos: Recorrido[]
  inscripciones: InscripcionTransporte[]
}

type Filtro = 'ACTIVAS' | 'CANCELADAS' | 'TODAS'

const FILTROS: { valor: Filtro; etiqueta: string }[] = [
  { valor: 'ACTIVAS', etiqueta: 'Activas' },
  { valor: 'CANCELADAS', etiqueta: 'Canceladas' },
  { valor: 'TODAS', etiqueta: 'Todas' },
]

/** Mismo formato de fecha estable que el resto de servicios escolares. */
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
 * Consulta administrativa de los cuatro recorridos y sus inscriptos, con
 * mantenimiento descriptivo (EPT-60).
 *
 * Dirección consulta los cuatro recorridos con sus alumnos inscriptos y puede
 * editar el nombre y el estado activo/inactivo de cada uno. No inscribe ni
 * cancela en nombre de un alumno: esa facultad es exclusiva de la sesión del
 * propio estudiante, tanto en el servidor como en PostgreSQL. El código y el
 * tipo de cada recorrido no se editan desde ninguna pantalla.
 */
export function GestionTransporte({ recorridos, inscripciones }: GestionTransporteProps) {
  const router = useRouter()
  const [refrescando, iniciarRefresco] = useTransition()
  const [editando, setEditando] = useState<Recorrido | null>(null)
  const [nombreEditado, setNombreEditado] = useState('')
  const [activoEditado, setActivoEditado] = useState(true)
  const [errorEdicion, setErrorEdicion] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [exito, setExito] = useState<string | null>(null)
  const [filtroRecorrido, setFiltroRecorrido] = useState<string>('TODOS')
  const [filtroEstado, setFiltroEstado] = useState<Filtro>('ACTIVAS')
  const [busqueda, setBusqueda] = useState('')
  const idBusqueda = useId()

  const conteoActivas = useMemo(() => {
    const conteo = new Map<string, number>()
    for (const inscripcion of inscripciones) {
      if (inscripcion.estado !== 'ACTIVA') continue
      conteo.set(inscripcion.servicio_id, (conteo.get(inscripcion.servicio_id) ?? 0) + 1)
    }
    return conteo
  }, [inscripciones])

  const visibles = useMemo(() => {
    const termino = busqueda.trim().toLocaleLowerCase('es-AR')
    return inscripciones
      .filter((inscripcion) =>
        filtroRecorrido === 'TODOS' ? true : inscripcion.servicio_id === filtroRecorrido
      )
      .filter((inscripcion) =>
        filtroEstado === 'TODAS'
          ? true
          : filtroEstado === 'ACTIVAS'
            ? inscripcion.estado === 'ACTIVA'
            : inscripcion.estado === 'CANCELADA'
      )
      .filter((inscripcion) => {
        if (!termino) return true
        return [
          inscripcion.alumno_apellido,
          inscripcion.alumno_nombre,
          inscripcion.legajo_nro ?? '',
          inscripcion.servicio_nombre,
        ]
          .join(' ')
          .toLocaleLowerCase('es-AR')
          .includes(termino)
      })
  }, [inscripciones, filtroRecorrido, filtroEstado, busqueda])

  function abrirEdicion(recorrido: Recorrido) {
    setEditando(recorrido)
    setNombreEditado(recorrido.nombre)
    setActivoEditado(recorrido.activo)
    setErrorEdicion(null)
    setExito(null)
  }

  async function guardarEdicion(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (!editando || guardando) return

    const nombre = nombreEditado.trim()
    if (!nombre) {
      setErrorEdicion('El nombre del recorrido es requerido')
      return
    }
    if (nombre.length > 100) {
      setErrorEdicion('El nombre del recorrido no puede superar los 100 caracteres')
      return
    }

    setGuardando(true)
    setErrorEdicion(null)
    try {
      await actualizarRecorridoRemoto(editando.id, nombre, activoEditado)
      setExito(`Actualizaste ${editando.codigo}.`)
      setEditando(null)
      iniciarRefresco(() => router.refresh())
    } catch (problema) {
      setErrorEdicion(
        problema instanceof ErrorTransporte
          ? problema.message
          : 'No pudimos guardar los cambios. Volvé a intentarlo.'
      )
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-600 mb-2">
          Servicios escolares
        </p>
        <h1 className="text-2xl font-extrabold text-neutral-900 tracking-tight">Transporte</h1>
        <p className="text-neutral-500 text-sm mt-1 max-w-[64ch]">
          Consultá los cuatro recorridos de transporte, sus alumnos inscriptos y mantené el
          nombre y el estado de cada uno. El código y las paradas son datos de referencia y no
          se editan desde acá.
        </p>
      </header>

      {exito && (
        <div
          role="status"
          className="bg-green-50 border border-green-200 rounded-2xl p-4 flex gap-3 items-start"
        >
          <CheckCircle size={20} weight="fill" className="text-green-600 shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-sm text-green-800">{exito}</p>
        </div>
      )}

      <section aria-labelledby="recorridos-titulo" aria-busy={refrescando} className="space-y-3">
        <h2 id="recorridos-titulo" className="text-lg font-bold text-neutral-900">
          Recorridos
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {recorridos.map((recorrido) => (
            <li
              key={recorrido.id}
              className="bg-white rounded-2xl border border-neutral-200 p-5 flex flex-col gap-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Bus size={20} weight="fill" className="text-brand-600 shrink-0" aria-hidden="true" />
                  <h3 className="font-bold text-neutral-900 break-words">{recorrido.nombre}</h3>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => abrirEdicion(recorrido)}
                  aria-label={`Editar ${recorrido.nombre}`}
                >
                  <PencilSimple size={16} weight="bold" aria-hidden="true" />
                  Editar
                </Button>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline">{recorrido.codigo}</Badge>
                {recorrido.activo ? (
                  <Badge variant="success" dot>
                    Activo
                  </Badge>
                ) : (
                  <Badge variant="default">Inactivo</Badge>
                )}
              </div>
              <ol className="flex flex-wrap items-center gap-1.5 text-sm text-neutral-600">
                {recorrido.paradas.map((parada, indice) => (
                  <li key={parada.orden} className="flex items-center gap-1.5">
                    {indice > 0 && <span aria-hidden="true">→</span>}
                    <span className="inline-flex items-center gap-1">
                      <MapPin size={14} className="text-neutral-400" aria-hidden="true" />
                      {parada.nombre}
                    </span>
                  </li>
                ))}
              </ol>
              <p className="text-sm text-neutral-500">
                {conteoActivas.get(recorrido.id) ?? 0} alumno(s) con inscripción activa
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="inscripciones-titulo" className="space-y-3">
        <h2 id="inscripciones-titulo" className="text-lg font-bold text-neutral-900">
          Inscripciones de los alumnos
        </h2>
        <div className="flex flex-col md:flex-row md:items-end gap-3">
          <div role="group" aria-label="Filtrar por recorrido" className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setFiltroRecorrido('TODOS')}
              aria-pressed={filtroRecorrido === 'TODOS'}
              className={cn(
                'px-4 py-2 rounded-full text-sm font-semibold border transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
                filtroRecorrido === 'TODOS'
                  ? 'bg-brand-500 text-white border-brand-500'
                  : 'bg-white text-neutral-700 border-neutral-300 hover:border-brand-400'
              )}
            >
              Todos los recorridos
            </button>
            {recorridos.map((recorrido) => (
              <button
                key={recorrido.id}
                type="button"
                onClick={() => setFiltroRecorrido(recorrido.id)}
                aria-pressed={filtroRecorrido === recorrido.id}
                className={cn(
                  'px-4 py-2 rounded-full text-sm font-semibold border transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
                  filtroRecorrido === recorrido.id
                    ? 'bg-brand-500 text-white border-brand-500'
                    : 'bg-white text-neutral-700 border-neutral-300 hover:border-brand-400'
                )}
              >
                {recorrido.codigo}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col md:flex-row md:items-end gap-3">
          <div role="group" aria-label="Filtrar por estado" className="flex flex-wrap gap-2">
            {FILTROS.map(({ valor, etiqueta }) => (
              <button
                key={valor}
                type="button"
                onClick={() => setFiltroEstado(valor)}
                aria-pressed={filtroEstado === valor}
                className={cn(
                  'px-4 py-2 rounded-full text-sm font-semibold border transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
                  filtroEstado === valor
                    ? 'bg-brand-500 text-white border-brand-500'
                    : 'bg-white text-neutral-700 border-neutral-300 hover:border-brand-400'
                )}
              >
                {etiqueta}
              </button>
            ))}
          </div>
          <div className="md:ml-auto md:w-80">
            <Input
              id={idBusqueda}
              label="Buscar"
              placeholder="Alumno, legajo o recorrido"
              value={busqueda}
              onChange={(evento) => setBusqueda(evento.target.value)}
            />
          </div>
        </div>

        <p className="text-sm text-neutral-500" role="status">
          {visibles.length === 1 ? '1 inscripción' : `${visibles.length} inscripciones`}
        </p>

        {visibles.length === 0 ? (
          <div className="bg-white rounded-2xl border border-neutral-200 py-8 px-5 text-center">
            <p className="text-sm text-neutral-600 font-semibold">
              No hay inscripciones para mostrar
            </p>
            <p className="text-neutral-500 text-sm mt-1">
              Probá con otro filtro o con otra búsqueda.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {visibles.map((inscripcion) => (
              <li
                key={inscripcion.id}
                className="bg-white rounded-2xl border border-neutral-200 p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-neutral-900 break-words">
                    {inscripcion.alumno_apellido}, {inscripcion.alumno_nombre}
                    <span className="font-normal text-neutral-500">
                      {' '}
                      · Legajo {inscripcion.legajo_nro ?? '—'}
                    </span>
                  </p>
                  <p className="text-sm text-neutral-600 break-words">
                    {inscripcion.servicio_nombre} ({inscripcion.servicio_codigo})
                  </p>
                  <p className="text-xs text-neutral-500">
                    Alta: {fecha(inscripcion.fecha_inscripcion)}
                    {inscripcion.fecha_cancelacion
                      ? ` · Baja: ${fecha(inscripcion.fecha_cancelacion)}`
                      : ''}
                  </p>
                </div>
                {inscripcion.estado === 'ACTIVA' ? (
                  <Badge variant="success" dot className="self-start md:self-auto">
                    Activa
                  </Badge>
                ) : (
                  <Badge variant="default" className="self-start md:self-auto">
                    Cancelada
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {editando && (
        <Dialogo
          tituloId="transporte-editar-recorrido"
          titulo={`Editar ${editando.codigo}`}
          descripcion="El código y las paradas son datos de referencia fijos y no se editan desde acá."
          selectorFocoInicial="#recorrido-nombre"
          onCerrar={() => {
            if (!guardando) setEditando(null)
          }}
        >
          <form onSubmit={guardarEdicion} noValidate className="space-y-4">
            {errorEdicion && (
              <div
                role="alert"
                className="bg-red-50 border border-red-200 rounded-xl p-3 flex gap-2 items-start text-sm text-red-800"
              >
                <WarningCircle size={18} weight="fill" className="text-red-500 shrink-0 mt-0.5" aria-hidden="true" />
                <p>{errorEdicion}</p>
              </div>
            )}
            <Input
              id="recorrido-nombre"
              label="Nombre del recorrido"
              value={nombreEditado}
              maxLength={100}
              onChange={(evento) => setNombreEditado(evento.target.value)}
              required
            />
            <label className="flex items-center gap-2 text-sm font-medium text-neutral-700">
              <input
                type="checkbox"
                checked={activoEditado}
                onChange={(evento) => setActivoEditado(evento.target.checked)}
                className="h-4 w-4 rounded border-neutral-300 text-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500"
              />
              Recorrido activo (admite nuevas inscripciones)
            </label>
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditando(null)}
                disabled={guardando}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={guardando} aria-busy={guardando}>
                {guardando ? 'Guardando…' : 'Guardar cambios'}
              </Button>
            </div>
          </form>
        </Dialogo>
      )}
    </div>
  )
}
