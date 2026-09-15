'use client'

import { useCallback, useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { MagnifyingGlass, Users } from '@phosphor-icons/react'
import {
  obtenerPerfilesPaginados,
  buscarPerfilesPaginados,
  crearPerfil,
  actualizarPerfil,
} from '@/services/perfiles.service'
import { obtenerRoles } from '@/services/roles.service'
import { formatFecha, ROLES } from '@/lib/utils'
import { perfilSchema, PerfilFormData } from '@/lib/validations'
import { Badge, Skeleton } from '@/components/ui/Badge'
import { Input, Select } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/context/AuthContext'

type Perfil = {
  id: string
  nombre: string
  apellido: string
  dni: string
  legajo_nro: string | null
  fecha_nacimiento: string | null
  telefono: string | null
  direccion: string | null
  fecha_creacion: string
  rol: { nombre: string } | null
  rol_id: number | null
}

type Rol = { id: number; nombre: string }
const rolesAlternativos: Rol[] = ROLES.map((nombre, indice) => ({ id: indice + 1, nombre }))
const elementosPorPagina = 10

// `danger` siempre fue una variante válida de Badge; faltaba en este tipo, y el
// `as any` que lo tapaba hacía fallar el lint focalizado de este archivo.
const variantePorRol: Record<
  string,
  'info' | 'success' | 'warning' | 'default' | 'danger'
> = {
  DIRECTOR: 'danger',
  DOCENTE: 'info',
  ESTUDIANTE: 'success',
  PADRE: 'warning',
  PERSONAL: 'default',
}

export default function LegajosPage() {
  const { rol } = useAuth()
  const [perfiles, setPerfiles] = useState<Perfil[]>([])
  const [cargando, setCargando] = useState(true)
  const [busqueda, setBusqueda] = useState('')
  const [busquedaAplicada, setBusquedaAplicada] = useState('')
  const [perfilSeleccionado, setPerfilSeleccionado] = useState<Perfil | null>(null)
  const [roles, setRoles] = useState<Rol[]>([])
  const [modoFormulario, setModoFormulario] = useState<'crear' | 'editar' | null>(null)
  const [paginaActual, setPaginaActual] = useState(1)
  const [totalPaginas, setTotalPaginas] = useState(1)
  const {
    register: registrarCampo,
    handleSubmit: procesarEnvio,
    reset: reiniciarFormulario,
    formState: { errors: errores, isSubmitting: enviando },
  } = useForm<PerfilFormData>({ resolver: zodResolver(perfilSchema), mode: 'onTouched' })

  const cargarDatos = useCallback(async (pagina: number, consulta: string) => {
    setCargando(true)
    try {
      if (consulta.length >= 2) {
        const { data: datos, count: cantidad } = await buscarPerfilesPaginados(consulta, pagina, elementosPorPagina)
        setPerfiles(datos as Perfil[])
        setTotalPaginas(Math.max(1, Math.ceil(cantidad / elementosPorPagina)))
      } else {
        const { data: datos, count: cantidad } = await obtenerPerfilesPaginados(pagina, elementosPorPagina)
        setPerfiles(datos as Perfil[])
        setTotalPaginas(Math.max(1, Math.ceil(cantidad / elementosPorPagina)))
      }
    } catch { toast.error('Error al cargar legajos') }
    finally { setCargando(false) }
  }, [])

  const cargarRoles = useCallback(async () => {
    try {
      const datos = await obtenerRoles()
      const rolesObtenidos = (datos as Rol[]) ?? []
      setRoles(rolesObtenidos.length > 0 ? rolesObtenidos : rolesAlternativos)
      if (rolesObtenidos.length === 0) {
        toast.error('No se encontraron roles, usando valores por defecto')
      }
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : 'Error al cargar roles'
      toast.error(mensaje)
      setRoles(rolesAlternativos)
    }
  }, [])

  // Los roles se cargan una sola vez cuando se confirma el permiso de dirección.
  useEffect(() => {
    if (rol !== 'DIRECTOR') return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    cargarRoles()
  }, [rol, cargarRoles])

  // La búsqueda espera 300 ms de inactividad y vuelve a la primera página.
  useEffect(() => {
    const temporizador = setTimeout(() => {
      setPaginaActual(1)
      setBusquedaAplicada(busqueda)
    }, 300)
    return () => clearTimeout(temporizador)
  }, [busqueda])

  // Este es el único efecto que carga perfiles: responde a paginación y búsqueda aplicada.
  useEffect(() => {
    if (rol !== 'DIRECTOR') return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    cargarDatos(paginaActual, busquedaAplicada)
  }, [paginaActual, busquedaAplicada, rol, cargarDatos])

  // Sin permiso de dirección nunca se pide nada, así que `cargando` se queda en true para
  // siempre. El esqueleto solo tiene sentido mientras la sesión resuelve (rol null) o
  // cuando el director sí está esperando datos.
  const mostrandoEsqueleto = cargando && (rol === null || rol === 'DIRECTOR')

  const iniciarCreacion = () => {
    setPerfilSeleccionado(null)
    setModoFormulario('crear')
    reiniciarFormulario({
      nombre: '',
      apellido: '',
      dni: '',
      rol_id: undefined as unknown as number,
      fecha_nacimiento: undefined,
      telefono: undefined,
      direccion: '',
      legajo_nro: undefined,
    })
  }

  const iniciarEdicion = (perfil: Perfil) => {
    setPerfilSeleccionado(perfil)
    setModoFormulario('editar')
    reiniciarFormulario({
      nombre: perfil.nombre,
      apellido: perfil.apellido,
      dni: perfil.dni,
      rol_id: perfil.rol_id ?? roles.find((r) => r.nombre === perfil.rol?.nombre)?.id ?? (undefined as unknown as number),
      fecha_nacimiento: perfil.fecha_nacimiento ?? undefined,
      telefono: perfil.telefono ?? undefined,
      direccion: perfil.direccion ?? '',
      legajo_nro: perfil.legajo_nro ?? undefined,
    })
  }

  const guardarPerfil = async (datos: PerfilFormData) => {
    try {
      if (modoFormulario === 'crear') {
        await crearPerfil(datos)
        toast.success('Legajo creado')
      } else if (modoFormulario === 'editar' && perfilSeleccionado) {
        await actualizarPerfil(perfilSeleccionado.id, {
          nombre: datos.nombre,
          apellido: datos.apellido,
          dni: datos.dni,
          fecha_nacimiento: datos.fecha_nacimiento,
          telefono: datos.telefono,
          direccion: datos.direccion,
          legajo_nro: datos.legajo_nro,
        })
        toast.success('Legajo actualizado')
      }
      setModoFormulario(null)
      setPerfilSeleccionado(null)
      await cargarDatos(paginaActual, busquedaAplicada)
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : 'No se pudo guardar el legajo'
      toast.error(mensaje)
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {rol && rol !== 'DIRECTOR' && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-6 text-sm text-yellow-800">
          Acceso restringido. Solo directores pueden gestionar legajos.
        </div>
      )}
      <div>
        <h1 className="text-2xl font-extrabold text-neutral-900 tracking-tight">Legajos</h1>
        <p className="text-neutral-500 text-sm mt-0.5">Gestión de alumnos, docentes y personal</p>
      </div>

      {/* Search */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-sm w-full">
          <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            type="search"
            placeholder="Buscar por nombre, apellido o DNI..."
            value={busqueda}
            onChange={(evento) => setBusqueda(evento.target.value)}
            className="w-full pl-9 h-10 pr-3 rounded-lg border border-neutral-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 bg-white"
            aria-label="Buscar legajos"
          />
        </div>
        <Button type="button" variant="accent" onClick={iniciarCreacion}>Nuevo legajo</Button>
      </div>

      {modoFormulario && (
        <div className="bg-white rounded-2xl border border-brand-200 p-6 space-y-4">
          <div className="flex items-start justify-between">
            <h2 className="font-bold text-neutral-900">
              {modoFormulario === 'crear' ? 'Crear legajo' : 'Editar legajo'}
            </h2>
            <button onClick={() => setModoFormulario(null)} className="text-neutral-400 hover:text-neutral-600 text-sm">
              Cerrar
            </button>
          </div>
          <form onSubmit={procesarEnvio(guardarPerfil)} noValidate className="space-y-5">
            <div className="grid sm:grid-cols-2 gap-4">
              <Input label="Nombre" required {...registrarCampo('nombre')} error={errores.nombre?.message} />
              <Input label="Apellido" required {...registrarCampo('apellido')} error={errores.apellido?.message} />
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <Input label="DNI" required {...registrarCampo('dni')} error={errores.dni?.message} />
              {modoFormulario === 'crear' ? (
                <Select
                  label="Rol"
                  required
                  placeholder="Seleccionar rol"
                  options={roles.map((rol) => ({ value: rol.id, label: rol.nombre }))}
                  {...registrarCampo('rol_id', { valueAsNumber: true })}
                  error={errores.rol_id?.message}
                />
              ) : (
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-semibold text-neutral-700">Rol</span>
                  <p className="min-h-10 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
                    {perfilSeleccionado?.rol?.nombre ?? 'Sin rol asignado'}
                  </p>
                  <p className="text-xs text-neutral-500">
                    El cambio de rol requiere una transición administrativa específica.
                  </p>
                </div>
              )}
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <Input
                label="Fecha de nacimiento"
                type="date"
                {...registrarCampo('fecha_nacimiento', { setValueAs: (valor) => (valor ? valor : undefined) })}
                error={errores.fecha_nacimiento?.message}
              />
              <Input
                label="Teléfono"
                {...registrarCampo('telefono', { setValueAs: (valor) => (valor ? valor : undefined) })}
                error={errores.telefono?.message}
              />
            </div>
            <Input label="Dirección" {...registrarCampo('direccion')} error={errores.direccion?.message} />
            <Input
              label="Legajo N°"
              {...registrarCampo('legajo_nro', { setValueAs: (valor) => (valor ? valor : undefined) })}
              error={errores.legajo_nro?.message}
            />
            <div className="flex gap-3 justify-end">
              <Button type="button" variant="ghost" onClick={() => setModoFormulario(null)}>Cancelar</Button>
              <Button type="submit" loading={enviando}>
                {modoFormulario === 'crear' ? 'Crear legajo' : 'Guardar cambios'}
              </Button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="Tabla de legajos">
            <thead>
              <tr className="bg-neutral-50 border-b border-neutral-100">
                {['Persona', 'DNI', 'Legajo', 'Rol', 'Teléfono', 'Alta'].map((columna) => (
                  <th key={columna} className="text-left px-5 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider">
                    {columna}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {mostrandoEsqueleto
                ? Array.from({ length: 6 }).map((_, indiceFila) => (
                    <tr key={indiceFila}>
                      {Array.from({ length: 6 }).map((_, indiceColumna) => (
                        <td key={indiceColumna} className="px-5 py-3"><Skeleton className="h-4 w-full" /></td>
                      ))}
                    </tr>
                  ))
                : perfiles.length === 0
                  ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-16 text-center">
                        <Users size={40} className="text-neutral-300 mx-auto mb-3" />
                        <p className="text-neutral-400 text-sm">No se encontraron legajos</p>
                      </td>
                    </tr>
                  )
                  : perfiles.map((p) => (
                    <tr
                      key={p.id}
                      className="hover:bg-neutral-50 cursor-pointer transition-colors"
                      onClick={() => setPerfilSeleccionado(p === perfilSeleccionado ? null : p)}
                      aria-selected={perfilSeleccionado?.id === p.id}
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-brand-600 font-bold text-xs shrink-0">
                            {p.nombre[0]}{p.apellido[0]}
                          </div>
                          <span className="font-medium text-neutral-900">
                            {p.apellido}, {p.nombre}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-neutral-600">{p.dni}</td>
                      <td className="px-5 py-3 font-mono text-xs text-neutral-500">{p.legajo_nro ?? '—'}</td>
                      <td className="px-5 py-3">
                        {p.rol && (
                          <Badge variant={variantePorRol[p.rol.nombre] ?? 'default'}>
                            {p.rol.nombre}
                          </Badge>
                        )}
                      </td>
                      <td className="px-5 py-3 text-neutral-500">{p.telefono ?? '—'}</td>
                      <td className="px-5 py-3 text-neutral-400 text-xs">{formatFecha(p.fecha_creacion)}</td>
                    </tr>
                  ))
              }
            </tbody>
          </table>
        </div>
      </div>

      {totalPaginas > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-neutral-500">
            Página {paginaActual} de {totalPaginas}
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={paginaActual === 1}
              onClick={() => setPaginaActual((paginaAnterior) => Math.max(1, paginaAnterior - 1))}
            >
              Anterior
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={paginaActual === totalPaginas}
              onClick={() => setPaginaActual((paginaAnterior) => Math.min(totalPaginas, paginaAnterior + 1))}
            >
              Siguiente
            </Button>
          </div>
        </div>
      )}

      {/* Detalle del perfil seleccionado */}
      {perfilSeleccionado && (
        <div className="bg-white rounded-2xl border border-brand-200 p-6 space-y-4">
          <div className="flex items-start justify-between">
            <h2 className="font-bold text-neutral-900">
              Legajo: {perfilSeleccionado.apellido}, {perfilSeleccionado.nombre}
            </h2>
          <div className="flex items-center gap-3">
              <button onClick={() => iniciarEdicion(perfilSeleccionado)} className="text-sm font-semibold text-brand-600 hover:text-brand-800">
                Editar
              </button>
              <button onClick={() => setPerfilSeleccionado(null)} className="text-neutral-400 hover:text-neutral-600 text-sm">
                Cerrar
              </button>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
            {[
              ['DNI', perfilSeleccionado.dni],
              ['Legajo N°', perfilSeleccionado.legajo_nro ?? 'No asignado'],
              ['Rol', perfilSeleccionado.rol?.nombre ?? '—'],
              ['Teléfono', perfilSeleccionado.telefono ?? '—'],
              ['Dirección', perfilSeleccionado.direccion ?? '—'],
              ['Fecha de nacimiento', perfilSeleccionado.fecha_nacimiento ? formatFecha(perfilSeleccionado.fecha_nacimiento) : '—'],
            ].map(([etiqueta, valor]) => (
              <div key={etiqueta} className="space-y-1">
                <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">{etiqueta}</p>
                <p className="text-neutral-800 font-medium">{valor}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
