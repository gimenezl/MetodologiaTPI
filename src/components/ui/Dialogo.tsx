'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { X } from '@phosphor-icons/react'

const SELECTOR_ENFOCABLES =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Diálogo modal accesible: foco inicial declarado, contención del foco con
 * Tab y Shift+Tab, cierre con Escape y devolución del foco al disparador.
 *
 * Es el mismo contrato de accesibilidad que ya cumplían los diálogos de niveles
 * (EPT-55) y de materias (EPT-56), extraído acá para que EPT-10 no necesite una
 * tercera copia. Esas dos pantallas conservan su copia local a propósito:
 * migrarlas es un cambio de comportamiento que no pertenece a esta historia y
 * que no debe arriesgar sus pruebas. Unificar las tres queda como trabajo de
 * consolidación (EPT-66).
 */
export function Dialogo({
  tituloId,
  titulo,
  descripcion,
  selectorFocoInicial,
  onCerrar,
  children,
}: {
  tituloId: string
  titulo: string
  descripcion?: string
  selectorFocoInicial: string
  onCerrar: () => void
  children: ReactNode
}) {
  const contenedor = useRef<HTMLDivElement>(null)
  const focoPrevio = useRef<HTMLElement | null>(null)
  const onCerrarRef = useRef(onCerrar)

  useEffect(() => {
    onCerrarRef.current = onCerrar
  }, [onCerrar])

  useEffect(() => {
    focoPrevio.current = document.activeElement as HTMLElement | null
    const cuadro = contenedor.current
    const focoInicial =
      cuadro?.querySelector<HTMLElement>(selectorFocoInicial) ??
      cuadro?.querySelector<HTMLElement>(SELECTOR_ENFOCABLES)
    focoInicial?.focus()

    function alPresionarTecla(evento: KeyboardEvent) {
      if (evento.key === 'Escape') {
        evento.preventDefault()
        onCerrarRef.current()
        return
      }
      if (evento.key !== 'Tab') return

      const enfocables = Array.from(
        cuadro?.querySelectorAll<HTMLElement>(SELECTOR_ENFOCABLES) ?? []
      )
      if (enfocables.length === 0) return

      const primero = enfocables[0]
      const ultimo = enfocables[enfocables.length - 1]
      const activo = document.activeElement

      if (evento.shiftKey && (activo === primero || !cuadro?.contains(activo))) {
        evento.preventDefault()
        ultimo.focus()
      } else if (!evento.shiftKey && (activo === ultimo || !cuadro?.contains(activo))) {
        evento.preventDefault()
        primero.focus()
      }
    }

    document.addEventListener('keydown', alPresionarTecla)
    return () => {
      document.removeEventListener('keydown', alPresionarTecla)
      focoPrevio.current?.focus()
    }
  }, [selectorFocoInicial])

  const descripcionId = descripcion ? `${tituloId}-descripcion` : undefined

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8 overflow-y-auto">
      <div
        className="absolute inset-0 bg-neutral-950/40 backdrop-blur-sm"
        onClick={() => onCerrarRef.current()}
        aria-hidden="true"
      />
      <div
        ref={contenedor}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        aria-describedby={descripcionId}
        className="relative w-full max-w-lg bg-white rounded-2xl border border-neutral-200 shadow-xl my-auto"
      >
        <div className="flex items-center justify-between gap-3 px-5 sm:px-6 py-4 border-b border-neutral-100">
          <h2 id={tituloId} className="font-bold text-neutral-900 min-w-0 break-words">
            {titulo}
          </h2>
          <button
            type="button"
            onClick={() => onCerrarRef.current()}
            aria-label="Cerrar diálogo"
            className="text-neutral-400 hover:text-neutral-600 p-1 rounded-lg hover:bg-neutral-100 transition-colors shrink-0"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-5 sm:px-6 py-5 max-h-[70vh] overflow-y-auto">
          {descripcion && (
            <p id={descripcionId} className="text-sm text-neutral-600 leading-relaxed mb-4">
              {descripcion}
            </p>
          )}
          {children}
        </div>
      </div>
    </div>
  )
}
