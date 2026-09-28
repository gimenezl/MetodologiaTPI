import { NextResponse } from 'next/server'

/**
 * Respuesta 405 con la cabecera `Allow` que exige HTTP.
 *
 * Next.js responde 405 por sí solo a un método que la ruta no exporta, pero sin
 * `Allow`. Las rutas de administración de deportes (EPT-61) exportan un manejador
 * explícito por cada método que NO admiten, sobre todo DELETE: no existe borrado
 * físico en ninguna capa y quien lo intente recibe un rechazo que dice qué sí
 * puede usar. No se consulta la sesión: el método no existe para nadie.
 */
export function metodoNoPermitido(permitidos: readonly string[]) {
  const allow = [...permitidos, 'OPTIONS'].join(', ')
  return NextResponse.json(
    { error: 'Este método no está permitido en esta dirección.' },
    { status: 405, headers: { Allow: allow } }
  )
}

/** Respuesta a `OPTIONS` que informa solo los métodos realmente admitidos. */
export function opcionesPermitidas(permitidos: readonly string[]) {
  return new Response(null, {
    status: 204,
    headers: { Allow: [...permitidos, 'OPTIONS'].join(', ') },
  })
}
