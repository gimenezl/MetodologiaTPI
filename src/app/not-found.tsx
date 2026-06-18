import Link from 'next/link'
import { House, ArrowLeft } from '@phosphor-icons/react/dist/ssr'
import { Button } from '@/components/ui/Button'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Página no encontrada',
  description: 'La página que buscás no existe o fue movida.',
}

export default function NotFound() {
  return (
    <main className="min-h-[100dvh] flex items-center justify-center bg-white relative overflow-hidden px-4">
      {/* Degradado sutil de fondo */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `radial-gradient(ellipse 60% 50% at 50% 40%, oklch(0.93 0.022 275) 0%, transparent 70%)`,
        }}
        aria-hidden="true"
      />

      {/* Puntos decorativos */}
      <div className="absolute left-10 top-1/4 pointer-events-none hidden md:block" aria-hidden="true">
        {Array.from({ length: 5 }).map((_, row) => (
          <div key={row} className="flex gap-4 mb-4">
            {Array.from({ length: 5 }).map((_, col) => (
              <div key={col} className="w-1.5 h-1.5 rounded-full bg-brand-400 opacity-25" />
            ))}
          </div>
        ))}
      </div>

      <div className="relative z-10 text-center max-w-lg">
        <p
          className="text-8xl md:text-9xl font-extrabold tracking-tight leading-none"
          style={{
            background: 'linear-gradient(135deg, oklch(0.68 0.230 43) 0%, oklch(0.57 0.225 258) 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          404
        </p>
        <h1 className="mt-4 text-2xl md:text-3xl font-extrabold text-neutral-900 tracking-tight">
          Página no encontrada
        </h1>
        <p className="mt-3 text-neutral-500 leading-relaxed">
          La página que buscás no existe, fue movida o el enlace es incorrecto.
          Verificá la dirección o volvé al inicio.
        </p>

        <div className="mt-8 flex flex-wrap gap-3 justify-center">
          <Link href="/">
            <Button size="lg" variant="accent" className="shadow-lg shadow-accent-500/25">
              <House size={18} weight="fill" />
              Volver al inicio
            </Button>
          </Link>
          <Link href="/contacto">
            <Button size="lg" variant="ghost" className="text-neutral-700 border border-neutral-300 hover:bg-neutral-100">
              <ArrowLeft size={16} />
              Contactar al centro
            </Button>
          </Link>
        </div>
      </div>
    </main>
  )
}
