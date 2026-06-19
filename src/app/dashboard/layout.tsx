'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  House, Users, CalendarCheck, Pulse, FileText,
  SignOut, List, X, Briefcase, ChatCenteredText, UserPlus, Lock,
  Newspaper, UserCircle
} from '@phosphor-icons/react'
import { useAuth } from '@/context/AuthContext'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'

interface NavItem {
  href: string
  label: string
  icon: React.ElementType
  roles: string[]
}

const navItems: NavItem[] = [
  { href: '/dashboard', label: 'Inicio', icon: House, roles: ['DIRECTOR', 'DOCENTE', 'PADRE', 'ESTUDIANTE'] },
  { href: '/dashboard/usuarios', label: 'Usuarios', icon: UserPlus, roles: ['DIRECTOR'] },
  { href: '/dashboard/legajos', label: 'Legajos', icon: Users, roles: ['DIRECTOR'] },
  { href: '/dashboard/asistencias', label: 'Asistencias', icon: CalendarCheck, roles: ['DIRECTOR', 'DOCENTE', 'PADRE', 'ESTUDIANTE'] },
  { href: '/dashboard/cupos', label: 'Actividades', icon: Pulse, roles: ['DIRECTOR', 'DOCENTE', 'ESTUDIANTE'] },
  { href: '/dashboard/solicitudes', label: 'Solicitudes', icon: FileText, roles: ['DIRECTOR'] },
  { href: '/dashboard/postulaciones', label: 'Postulaciones', icon: Briefcase, roles: ['DIRECTOR'] },
  { href: '/dashboard/testimonios', label: 'Testimonios', icon: ChatCenteredText, roles: ['DIRECTOR'] },
  { href: '/dashboard/perfil', label: 'Mi perfil', icon: UserCircle, roles: ['DIRECTOR', 'DOCENTE', 'PADRE', 'ESTUDIANTE'] },
]

// Barra de navegación inferior (móvil): Asistencias, Noticias, Perfil
const bottomNavItems = [
  { href: '/dashboard/asistencias', label: 'Asistencias', icon: CalendarCheck },
  { href: '/noticias', label: 'Noticias', icon: Newspaper },
  { href: '/dashboard/perfil', label: 'Perfil', icon: UserCircle },
]

// Determina si el rol actual puede ver la ruta del dashboard.
// Si la ruta está restringida y el rol no corresponde, la página ni se monta.
function rutaPermitida(pathname: string, rol: string | null): boolean {
  if (pathname === '/dashboard') return true // el índice es para todos los roles
  const match = navItems
    .filter((it) => it.href !== '/dashboard' && (pathname === it.href || pathname.startsWith(it.href + '/')))
    .sort((a, b) => b.href.length - a.href.length)[0]
  if (!match) return true // ruta sin restricción conocida
  return rol ? match.roles.includes(rol) : false
}

function SidebarContent({ onClose, onSignOut }: { onClose?: () => void; onSignOut: () => void }) {
  const pathname = usePathname()
  const { perfil, rol } = useAuth()

  const visibleItems = navItems.filter((item) =>
    rol ? item.roles.includes(rol) : false
  )

  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-neutral-100">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-emblema.png" alt="Educar para Transformar" className="w-10 h-10 object-contain shrink-0" />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-neutral-500 truncate">Educar para</p>
          <p className="text-sm font-bold text-brand-700 truncate">Transformar</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5" aria-label="Menú del dashboard">
        {visibleItems.map((item) => {
          const Icon = item.icon
          const active = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150',
                active
                  ? 'bg-brand-50 text-brand-700 font-semibold'
                  : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
              )}
              aria-current={active ? 'page' : undefined}
            >
              <Icon size={18} weight={active ? 'fill' : 'regular'} />
              {item.label}
            </Link>
          )
        })}
      </nav>

      {/* User info */}
      <div className="px-3 py-4 border-t border-neutral-100">
        {perfil && (
          <div className="flex items-center gap-3 px-3 py-2 mb-2">
            <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-brand-600 font-bold text-sm shrink-0">
              {perfil.nombre[0]}{perfil.apellido[0]}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-neutral-900 truncate">
                {perfil.nombre} {perfil.apellido}
              </p>
              <p className="text-xs text-neutral-400 truncate">{rol}</p>
            </div>
          </div>
        )}
        <button
          onClick={onSignOut}
          className="flex items-center gap-2.5 px-3 py-2 w-full rounded-xl text-sm text-neutral-600 hover:bg-red-50 hover:text-red-600 transition-colors duration-150"
        >
          <SignOut size={16} />
          Cerrar sesión
        </button>
      </div>
    </div>
  )
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const { perfil, rol, isLoading, user, signOut } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const [headerHidden, setHeaderHidden] = useState(false)

  const permitido = rutaPermitida(pathname, rol)

  useEffect(() => {
    if (!isLoading && !user) {
      const redirect = pathname.startsWith('/dashboard') ? pathname : '/dashboard'
      router.replace(`/login?redirect=${encodeURIComponent(redirect)}`)
    }
  }, [isLoading, user, pathname, router])

  useEffect(() => {
    let lastY = window.scrollY
    const handler = () => {
      const currentY = window.scrollY
      if (currentY > 80 && currentY > lastY) setHeaderHidden(true)
      else setHeaderHidden(false)
      lastY = currentY
    }
    window.addEventListener('scroll', handler, { passive: true })
    return () => window.removeEventListener('scroll', handler)
  }, [])

  const handleSignOut = async () => {
    await signOut()
    router.push('/')
    router.refresh()
  }

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-neutral-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-3 border-brand-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-neutral-500 font-medium">Cargando...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-[100dvh] bg-neutral-50">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-60 bg-white border-r border-neutral-200 fixed top-0 bottom-0 left-0">
        <SidebarContent onSignOut={handleSignOut} />
      </aside>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-black/30 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative w-60 bg-white border-r border-neutral-200 flex flex-col">
            <button
              className="absolute top-4 right-4 p-1.5 rounded-lg text-neutral-500 hover:bg-neutral-100"
              onClick={() => setMobileOpen(false)}
              aria-label="Cerrar menú"
            >
              <X size={18} />
            </button>
            <SidebarContent onClose={() => setMobileOpen(false)} onSignOut={handleSignOut} />
          </aside>
        </div>
      )}

      {/* Main */}
      <div className="flex-1 lg:ml-60 flex flex-col min-h-[100dvh]">
        {/* Top bar */}
        <header
          className={cn(
            'h-14 bg-white border-b border-neutral-200 flex items-center justify-between px-4 lg:px-6 sticky top-0 z-40 transition-transform duration-300',
            headerHidden ? '-translate-y-full' : 'translate-y-0'
          )}
        >
          <button
            className="lg:hidden p-2 rounded-lg text-neutral-500 hover:bg-neutral-100"
            onClick={() => setMobileOpen(true)}
            aria-label="Abrir menú"
          >
            <List size={20} />
          </button>
          <div className="flex items-center gap-2 ml-auto">
            <Link href="/" className="text-xs text-neutral-500 hover:text-neutral-700 transition-colors">
              Ver sitio web
            </Link>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-8 pb-24 lg:pb-8">
          {permitido ? children : (
            <div className="max-w-md mx-auto mt-12 text-center">
              <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-4">
                <Lock size={32} weight="fill" className="text-red-500" />
              </div>
              <h1 className="text-xl font-extrabold text-neutral-900 tracking-tight">Acceso restringido</h1>
              <p className="text-neutral-500 text-sm mt-2">
                No tenés permisos para ver esta sección del panel.
              </p>
              <Link href="/dashboard" className="inline-block mt-6">
                <Button>Volver al panel</Button>
              </Link>
            </div>
          )}
        </main>
      </div>

      {/* Bottom Navigation Bar (solo móvil) */}
      <nav
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-neutral-200 flex"
        aria-label="Navegación rápida"
      >
        {bottomNavItems.map((item) => {
          const Icon = item.icon
          const active = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex-1 flex flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-medium transition-colors',
                active ? 'text-brand-600' : 'text-neutral-500 hover:text-neutral-800'
              )}
              aria-current={active ? 'page' : undefined}
            >
              <Icon size={22} weight={active ? 'fill' : 'regular'} />
              {item.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
