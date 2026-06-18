'use client'

import Link from 'next/link'
import { CalendarCheck, Users, Pulse, FileText, ArrowRight, Briefcase, ChatCenteredText, UserPlus } from '@phosphor-icons/react'
import { useAuth } from '@/context/AuthContext'

const quickLinks = [
  {
    href: '/dashboard/asistencias',
    label: 'Asistencias',
    desc: 'Registrar asistencia del día',
    icon: CalendarCheck,
    color: 'bg-brand-50 text-brand-600',
    roles: ['DIRECTOR', 'DOCENTE', 'PADRE', 'ESTUDIANTE'],
  },
  {
    href: '/dashboard/usuarios',
    label: 'Usuarios',
    desc: 'Crear cuentas y asignar roles',
    icon: UserPlus,
    color: 'bg-brand-50 text-brand-600',
    roles: ['DIRECTOR'],
  },
  {
    href: '/dashboard/legajos',
    label: 'Legajos',
    desc: 'Ver y gestionar perfiles',
    icon: Users,
    color: 'bg-green-50 text-green-600',
    roles: ['DIRECTOR'],
  },
  {
    href: '/dashboard/cupos',
    label: 'Cupos',
    desc: 'Disponibilidad de actividades',
    icon: Pulse,
    color: 'bg-amber-50 text-amber-600',
    roles: ['DIRECTOR', 'DOCENTE'],
  },
  {
    href: '/dashboard/solicitudes',
    label: 'Solicitudes',
    desc: 'Pre-inscripciones pendientes',
    icon: FileText,
    color: 'bg-purple-50 text-purple-600',
    roles: ['DIRECTOR'],
  },
  {
    href: '/dashboard/postulaciones',
    label: 'Postulaciones',
    desc: 'Solicitudes de empleo',
    icon: Briefcase,
    color: 'bg-amber-50 text-amber-700',
    roles: ['DIRECTOR'],
  },
  {
    href: '/dashboard/testimonios',
    label: 'Testimonios',
    desc: 'Moderacion de opiniones',
    icon: ChatCenteredText,
    color: 'bg-brand-50 text-brand-700',
    roles: ['DIRECTOR'],
  },
]

export default function DashboardPage() {
  const { rol } = useAuth()
  const visibleLinks = quickLinks.filter((link) => (rol ? link.roles.includes(rol) : false))

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-extrabold text-neutral-900 tracking-tight">
          Panel de gestión
        </h1>
        <p className="text-neutral-500 text-sm mt-1">
          Bienvenido al sistema de gestión educativa Educar para Transformar
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {visibleLinks.map((link) => {
          const Icon = link.icon
          return (
            <Link
              key={link.href}
              href={link.href}
              className="group flex items-center gap-4 p-5 bg-white rounded-2xl border border-neutral-200 hover:border-brand-300 hover:shadow-sm transition-all duration-200"
            >
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${link.color} shrink-0`}>
                <Icon size={24} weight="fill" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-neutral-900 text-sm">{link.label}</p>
                <p className="text-xs text-neutral-500 mt-0.5">{link.desc}</p>
              </div>
              <ArrowRight size={16} className="text-neutral-300 group-hover:text-brand-500 group-hover:translate-x-0.5 transition-all duration-150" />
            </Link>
          )
        })}
      </div>

    </div>
  )
}
