'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import {
  ArrowCounterClockwise,
  CaretDown,
  CaretRight,
  ChalkboardTeacher,
  PencilSimple,
  Prohibit,
} from '@phosphor-icons/react'
import { Badge, Skeleton } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Dialogo } from '@/components/ui/Dialogo'
import { Input, Textarea } from '@/components/ui/Input'
import { fecha } from '@/app/dashboard/deportes/_components/formato'
import { cantidadDeCaracteres, MOTIVO_MAXIMO } from '@/lib/profesores'
import { fichaProfesorSchema, motivoEstadoSchema, type FichaProfesorData } from '@/lib/validations'
import {
  actualizarFichaProfesorRemota,
  cambiarEstadoProfesorRemoto,
  ErrorProfesor,
  obtenerDetalleProfesorRemoto,
} from '@/services/profesores.client'
import type {
  BloqueosInactivacion,
  DetalleProfesor,
  FichaResumen,
} from '@/services/profesores.service'
import { RelacionesHistoricas, RelacionesVigentes } from './Relaciones'

type Filtro = 'TODOS' | 'ACTIVOS' | 'INACTIVOS' | 'INCOMPLETAS'

const FILTROS: { valor: Filtro; etiqueta: string }[] = [
  { valor: 'TODOS', etiqueta: 'Todos' },
  { valor: 'ACTIVOS', etiqueta: 'Activos' },
  { valor: 'INACTIVOS', etiqueta: 'Inactivos' },
  { valor: 'INCOMPLETAS', etiqueta: 'Fichas incompletas' },
]

type EstadoDetalle =
  | { estado: 'cargando' }
  | { estado: 'error'; mensaje: string }
  | { estado: 'listo'; datos: DetalleProfesor }

const MENSAJE_RESPALDO = 'No pudimos completar la operación. Volvé a intentarlo.'

export function nombreCompleto(ficha: Pick<FichaResumen, 'nombre' | 'apellido'>) {
  return `${ficha.apellido}, ${ficha.nombre}`
}

function resumenACargo(ficha: FichaResumen) {
  if (ficha.asignaciones_activas === 0 && ficha.grupos_activos === 0) {
    return 'Sin materias ni grupos a cargo'
  }
  const materias =
    ficha.asignaciones_activas === 1 ? '1 materia' : `${ficha.asignaciones_activas} materias`
  const grupos = ficha.grupos_activos === 1 ? '1 grupo deportivo' : `${ficha.grupos_activos} grupos deportivos`
  return `A cargo de ${materias} y ${grupos}`
}

/** `2014-05-03` → `03/05/2014`, sin pasar por zonas horarias. */
function fechaCalendario(valor: string | null) {
  if (!valor) return '—'
  const [anio, mes, dia] = valor.split('-')
  return anio && mes && dia ? `${dia}/${mes}/${anio}` : '—'
}

function estadoEnTexto(estado: 'ACTIVO' | 'INACTIVO') {
  return estado === 'ACTIVO' ? 'Activo' : 'Inactivo'
}

/** Fichas de profesores de la dirección, siempre mediadas por la API. */
export function GestionProfesores({
  profesores,
  mensajeExitoInicial,
}: {
  profesores: FichaResumen[]
  mensajeExitoInicial?: string
}) {
  const router = useRouter()
  const [refrescando, iniciarRefresco] = useTransition()
  const [filtro, setFiltro] = useState<Filtro>('TODOS')
  const [expandidos, setExpandidos] = useState<string[]>([])
  const [detalles, setDetalles] = useState<Record<string, EstadoDetalle>>({})
  const [fichaEnEdicion, setFichaEnEdicion] = useState<FichaResumen | null>(null)
  const [fichaEnEstado, setFichaEnEstado] = useState<FichaResumen | null>(null)
  // Los rechazos se muestran en el diálogo que los provocó; acá solo el éxito,
  // que llega cuando el diálogo ya se cerró.
  const [mensajeExito, setMensajeExito] = useState<string | null>(mensajeExitoInicial ?? null)

  const especialidadesSugeridas = useMemo(
    () =>
      Array.from(
        new Set(profesores.map((ficha) => ficha.especialidad).filter((e): e is string => Boolean(e)))
      ).sort((a, b) => a.localeCompare(b, 'es')),
    [profesores]
  )

  const visibles = useMemo(
    () =>
      profesores.filter((ficha) => {
        if (filtro === 'ACTIVOS') return ficha.estado === 'ACTIVO'
        if (filtro === 'INACTIVOS') return ficha.estado === 'INACTIVO'
        if (filtro === 'INCOMPLETAS') return !ficha.ficha_completa
        return true
      }),
    [profesores, filtro]
  )

  function limpiarMensajes() {
    setMensajeExito(null)
  }

  async function cargarDetalle(profesorId: string) {
    setDetalles((actuales) => ({ ...actuales, [profesorId]: { estado: 'cargando' } }))
    try {
      const datos = await obtenerDetalleProfesorRemoto(profesorId)
      setDetalles((actuales) => ({ ...actuales, [profesorId]: { estado: 'listo', datos } }))
    } catch (error) {
      const mensaje = error instanceof ErrorProfesor ? error.message : MENSAJE_RESPALDO
      setDetalles((actuales) => ({ ...actuales, [profesorId]: { estado: 'error', mensaje } }))
    }
  }

  function alternarDetalle(profesorId: string) {
    const abierto = expandidos.includes(profesorId)
    setExpandidos((actuales) =>
      abierto ? actuales.filter((id) => id !== profesorId) : [...actuales, profesorId]
    )
    if (!abierto && detalles[profesorId]?.estado !== 'listo') void cargarDetalle(profesorId)
  }

  function informarExito(texto: string, profesorId: string) {
    setMensajeExito(texto)
    toast.success(texto)
    iniciarRefresco(() => router.refresh())
    if (expandidos.includes(profesorId)) {
      void cargarDetalle(profesorId)
      return
    }
    // El detalle guardado ya no es el vigente: se vuelve a pedir al abrirlo.
    setDetalles((actuales) => {
      const vigentes = { ...actuales }
      delete vigentes[profesorId]
      return vigentes
    })
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-600 mb-2">
          Legajos y personal
        </p>
        <h1 className="text-2xl font-extrabold text-neutral-900 tracking-tight">Profesores</h1>
        <p className="text-neutral-500 text-sm mt-1 max-w-[70ch]">
          Fichas de los docentes: legajo, especialidad, estado y lo que tienen a cargo. El alta de
          personas y cuentas se hace en Usuarios; acá se completa la ficha y se cambia el estado.
        </p>
      </div>

      <div aria-live="polite" aria-label="Estado de la administración de profesores" className="space-y-3">
        {mensajeExito && (
          <div
            role="status"
            className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-sm text-emerald-800"
          >
            {mensajeExito}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar profesores">
        {FILTROS.map(({ valor, etiqueta }) => (
          <Button
            key={valor}
            size="sm"
            variant={filtro === valor ? 'primary' : 'outline'}
            aria-pressed={filtro === valor}
            onClick={() => setFiltro(valor)}
          >
            {etiqueta}
          </Button>
        ))}
      </div>

      {profesores.length === 0 ? (
        <EstadoVacio
          titulo="Todavía no hay profesores"
          detalle="Cuando des de alta una persona con el rol DOCENTE en Usuarios, su ficha aparece acá."
        />
      ) : visibles.length === 0 ? (
        <EstadoVacio titulo="No hay profesores con ese filtro" detalle="Cambiá el filtro para ver el resto." />
      ) : (
        <ul className="space-y-3" aria-busy={refrescando} aria-label="Fichas de profesores">
          {visibles.map((ficha) => {
            const nombre = nombreCompleto(ficha)
            const expandido = expandidos.includes(ficha.perfil_id)
            const detalle = detalles[ficha.perfil_id]
            return (
              <li
                key={ficha.perfil_id}
                className="bg-white rounded-2xl border border-neutral-200 p-4 sm:p-5 space-y-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-neutral-900 break-words">{nombre}</p>
                    <p className="text-xs text-neutral-500 mt-1 break-words">
                      Legajo {ficha.legajo_nro ?? 'sin cargar'} ·{' '}
                      {ficha.especialidad ?? 'Especialidad sin cargar'}
                    </p>
                    <p className="text-xs text-neutral-600 mt-1">{resumenACargo(ficha)}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant={ficha.estado === 'ACTIVO' ? 'success' : 'default'} dot>
                      {estadoEnTexto(ficha.estado)}
                    </Badge>
                    {!ficha.ficha_completa && <Badge variant="warning">Ficha incompleta</Badge>}
                    {!ficha.rol_docente_vigente && <Badge variant="warning">Sin rol DOCENTE</Badge>}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      limpiarMensajes()
                      setFichaEnEdicion(ficha)
                    }}
                    aria-label={`Editar la ficha de ${nombre}`}
                  >
                    <PencilSimple size={15} />
                    Editar ficha
                  </Button>
                  <Button
                    size="sm"
                    variant={ficha.estado === 'ACTIVO' ? 'outline' : 'secondary'}
                    onClick={() => {
                      limpiarMensajes()
                      setFichaEnEstado(ficha)
                    }}
                    aria-label={
                      ficha.estado === 'ACTIVO' ? `Inactivar a ${nombre}` : `Reactivar a ${nombre}`
                    }
                  >
                    {ficha.estado === 'ACTIVO' ? <Prohibit size={15} /> : <ArrowCounterClockwise size={15} />}
                    {ficha.estado === 'ACTIVO' ? 'Inactivar' : 'Reactivar'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => alternarDetalle(ficha.perfil_id)}
                    aria-expanded={expandido}
                    aria-controls={`detalle-profesor-${ficha.perfil_id}`}
                    aria-label={`Ver el detalle de ${nombre}`}
                  >
                    {expandido ? <CaretDown size={15} /> : <CaretRight size={15} />}
                    Ver detalle
                  </Button>
                </div>

                {expandido && (
                  <div
                    id={`detalle-profesor-${ficha.perfil_id}`}
                    className="border-t border-neutral-100 pt-4"
                  >
                    <DetalleFicha
                      nombre={nombre}
                      detalle={detalle}
                      onReintentar={() => void cargarDetalle(ficha.perfil_id)}
                    />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {fichaEnEdicion && (
        <DialogoFicha
          ficha={fichaEnEdicion}
          sugerencias={especialidadesSugeridas}
          onCerrar={() => setFichaEnEdicion(null)}
          onGuardada={(texto) => {
            const id = fichaEnEdicion.perfil_id
            setFichaEnEdicion(null)
            informarExito(texto, id)
          }}
        />
      )}

      {fichaEnEstado && (
        <DialogoEstado
          ficha={fichaEnEstado}
          onCerrar={() => setFichaEnEstado(null)}
          onCambiado={(texto) => {
            const id = fichaEnEstado.perfil_id
            setFichaEnEstado(null)
            informarExito(texto, id)
          }}
        />
      )}
    </div>
  )
}

function EstadoVacio({ titulo, detalle }: { titulo: string; detalle: string }) {
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 py-14 px-6 text-center">
      <ChalkboardTeacher size={40} className="text-neutral-300 mx-auto mb-3" aria-hidden="true" />
      <p className="font-semibold text-neutral-800">{titulo}</p>
      <p className="text-sm text-neutral-500 mt-1">{detalle}</p>
    </div>
  )
}

function DetalleFicha({
  nombre,
  detalle,
  onReintentar,
}: {
  nombre: string
  detalle: EstadoDetalle | undefined
  onReintentar: () => void
}) {
  if (!detalle || detalle.estado === 'cargando') {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <p className="sr-only" role="status">
          Cargando el detalle de {nombre}…
        </p>
      </div>
    )
  }

  if (detalle.estado === 'error') {
    return (
      <div role="alert" className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
        <p className="text-sm text-red-800">{detalle.mensaje}</p>
        <Button size="sm" variant="outline" onClick={onReintentar}>
          Reintentar
        </Button>
      </div>
    )
  }

  const { ficha, asignaciones, horarios, historial } = detalle.datos

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section aria-label={`Datos personales de ${nombre}`} className="space-y-2">
        <h3 className="text-sm font-bold text-neutral-900">Datos personales</h3>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-neutral-500">DNI</dt>
          <dd className="text-neutral-900 break-words">{ficha.dni || '—'}</dd>
          <dt className="text-neutral-500">Teléfono</dt>
          <dd className="text-neutral-900 break-words">{ficha.telefono || '—'}</dd>
          <dt className="text-neutral-500">Dirección</dt>
          <dd className="text-neutral-900 break-words">{ficha.direccion || '—'}</dd>
          <dt className="text-neutral-500">Nacimiento</dt>
          <dd className="text-neutral-900">{fechaCalendario(ficha.fecha_nacimiento)}</dd>
        </dl>
        {!ficha.rol_docente_vigente && (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
            La persona ya no tiene el rol DOCENTE. La ficha se conserva como historial y no se puede
            reactivar.
          </p>
        )}
      </section>

      <section aria-label={`Historial de estados de ${nombre}`} className="space-y-2">
        <h3 className="text-sm font-bold text-neutral-900">Historial de estados</h3>
        {historial.length === 0 ? (
          <p className="text-sm text-neutral-500">Todavía no hubo cambios de estado.</p>
        ) : (
          <ol className="space-y-2" aria-label={`Cambios de estado de ${nombre}`}>
            {historial.map((cambio) => (
              <li key={cambio.id} className="rounded-xl border border-neutral-200 p-3 text-sm">
                <p className="font-medium text-neutral-900">
                  {estadoEnTexto(cambio.estado_anterior)} → {estadoEnTexto(cambio.estado_nuevo)}
                </p>
                <p className="text-xs text-neutral-500 mt-0.5">
                  {fecha(cambio.fecha)} · Por {cambio.actor}
                </p>
                <p className="text-xs text-neutral-700 mt-1 whitespace-pre-line break-words">
                  {cambio.motivo ? `Motivo: ${cambio.motivo}` : 'Sin motivo informado'}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-label={`Relaciones a cargo de ${nombre}`} className="space-y-2">
        <h3 className="text-sm font-bold text-neutral-900">A cargo actualmente</h3>
        <RelacionesVigentes
          asignaciones={asignaciones}
          horarios={horarios}
          etiqueta={`Materias y grupos vigentes de ${nombre}`}
          vacio="No tiene materias ni grupos activos a cargo."
        />
      </section>

      <section aria-label={`Relaciones históricas de ${nombre}`} className="space-y-2">
        <h3 className="text-sm font-bold text-neutral-900">Relaciones históricas</h3>
        <RelacionesHistoricas
          asignaciones={asignaciones}
          etiqueta={`Materias y grupos inactivos de ${nombre}`}
          vacio="No hay relaciones inactivas a su nombre."
        />
      </section>
    </div>
  )
}

/**
 * Un rechazo se anuncia una sola vez y donde está el foco: en el campo si es
 * de un campo, y si no en una alerta del diálogo, que sigue abierto.
 */
function DialogoFicha({
  ficha,
  sugerencias,
  onCerrar,
  onGuardada,
}: {
  ficha: FichaResumen
  sugerencias: string[]
  onCerrar: () => void
  onGuardada: (texto: string) => void
}) {
  const nombre = nombreCompleto(ficha)
  const formulario = useForm<FichaProfesorData>({
    resolver: zodResolver(fichaProfesorSchema),
    mode: 'onTouched',
    defaultValues: { legajo_nro: ficha.legajo_nro ?? '', especialidad: ficha.especialidad ?? '' },
  })
  const enviando = formulario.formState.isSubmitting
  const [rechazo, setRechazo] = useState<string | null>(null)

  async function guardar(datos: FichaProfesorData) {
    setRechazo(null)
    try {
      await actualizarFichaProfesorRemota(ficha.perfil_id, datos.legajo_nro, datos.especialidad)
      onGuardada(`Ficha de ${nombre} guardada.`)
    } catch (error) {
      const mensaje = error instanceof ErrorProfesor ? error.message : MENSAJE_RESPALDO
      if (error instanceof ErrorProfesor && (error.campo === 'legajo_nro' || error.campo === 'especialidad')) {
        formulario.setError(error.campo, { type: 'server', message: mensaje })
        return
      }
      setRechazo(mensaje)
    }
  }

  return (
    <Dialogo
      tituloId="titulo-ficha-profesor"
      titulo={`Ficha de ${nombre}`}
      descripcion="Para que la ficha quede completa hacen falta el número de legajo y la especialidad."
      selectorFocoInicial="#ficha-legajo"
      onCerrar={() => {
        if (!enviando) onCerrar()
      }}
    >
      <form onSubmit={formulario.handleSubmit(guardar)} noValidate className="space-y-4">
        {rechazo && (
          <div role="alert" className="bg-red-50 border border-red-200 rounded-xl p-3">
            <p className="text-sm text-red-800">{rechazo}</p>
          </div>
        )}
        <Input
          label="Número de legajo"
          id="ficha-legajo"
          required
          autoComplete="off"
          maxLength={50}
          error={formulario.formState.errors.legajo_nro?.message}
          {...formulario.register('legajo_nro')}
        />
        <Input
          label="Especialidad"
          id="ficha-especialidad"
          required
          autoComplete="off"
          list="especialidades-sugeridas"
          helperText="Texto libre de 2 a 100 caracteres. Podés elegir una especialidad ya usada o escribir otra."
          error={formulario.formState.errors.especialidad?.message}
          {...formulario.register('especialidad')}
        />
        <datalist id="especialidades-sugeridas">
          {sugerencias.map((sugerencia) => (
            <option key={sugerencia} value={sugerencia} />
          ))}
        </datalist>
        <div className="flex flex-wrap gap-3 pt-2">
          <Button type="submit" loading={enviando}>
            Guardar ficha
          </Button>
          <Button type="button" variant="ghost" onClick={onCerrar} disabled={enviando}>
            Cancelar
          </Button>
        </div>
      </form>
    </Dialogo>
  )
}

/** Igual que la ficha: el rechazo y lo que lo causa se anuncian solo en el diálogo. */
function DialogoEstado({
  ficha,
  onCerrar,
  onCambiado,
}: {
  ficha: FichaResumen
  onCerrar: () => void
  onCambiado: (texto: string) => void
}) {
  const nombre = nombreCompleto(ficha)
  const inactivar = ficha.estado === 'ACTIVO'
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [errorMotivo, setErrorMotivo] = useState<string | null>(null)
  const [rechazo, setRechazo] = useState<{ mensaje: string; bloqueos?: BloqueosInactivacion } | null>(
    null
  )
  const largoMotivo = cantidadDeCaracteres(motivo)

  async function confirmar() {
    setRechazo(null)
    const motivoLeido = motivoEstadoSchema.safeParse(motivo)
    if (!motivoLeido.success) {
      setErrorMotivo(motivoLeido.error.issues[0]?.message ?? 'Revisá el motivo.')
      return
    }
    setErrorMotivo(null)
    setEnviando(true)
    try {
      await cambiarEstadoProfesorRemoto(
        ficha.perfil_id,
        inactivar ? 'INACTIVO' : 'ACTIVO',
        motivoLeido.data
      )
      onCambiado(inactivar ? `${nombre} quedó inactivo.` : `${nombre} quedó activo nuevamente.`)
    } catch (error) {
      const mensaje = error instanceof ErrorProfesor ? error.message : MENSAJE_RESPALDO
      setRechazo({
        mensaje,
        bloqueos: error instanceof ErrorProfesor ? error.bloqueos : undefined,
      })
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialogo
      tituloId="titulo-estado-profesor"
      titulo={inactivar ? `Inactivar a ${nombre}` : `Reactivar a ${nombre}`}
      descripcion={
        inactivar
          ? 'La ficha quedará inactiva: no podrá recibir asignaciones nuevas ni quedar a cargo de grupos. Puede seguir iniciando sesión y consultando su ficha. No se puede inactivar mientras tenga materias o grupos activos a cargo.'
          : 'La ficha volverá a estar activa. Para reactivarla tiene que estar completa (legajo y especialidad) y la persona debe tener el rol DOCENTE.'
      }
      selectorFocoInicial="#estado-motivo"
      onCerrar={() => {
        if (!enviando) onCerrar()
      }}
    >
      <div className="space-y-4">
        {rechazo && (
          <div role="alert" className="bg-red-50 border border-red-200 rounded-xl p-3 space-y-2">
            <p className="text-sm text-red-800">{rechazo.mensaje}</p>
            {rechazo.bloqueos &&
              (rechazo.bloqueos.asignaciones.length > 0 || rechazo.bloqueos.grupos.length > 0) && (
                <ul className="list-disc pl-5 text-sm text-red-800 space-y-0.5" aria-label="Relaciones que impiden inactivar">
                  {rechazo.bloqueos.asignaciones.map((asignacion) => (
                    <li key={`materia-${asignacion.materia}-${asignacion.curso}`}>
                      Materia {asignacion.materia} en {asignacion.curso}
                    </li>
                  ))}
                  {rechazo.bloqueos.grupos.map((grupo) => (
                    <li key={`grupo-${grupo.deporte}-${grupo.grupo}`}>
                      Grupo {grupo.grupo} de {grupo.deporte}
                    </li>
                  ))}
                </ul>
              )}
          </div>
        )}
        <div className="space-y-1">
          <Textarea
            label="Motivo (opcional)"
            id="estado-motivo"
            rows={3}
            value={motivo}
            onChange={(evento) => setMotivo(evento.target.value)}
            error={errorMotivo ?? undefined}
            aria-describedby="estado-motivo-contador"
          />
          <p
            id="estado-motivo-contador"
            className={largoMotivo > MOTIVO_MAXIMO ? 'text-xs text-red-600' : 'text-xs text-neutral-500'}
          >
            {largoMotivo} de {MOTIVO_MAXIMO} caracteres. Queda en el historial y no se puede editar.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button
            id="confirmar-estado-profesor"
            variant={inactivar ? 'danger' : 'primary'}
            loading={enviando}
            onClick={confirmar}
          >
            {inactivar ? 'Confirmar inactivación' : 'Confirmar reactivación'}
          </Button>
          <Button variant="ghost" onClick={onCerrar} disabled={enviando}>
            Cancelar
          </Button>
        </div>
      </div>
    </Dialogo>
  )
}
