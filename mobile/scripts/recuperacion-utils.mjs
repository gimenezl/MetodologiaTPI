// Utilidades de las pruebas reales de recuperación de contraseña (EPT-106).
//
// Todo opera sobre el stack Supabase descartable y su Mailpit local: nunca contra producción ni contra un
// servidor de correo real. El enlace del correo se extrae en memoria; el valor del token o del código jamás se
// imprime (los registros solo informan estados).
import assert from 'node:assert/strict'

const ESPERA_MAXIMA_MS = 20_000
const PAUSA_MS = 400

const pausa = ms => new Promise(resolve => setTimeout(resolve, ms))

async function mailpit(base, ruta, opciones = {}) {
  const respuesta = await fetch(`${base}/api/v1${ruta}`, { ...opciones, signal: AbortSignal.timeout(10_000) })
  assert.ok(respuesta.ok, `Mailpit respondió ${respuesta.status} en ${opciones.method ?? 'GET'} ${ruta.split('?')[0]}.`)
  const texto = await respuesta.text()
  return texto ? JSON.parse(texto) : null
}

export function validarMailpitLocal(base) {
  const url = new URL(base)
  assert.equal(url.protocol, 'http:', 'Mailpit debe ser un servicio local HTTP.')
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'Mailpit no está en loopback.')
}

/** Espera el primer correo para el destinatario. Falla con un mensaje sin datos sensibles. */
export async function esperarCorreo(base, destinatario, { timeoutMs = ESPERA_MAXIMA_MS } = {}) {
  const limite = Date.now() + timeoutMs
  const consulta = encodeURIComponent(`to:${destinatario}`)
  while (Date.now() < limite) {
    const resultado = await mailpit(base, `/search?query=${consulta}`)
    const mensaje = resultado?.messages?.[0]
    if (mensaje) {
      const detalle = await mailpit(base, `/message/${mensaje.ID}`)
      return { id: mensaje.ID, asunto: detalle.Subject, texto: detalle.Text ?? '', html: detalle.HTML ?? '' }
    }
    await pausa(PAUSA_MS)
  }
  throw new Error('No llegó el correo de recuperación al capturador local.')
}

/** Verifica que NO llegue ningún correo en la ventana indicada. */
export async function confirmarSinCorreo(base, destinatario, { ventanaMs = 3_000 } = {}) {
  const consulta = encodeURIComponent(`to:${destinatario}`)
  const limite = Date.now() + ventanaMs
  while (Date.now() < limite) {
    const resultado = await mailpit(base, `/search?query=${consulta}`)
    if ((resultado?.messages?.length ?? 0) > 0) return false
    await pausa(PAUSA_MS)
  }
  return true
}

export async function borrarCorreos(base, destinatario) {
  const consulta = encodeURIComponent(`to:${destinatario}`)
  await mailpit(base, `/search?query=${consulta}`, { method: 'DELETE' }).catch(() => undefined)
}

/** Extrae el enlace de verificación de Auth del texto del correo. */
export function extraerEnlaceDeVerificacion(correo, apiUrl) {
  const candidatos = (correo.texto || correo.html).replaceAll('&amp;', '&').match(/https?:\/\/[^\s"'<>)]+/gu) ?? []
  const enlace = candidatos.find(c => c.startsWith(`${apiUrl}/auth/v1/verify?`))
  assert.ok(enlace, 'El correo no contiene el enlace de verificación de Auth local.')
  return enlace
}

/**
 * Sigue el enlace del correo como lo haría el navegador del teléfono, pero sin seguir la redirección final al
 * esquema de la app: devuelve la URL de retorno (`educarparatransformar://restablecer?...`) para entregársela a
 * la aplicación. El enlace es de un solo uso: consultarlo lo consume.
 */
export async function resolverRetornoDeApp(enlaceDeVerificacion) {
  const respuesta = await fetch(enlaceDeVerificacion, { redirect: 'manual', signal: AbortSignal.timeout(10_000) })
  assert.ok([301, 302, 303, 307, 308].includes(respuesta.status), `La verificación no redirigió a la aplicación (HTTP ${respuesta.status}).`)
  const destino = respuesta.headers.get('location')
  assert.ok(destino, 'La verificación no informó el destino de retorno.')
  return destino
}

/** Quita código, token y otros secretos de una URL de retorno para poder describirla en un registro. */
export function describirRetorno(url) {
  // Solo el parámetro `code` (no `error_code`) y los tokens; el resto es diagnóstico seguro.
  return url.replace(/(^|[?&#])(code|token|access_token|refresh_token)=[^&#]+/gu, '$1$2=<oculto>')
}
