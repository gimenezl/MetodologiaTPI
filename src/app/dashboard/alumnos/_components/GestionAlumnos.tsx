'use client'

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import {
  ArrowCounterClockwise,
  ArrowsLeftRight,
  IdentificationCard,
  Plus,
  Prohibit,
  ShieldCheck,
  Student,
  WarningCircle,
  X,
} from '@phosphor-icons/react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { cn } from '@/lib/utils'
import { crearAlumnoSchema, type CrearAlumnoData } from '@/lib/validations'
import {
  cambiarCursoRemoto,
  corregirIdentidadRemoto,
  crearAlumnoRemoto,
  ErrorAlumno,
  inactivarAlumnoRemoto,
  reactivarAlumnoRemoto,
} from '@/services/alumnos.client'
import type { AlumnoAcademico, CursoAsignable } from '@/services/alumnos.service'

type MensajeInicial =
  | { tipo: 'error'; texto: string }
  | { tipo: 'exito'; texto: string }

interface GestionAlumnosProps {
  alumnos: AlumnoAcademico[]
  cursos: CursoAsignable[]
  mensajeInicial?: MensajeInicial
}

type IdentidadFormData = { dni: string; legajo_nro?: string }

type CambioDeCurso = { alumno: AlumnoAcademico; destino: string }
type CambioDeEstado = { alumno: AlumnoAcademico; activar: boolean; destino: string }

function nombreCompleto(alumno: AlumnoAcademico) {
  return `${alumno.apellido}, ${alumno.nombre}`
}

function describirCurso(alumno: AlumnoAcademico) {
  if (!alumno.curso_denominacion) return 'Sin curso asignado'
  return `${alumno.curso_denominacion} ${alumno.curso_division}`
}

/**
 * Administración del legajo académico (EPT-22).
 *
 * Toda escritura pasa por la API, que vuelve a autorizar en el servidor y
 * delega en operaciones atómicas de PostgreSQL. Este componente no decide
 * permisos: ocultar un control no es autorizar.
 *
 * El selector de curso solo ofrece cursos activos. Los cursos históricos que hoy
 * están inactivos se siguen mostrando en la situación vigente y en el historial,
 * pero no vuelven a ser elegibles.
 */
export function GestionAlumnos({
  alumnos,
  cursos,
  mensajeInicial,
}: GestionAlumnosProps) {
  const router = useRouter()
  const [refrescando, iniciarRefresco] = useTransition()
  const [formularioAbierto, setFormularioAbierto] = useState(false)
  const [alumnoEnEdicion, setAlumnoEnEdicion] = useState<AlumnoAcademico | null>(null)
  const [cambioDeCurso, setCambioDeCurso] = useState<CambioDeCurso | null>(null)
  const [cambioDeEstado, setCambioDeEstado] = useState<CambioDeEstado | null>(null)
  const [operando, setOperando] = useState(false)
  const [errorGeneral, setErrorGeneral] = useState<string | null>(
    mensajeInicial?.tipo === 'error' ? mensajeInicial.texto : null
  )
  const [mensajeExito, setMensajeExito] = useState<string | null>(
    mensajeInicial?.tipo === 'exito' ? mensajeInicial.texto : null
  )
  const nombreAltaRef = useRef<HTMLInputElement | null>(null)

  const formularioAlta = useForm<CrearAlumnoData>({
    resolver: zodResolver(crearAlumnoSchema),
    mode: 'onTouched',
  })
  const formularioIdentidad = useForm<IdentidadFormData>({ mode: 'onTouched' })
  const registroNombreAlta = formularioAlta.register('nombre')
  // `useWatch` en lugar de `watch()`: se suscribe a un solo campo y no devuelve
  // una función, así que el compilador de React puede memoizar el componente.
  const estadoElegido = useWatch({
    control: formularioAlta.control,
    name: 'estado',
  })

  const opcionesCurso = cursos.map((curso) => ({
    value: curso.id,
    label: `${curso.denominacion} ${curso.division} — ${curso.nivel_nombre}`,
  }))

  /**
   * Opciones para un cambio de curso: nunca incluyen el curso vigente.
   *
   * La base rechaza ese cambio con un error de dominio, porque aceptarlo
   * abriría y cerraría un tramo de historial sin que nada haya cambiado.
   * Ofrecerlo en el selector sería ofrecer una operación que no existe.
   */
  function opcionesDeCambio(alumno: AlumnoAcademico) {
    return opcionesCurso.filter((opcion) => opcion.value !== alumno.curso_id)
  }

  useEffect(() => {
    if (formularioAbierto) nombreAltaRef.current?.focus()
  }, [formularioAbierto])

  // Elegir INACTIVO deshabilita el selector de curso. Si además conservara el
  // valor elegido antes, el formulario quedaría bloqueado por un error sobre un
  // control que ya no se puede tocar. Se limpia el valor y el error juntos.
  useEffect(() => {
    if (estadoElegido !== 'INACTIVO') return
    if (formularioAlta.getValues('curso_id')) {
      formularioAlta.setValue('curso_id', undefined, { shouldValidate: false })
    }
    formularioAlta.clearErrors('curso_id')
  }, [estadoElegido, formularioAlta])

  function limpiarMensajes() {
    setErrorGeneral(null)
    setMensajeExito(null)
  }

  function reconciliar() {
    iniciarRefresco(() => router.refresh())
  }

  function mostrarError(
    error: unknown,
    respaldo: string,
    formulario?: { setError: (campo: never, opciones: { type: string; message: string }) => void },
    camposValidos?: string[]
  ) {
    const mensaje = error instanceof Error ? error.message : respaldo
    if (
      error instanceof ErrorAlumno &&
      error.campo &&
      formulario &&
      camposValidos?.includes(error.campo)
    ) {
      formulario.setError(error.campo as never, { type: 'server', message: mensaje })
    }
    setErrorGeneral(mensaje)
    setMensajeExito(null)
    toast.error(mensaje)
  }

  async function crear(datos: CrearAlumnoData) {
    limpiarMensajes()
    try {
      await crearAlumnoRemoto(datos)
      formularioAlta.reset({
        nombre: '',
        apellido: '',
        dni: '',
        estado: undefined,
        legajo_nro: '',
        curso_id: '',
      })
      setFormularioAbierto(false)
      setMensajeExito(
        `Legajo de ${datos.apellido}, ${datos.nombre} creado como ${datos.estado.toLowerCase()}.`
      )
      toast.success('Legajo creado')
      reconciliar()
    } catch (error) {
      mostrarError(error, 'No pudimos crear el legajo académico.', formularioAlta, [
        'nombre',
        'apellido',
        'dni',
        'legajo_nro',
        'curso_id',
        'estado',
      ])
    }
  }

  function abrirCorreccion(alumno: AlumnoAcademico) {
    limpiarMensajes()
    setAlumnoEnEdicion(alumno)
    formularioIdentidad.reset({
      dni: alumno.dni,
      legajo_nro: alumno.legajo_nro ?? '',
    })
  }

  async function corregirIdentidad(datos: IdentidadFormData) {
    if (!alumnoEnEdicion) return
    limpiarMensajes()
    try {
      await corregirIdentidadRemoto(
        alumnoEnEdicion.id,
        datos.dni,
        datos.legajo_nro?.trim() ? datos.legajo_nro : undefined
      )
      setMensajeExito(
        `Identidad de ${nombreCompleto(alumnoEnEdicion)} actualizada correctamente.`
      )
      toast.success('Identidad actualizada')
      setAlumnoEnEdicion(null)
      reconciliar()
    } catch (error) {
      mostrarError(error, 'No pudimos actualizar la identidad.', formularioIdentidad, [
        'dni',
        'legajo_nro',
      ])
    }
  }

  async function confirmarCambioDeCurso() {
    if (!cambioDeCurso || !cambioDeCurso.destino) return
    limpiarMensajes()
    setOperando(true)
    try {
      await cambiarCursoRemoto(cambioDeCurso.alumno.id, cambioDeCurso.destino)
      setMensajeExito(
        `${nombreCompleto(cambioDeCurso.alumno)} cambió de curso. La matrícula anterior queda en el historial.`
      )
      toast.success('Curso actualizado')
      setCambioDeCurso(null)
      reconciliar()
    } catch (error) {
      mostrarError(error, 'No pudimos cambiar el curso del estudiante.')
    } finally {
      setOperando(false)
    }
  }

  async function confirmarCambioDeEstado() {
    if (!cambioDeEstado) return
    limpiarMensajes()
    setOperando(true)
    try {
      if (cambioDeEstado.activar) {
        if (!cambioDeEstado.destino) {
          setOperando(false)
          setErrorGeneral('Para reactivar al estudiante hay que elegir un curso activo.')
          return
        }
        await reactivarAlumnoRemoto(cambioDeEstado.alumno.id, cambioDeEstado.destino)
      } else {
        await inactivarAlumnoRemoto(cambioDeEstado.alumno.id)
      }
      setMensajeExito(
        cambioDeEstado.activar
          ? `${nombreCompleto(cambioDeEstado.alumno)} volvió a estar activo con una matrícula nueva.`
          : `${nombreCompleto(cambioDeEstado.alumno)} quedó inactivo. Se conservan legajo e historial.`
      )
      toast.success(cambioDeEstado.activar ? 'Estudiante reactivado' : 'Estudiante inactivado')
      setCambioDeEstado(null)
      reconciliar()
    } catch (error) {
      mostrarError(error, 'No pudimos cambiar el estado del estudiante.')
    } finally {
      setOperando(false)
    }
  }

  const sinCursosActivos = cursos.length === 0

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600 mb-2">
            Situación académica
          </p>
          <h1 className="text-2xl font-extrabold text-neutral-900 tracking-tight">
            Alumnos
          </h1>
          <p className="text-neutral-500 text-sm mt-1 max-w-[64ch]">
            Estado, curso vigente y nivel derivado de cada estudiante. El nivel siempre
            proviene del curso. Los estudiantes inactivos conservan su legajo y todo su
            historial.
          </p>
        </div>
        <Button
          onClick={() => {
            limpiarMensajes()
            setFormularioAbierto((abierto) => !abierto)
          }}
          aria-expanded={formularioAbierto}
          aria-controls="formulario-nuevo-alumno"
        >
          <Plus size={18} weight="bold" />
          {formularioAbierto ? 'Cerrar formulario' : 'Nuevo alumno'}
        </Button>
      </div>

      <div className="bg-brand-50 border border-brand-100 rounded-2xl p-4 flex gap-3 items-start">
        <ShieldCheck
          size={20}
          weight="fill"
          className="text-brand-600 shrink-0 mt-0.5"
        />
        <p className="text-sm text-brand-800 leading-relaxed">
          La baja de un estudiante es lógica: no se elimina ningún dato. Un estudiante
          activo tiene exactamente una matrícula vigente y un número de legajo; uno
          inactivo no tiene matrícula, pero conserva su trayectoria completa.
        </p>
      </div>

      <div
        aria-live="polite"
        aria-label="Estado de la administración de alumnos"
        className="space-y-3"
      >
        {errorGeneral && (
          <div
            role="alert"
            className="bg-red-50 border border-red-200 rounded-2xl p-4 flex gap-3 items-start"
          >
            <WarningCircle
              size={20}
              weight="fill"
              className="text-red-500 shrink-0 mt-0.5"
            />
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
          id="formulario-nuevo-alumno"
          onSubmit={formularioAlta.handleSubmit(crear)}
          noValidate
          className="bg-white rounded-2xl border border-neutral-200 p-5 space-y-4"
        >
          <div>
            <h2 className="font-bold text-neutral-900">Nuevo legajo académico</h2>
            <p className="text-sm text-neutral-500 mt-1">
              El estado es una elección explícita. Si el estudiante queda activo, el curso
              y el número de legajo son obligatorios. El legajo se carga a mano: no se
              genera automáticamente.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <Input
              label="Nombre"
              id="nuevo-alumno-nombre"
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
            <Input
              label="Apellido"
              id="nuevo-alumno-apellido"
              maxLength={100}
              required
              autoComplete="off"
              error={formularioAlta.formState.errors.apellido?.message}
              {...formularioAlta.register('apellido')}
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <Input
              label="DNI"
              id="nuevo-alumno-dni"
              inputMode="numeric"
              maxLength={8}
              required
              autoComplete="off"
              helperText="7 u 8 dígitos, sin puntos"
              error={formularioAlta.formState.errors.dni?.message}
              {...formularioAlta.register('dni')}
            />
            <Select
              label="Estado académico"
              id="nuevo-alumno-estado"
              required
              placeholder="Elegí el estado"
              options={[
                { value: 'ACTIVO', label: 'Activo' },
                { value: 'INACTIVO', label: 'Inactivo' },
              ]}
              error={formularioAlta.formState.errors.estado?.message}
              {...formularioAlta.register('estado')}
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <Input
              label="Número de legajo"
              id="nuevo-alumno-legajo"
              maxLength={50}
              required={estadoElegido === 'ACTIVO'}
              autoComplete="off"
              error={formularioAlta.formState.errors.legajo_nro?.message}
              {...formularioAlta.register('legajo_nro', { setValueAs: (valor) => (valor ? valor : undefined) })}
            />
            <Select
              label="Curso"
              id="nuevo-alumno-curso"
              required={estadoElegido === 'ACTIVO'}
              disabled={estadoElegido === 'INACTIVO' || sinCursosActivos}
              placeholder={
                sinCursosActivos ? 'No hay cursos activos disponibles' : 'Elegí un curso activo'
              }
              options={opcionesCurso}
              error={formularioAlta.formState.errors.curso_id?.message}
              {...formularioAlta.register('curso_id', { setValueAs: (valor) => (valor ? valor : undefined) })}
            />
          </div>

          {estadoElegido === 'INACTIVO' && (
            <p className="text-xs text-amber-700 -mt-2">
              Un estudiante inactivo se registra sin matrícula. Podés activarlo más adelante
              eligiendo un curso.
            </p>
          )}

          <div className="grid sm:grid-cols-2 gap-4">
            <Input
              label="Fecha de nacimiento"
              id="nuevo-alumno-nacimiento"
              type="date"
              error={formularioAlta.formState.errors.fecha_nacimiento?.message}
              {...formularioAlta.register('fecha_nacimiento', { setValueAs: (valor) => (valor ? valor : undefined) })}
            />
            <Input
              label="Teléfono"
              id="nuevo-alumno-telefono"
              maxLength={20}
              autoComplete="off"
              error={formularioAlta.formState.errors.telefono?.message}
              {...formularioAlta.register('telefono', { setValueAs: (valor) => (valor ? valor : undefined) })}
            />
          </div>

          <Input
            label="Dirección"
            id="nuevo-alumno-direccion"
            maxLength={255}
            autoComplete="off"
            error={formularioAlta.formState.errors.direccion?.message}
            {...formularioAlta.register('direccion', { setValueAs: (valor) => (valor ? valor : undefined) })}
          />

          <div className="flex flex-wrap gap-3">
            <Button type="submit" loading={formularioAlta.formState.isSubmitting}>
              Crear legajo
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

      {alumnos.length === 0 ? (
        <div className="bg-white rounded-2xl border border-neutral-200 py-16 px-5 text-center">
          <Student size={40} className="text-neutral-300 mx-auto mb-3" />
          <p className="font-semibold text-neutral-700">
            No hay alumnos registrados
          </p>
          <p className="text-neutral-400 text-sm mt-1">
            Usá “Nuevo alumno” para registrar el primer legajo académico.
          </p>
        </div>
      ) : (
        <ListadoAlumnos
          alumnos={alumnos}
          refrescando={refrescando}
          onCorregir={abrirCorreccion}
          onCambiarCurso={(alumno) => {
            limpiarMensajes()
            setCambioDeCurso({ alumno, destino: '' })
          }}
          onCambiarEstado={(alumno) => {
            limpiarMensajes()
            setCambioDeEstado({
              alumno,
              activar: alumno.estado === 'INACTIVO',
              destino: '',
            })
          }}
        />
      )}

      {alumnoEnEdicion && (
        <Dialogo
          tituloId="titulo-corregir-identidad"
          titulo={`Corregir identidad de ${nombreCompleto(alumnoEnEdicion)}`}
          selectorFocoInicial="#corregir-alumno-dni"
          ocupado={formularioIdentidad.formState.isSubmitting}
          onCerrar={() => setAlumnoEnEdicion(null)}
        >
          <form
            onSubmit={formularioIdentidad.handleSubmit(corregirIdentidad)}
            noValidate
            className="space-y-4"
          >
            <p className="text-sm text-neutral-600 leading-relaxed">
              El identificador interno del legajo y todas sus relaciones se conservan.
              Solo cambian el DNI y el número de legajo.
            </p>
            <Input
              label="DNI"
              id="corregir-alumno-dni"
              inputMode="numeric"
              maxLength={8}
              required
              autoComplete="off"
              helperText="7 u 8 dígitos, sin puntos"
              error={formularioIdentidad.formState.errors.dni?.message}
              {...formularioIdentidad.register('dni')}
            />
            <Input
              label="Número de legajo"
              id="corregir-alumno-legajo"
              maxLength={50}
              required={alumnoEnEdicion.estado === 'ACTIVO'}
              autoComplete="off"
              error={formularioIdentidad.formState.errors.legajo_nro?.message}
              {...formularioIdentidad.register('legajo_nro')}
            />
            <div className="flex flex-wrap gap-3 pt-2">
              <Button type="submit" loading={formularioIdentidad.formState.isSubmitting}>
                Guardar identidad
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setAlumnoEnEdicion(null)}
                disabled={formularioIdentidad.formState.isSubmitting}
              >
                Cancelar
              </Button>
            </div>
          </form>
        </Dialogo>
      )}

      {cambioDeCurso && (
        <Dialogo
          tituloId="titulo-cambiar-curso"
          titulo={`Cambiar el curso de ${nombreCompleto(cambioDeCurso.alumno)}`}
          selectorFocoInicial="#cambiar-curso-destino"
          ocupado={operando}
          onCerrar={() => setCambioDeCurso(null)}
        >
          <div className="space-y-5">
            <p className="text-sm text-neutral-600 leading-relaxed">
              Actualmente cursa {describirCurso(cambioDeCurso.alumno)}. Al confirmar se
              cierra esa matrícula y se abre una nueva; ambas quedan en el historial.
            </p>
            <Select
              label="Curso nuevo"
              id="cambiar-curso-destino"
              required
              placeholder={
                opcionesDeCambio(cambioDeCurso.alumno).length === 0
                  ? 'No hay otro curso activo disponible'
                  : 'Elegí un curso activo'
              }
              options={opcionesDeCambio(cambioDeCurso.alumno)}
              value={cambioDeCurso.destino}
              onChange={(evento) =>
                setCambioDeCurso({ ...cambioDeCurso, destino: evento.target.value })
              }
            />
            <div className="flex flex-wrap gap-3">
              <Button
                loading={operando}
                disabled={!cambioDeCurso.destino}
                onClick={confirmarCambioDeCurso}
              >
                Confirmar cambio de curso
              </Button>
              <Button
                variant="ghost"
                onClick={() => setCambioDeCurso(null)}
                disabled={operando}
              >
                Cancelar
              </Button>
            </div>
          </div>
        </Dialogo>
      )}

      {cambioDeEstado && (
        <Dialogo
          tituloId="titulo-cambiar-estado-alumno"
          titulo={
            cambioDeEstado.activar
              ? `Reactivar a ${nombreCompleto(cambioDeEstado.alumno)}`
              : `Inactivar a ${nombreCompleto(cambioDeEstado.alumno)}`
          }
          selectorFocoInicial={
            cambioDeEstado.activar ? '#reactivar-alumno-curso' : '#confirmar-estado-alumno'
          }
          ocupado={operando}
          onCerrar={() => setCambioDeEstado(null)}
        >
          <div className="space-y-5">
            <p className="text-sm text-neutral-600 leading-relaxed">
              {cambioDeEstado.activar
                ? 'Para volver a estar activo, el estudiante necesita una matrícula en un curso activo. Su legajo e historial se conservan tal como están.'
                : 'Se cierra la matrícula vigente y el estudiante deja de ocupar lugar en su curso. No se elimina ningún dato: identidad, legajo e historial se conservan.'}
            </p>
            {cambioDeEstado.activar && (
              <Select
                label="Curso para la reactivación"
                id="reactivar-alumno-curso"
                required
                placeholder={
                  sinCursosActivos
                    ? 'No hay cursos activos disponibles'
                    : 'Elegí un curso activo'
                }
                options={opcionesCurso}
                value={cambioDeEstado.destino}
                onChange={(evento) =>
                  setCambioDeEstado({ ...cambioDeEstado, destino: evento.target.value })
                }
              />
            )}
            <div className="flex flex-wrap gap-3">
              <Button
                id="confirmar-estado-alumno"
                variant={cambioDeEstado.activar ? 'primary' : 'danger'}
                loading={operando}
                disabled={cambioDeEstado.activar && !cambioDeEstado.destino}
                onClick={confirmarCambioDeEstado}
              >
                {cambioDeEstado.activar ? 'Confirmar reactivación' : 'Confirmar inactivación'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setCambioDeEstado(null)}
                disabled={operando}
              >
                Cancelar
              </Button>
            </div>
          </div>
        </Dialogo>
      )}
    </div>
  )
}

function ListadoAlumnos({
  alumnos,
  refrescando,
  onCorregir,
  onCambiarCurso,
  onCambiarEstado,
}: {
  alumnos: AlumnoAcademico[]
  refrescando: boolean
  onCorregir: (alumno: AlumnoAcademico) => void
  onCambiarCurso: (alumno: AlumnoAcademico) => void
  onCambiarEstado: (alumno: AlumnoAcademico) => void
}) {
  return (
    <>
      <div
        className="hidden sm:block bg-white rounded-2xl border border-neutral-200 overflow-hidden"
        aria-busy={refrescando}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="Tabla de alumnos">
            <caption className="sr-only">
              Alumnos con su DNI, legajo, estado académico, curso vigente, nivel derivado
              del curso y acciones disponibles.
            </caption>
            <thead>
              <tr className="bg-neutral-50 border-b border-neutral-100">
                {['Alumno', 'DNI', 'Legajo', 'Estado', 'Curso vigente', 'Nivel', 'Acciones'].map(
                  (columna) => (
                    <th
                      key={columna}
                      scope="col"
                      className="text-left px-5 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider"
                    >
                      {columna}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {alumnos.map((alumno) => (
                <tr key={alumno.id} className="hover:bg-neutral-50 transition-colors">
                  <td className="px-5 py-3 font-semibold text-neutral-900">
                    <Link
                      href={`/dashboard/alumnos/${alumno.id}`}
                      className="hover:text-brand-700 hover:underline"
                    >
                      {nombreCompleto(alumno)}
                    </Link>
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-neutral-500">
                    {alumno.dni}
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-neutral-500">
                    {alumno.legajo_nro ?? 'Sin legajo'}
                  </td>
                  <td className="px-5 py-3">
                    <Badge variant={alumno.estado === 'ACTIVO' ? 'success' : 'default'} dot>
                      {alumno.estado === 'ACTIVO' ? 'Activo' : 'Inactivo'}
                    </Badge>
                  </td>
                  <td className="px-5 py-3 text-neutral-700">{describirCurso(alumno)}</td>
                  <td className="px-5 py-3 text-neutral-700">
                    {alumno.nivel_nombre ?? '—'}
                  </td>
                  <td className="px-5 py-3">
                    <AccionesAlumno
                      alumno={alumno}
                      onCorregir={onCorregir}
                      onCambiarCurso={onCambiarCurso}
                      onCambiarEstado={onCambiarEstado}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ul
        className="sm:hidden space-y-3"
        aria-label="Alumnos por apellido"
        aria-busy={refrescando}
      >
        {alumnos.map((alumno) => (
          <li
            key={alumno.id}
            className="bg-white rounded-2xl border border-neutral-200 p-4 space-y-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link
                  href={`/dashboard/alumnos/${alumno.id}`}
                  className="font-semibold text-neutral-900 break-words hover:text-brand-700 hover:underline"
                >
                  {nombreCompleto(alumno)}
                </Link>
                <p className="text-xs font-mono text-neutral-400 mt-0.5">
                  DNI {alumno.dni} · Legajo {alumno.legajo_nro ?? 'sin asignar'}
                </p>
              </div>
              <Badge variant={alumno.estado === 'ACTIVO' ? 'success' : 'default'} dot>
                {alumno.estado === 'ACTIVO' ? 'Activo' : 'Inactivo'}
              </Badge>
            </div>
            <p className="text-sm text-neutral-700">
              {describirCurso(alumno)}
              {alumno.nivel_nombre ? ` · ${alumno.nivel_nombre}` : ''}
            </p>
            <AccionesAlumno
              alumno={alumno}
              onCorregir={onCorregir}
              onCambiarCurso={onCambiarCurso}
              onCambiarEstado={onCambiarEstado}
            />
          </li>
        ))}
      </ul>
    </>
  )
}

function AccionesAlumno({
  alumno,
  onCorregir,
  onCambiarCurso,
  onCambiarEstado,
}: {
  alumno: AlumnoAcademico
  onCorregir: (alumno: AlumnoAcademico) => void
  onCambiarCurso: (alumno: AlumnoAcademico) => void
  onCambiarEstado: (alumno: AlumnoAcademico) => void
}) {
  const nombre = nombreCompleto(alumno)

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size="sm"
        variant="secondary"
        onClick={() => onCorregir(alumno)}
        aria-label={`Corregir la identidad del alumno ${nombre}`}
      >
        <IdentificationCard size={15} />
        Identidad
      </Button>
      {alumno.estado === 'ACTIVO' && (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onCambiarCurso(alumno)}
          aria-label={`Cambiar el curso del alumno ${nombre}`}
        >
          <ArrowsLeftRight size={15} />
          Cambiar curso
        </Button>
      )}
      <Button
        size="sm"
        variant={alumno.estado === 'ACTIVO' ? 'outline' : 'secondary'}
        onClick={() => onCambiarEstado(alumno)}
        aria-label={
          alumno.estado === 'ACTIVO'
            ? `Inactivar al alumno ${nombre}`
            : `Reactivar al alumno ${nombre}`
        }
      >
        {alumno.estado === 'ACTIVO' ? (
          <Prohibit size={15} />
        ) : (
          <ArrowCounterClockwise size={15} />
        )}
        {alumno.estado === 'ACTIVO' ? 'Inactivar' : 'Reactivar'}
      </Button>
    </div>
  )
}

const SELECTOR_ENFOCABLES =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Diálogo accesible.
 *
 * `ocupado` describe una operación en vuelo: mientras dure, el diálogo no se
 * puede cerrar por ninguna vía. Antes el botón de cerrar y el fondo respondían
 * al clic pero la función descartaba la acción en silencio, de modo que el
 * control parecía disponible sin serlo. Ahora el estado es coherente entre el
 * botón, Escape, el fondo y `aria-busy`.
 */
function Dialogo({
  tituloId,
  titulo,
  selectorFocoInicial,
  ocupado = false,
  onCerrar,
  children,
}: {
  tituloId: string
  titulo: string
  selectorFocoInicial: string
  ocupado?: boolean
  onCerrar: () => void
  children: ReactNode
}) {
  const contenedor = useRef<HTMLDivElement>(null)
  const focoPrevio = useRef<HTMLElement | null>(null)
  const onCerrarRef = useRef(onCerrar)
  const ocupadoRef = useRef(ocupado)

  useEffect(() => {
    onCerrarRef.current = onCerrar
  }, [onCerrar])

  useEffect(() => {
    ocupadoRef.current = ocupado
  }, [ocupado])

  function intentarCerrar() {
    if (ocupadoRef.current) return
    onCerrarRef.current()
  }

  useEffect(() => {
    focoPrevio.current = document.activeElement as HTMLElement | null
    const cuadro = contenedor.current
    const focoInicial =
      cuadro?.querySelector<HTMLElement>(selectorFocoInicial) ??
      cuadro?.querySelector<HTMLElement>(SELECTOR_ENFOCABLES)
    focoInicial?.focus()

    function alPresionarTecla(evento: KeyboardEvent) {
      if (evento.key === 'Escape') {
        evento.preventDefault()
        if (ocupadoRef.current) return
        onCerrarRef.current()
        return
      }
      if (evento.key !== 'Tab') return

      const enfocables = Array.from(
        cuadro?.querySelectorAll<HTMLElement>(SELECTOR_ENFOCABLES) ?? []
      )
      if (enfocables.length === 0) return

      const primero = enfocables[0]
      const ultimo = enfocables[enfocables.length - 1]
      const activo = document.activeElement

      if (evento.shiftKey && (activo === primero || !cuadro?.contains(activo))) {
        evento.preventDefault()
        ultimo.focus()
      } else if (!evento.shiftKey && (activo === ultimo || !cuadro?.contains(activo))) {
        evento.preventDefault()
        primero.focus()
      }
    }

    document.addEventListener('keydown', alPresionarTecla)
    return () => {
      document.removeEventListener('keydown', alPresionarTecla)
      focoPrevio.current?.focus()
    }
  }, [selectorFocoInicial])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8 overflow-y-auto">
      <div
        className={cn(
          'absolute inset-0 bg-neutral-950/40 backdrop-blur-sm',
          ocupado && 'cursor-progress'
        )}
        onClick={intentarCerrar}
        aria-hidden="true"
      />
      <div
        ref={contenedor}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        aria-busy={ocupado || undefined}
        className="relative w-full max-w-lg bg-white rounded-2xl border border-neutral-200 shadow-xl my-auto"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-100">
          <h2 id={tituloId} className="font-bold text-neutral-900">
            {titulo}
          </h2>
          <button
            type="button"
            onClick={intentarCerrar}
            disabled={ocupado}
            aria-label="Cerrar diálogo"
            className="text-neutral-400 hover:text-neutral-600 p-1 rounded-lg hover:bg-neutral-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-6 py-5 max-h-[70vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}
