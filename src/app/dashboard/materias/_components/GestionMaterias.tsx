'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import {
  ArrowCounterClockwise,
  BookOpen,
  CaretDown,
  CaretRight,
  Link as LinkIcon,
  PencilSimple,
  Plus,
  Prohibit,
  UserCircle,
  WarningCircle,
} from '@phosphor-icons/react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { crearMateriaSchema, type CrearMateriaData } from '@/lib/validations'
import {
  asignarMateriaCursoRemota,
  cambiarEstadoAsignacionRemota,
  cambiarEstadoMateriaRemota,
  cambiarProfesorAsignacionRemota,
  crearMateriaRemota,
  ErrorMateria,
  renombrarMateriaRemota,
} from '@/services/materias.client'
import type {
  AsignacionMateria,
  CursoAsignableMateria,
  Materia,
  ProfesorAsignable,
} from '@/services/materias.service'
import { Dialogo } from './Dialogo'

type MensajeInicial =
  | { tipo: 'error'; texto: string }
  | { tipo: 'exito'; texto: string }

interface GestionMateriasProps {
  materias: Materia[]
  asignaciones: AsignacionMateria[]
  cursos: CursoAsignableMateria[]
  profesores: ProfesorAsignable[]
  mensajeInicial?: MensajeInicial
}

type Filtro = 'TODAS' | 'ACTIVAS' | 'INACTIVAS'

const FILTROS: { valor: Filtro; etiqueta: string }[] = [
  { valor: 'TODAS', etiqueta: 'Todas' },
  { valor: 'ACTIVAS', etiqueta: 'Activas' },
  { valor: 'INACTIVAS', etiqueta: 'Inactivas' },
]

const SIN_PROFESOR = 'Sin profesor responsable'

function nombreDeCurso(asignacion: AsignacionMateria) {
  return `${asignacion.curso_denominacion} ${asignacion.curso_division}`
}

function nombreDeProfesor(asignacion: AsignacionMateria) {
  if (!asignacion.profesor_id) return SIN_PROFESOR
  return `${asignacion.profesor_nombre ?? ''} ${asignacion.profesor_apellido ?? ''}`.trim()
}

/** Catálogo de materias y sus relaciones con cursos, siempre mediado por la API. */
export function GestionMaterias({
  materias,
  asignaciones,
  cursos,
  profesores,
  mensajeInicial,
}: GestionMateriasProps) {
  const router = useRouter()
  const [refrescando, iniciarRefresco] = useTransition()
  const [filtro, setFiltro] = useState<Filtro>('TODAS')
  const [formularioAbierto, setFormularioAbierto] = useState(false)
  const [materiaEnEdicion, setMateriaEnEdicion] = useState<Materia | null>(null)
  const [materiaEnEstado, setMateriaEnEstado] = useState<Materia | null>(null)
  const [materiaEnAsignacion, setMateriaEnAsignacion] = useState<Materia | null>(null)
  const [asignacionEnProfesor, setAsignacionEnProfesor] =
    useState<AsignacionMateria | null>(null)
  const [asignacionEnEstado, setAsignacionEnEstado] =
    useState<AsignacionMateria | null>(null)
  const [expandidas, setExpandidas] = useState<number[]>([])
  const [enviando, setEnviando] = useState(false)
  const [errorGeneral, setErrorGeneral] = useState<string | null>(
    mensajeInicial?.tipo === 'error' ? mensajeInicial.texto : null
  )
  const [mensajeExito, setMensajeExito] = useState<string | null>(
    mensajeInicial?.tipo === 'exito' ? mensajeInicial.texto : null
  )
  const nombreAltaRef = useRef<HTMLInputElement | null>(null)

  const formularioAlta = useForm<CrearMateriaData>({
    resolver: zodResolver(crearMateriaSchema),
    mode: 'onTouched',
    defaultValues: { nombre: '' },
  })
  const formularioEdicion = useForm<CrearMateriaData>({
    resolver: zodResolver(crearMateriaSchema),
    mode: 'onTouched',
    defaultValues: { nombre: '' },
  })
  const registroNombreAlta = formularioAlta.register('nombre')

  useEffect(() => {
    if (formularioAbierto) nombreAltaRef.current?.focus()
  }, [formularioAbierto])

  const asignacionesPorMateria = useMemo(() => {
    const mapa = new Map<number, AsignacionMateria[]>()
    for (const asignacion of asignaciones) {
      const actuales = mapa.get(asignacion.materia_id) ?? []
      actuales.push(asignacion)
      mapa.set(asignacion.materia_id, actuales)
    }
    return mapa
  }, [asignaciones])

  const materiasVisibles = useMemo(
    () =>
      materias.filter((materia) =>
        filtro === 'TODAS' ? true : filtro === 'ACTIVAS' ? materia.activo : !materia.activo
      ),
    [materias, filtro]
  )

  function limpiarMensajes() {
    setErrorGeneral(null)
    setMensajeExito(null)
  }

  function reconciliar() {
    iniciarRefresco(() => router.refresh())
  }

  function informarExito(texto: string) {
    setMensajeExito(texto)
    setErrorGeneral(null)
    toast.success(texto)
    reconciliar()
  }

  function informarError(
    error: unknown,
    respaldo: string,
    formulario?: typeof formularioAlta
  ) {
    const mensaje = error instanceof Error ? error.message : respaldo
    if (formulario && error instanceof ErrorMateria && error.campo === 'nombre') {
      formulario.setError('nombre', { type: 'server', message: mensaje })
    }
    setErrorGeneral(mensaje)
    setMensajeExito(null)
    toast.error(mensaje)
  }

  function alternarDetalle(materiaId: number) {
    setExpandidas((actuales) =>
      actuales.includes(materiaId)
        ? actuales.filter((id) => id !== materiaId)
        : [...actuales, materiaId]
    )
  }

  async function crear(datos: CrearMateriaData) {
    limpiarMensajes()
    try {
      await crearMateriaRemota(datos.nombre)
      formularioAlta.reset({ nombre: '' })
      setFormularioAbierto(false)
      informarExito(`Materia ${datos.nombre} creada correctamente.`)
    } catch (error) {
      informarError(error, 'No pudimos crear la materia.', formularioAlta)
    }
  }

  async function renombrar(datos: CrearMateriaData) {
    if (!materiaEnEdicion) return
    limpiarMensajes()
    try {
      await renombrarMateriaRemota(materiaEnEdicion.id, datos.nombre)
      setMateriaEnEdicion(null)
      informarExito(`Materia renombrada como ${datos.nombre}.`)
    } catch (error) {
      informarError(error, 'No pudimos renombrar la materia.', formularioEdicion)
    }
  }

  async function confirmarEstadoMateria() {
    if (!materiaEnEstado) return
    limpiarMensajes()
    setEnviando(true)
    try {
      await cambiarEstadoMateriaRemota(materiaEnEstado.id, !materiaEnEstado.activo)
      const accion = materiaEnEstado.activo ? 'inactivada' : 'reactivada'
      setMateriaEnEstado(null)
      informarExito(`Materia ${materiaEnEstado.nombre} ${accion}.`)
    } catch (error) {
      informarError(error, 'No pudimos cambiar el estado de la materia.')
    } finally {
      setEnviando(false)
    }
  }

  async function confirmarEstadoAsignacion() {
    if (!asignacionEnEstado) return
    limpiarMensajes()
    setEnviando(true)
    try {
      await cambiarEstadoAsignacionRemota(asignacionEnEstado.id, !asignacionEnEstado.activo)
      const accion = asignacionEnEstado.activo ? 'inactivada' : 'reactivada'
      const curso = nombreDeCurso(asignacionEnEstado)
      setAsignacionEnEstado(null)
      informarExito(`Asignación de ${asignacionEnEstado.materia_nombre} en ${curso} ${accion}.`)
    } catch (error) {
      informarError(error, 'No pudimos cambiar el estado de la asignación.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600 mb-2">
            Configuración académica
          </p>
          <h1 className="text-2xl font-extrabold text-neutral-900 tracking-tight">
            Materias
          </h1>
          <p className="text-neutral-500 text-sm mt-1 max-w-[64ch]">
            Cada materia se identifica por su nombre. Las materias inactivas conservan
            los cursos y los profesores que ya tenían asignados.
          </p>
        </div>
        <Button
          onClick={() => {
            limpiarMensajes()
            setFormularioAbierto((abierto) => !abierto)
          }}
          aria-expanded={formularioAbierto}
          aria-controls="formulario-nueva-materia"
        >
          <Plus size={18} weight="bold" />
          {formularioAbierto ? 'Cerrar formulario' : 'Nueva materia'}
        </Button>
      </div>

      <div
        aria-live="polite"
        aria-label="Estado de la administración de materias"
        className="space-y-3"
      >
        {errorGeneral && (
          <div
            role="alert"
            className="bg-red-50 border border-red-200 rounded-2xl p-4 flex gap-3 items-start"
          >
            <WarningCircle size={20} weight="fill" className="text-red-500 shrink-0 mt-0.5" />
            <p className="text-sm text-red-800">{errorGeneral}</p>
          </div>
        )}
        {mensajeExito && (
          <div
            role="status"
            className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-sm text-emerald-800"
          >
            {mensajeExito}
          </div>
        )}
      </div>

      {formularioAbierto && (
        <form
          id="formulario-nueva-materia"
          onSubmit={formularioAlta.handleSubmit(crear)}
          noValidate
          className="bg-white rounded-2xl border border-neutral-200 p-5 space-y-4"
        >
          <div>
            <h2 className="font-bold text-neutral-900">Nueva materia</h2>
            <p className="text-sm text-neutral-500 mt-1">
              El nombre debe ser único: no puede repetir el de otra materia, aunque
              cambien las mayúsculas o los espacios.
            </p>
          </div>
          <div className="max-w-xl">
            <Input
              label="Nombre de la materia"
              id="nueva-materia-nombre"
              placeholder="Ej.: Matemática"
              maxLength={100}
              required
              autoComplete="off"
              error={formularioAlta.formState.errors.nombre?.message}
              {...registroNombreAlta}
              ref={(elemento) => {
                registroNombreAlta.ref(elemento)
                nombreAltaRef.current = elemento
              }}
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" loading={formularioAlta.formState.isSubmitting}>
              Crear materia
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setFormularioAbierto(false)}
              disabled={formularioAlta.formState.isSubmitting}
            >
              Cancelar
            </Button>
          </div>
        </form>
      )}

      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label="Filtrar materias por estado"
      >
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

      {materias.length === 0 ? (
        <EstadoVacio
          titulo="No hay materias registradas"
          detalle="Usá “Nueva materia” para registrar la primera."
        />
      ) : materiasVisibles.length === 0 ? (
        <EstadoVacio
          titulo="No hay materias con ese estado"
          detalle="Cambiá el filtro para ver el resto del catálogo."
        />
      ) : (
        <ul className="space-y-3" aria-busy={refrescando} aria-label="Catálogo de materias">
          {materiasVisibles.map((materia) => {
            const relacionadas = asignacionesPorMateria.get(materia.id) ?? []
            const activas = relacionadas.filter((asignacion) => asignacion.activo).length
            const expandida = expandidas.includes(materia.id)

            return (
              <li
                key={materia.id}
                className="bg-white rounded-2xl border border-neutral-200 p-4 sm:p-5 space-y-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-neutral-900 break-words">
                      {materia.nombre}
                    </p>
                    <p className="text-xs text-neutral-500 mt-1">
                      {relacionadas.length === 0
                        ? 'Sin cursos relacionados'
                        : `${relacionadas.length} curso(s) relacionado(s) · ${activas} vigente(s)`}
                    </p>
                  </div>
                  <Badge variant={materia.activo ? 'success' : 'default'} dot>
                    {materia.activo ? 'Activa' : 'Inactiva'}
                  </Badge>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      limpiarMensajes()
                      setMateriaEnEdicion(materia)
                      formularioEdicion.reset({ nombre: materia.nombre })
                    }}
                    aria-label={`Renombrar la materia ${materia.nombre}`}
                  >
                    <PencilSimple size={15} />
                    Renombrar
                  </Button>
                  <Button
                    size="sm"
                    variant={materia.activo ? 'outline' : 'secondary'}
                    onClick={() => {
                      limpiarMensajes()
                      setMateriaEnEstado(materia)
                    }}
                    aria-label={
                      materia.activo
                        ? `Inactivar la materia ${materia.nombre}`
                        : `Reactivar la materia ${materia.nombre}`
                    }
                  >
                    {materia.activo ? (
                      <Prohibit size={15} />
                    ) : (
                      <ArrowCounterClockwise size={15} />
                    )}
                    {materia.activo ? 'Inactivar' : 'Reactivar'}
                  </Button>
                  {materia.activo && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        limpiarMensajes()
                        setMateriaEnAsignacion(materia)
                      }}
                      aria-label={`Asignar la materia ${materia.nombre} a un curso`}
                    >
                      <LinkIcon size={15} />
                      Asignar a un curso
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => alternarDetalle(materia.id)}
                    aria-expanded={expandida}
                    aria-controls={`cursos-materia-${materia.id}`}
                    aria-label={`Ver los cursos de la materia ${materia.nombre}`}
                  >
                    {expandida ? <CaretDown size={15} /> : <CaretRight size={15} />}
                    Ver cursos
                  </Button>
                </div>

                {expandida && (
                  <div
                    id={`cursos-materia-${materia.id}`}
                    className="border-t border-neutral-100 pt-4"
                  >
                    {relacionadas.length === 0 ? (
                      <p className="text-sm text-neutral-500">
                        Esta materia todavía no está relacionada con ningún curso.
                      </p>
                    ) : (
                      <ul
                        className="space-y-3"
                        aria-label={`Cursos de la materia ${materia.nombre}`}
                      >
                        {relacionadas.map((asignacion) => (
                          <li
                            key={asignacion.id}
                            className="rounded-xl border border-neutral-200 p-3 space-y-3"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-neutral-900 break-words">
                                  {nombreDeCurso(asignacion)}
                                </p>
                                <p className="text-xs text-neutral-500 mt-0.5">
                                  Nivel {asignacion.nivel_nombre}
                                  {asignacion.curso_activo ? '' : ' · Curso inactivo'}
                                </p>
                                <p className="text-xs text-neutral-600 mt-1 flex items-center gap-1.5">
                                  <UserCircle size={14} aria-hidden="true" />
                                  {nombreDeProfesor(asignacion)}
                                </p>
                              </div>
                              <Badge variant={asignacion.activo ? 'success' : 'default'} dot>
                                {asignacion.activo ? 'Vigente' : 'Histórica'}
                              </Badge>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => {
                                  limpiarMensajes()
                                  setAsignacionEnProfesor(asignacion)
                                }}
                                aria-label={`Cambiar el profesor responsable de ${materia.nombre} en ${nombreDeCurso(asignacion)}`}
                              >
                                <UserCircle size={15} />
                                Profesor responsable
                              </Button>
                              <Button
                                size="sm"
                                variant={asignacion.activo ? 'outline' : 'secondary'}
                                onClick={() => {
                                  limpiarMensajes()
                                  setAsignacionEnEstado(asignacion)
                                }}
                                aria-label={
                                  asignacion.activo
                                    ? `Inactivar la asignación de ${materia.nombre} en ${nombreDeCurso(asignacion)}`
                                    : `Reactivar la asignación de ${materia.nombre} en ${nombreDeCurso(asignacion)}`
                                }
                              >
                                {asignacion.activo ? (
                                  <Prohibit size={15} />
                                ) : (
                                  <ArrowCounterClockwise size={15} />
                                )}
                                {asignacion.activo ? 'Inactivar' : 'Reactivar'}
                              </Button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {materiaEnEdicion && (
        <Dialogo
          tituloId="titulo-renombrar-materia"
          titulo={`Renombrar ${materiaEnEdicion.nombre}`}
          selectorFocoInicial="#renombrar-materia-nombre"
          onCerrar={() => setMateriaEnEdicion(null)}
        >
          <form
            onSubmit={formularioEdicion.handleSubmit(renombrar)}
            noValidate
            className="space-y-4"
          >
            <Input
              label="Nombre de la materia"
              id="renombrar-materia-nombre"
              maxLength={100}
              required
              autoComplete="off"
              error={formularioEdicion.formState.errors.nombre?.message}
              {...formularioEdicion.register('nombre')}
            />
            <div className="flex flex-wrap gap-3 pt-2">
              <Button type="submit" loading={formularioEdicion.formState.isSubmitting}>
                Guardar nombre
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setMateriaEnEdicion(null)}
                disabled={formularioEdicion.formState.isSubmitting}
              >
                Cancelar
              </Button>
            </div>
          </form>
        </Dialogo>
      )}

      {materiaEnEstado && (
        <Dialogo
          tituloId="titulo-estado-materia"
          titulo={
            materiaEnEstado.activo
              ? `Inactivar ${materiaEnEstado.nombre}`
              : `Reactivar ${materiaEnEstado.nombre}`
          }
          descripcion={
            materiaEnEstado.activo
              ? 'La materia dejará de ofrecerse en nuevas asignaciones. Los cursos y los profesores que ya tiene se conservan como historial.'
              : 'La materia volverá a estar disponible para nuevas asignaciones a cursos activos.'
          }
          selectorFocoInicial="#confirmar-estado-materia"
          onCerrar={() => {
            if (!enviando) setMateriaEnEstado(null)
          }}
        >
          <div className="flex flex-wrap gap-3">
            <Button
              id="confirmar-estado-materia"
              variant={materiaEnEstado.activo ? 'danger' : 'primary'}
              loading={enviando}
              onClick={confirmarEstadoMateria}
            >
              {materiaEnEstado.activo ? 'Confirmar inactivación' : 'Confirmar reactivación'}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setMateriaEnEstado(null)}
              disabled={enviando}
            >
              Cancelar
            </Button>
          </div>
        </Dialogo>
      )}

      {materiaEnAsignacion && (
        <DialogoAsignacion
          materia={materiaEnAsignacion}
          cursos={cursos}
          profesores={profesores}
          onCerrar={() => setMateriaEnAsignacion(null)}
          onAsignada={(curso) => {
            setMateriaEnAsignacion(null)
            setExpandidas((actuales) =>
              actuales.includes(materiaEnAsignacion.id)
                ? actuales
                : [...actuales, materiaEnAsignacion.id]
            )
            informarExito(`Materia ${materiaEnAsignacion.nombre} asignada a ${curso}.`)
          }}
          onError={(error) =>
            informarError(error, 'No pudimos asignar la materia al curso.')
          }
        />
      )}

      {asignacionEnProfesor && (
        <DialogoProfesor
          asignacion={asignacionEnProfesor}
          profesores={profesores}
          onCerrar={() => setAsignacionEnProfesor(null)}
          onGuardado={(descripcion) => {
            const asignacion = asignacionEnProfesor
            setAsignacionEnProfesor(null)
            informarExito(
              `Profesor responsable de ${asignacion.materia_nombre} en ${nombreDeCurso(asignacion)}: ${descripcion}.`
            )
          }}
          onError={(error) =>
            informarError(error, 'No pudimos cambiar el profesor responsable.')
          }
        />
      )}

      {asignacionEnEstado && (
        <Dialogo
          tituloId="titulo-estado-asignacion"
          titulo={
            asignacionEnEstado.activo
              ? `Inactivar ${asignacionEnEstado.materia_nombre} en ${nombreDeCurso(asignacionEnEstado)}`
              : `Reactivar ${asignacionEnEstado.materia_nombre} en ${nombreDeCurso(asignacionEnEstado)}`
          }
          descripcion={
            asignacionEnEstado.activo
              ? 'La relación deja de estar vigente y queda como historial. No se elimina ningún dato.'
              : 'La relación vuelve a estar vigente. Para reactivarla, la materia y el curso deben estar activos.'
          }
          selectorFocoInicial="#confirmar-estado-asignacion"
          onCerrar={() => {
            if (!enviando) setAsignacionEnEstado(null)
          }}
        >
          <div className="flex flex-wrap gap-3">
            <Button
              id="confirmar-estado-asignacion"
              variant={asignacionEnEstado.activo ? 'danger' : 'primary'}
              loading={enviando}
              onClick={confirmarEstadoAsignacion}
            >
              {asignacionEnEstado.activo
                ? 'Confirmar inactivación'
                : 'Confirmar reactivación'}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setAsignacionEnEstado(null)}
              disabled={enviando}
            >
              Cancelar
            </Button>
          </div>
        </Dialogo>
      )}
    </div>
  )
}

function EstadoVacio({ titulo, detalle }: { titulo: string; detalle: string }) {
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 py-16 px-5 text-center">
      <BookOpen size={40} className="text-neutral-300 mx-auto mb-3" aria-hidden="true" />
      <p className="font-semibold text-neutral-700">{titulo}</p>
      <p className="text-neutral-400 text-sm mt-1">{detalle}</p>
    </div>
  )
}

function DialogoAsignacion({
  materia,
  cursos,
  profesores,
  onCerrar,
  onAsignada,
  onError,
}: {
  materia: Materia
  cursos: CursoAsignableMateria[]
  profesores: ProfesorAsignable[]
  onCerrar: () => void
  onAsignada: (curso: string) => void
  onError: (error: unknown) => void
}) {
  const [cursoId, setCursoId] = useState('')
  const [profesorId, setProfesorId] = useState('')
  const [errorCurso, setErrorCurso] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function guardar() {
    if (!cursoId) {
      setErrorCurso('Seleccioná un curso activo')
      return
    }
    setErrorCurso(null)
    setEnviando(true)
    try {
      await asignarMateriaCursoRemota(materia.id, cursoId, profesorId || null)
      const curso = cursos.find((opcion) => opcion.id === cursoId)
      onAsignada(curso ? `${curso.denominacion} ${curso.division}` : 'el curso elegido')
    } catch (error) {
      onError(error)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialogo
      tituloId="titulo-asignar-materia"
      titulo={`Asignar ${materia.nombre} a un curso`}
      descripcion="Solo se listan los cursos activos. El profesor responsable es opcional y se puede cambiar después."
      selectorFocoInicial="#asignar-curso"
      onCerrar={() => {
        if (!enviando) onCerrar()
      }}
    >
      {cursos.length === 0 ? (
        <div className="space-y-4">
          <p className="text-sm text-neutral-600" role="status">
            No hay cursos activos disponibles para asignar.
          </p>
          <Button variant="ghost" onClick={onCerrar}>
            Cerrar
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <Select
            id="asignar-curso"
            label="Curso"
            required
            placeholder="Elegí un curso activo"
            error={errorCurso ?? undefined}
            value={cursoId}
            onChange={(evento) => setCursoId(evento.target.value)}
            options={cursos.map((curso) => ({
              value: curso.id,
              label: `${curso.denominacion} ${curso.division} · ${curso.nivel_nombre}`,
            }))}
          />
          <Select
            id="asignar-profesor"
            label="Profesor responsable (opcional)"
            placeholder={SIN_PROFESOR}
            helperText={
              profesores.length === 0
                ? 'Todavía no hay perfiles con rol DOCENTE para asignar.'
                : undefined
            }
            value={profesorId}
            onChange={(evento) => setProfesorId(evento.target.value)}
            options={profesores.map((profesor) => ({
              value: profesor.id,
              label: `${profesor.apellido}, ${profesor.nombre}`,
            }))}
          />
          <div className="flex flex-wrap gap-3 pt-2">
            <Button loading={enviando} onClick={guardar}>
              Asignar materia
            </Button>
            <Button variant="ghost" onClick={onCerrar} disabled={enviando}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </Dialogo>
  )
}

function DialogoProfesor({
  asignacion,
  profesores,
  onCerrar,
  onGuardado,
  onError,
}: {
  asignacion: AsignacionMateria
  profesores: ProfesorAsignable[]
  onCerrar: () => void
  onGuardado: (descripcion: string) => void
  onError: (error: unknown) => void
}) {
  const [profesorId, setProfesorId] = useState(asignacion.profesor_id ?? '')
  const [enviando, setEnviando] = useState(false)

  // Un profesor histórico puede haber dejado de tener el rol DOCENTE. Se muestra
  // para no ocultar quién es el responsable actual, pero no se puede volver a
  // elegir: la base solo acepta perfiles con rol DOCENTE.
  const responsableFueraDeLista =
    asignacion.profesor_id &&
    !profesores.some((profesor) => profesor.id === asignacion.profesor_id)

  async function guardar() {
    setEnviando(true)
    try {
      await cambiarProfesorAsignacionRemota(asignacion.id, profesorId || null)
      const elegido = profesores.find((profesor) => profesor.id === profesorId)
      onGuardado(elegido ? `${elegido.nombre} ${elegido.apellido}` : SIN_PROFESOR)
    } catch (error) {
      onError(error)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialogo
      tituloId="titulo-profesor-asignacion"
      titulo={`Profesor responsable de ${asignacion.materia_nombre} en ${asignacion.curso_denominacion} ${asignacion.curso_division}`}
      descripcion="Solo pueden elegirse perfiles con rol DOCENTE. Dejalo sin asignar si todavía no está definido."
      selectorFocoInicial="#profesor-responsable"
      onCerrar={() => {
        if (!enviando) onCerrar()
      }}
    >
      <div className="space-y-4">
        {responsableFueraDeLista && (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3">
            El responsable actual ya no figura entre los perfiles con rol DOCENTE. Se
            conserva en el historial y podés reemplazarlo o dejar la asignación sin
            profesor.
          </p>
        )}
        <Select
          id="profesor-responsable"
          label="Profesor responsable"
          placeholder={SIN_PROFESOR}
          helperText={
            profesores.length === 0
              ? 'Todavía no hay perfiles con rol DOCENTE para asignar.'
              : undefined
          }
          value={profesores.some((profesor) => profesor.id === profesorId) ? profesorId : ''}
          onChange={(evento) => setProfesorId(evento.target.value)}
          options={profesores.map((profesor) => ({
            value: profesor.id,
            label: `${profesor.apellido}, ${profesor.nombre}`,
          }))}
        />
        <div className="flex flex-wrap gap-3 pt-2">
          <Button loading={enviando} onClick={guardar}>
            Guardar profesor
          </Button>
          <Button variant="ghost" onClick={onCerrar} disabled={enviando}>
            Cancelar
          </Button>
        </div>
      </div>
    </Dialogo>
  )
}
