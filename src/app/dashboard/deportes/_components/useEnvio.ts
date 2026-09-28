'use client'

import { useCallback, useRef, useState } from 'react'

/**
 * Cerrojo anti doble envío para una operación de la dirección.
 *
 * Un estado de React no alcanza: dos clics dentro del mismo cuadro de
 * renderizado leen el mismo valor anterior. Un `ref` cambia al instante, así que
 * la segunda llamada encuentra el cerrojo tomado y no hace nada. `enviando` es
 * solo para la presentación (botones deshabilitados y texto de progreso).
 */
export function useEnvio() {
  const tomado = useRef(false)
  const [enviando, setEnviando] = useState(false)

  const ejecutar = useCallback(async (operacion: () => Promise<void>) => {
    if (tomado.current) return
    tomado.current = true
    setEnviando(true)
    try {
      await operacion()
    } finally {
      tomado.current = false
      setEnviando(false)
    }
  }, [])

  return { enviando, ejecutar }
}
