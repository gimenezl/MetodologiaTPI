import { Clock } from '@phosphor-icons/react/dist/ssr'
import { describirFranja, describirFranjaBreve, type Franja } from '@/lib/horarios'
import { cn } from '@/lib/utils'

/**
 * Franjas semanales de un grupo en formato compacto (EPT-12). Cada franja se
 * lee visualmente como «Lunes · 10:00 a 11:00» y, para lectores de pantalla,
 * como frase completa («lunes de 10:00 a 11:00»).
 */
export function ListaFranjas({ franjas, className }: { franjas: Franja[]; className?: string }) {
  if (franjas.length === 0) {
    return (
      <p className={cn('text-xs text-amber-800', className)}>Sin horarios cargados todavía.</p>
    )
  }

  return (
    <div className={className}>
      <p className="text-xs font-semibold text-neutral-500 flex items-center gap-1">
        <Clock size={14} aria-hidden="true" />
        Horarios
      </p>
      <ul className="mt-1 flex flex-wrap gap-1.5">
        {franjas.map((franja) => (
          <li
            key={`${franja.dia_semana}-${franja.hora_inicio}-${franja.hora_fin}`}
            className="text-xs text-neutral-800 bg-neutral-100 rounded-md px-2 py-0.5"
          >
            <span aria-hidden="true">{describirFranjaBreve(franja)}</span>
            <span className="sr-only">{describirFranja(franja)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
