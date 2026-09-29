'use client'

import { useState } from 'react'
import { CheckCircle, DownloadSimple, Printer, WarningCircle } from '@phosphor-icons/react'
import { Button } from '@/components/ui/Button'
import { EnlaceBoton } from '@/components/ui/EnlaceBoton'

type Estado =
  | { fase: 'reposo' }
  | { fase: 'preparando' }
  | { fase: 'listo'; filas: number; archivo: string }
  | { fase: 'error'; mensaje: string }

const MENSAJE_ERROR_GENERICO =
  'No pudimos exportar el reporte. Volvé a intentarlo en unos minutos; si continúa, avisale al equipo técnico.'

/** Nombre de archivo de la cabecera `Content-Disposition`, o uno de respaldo. */
function nombreDeArchivo(cabecera: string | null): string {
  const coincidencia = cabecera?.match(/filename="([^"]+)"/)
  return coincidencia?.[1] ?? 'reporte.csv'
}

/**
 * Acciones de un reporte: exportar el CSV completo e imprimir (EPT-63).
 *
 * La exportación se hace con `fetch` y no con un enlace directo a propósito: un
 * enlace a un error de la API descargaría un archivo con el mensaje de error
 * como si fuera el reporte. Acá se comprueba el estado de la respuesta y solo
 * una respuesta correcta se guarda; cualquier fallo se explica en pantalla, en
 * español, sin detalles técnicos. El archivo trae todas las filas del conjunto
 * filtrado, no solo la página visible.
 *
 * Imprimir lleva a la vista imprimible, que muestra el conjunto completo con
 * título institucional, fecha y filtros; desde ahí el navegador imprime o guarda
 * como PDF. No hay generador de PDF en el servidor.
 */
export function AccionesReporte({
  urlExportar,
  urlImprimir,
  total,
  conImpresion = true,
}: {
  urlExportar: string
  urlImprimir: string
  total: number
  /** Falso en la vista que rechaza imprimir por tamaño: ahí solo se ofrece el CSV completo. */
  conImpresion?: boolean
}) {
  const [estado, setEstado] = useState<Estado>({ fase: 'reposo' })
  const sinFilas = total === 0

  async function exportar() {
    if (estado.fase === 'preparando') return
    setEstado({ fase: 'preparando' })
    try {
      const respuesta = await fetch(urlExportar, { credentials: 'same-origin', cache: 'no-store' })
      if (!respuesta.ok) {
        let mensaje = MENSAJE_ERROR_GENERICO
        try {
          const cuerpo = (await respuesta.json()) as { error?: unknown }
          if (typeof cuerpo.error === 'string') mensaje = cuerpo.error
        } catch {
          // La respuesta no era JSON: se conserva el mensaje genérico.
        }
        setEstado({ fase: 'error', mensaje })
        return
      }

      const archivo = nombreDeArchivo(respuesta.headers.get('Content-Disposition'))
      const filas = Number(respuesta.headers.get('X-Total-Filas') ?? total)
      const contenido = await respuesta.blob()
      const direccion = URL.createObjectURL(contenido)
      const enlace = document.createElement('a')
      enlace.href = direccion
      enlace.download = archivo
      document.body.appendChild(enlace)
      enlace.click()
      enlace.remove()
      // Se libera después del clic para que el navegador termine de tomar el archivo.
      setTimeout(() => URL.revokeObjectURL(direccion), 10_000)
      setEstado({ fase: 'listo', filas: Number.isFinite(filas) ? filas : total, archivo })
    } catch (problema) {
      // Error de red: el servidor ni siquiera respondió. `warn` y no `error`: la
      // pantalla ya lo explica y el aviso de desarrollo de Next no debe taparla.
      console.warn('[reportes] no se pudo completar la exportación', problema)
      setEstado({ fase: 'error', mensaje: MENSAJE_ERROR_GENERICO })
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          onClick={exportar}
          disabled={sinFilas}
          aria-disabled={sinFilas}
          aria-busy={estado.fase === 'preparando'}
          loading={estado.fase === 'preparando'}
          aria-describedby={sinFilas ? 'acciones-sin-filas' : undefined}
        >
          <DownloadSimple size={18} weight="bold" aria-hidden="true" />
          Exportar CSV
        </Button>
        {conImpresion && (
          <EnlaceBoton href={urlImprimir} variant="outline" aria-describedby={sinFilas ? 'acciones-sin-filas' : undefined}>
            <Printer size={18} weight="bold" aria-hidden="true" />
            Imprimir o guardar como PDF
          </EnlaceBoton>
        )}
      </div>

      {sinFilas && (
        <p id="acciones-sin-filas" className="text-xs text-neutral-500">
          No hay filas para exportar con estos filtros.
        </p>
      )}

      <div role="status" aria-live="polite" className="min-h-0">
        {estado.fase === 'preparando' && (
          <p className="text-sm text-neutral-600">Preparando la exportación de todas las filas…</p>
        )}
        {estado.fase === 'listo' && (
          <p className="flex items-start gap-2 text-sm text-green-800">
            <CheckCircle size={18} weight="fill" className="text-green-600 shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              Exportación lista: {estado.filas.toLocaleString('es-AR')}{' '}
              {estado.filas === 1 ? 'fila' : 'filas'} en «{estado.archivo}».
            </span>
          </p>
        )}
      </div>
      {estado.fase === 'error' && (
        <p role="alert" className="flex items-start gap-2 text-sm text-red-700">
          <WarningCircle size={18} weight="fill" className="text-red-500 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{estado.mensaje}</span>
        </p>
      )}
    </div>
  )
}
