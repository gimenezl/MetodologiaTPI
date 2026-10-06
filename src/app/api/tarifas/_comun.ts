import { NextResponse } from 'next/server'
import type { ResultadoTarifas } from '@/services/tarifas.service'

/** Mensaje de la denegación por rol: el mismo en la pantalla, la API y la base. */
export const MENSAJE_NO_AUTORIZADO = 'Solo Dirección puede administrar las tarifas.'

/**
 * Lee el cuerpo JSON de la petición. Un cuerpo ausente o ilegible devuelve
 * `undefined` para que quien llama responda 400 sin detalles del analizador.
 */
export async function leerCuerpo(request: Request): Promise<unknown | undefined> {
  try {
    return await request.json()
  } catch {
    return undefined
  }
}

/** Respuesta de error de dominio: mensaje propio, campo y código estable; nunca SQL ni SQLSTATE. */
export function responderError(
  resultado: Extract<ResultadoTarifas<unknown>, { ok: false }>
) {
  return NextResponse.json(
    { error: resultado.mensaje, campo: resultado.campo, codigo: resultado.codigo },
    { status: resultado.estado }
  )
}
