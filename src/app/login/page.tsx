import { Suspense } from 'react'
import { LoginForm } from './LoginForm'
import { GraduationCap } from '@phosphor-icons/react/dist/ssr'
import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Ingresar al sistema',
  description: 'Acceso al panel de gestión del Centro Educativo Educar para Transformar',
}

export default function LoginPage() {
  return (
    <div className="min-h-[100dvh] grid lg:grid-cols-2">
      {/* Left panel — branding */}
      <div
        className="hidden lg:flex flex-col justify-between p-12 bg-brand-900 relative overflow-hidden"
        aria-hidden="true"
      >
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: `url('/mision-colegio.png')`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-br from-brand-900 via-brand-800/90 to-brand-900/80" />
        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-brand-500 rounded-xl flex items-center justify-center">
              <GraduationCap size={22} weight="fill" className="text-white" />
            </div>
            <div>
              <p className="text-white font-bold text-sm">Educar para Transformar</p>
              <p className="text-white/60 text-xs">Sistema de gestión educativa</p>
            </div>
          </div>
        </div>
        <div className="relative space-y-6">
          <blockquote className="border-l-2 border-accent-400 pl-6">
            <p className="text-white text-xl font-medium leading-relaxed">
              "La educación es el arma más poderosa que puedes usar para cambiar el mundo."
            </p>
            <footer className="text-white/60 text-sm mt-3">— Nelson Mandela</footer>
          </blockquote>
          <div className="flex gap-4">
            {[
              { label: '3', desc: 'Niveles educativos' },
              { label: '8+', desc: 'Actividades' },
              { label: '2027', desc: 'Inicio de clases' },
            ].map((stat) => (
              <div key={stat.label} className="text-center">
                <p className="text-2xl font-extrabold text-white">{stat.label}</p>
                <p className="text-xs text-white/60 mt-0.5">{stat.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex items-center justify-center px-6 py-12 bg-white">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-2.5 mb-8">
            <div className="w-8 h-8 bg-brand-500 rounded-lg flex items-center justify-center">
              <GraduationCap size={18} weight="fill" className="text-white" />
            </div>
            <span className="font-bold text-brand-700 text-sm">Educar para Transformar</span>
          </div>

          <h1 className="text-2xl font-extrabold text-neutral-900 tracking-tight">
            Bienvenido de vuelta
          </h1>
          <p className="text-neutral-500 text-sm mt-1.5 mb-8">
            Ingresá tus credenciales para acceder al sistema
          </p>

          <Suspense fallback={<div className="h-40 flex items-center justify-center text-neutral-400 text-sm">Cargando...</div>}>
            <LoginForm />
          </Suspense>

          <p className="text-center text-xs text-neutral-400 mt-6">
            ¿Problemas para ingresar?{' '}
            <Link href="/contacto" className="text-brand-600 hover:underline font-medium">
              Contactar soporte
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
