'use client'

import { useEffect, useState, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { UserPlus, Users } from '@phosphor-icons/react'
import { obtenerRoles } from '@/services/roles.service'
import { obtenerPerfiles } from '@/services/perfiles.service'
import { crearUsuario } from '@/services/usuarios.service'
import { Input, Select } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Badge, Skeleton } from '@/components/ui/Badge'
import { useAuth } from '@/context/AuthContext'

const soloLetras = /^[a-zA-ZÀ-ÿ\s'-]+$/

const usuarioSchema = z.object({
  nombre: z.string().min(2, 'Mínimo 2 caracteres').max(100).regex(soloLetras, 'Solo letras y espacios'),
  apellido: z.string().min(2, 'Mínimo 2 caracteres').max(100).regex(soloLetras, 'Solo letras y espacios'),
  dni: z.string().regex(/^\d{7,8}$/, 'DNI de 7 u 8 dígitos'),
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
  user_id: string | null
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
  const [loading, setLoading] = useState(true)

  const {
    register, handleSubmit, reset,
    formState: { errors, isSubmitting },
  } = useForm<UsuarioForm>({ resolver: zodResolver(usuarioSchema), mode: 'onTouched' })

  const cargar = useCallback(async () => {
    setLoading(true)
    try {
      const [rolesData, perfilesData] = await Promise.all([obtenerRoles(), obtenerPerfiles()])
      setRoles((rolesData ?? []) as Rol[])
      setPerfiles((perfilesData ?? []) as PerfilRow[])
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

  const onSubmit = async (data: UsuarioForm) => {
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
          Creá cuentas de acceso (docentes, padres, alumnos, personal) y asignales su rol.
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
            <Input label="Contraseña" type="text" required placeholder="Mínimo 6 caracteres" {...register('password')} error={errors.password?.message} helperText="El usuario podrá cambiarla luego" />
          </div>
          <div className="grid sm:grid-cols-3 gap-4">
            <Input label="Teléfono (opcional)" placeholder="0362 4123456" {...register('telefono')} error={errors.telefono?.message} />
            <Input label="Dirección (opcional)" placeholder="Av. Belgrano 1234" {...register('direccion')} error={errors.direccion?.message} />
            <Input label="Legajo (opcional)" placeholder="2027-0001" {...register('legajo_nro')} error={errors.legajo_nro?.message} />
          </div>
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
                {['Nombre', 'DNI', 'Rol', 'Legajo', 'Acceso'].map((col) => (
                  <th key={col} className="text-left px-5 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {loading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 5 }).map((_, j) => (
                        <td key={j} className="px-5 py-3"><Skeleton className="h-4 w-full" /></td>
                      ))}
                    </tr>
                  ))
                : perfiles.length === 0
                  ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-12 text-center text-neutral-400 text-sm">
                        No hay usuarios registrados
                      </td>
                    </tr>
                  )
                  : perfiles.map((p) => (
                    <tr key={p.id} className="hover:bg-neutral-50 transition-colors">
                      <td className="px-5 py-3 font-medium text-neutral-900">{p.apellido}, {p.nombre}</td>
                      <td className="px-5 py-3 text-neutral-500 font-mono text-xs">{p.dni}</td>
                      <td className="px-5 py-3">
                        <Badge variant={rolBadge[p.rol?.nombre ?? ''] ?? 'default'}>
                          {p.rol?.nombre ?? '—'}
                        </Badge>
                      </td>
                      <td className="px-5 py-3 text-neutral-500 font-mono text-xs">{p.legajo_nro ?? '—'}</td>
                      <td className="px-5 py-3">
                        {p.user_id
                          ? <span className="text-xs text-green-600 font-semibold">Con acceso</span>
                          : <span className="text-xs text-neutral-400">Sin acceso</span>}
                      </td>
                    </tr>
                  ))
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
