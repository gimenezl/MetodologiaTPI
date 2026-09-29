import { NextResponse } from 'next/server'
import {
  REPORTES,
  esIdReporte,
  leerFiltros,
  parametrosDesdeUrl,
  type DefinicionReporte,
  type ErrorDeFiltro,
  type FiltrosReporte,
} from '@/lib/reportes'
import { requerirDirector } from '@/services/autorizacion'
import type { FalloReportes } from '@/services/reportes.service'
import { SIN_CACHE } from '@/services/usuarios.respuestas'

/**
 * Núcleo común de las dos rutas de reportes (EPT-63). Este archivo no es una
 * ruta: solo `route.ts` lo es.
 *
 * Orden fijo, el mismo en las dos: Dirección (sesión + rol + bloqueo) → reporte
 * pedido → filtros → lectura. La autorización va primero a propósito: quien no es
 * Dirección no puede averiguar, por el tipo de error, qué reportes ni qué
 * filtros existen.
 */

export const MENSAJE_NO_AUTORIZADO = 'Solo Dirección puede consultar los reportes oficiales.'

export type ParametrosRuta = { params: Promise<{ reporte: string }> }

export function responderFallo(fallo: FalloReportes) {
  return NextResponse.json(
    { error: fallo.mensaje, codigo: fallo.codigo, ...(fallo.total !== undefined ? { total: fallo.total } : {}) },
    { status: fallo.estado, headers: SIN_CACHE }
  )
}

function responderDatosInvalidos(mensaje: string, errores?: ErrorDeFiltro[]) {
  return NextResponse.json(
    { error: mensaje, codigo: 'DATOS_INVALIDOS', ...(errores ? { errores } : {}) },
    { status: 400, headers: SIN_CACHE }
  )
}

export type Peticion =
  | { ok: false; respuesta: NextResponse }
  | { ok: true; reporte: DefinicionReporte; filtros: FiltrosReporte; pagina: number; tamano: number }

/**
 * Autoriza, resuelve el reporte y valida los filtros. `admitirPagina = false`
 * (la exportación) rechaza `pagina` y `tamano`: el CSV siempre trae todas las
 * filas, y aceptarlos en silencio haría creer que se exportó una sola página.
 */
export async function prepararPeticion(
  request: Request,
  { params }: ParametrosRuta,
  { admitirPagina }: { admitirPagina: boolean }
): Promise<Peticion> {
  const autorizacion = await requerirDirector(MENSAJE_NO_AUTORIZADO)
  if (!autorizacion.autorizado) {
    return {
      ok: false,
      respuesta: NextResponse.json(
        {
          error: autorizacion.mensaje,
          codigo: autorizacion.codigo ?? (autorizacion.estado === 401 ? 'SIN_SESION' : 'ACCESO_DENEGADO'),
        },
        { status: autorizacion.estado, headers: SIN_CACHE }
      ),
    }
  }

  const { reporte: idPedido } = await params
  if (!esIdReporte(idPedido)) {
    return {
      ok: false,
      respuesta: NextResponse.json(
        { error: 'El reporte solicitado no existe.', codigo: 'REPORTE_NO_ENCONTRADO' },
        { status: 404, headers: SIN_CACHE }
      ),
    }
  }

  const reporte = REPORTES[idPedido]
  const crudos = parametrosDesdeUrl(new URL(request.url).searchParams)

  if (!admitirPagina && ('pagina' in crudos || 'tamano' in crudos)) {
    return {
      ok: false,
      respuesta: responderDatosInvalidos('La exportación siempre incluye todas las filas: no admite página ni tamaño.', [
        { campo: 'pagina' in crudos ? 'pagina' : 'tamano', mensaje: 'No aplica a la exportación.' },
      ]),
    }
  }

  const filtros = leerFiltros(reporte, crudos)
  if (!filtros.ok) {
    return { ok: false, respuesta: responderDatosInvalidos('Los filtros enviados no son válidos.', filtros.errores) }
  }

  return { ok: true, reporte, filtros: filtros.filtros, pagina: filtros.pagina, tamano: filtros.tamano }
}
