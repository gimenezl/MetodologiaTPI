'use client'

import { cn } from '@/lib/utils'
import { MOTIVO_CAMBIO_MAXIMO, MOTIVO_CAMBIO_MINIMO } from '@/lib/validations'

/** Largo del motivo tal como lo mide la base: espacios colapsados y recortados. */
export function largoDelMotivo(motivo: string): number {
  return Array.from(motivo.replace(/\s+/gu, ' ').trim()).length
}

export function motivoValido(motivo: string): boolean {
  const largo = largoDelMotivo(motivo)
  return largo >= MOTIVO_CAMBIO_MINIMO && largo <= MOTIVO_CAMBIO_MAXIMO
}

/**
 * Motivo obligatorio de un cambio de rol o de acceso (EPT-59): de 5 a 500
 * caracteres, con contador visible y anunciado junto al campo.
 */
export function CampoMotivo({
  id,
  valor,
  onCambio,
  error,
  disabled,
}: {
  id: string
  valor: string
  onCambio: (valor: string) => void
  error?: string | null
  disabled?: boolean
}) {
  const largo = largoDelMotivo(valor)
  const idContador = `${id}-contador`
  const idError = `${id}-error`
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-neutral-700">
        Motivo<span className="text-red-600 ml-0.5">*</span>
      </label>
      <textarea
        id={id}
        value={valor}
        onChange={(evento) => onCambio(evento.target.value)}
        rows={3}
        maxLength={MOTIVO_CAMBIO_MAXIMO + 100}
        required
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${idError} ${idContador}` : idContador}
        className={cn(
          'px-3 py-2.5 rounded-lg border bg-white text-neutral-900 text-sm resize-y',
          'focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500',
          error ? 'border-red-400' : 'border-neutral-200 hover:border-neutral-300'
        )}
      />
      <div className="flex flex-wrap justify-between gap-2 text-xs">
        {error ? (
          <p id={idError} role="alert" className="text-red-700">
            {error}
          </p>
        ) : (
          <span />
        )}
        <p
          id={idContador}
          className={cn(largo > MOTIVO_CAMBIO_MAXIMO ? 'text-red-700' : 'text-neutral-600')}
        >
          {largo} de {MOTIVO_CAMBIO_MAXIMO} caracteres (mínimo {MOTIVO_CAMBIO_MINIMO})
        </p>
      </div>
    </div>
  )
}
