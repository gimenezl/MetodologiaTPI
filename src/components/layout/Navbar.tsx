'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import { List, X, GraduationCap, UserCircle } from '@phosphor-icons/react'
import { useAuth } from '@/context/AuthContext'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'

const navLinks = [
  { href: '/quienes-somos', label: 'Quiénes Somos' },
  { href: '/niveles', label: 'Niveles' },
  { href: '/bienestar', label: 'Bienestar' },
  { href: '/noticias', label: 'Noticias' },
  { href: '/galeria', label: 'Galería' },
  { href: '/contacto', label: 'Contacto' },
  { href: '/empleo', label: 'Empleo' },
]

export function Navbar() {
  const pathname = usePathname()
  const { user, isLoading } = useAuth()
  const [isOpen, setIsOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    let lastY = window.scrollY
    const handler = () => {
      const currentY = window.scrollY
      setScrolled(currentY > 20)
      if (currentY > 80 && currentY > lastY) setHidden(true)
      else setHidden(false)
      lastY = currentY
    }
    window.addEventListener('scroll', handler, { passive: true })
    return () => window.removeEventListener('scroll', handler)
  }, [])

  return (
    <header
      className={cn(
        'fixed top-0 left-0 right-0 z-50 transition-all duration-300',
        hidden ? '-translate-y-full' : 'translate-y-0',
        scrolled
          ? 'bg-white shadow-sm border-b border-neutral-100'
          : 'bg-white/98 border-b border-neutral-100'
      )}
    >
      <nav
        className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between"
        aria-label="Navegación principal"
      >
        {/* Logo */}
        <Link
          href="/"
          className="flex items-center gap-2.5 font-bold text-brand-700 hover:text-brand-800 transition-colors"
          aria-label="Educar para Transformar — Inicio"
        >
          <div className="w-8 h-8 bg-brand-500 rounded-lg flex items-center justify-center shadow-sm">
            <GraduationCap size={18} weight="fill" className="text-white" />
          </div>
          <span className="hidden sm:block text-sm leading-tight">
            Educar para<br />
            <strong>Transformar</strong>
          </span>
        </Link>

        {/* Desktop Nav */}
        <ul className="hidden lg:flex items-center gap-1" role="list">
          {navLinks.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className={cn(
                  'px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-150',
                  pathname === link.href
                    ? 'bg-brand-50 text-brand-700 font-semibold'
                    : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100'
                )}
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>

        {/* CTA */}
        <div className="hidden lg:flex items-center gap-3">
          <Link href="/inscripcion">
            <Button size="sm" variant="accent">
              Inscribirse
            </Button>
          </Link>
          {!isLoading && (
            user ? (
              <Link href="/dashboard">
                <Button size="sm" variant="outline">
                  <UserCircle size={16} weight="fill" />
                  Dashboard
                </Button>
              </Link>
            ) : (
              <Link href="/login">
                <Button size="sm" variant="ghost">
                  Ingresar
                </Button>
              </Link>
            )
          )}
        </div>

        {/* Mobile hamburger */}
        <button
          className="lg:hidden p-2 rounded-lg text-neutral-600 hover:bg-neutral-100 transition-colors"
          onClick={() => setIsOpen(!isOpen)}
          aria-expanded={isOpen}
          aria-label={isOpen ? 'Cerrar menú' : 'Abrir menú'}
        >
          {isOpen ? <X size={22} /> : <List size={22} />}
        </button>
      </nav>

      {/* Mobile menu */}
      {isOpen && (
        <div className="lg:hidden glass border-t border-white/20">
          <div className="max-w-7xl mx-auto px-4 py-4 space-y-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setIsOpen(false)}
                className={cn(
                  'block px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  pathname === link.href
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-neutral-700 hover:bg-neutral-100'
                )}
              >
                {link.label}
              </Link>
            ))}
            <div className="pt-3 pb-1 flex flex-col gap-2 border-t border-neutral-200 mt-3">
              <Link href="/inscripcion" onClick={() => setIsOpen(false)}>
                <Button variant="accent" fullWidth>Inscribirse</Button>
              </Link>
              {!isLoading && (
                <Link href={user ? '/dashboard' : '/login'} onClick={() => setIsOpen(false)}>
                  <Button variant="outline" fullWidth>
                    {user ? 'Dashboard' : 'Ingresar'}
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
