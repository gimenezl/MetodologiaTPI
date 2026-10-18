import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  CAUSAS_CURSO,
  REPORTES_ECONOMICOS,
  dineroEconomico,
  esReporteEconomico,
  fechaEconomica,
  leerConsultaEconomica,
  urlConsultaEconomica,
  type FilaEconomica,
  type ReporteEconomico,
} from '@/lib/reportes-economicos'
import { requerirDirector } from '@/services/autorizacion'
import { leerCatalogos } from '@/services/reportes.service'
import { leerReporteEconomico } from '@/services/reportes-economicos.service'
import { PanelRestringido } from '../../_components/Paneles'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Reportes económicos | Panel' }
const control =
  'mt-1 block min-h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm focus-visible:outline-2 focus-visible:outline-brand-600'
const enlace =
  'inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-brand-700 underline underline-offset-4 focus-visible:outline-2'

export default async function ReporteEconomicoPage({
  params,
  searchParams,
}: {
  params: Promise<{ reporte: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const permiso = await requerirDirector('Solo Dirección habilitada puede consultar los reportes económicos.')
  if (!permiso.autorizado)
    return (
      <PanelRestringido
        mensaje={permiso.mensaje}
        accion={permiso.estado === 401 ? { href: '/login', texto: 'Iniciar sesión' } : undefined}
      />
    )
  const { reporte: id } = await params
  if (!esReporteEconomico(id)) notFound()
  const reporte = REPORTES_ECONOMICOS[id]
  const base = `/dashboard/reportes/economicos/${id}`
  const crudos = await searchParams
  const url = new URLSearchParams()
  for (const [k, valores] of Object.entries(crudos)) {
    if (Array.isArray(valores)) valores.forEach((v) => url.append(k, v))
    else if (valores !== undefined) url.set(k, valores)
  }
  const anio = new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'America/Argentina/Buenos_Aires' }).format(
    new Date()
  )
  if (!url.has('desde') && !url.has('hasta')) {
    url.set('desde', `${anio}-01-01`)
    url.set('hasta', `${anio}-12-31`)
  }
  const consulta = leerConsultaEconomica(id, url)
  const [catalogos, lectura] = await Promise.all([
    leerCatalogos(),
    consulta.ok ? leerReporteEconomico(id, consulta.consulta) : Promise.resolve(null),
  ])
  const datos = lectura?.ok ? lectura.datos : null
  const renovar = consulta.ok
    ? `${base}?${urlConsultaEconomica(consulta.consulta, { pagina: 1, huella: undefined })}`
    : base
  const paginas = datos ? Math.max(1, Math.ceil(datos.total / datos.tamano)) : 1
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header>
        <Link className={enlace} href="/dashboard/reportes">
          Reportes oficiales
        </Link>
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">Económicos · {reporte.rf}</p>
        <h1 className="mt-2 text-2xl font-extrabold text-neutral-900">{reporte.titulo}</h1>
        <p className="mt-2 max-w-[72ch] text-sm text-neutral-600">{reporte.descripcion}</p>
      </header>
      <nav aria-label="Reportes económicos" className="flex flex-wrap gap-1 border-b border-neutral-200 pb-2">
        {Object.entries(REPORTES_ECONOMICOS).map(([key, def]) => (
          <Link
            key={key}
            href={`/dashboard/reportes/economicos/${key}`}
            className={enlace}
            aria-current={id === key ? 'page' : undefined}
          >
            {def.titulo}
          </Link>
        ))}
      </nav>
      <section aria-labelledby="filtros-economicos" className="rounded-2xl border border-neutral-200 bg-white p-5">
        <h2 id="filtros-economicos" className="text-lg font-bold">
          Consultar período
        </h2>
        <p className="mt-1 max-w-[72ch] text-sm text-neutral-600">
          Fechas inclusivas de transferencia. Las facturas sin ningún pago aprobado se ubican por vencimiento. Año
          calendario y curso se resuelven a esa fecha.
        </p>
        <form action={base} method="get" className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm font-semibold">
            Desde
            <input className={control} name="desde" type="date" required defaultValue={url.get('desde') ?? ''} />
          </label>
          <label className="text-sm font-semibold">
            Hasta
            <input className={control} name="hasta" type="date" required defaultValue={url.get('hasta') ?? ''} />
          </label>
          <label className="text-sm font-semibold">
            Año calendario
            <input
              className={control}
              name="anio"
              type="number"
              min="1"
              max="9998"
              defaultValue={url.get('anio') ?? ''}
            />
          </label>
          <label className="text-sm font-semibold">
            Año que cursa (sin división)
            <input
              className={control}
              name="curso"
              maxLength={100}
              defaultValue={url.get('curso') ?? ''}
              placeholder="Denominación exacta"
            />
          </label>
          <label className="text-sm font-semibold">
            Nivel
            <select className={control} name="nivel" defaultValue={url.get('nivel') ?? ''}>
              <option value="">Todos los niveles</option>
              {catalogos.ok &&
                catalogos.datos.niveles.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.nombre}
                  </option>
                ))}
            </select>
          </label>
          <label className="text-sm font-semibold">
            Curso no determinable
            <select className={control} name="causa" defaultValue={url.get('causa') ?? ''}>
              <option value="">Todas las situaciones</option>
              {CAUSAS_CURSO.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          {id === 'deportes' && (
            <>
              <label className="text-sm font-semibold">
                Deporte
                <select className={control} name="deporte" defaultValue={url.get('deporte') ?? ''}>
                  <option value="">Todos los deportes</option>
                  {catalogos.ok &&
                    catalogos.datos.deportes.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.nombre}
                      </option>
                    ))}
                </select>
              </label>
              <label className="text-sm font-semibold">
                Profesor a cargo
                <select className={control} name="profesor" defaultValue={url.get('profesor') ?? ''}>
                  <option value="">Todos los profesores</option>
                  {catalogos.ok &&
                    catalogos.datos.profesores.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.apellido}, {p.nombre}
                      </option>
                    ))}
                </select>
              </label>
              <label className="text-sm font-semibold">
                Horario
                <select className={control} name="horario" defaultValue={url.get('horario') ?? ''}>
                  <option value="">Todos los horarios</option>
                  {catalogos.ok &&
                    catalogos.datos.horarios.map((h) => (
                      <option key={h.id} value={h.id}>
                        {dias[h.dia_semana]} {h.hora_inicio.slice(0, 5)} a {h.hora_fin.slice(0, 5)}
                      </option>
                    ))}
                </select>
              </label>
            </>
          )}
          {id === 'recorridos' && (
            <label className="text-sm font-semibold">
              Recorrido
              <select className={control} name="recorrido" defaultValue={url.get('recorrido') ?? ''}>
                <option value="">Todos los recorridos</option>
                {catalogos.ok &&
                  catalogos.datos.recorridos.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.nombre} ({r.codigo})
                    </option>
                  ))}
              </select>
            </label>
          )}
          <label className="text-sm font-semibold">
            Filas por página
            <select className={control} name="tamano" defaultValue={url.get('tamano') ?? '50'}>
              {[25, 50, 100].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <div className="flex items-end gap-2">
            <button
              className="min-h-11 rounded-lg bg-brand-700 px-4 font-semibold text-white hover:bg-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2"
              type="submit"
            >
              Consultar
            </button>
            <a href={base} className={enlace}>
              Limpiar
            </a>
          </div>
        </form>
        {!catalogos.ok && (
          <p role="alert" className="mt-3 text-sm text-red-800">
            No se pudieron cargar las listas. Actualice la consulta para reintentar; no se han quitado filtros del
            enlace.
          </p>
        )}
      </section>
      {!consulta.ok && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4">
          {consulta.mensaje}
        </p>
      )}
      {lectura && !lectura.ok && (
        <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p>{lectura.mensaje}</p>
          <a className={enlace} href={lectura.estado === 409 ? renovar : `${base}?${url}`}>
            {lectura.estado === 409 ? 'Actualizar desde la primera página' : 'Reintentar'}
          </a>
        </div>
      )}
      {datos && consulta.ok && (
        <section aria-labelledby="resultado-economico" className="space-y-4">
          <h2 id="resultado-economico" className="text-lg font-bold">
            Resultado del {fechaEconomica(consulta.consulta.desde)} al {fechaEconomica(consulta.consulta.hasta)}
          </h2>
          <p className="max-w-[75ch] text-sm text-neutral-600">
            {reporte.grano} Saldos vigentes al momento de lectura, no un saldo histórico al cierre del período. Lectura:{' '}
            {new Date(datos.leido_en).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })} (Buenos
            Aires).
          </p>
          <dl className="flex flex-wrap gap-x-8 gap-y-4 border-y border-neutral-200 py-4 text-sm">
            {id === 'ingresos' && (
              <>
                <Total etiqueta="Importe informado global" valor={datos.totales.informado_centavos} />
                <Total
                  etiqueta="Diferencia global (informado menos imputado)"
                  valor={datos.totales.diferencia_centavos}
                />
              </>
            )}
            <Total etiqueta="Importe imputado global" valor={datos.totales.imputado_centavos} />
            {(id === 'completos' || id === 'incompletos') && (
              <>
                <Total
                  etiqueta={`Total de ${datos.totales.facturas} facturas únicas`}
                  valor={datos.totales.total_facturas_centavos}
                />
                <Total etiqueta="Saldo vigente de facturas únicas" valor={datos.totales.saldo_facturas_centavos} />
              </>
            )}
          </dl>
          <p role="status" className="text-sm">
            {datos.total === 0
              ? 'No hay resultados con estos filtros.'
              : `${datos.total} filas en total. Página ${datos.pagina} de ${paginas}. Los totales incluyen todas las páginas.`}
          </p>
          {datos.filas.length > 0 ? (
            <div
              role="region"
              aria-label={reporte.titulo}
              tabIndex={0}
              className="overflow-auto rounded-xl border border-neutral-200 bg-white focus-visible:outline-2"
            >
              <table className="w-full text-left text-sm">
                <caption className="sr-only">
                  {reporte.titulo}. {reporte.grano}
                </caption>
                <thead className="bg-neutral-100">
                  <tr>
                    {columnas(id).map((c) => (
                      <th key={c} scope="col" className="whitespace-nowrap p-3 font-semibold">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {datos.filas.map((f) => (
                    <Fila key={f.id} fila={f} reporte={id} />
                  ))}
                </tbody>
              </table>
            </div>
          ) : datos.total > 0 ? (
            <p>
              Esta página quedó fuera del resultado.{' '}
              <a className={enlace} href={renovar}>
                Volver a la primera página
              </a>
            </p>
          ) : (
            <p className="rounded-xl border border-dashed border-neutral-300 p-6 text-sm">
              Amplíe el período o quite filtros para buscar otros registros.
            </p>
          )}
          <nav aria-label="Paginación del reporte económico" className="flex flex-wrap items-center gap-2">
            {datos.pagina > 1 && (
              <a
                className={enlace}
                href={`${base}?${urlConsultaEconomica(consulta.consulta, { pagina: datos.pagina - 1, huella: datos.huella })}`}
              >
                Página anterior
              </a>
            )}
            {datos.pagina < paginas && (
              <a
                className={enlace}
                href={`${base}?${urlConsultaEconomica(consulta.consulta, { pagina: datos.pagina + 1, huella: datos.huella })}`}
              >
                Página siguiente
              </a>
            )}
            <a className={enlace} href={renovar}>
              Actualizar consulta
            </a>
          </nav>
          {datos.grupos.length > 0 && (
            <details>
              <summary className="cursor-pointer py-3 text-sm font-semibold">
                Agrupación por año, nivel y curso sin división
              </summary>
              <ul className="divide-y divide-neutral-200 text-sm">
                {datos.grupos.map((g, i) => (
                  <li key={i} className="py-3">
                    {g.anio} · {g.nivel ?? 'Nivel no determinable'} · {g.curso}
                    {g.causa ? ` (${g.causa})` : ''}
                    {g.concepto ? ` · ${g.concepto}` : ''}: {dineroEconomico(g.imputado_centavos)} imputados, {g.filas}{' '}
                    filas.
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
      <aside className="max-w-[75ch] border-t border-neutral-200 pt-4 text-xs leading-relaxed text-neutral-600">
        El curso corresponde a una matrícula que cubre inequívocamente todo el día civil. Sin historia suficiente o con
        varias matrículas posibles, se conserva como «Curso no determinable», sin excluir importes. Las denominaciones y
        niveles de curso, deportes, profesores, horarios y nombres de recorridos proceden de los catálogos actuales, no
        de etiquetas históricas reconstruidas. Cambiar de página vuelve a leer: si el contenido cambió, deberá
        actualizar la consulta. Consultar no modifica pagos ni deuda.
      </aside>
    </div>
  )
}
const dias: Record<number, string> = {
  1: 'Lunes',
  2: 'Martes',
  3: 'Miércoles',
  4: 'Jueves',
  5: 'Viernes',
  6: 'Sábado',
  7: 'Domingo',
}
function Total({ etiqueta, valor }: { etiqueta: string; valor: string | null }) {
  return (
    <div>
      <dt className="text-neutral-600">{etiqueta} (ARS)</dt>
      <dd className="mt-1 font-bold tabular-nums">{dineroEconomico(valor)}</dd>
    </div>
  )
}
function columnas(id: ReporteEconomico) {
  return [
    'Alumno y legajo',
    'Fecha y criterio',
    'Año / nivel / curso',
    ...(id === 'ingresos' ? ['Importe informado', 'Importe imputado', 'Diferencia'] : ['Importe imputado']),
    ...(id === 'completos' || id === 'incompletos' ? ['Total factura', 'Saldo vigente'] : []),
    ...(id === 'deportes'
      ? ['Deporte / nivel', 'Horarios actuales', 'Profesor actual']
      : id === 'recorridos'
        ? ['Recorrido']
        : []),
    'Referencias',
  ]
}
function Fila({ fila: f, reporte: id }: { fila: FilaEconomica; reporte: ReporteEconomico }) {
  const celdas = [
    <>
      {f.alumno}
      <br />
      <span className="text-xs text-neutral-600">{f.legajo ?? 'Sin legajo'}</span>
    </>,
    <>
      {fechaEconomica(f.fecha)}
      <br />
      {f.criterio_fecha}
    </>,
    <>
      {f.anio} · {f.curso.nivel ?? 'Nivel no determinable'}
      <br />
      {f.curso.curso}
      {f.curso.causa && (
        <>
          <br />
          {f.curso.causa}
        </>
      )}
    </>,
    ...(id === 'ingresos'
      ? [
          dineroEconomico(f.informado_centavos),
          dineroEconomico(f.imputado_centavos),
          dineroEconomico(f.diferencia_centavos),
        ]
      : [dineroEconomico(f.imputado_centavos)]),
    ...(id === 'completos' || id === 'incompletos'
      ? [
          dineroEconomico(f.total_factura_centavos),
          <>
            {dineroEconomico(f.saldo_centavos)}
            {f.inconsistente && <p className="font-semibold text-red-800">Histórico inconsistente</p>}
          </>,
        ]
      : []),
    ...(id === 'deportes'
      ? [
          <>
            {f.concepto}
            <br />
            {f.nivel_deportivo}
          </>,
          f.horarios.map((h) => `${dias[h.dia]} ${h.desde.slice(0, 5)} a ${h.hasta.slice(0, 5)}`).join('; ') ||
            'Sin horario registrado',
          f.profesor ?? 'Sin profesor registrado',
        ]
      : id === 'recorridos'
        ? [f.concepto]
        : []),
    <div key="referencias" className="min-w-40 break-all text-xs">
      {f.pago_id ? (
        <>
          Pago: {f.pago_id}
          <br />
        </>
      ) : (
        <>
          Sin pago aprobado
          <br />
        </>
      )}
      {f.factura_id && (
        <>
          Factura: {f.factura_id}
          <br />
        </>
      )}
      {f.item_id && <>Ítem: {f.item_id}</>}
    </div>,
  ]
  return (
    <tr className="border-t border-neutral-200 align-top">
      {celdas.map((c, i) => (
        <td key={i} className="p-3 tabular-nums">
          {c}
        </td>
      ))}
    </tr>
  )
}
