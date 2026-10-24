import nodemailer from 'nodemailer'

/**
 * Envío del código de verificación del vínculo de cuentas (EPT-59, D5).
 *
 * Solo servidor. El código viaja únicamente dentro del correo: este módulo
 * nunca lo registra, nunca registra el destinatario y, ante un error, solo
 * escribe una línea genérica con la clase del error.
 *
 * Variables de entorno:
 *
 *   EPT_SMTP_HOST       servidor SMTP (obligatorio para habilitar D5)
 *   EPT_SMTP_PORT       puerto (por defecto 587, o 465 si EPT_SMTP_SECURE=true)
 *   EPT_SMTP_SECURE     'true' para TLS implícito; 'false' (por defecto) usa STARTTLS si el servidor lo ofrece
 *   EPT_SMTP_USUARIO    usuario SMTP (opcional)
 *   EPT_SMTP_CLAVE      clave SMTP (opcional; solo junto con el usuario)
 *   EPT_SMTP_REMITENTE  remitente visible, p. ej. «Educar para Transformar <no-responder@dominio>» (obligatorio)
 */

/**
 * Tope total de un envío estructurado. `socketTimeout` es de inactividad: un servidor que
 * responde con cuentagotas podría retener la petición más que la ruta (60 s).
 */
const LIMITE_ENVIO_TOTAL_MS = 20_000

/** Plazos cortos: un servidor SMTP colgado no puede retener la petición. */
const LIMITE_CONEXION_MS = 5_000
const LIMITE_SALUDO_MS = 5_000
const LIMITE_SOCKET_MS = 10_000

export type ConfiguracionSmtp = {
  host: string
  port: number
  secure: boolean
  usuario: string | null
  clave: string | null
  remitente: string
}

/** Lee la configuración SMTP; `null` si falta el servidor o el remitente. */
export function leerConfiguracionSmtp(entorno: NodeJS.ProcessEnv = process.env): ConfiguracionSmtp | null {
  const host = entorno.EPT_SMTP_HOST?.trim()
  const remitente = entorno.EPT_SMTP_REMITENTE?.trim()
  if (!host || !remitente) return null

  const secure = entorno.EPT_SMTP_SECURE?.trim().toLowerCase() === 'true'
  const puerto = Number.parseInt(entorno.EPT_SMTP_PORT ?? '', 10)
  const port = Number.isInteger(puerto) && puerto > 0 && puerto < 65_536 ? puerto : secure ? 465 : 587
  const usuario = entorno.EPT_SMTP_USUARIO?.trim() || null
  const clave = usuario ? entorno.EPT_SMTP_CLAVE ?? null : null

  return { host, port, secure, usuario, clave, remitente }
}

export type DatosDelCodigo = {
  destinatario: string
  codigo: string
  venceEn: Date
}

function horaLocal(fecha: Date): string {
  return new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(fecha)
}

function crearTransporte(configuracion: ConfiguracionSmtp, observador?: Record<string, unknown>) {
  return nodemailer.createTransport({
    host: configuracion.host,
    port: configuracion.port,
    secure: configuracion.secure,
    auth:
      configuracion.usuario && configuracion.clave
        ? { user: configuracion.usuario, pass: configuracion.clave }
        : undefined,
    connectionTimeout: LIMITE_CONEXION_MS,
    greetingTimeout: LIMITE_SALUDO_MS,
    socketTimeout: LIMITE_SOCKET_MS,
    // Sin registro de la conversación SMTP: incluiría el destinatario. Solo el envío
    // estructurado observa la fase mediante un logger propio que no conserva nada.
    logger: observador ?? false,
    debug: observador !== undefined,
  })
}

/**
 * Envía el código. Devuelve `true` si el servidor SMTP aceptó el mensaje.
 *
 * Nunca lanza: cualquier fallo de transporte se informa como `false` para que
 * quien llama anule el desafío.
 */
export async function enviarCodigoDeVerificacion(
  configuracion: ConfiguracionSmtp,
  { destinatario, codigo, venceEn }: DatosDelCodigo
): Promise<boolean> {
  const transporte = crearTransporte(configuracion)

  const vence = horaLocal(venceEn)
  const texto = [
    'Hola:',
    '',
    'En la escuela están vinculando una cuenta de acceso a tu legajo.',
    `Tu código de verificación es: ${codigo}`,
    '',
    `El código vence a las ${vence} (hora de Argentina) y sirve una sola vez.`,
    'Dictáselo a la persona de Dirección que te está atendiendo.',
    '',
    'Si no estás realizando este trámite en la escuela, ignorá este mensaje.',
    '',
    'Educar para Transformar',
  ].join('\n')

  try {
    await transporte.sendMail({
      from: configuracion.remitente,
      to: destinatario,
      subject: 'Código de verificación — Educar para Transformar',
      text: texto,
    })
    return true
  } catch (error) {
    console.error('[correo] no se pudo enviar el código de verificación', {
      clase: error instanceof Error ? error.name : typeof error,
    })
    return false
  } finally {
    transporte.close()
  }
}

// ================================================================
// Envío estructurado (EPT-115, recordatorio mensual)
// ================================================================

export type AdjuntoCorreo = { nombre: string; contenido: Uint8Array; tipo: string }

export type DatosDelCorreo = {
  destinatario: string
  asunto: string
  texto: string
  html: string
  adjuntos: AdjuntoCorreo[]
}

/**
 * - `ACEPTADO`: el servidor SMTP aceptó el mensaje. No prueba entrega final ni lectura.
 * - `FALLO_CLARO`: hay evidencia de que NO hubo aceptación (falló antes de `DATA` o el
 *   servidor rechazó el mensaje de forma explícita). Se puede reintentar.
 * - `INCIERTO`: pudo haber aceptación sin resultado concluyente (corte o plazo vencido
 *   después de enviar `DATA`). No se reintenta automáticamente.
 */
export type ResultadoEnvio =
  | { estado: 'ACEPTADO' }
  | { estado: 'FALLO_CLARO'; causa: string }
  | { estado: 'INCIERTO'; causa: string }

/** Texto acotado y sin datos sensibles: solo clase del error, código y comando. */
function causaSaneada(error: unknown): string {
  const e = error as { code?: unknown; command?: unknown; responseCode?: unknown }
  const partes = [error instanceof Error ? error.name : typeof error]
  if (typeof e?.code === 'string' && /^[A-Z0-9_]{1,40}$/u.test(e.code)) partes.push(e.code)
  if (typeof e?.command === 'string' && /^[A-Z -]{1,20}$/u.test(e.command)) partes.push(e.command)
  if (typeof e?.responseCode === 'number') partes.push(String(e.responseCode))
  return `Fallo SMTP (${partes.join(' ')})`
}

/**
 * Clasifica un error de Nodemailer; ante la duda, INCIERTO (se prioriza no duplicar).
 *
 * Nodemailer rotula `CONN` cualquier corte o plazo vencido, aun en medio de `DATA`, así
 * que el comando del error NO sirve para saber si el mensaje pudo salir. La fase se
 * observa aparte (`datosIniciados`: el cliente llegó a enviar `DATA`):
 *   - antes de `DATA` nada pudo aceptarse → fallo claro;
 *   - desde `DATA`, solo un rechazo SMTP explícito (4xx/5xx del servidor) es fallo claro;
 *     un corte o plazo vencido no demuestra que el mensaje no se haya aceptado.
 */
export function clasificarErrorSmtp(error: unknown, datosIniciados: boolean): ResultadoEnvio {
  const e = error as { responseCode?: unknown }
  const causa = causaSaneada(error)
  const respuesta = typeof e?.responseCode === 'number' ? e.responseCode : 0
  if (!datosIniciados) return { estado: 'FALLO_CLARO', causa }
  if (respuesta >= 400 && respuesta < 600) return { estado: 'FALLO_CLARO', causa }
  return { estado: 'INCIERTO', causa }
}

/** Nunca lanza. No registra destinatario, adjuntos ni la conversación SMTP. */
export async function enviarCorreoEstructurado(
  configuracion: ConfiguracionSmtp,
  datos: DatosDelCorreo
): Promise<ResultadoEnvio> {
  // Observa solo la fase (¿el cliente llegó a enviar DATA?); no conserva ni imprime nada del diálogo.
  let datosIniciados = false
  const sinSalida = () => {}
  const observador = {
    trace: sinSalida, info: sinSalida, warn: sinSalida, error: sinSalida, fatal: sinSalida,
    debug: (entrada: { tnx?: string }, mensaje?: unknown) => {
      if (entrada?.tnx === 'client' && mensaje === 'DATA') datosIniciados = true
    },
  }
  const transporte = crearTransporte(configuracion, observador)
  let temporizador: ReturnType<typeof setTimeout> | undefined
  try {
    const envio = transporte.sendMail({
      from: configuracion.remitente,
      to: datos.destinatario,
      subject: datos.asunto,
      text: datos.texto,
      html: datos.html,
      attachments: datos.adjuntos.map((a) => ({
        filename: a.nombre,
        content: Buffer.from(a.contenido),
        contentType: a.tipo,
      })),
    })
    const plazo = new Promise<'PLAZO'>((resolver) => {
      temporizador = setTimeout(() => resolver('PLAZO'), LIMITE_ENVIO_TOTAL_MS)
    })
    const info = await Promise.race([envio, plazo])
    if (info === 'PLAZO') {
      envio.catch(() => {})
      transporte.close()
      return datosIniciados
        ? { estado: 'INCIERTO', causa: 'Se agotó el plazo del envío después de iniciar DATA.' }
        : { estado: 'FALLO_CLARO', causa: 'Se agotó el plazo del envío antes de iniciar DATA.' }
    }
    // Sin excepción, el servidor ya recibió el mensaje: nunca es un fallo claro reintentable.
    if (info.accepted.length >= 1) return { estado: 'ACEPTADO' }
    return { estado: 'INCIERTO', causa: 'El servidor SMTP respondió sin aceptar a ningún destinatario.' }
  } catch (error) {
    const resultado = clasificarErrorSmtp(error, datosIniciados)
    console.error('[correo] envío no confirmado', { clase: resultado.estado })
    return resultado
  } finally {
    if (temporizador) clearTimeout(temporizador)
    transporte.close()
  }
}
