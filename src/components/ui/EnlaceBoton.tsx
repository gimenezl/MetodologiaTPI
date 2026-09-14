import Link from 'next/link'
import type { ComponentProps } from 'react'
import {
  estilosDeBoton,
  type TamanoDeBoton,
  type VarianteDeBoton,
} from '@/components/ui/estilosDeBoton'

type EnlaceBotonProps = Omit<ComponentProps<typeof Link>, 'className'> & {
  variant?: VarianteDeBoton
  size?: TamanoDeBoton
  fullWidth?: boolean
  className?: string
}

/**
 * Un enlace de navegación con aspecto de botón.
 *
 * Es UN solo control: un `<a>`. Reemplaza la composición `<Link><Button /></Link>`,
 * que producía un `<button>` dentro de un `<a>`: dos controles interactivos
 * anidados, un nombre accesible duplicado y dos paradas de tabulador para una
 * misma acción. Navega con Enter como cualquier enlace.
 */
export function EnlaceBoton({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className,
  ...props
}: EnlaceBotonProps) {
  return (
    <Link
      {...props}
      className={estilosDeBoton({
        variante: variant,
        tamano: size,
        anchoCompleto: fullWidth,
        className,
      })}
    />
  )
}
