'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { UserPlus, Users, Warning, PencilSimple, X } from '@phosphor-icons/react'
import { obtenerRoles } from '@/services/roles.service'
import { obtenerPerfiles, actualizarPerfil } from '@/services/perfiles.service'
import {
  crearUsuario, obtenerRelacionesFamiliares, VINCULO_PARENTAL_NO_DISPONIBLE,
  type RelacionFamiliar,
} from '@/services/usuarios.service'
import { Input, Select } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Badge, Skeleton } from '@/components/ui/Badge'
import { useAuth } from '@/context/AuthContext'

const soloLetras = /^[a-zA-ZÀ-ÿ\s'-]+$/
const longitudMinimaNombre = 2
const longitudMaximaNombre = 100
const patronDni = /^\d{7,8}$/
const mensajeDniInvalido = 'DNI de 7 u 8 dígitos'

const usuarioSchema = z.object({
  nombre: z.string().min(longitudMinimaNombre, 'Mínimo 2 caracteres').max(longitudMaximaNombre).regex(soloLetras, 'Solo letras y espacios'),
  apellido: z.string().min(longitudMinimaNombre, 'Mínimo 2 caracteres').max(longitudMaximaNombre).regex(soloLetras, 'Solo letras y espacios'),
  dni: z.string().regex(patronDni, mensajeDniInvalido),
  email: z.string().min(1, 'El email es requerido').email('Email inválido'),
  password: z.string().min(6, 'Mínimo 6 caracteres'),
  rol_id: z.string().min(1, 'Seleccioná un rol'),
  telefono: z.string().optional(),
  direccion: z.string().optional(),
  legajo_nro: z.string().optional(),
})
type UsuarioForm = z.infer<typeof usuarioSchema>

type Rol = { id: number; nombre: string }
type PerfilRow = {
  id: string
  nombre: string
  apellido: string
  dni: string
  legajo_nro: string | null
  telefono: string | null
  direccion: string | null
  user_id: string | null
  rol_id: number | null
  rol: { nombre: string } | null
}

const rolBadge: Record<string, 'info' | 'success' | 'warning' | 'default'> = {
  DIRECTOR: 'info',
  DOCENTE: 'success',
  ESTUDIANTE: 'warning',
  PADRE: 'default',
  PERSONAL: 'default',
}

export default function UsuariosPage() {
  const { rol } = useAuth()
  const [roles, setRoles] = useState<Rol[]>([])
  const [perfiles, setPerfiles] = useState<PerfilRow[]>([])
  const [relaciones, setRelaciones] = useState<RelacionFamiliar[]>([])
  const [loading, setLoading] = useState(true)
  const [mostrarPass, setMostrarPass] = useState(false)

  // --- Estado del modal de edición ---
  const [editando, setEditando] = useState<PerfilRow | null>(null)
  const [editForm, setEditForm] = useState({ nombre: '', apellido: '', dni: '', telefono: '', direccion: '', legajo_nro: '' })
  const [editRolId, setEditRolId] = useState<string>('')
  const [guardando, setGuardando] = useState(false)

  const {
    register, handleSubmit, reset, watch,
    formState: { errors, isSubmitting },
  } = useForm<UsuarioForm>({ resolver: zodResolver(usuarioSchema), mode: 'onTouched' })

  const rolIdSel = watch('rol_id')
  const rolNombreSel = roles.find((r) => String(r.id) === rolIdSel)?.nombre

  const cargar = useCallback(async () => {
    setLoading(true)
    try {
      const [rolesData, perfilesData, relacionesData] = await Promise.all([
        obtenerRoles(), obtenerPerfiles(), obtenerRelacionesFamiliares(),
      ])
      setRoles((rolesData ?? []) as Rol[])
      setPerfiles((perfilesData ?? []) as PerfilRow[])
      setRelaciones(relacionesData)
    } catch {
      toast.error('Error al cargar los datos')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (rol && rol !== 'DIRECTOR') return
    cargar()
  }, [rol, cargar])

  const perfilesById = useMemo(() => {
    const m: Record<string, PerfilRow> = {}
    perfiles.forEach((p) => { m[p.id] = p })
    return m
  }, [perfiles])

  const hijosDeUnPadre = useMemo(() => {
    const m: Record<string, string[]> = {}
    relaciones.forEach((rel) => { (m[rel.padre_id] ??= []).push(rel.hijo_id) })
    return m
  }, [relaciones])
  const tutoresDeUnHijo = useMemo(() => {
    const m: Record<string, string[]> = {}
    relaciones.forEach((rel) => { (m[rel.hijo_id] ??= []).push(rel.padre_id) })
    return m
  }, [relaciones])

  const onSubmit = async (data: UsuarioForm) => {
    // El tutor no es requisito para dar de alta a un alumno (EPT-9), y el
    // vínculo parental no se envía: `padres_hijos` no existe en el esquema
    // versionado y la API lo rechaza antes de escribir nada.
    try {
      await crearUsuario({
        email: data.email,
        password: data.password,
        nombre: data.nombre,
        apellido: data.apellido,
        dni: data.dni,
        rol_id: Number(data.rol_id),
        telefono: data.telefono,
        direccion: data.direccion,
        legajo_nro: data.legajo_nro,
      })
      toast.success(`Usuario creado: ${data.email}`)
      reset()
      await cargar()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo crear el usuario'
      toast.error(message)
    }
  }

  // --- Edición ---
  const abrirEdicion = (p: PerfilRow) => {
    setEditando(p)
    setEditForm({
      nombre: p.nombre, apellido: p.apellido, dni: p.dni,
      telefono: p.telefono ?? '', direccion: p.direccion ?? '', legajo_nro: p.legajo_nro ?? '',
    })
    setEditRolId(p.rol_id ? String(p.rol_id) : '')
  }

  const editRolNombre = roles.find((r) => String(r.id) === editRolId)?.nombre

  const guardarEdicion = async () => {
    if (!editando) return
    if (!soloLetras.test(editForm.nombre) || editForm.nombre.trim().length < longitudMinimaNombre) { toast.error('Nombre inválido'); return }
    if (!soloLetras.test(editForm.apellido) || editForm.apellido.trim().length < longitudMinimaNombre) { toast.error('Apellido inválido'); return }
    if (!patronDni.test(editForm.dni)) { toast.error(mensajeDniInvalido); return }
    if (!editRolId) { toast.error('Seleccioná un rol'); return }

    setGuardando(true)
    try {
      await actualizarPerfil(editando.id, {
        nombre: editForm.nombre.trim(),
        apellido: editForm.apellido.trim(),
        dni: editForm.dni.trim(),
        telefono: editForm.telefono.trim() || null,
        direccion: editForm.direccion.trim() || null,
        legajo_nro: editForm.legajo_nro.trim() || null,
        rol_id: Number(editRolId),
      })

      // No se sincroniza ningún vínculo parental: la escritura sobre
      // `padres_hijos` se retiró porque la tabla no existe en las migraciones.
      toast.success('Usuario actualizado')
      setEditando(null)
      await cargar()
    } catch (error) {
      const m = error instanceof Error ? error.message : ''
      toast.error(m.includes('perfiles_dni') ? 'Ya existe una persona con ese DNI.' : (m || 'No se pudo actualizar'))
    } finally {
      setGuardando(false)
    }
  }

  if (rol && rol !== 'DIRECTOR') {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-6 text-sm text-yellow-800">
          Acceso restringido. Solo el director puede gestionar usuarios.
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-neutral-900 tracking-tight">Gestión de usuarios</h1>
        <p className="text-neutral-500 text-sm mt-0.5">
          Creá cuentas de acceso (docentes, padres, alumnos, personal), asignales su rol y mantené sus datos.
        </p>
      </div>

      {/* Formulario de creación */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-6">
        <div className="flex items-center gap-2 mb-5">
          <UserPlus size={20} weight="fill" className="text-brand-500" />
          <h2 className="font-bold text-neutral-900">Nuevo usuario</h2>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <Input label="Nombre" required placeholder="María" {...register('nombre')} error={errors.nombre?.message} />
            <Input label="Apellido" required placeholder="González" {...register('apellido')} error={errors.apellido?.message} />
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <Input label="DNI" required placeholder="28456123" maxLength={8} {...register('dni')} error={errors.dni?.message} />
            <Select
              label="Rol"
              required
              placeholder="Seleccionar rol..."
              options={roles.map((r) => ({ value: r.id, label: r.nombre }))}
              {...register('rol_id')}
              error={errors.rol_id?.message}
            />
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <Input label="Email" type="email" required placeholder="usuario@ejemplo.com" {...register('email')} error={errors.email?.message} />
            <div>
              <Input
                label="Contraseña"
                type={mostrarPass ? 'text' : 'password'}
                required
                placeholder="Mínimo 6 caracteres"
                {...register('password')}
                error={errors.password?.message}
              />
              <label className="flex items-center gap-1.5 mt-1.5 text-xs text-neutral-500 cursor-pointer w-fit">
                <input type="checkbox" checked={mostrarPass} onChange={(e) => setMostrarPass(e.target.checked)} className="w-3.5 h-3.5 accent-brand-500" />
                Mostrar contraseña
              </label>
            </div>
          </div>
          <div className="grid sm:grid-cols-3 gap-4">
            <Input label="Teléfono (opcional)" placeholder="0362 4123456" {...register('telefono')} error={errors.telefono?.message} />
            <Input label="Dirección (opcional)" placeholder="Av. Belgrano 1234" {...register('direccion')} error={errors.direccion?.message} />
            <Input label="Legajo (opcional)" placeholder="2027-0001" {...register('legajo_nro')} error={errors.legajo_nro?.message} />
          </div>

          {/* Vínculo parental: pertenece a EPT-13 y todavía no tiene migración. */}
          {(rolNombreSel === 'PADRE' || rolNombreSel === 'ESTUDIANTE') && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex gap-3 items-start">
              <Warning size={18} weight="fill" className="text-amber-600 shrink-0 mt-0.5" />
              <div className="text-sm text-amber-800">
                <p className="font-semibold">{VINCULO_PARENTAL_NO_DISPONIBLE}</p>
                <p className="mt-1 text-amber-700">
                  Podés crear la cuenta igual: el vínculo no es requisito. La situación
                  académica del alumno se administra desde Alumnos.
                </p>
              </div>
            </div>
          )}

          <div className="flex justify-end pt-2">
            <Button type="submit" loading={isSubmitting}>
              <UserPlus size={16} weight="fill" />
              Crear usuario
            </Button>
          </div>
        </form>
      </div>

      {/* Listado de usuarios */}
      <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-neutral-100 flex items-center gap-2">
          <Users size={18} weight="fill" className="text-neutral-400" />
          <h2 className="font-bold text-neutral-900 text-sm">
            Usuarios registrados {!loading && `(${perfiles.length})`}
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="Usuarios registrados">
            <thead>
              <tr className="bg-neutral-50 border-b border-neutral-100">
                {['Nombre', 'DNI', 'Rol', 'Vínculo familiar', 'Acceso', ''].map((col, i) => (
                  <th key={i} className="text-left px-5 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {loading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 6 }).map((_, j) => (
                        <td key={j} className="px-5 py-3"><Skeleton className="h-4 w-full" /></td>
                      ))}
                    </tr>
                  ))
                : perfiles.length === 0
                  ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-12 text-center text-neutral-400 text-sm">
                        No hay usuarios registrados
                      </td>
                    </tr>
                  )
                  : perfiles.map((p) => {
                    const esEstudiante = p.rol?.nombre === 'ESTUDIANTE'
                    const esPadre = p.rol?.nombre === 'PADRE'
                    const tutores = (tutoresDeUnHijo[p.id] ?? []).map((id) => perfilesById[id]).filter(Boolean)
                    const hijos = (hijosDeUnPadre[p.id] ?? []).map((id) => perfilesById[id]).filter(Boolean)
                    return (
                      <tr key={p.id} className="hover:bg-neutral-50 transition-colors">
                        <td className="px-5 py-3 font-medium text-neutral-900">{p.apellido}, {p.nombre}</td>
                        <td className="px-5 py-3 text-neutral-500 font-mono text-xs">{p.dni}</td>
                        <td className="px-5 py-3">
                          <Badge variant={rolBadge[p.rol?.nombre ?? ''] ?? 'default'}>{p.rol?.nombre ?? '—'}</Badge>
                        </td>
                        <td className="px-5 py-3 text-xs">
                          {esPadre && (
                            hijos.length > 0
                              ? <span className="text-neutral-600">{hijos.map((h) => h.nombre).join(', ')}</span>
                              : <span className="inline-flex items-center gap-1 text-red-500"><Warning size={12} weight="fill" />Sin hijos</span>
                          )}
                          {esEstudiante && (
                            tutores.length > 0
                              ? <span className="text-neutral-600">Tutor: {tutores.map((t) => t.nombre).join(', ')}</span>
                              : <span className="inline-flex items-center gap-1 text-amber-600"><Warning size={12} weight="fill" />Sin tutor</span>
                          )}
                          {!esPadre && !esEstudiante && <span className="text-neutral-300">—</span>}
                        </td>
                        <td className="px-5 py-3">
                          {p.user_id
                            ? <span className="text-xs text-green-600 font-semibold">Con acceso</span>
                            : <span className="text-xs text-neutral-400">Sin acceso</span>}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <button
                            onClick={() => abrirEdicion(p)}
                            className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-800 hover:bg-brand-50 px-2.5 py-1.5 rounded-lg transition-colors"
                          >
                            <PencilSimple size={14} />
                            Editar
                          </button>
                        </td>
                      </tr>
                    )
                  })
              }
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal de edición */}
      {editando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8 overflow-y-auto">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setEditando(null)} aria-hidden="true" />
          <div className="relative w-full max-w-lg bg-white rounded-2xl border border-neutral-200 shadow-xl my-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-100">
              <h3 className="font-bold text-neutral-900">Editar usuario</h3>
              <button onClick={() => setEditando(null)} className="text-neutral-400 hover:text-neutral-600 p-1 rounded-lg hover:bg-neutral-100">
                <X size={18} />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="grid sm:grid-cols-2 gap-4">
                <Input label="Nombre" value={editForm.nombre} onChange={(e) => setEditForm((f) => ({ ...f, nombre: e.target.value }))} />
                <Input label="Apellido" value={editForm.apellido} onChange={(e) => setEditForm((f) => ({ ...f, apellido: e.target.value }))} />
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <Input label="DNI" maxLength={8} value={editForm.dni} onChange={(e) => setEditForm((f) => ({ ...f, dni: e.target.value }))} />
                <Select
                  label="Rol"
                  placeholder="Seleccionar rol..."
                  options={roles.map((r) => ({ value: r.id, label: r.nombre }))}
                  value={editRolId}
                  onChange={(e) => setEditRolId(e.target.value)}
                />
              </div>
              <div className="grid sm:grid-cols-3 gap-4">
                <Input label="Teléfono" value={editForm.telefono} onChange={(e) => setEditForm((f) => ({ ...f, telefono: e.target.value }))} />
                <Input label="Dirección" value={editForm.direccion} onChange={(e) => setEditForm((f) => ({ ...f, direccion: e.target.value }))} />
                <Input label="Legajo" value={editForm.legajo_nro} onChange={(e) => setEditForm((f) => ({ ...f, legajo_nro: e.target.value }))} />
              </div>

              {/* Vínculo parental: pertenece a EPT-13 y todavía no tiene migración. */}
              {(editRolNombre === 'PADRE' || editRolNombre === 'ESTUDIANTE') && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex gap-3 items-start">
                  <Warning size={18} weight="fill" className="text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-sm text-amber-800">
                    {VINCULO_PARENTAL_NO_DISPONIBLE} Los datos personales y el rol sí se guardan.
                  </p>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 px-6 py-4 border-t border-neutral-100">
              <Button variant="ghost" onClick={() => setEditando(null)}>Cancelar</Button>
              <Button onClick={guardarEdicion} loading={guardando}>Guardar cambios</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
