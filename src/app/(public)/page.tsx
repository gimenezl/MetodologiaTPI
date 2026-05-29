export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { ArrowRight, GraduationCap, Users, Trophy, BookOpen, Heart, Star } from '@phosphor-icons/react/dist/ssr'
import { Button } from '@/components/ui/Button'
import type { Metadata } from 'next'
import { obtenerOpiniones } from '@/services/noticias.service'
import { TestimoniosClient } from './TestimoniosClient'

export const metadata: Metadata = {
  title: 'Inicio | Centro Educativo Educar para Transformar',
  description: 'Centro educativo de excelencia en los niveles Inicial, Primario y Secundario con jornada extendida. Inscripciones abiertas para el ciclo lectivo 2027.',
}

const stats = [
  { value: '3', label: 'Niveles educativos', icon: GraduationCap },
  { value: '8+', label: 'Deportes y talleres', icon: Trophy },
  { value: '2027', label: 'Inicio de clases', icon: Star },
  { value: '100%', label: 'Compromiso docente', icon: Heart },
]

const actividades = [
  'Fútbol', 'Natación', 'Atletismo', 'Artes Marciales',
  'Vóley', 'Danza', 'Básquet', 'Ajedrez', 'Laboratorio', 'Inglés Avanzado',
  'Fútbol', 'Natación', 'Atletismo', 'Artes Marciales',
  'Vóley', 'Danza', 'Básquet', 'Ajedrez', 'Laboratorio', 'Inglés Avanzado',
]

const values = [
  {
    icon: BookOpen,
    title: 'Excelencia académica',
    description: 'Programas curriculares actualizados con metodologías activas de enseñanza.',
  },
  {
    icon: Users,
    title: 'Comunidad educativa',
    description: 'Una comunidad que construye lazos entre familias, docentes y alumnos.',
  },
  {
    icon: Heart,
    title: 'Bienestar integral',
    description: 'Acompañamiento psicológico, deportivo y nutricional para cada estudiante.',
  },
]

export default async function HomePage() {
  let opiniones: { id: number; nombre_usuario: string; comentario: string; fecha: string }[] = []
  try {
    opiniones = await obtenerOpiniones() ?? []
  } catch {
    opiniones = []
  }

  return (
    <>
      {/* Hero — Fondo claro, texto degradado colorido */}
      <section
        className="relative min-h-[100dvh] flex items-center overflow-hidden bg-white"
        aria-labelledby="hero-heading"
      >
        {/* Degradado radial de fondo — lavanda + naranja suave */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `radial-gradient(ellipse 70% 60% at 65% 50%, oklch(0.93 0.022 275) 0%, transparent 70%),
                              radial-gradient(ellipse 35% 35% at 88% 18%, oklch(0.95 0.018 43) 0%, transparent 60%)`,
          }}
          aria-hidden="true"
        />

        {/* Cuadrícula de puntos — decoración */}
        <div className="absolute left-6 top-1/4 pointer-events-none hidden md:block" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, row) => (
            <div key={row} className="flex gap-4 mb-4">
              {Array.from({ length: 6 }).map((_, col) => (
                <div key={col} className="w-1.5 h-1.5 rounded-full bg-brand-400 opacity-25" />
              ))}
            </div>
          ))}
        </div>

        {/* Línea de puntos verde inferior */}
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 flex gap-3 pointer-events-none" aria-hidden="true">
          {Array.from({ length: 14 }).map((_, i) => (
            <div key={i} className="w-1.5 h-1.5 rounded-full bg-green-400 opacity-45" />
          ))}
        </div>

        {/* Panel imagen derecha — sutil */}
        <div
          className="absolute right-0 top-0 bottom-0 w-full lg:w-[55%] opacity-[0.08] lg:opacity-[0.15]"
          style={{
            backgroundImage: "url('/educacion.jpeg')",
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
          aria-hidden="true"
        />
        <div
          className="absolute right-0 top-0 bottom-0 w-full lg:w-[55%] bg-gradient-to-r from-white via-white/70 to-transparent"
          aria-hidden="true"
        />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-32 lg:py-0 w-full">
          <div className="max-w-2xl">
            {/* Badge de inscripciones */}
            <div className="inline-flex items-center gap-2 bg-green-50 border border-green-200 rounded-full px-4 py-1.5 mb-8">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-green-700 text-xs font-semibold tracking-wide">Inscripciones 2027 abiertas</span>
            </div>

            <h1
              id="hero-heading"
              className="text-5xl md:text-6xl lg:text-7xl font-extrabold text-neutral-900 leading-[1.05] tracking-tight text-balance"
            >
              Educación que{' '}
              <span
                style={{
                  background: 'linear-gradient(135deg, oklch(0.68 0.230 43) 0%, oklch(0.75 0.200 43) 50%, oklch(0.57 0.225 258) 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                transforma
              </span>{' '}
              <span
                style={{
                  background: 'linear-gradient(135deg, oklch(0.57 0.225 258) 0%, oklch(0.50 0.270 258) 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                vidas
              </span>
            </h1>

            <p className="mt-6 text-neutral-500 text-lg leading-relaxed max-w-[52ch] text-pretty">
              Centro educativo de vanguardia en los niveles Inicial, Primario y Secundario.
              Jornada extendida, actividades deportivas y bienestar estudiantil integral.
            </p>

            <div className="mt-10 flex flex-wrap gap-4">
              <Link href="/inscripcion">
                <Button size="lg" variant="accent" className="shadow-lg shadow-accent-500/25">
                  Iniciar pre-inscripción
                  <ArrowRight size={18} />
                </Button>
              </Link>
              <Link href="/quienes-somos">
                <Button
                  size="lg"
                  variant="ghost"
                  className="text-neutral-700 border border-neutral-300 hover:bg-neutral-100"
                >
                  Conocer más
                </Button>
              </Link>
            </div>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-neutral-400 text-xs" aria-hidden="true">
          <span>Explorar</span>
          <div className="w-px h-12 bg-gradient-to-b from-brand-400 to-transparent animate-pulse" />
        </div>
      </section>

      {/* Stats */}
      <section className="bg-brand-600" aria-label="Datos del centro">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 lg:grid-cols-4">
            {stats.map((stat, i) => {
              const Icon = stat.icon
              return (
                <div
                  key={stat.label}
                  className={`py-10 px-6 text-center ${i < stats.length - 1 ? 'border-r border-brand-500/50' : ''}`}
                  style={{ animationDelay: `${i * 100}ms` }}
                >
                  <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center mx-auto mb-3">
                    <Icon size={22} weight="fill" className="text-white" />
                  </div>
                  <p className="text-3xl font-extrabold text-white tracking-tight">{stat.value}</p>
                  <p className="text-sm text-brand-100 mt-1 font-medium">{stat.label}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* Marquee de actividades */}
      <section className="py-5 bg-accent-500 overflow-hidden" aria-label="Actividades extracurriculares">
        <div className="flex gap-8" style={{ animation: 'marquee 30s linear infinite' }}>
          {actividades.map((act, i) => (
            <span key={i} className="shrink-0 text-white font-bold text-sm flex items-center gap-3">
              <span className="w-2 h-2 rounded-full bg-white/70" aria-hidden="true" />
              {act}
            </span>
          ))}
        </div>
      </section>

      {/* Niveles educativos preview */}
      <section className="py-24 bg-white" aria-labelledby="niveles-heading">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <p className="text-brand-600 font-semibold text-sm uppercase tracking-widest mb-3">Oferta educativa</p>
            <h2 id="niveles-heading" className="text-4xl font-extrabold text-neutral-900 tracking-tight">
              Tres niveles, una sola visión
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { nivel: 'Inicial', age: '3 a 5 años', desc: 'Primera infancia con metodología lúdica y estimulación temprana integral.', color: 'from-green-400 to-teal-500', img: '/nivel.inicial.jpeg' },
              { nivel: 'Primario', age: '6 a 12 años', desc: 'Formación sólida en competencias básicas con proyecto interdisciplinario.', color: 'from-brand-400 to-brand-600', img: '/primario.jpeg' },
              { nivel: 'Secundario', age: '13 a 17 años', desc: 'Jornada extendida con orientación académica, deportiva y artística.', color: 'from-indigo-500 to-purple-600', img: '/secundaria.jpeg' },
            ].map((item) => (
              <Link
                key={item.nivel}
                href="/niveles"
                className="group relative overflow-hidden rounded-3xl aspect-[3/4] block"
              >
                <div
                  className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-105"
                  style={{ backgroundImage: `url(${item.img})` }}
                  aria-hidden="true"
                />
                <div className={`absolute inset-0 bg-gradient-to-b ${item.color} opacity-60`} aria-hidden="true" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" aria-hidden="true" />
                <div className="absolute bottom-0 left-0 right-0 p-6 text-white">
                  <p className="text-xs font-semibold uppercase tracking-widest text-white/70 mb-1">{item.age}</p>
                  <h3 className="text-2xl font-extrabold">{item.nivel}</h3>
                  <p className="text-sm text-white/80 mt-2 leading-relaxed">{item.desc}</p>
                  <div className="flex items-center gap-1.5 mt-4 text-xs font-semibold text-white/90 group-hover:gap-2.5 transition-all duration-200">
                    Ver más <ArrowRight size={14} />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Valores / Propuesta educativa */}
      <section className="py-24 bg-brand-800 relative overflow-hidden" aria-labelledby="valores-heading">
        {/* Decorative blobs */}
        <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full opacity-20" style={{ background: 'oklch(0.68 0.230 43)' }} aria-hidden="true" />
        <div className="absolute -bottom-16 -left-16 w-72 h-72 rounded-full opacity-10" style={{ background: 'oklch(0.70 0.165 258)' }} aria-hidden="true" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <p className="text-accent-400 font-bold text-sm uppercase tracking-widest mb-4">
                Nuestra propuesta
              </p>
              <h2
                id="valores-heading"
                className="text-4xl md:text-5xl font-extrabold text-white leading-tight tracking-tight text-balance"
              >
                Formamos personas,<br />no solo estudiantes
              </h2>
              <p className="mt-5 text-white/80 leading-relaxed max-w-[50ch]">
                Nuestra visión ética coloca al alumno en el centro del proceso educativo.
                Fomentamos el pensamiento crítico, la solidaridad y la responsabilidad cívica
                desde los primeros años de escolaridad.
              </p>
              <Link href="/quienes-somos" className="inline-block mt-8">
                <Button variant="accent" className="shadow-lg shadow-accent-500/30">
                  Conocer nuestra visión
                  <ArrowRight size={16} />
                </Button>
              </Link>
            </div>

            <div className="space-y-4">
              {values.map((val, i) => {
                const Icon = val.icon
                const iconColors = ['text-accent-400', 'text-green-400', 'text-pink-400']
                const bgColors = ['bg-accent-500/20', 'bg-green-500/20', 'bg-pink-500/20']
                return (
                  <div
                    key={val.title}
                    className="flex gap-4 p-5 bg-white/10 backdrop-blur-sm rounded-2xl border border-white/20 hover:bg-white/15 transition-all duration-200"
                    style={{ animationDelay: `${i * 100}ms` }}
                  >
                    <div className={`w-11 h-11 ${bgColors[i]} rounded-xl flex items-center justify-center shrink-0`}>
                      <Icon size={22} weight="fill" className={iconColors[i]} />
                    </div>
                    <div>
                      <h3 className="font-bold text-white text-sm">{val.title}</h3>
                      <p className="text-white/75 text-sm mt-1 leading-relaxed">{val.description}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </section>

      {/* Opiniones / Testimonios */}
      <section className="py-24 bg-white" aria-labelledby="opiniones-heading">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6 mb-12">
            <div>
              <p className="text-brand-600 font-semibold text-sm uppercase tracking-widest mb-3">Testimonios</p>
              <h2 id="opiniones-heading" className="text-4xl font-extrabold text-neutral-900 tracking-tight">
                Familias que confían en nosotros
              </h2>
            </div>
          </div>
          <TestimoniosClient initialOpiniones={opiniones} />
        </div>
      </section>

      {/* CTA Inscripción */}
      <section
        className="py-24 relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, oklch(0.50 0.270 258) 0%, oklch(0.41 0.250 258) 40%, oklch(0.57 0.230 43) 100%)' }}
        aria-labelledby="cta-heading"
      >
        {/* Decorative circles */}
        <div className="absolute top-0 right-0 w-96 h-96 rounded-full -translate-y-1/2 translate-x-1/3 bg-white/5" aria-hidden="true" />
        <div className="absolute bottom-0 left-0 w-64 h-64 rounded-full translate-y-1/2 -translate-x-1/4 bg-white/5" aria-hidden="true" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative">
          <p className="text-white/70 font-semibold text-sm uppercase tracking-widest mb-4">Inscripciones 2027 abiertas</p>
          <h2 id="cta-heading" className="text-4xl md:text-5xl font-extrabold text-white tracking-tight text-balance">
            El futuro de tu hijo comienza aquí
          </h2>
          <p className="mt-5 text-white/80 max-w-[50ch] mx-auto leading-relaxed">
            Completá el formulario de pre-inscripción en línea. El proceso es simple y seguro.
            Nuestro equipo te contactará para confirmar la vacante.
          </p>
          <div className="mt-10 flex flex-wrap gap-4 justify-center">
            <Link href="/inscripcion">
              <Button size="lg" variant="primary" className="bg-white text-brand-700 hover:bg-neutral-100 shadow-xl shadow-black/20">
                Comenzar pre-inscripción
                <ArrowRight size={18} />
              </Button>
            </Link>
            <Link href="/contacto">
              <Button size="lg" variant="ghost" className="text-white border-2 border-white/40 hover:bg-white/15 hover:border-white/70">
                Consultar vacantes
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
