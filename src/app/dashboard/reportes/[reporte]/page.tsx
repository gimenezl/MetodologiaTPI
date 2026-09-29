import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { WarningCircle } from '@phosphor-icons/react/dist/ssr'
import {
  REPORTES,
  describirFiltros,
  esIdReporte,
  leerFiltros,
  parametrosDeUrl,
  type ParametrosCrudos,
} from '@/lib/reportes'
import { requerirDirector } from '@/services/autorizacion'
import { leerCatalogos, leerPaginaReporte } from '@/services/reportes.service'
import { AccionesReporte } from '../_components/AccionesReporte'
import { FormularioFiltros } from '../_components/FormularioFiltros'
import { PanelErrorLectura, PanelRestringido } from '../_components/Paneles'
import { Paginacion } from '../_components/Paginacion'
import { TablaReporte } from '../_components/TablaReporte'

export const metadata: Metadata = {
  title: 'Reportes oficiales | Panel',
}

export const dynamic = 'force-dynamic'

const MENSAJE_NO_AUTORIZADO = 'Solo Dirección puede consultar los reportes oficiales.'

const NUMERO = new Intl.NumberFormat('es-AR')

/**
 * Un reporte oficial de Dirección (EPT-63, RF17): filtros, resultados paginados,
 * exportación CSV e impresión.
 *
 * Los filtros viajan por la URL y los aplica PostgreSQL: esta página nunca trae
 * un conjunto grande para recortarlo en el servidor de Next ni en el navegador.
 * Pide UNA página exacta (25, 50 o 100 filas) y el total sale de la misma
 * consulta.
 *
 * La barrera de datos es PostgreSQL —la función del reporte exige el rol
 * DIRECTOR—; la guarda de esta página solo decide qué se muestra.
 *
 * En Next.js 16 `params` y `searchParams` llegan como promesas.
 */
export default async function ReportePage({
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

  // Los catálogos y la página no dependen entre sí: una sola espera.
  const [catalogos, lectura] = await Promise.all([
    leerCatalogos(),
    parametros.ok
      ? leerPaginaReporte(reporte.id, parametros.filtros, parametros.pagina, parametros.tamano)
      : Promise.resolve(null),
  ])

  const catalogosOk = catalogos.ok ? catalogos.datos : null

  if (!parametros.ok) {
    return (
      <div className="max-w-6xl mx-auto space-y-6">
        <Encabezado titulo={reporte.titulo} descripcion={reporte.descripcion} />
        <div role="alert" className="bg-red-50 border border-red-200 rounded-2xl p-5 flex gap-3 items-start">
          <WarningCircle size={22} weight="fill" className="text-red-500 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-red-800">Los filtros del enlace no son válidos</p>
            <ul className="list-disc pl-5 mt-1 text-sm text-red-700 space-y-0.5">
              {parametros.errores.map((error) => (
                <li key={`${error.campo}-${error.mensaje}`}>{error.mensaje}</li>
              ))}
            </ul>
          </div>
        </div>
        <FormularioFiltros
          reporte={reporte}
          filtros={{ historial: false }}
          tamano={50}
          catalogos={catalogosOk}
          errores={parametros.errores}
        />
      </div>
    )
  }

  if (lectura && !lectura.ok) {
    return (
      <PanelErrorLectura
        titulo={reporte.titulo}
        mensaje={lectura.mensaje}
        reintentar={`${base}?${parametrosDeUrl(parametros.filtros, { pagina: parametros.pagina, tamano: parametros.tamano }).toString()}`}
      />
    )
  }
  if (!lectura) return null

  const { filas, total, pagina, paginas, tamano } = lectura.datos
  const filtros = parametros.filtros
  const aplicados = describirFiltros(reporte, filtros, catalogosOk)
  const consulta = parametrosDeUrl(filtros).toString()
  const sufijo = consulta ? `?${consulta}` : ''

  const desde = filas.length > 0 ? (pagina - 1) * tamano + 1 : 0
  const hasta = filas.length > 0 ? (pagina - 1) * tamano + filas.length : 0
  const fueraDeRango = filas.length === 0 && total > 0

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <Encabezado titulo={reporte.titulo} descripcion={reporte.descripcion} />

      {!catalogos.ok && (
        <div role="alert" className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-900">
          No pudimos cargar las listas de los filtros. {catalogos.mensaje} Los resultados de abajo son
          correctos, pero por ahora no podés cambiar los filtros desde acá.
        </div>
      )}

      <FormularioFiltros
        reporte={reporte}
        filtros={filtros}
        tamano={tamano}
        catalogos={catalogosOk}
        errores={[]}
      />

      <section aria-labelledby="resultados-titulo" className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1 min-w-0">
            <h2 id="resultados-titulo" className="text-lg font-bold text-neutral-900">
              Resultados
            </h2>
            <p role="status" aria-live="polite" className="text-sm text-neutral-600">
              {total === 0
                ? 'No hay resultados con estos filtros.'
                : fueraDeRango
                  ? `La página ${NUMERO.format(pagina)} no existe: el reporte tiene ${NUMERO.format(total)} ${total === 1 ? 'fila' : 'filas'} en ${NUMERO.format(paginas)} ${paginas === 1 ? 'página' : 'páginas'}.`
                  : `Mostrando ${NUMERO.format(desde)} a ${NUMERO.format(hasta)} de ${NUMERO.format(total)} ${total === 1 ? 'fila' : 'filas'}.`}
            </p>
            <p className="text-xs text-neutral-500 max-w-[90ch]">{reporte.grano}</p>
            {reporte.nota && <p className="text-xs text-neutral-500 max-w-[90ch]">{reporte.nota}</p>}
            <p className="text-xs text-neutral-600">
              <span className="font-semibold">Filtros aplicados:</span>{' '}
              {aplicados.map((f) => `${f.etiqueta}: ${f.valor}`).join(' · ')}
            </p>
          </div>
          <AccionesReporte
            urlExportar={`/api/reportes/${reporte.id}/exportar${sufijo}`}
            urlImprimir={`${base}/imprimir${sufijo}`}
            total={total}
          />
        </div>

        {total === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-neutral-300 p-8 text-center">
            <p className="text-sm font-semibold text-neutral-800">No encontramos filas para mostrar</p>
            <p className="text-sm text-neutral-500 mt-1">
              Probá quitar algún filtro
              {reporte.historial && !filtros.historial ? ' o incluir el historial' : ''}.
            </p>
            <Link href={base} className="inline-block mt-3 text-sm font-semibold text-brand-700 underline underline-offset-4">
              Limpiar filtros
            </Link>
          </div>
        ) : fueraDeRango ? (
          <div className="bg-white rounded-2xl border border-dashed border-neutral-300 p-8 text-center">
            <Link
              href={`${base}?${parametrosDeUrl(filtros, { pagina: 1, tamano }).toString()}`}
              className="text-sm font-semibold text-brand-700 underline underline-offset-4"
            >
              Volver a la primera página
            </Link>
          </div>
        ) : (
          <TablaReporte reporte={reporte.id} titulo={reporte.titulo} filas={filas} />
        )}

        <Paginacion reporte={reporte.id} filtros={filtros} pagina={pagina} paginas={paginas} tamano={tamano} />
      </section>
    </div>
  )
}

function Encabezado({ titulo, descripcion }: { titulo: string; descripcion: string }) {
  return (
    <header>
      <nav aria-label="Ruta de navegación" className="text-xs text-neutral-500 mb-2">
        <Link href="/dashboard/reportes" className="hover:underline">
          Reportes oficiales
        </Link>
      </nav>
      <h1 className="text-2xl font-extrabold text-neutral-900 tracking-tight">{titulo}</h1>
      <p className="text-neutral-500 text-sm mt-1 max-w-[70ch]">{descripcion}</p>
    </header>
  )
}
