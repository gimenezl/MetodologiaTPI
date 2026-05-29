import type { Metadata } from 'next'
import Link from 'next/link'
import { Heart, Brain, ForkKnife, Trophy, Stethoscope, Users, ArrowRight, CheckCircle } from '@phosphor-icons/react/dist/ssr'
import { Button } from '@/components/ui/Button'
import { obtenerMenuSemana } from '@/services/noticias.service'

export const metadata: Metadata = {
  title: 'Bienestar Estudiantil',
  description: 'Programa integral de bienestar para alumnos del Centro Educativo Educar para Transformar: nutrición, salud mental, deporte y acompañamiento.',
}

const programas = [
  {
    icon: Brain,
    titulo: 'Acompañamiento psicológico',
    desc: 'Equipo de psicólogos educacionales disponibles para estudiantes y familias. Intervención temprana en situaciones de estrés, bullying o dificultades emocionales.',
    detalles: ['Sesiones individuales mensuales', 'Grupos de pares para secundario', 'Talleres de inteligencia emocional', 'Línea de escucha para padres'],
  },
  {
    icon: ForkKnife,
    titulo: 'Nutrición y menú escolar',
    desc: 'Menú elaborado por nutricionistas certificados. Almuerzo incluido en el nivel Secundario con jornada extendida. Opciones para necesidades especiales.',
    detalles: ['Menú semanal variado y nutritivo', 'Opciones vegetarianas y sin TACC', 'Educación alimentaria en clase', 'Merienda saludable en nivel Inicial'],
  },
  {
    icon: Trophy,
    titulo: 'Programa deportivo integral',
    desc: '8 disciplinas deportivas con entrenadores profesionales. Participación en torneos regionales. El deporte como herramienta de valores y liderazgo.',
    detalles: ['8 disciplinas disponibles', 'Torneos internos mensuales', 'Evaluación física anual', 'Énfasis en juego limpio y equipo'],
  },
  {
    icon: Stethoscope,
    titulo: 'Salud y seguimiento médico',
    desc: 'Gabinete médico en el establecimiento. Control de vacunación, primeros auxilios y articulación con el sistema de salud pública de Resistencia.',
    detalles: ['Médico de guardia en turno', 'Primeros auxilios certificados', 'Control de vacunación actualizada', 'Articulación con hospitales públicos'],
  },
]

export default async function BienestarPage() {
  let menuSemana: { id: number; dia_semana: string | null; descripcion: string | null; fecha_vigencia: string | null }[] = []
  try {
    menuSemana = await obtenerMenuSemana() ?? []
  } catch {
    menuSemana = []
  }

  return (
    <>
      {/* Hero */}
      <section className="min-h-[60dvh] bg-gradient-to-br from-emerald-900 via-brand-900 to-brand-900 flex items-center pt-16 relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-15"
          style={{
            backgroundImage: "url('/bienestar-hero.png')",
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
          aria-hidden="true"
        />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 w-full">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 mb-6">
              <Heart size={20} weight="fill" className="text-red-400" />
              <span className="text-white/80 text-sm font-semibold uppercase tracking-widest">Cuidado integral</span>
            </div>
            <h1 className="text-5xl md:text-6xl font-extrabold text-white tracking-tight text-balance">
              El bienestar de tu hijo es nuestra prioridad
            </h1>
            <p className="mt-6 text-white/80 text-lg leading-relaxed max-w-[52ch]">
              Un alumno sano, feliz y emocionalmente equilibrado aprende mejor. Por eso diseñamos un programa de bienestar que va mucho más allá del aula.
            </p>
          </div>
        </div>
      </section>

      {/* Estadísticas de bienestar */}
      <section className="bg-white border-b border-neutral-200" aria-label="Datos del programa">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 lg:grid-cols-4">
            {[
              { valor: '2', label: 'Psicólogos en planta' },
              { valor: '5 días', label: 'Almuerzo por semana' },
              { valor: '8', label: 'Deportes disponibles' },
              { valor: '1', label: 'Médico de guardia diario' },
            ].map((stat, i) => (
              <div key={stat.label} className={`py-10 px-6 text-center ${i < 3 ? 'border-r border-neutral-100' : ''}`}>
                <p className="text-3xl font-extrabold text-brand-700">{stat.valor}</p>
                <p className="text-sm text-neutral-500 mt-1">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Programas detallados */}
      <section className="py-24 bg-neutral-50" aria-labelledby="programas-heading">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <h2 id="programas-heading" className="text-4xl font-extrabold text-neutral-900 tracking-tight">
              Cuatro pilares de bienestar
            </h2>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            {programas.map((prog, i) => {
              const Icon = prog.icon
              return (
                <div
                  key={prog.titulo}
                  className="bg-white rounded-2xl border border-neutral-200 p-7 hover:border-brand-300 hover:shadow-sm transition-all duration-200"
                >
                  <div className="flex items-start gap-4 mb-5">
                    <div className="w-12 h-12 bg-brand-50 rounded-xl flex items-center justify-center shrink-0">
                      <Icon size={24} weight="fill" className="text-brand-500" />
                    </div>
                    <div>
                      <h3 className="font-bold text-neutral-900 text-lg">{prog.titulo}</h3>
                      <p className="text-neutral-600 text-sm leading-relaxed mt-1">{prog.desc}</p>
                    </div>
                  </div>
                  <ul className="space-y-2 pl-16">
                    {prog.detalles.map((d) => (
                      <li key={d} className="flex items-center gap-2 text-sm text-neutral-600">
                        <CheckCircle size={14} weight="fill" className="text-brand-400 shrink-0" />
                        {d}
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* Menú semanal */}
      <section className="py-24 bg-white" aria-labelledby="menu-heading">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <p className="text-brand-600 font-semibold text-sm uppercase tracking-widest mb-4">Nutrición escolar</p>
              <h2 id="menu-heading" className="text-3xl font-extrabold text-neutral-900 tracking-tight mb-6">
                Menú elaborado por nutricionistas
              </h2>
              <p className="text-neutral-600 leading-relaxed mb-8">
                El menú semanal es diseñado por nutricionistas certificadas, rotativo mensualmente y publicado con anticipación para que las familias estén informadas.
                Contempla las necesidades calóricas de cada franja etaria.
              </p>
              {menuSemana.length === 0 ? (
                <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-5 text-sm text-neutral-500">
                  El menú semanal se publicará próximamente.
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 gap-3">
                  {menuSemana.map((item) => (
                    <div key={item.id} className="rounded-xl border border-neutral-200 p-4 bg-neutral-50">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-8 h-8 rounded-lg bg-brand-50 border border-brand-100 flex items-center justify-center">
                          <ForkKnife size={16} weight="fill" className="text-brand-400" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-neutral-700">{item.dia_semana ?? 'Día'}</p>
                          {item.fecha_vigencia && (
                            <p className="text-xs text-neutral-400">Vigencia: {item.fecha_vigencia}</p>
                          )}
                        </div>
                      </div>
                      <p className="text-sm text-neutral-600">{item.descripcion ?? '—'}</p>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-neutral-400 mt-4">El menú completo se publica semanalmente en el portal para familias.</p>
            </div>
            <div
              className="rounded-3xl overflow-hidden aspect-[4/3]"
              style={{
                backgroundImage: "url('/menu-escolar.png')",
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
              aria-hidden="true"
            />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-brand-900">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <Users size={40} weight="fill" className="text-accent-400 mx-auto mb-6" />
          <h2 className="text-3xl font-extrabold text-white tracking-tight mb-4">
            Más consultas sobre bienestar
          </h2>
          <p className="text-white/75 mb-8">
            Nuestro equipo de bienestar está disponible para responder dudas antes de la inscripción.
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
            <Link href="/contacto">
              <Button size="lg" variant="accent">Consultar <ArrowRight size={18} /></Button>
            </Link>
            <Link href="/inscripcion">
              <Button size="lg" variant="ghost" className="text-white border border-white/30 hover:bg-white/10">Inscribirme</Button>
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
