'use client'

import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { MagnifyingGlass, Users, Trash, Warning } from '@phosphor-icons/react'
import {
  obtenerPerfilesPaginados,
  buscarPerfilesPaginados,
  crearPerfil,
  actualizarPerfil,
  eliminarPerfil,
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
const fallbackRoles: Rol[] = ROLES.map((nombre, index) => ({ id: index + 1, nombre }))

const rolVariant: Record<string, 'info' | 'success' | 'warning' | 'default'> = {
  DIRECTOR: 'danger' as any,
  DOCENTE: 'info',
  ESTUDIANTE: 'success',
  PADRE: 'warning',
  PERSONAL: 'default',
}

export default function LegajosPage() {
  const { rol } = useAuth()
  const [perfiles, setPerfiles] = useState<Perfil[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Perfil | null>(null)
  const [roles, setRoles] = useState<Rol[]>([])
  const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [deleteConfirm, setDeleteConfirm] = useState<Perfil | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const pageSize = 10

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PerfilFormData>({ resolver: zodResolver(perfilSchema), mode: 'onTouched' })

  useEffect(() => {
    if (rol && rol !== 'DIRECTOR') return
    loadData(1, search)
    cargarRoles()
  }, [rol])

  useEffect(() => {
    if (rol && rol !== 'DIRECTOR') return
    const timer = setTimeout(() => {
      setCurrentPage(1)
      loadData(1, search)
    }, 300)
    return () => clearTimeout(timer)
  }, [search, rol])

  useEffect(() => {
    if (rol && rol !== 'DIRECTOR') return
    loadData(currentPage, search)
  }, [currentPage, search, rol])

  const loadData = async (page: number, query: string) => {
    setLoading(true)
    try {
      if (query.length >= 2) {
        const { data, count } = await buscarPerfilesPaginados(query, page, pageSize)
        setPerfiles(data as Perfil[])
        setTotalPages(Math.max(1, Math.ceil(count / pageSize)))
      } else {
        const { data, count } = await obtenerPerfilesPaginados(page, pageSize)
        setPerfiles(data as Perfil[])
        setTotalPages(Math.max(1, Math.ceil(count / pageSize)))
      }
    } catch { toast.error('Error al cargar legajos') }
    finally { setLoading(false) }
  }

  const cargarRoles = async () => {
    try {
      const data = await obtenerRoles()
      const parsed = (data as Rol[]) ?? []
      setRoles(parsed.length > 0 ? parsed : fallbackRoles)
      if (parsed.length === 0) {
        toast.error('No se encontraron roles, usando valores por defecto')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al cargar roles'
      toast.error(message)
      setRoles(fallbackRoles)
    }
  }

  const startCreate = () => {
    setSelected(null)
    setFormMode('create')
    reset({
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

  const startEdit = (perfil: Perfil) => {
    setSelected(perfil)
    setFormMode('edit')
    reset({
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

  const onSubmit = async (data: PerfilFormData) => {
    try {
      if (formMode === 'create') {
        await crearPerfil(data)
        toast.success('Legajo creado')
      } else if (formMode === 'edit' && selected) {
        await actualizarPerfil(selected.id, data)
        toast.success('Legajo actualizado')
      }
      setFormMode(null)
      setSelected(null)
      await loadData(currentPage, search)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo guardar el legajo'
      toast.error(message)
    }
  }

  const handleDelete = async () => {
    if (!deleteConfirm) return
    setIsDeleting(true)
    try {
      await eliminarPerfil(deleteConfirm.id)
      toast.success(`Legajo de ${deleteConfirm.nombre} ${deleteConfirm.apellido} eliminado`)
      setDeleteConfirm(null)
      setSelected(null)
      await loadData(currentPage, search)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo eliminar el legajo'
      toast.error(message)
    } finally {
      setIsDeleting(false)
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
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 h-10 pr-3 rounded-lg border border-neutral-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 bg-white"
            aria-label="Buscar legajos"
          />
        </div>
        <Button type="button" variant="accent" onClick={startCreate}>Nuevo legajo</Button>
      </div>

      {formMode && (
        <div className="bg-white rounded-2xl border border-brand-200 p-6 space-y-4">
          <div className="flex items-start justify-between">
            <h2 className="font-bold text-neutral-900">
              {formMode === 'create' ? 'Crear legajo' : 'Editar legajo'}
            </h2>
            <button onClick={() => setFormMode(null)} className="text-neutral-400 hover:text-neutral-600 text-sm">
              Cerrar
            </button>
          </div>
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
            <div className="grid sm:grid-cols-2 gap-4">
              <Input label="Nombre" required {...register('nombre')} error={errors.nombre?.message} />
              <Input label="Apellido" required {...register('apellido')} error={errors.apellido?.message} />
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <Input label="DNI" required {...register('dni')} error={errors.dni?.message} />
              <Select
                label="Rol"
                required
                placeholder="Seleccionar rol"
                options={roles.map((rol) => ({ value: rol.id, label: rol.nombre }))}
                {...register('rol_id', { valueAsNumber: true })}
                error={errors.rol_id?.message}
              />
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <Input
                label="Fecha de nacimiento"
                type="date"
                {...register('fecha_nacimiento', { setValueAs: (value) => (value ? value : undefined) })}
                error={errors.fecha_nacimiento?.message}
              />
              <Input
                label="Teléfono"
                {...register('telefono', { setValueAs: (value) => (value ? value : undefined) })}
                error={errors.telefono?.message}
              />
            </div>
            <Input label="Dirección" {...register('direccion')} error={errors.direccion?.message} />
            <Input
              label="Legajo N°"
              {...register('legajo_nro', { setValueAs: (value) => (value ? value : undefined) })}
              error={errors.legajo_nro?.message}
            />
            <div className="flex gap-3 justify-end">
              <Button type="button" variant="ghost" onClick={() => setFormMode(null)}>Cancelar</Button>
              <Button type="submit" loading={isSubmitting}>
                {formMode === 'create' ? 'Crear legajo' : 'Guardar cambios'}
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
                {['Persona', 'DNI', 'Legajo', 'Rol', 'Teléfono', 'Alta'].map((col) => (
                  <th key={col} className="text-left px-5 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {loading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 6 }).map((_, j) => (
                        <td key={j} className="px-5 py-3"><Skeleton className="h-4 w-full" /></td>
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
                      onClick={() => setSelected(p === selected ? null : p)}
                      aria-selected={selected?.id === p.id}
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
                          <Badge variant={rolVariant[p.rol.nombre] ?? 'default'}>
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

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-neutral-500">
            Página {currentPage} de {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
            >
              Anterior
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
            >
              Siguiente
            </Button>
          </div>
        </div>
      )}

      {/* Selected profile detail drawer-like */}
      {selected && (
        <div className="bg-white rounded-2xl border border-brand-200 p-6 space-y-4">
          <div className="flex items-start justify-between">
            <h2 className="font-bold text-neutral-900">
              Legajo: {selected.apellido}, {selected.nombre}
            </h2>
          <div className="flex items-center gap-3">
              {rol === 'DIRECTOR' && (
                <button
                  onClick={() => setDeleteConfirm(selected)}
                  className="flex items-center gap-1.5 text-sm font-semibold text-red-500 hover:text-red-700 transition-colors"
                >
                  <Trash size={15} weight="fill" />
                  Eliminar
                </button>
              )}
              <button onClick={() => startEdit(selected)} className="text-sm font-semibold text-brand-600 hover:text-brand-800">
                Editar
              </button>
              <button onClick={() => setSelected(null)} className="text-neutral-400 hover:text-neutral-600 text-sm">
                Cerrar
              </button>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
            {[
              ['DNI', selected.dni],
              ['Legajo N°', selected.legajo_nro ?? 'No asignado'],
              ['Rol', selected.rol?.nombre ?? '—'],
              ['Teléfono', selected.telefono ?? '—'],
              ['Dirección', selected.direccion ?? '—'],
              ['Fecha de nacimiento', selected.fecha_nacimiento ? formatFecha(selected.fecha_nacimiento) : '—'],
            ].map(([label, val]) => (
              <div key={label} className="space-y-1">
                <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">{label}</p>
                <p className="text-neutral-800 font-medium">{val}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal de confirmación de eliminación */}
      {deleteConfirm && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Confirmar eliminación"
        >
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-5">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center shrink-0">
                <Warning size={20} weight="fill" className="text-red-600" />
              </div>
              <div>
                <h3 className="font-bold text-neutral-900 text-lg">Eliminar legajo</h3>
                <p className="text-neutral-600 text-sm mt-1">
                  ¿Estás seguro que querés eliminar el legajo de{' '}
                  <strong>{deleteConfirm.nombre} {deleteConfirm.apellido}</strong>?
                  Esta acción no se puede deshacer.
                </p>
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setDeleteConfirm(null)}
                disabled={isDeleting}
              >
                Cancelar
              </Button>
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                <Trash size={15} weight="fill" />
                {isDeleting ? 'Eliminando...' : 'Sí, eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
