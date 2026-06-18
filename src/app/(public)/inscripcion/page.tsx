'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { CheckCircle, ArrowLeft, ArrowRight } from '@phosphor-icons/react'
import { inscripcionSchema, InscripcionFormData } from '@/lib/validations'
import { crearSolicitudInscripcion } from '@/services/inscripciones.service'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { ACTIVIDADES_DEPORTIVAS } from '@/lib/utils'

const STEPS = ['Datos del aspirante', 'Información de contacto', 'Responsable legal']

export default function InscripcionPage() {
  const [step, setStep] = useState(0)
  const [submitted, setSubmitted] = useState(false)

  const {
    register,
    handleSubmit,
    trigger,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<InscripcionFormData>({
    resolver: zodResolver(inscripcionSchema),
    mode: 'onTouched',
    defaultValues: { actividades_interes: [] },
  })

  const actividadesInteres = watch('actividades_interes') ?? []
  const infoAdicional = watch('informacion_adicional') ?? ''

  // Rango de fechas válidas para el aspirante (entre 2 y 20 años)
  const hoy = new Date()
  const maxFechaNac = new Date(hoy.getFullYear() - 2, hoy.getMonth(), hoy.getDate())
    .toISOString().split('T')[0]
  const minFechaNac = new Date(hoy.getFullYear() - 20, hoy.getMonth(), hoy.getDate())
    .toISOString().split('T')[0]

  const stepFields: (keyof InscripcionFormData)[][] = [
    ['nombre', 'apellido', 'dni', 'fecha_nacimiento', 'nivel'],
    ['email', 'telefono', 'direccion'],
    ['nombre_responsable', 'apellido_responsable', 'dni_responsable', 'telefono_responsable', 'relacion_responsable', 'acepta_terminos'],
  ]

  const handleNext = async () => {
    const valid = await trigger(stepFields[step] as any)
    if (valid) setStep((s) => s + 1)
  }

  const handleBack = () => setStep((s) => s - 1)

  const toggleActividad = (act: string) => {
    const current = actividadesInteres
    if (current.includes(act)) {
      setValue('actividades_interes', current.filter((a) => a !== act))
    } else {
      setValue('actividades_interes', [...current, act])
    }
  }

  const onSubmit = async (data: InscripcionFormData) => {
    try {
      await crearSolicitudInscripcion(data as any)
      setSubmitted(true)
    } catch (err) {
      toast.error('Hubo un error al enviar la solicitud. Intentá de nuevo.')
    }
  }

  if (submitted) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-neutral-50 px-4 pt-16">
        <div className="max-w-md w-full text-center py-16">
          <div className="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle size={44} weight="fill" className="text-green-500" />
          </div>
          <h1 className="text-2xl font-extrabold text-neutral-900 mb-3">
            Solicitud enviada con éxito
          </h1>
          <p className="text-neutral-600 leading-relaxed">
            Recibimos tu pre-inscripción. Nuestro equipo la revisará y te contactará dentro de las próximas 48 horas hábiles.
          </p>
          <div className="mt-8 p-4 bg-brand-50 border border-brand-200 rounded-xl text-sm text-brand-700">
            Podés seguir el estado de tu solicitud comunicándote al{' '}
            <a href="tel:+5493624123456" className="font-semibold hover:underline">
              +54 9 362 412-3456
            </a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-[100dvh] bg-neutral-50 pt-24 pb-16 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-10">
          <p className="text-brand-600 font-semibold text-sm uppercase tracking-widest mb-2">
            Pre-inscripción 2027
          </p>
          <h1 className="text-3xl md:text-4xl font-extrabold text-neutral-900 tracking-tight">
            Formulario de inscripción
          </h1>
          <p className="mt-2 text-neutral-500 text-sm">
            Completá los 3 pasos del formulario. Todos los campos marcados con{' '}
            <span className="text-red-500">*</span> son obligatorios.
          </p>
        </div>

        {/* Stepper */}
        <div className="flex items-center gap-0 mb-10" role="list" aria-label="Pasos del formulario">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center flex-1" role="listitem">
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    'w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-300',
                    i < step && 'bg-green-500 text-white',
                    i === step && 'bg-brand-500 text-white ring-4 ring-brand-100',
                    i > step && 'bg-neutral-200 text-neutral-500'
                  )}
                  aria-current={i === step ? 'step' : undefined}
                >
                  {i < step ? <CheckCircle size={16} weight="fill" /> : i + 1}
                </div>
                <span
                  className={cn(
                    'text-xs mt-1.5 font-medium hidden sm:block',
                    i === step ? 'text-brand-600' : 'text-neutral-400'
                  )}
                >
                  {label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={cn(
                    'flex-1 h-0.5 mb-5 mx-2 rounded-full transition-all duration-300',
                    i < step ? 'bg-green-400' : 'bg-neutral-200'
                  )}
                  aria-hidden="true"
                />
              )}
            </div>
          ))}
        </div>

        {/* Form card */}
        <div className="bg-white rounded-2xl border border-neutral-200 p-6 md:p-8 shadow-sm">
          <form onSubmit={handleSubmit(onSubmit)} noValidate>

            {/* STEP 1 */}
            {step === 0 && (
              <div className="space-y-5">
                <h2 className="text-lg font-bold text-neutral-900 mb-6">Datos del aspirante</h2>
                <div className="grid sm:grid-cols-2 gap-4">
                  <Input
                    label="Nombre"
                    required
                    placeholder="Juan Martín"
                    {...register('nombre')}
                    error={errors.nombre?.message}
                  />
                  <Input
                    label="Apellido"
                    required
                    placeholder="González"
                    {...register('apellido')}
                    error={errors.apellido?.message}
                  />
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <Input
                    label="DNI"
                    required
                    placeholder="12345678"
                    maxLength={8}
                    {...register('dni')}
                    error={errors.dni?.message}
                    helperText="Solo números, sin puntos ni guiones"
                  />
                  <Input
                    label="Fecha de nacimiento"
                    type="date"
                    required
                    min={minFechaNac}
                    max={maxFechaNac}
                    {...register('fecha_nacimiento')}
                    error={errors.fecha_nacimiento?.message}
                    helperText="El aspirante debe tener entre 2 y 20 años"
                  />
                </div>
                <Select
                  label="Nivel al que desea inscribirse"
                  required
                  placeholder="Seleccionar nivel..."
                  options={[
                    { value: 'INICIAL', label: 'Inicial (3 a 5 años)' },
                    { value: 'PRIMARIO', label: 'Primario (6 a 12 años)' },
                    { value: 'SECUNDARIO', label: 'Secundario (13 a 17 años)' },
                  ]}
                  {...register('nivel')}
                  error={errors.nivel?.message}
                />
              </div>
            )}

            {/* STEP 2 */}
            {step === 1 && (
              <div className="space-y-5">
                <h2 className="text-lg font-bold text-neutral-900 mb-6">Información de contacto</h2>
                <Input
                  label="Email"
                  type="email"
                  required
                  placeholder="contacto@ejemplo.com"
                  {...register('email')}
                  error={errors.email?.message}
                />
                <Input
                  label="Teléfono"
                  type="tel"
                  required
                  placeholder="0362 4123456"
                  {...register('telefono')}
                  error={errors.telefono?.message}
                />
                <Input
                  label="Dirección"
                  required
                  placeholder="Av. Belgrano 1234, Resistencia"
                  {...register('direccion')}
                  error={errors.direccion?.message}
                />

                {/* Actividades de interés */}
                <div>
                  <p className="text-sm font-semibold text-neutral-700 mb-3">
                    Actividades de interés (opcional)
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {ACTIVIDADES_DEPORTIVAS.map((act) => (
                      <button
                        key={act}
                        type="button"
                        onClick={() => toggleActividad(act)}
                        className={cn(
                          'px-3 py-1.5 rounded-full text-xs font-semibold border transition-all duration-150',
                          actividadesInteres.includes(act)
                            ? 'bg-brand-500 text-white border-brand-500'
                            : 'bg-white text-neutral-600 border-neutral-300 hover:border-brand-400 hover:text-brand-600'
                        )}
                      >
                        {act}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* STEP 3 */}
            {step === 2 && (
              <div className="space-y-5">
                <h2 className="text-lg font-bold text-neutral-900 mb-6">Responsable legal</h2>
                <div className="grid sm:grid-cols-2 gap-4">
                  <Input
                    label="Nombre del responsable"
                    required
                    placeholder="María Elena"
                    {...register('nombre_responsable')}
                    error={errors.nombre_responsable?.message}
                  />
                  <Input
                    label="Apellido del responsable"
                    required
                    placeholder="González"
                    {...register('apellido_responsable')}
                    error={errors.apellido_responsable?.message}
                  />
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <Input
                    label="DNI del responsable"
                    required
                    placeholder="28456123"
                    maxLength={8}
                    {...register('dni_responsable')}
                    error={errors.dni_responsable?.message}
                  />
                  <Input
                    label="Teléfono del responsable"
                    required
                    placeholder="0362 4123456"
                    {...register('telefono_responsable')}
                    error={errors.telefono_responsable?.message}
                  />
                </div>
                <Select
                  label="Relación con el aspirante"
                  required
                  placeholder="Seleccionar..."
                  options={[
                    { value: 'PADRE', label: 'Padre' },
                    { value: 'MADRE', label: 'Madre' },
                    { value: 'TUTOR', label: 'Tutor/a legal' },
                  ]}
                  {...register('relacion_responsable')}
                  error={errors.relacion_responsable?.message}
                />
                <div>
                  <Textarea
                    label="Información adicional (opcional)"
                    placeholder="Necesidades especiales, condiciones médicas relevantes, etc."
                    rows={3}
                    maxLength={500}
                    {...register('informacion_adicional')}
                    error={errors.informacion_adicional?.message}
                  />
                  <p className={cn(
                    'text-xs mt-1 text-right',
                    infoAdicional.length > 500 ? 'text-red-600 font-semibold' : 'text-neutral-400'
                  )}>
                    {infoAdicional.length}/500 caracteres
                  </p>
                </div>

                {/* Términos */}
                <label className="flex items-start gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    className="mt-0.5 w-4 h-4 rounded border-neutral-300 accent-brand-500 cursor-pointer"
                    {...register('acepta_terminos')}
                  />
                  <span className="text-sm text-neutral-600 leading-relaxed">
                    Acepto los{' '}
                    <a href="#" className="text-brand-600 hover:underline font-medium">
                      términos y condiciones
                    </a>{' '}
                    y la política de privacidad del centro educativo.
                    <span className="text-red-500 ml-0.5">*</span>
                  </span>
                </label>
                {errors.acepta_terminos && (
                  <p className="text-xs text-red-600 -mt-2">{errors.acepta_terminos.message}</p>
                )}
              </div>
            )}

            {/* Navigation */}
            <div className="flex justify-between mt-8 pt-6 border-t border-neutral-100">
              {step > 0 ? (
                <Button type="button" variant="ghost" onClick={handleBack}>
                  <ArrowLeft size={16} /> Anterior
                </Button>
              ) : <div />}

              {step < STEPS.length - 1 ? (
                <Button type="button" onClick={handleNext}>
                  Siguiente <ArrowRight size={16} />
                </Button>
              ) : (
                <Button type="submit" loading={isSubmitting}>
                  Enviar solicitud
                </Button>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
