'use client'

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import {
  ArrowCounterClockwise,
  GraduationCap,
  PencilSimple,
  Plus,
  Prohibit,
  ShieldCheck,
  WarningCircle,
  X,
} from '@phosphor-icons/react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { crearNivelSchema, type CrearNivelData } from '@/lib/validations'
import {
  cambiarEstadoNivelRemoto,
  crearNivelRemoto,
  ErrorNivel,
  renombrarNivelRemoto,
} from '@/services/niveles.client'
import type { NivelAdministrable } from '@/services/niveles.service'

type MensajeInicial =
  | { tipo: 'error'; texto: string }
  | { tipo: 'exito'; texto: string }

interface GestionNivelesProps {
  niveles: NivelAdministrable[]
  mensajeInicial?: MensajeInicial
}

type ConfirmacionEstado = {
  nivel: NivelAdministrable
  activoDestino: boolean
}

/** Catálogo administrativo ordenado, con escritura siempre mediada por la API. */
export function GestionNiveles({
  niveles,
  mensajeInicial,
}: GestionNivelesProps) {
  const router = useRouter()
  const [refrescando, iniciarRefresco] = useTransition()
  const [formularioAbierto, setFormularioAbierto] = useState(false)
  const [nivelEnEdicion, setNivelEnEdicion] = useState<NivelAdministrable | null>(
    null
  )
  const [confirmacionEstado, setConfirmacionEstado] =
    useState<ConfirmacionEstado | null>(null)
  const [cambiandoEstado, setCambiandoEstado] = useState(false)
  const [errorGeneral, setErrorGeneral] = useState<string | null>(
    mensajeInicial?.tipo === 'error' ? mensajeInicial.texto : null
  )
  const [mensajeExito, setMensajeExito] = useState<string | null>(
    mensajeInicial?.tipo === 'exito' ? mensajeInicial.texto : null
  )
  const nombreAltaRef = useRef<HTMLInputElement | null>(null)

  const formularioAlta = useForm<CrearNivelData>({
    resolver: zodResolver(crearNivelSchema),
    mode: 'onTouched',
  })
  const formularioEdicion = useForm<CrearNivelData>({
    resolver: zodResolver(crearNivelSchema),
    mode: 'onTouched',
  })
  const registroNombreAlta = formularioAlta.register('nombre')

  useEffect(() => {
    if (formularioAbierto) nombreAltaRef.current?.focus()
  }, [formularioAbierto])

  function limpiarMensajes() {
    setErrorGeneral(null)
    setMensajeExito(null)
  }

  function reconciliar() {
    iniciarRefresco(() => router.refresh())
  }

  function mostrarError(
    error: unknown,
    formulario: typeof formularioAlta,
    respaldo: string
  ) {
    const mensaje = error instanceof Error ? error.message : respaldo
    if (error instanceof ErrorNivel && error.campo === 'nombre') {
      formulario.setError('nombre', { type: 'server', message: mensaje })
    }
    setErrorGeneral(mensaje)
    setMensajeExito(null)
    toast.error(mensaje)
  }

  async function crear(datos: CrearNivelData) {
    limpiarMensajes()
    try {
      await crearNivelRemoto(datos)
      formularioAlta.reset({ nombre: '' })
      setFormularioAbierto(false)
      setMensajeExito(`Nivel ${datos.nombre} creado correctamente.`)
      toast.success('Nivel creado')
      reconciliar()
    } catch (error) {
      mostrarError(error, formularioAlta, 'No pudimos crear el nivel educativo.')
    }
  }

  function abrirEdicion(nivel: NivelAdministrable) {
    limpiarMensajes()
    setNivelEnEdicion(nivel)
    formularioEdicion.reset({ nombre: nivel.nombre })
  }

  async function renombrar(datos: CrearNivelData) {
    if (!nivelEnEdicion) return
    limpiarMensajes()
    try {
      await renombrarNivelRemoto(nivelEnEdicion.id, datos.nombre)
      setNivelEnEdicion(null)
      setMensajeExito(`Nivel renombrado como ${datos.nombre}.`)
      toast.success('Nivel renombrado')
      reconciliar()
    } catch (error) {
      mostrarError(
        error,
        formularioEdicion,
        'No pudimos renombrar el nivel educativo.'
      )
    }
  }

  async function confirmarCambioEstado() {
    if (!confirmacionEstado) return
    limpiarMensajes()
    setCambiandoEstado(true)
    try {
      await cambiarEstadoNivelRemoto(
        confirmacionEstado.nivel.id,
        confirmacionEstado.activoDestino
      )
      const accion = confirmacionEstado.activoDestino ? 'reactivado' : 'inactivado'
      setMensajeExito(`Nivel ${confirmacionEstado.nivel.nombre} ${accion}.`)
      toast.success(`Nivel ${accion}`)
      setConfirmacionEstado(null)
      reconciliar()
    } catch (error) {
      const mensaje =
        error instanceof Error
          ? error.message
          : 'No pudimos cambiar el estado del nivel educativo.'
      setErrorGeneral(mensaje)
      toast.error(mensaje)
    } finally {
      setCambiandoEstado(false)
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600 mb-2">
            Configuración académica
          </p>
          <h1 className="text-2xl font-extrabold text-neutral-900 tracking-tight">
            Niveles educativos
          </h1>
          <p className="text-neutral-500 text-sm mt-1 max-w-[64ch]">
            El listado respeta el orden definido para formularios y recorridos
            institucionales. Los niveles inactivos conservan su historial.
          </p>
        </div>
        <Button
          onClick={() => {
            limpiarMensajes()
            setFormularioAbierto((abierto) => !abierto)
          }}
          aria-expanded={formularioAbierto}
          aria-controls="formulario-nuevo-nivel"
        >
          <Plus size={18} weight="bold" />
          {formularioAbierto ? 'Cerrar formulario' : 'Nuevo nivel'}
        </Button>
      </div>

      <div className="bg-brand-50 border border-brand-100 rounded-2xl p-4 flex gap-3 items-start">
        <ShieldCheck
          size={20}
          weight="fill"
          className="text-brand-600 shrink-0 mt-0.5"
        />
        <p className="text-sm text-brand-800 leading-relaxed">
          Los nombres de los niveles institucionales están protegidos para mantener
          referencias estables. Su disponibilidad sí puede cambiarse sin borrar datos.
        </p>
      </div>

      <div
        aria-live="polite"
        aria-label="Estado de la administración de niveles"
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
          id="formulario-nuevo-nivel"
          onSubmit={formularioAlta.handleSubmit(crear)}
          noValidate
          className="bg-white rounded-2xl border border-neutral-200 p-5 space-y-4"
        >
          <div>
            <h2 className="font-bold text-neutral-900">Nuevo nivel educativo</h2>
            <p className="text-sm text-neutral-500 mt-1">
              El nombre debe ser único y no puede tener espacios al inicio o al final.
            </p>
          </div>
          <div className="max-w-xl">
            <Input
              label="Nombre del nivel"
              id="nuevo-nivel-nombre"
              placeholder="Ej.: Formación profesional"
              maxLength={50}
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
              Crear nivel
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

      {niveles.length === 0 ? (
        <div className="bg-white rounded-2xl border border-neutral-200 py-16 px-5 text-center">
          <GraduationCap size={40} className="text-neutral-300 mx-auto mb-3" />
          <p className="font-semibold text-neutral-700">
            No hay niveles educativos registrados
          </p>
          <p className="text-neutral-400 text-sm mt-1">
            Usá “Nuevo nivel” para registrar el primero.
          </p>
        </div>
      ) : (
        <ListadoNiveles
          niveles={niveles}
          refrescando={refrescando}
          onEditar={abrirEdicion}
          onCambiarEstado={(nivel) => {
            limpiarMensajes()
            setConfirmacionEstado({ nivel, activoDestino: !nivel.activo })
          }}
        />
      )}

      {nivelEnEdicion && (
        <Dialogo
          tituloId="titulo-renombrar-nivel"
          titulo={`Renombrar ${nivelEnEdicion.nombre}`}
          selectorFocoInicial="#renombrar-nivel-nombre"
          onCerrar={() => setNivelEnEdicion(null)}
        >
          <form
            onSubmit={formularioEdicion.handleSubmit(renombrar)}
            noValidate
            className="space-y-4"
          >
            <Input
              label="Nombre del nivel"
              id="renombrar-nivel-nombre"
              maxLength={50}
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
                onClick={() => setNivelEnEdicion(null)}
                disabled={formularioEdicion.formState.isSubmitting}
              >
                Cancelar
              </Button>
            </div>
          </form>
        </Dialogo>
      )}

      {confirmacionEstado && (
        <Dialogo
          tituloId="titulo-cambiar-estado-nivel"
          titulo={
            confirmacionEstado.activoDestino
              ? `Reactivar ${confirmacionEstado.nivel.nombre}`
              : `Inactivar ${confirmacionEstado.nivel.nombre}`
          }
          selectorFocoInicial="#confirmar-estado-nivel"
          onCerrar={() => {
            if (!cambiandoEstado) setConfirmacionEstado(null)
          }}
        >
          <div className="space-y-5">
            <p className="text-sm text-neutral-600 leading-relaxed">
              {confirmacionEstado.activoDestino
                ? 'El nivel volverá a estar disponible para nuevas asignaciones de cursos.'
                : 'El nivel dejará de ofrecerse en nuevas asignaciones. Los cursos existentes conservarán su relación histórica.'}
            </p>
            <div className="flex flex-wrap gap-3">
              <Button
                id="confirmar-estado-nivel"
                variant={confirmacionEstado.activoDestino ? 'primary' : 'danger'}
                loading={cambiandoEstado}
                onClick={confirmarCambioEstado}
              >
                {confirmacionEstado.activoDestino ? 'Confirmar reactivación' : 'Confirmar inactivación'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setConfirmacionEstado(null)}
                disabled={cambiandoEstado}
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

function ListadoNiveles({
  niveles,
  refrescando,
  onEditar,
  onCambiarEstado,
}: {
  niveles: NivelAdministrable[]
  refrescando: boolean
  onEditar: (nivel: NivelAdministrable) => void
  onCambiarEstado: (nivel: NivelAdministrable) => void
}) {
  return (
    <>
      <div
        className="hidden sm:block bg-white rounded-2xl border border-neutral-200 overflow-hidden"
        aria-busy={refrescando}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="Tabla de niveles educativos">
            <caption className="sr-only">
              Niveles educativos ordenados, con tipo, estado y acciones disponibles.
            </caption>
            <thead>
              <tr className="bg-neutral-50 border-b border-neutral-100">
                {['Orden', 'Nivel', 'Tipo', 'Estado', 'Acciones'].map((columna) => (
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
              {niveles.map((nivel) => (
                <tr key={nivel.id} className="hover:bg-neutral-50 transition-colors">
                  <td className="px-5 py-3 font-mono text-xs text-neutral-500">
                    {nivel.orden}
                  </td>
                  <td className="px-5 py-3 font-semibold text-neutral-900">
                    {nivel.nombre}
                  </td>
                  <td className="px-5 py-3">
                    <Badge variant={nivel.es_institucional ? 'info' : 'outline'}>
                      {nivel.es_institucional ? 'Institucional' : 'Administrativo'}
                    </Badge>
                  </td>
                  <td className="px-5 py-3">
                    <Badge variant={nivel.activo ? 'success' : 'default'} dot>
                      {nivel.activo ? 'Activo' : 'Inactivo'}
                    </Badge>
                  </td>
                  <td className="px-5 py-3">
                    <AccionesNivel
                      nivel={nivel}
                      onEditar={onEditar}
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
        aria-label="Niveles educativos ordenados"
        aria-busy={refrescando}
      >
        {niveles.map((nivel) => (
          <li
            key={nivel.id}
            className="bg-white rounded-2xl border border-neutral-200 p-4 space-y-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-mono text-neutral-400">Orden {nivel.orden}</p>
                <p className="font-semibold text-neutral-900 break-words mt-0.5">
                  {nivel.nombre}
                </p>
              </div>
              <Badge variant={nivel.activo ? 'success' : 'default'} dot>
                {nivel.activo ? 'Activo' : 'Inactivo'}
              </Badge>
            </div>
            <Badge variant={nivel.es_institucional ? 'info' : 'outline'}>
              {nivel.es_institucional ? 'Institucional' : 'Administrativo'}
            </Badge>
            <AccionesNivel
              nivel={nivel}
              onEditar={onEditar}
              onCambiarEstado={onCambiarEstado}
            />
          </li>
        ))}
      </ul>
    </>
  )
}

function AccionesNivel({
  nivel,
  onEditar,
  onCambiarEstado,
}: {
  nivel: NivelAdministrable
  onEditar: (nivel: NivelAdministrable) => void
  onCambiarEstado: (nivel: NivelAdministrable) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {!nivel.es_institucional && (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onEditar(nivel)}
          aria-label={`Renombrar el nivel ${nivel.nombre}`}
        >
          <PencilSimple size={15} />
          Renombrar
        </Button>
      )}
      <Button
        size="sm"
        variant={nivel.activo ? 'outline' : 'secondary'}
        onClick={() => onCambiarEstado(nivel)}
        aria-label={
          nivel.activo
            ? `Inactivar el nivel ${nivel.nombre}`
            : `Reactivar el nivel ${nivel.nombre}`
        }
      >
        {nivel.activo ? <Prohibit size={15} /> : <ArrowCounterClockwise size={15} />}
        {nivel.activo ? 'Inactivar' : 'Reactivar'}
      </Button>
    </div>
  )
}

const SELECTOR_ENFOCABLES =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function Dialogo({
  tituloId,
  titulo,
  selectorFocoInicial,
  onCerrar,
  children,
}: {
  tituloId: string
  titulo: string
  selectorFocoInicial: string
  onCerrar: () => void
  children: ReactNode
}) {
  const contenedor = useRef<HTMLDivElement>(null)
  const focoPrevio = useRef<HTMLElement | null>(null)
  const onCerrarRef = useRef(onCerrar)

  useEffect(() => {
    onCerrarRef.current = onCerrar
  }, [onCerrar])

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
        className="absolute inset-0 bg-neutral-950/40 backdrop-blur-sm"
        onClick={() => onCerrarRef.current()}
        aria-hidden="true"
      />
      <div
        ref={contenedor}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        className="relative w-full max-w-lg bg-white rounded-2xl border border-neutral-200 shadow-xl my-auto"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-100">
          <h2 id={tituloId} className="font-bold text-neutral-900">
            {titulo}
          </h2>
          <button
            type="button"
            onClick={() => onCerrarRef.current()}
            aria-label="Cerrar diálogo"
            className="text-neutral-400 hover:text-neutral-600 p-1 rounded-lg hover:bg-neutral-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-6 py-5 max-h-[70vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}
