import { cn } from '@/lib/utils'

/**
 * Clases visuales del botón, sin elemento.
 *
 * Existen separadas de `Button` para que un enlace pueda verse como un botón
 * sin envolver un `<button>` dentro de un `<a>`. Esa composición anida dos
 * controles interactivos: el HTML la prohíbe, un lector de pantalla anuncia dos
 * elementos para una sola acción y el tabulador se detiene dos veces.
 *
 * Este módulo no es de cliente, así que lo pueden usar tanto `Button` como
 * `EnlaceBoton`, que se renderiza en el servidor.
 */

export type VarianteDeBoton = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'accent'
export type TamanoDeBoton = 'sm' | 'md' | 'lg'

const variantes: Record<VarianteDeBoton, string> = {
  primary: 'bg-brand-500 text-white hover:bg-brand-600 shadow-sm shadow-brand-500/25',
  secondary: 'bg-neutral-100 text-neutral-800 hover:bg-neutral-200',
  outline: 'border border-brand-500 text-brand-600 hover:bg-brand-50',
  ghost: 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900',
  danger: 'bg-red-500 text-white hover:bg-red-600 shadow-sm shadow-red-500/25',
  accent: 'bg-accent-500 text-white hover:bg-accent-600 shadow-sm shadow-accent-500/25',
}

const tamanos: Record<TamanoDeBoton, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-base gap-2.5',
}

export function estilosDeBoton({
  variante = 'primary',
  tamano = 'md',
  anchoCompleto = false,
  className,
}: {
  variante?: VarianteDeBoton
  tamano?: TamanoDeBoton
  anchoCompleto?: boolean
  className?: string
} = {}) {
  return cn(
    'btn font-semibold rounded-lg transition-all duration-150',
    'disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none',
    variantes[variante],
    tamanos[tamano],
    anchoCompleto && 'w-full',
    className
  )
}
