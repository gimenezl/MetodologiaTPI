'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Briefcase, CheckCircle, ArrowRight, PaperPlaneTilt, Clock } from '@phosphor-icons/react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { crearPostulacion } from '@/services/postulaciones.service'

const empleoSchema = z.object({
  nombre: z.string().min(2, 'Campo requerido'),
  apellido: z.string().min(2, 'Campo requerido'),
  email: z.string().email('Email inválido'),
  telefono: z.string().min(8, 'Teléfono inválido'),
  puesto: z.string().min(1, 'Seleccioná un puesto'),
  mensaje: z.string().min(20, 'Mínimo 20 caracteres').max(800),
})
type EmpleoForm = z.infer<typeof empleoSchema>

const puestos = [
  'Docente de Nivel Inicial',
  'Docente de Nivel Primario',
  'Docente de Nivel Secundario (Matemáticas)',
  'Docente de Nivel Secundario (Lengua)',
  'Docente de Educación Física',
  'Psicólogo/a Educacional',
  'Auxiliar de Educación',
  'Personal Administrativo',
  'Nutricionista',
  'Otro puesto',
]

const beneficios = [
  'Proyecto educativo de vanguardia desde 2027',
  'Formación y capacitación continua',
  'Equipo interdisciplinario colaborativo',
  'Salario competitivo con escala según convenio',
  'Obra social de primer nivel',
  'Jornada laboral con recreos y pausas activas',
]

export default function EmpleoPage() {
  const [enviado, setEnviado] = useState(false)
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } =
    useForm<EmpleoForm>({ resolver: zodResolver(empleoSchema), mode: 'onTouched' })

  const onSubmit = async (data: EmpleoForm) => {
    try {
      await crearPostulacion(data)
      setEnviado(true)
      reset()
      toast.success('¡Postulación enviada!')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No pudimos enviar la postulación'
      toast.error(message)
    }
  }

  return (
    <>
      {/* Hero */}
      <section className="pt-24 pb-16 bg-gradient-to-br from-brand-900 to-indigo-900 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: "url('/bienestar-hero.png')", backgroundSize: 'cover', backgroundPosition: 'center 60%' }} aria-hidden="true" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 mb-6">
              <Briefcase size={20} weight="fill" className="text-accent-400" />
              <span className="text-brand-300 text-sm font-semibold uppercase tracking-widest">Sumate al equipo</span>
            </div>
            <h1 className="text-5xl font-extrabold text-white tracking-tight text-balance">Trabajá con nosotros y transformá vidas</h1>
            <p className="mt-6 text-brand-200 leading-relaxed max-w-[52ch]">
              Buscamos docentes y profesionales comprometidos con un proyecto educativo único. Abrimos convocatoria para el ciclo 2027.
            </p>
            <div className="flex items-center gap-2 mt-6 px-4 py-2.5 bg-brand-800/50 border border-brand-700 rounded-full w-fit">
              <Clock size={14} className="text-accent-400" />
              <span className="text-brand-300 text-xs font-semibold">Convocatoria abierta — Inicio de clases Marzo 2027</span>
            </div>
          </div>
        </div>
      </section>

      {/* Beneficios */}
      <section className="py-16 bg-white border-b border-neutral-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {beneficios.map((b) => (
              <div key={b} className="flex items-start gap-3 p-4 bg-neutral-50 rounded-xl border border-neutral-200">
                <CheckCircle size={18} weight="fill" className="text-brand-500 mt-0.5 shrink-0" />
                <p className="text-sm text-neutral-700 font-medium">{b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Formulario */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid lg:grid-cols-2 gap-16">
          <div>
            <h2 className="text-3xl font-extrabold text-neutral-900 tracking-tight mb-4">Postulate ahora</h2>
            <p className="text-neutral-600 leading-relaxed mb-8">Completá el formulario y nos pondremos en contacto en los próximos días.</p>

            {enviado ? (
              <div className="bg-brand-50 border border-brand-200 rounded-2xl p-8 text-center">
                <div className="w-16 h-16 bg-brand-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <PaperPlaneTilt size={32} weight="fill" className="text-brand-600" />
                </div>
                <h3 className="text-xl font-bold text-brand-900 mb-2">¡Postulación recibida!</h3>
                <p className="text-brand-700 text-sm mb-6">Revisaremos tu perfil y te contactaremos dentro de los próximos 5 días hábiles.</p>
                <button onClick={() => setEnviado(false)} className="text-sm font-semibold text-brand-600 hover:text-brand-800 underline">Enviar otra postulación</button>
              </div>
            ) : (
              <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
                <div className="grid sm:grid-cols-2 gap-4">
                  <Input label="Nombre" type="text" required placeholder="María" {...register('nombre')} error={errors.nombre?.message} />
                  <Input label="Apellido" type="text" required placeholder="González" {...register('apellido')} error={errors.apellido?.message} />
                </div>
                <Input label="Email" type="email" required placeholder="tu@email.com" {...register('email')} error={errors.email?.message} />
                <Input label="Teléfono" type="tel" required placeholder="+54 362 4..." {...register('telefono')} error={errors.telefono?.message} />

                <div className="space-y-1.5">
                  <label className="block text-sm font-semibold text-neutral-700">Puesto de interés <span className="text-red-500 ml-0.5">*</span></label>
                  <select {...register('puesto')}
                    className={`w-full h-10 px-3 rounded-lg border text-sm focus:outline-none focus:ring-2 transition-all bg-white
                      ${errors.puesto ? 'border-red-300 focus:ring-red-500/20' : 'border-neutral-200 focus:ring-brand-500/20 focus:border-brand-400'}`}>
                    <option value="">Seleccioná un puesto...</option>
                    {puestos.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                  {errors.puesto && <p className="text-xs text-red-500">{errors.puesto.message}</p>}
                </div>

                <div className="space-y-1.5">
                  <label className="block text-sm font-semibold text-neutral-700">Presentación y experiencia <span className="text-red-500 ml-0.5">*</span></label>
                  <textarea rows={5} placeholder="Contanos sobre tu experiencia docente, formación y motivación..." {...register('mensaje')}
                    className={`w-full px-3.5 py-2.5 rounded-lg border text-sm focus:outline-none focus:ring-2 transition-all resize-none
                      ${errors.mensaje ? 'border-red-300 focus:ring-red-500/20' : 'border-neutral-200 focus:ring-brand-500/20 focus:border-brand-400'}`} />
                  {errors.mensaje && <p className="text-xs text-red-500">{errors.mensaje.message}</p>}
                </div>

                <Button type="submit" fullWidth loading={isSubmitting}>
                  <PaperPlaneTilt size={16} weight="fill" />
                  Enviar postulación
                </Button>
              </form>
            )}
          </div>

          {/* Info lateral */}
          <div className="space-y-8">
            <div className="bg-neutral-50 rounded-2xl border border-neutral-200 p-7">
              <h3 className="font-bold text-neutral-900 mb-4 text-lg">Puestos disponibles</h3>
              <ul className="space-y-3">
                {puestos.slice(0, 7).map((p) => (
                  <li key={p} className="flex items-center gap-3 text-sm text-neutral-700">
                    <ArrowRight size={14} className="text-brand-400 shrink-0" />
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          </div>

        </div>
      </div>
    </>
  )
}
