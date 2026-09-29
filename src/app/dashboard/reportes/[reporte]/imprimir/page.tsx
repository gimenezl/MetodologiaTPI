import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { fechaHora } from '@/components/inscripciones/formato'
import {
  REPORTES,
  describirFiltros,
  esIdReporte,
  leerFiltros,
  parametrosDeUrl,
  type ParametrosCrudos,
} from '@/lib/reportes'
import { requerirDirector } from '@/services/autorizacion'
import { MAXIMO_FILAS_PARA_IMPRIMIR, leerCatalogos, leerReporteCompleto } from '@/services/reportes.service'
import { BotonImprimir } from '../../_components/BotonImprimir'
import { PanelErrorLectura, PanelImpresionExcedida, PanelRestringido } from '../../_components/Paneles'
import { TablaReporte } from '../../_components/TablaReporte'

export const metadata: Metadata = {
  title: 'Reporte para imprimir | Panel',
}

export const dynamic = 'force-dynamic'

const MENSAJE_NO_AUTORIZADO = 'Solo Dirección puede consultar los reportes oficiales.'
const NUMERO = new Intl.NumberFormat('es-AR')

/**
 * Vista imprimible de un reporte oficial (EPT-63, RF17). El navegador imprime o
 * guarda como PDF desde acá; no hay generador de PDF en el servidor.
 *
 * A diferencia de la pantalla, muestra el conjunto filtrado COMPLETO —todas las
 * páginas—, con el título institucional, la fecha y hora de emisión y los filtros
 * aplicados, para que una hoja impresa se pueda interpretar sin la pantalla.
 * Hasta `MAXIMO_FILAS_PARA_IMPRIMIR` filas; por encima se explica con el total
 * exacto y se ofrece acotar o exportar. Nunca imprime un listado recortado
 * como si fuera completo.
 *
 * Las reglas `print:` de Tailwind y la hoja de estilo de abajo ocultan el
 * armazón del panel (menú, encabezado) y repiten los encabezados de columna en
 * cada hoja.
 */
export default async function ImprimirReportePage({
  params,
  searchParams,
}: {
  params: Promise<{ reporte: string }>
  searchParams: Promise<ParametrosCrudos>
}) {
  const autorizacion = await requerirDirector(MENSAJE_NO_AUTORIZADO)
  if (!autorizacion.autorizado) {
    return (
      <PanelRestringido
        mensaje={autorizacion.mensaje}
        accion={autorizacion.estado === 401 ? { href: '/login', texto: 'Iniciar sesión' } : undefined}
      />
    )
  }

  const { reporte: idPedido } = await params
  if (!esIdReporte(idPedido)) notFound()
  const reporte = REPORTES[idPedido]
  const base = `/dashboard/reportes/${reporte.id}`

  const parametros = leerFiltros(reporte, await searchParams)
  if (!parametros.ok) {
    return (
      <PanelErrorLectura
        titulo={reporte.titulo}
        mensaje={parametros.errores.map((error) => error.mensaje).join(' ')}
        reintentar={base}
      />
    )
  }

  // La impresión no pagina: `pagina` y `tamano` de la pantalla no aplican.
  const filtros = parametros.filtros
  const volver = `${base}?${parametrosDeUrl(filtros).toString()}`

  const [catalogos, lectura] = await Promise.all([
    leerCatalogos(),
    leerReporteCompleto(reporte.id, filtros, { maximoFilas: MAXIMO_FILAS_PARA_IMPRIMIR }),
  ])

  const aplicados = describirFiltros(reporte, filtros, catalogos.ok ? catalogos.datos : null)

  if (!lectura.ok) {
    // Más filas que el máximo imprimible: no es un fallo, se ofrece acotar o exportar todo.
    if (lectura.codigo === 'DEMASIADAS_FILAS' && lectura.total !== undefined) {
      const parametrosExportacion = parametrosDeUrl(filtros).toString()
      return (
        <PanelImpresionExcedida
          titulo={reporte.titulo}
          mensaje={lectura.mensaje}
          total={lectura.total}
          filtros={aplicados}
          urlExportar={`/api/reportes/${reporte.id}/exportar${parametrosExportacion ? `?${parametrosExportacion}` : ''}`}
          volver={volver}
        />
      )
    }
    return <PanelErrorLectura titulo={reporte.titulo} mensaje={lectura.mensaje} reintentar={volver} />
  }

  const { filas, total } = lectura.datos
  const emitido = fechaHora(new Date().toISOString())

  return (
    <div className="max-w-6xl mx-auto space-y-6 print:max-w-none print:space-y-3">
      {/* Hoja apaisada y con márgenes chicos: los reportes tienen muchas columnas.
          Los encabezados de columna se repiten en cada hoja y una fila no se parte. */}
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 10mm; }
          thead { display: table-header-group; }
          tr { break-inside: avoid; }
          body { background: #fff !important; }
        }
      `}</style>

      <div className="print:hidden flex flex-wrap items-center justify-between gap-3">
        <Link href={volver} className="text-sm font-semibold text-brand-700 underline underline-offset-4">
          Volver al reporte
        </Link>
        <BotonImprimir />
      </div>

      <article aria-labelledby="titulo-impresion" className="space-y-4 print:space-y-2">
        <header className="border-b border-neutral-300 pb-3 print:pb-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-neutral-600">
            Educar para Transformar
          </p>
          <h1 id="titulo-impresion" className="text-2xl font-extrabold text-neutral-900 tracking-tight print:text-xl">
            {reporte.titulo}
          </h1>
          <p className="text-sm text-neutral-700 mt-1">
            Reporte oficial de Dirección · Emitido el {emitido} · {NUMERO.format(total)}{' '}
            {total === 1 ? 'fila' : 'filas'}
          </p>
          <p className="text-xs text-neutral-700 mt-1">
            <span className="font-semibold">Filtros aplicados:</span>{' '}
            {aplicados.map((f) => `${f.etiqueta}: ${f.valor}`).join(' · ')}
          </p>
          <p className="text-xs text-neutral-600 mt-1">{reporte.grano}</p>
        </header>

        {total === 0 ? (
          <p role="status" className="text-sm text-neutral-700">
            No hay resultados con estos filtros.
          </p>
        ) : (
          <TablaReporte reporte={reporte.id} titulo={reporte.titulo} filas={filas} impresion />
        )}
      </article>
    </div>
  )
}
