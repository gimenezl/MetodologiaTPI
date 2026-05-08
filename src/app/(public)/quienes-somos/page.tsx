import type { Metadata } from 'next'
import { GraduationCap, Heart, Target, Users, BookOpen, Star, Shield, ArrowRight } from '@phosphor-icons/react/dist/ssr'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'

export const metadata: Metadata = {
  title: 'Quiénes Somos',
  description: 'Conocé la visión ética, misión y valores del Centro Educativo Educar para Transformar. Un proyecto educativo comprometido con la formación integral.',
}

const valores = [
  {
    icon: Heart,
    titulo: 'Amor por el conocimiento',
    desc: 'Fomentamos la curiosidad intelectual desde el primer día. Aprender es un acto de libertad.',
  },
  {
    icon: Shield,
    titulo: 'Ética y responsabilidad',
    desc: 'Formamos ciudadanos que entienden que sus acciones tienen consecuencias para la comunidad.',
  },
  {
    icon: Users,
    titulo: 'Comunidad e inclusión',
    desc: 'Cada estudiante es bienvenido independientemente de su origen. La diversidad nos enriquece.',
  },
  {
    icon: Star,
    titulo: 'Excelencia sin presión',
    desc: 'Exigimos lo mejor de cada alumno en su propio ritmo, sin competencia destructiva.',
  },
  {
    icon: Target,
    titulo: 'Visión de futuro',
    desc: 'Preparamos para un mundo que cambia rápido. Pensamiento crítico y adaptabilidad son pilares.',
  },
  {
    icon: BookOpen,
    titulo: 'Educación integral',
    desc: 'Cuerpo, mente y espíritu. Deportes, arte y ciencia en equilibrio permanente.',
  },
]

const equipo = [
  { nombre: 'Valeria Mondragón', rol: 'Directora General', especialidad: 'Pedagogía Crítica', img: '/team-valeria.png' },
  { nombre: 'Esteban Quiroga', rol: 'Coord. Académico', especialidad: 'Matemáticas y Ciencias', img: '/team-esteban.png' },
  { nombre: 'Soledad Ibarra', rol: 'Coord. Bienestar', especialidad: 'Psicología Educacional', img: '/team-soledad.png' },
  { nombre: 'Rodrigo Ferreyra', rol: 'Coord. Deportivo', especialidad: 'Educación Física', img: '/team-rodrigo.png' },
]

export default function QuienesSomosPage() {
  return (
    <>
      {/* Hero asimétrico */}
      <section className="min-h-[100dvh] bg-brand-900 flex items-center relative overflow-hidden pt-16">
        <div
          className="absolute right-0 top-0 bottom-0 w-1/2 opacity-30"
          style={{
            backgroundImage: "url('/educacion.jpeg')",
            backgroundSize: 'cover',
            backgroundPosition: 'center left',
          }}
          aria-hidden="true"
        />
        <div className="absolute right-0 top-0 bottom-0 w-1/2 bg-gradient-to-r from-brand-900 to-transparent" aria-hidden="true" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 w-full">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-brand-800/60 border border-brand-700 rounded-full text-brand-300 text-xs font-semibold mb-8">
              <GraduationCap size={14} weight="fill" />
              Nuestra historia y propósito
            </div>
            <h1 className="text-5xl md:text-6xl font-extrabold text-white leading-tight tracking-tight text-balance">
              Educamos para que los alumnos cambien el mundo
            </h1>
            <p className="mt-6 text-brand-200 text-lg leading-relaxed max-w-[52ch]">
              Nacemos como respuesta a la necesidad de un modelo educativo que priorice la formación
              humana integral sobre la mera acumulación de contenidos. Somos un centro que cree que
              la educación es el motor más poderoso de transformación social.
            </p>
          </div>
        </div>
      </section>

      {/* Misión y Visión */}
      <section className="py-24 bg-white" aria-labelledby="mision-heading">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div
              className="relative rounded-3xl overflow-hidden aspect-[4/3]"
              style={{
                backgroundImage: "url('/mision-colegio.png')",
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
              aria-hidden="true"
            >
              <div className="absolute inset-0 bg-gradient-to-t from-brand-900/60 to-transparent" />
              <div className="absolute bottom-6 left-6 right-6">
                <blockquote className="text-white text-xl font-semibold leading-snug">
                  "La educación es el arma más poderosa para cambiar el mundo."
                </blockquote>
                <p className="text-brand-300 text-sm mt-2">— Nelson Mandela</p>
              </div>
            </div>

            <div className="space-y-10">
              <div>
                <p className="text-brand-600 font-bold text-xs uppercase tracking-widest mb-3">Nuestra misión</p>
                <h2 id="mision-heading" className="text-3xl font-extrabold text-neutral-900 tracking-tight mb-4">
                  Formar personas íntegras, no solo profesionales
                </h2>
                <p className="text-neutral-600 leading-relaxed">
                  Brindar una educación de calidad que combine excelencia académica con desarrollo
                  humano, emocional y cívico. Preparamos a nuestros alumnos para vivir en comunidad,
                  ejercer su ciudadanía con responsabilidad y construir una sociedad más justa.
                </p>
              </div>
              <div>
                <p className="text-brand-600 font-bold text-xs uppercase tracking-widest mb-3">Nuestra visión</p>
                <p className="text-neutral-600 leading-relaxed">
                  Ser el centro educativo de referencia en la región, reconocido por la excelencia de
                  su propuesta pedagógica, la solidez de su comunidad educativa y el compromiso con
                  la transformación social desde la primera infancia hasta el egreso secundario.
                </p>
              </div>
              <div className="flex gap-8 pt-4 border-t border-neutral-100">
                {[['2027', 'Inicio de clases'], ['3', 'Niveles'], ['8+', 'Actividades']].map(([n, l]) => (
                  <div key={l}>
                    <p className="text-3xl font-extrabold text-brand-600">{n}</p>
                    <p className="text-xs text-neutral-500 mt-0.5">{l}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Valores */}
      <section className="py-24 bg-neutral-50" aria-labelledby="valores-heading">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <p className="text-brand-600 font-semibold text-sm uppercase tracking-widest mb-3">Lo que nos mueve</p>
            <h2 id="valores-heading" className="text-4xl font-extrabold text-neutral-900 tracking-tight">
              Nuestros valores fundamentales
            </h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {valores.map((val, i) => {
              const Icon = val.icon
              return (
                <div
                  key={val.titulo}
                  className="bg-white p-6 rounded-2xl border border-neutral-200 hover:border-brand-300 hover:shadow-sm transition-all duration-200 group"
                  style={{ animationDelay: `${i * 80}ms` }}
                >
                  <div className="w-11 h-11 bg-brand-50 rounded-xl flex items-center justify-center mb-4 group-hover:bg-brand-100 transition-colors">
                    <Icon size={22} weight="fill" className="text-brand-500" />
                  </div>
                  <h3 className="font-bold text-neutral-900 mb-2">{val.titulo}</h3>
                  <p className="text-neutral-600 text-sm leading-relaxed">{val.desc}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* Equipo directivo */}
      <section className="py-24 bg-white" aria-labelledby="equipo-heading">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-14">
            <div>
              <p className="text-brand-600 font-semibold text-sm uppercase tracking-widest mb-3">Las personas</p>
              <h2 id="equipo-heading" className="text-4xl font-extrabold text-neutral-900 tracking-tight">
                Nuestro equipo directivo
              </h2>
            </div>
            <Link href="/empleo">
              <Button variant="outline">
                Sumarte al equipo <ArrowRight size={16} />
              </Button>
            </Link>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {equipo.map((persona) => (
              <div key={persona.nombre} className="group">
                <div
                  className="aspect-[3/4] rounded-2xl overflow-hidden mb-4 bg-neutral-100 relative"
                  style={{
                    backgroundImage: `url(${persona.img})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center top',
                  }}
                >
                  <div className="absolute inset-0 bg-gradient-to-t from-brand-900/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  <div className="absolute bottom-0 left-0 right-0 p-4 translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-300">
                    <p className="text-white text-xs font-semibold">{persona.rol}</p>
                  </div>
                </div>
                <p className="font-bold text-neutral-900 text-sm">{persona.nombre}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-brand-50 border-t border-brand-100">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <h2 className="text-3xl font-extrabold text-brand-900 tracking-tight mb-4">
            Querés ser parte de esta comunidad
          </h2>
          <p className="text-brand-700 mb-8 leading-relaxed">
            Las inscripciones para el ciclo 2027 están abiertas. Completá el formulario y nuestro equipo te contactará.
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
            <Link href="/inscripcion">
              <Button variant="primary" size="lg">Iniciar inscripción <ArrowRight size={18} /></Button>
            </Link>
            <Link href="/contacto">
              <Button variant="outline" size="lg">Consultar</Button>
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
