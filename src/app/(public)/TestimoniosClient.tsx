'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { opinionSchema, OpinionFormData } from '@/lib/validations'
import { crearOpinion } from '@/services/noticias.service'
import { Input, Textarea } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { formatFecha } from '@/lib/utils'

type Opinion = {
  id: number
  nombre_usuario: string
  comentario: string
  fecha: string
}

interface TestimoniosClientProps {
  initialOpiniones: Opinion[]
}

export function TestimoniosClient({ initialOpiniones }: TestimoniosClientProps) {
  const [opiniones] = useState<Opinion[]>(initialOpiniones)
  const [open, setOpen] = useState(false)

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<OpinionFormData>({
    resolver: zodResolver(opinionSchema),
    mode: 'onTouched',
  })

  const comentarioLen = (watch('comentario') ?? '').length

  const onSubmit = async (data: OpinionFormData) => {
    try {
      await crearOpinion(data.nombre_usuario ?? '', data.comentario)
      reset()
      setOpen(false)
      toast.success('¡Gracias! Tu testimonio será revisado por el equipo antes de publicarse.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No pudimos enviar tu testimonio'
      toast.error(message)
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <p className="text-sm text-neutral-500 max-w-2xl">
          Compartí tu experiencia con la comunidad y ayudá a otras familias a conocer la propuesta educativa.
        </p>
        <Button type="button" variant="accent" onClick={() => setOpen(true)}>
          Agregar testimonio
        </Button>
      </div>

      <div className="space-y-6">
        {opiniones.length === 0 ? (
          <div className="bg-white rounded-2xl border border-neutral-200 p-8 text-center text-neutral-500">
            Aun no hay testimonios publicados.
          </div>
        ) : (
          <div className="grid gap-4">
            {opiniones.slice(0, 6).map((opinion) => (
              <div key={opinion.id} className="bg-white rounded-2xl border border-neutral-200 p-6">
                <p className="text-neutral-700 leading-relaxed mb-6">“{opinion.comentario}”</p>
                <div className="flex items-center justify-between text-xs text-neutral-400">
                  <span className="font-semibold text-neutral-600">{opinion.nombre_usuario}</span>
                  <span>{formatFecha(opinion.fecha)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-lg bg-white rounded-2xl border border-neutral-200 p-6 shadow-xl">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-neutral-900">Agregar testimonio</h3>
                <p className="text-sm text-neutral-500">Será revisado por el equipo antes de publicarse.</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-neutral-400 hover:text-neutral-600 text-sm"
              >
                Cerrar
              </button>
            </div>
            <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
              <Input
                label="Nombre (opcional)"
                placeholder="Tu nombre"
                {...register('nombre_usuario')}
                error={errors.nombre_usuario?.message}
              />
              <div>
                <Textarea
                  label="Comentario"
                  rows={5}
                  maxLength={500}
                  placeholder="Contanos tu experiencia..."
                  {...register('comentario')}
                  error={errors.comentario?.message}
                />
                <p className={`text-xs mt-1 text-right ${comentarioLen < 10 || comentarioLen > 500 ? 'text-red-500' : 'text-neutral-400'}`}>
                  {comentarioLen}/500
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" loading={isSubmitting}>
                  Publicar testimonio
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
