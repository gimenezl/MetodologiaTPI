import { NextResponse } from 'next/server'
import { origenPermitido } from '@/lib/accesos-qr/origen'
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

/**
 * Segunda barrera de las rutas que cambian estado (defensa en profundidad sobre
 * `SameSite=Lax`): el origen debe ser el de la aplicación y el cuerpo, JSON. Devuelve
 * la respuesta de rechazo, o `null` si la petición puede seguir.
 */
export function rechazarSiNoEsConfiable(request: Request) {
  if (!origenPermitido(request.headers)) {
    return NextResponse.json({ error: 'Origen no permitido.' }, { status: 403 })
  }
  const tipo = request.headers.get('content-type') ?? ''
  if (!/^application\/json/iu.test(tipo)) {
    return NextResponse.json({ error: 'El contenido debe enviarse como JSON.' }, { status: 415 })
  }
  return null
}
