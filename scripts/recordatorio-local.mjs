import { pathToFileURL } from 'node:url'

/** Scheduler real local: temporizador diario a las 09:00 UTC (06:00 Argentina).
 * Sin activación explícita no envía peticiones. No registra credenciales.
 * La API y la base mantienen gates independientes. No agenda trabajos remotos.
 */
export function programarRecordatorio({ url, secreto, habilitada = false, intervaloMs,
  alResultado = () => {}, alError = () => {} }) {
  if (!habilitada) return { detener() {}, activo: false }
  if (!secreto) throw new Error('Falta el secreto de la tarea local.')
  const destino = new URL(url)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(destino.hostname) || destino.protocol !== 'http:') {
    throw new Error('El scheduler local solo admite HTTP de bucle local.')
  }
  if (destino.pathname !== '/api/cron/recordatorio-mensual' || destino.search || destino.username || destino.password) {
    throw new Error('Destino de la tarea local inválido.')
  }
  if (intervaloMs !== undefined && (!Number.isInteger(intervaloMs) || intervaloMs < 10)) {
    throw new Error('Intervalo de prueba local inválido.')
  }
  let cerrado = false
  let temporizador
  let enCurso = false
  const esperar = () => {
    const ahora = new Date()
    const proxima = new Date(ahora)
    proxima.setUTCHours(9, 0, 0, 0)
    if (proxima <= ahora) proxima.setUTCDate(proxima.getUTCDate() + 1)
    return intervaloMs ?? proxima.getTime() - ahora.getTime()
  }
  const ejecutar = async () => {
    if (cerrado || enCurso) return
    enCurso = true
    try {
      const respuesta = await fetch(destino, { headers: { authorization: `Bearer ${secreto}` },
        signal: AbortSignal.timeout(65_000) })
      const resultado = await respuesta.json()
      if (!respuesta.ok) alError({ estado: respuesta.status })
      else alResultado(resultado)
    } catch { alError({ estado: 'INCIERTO' }) }
    finally {
      enCurso = false
      if (!cerrado) temporizador = setTimeout(ejecutar, esperar())
    }
  }
  temporizador = setTimeout(ejecutar, esperar())
  return { activo: true, detener() { cerrado = true; clearTimeout(temporizador) } }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const tarea = programarRecordatorio({
    url: process.env.EPT_RECORDATORIO_LOCAL_URL ?? 'http://127.0.0.1:3000/api/cron/recordatorio-mensual',
    secreto: process.env.CRON_SECRET,
    habilitada: process.env.EPT_RECORDATORIO_LOCAL_SCHEDULER === 'habilitado',
    alResultado: (r) => console.log(JSON.stringify(r)),
    alError: (r) => console.error('Ejecución del recordatorio no confirmada:', r.estado),
  })
  console.log(tarea.activo ? 'Tarea local programada a las 06:00 de Argentina.' : 'Scheduler local deshabilitado.')
  process.on('SIGINT', () => tarea.detener())
  process.on('SIGTERM', () => tarea.detener())
}
