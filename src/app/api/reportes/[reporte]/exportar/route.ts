import { metodoNoPermitido, opcionesPermitidas } from '@/lib/metodos-http'
import { construirCsv, nombreArchivoCsv } from '@/lib/reportes'
import { leerReporteCompleto } from '@/services/reportes.service'
import { SIN_CACHE } from '@/services/usuarios.respuestas'
import { prepararPeticion, responderFallo, type ParametrosRuta } from '../../_comun'

export const dynamic = 'force-dynamic'

const PERMITIDOS = ['GET'] as const

/**
 * Exportación CSV de un reporte oficial de Dirección (EPT-63, RF17). Exclusiva
 * de Dirección.
 *
 * Exporta el conjunto filtrado COMPLETO —todas las páginas, no solo la primera—
 * con encabezados legibles en español, separador «;», BOM UTF-8, comillas y
 * saltos de línea escapados y fórmulas de planilla neutralizadas. Las columnas son
 * las mismas que muestra la pantalla; nunca incluye datos del confirmador ni
 * datos personales sensibles.
 *
 * Se lee todo ANTES de responder: si una página falla, la respuesta es un error
 * y no un archivo cortado que parezca completo. La cabecera `X-Total-Filas`
 * informa cuántas filas tiene el archivo.
 *
 * Códigos: 200 archivo; 400 filtros inválidos (o `pagina`/`tamano`, que no
 * aplican); 401 sin sesión; 403 no es Dirección o acceso bloqueado; 404 el
 * reporte no existe; 413 supera el máximo exportable; 500 error interno.
 */
export async function GET(request: Request, contexto: ParametrosRuta) {
  const peticion = await prepararPeticion(request, contexto, { admitirPagina: false })
  if (!peticion.ok) return peticion.respuesta

  const resultado = await leerReporteCompleto(peticion.reporte.id, peticion.filtros)
  if (!resultado.ok) return responderFallo(resultado)

  const cuerpo = construirCsv(peticion.reporte.id, resultado.datos.filas)
  return new Response(cuerpo, {
    status: 200,
    headers: {
      ...SIN_CACHE,
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${nombreArchivoCsv(peticion.reporte.id)}"`,
      'Content-Length': String(Buffer.byteLength(cuerpo, 'utf8')),
      'X-Total-Filas': String(resultado.datos.total),
      // El navegador no debe tratar el CSV como una página ni intentar detectarlo.
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

export const POST = () => metodoNoPermitido(PERMITIDOS)
export const PUT = () => metodoNoPermitido(PERMITIDOS)
export const PATCH = () => metodoNoPermitido(PERMITIDOS)
export const DELETE = () => metodoNoPermitido(PERMITIDOS)
export const OPTIONS = () => opcionesPermitidas(PERMITIDOS)
