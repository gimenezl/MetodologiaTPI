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
  const transporte = nodemailer.createTransport({
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
    // Sin registro de la conversación SMTP: incluiría el destinatario.
    logger: false,
    debug: false,
  })

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
