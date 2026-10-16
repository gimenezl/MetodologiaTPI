import { FileImage, FilePdf, Receipt } from '@phosphor-icons/react/dist/ssr'
import { formatearFecha, formatearImporteArs } from '@/lib/tarifas'
import type { PagoPendienteVista } from '@/services/comprobantes-lectura.service'

const ZONA = 'America/Argentina/Buenos_Aires'

function formatearInstante(iso: string): string {
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return iso
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: ZONA,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(fecha)
}

function formatearTamano(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
}

const NOMBRE_TIPO: Record<string, string> = {
  'image/jpeg': 'Imagen JPG',
  'image/png': 'Imagen PNG',
  'application/pdf': 'PDF',
}

/** Compara dos importes decimales exactos sin pasarlos por `number`. */
function difiere(a: string, b: string | null): boolean {
  if (b === null) return false
  const norm = (v: string) => {
    const [e, d = ''] = v.split('.')
    return `${e.replace(/^0+(?=\d)/u, '')}.${d.padEnd(2, '0')}`
  }
  return norm(a) !== norm(b)
}

/**
 * Lista de pagos pendientes de verificación con sus comprobantes. Presentación
 * pura (componente de servidor): no aprueba ni rechaza nada.
 */
export function PagosPendientes({
  pagos,
  truncado,
}: {
  pagos: PagoPendienteVista[]
  truncado: boolean
}) {
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-neutral-900 tracking-tight">Comprobantes</h1>
        <p className="text-neutral-500 text-sm mt-1">
          Pagos pendientes de verificación y los archivos que cargó cada familia. Este listado es
          de solo lectura: la aprobación o el rechazo se habilitan en otra etapa.
        </p>
      </div>

      {pagos.length === 0 ? (
        <div className="bg-white rounded-2xl border border-neutral-200 p-8 text-center">
          <Receipt size={32} className="mx-auto text-neutral-400" aria-hidden="true" />
          <p className="mt-3 text-sm font-semibold text-neutral-800">
            No hay pagos pendientes de verificación
          </p>
        </div>
      ) : (
        <ul className="space-y-4" aria-label="Pagos pendientes de verificación">
          {pagos.map((pago) => {
            const distinto = difiere(pago.totalCalculado, pago.importeInformado)
            return (
              <li
                key={pago.pagoId}
                data-testid={`pago-${pago.pagoId}`}
                className="bg-white rounded-2xl border border-neutral-200 p-5 space-y-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-base font-bold text-neutral-900">{pago.alumno}</h2>
                    <p className="text-xs text-neutral-500">
                      Pago registrado el {formatearInstante(pago.creadoEn)}
                    </p>
                  </div>
                  <span className="inline-flex items-center rounded-full bg-yellow-50 border border-yellow-200 px-2.5 py-0.5 text-xs font-semibold text-yellow-700">
                    Pendiente de verificación
                  </span>
                </div>

                <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
                  <div>
                    <dt className="text-xs font-semibold text-neutral-500">Total calculado</dt>
                    <dd className="text-neutral-900">{formatearImporteArs(pago.totalCalculado)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold text-neutral-500">Importe informado</dt>
                    <dd className="text-neutral-900">
                      {pago.importeInformado === null
                        ? 'Sin informar'
                        : formatearImporteArs(pago.importeInformado)}
                      {distinto && (
                        <span className="ml-2 text-xs font-semibold text-amber-700">
                          Distinto del total calculado
                        </span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold text-neutral-500">Fecha de la transferencia</dt>
                    <dd className="text-neutral-900">
                      {pago.fechaTransferencia === null
                        ? 'Sin informar'
                        : formatearFecha(pago.fechaTransferencia)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold text-neutral-500">Número de operación</dt>
                    <dd className="text-neutral-900 break-all">
                      {pago.numeroOperacion ?? 'Sin informar'}
                    </dd>
                  </div>
                </dl>

                <div>
                  <h3 className="text-xs font-semibold text-neutral-500">
                    Comprobantes ({pago.archivos.length})
                  </h3>
                  {pago.archivos.length === 0 ? (
                    <p className="text-sm text-neutral-600 mt-1">
                      Todavía no se cargó ningún comprobante.
                    </p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {pago.archivos.map((archivo, i) => {
                        const Icono = archivo.tipoMime === 'application/pdf' ? FilePdf : FileImage
                        const nombre = NOMBRE_TIPO[archivo.tipoMime] ?? 'Archivo'
                        return (
                          <li key={archivo.id}>
                            <a
                              href={`/api/comprobantes/${archivo.id}/archivo`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-neutral-200 px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-neutral-50"
                            >
                              <Icono size={20} aria-hidden="true" />
                              <span>
                                Ver comprobante {i + 1} · {nombre} · {formatearTamano(archivo.tamanoBytes)}
                              </span>
                              <span className="sr-only"> (se abre en una pestaña nueva)</span>
                            </a>
                            <span className="ml-2 text-xs text-neutral-500">
                              Cargado el {formatearInstante(archivo.creadoEn)}
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {truncado && (
        <p role="status" className="text-sm text-neutral-600">
          Se muestran los 200 pagos pendientes más recientes.
        </p>
      )}
    </div>
  )
}
