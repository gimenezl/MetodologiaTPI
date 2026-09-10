'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import {
  ArrowCounterClockwise,
  Chalkboard,
  PencilSimple,
  Plus,
  Prohibit,
  WarningCircle,
  X,
} from '@phosphor-icons/react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { crearCursoSchema, type CrearCursoData } from '@/lib/validations'
import { actualizarCursoRemoto, crearCursoRemoto, ErrorCurso } from '@/services/cursos.client'
import type { CursoConNivel } from '@/services/cursos.service'

type Nivel = { id: number; nombre: string }

interface GestionCursosProps {
  cursos: CursoConNivel[]
  niveles: Nivel[]
}

/** Los campos del formulario coinciden con los del esquema Zod de alta/edición. */
type CampoFormulario = keyof CrearCursoData

function esCampoFormulario(campo: string | undefined): campo is CampoFormulario {
  return campo === 'denominacion' || campo === 'division' || campo === 'nivel_id'
}

export function GestionCursos({ cursos, niveles }: GestionCursosProps) {
  const router = useRouter()
  const [refrescando, iniciarRefresco] = useTransition()

  const [formularioAbierto, setFormularioAbierto] = useState(false)
  const [cursoEnEdicion, setCursoEnEdicion] = useState<CursoConNivel | null>(null)
  const [cursoCambiandoEstado, setCursoCambiandoEstado] = useState<string | null>(null)
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)

  const opcionesNivel = niveles.map((nivel) => ({ value: nivel.id, label: nivel.nombre }))

  const formularioAlta = useForm<CrearCursoData>({
    resolver: zodResolver(crearCursoSchema),
    mode: 'onTouched',
  })

  const formularioEdicion = useForm<CrearCursoData>({
    resolver: zodResolver(crearCursoSchema),
    mode: 'onTouched',
  })

  /** Traduce un fallo del servidor al campo correspondiente cuando lo identifica. */
  function mostrarError(
    error: unknown,
    formulario: typeof formularioAlta,
    respaldo: string
  ) {
    const mensaje = error instanceof Error ? error.message : respaldo
    if (error instanceof ErrorCurso && esCampoFormulario(error.campo)) {
      formulario.setError(error.campo, { type: 'server', message: mensaje })
    }
    setErrorGeneral(mensaje)
    toast.error(mensaje)
  }

  /** Vuelve a pedir la página al servidor para que la tabla refleje lo persistido. */
  function reconciliar() {
    iniciarRefresco(() => router.refresh())
  }

  async function onCrear(datos: CrearCursoData) {
    setErrorGeneral(null)
    try {
      await crearCursoRemoto(datos)
      toast.success('Curso creado')
      formularioAlta.reset({ denominacion: '', division: '' })
      setFormularioAbierto(false)
      reconciliar()
    } catch (error) {
      mostrarError(error, formularioAlta, 'No pudimos crear el curso.')
    }
  }

  async function onEditar(datos: CrearCursoData) {
    if (!cursoEnEdicion) return
    setErrorGeneral(null)
    try {
      await actualizarCursoRemoto(cursoEnEdicion.id, datos)
      toast.success('Curso actualizado')
      setCursoEnEdicion(null)
      reconciliar()
    } catch (error) {
      mostrarError(error, formularioEdicion, 'No pudimos actualizar el curso.')
    }
  }

  async function cambiarEstado(curso: CursoConNivel) {
    const inactivando = curso.activo
    const etiqueta = `${curso.denominacion} ${curso.division}`
    const confirmacion = inactivando
      ? `¿Inactivar el curso ${etiqueta}? Se conservan sus datos y sus relaciones; podés reactivarlo cuando quieras.`
      : `¿Reactivar el curso ${etiqueta}?`

    if (!window.confirm(confirmacion)) return

    setErrorGeneral(null)
    setCursoCambiandoEstado(curso.id)
    try {
      await actualizarCursoRemoto(curso.id, { activo: !curso.activo })
      toast.success(inactivando ? 'Curso inactivado' : 'Curso reactivado')
      reconciliar()
    } catch (error) {
      const mensaje =
        error instanceof Error ? error.message : 'No pudimos cambiar el estado del curso.'
      setErrorGeneral(mensaje)
      toast.error(mensaje)
    } finally {
      setCursoCambiandoEstado(null)
    }
  }

  function abrirEdicion(curso: CursoConNivel) {
    setErrorGeneral(null)
    setCursoEnEdicion(curso)
    formularioEdicion.reset({
      denominacion: curso.denominacion,
      division: curso.division,
      nivel_id: curso.nivel_id,
    })
  }

  const sinNiveles = niveles.length === 0

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-neutral-900 tracking-tight">Cursos</h1>
          <p className="text-neutral-500 text-sm mt-0.5">
            Denominación, división y nivel educativo. La denominación y la división no se
            repiten dentro de un mismo nivel.
          </p>
        </div>
        <Button
          onClick={() => {
            setErrorGeneral(null)
            setFormularioAbierto((abierto) => !abierto)
          }}
          aria-expanded={formularioAbierto}
          aria-controls="formulario-nuevo-curso"
          disabled={sinNiveles}
        >
          <Plus size={18} weight="bold" />
          {formularioAbierto ? 'Cerrar formulario' : 'Nuevo curso'}
        </Button>
      </div>

      {sinNiveles && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-6 text-sm text-yellow-800">
          No hay niveles educativos cargados, así que todavía no se pueden crear cursos.
        </div>
      )}

      {/* Región de estado: anuncia los fallos a los lectores de pantalla. Lleva
          nombre propio para distinguirla de otras regiones vivas de la página,
          como el contenedor de notificaciones. */}
      <div aria-live="polite" aria-label="Estado de la administración de cursos">
        {errorGeneral && (
          <div
            role="alert"
            className="bg-red-50 border border-red-200 rounded-2xl p-4 flex gap-3 items-start"
          >
            <WarningCircle size={20} weight="fill" className="text-red-500 shrink-0 mt-0.5" />
            <p className="text-sm text-red-800">{errorGeneral}</p>
          </div>
        )}
      </div>

      {formularioAbierto && !sinNiveles && (
        <form
          id="formulario-nuevo-curso"
          onSubmit={formularioAlta.handleSubmit(onCrear)}
          noValidate
          className="bg-white rounded-2xl border border-neutral-200 p-5 space-y-4"
        >
          <h2 className="font-bold text-neutral-900">Nuevo curso</h2>
          <div className="grid sm:grid-cols-3 gap-4">
            <Input
              label="Denominación"
              placeholder="Ej.: 1er Grado"
              maxLength={100}
              required
              autoComplete="off"
              error={formularioAlta.formState.errors.denominacion?.message}
              {...formularioAlta.register('denominacion')}
            />
            <Input
              label="División"
              placeholder="Ej.: A"
              maxLength={20}
              required
              autoComplete="off"
              error={formularioAlta.formState.errors.division?.message}
              {...formularioAlta.register('division')}
            />
            <Select
              label="Nivel educativo"
              placeholder="Seleccioná un nivel..."
              required
              options={opcionesNivel}
              error={formularioAlta.formState.errors.nivel_id?.message}
              {...formularioAlta.register('nivel_id', { valueAsNumber: true })}
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" loading={formularioAlta.formState.isSubmitting}>
              Crear curso
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

      {cursos.length === 0 ? (
        <div className="bg-white rounded-2xl border border-neutral-200 py-16 text-center">
          <Chalkboard size={40} className="text-neutral-300 mx-auto mb-3" />
          <p className="text-neutral-400 text-sm">No hay cursos registrados</p>
        </div>
      ) : (
        <>
          {/* Escritorio y tablet: tabla. */}
          <div
            className="hidden sm:block bg-white rounded-2xl border border-neutral-200 overflow-hidden"
            aria-busy={refrescando}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-label="Tabla de cursos">
                <caption className="sr-only">
                  Cursos registrados, con su nivel educativo, su estado y las acciones
                  disponibles.
                </caption>
                <thead>
                  <tr className="bg-neutral-50 border-b border-neutral-100">
                    {['Curso', 'Nivel', 'Estado', 'Acciones'].map((columna) => (
                      <th
                        key={columna}
                        scope="col"
                        className="text-left px-5 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider"
                      >
                        {columna}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {cursos.map((curso) => (
                    <tr key={curso.id} className="hover:bg-neutral-50 transition-colors">
                      <td className="px-5 py-3 font-semibold text-neutral-900">
                        {curso.denominacion} {curso.division}
                      </td>
                      <td className="px-5 py-3 text-neutral-600">
                        {curso.nivel?.nombre ?? '—'}
                      </td>
                      <td className="px-5 py-3">
                        <Badge variant={curso.activo ? 'success' : 'default'} dot>
                          {curso.activo ? 'Activo' : 'Inactivo'}
                        </Badge>
                      </td>
                      <td className="px-5 py-3">
                        <AccionesCurso
                          curso={curso}
                          cambiandoEstado={cursoCambiandoEstado === curso.id}
                          onEditar={abrirEdicion}
                          onCambiarEstado={cambiarEstado}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Móvil: tarjetas, para que nada dependa del desplazamiento horizontal. */}
          <ul className="sm:hidden space-y-3" aria-label="Cursos registrados" aria-busy={refrescando}>
            {cursos.map((curso) => (
              <li
                key={curso.id}
                className="bg-white rounded-2xl border border-neutral-200 p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-neutral-900">
                      {curso.denominacion} {curso.division}
                    </p>
                    <p className="text-xs text-neutral-500 mt-0.5">
                      {curso.nivel?.nombre ?? 'Sin nivel'}
                    </p>
                  </div>
                  <Badge variant={curso.activo ? 'success' : 'default'} dot>
                    {curso.activo ? 'Activo' : 'Inactivo'}
                  </Badge>
                </div>
                <AccionesCurso
                  curso={curso}
                  cambiandoEstado={cursoCambiandoEstado === curso.id}
                  onEditar={abrirEdicion}
                  onCambiarEstado={cambiarEstado}
                />
              </li>
            ))}
          </ul>
        </>
      )}

      {cursoEnEdicion && (
        <ModalEdicion
          titulo={`Editar ${cursoEnEdicion.denominacion} ${cursoEnEdicion.division}`}
          onCerrar={() => setCursoEnEdicion(null)}
        >
          <form
            onSubmit={formularioEdicion.handleSubmit(onEditar)}
            noValidate
            className="space-y-4"
          >
            <Input
              label="Denominación"
              id="editar-denominacion"
              maxLength={100}
              required
              autoComplete="off"
              error={formularioEdicion.formState.errors.denominacion?.message}
              {...formularioEdicion.register('denominacion')}
            />
            <Input
              label="División"
              id="editar-division"
              maxLength={20}
              required
              autoComplete="off"
              error={formularioEdicion.formState.errors.division?.message}
              {...formularioEdicion.register('division')}
            />
            <Select
              label="Nivel educativo"
              id="editar-nivel"
              placeholder="Seleccioná un nivel..."
              required
              options={opcionesNivel}
              error={formularioEdicion.formState.errors.nivel_id?.message}
              {...formularioEdicion.register('nivel_id', { valueAsNumber: true })}
            />
            <div className="flex flex-wrap gap-3 pt-2">
              <Button type="submit" loading={formularioEdicion.formState.isSubmitting}>
                Guardar cambios
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setCursoEnEdicion(null)}
                disabled={formularioEdicion.formState.isSubmitting}
              >
                Cancelar
              </Button>
            </div>
          </form>
        </ModalEdicion>
      )}
    </div>
  )
}

function AccionesCurso({
  curso,
  cambiandoEstado,
  onEditar,
  onCambiarEstado,
}: {
  curso: CursoConNivel
  cambiandoEstado: boolean
  onEditar: (curso: CursoConNivel) => void
  onCambiarEstado: (curso: CursoConNivel) => void
}) {
  const etiqueta = `${curso.denominacion} ${curso.division}`
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size="sm"
        variant="secondary"
        onClick={() => onEditar(curso)}
        aria-label={`Editar el curso ${etiqueta}`}
      >
        <PencilSimple size={15} />
        Editar
      </Button>
      <Button
        size="sm"
        variant={curso.activo ? 'outline' : 'secondary'}
        loading={cambiandoEstado}
        onClick={() => onCambiarEstado(curso)}
        aria-label={
          curso.activo ? `Inactivar el curso ${etiqueta}` : `Reactivar el curso ${etiqueta}`
        }
      >
        {curso.activo ? <Prohibit size={15} /> : <ArrowCounterClockwise size={15} />}
        {curso.activo ? 'Inactivar' : 'Reactivar'}
      </Button>
    </div>
  )
}

const SELECTOR_ENFOCABLES =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Diálogo de edición. Mueve el foco al abrirse, lo retiene mientras está
 * abierto, lo devuelve al cerrarse y se cierra con Escape, para que la edición
 * sea usable solo con teclado.
 *
 * La retención del foco no es opcional: el diálogo declara `aria-modal="true"`,
 * así que un lector de pantalla anuncia que el resto de la página quedó
 * inactivo. Si el tabulador pudiera salir, ese anuncio sería mentira.
 */
function ModalEdicion({
  titulo,
  onCerrar,
  children,
}: {
  titulo: string
  onCerrar: () => void
  children: React.ReactNode
}) {
  const contenedor = useRef<HTMLDivElement>(null)
  const focoPrevio = useRef<HTMLElement | null>(null)

  useEffect(() => {
    focoPrevio.current = document.activeElement as HTMLElement | null
    // Se prefiere el primer campo editable; el botón de cerrar es el respaldo,
    // para que el foco nunca quede fuera del diálogo.
    const primerCampo =
      contenedor.current?.querySelector<HTMLElement>('input, select, textarea') ??
      contenedor.current?.querySelector<HTMLElement>('button')
    primerCampo?.focus()

    const alPresionarTecla = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') {
        onCerrar()
        return
      }
      if (evento.key !== 'Tab') return

      const enfocables = Array.from(
        contenedor.current?.querySelectorAll<HTMLElement>(SELECTOR_ENFOCABLES) ?? []
      )
      if (enfocables.length === 0) return

      const primero = enfocables[0]
      const ultimo = enfocables[enfocables.length - 1]
      const activo = document.activeElement

      // Se cierra el ciclo en los dos extremos, y también si el foco ya se
      // había escapado del diálogo por cualquier motivo.
      if (evento.shiftKey && (activo === primero || !contenedor.current?.contains(activo))) {
        evento.preventDefault()
        ultimo.focus()
      } else if (!evento.shiftKey && (activo === ultimo || !contenedor.current?.contains(activo))) {
        evento.preventDefault()
        primero.focus()
      }
    }
    document.addEventListener('keydown', alPresionarTecla)

    return () => {
      document.removeEventListener('keydown', alPresionarTecla)
      focoPrevio.current?.focus()
    }
  }, [onCerrar])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8 overflow-y-auto">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onCerrar}
        aria-hidden="true"
      />
      <div
        ref={contenedor}
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-modal-curso"
        className="relative w-full max-w-lg bg-white rounded-2xl border border-neutral-200 shadow-xl my-auto"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-100">
          <h2 id="titulo-modal-curso" className="font-bold text-neutral-900">
            {titulo}
          </h2>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar el formulario de edición"
            className="text-neutral-400 hover:text-neutral-600 p-1 rounded-lg hover:bg-neutral-100"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-6 py-5 max-h-[70vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}
