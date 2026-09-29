import { NextResponse } from 'next/server'
import { metodoNoPermitido, opcionesPermitidas } from '@/lib/metodos-http'
import { leerPaginaReporte } from '@/services/reportes.service'
import { SIN_CACHE } from '@/services/usuarios.respuestas'
import { prepararPeticion, responderFallo, type ParametrosRuta } from '../_comun'

export const dynamic = 'force-dynamic'

const PERMITIDOS = ['GET'] as const

/**
 * Una página de un reporte oficial de Dirección (EPT-63, RF17). Exclusivo de
 * Dirección.
 *
 * Filtros por la URL (`q`, `nivel`, `curso`, `materia`, `deporte`, `recorrido`,
 * `horario`, `responsable`, `origen`, `historial`), más `pagina` y `tamano`
 * (25, 50 o 100). Un filtro que el reporte no admite se rechaza con 400.
 *
 * Códigos: 200 página (con `total` y `paginas` exactos); 400 filtros inválidos;
 * 401 sin sesión; 403 no es Dirección o acceso bloqueado; 404 el reporte no
 * existe; 500 error interno.
 *
 * En Next.js 16 los parámetros dinámicos llegan como una promesa.
 */
export async function GET(request: Request, contexto: ParametrosRuta) {
  const peticion = await prepararPeticion(request, contexto, { admitirPagina: true })
  if (!peticion.ok) return peticion.respuesta

  const resultado = await leerPaginaReporte(
    peticion.reporte.id,
    peticion.filtros,
    peticion.pagina,
    peticion.tamano
  )
  if (!resultado.ok) return responderFallo(resultado)

  return NextResponse.json(
    { reporte: peticion.reporte.id, filtros: peticion.filtros, ...resultado.datos },
    { headers: SIN_CACHE }
  )
}

export const POST = () => metodoNoPermitido(PERMITIDOS)
export const PUT = () => metodoNoPermitido(PERMITIDOS)
export const PATCH = () => metodoNoPermitido(PERMITIDOS)
export const DELETE = () => metodoNoPermitido(PERMITIDOS)
export const OPTIONS = () => opcionesPermitidas(PERMITIDOS)
