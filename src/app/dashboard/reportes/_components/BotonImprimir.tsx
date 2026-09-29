'use client'

import { Printer } from '@phosphor-icons/react'
import { Button } from '@/components/ui/Button'

/**
 * Abre el diálogo de impresión del navegador (EPT-63). Desde ahí se imprime o se
 * elige «Guardar como PDF». No se abre solo al cargar: quien llega a la vista
 * imprimible primero la revisa.
 */
export function BotonImprimir() {
  return (
    <Button variant="primary" onClick={() => window.print()}>
      <Printer size={18} weight="bold" aria-hidden="true" />
      Imprimir o guardar como PDF
    </Button>
  )
}
