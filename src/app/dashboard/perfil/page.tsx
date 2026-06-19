'use client'

import { useAuth } from '@/context/AuthContext'
import { Badge, Skeleton } from '@/components/ui/Badge'
import { IdentificationCard, Phone, MapPin, Hash, Calendar, EnvelopeSimple, GraduationCap } from '@phosphor-icons/react'

export default function PerfilPage() {
  const { perfil, user, rol, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    )
  }

  if (!perfil) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-6 text-sm text-yellow-800">
          No encontramos los datos de tu perfil. Contactá al administrador.
        </div>
      </div>
    )
  }

  const datos: { label: string; value: string; icon: React.ElementType }[] = [
    { label: 'DNI', value: perfil.dni || '—', icon: IdentificationCard },
    { label: 'Teléfono', value: perfil.telefono || '—', icon: Phone },
    { label: 'Dirección', value: perfil.direccion || '—', icon: MapPin },
    { label: 'Legajo', value: perfil.legajo_nro || '—', icon: Hash },
    { label: 'Email', value: user?.email || '—', icon: EnvelopeSimple },
    { label: 'Fecha de nacimiento', value: perfil.fecha_nacimiento || '—', icon: Calendar },
  ]

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-neutral-900 tracking-tight">Mi perfil</h1>
        <p className="text-neutral-500 text-sm mt-0.5">Estos son tus datos personales registrados en el legajo.</p>
      </div>

      {/* Encabezado */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-6 flex items-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-brand-100 flex items-center justify-center text-brand-600 font-extrabold text-xl shrink-0">
          {perfil.nombre?.[0]}{perfil.apellido?.[0]}
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-neutral-900 truncate">{perfil.nombre} {perfil.apellido}</h2>
          <div className="mt-1 flex items-center gap-2">
            <GraduationCap size={14} className="text-neutral-400" />
            <Badge variant="info">{rol ?? '—'}</Badge>
          </div>
        </div>
      </div>

      {/* Datos */}
      <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-neutral-100">
          <h3 className="font-bold text-neutral-900 text-sm">Datos personales</h3>
        </div>
        <dl className="divide-y divide-neutral-100">
          {datos.map(({ label, value, icon: Icon }) => (
            <div key={label} className="flex items-center gap-4 px-6 py-3.5">
              <div className="w-9 h-9 rounded-lg bg-neutral-100 flex items-center justify-center shrink-0">
                <Icon size={18} className="text-neutral-500" />
              </div>
              <dt className="text-sm text-neutral-500 w-40 shrink-0">{label}</dt>
              <dd className="text-sm font-medium text-neutral-900 break-words">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <p className="text-xs text-neutral-400 text-center">
        Si algún dato es incorrecto, comunicate con la administración del centro educativo.
      </p>
    </div>
  )
}
