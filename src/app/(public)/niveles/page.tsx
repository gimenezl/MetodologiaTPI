import type { Metadata } from 'next'
import Link from 'next/link'
import { Clock, BookOpen, Trophy, ArrowRight, CheckCircle, GraduationCap } from '@phosphor-icons/react/dist/ssr'
import { Button } from '@/components/ui/Button'

export const metadata: Metadata = {
  title: 'Niveles Educativos',
  description: 'Conocé la propuesta pedagógica del nivel Inicial, Primario y Secundario con jornada extendida del Centro Educativo Educar para Transformar.',
}

const niveles = [
  {
    id: 'inicial',
    titulo: 'Nivel Inicial',
    subtitulo: 'Sala de 3, 4 y 5 años',
    horario: '8:00 a 12:00 hs',
    img: '/nivel.inicial.jpeg',
    color: 'from-teal-400 to-emerald-500',
    bgColor: 'bg-emerald-50 border-emerald-200',
    textColor: 'text-emerald-700',
    descripcion: 'La primera infancia es la etapa más importante del desarrollo humano. Nuestro nivel Inicial ofrece un ambiente seguro, estimulante y afectivo donde el juego es el eje del aprendizaje.',
    caracteristicas: [
      'Metodología lúdica y constructivista',
      'Estimulación temprana multisensorial',
      'Inglés desde sala de 4 años',
      'Música, movimiento y arte',
      'Psicomotricidad semanal',
      'Merienda nutritiva incluida',
    ],
  },
  {
    id: 'primario',
    titulo: 'Nivel Primario',
    subtitulo: '1° a 6° grado · 6 a 12 años',
    horario: '7:30 a 13:00 hs',
    img: '/primario.jpeg',
    color: 'from-brand-400 to-brand-600',
    bgColor: 'bg-brand-50 border-brand-200',
    textColor: 'text-brand-700',
    descripcion: 'Formación sólida en competencias básicas: lectoescritura, matemáticas, ciencias y humanidades. Proyectos interdisciplinarios que conectan el aprendizaje con la vida real.',
    caracteristicas: [
      'Proyecto de lectura anual',
      'Laboratorio de ciencias desde 3° grado',
      'Inglés diario con docentes nativos',
      'Educación digital y programación básica',
      'Acompañamiento psicopedagógico',
      'Actividades deportivas opcionales',
    ],
  },
  {
    id: 'secundario',
    titulo: 'Nivel Secundario',
    subtitulo: '1° a 5° año · 13 a 17 años',
    horario: '7:30 a 17:00 hs (jornada extendida)',
    img: '/secundaria.jpeg',
    color: 'from-indigo-500 to-purple-600',
    bgColor: 'bg-indigo-50 border-indigo-200',
    textColor: 'text-indigo-700',
    descripcion: 'Jornada completa con orientación académica profunda, talleres artísticos y deportivos. Preparación para el ingreso universitario y para la vida adulta responsable.',
    caracteristicas: [
      'Jornada extendida hasta las 17:00 hs',
      'Taller de orientación vocacional (4° y 5°)',
      'Inglés intensivo — nivel FCE para egresados',
      'Actividades deportivas (8 disciplinas)',
      'Laboratorio equipado STEM',
      'Viaje de egresados y servicio comunitario',
    ],
  },
]

export default function NivelesPage() {
  return (
    <>
      {/* Hero */}
      <section className="pt-24 pb-16 bg-neutral-50 border-b border-neutral-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-brand-600 font-semibold text-sm uppercase tracking-widest mb-4">Oferta educativa</p>
            <h1 className="text-5xl md:text-6xl font-extrabold text-neutral-900 tracking-tight text-balance leading-tight">
              Tres niveles, una sola visión
            </h1>
            <p className="mt-5 text-neutral-600 text-lg leading-relaxed max-w-[52ch]">
              Acompañamos a cada alumno desde los 3 hasta los 17 años con propuestas pedagógicas adaptadas a cada etapa del desarrollo.
            </p>
          </div>
        </div>
      </section>

      {/* Niveles — layout zig-zag alternado */}
      <div className="bg-white">
        {niveles.map((nivel, i) => (
          <section
            key={nivel.id}
            id={nivel.id}
            className={`py-24 ${i % 2 !== 0 ? 'bg-neutral-50' : 'bg-white'}`}
            aria-labelledby={`nivel-${nivel.id}-heading`}
          >
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className={`grid lg:grid-cols-2 gap-16 items-center ${i % 2 !== 0 ? '' : ''}`}>
                {/* Imagen */}
                <div className={`relative ${i % 2 !== 0 ? 'lg:order-2' : ''}`}>
                  <div
                    className="rounded-3xl overflow-hidden aspect-[16/10] relative"
                    style={{
                      backgroundImage: `url(${nivel.img})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }}
                  >
                    <div className={`absolute inset-0 bg-gradient-to-br ${nivel.color} opacity-40`} />
                    <div className="absolute top-4 left-4">
                      <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold ${nivel.bgColor} ${nivel.textColor} border`}>
                        <Clock size={12} />
                        {nivel.horario}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Contenido */}
                <div className={i % 2 !== 0 ? 'lg:order-1' : ''}>
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${nivel.bgColor} ${nivel.textColor} border mb-4`}>
                    <GraduationCap size={12} weight="fill" />
                    {nivel.subtitulo}
                  </span>
                  <h2
                    id={`nivel-${nivel.id}-heading`}
                    className="text-3xl md:text-4xl font-extrabold text-neutral-900 tracking-tight mb-4"
                  >
                    {nivel.titulo}
                  </h2>
                  <p className="text-neutral-600 leading-relaxed mb-8">{nivel.descripcion}</p>

                  <ul className="space-y-3 mb-10">
                    {nivel.caracteristicas.map((c) => (
                      <li key={c} className="flex items-start gap-3 text-sm text-neutral-700">
                        <CheckCircle size={18} weight="fill" className="text-brand-500 mt-0.5 shrink-0" />
                        {c}
                      </li>
                    ))}
                  </ul>

                  <Link href="/inscripcion">
                    <Button variant="primary">
                      Inscribirme en {nivel.titulo}
                      <ArrowRight size={16} />
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          </section>
        ))}
      </div>

      {/* Actividades extracurriculares */}
      <section className="py-24 bg-brand-900" aria-labelledby="actividades-heading">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <p className="text-brand-400 font-semibold text-sm uppercase tracking-widest mb-3">Más allá del aula</p>
            <h2 id="actividades-heading" className="text-4xl font-extrabold text-white tracking-tight">
              Actividades deportivas y talleres
            </h2>
            <p className="mt-4 text-brand-300 max-w-[50ch] mx-auto">
              Cupos limitados — inscripción separada disponible al momento de matriculación
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { nombre: 'Fútbol', tipo: 'DEPORTE', img: '/act-futbol.png' },
              { nombre: 'Natación', tipo: 'DEPORTE', img: '/act-natacion.png' },
              { nombre: 'Atletismo', tipo: 'DEPORTE', img: '/act-atletismo.png' },
              { nombre: 'Artes Marciales', tipo: 'DEPORTE', img: '/act-artes.png' },
              { nombre: 'Vóley', tipo: 'DEPORTE', img: '/act-voley.png' },
              { nombre: 'Danza', tipo: 'TALLER', img: '/act-danza.png' },
              { nombre: 'Básquet', tipo: 'DEPORTE', img: '/act-basquet.png' },
              { nombre: 'Ajedrez', tipo: 'TALLER', img: '/act-ajedrez.png' },
            ].map((act) => (
              <div
                key={act.nombre}
                className="relative rounded-2xl overflow-hidden aspect-square group cursor-pointer"
                style={{
                  backgroundImage: `url(${act.img})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }}
              >
                <div className="absolute inset-0 bg-brand-900/50 group-hover:bg-brand-900/30 transition-colors duration-300" />
                <div className="absolute inset-0 flex flex-col items-center justify-end p-4 text-white">
                  <p className="font-bold text-sm text-center">{act.nombre}</p>
                  <span className="text-xs text-brand-300 mt-0.5">{act.tipo}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-white border-t border-neutral-200">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <Trophy size={40} weight="fill" className="text-accent-500 mx-auto mb-6" />
          <h2 className="text-3xl font-extrabold text-neutral-900 tracking-tight mb-4">
            Empezá el proceso de inscripción
          </h2>
          <p className="text-neutral-600 mb-8">
            Completá el formulario en línea y elegí el nivel. Te contactaremos dentro de las 48 horas.
          </p>
          <Link href="/inscripcion">
            <Button size="lg" variant="primary">Formulario de inscripción <ArrowRight size={18} /></Button>
          </Link>
        </div>
      </section>
    </>
  )
}
