import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { entorno, sql, sembrar, tarifas, facturar, limpieza, vincular, desvincular, perfilDe, reloj,
  compuertaAviso, compuertaRecordatorio, items, pagar, envioAviso, intentosAviso, contarAvisos,
  hijo1, hijo2, hijo3, hijo4, DOMINIO, contenedor, director } from './_aviso-fixture.mjs'
import { crearServidorNext, crearCuentaConPerfil, exigirSesion, rpc, rest, limpiarFixture, crearIntermediario } from './_arnes-ept59.mjs'
import { programarAvisoDeuda } from '../../scripts/aviso-deuda-local.mjs'

/**
 * EPT-116 — punta a punta: endpoint Next, PostgreSQL/PostgREST, scheduler real y SMTP real
 * (Mailpit del stack aislado). Cuentas, familias y pagos sintéticos.
 */
const inicioSuite = Date.now()
const local = entorno()
const PUERTO_NEXT = 31616
const PUERTO_SUPABASE = 31716
const PUERTO_SMTP = 31816
const servidor = crearServidorNext(PUERTO_NEXT)
const intermediario = crearIntermediario(local.API_URL)
const secreto = randomBytes(32).toString('hex')
const password = randomBytes(20).toString('hex')
if (!/^\d{1,5}$/u.test(process.env.EPT_TEST_SMTP_PORT ?? '')) throw new Error('Falta EPT_TEST_SMTP_PORT (smtp_port del stack aislado).')
const smtpMailpit = Number(process.env.EPT_TEST_SMTP_PORT)
const mailpit = local.MAILPIT_URL
if (!['127.0.0.1', 'localhost'].includes(new URL(mailpit).hostname)) throw new Error('Mailpit no es local.')

let n = 0
const ok = (nombre) => { n++; console.log(`OK ${n}: ${nombre}`) }
const correo = (corto) => `ept115-av-${corto}@${DOMINIO}`
const modos = new Map() // correo → 'rechazar' | 'cortar'

// ---------------------------------------------------------------- SMTP intermedio (por destinatario)
function crearReenviadorSmtp(puertoDestino) {
  const conexiones = new Set()
  const srv = net.createServer((cliente) => {
    const arriba = net.connect(puertoDestino, '127.0.0.1')
    conexiones.add(cliente); conexiones.add(arriba)
    let enDatos = false; let modo = null; let cortar = false; let cola = ''
    cliente.on('data', (d) => {
      const s = d.toString('latin1')
      if (!enDatos) {
        const m = /RCPT TO:<([^>]+)>/iu.exec(s)
        if (m) {
          modo = modos.get(m[1].toLowerCase()) ?? null
          if (modo === 'rechazar') { cliente.write('550 5.1.1 Destinatario rechazado por la prueba\r\n'); return }
        }
        if (/^DATA\r\n/iu.test(s)) enDatos = true
      } else {
        cola = (cola + s).slice(-8)
        if (modo === 'cortar' && cola.includes('\r\n.\r\n')) cortar = true
      }
      arriba.write(d)
    })
    arriba.on('data', (d) => {
      if (cortar) { cliente.destroy(); arriba.destroy(); return } // aceptado arriba, respuesta perdida
      cliente.write(d)
    })
    for (const s of [cliente, arriba]) { s.on('error', () => {}); s.on('close', () => { cliente.destroy(); arriba.destroy() }) }
  })
  return {
    escuchar: () => new Promise((r) => srv.listen(PUERTO_SMTP, '127.0.0.1', r)),
    cerrar: () => new Promise((r) => { for (const c of conexiones) c.destroy(); srv.close(() => r()) }),
  }
}
const smtp = crearReenviadorSmtp(smtpMailpit)

// ---------------------------------------------------------------- Mailpit
async function mensajes(para) {
  const r = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${para}`)}`, { signal: AbortSignal.timeout(10_000) })
  return (await r.json()).messages ?? []
}
const mensaje = async (idm) => (await fetch(`${mailpit}/api/v1/message/${idm}`)).json()
const unico = async (p) => {
  const ms = await mensajes(p.email)
  assert.equal(ms.length, 1, `un solo correo para ${p.email}`)
  return mensaje(ms[0].ID)
}
const totalMensajes = async () => (await (await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${DOMINIO}`)}`)).json()).messages_count ?? 0
async function limpiarBuzon() {
  await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${DOMINIO}`)}`, { method: 'DELETE' })
}

// ---------------------------------------------------------------- HTTP
const RUTA = '/api/cron/aviso-deuda'
async function llamar(ruta, { token, method = 'GET' } = {}) {
  return fetch(`${servidor.url}${ruta}`, { method, headers: token ? { authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(70_000) })
}
const cron = async () => {
  const r = await llamar(RUTA, { token: secreto })
  return { estado: r.status, ...(await r.json()) }
}
let cuentas = 0
async function crearPadre(corto, hijos) {
  cuentas++
  const email = correo(corto)
  await crearCuentaConPerfil(local, { email, password, perfil: { nombre: `Padre ${corto}`, apellido: 'EPT116',
    dni: `941152${String(cuentas).padStart(2, '0')}`, rol_id: Number(sql(`SELECT id FROM public.roles WHERE nombre='PADRE'`)) } })
  const perfil = perfilDe(email)
  for (const h of hijos) vincular(perfil, h)
  return { email, perfil }
}
const EVENTO = '2026-11-20' // viernes
const DIC = '2026-12-20' // domingo

try {
  sql(limpieza); sembrar(); tarifas()
  await limpiarBuzon()
  // hijo1/hijo2 con dos períodos; hijo3 y hijo4 con noviembre. Los pagos se registran antes de la primera ejecución.
  for (const h of [hijo1, hijo2]) for (const p of ['2026-10-01', '2026-11-01']) facturar(h, p)
  for (const h of [hijo3, hijo4]) facturar(h, '2026-11-01')
  await crearCuentaConPerfil(local, { email: correo('dir'), password, perfil: { nombre: 'Dir', apellido: 'API EPT116',
    dni: '94115991', rol_id: Number(sql(`SELECT id FROM public.roles WHERE nombre='DIRECTOR'`)) } })
  const A = await crearPadre('a', [hijo1, hijo2])
  const B = await crearPadre('b', [hijo1])
  const C = await crearPadre('c', [hijo3])
  const Z = await crearPadre('z', [hijo4]) // saldo cero: todo pagado
  const sesionDir = await exigirSesion(local, correo('dir'), password)
  const sesionA = await exigirSesion(local, A.email, password)

  // Hijo1: octubre con cuota y transporte aprobados; noviembre sin pagos, con un comprobante en verificación
  // (deporte B) y un pago rechazado (comedor). Hijo2: octubre pagado completo, noviembre sin pagos.
  pagar(A.perfil, hijo1, [...items(hijo1, '2026-10-01', 'CUOTA'), ...items(hijo1, '2026-10-01', 'TRANSPORTE')], 'APROBADO')
  pagar(A.perfil, hijo1, items(hijo1, '2026-11-01', 'DEPORTE', 20.2), 'PENDIENTE_VERIFICACION')
  pagar(A.perfil, hijo1, items(hijo1, '2026-11-01', 'COMEDOR'), 'RECHAZADO', { importeInformado: 999999 })
  pagar(A.perfil, hijo2, items(hijo2, '2026-10-01', 'CUOTA'), 'APROBADO')
  pagar(Z.perfil, hijo4, items(hijo4, '2026-11-01', 'CUOTA'), 'APROBADO')

  await smtp.escuchar()
  await intermediario.escuchar(PUERTO_SUPABASE)
  const variables = { NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${PUERTO_SUPABASE}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: local.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY, CRON_SECRET: secreto, EPT_AVISO_DEUDA_HABILITADO: 'habilitado',
    EPT_SMTP_HOST: '127.0.0.1', EPT_SMTP_PORT: String(PUERTO_SMTP), EPT_SMTP_SECURE: 'false', EPT_SMTP_REMITENTE: 'no-responder@ept.local' }
  await servidor.iniciar(variables)

  // ---------------------------------------------------------------- 1. Protección del endpoint
  assert.equal((await llamar(RUTA)).status, 401)
  assert.equal((await llamar(RUTA, { token: 'incorrecto' })).status, 401)
  assert.equal((await llamar(RUTA, { token: sesionDir.access_token })).status, 401)
  assert.equal((await llamar(RUTA, { token: sesionA.access_token })).status, 401)
  assert.equal((await llamar(`${RUTA}?fecha=2026-11-20`, { token: secreto })).status, 400)
  assert.equal((await llamar(`${RUTA}?destino=x@y.z&importe=1&rol=DIRECTOR`, { token: secreto })).status, 400)
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal((await llamar(RUTA, { token: secreto, method })).status, 405)
  assert.equal(await totalMensajes(), 0)
  ok('endpoint rechaza sin secreto, secreto ajeno, sesión de Dirección/padre, fecha/destino/importe/rol arbitrarios y métodos no permitidos')

  // ---------------------------------------------------------------- 2. Compuertas independientes
  reloj(EVENTO)
  compuertaRecordatorio(true) // la del recordatorio NO enciende el aviso
  const apagadoDb = await cron()
  assert.equal(apagadoDb.habilitada, false)
  assert.equal(await contarAvisos(), '0')
  assert.equal(await totalMensajes(), 0)
  compuertaRecordatorio(false)
  ok('con la compuerta del aviso apagada (aunque el entorno y la del recordatorio estén activos) no hay filas, SMTP ni mensajes')

  // ---------------------------------------------------------------- 3. Calendario: ni el 19 ni el 21 generan el evento inicial
  compuertaAviso(true)
  for (const fecha of ['2026-11-19', '2026-11-21']) {
    reloj(fecha)
    assert.equal((await cron()).enviados, 0)
    assert.equal(await contarAvisos(), '0')
  }
  assert.equal(await totalMensajes(), 0)
  ok('el día 19 y el 21 sin evento previo no generan primer envío (sin catch-up)')

  // ---------------------------------------------------------------- 4. Día 20: un correo por padre con la deuda real
  sql(`UPDATE public.perfiles SET apellido='Gómez <b>&"x"' WHERE id='${hijo3}'`) // escape HTML
  reloj(EVENTO)
  const t0 = Date.now()
  const r1 = await cron()
  const dur1 = Date.now() - t0
  assert.deepEqual([r1.estado, r1.enviados, r1.fallidos, r1.inciertos, r1.sin_confirmar], [200, 3, 0, 0, 0])
  assert.equal(await contarAvisos(), '3') // Z (saldo cero) no tiene fila
  assert.equal(envioAviso(Z.perfil, EVENTO), null)
  assert.equal((await mensajes(Z.email)).length, 0)
  const mA = await unico(A)
  assert.equal(mA.To.length, 1); assert.equal(mA.To[0].Address, A.email)
  assert.equal((mA.Attachments ?? []).length, 0)
  assert.equal((mA.Cc ?? []).length + (mA.Bcc ?? []).length, 0)
  for (const x of ['20/11/2026', 'Ana', 'Bruno', 'octubre de 2026', 'noviembre de 2026', 'Cuota', 'Deporte EPT115 B', 'Transporte EPT115',
    'Comedor EPT115', 'ARS 20,20', 'ARS 40,40', 'ARS 100,10', 'ARS 30,30', 'ARS 200,20', 'Total de deuda: ARS 451,80',
    'Subtotal de Pérez, Ana: ARS 251,60', 'Subtotal de Pérez, Bruno: ARS 200,20', 'ARS 20,20 tiene un comprobante en verificación'])
    assert.ok(mA.Text.includes(x), `cuerpo de A contiene «${x}»`)
  // Lo pagado (octubre: cuota y transporte) y los ítems sin importe no figuran; lo rechazado y lo informado de más no cancelan deuda.
  assert.ok(!mA.Text.includes('ARS 391,20') && !mA.Text.includes('999.999'))
  const mB = await unico(B)
  assert.ok(mB.Text.includes('Total de deuda: ARS 251,60') && !mB.Text.includes('Bruno'))
  const mC = await unico(C)
  assert.ok(mC.Text.includes('Total de deuda: ARS 100,10') && !mC.Text.includes('Ana') && !mC.Text.includes('251,60'))
  assert.ok(mC.HTML.includes('Gómez &lt;b&gt;&amp;&quot;x&quot;') && !mC.HTML.includes('<b>&'), 'nombre escapado en HTML')
  assert.ok(!servidor.registro.includes(A.email))
  ok(`un correo por padre el día 20 con la deuda real (sin pagados, con en-verificación y rechazados vigentes, total exacto), sin adjuntos ni copias; saldo cero sin fila ni SMTP (${dur1} ms)`)
  const fa = envioAviso(A.perfil, EVENTO)
  assert.deepEqual([fa.estado, fa.intentos, fa.corte_fecha, fa.total, fa.periodo, fa.enviado], ['ENVIADO', 1, EVENTO, '451.80', '2026-11-01', true])
  assert.deepEqual(intentosAviso(A.perfil, EVENTO).map((i) => [i.intento, i.resultado, i.total]), [[1, 'ENVIADO', '451.80']])
  ok('registro durable: identidad (padre, AVISO_DEUDA, día 20), corte, total, intento e historia por intento')

  // ---------------------------------------------------------------- 5. Doble ejecución y workers simultáneos
  const resultados = await Promise.all([cron(), cron(), cron(), cron()])
  assert.ok(resultados.every((r) => r.enviados === 0 && r.sin_confirmar === 0))
  assert.equal(await totalMensajes(), 3)
  ok('cuatro ejecuciones simultáneas del mismo día no reenvían un ENVIADO confirmado')

  // ---------------------------------------------------------------- 6. Scheduler real
  assert.equal(programarAvisoDeuda({ url: servidor.url + RUTA, secreto }).activo, false)
  let resolver; let rechazar
  const dosTicks = new Promise((r, j) => { resolver = r; rechazar = j })
  const vistos = []
  const limite = setTimeout(() => rechazar(new Error('El scheduler no produjo dos ejecuciones.')), 60_000)
  const tarea = programarAvisoDeuda({ url: servidor.url + RUTA, secreto, habilitada: true, intervaloMs: 30,
    alResultado: (r) => { vistos.push(r); if (vistos.length === 2) { tarea.detener(); resolver() } }, alError: (r) => rechazar(new Error(`Scheduler: ${r.estado}`)) })
  try { await dosTicks } finally { clearTimeout(limite); tarea.detener() }
  assert.ok(vistos.every((r) => r.enviados === 0) && await totalMensajes() === 3)
  assert.throws(() => programarAvisoDeuda({ url: 'http://example.com/api/cron/aviso-deuda', secreto, habilitada: true }))
  assert.throws(() => programarAvisoDeuda({ url: servidor.url + '/api/cron/recordatorio-mensual', secreto, habilitada: true }))
  ok('scheduler con temporizadores reales llama Next/PostgREST/SMTP dos veces sin duplicar, queda inactivo por defecto y rechaza destinos no locales')

  // ---------------------------------------------------------------- 7. Fallo claro, incierto, impedimentos y progreso del lote (mismo día 20)
  // Padres sobre hijos con deuda; D, F, G, H e I fallan con rechazo SMTP claro; E acepta con la respuesta cortada.
  const D = await crearPadre('d', [hijo3]); modos.set(D.email, 'rechazar') // pagará todo antes del reintento
  const E = await crearPadre('e', [hijo3]); modos.set(E.email, 'cortar')
  const G = await crearPadre('g', [hijo1]); modos.set(G.email, 'rechazar') // pagará una parte
  const H = await crearPadre('h', [hijo2]); modos.set(H.email, 'rechazar') // perderá el vínculo
  const I = await crearPadre('i', [hijo2]); modos.set(I.email, 'rechazar') // será bloqueado
  const Jc = await crearPadre('j', [hijo2]) // correo inválido
  sql(`UPDATE auth.users SET email='sin-arroba-ept116' WHERE id=(SELECT user_id FROM public.perfiles WHERE id='${Jc.perfil}')`)
  reloj(EVENTO)
  const r2 = await cron()
  assert.equal(r2.sin_confirmar, 0); assert.equal(r2.estado, 200)
  assert.deepEqual([r2.enviados, r2.inciertos, r2.fallidos], [0, 1, 5])
  for (const p of [D, G, H, I, Jc]) assert.equal(envioAviso(p.perfil, EVENTO).estado, 'FALLIDO')
  assert.match(envioAviso(Jc.perfil, EVENTO).ultimo_error, /correo válido/u)
  assert.equal(envioAviso(E.perfil, EVENTO).estado, 'INCIERTO'); assert.equal(envioAviso(E.perfil, EVENTO).enviado, false)
  assert.equal((await mensajes(E.email)).length, 1, 'el INCIERTO sí fue aceptado por SMTP')
  for (const p of [D, G, H, I, Jc]) assert.equal((await mensajes(p.email)).length, 0)
  ok('progreso del lote: rechazo SMTP y correo inválido → FALLIDO; aceptación con respuesta cortada → INCIERTO sin enviado_en; el resto del lote sigue')
  const r2b = await cron()
  assert.deepEqual([r2b.enviados, r2b.fallidos, r2b.inciertos], [0, 0, 0])
  assert.equal(envioAviso(D.perfil, EVENTO).intentos, 1)
  ok('el mismo día no hay reintento de FALLIDO ni de INCIERTO')

  // ---------------------------------------------------------------- 8. Reintento del día 21: revalidación completa
  // D: el hijo3 se paga entero (queda deuda cero) → se omite sin correo. G: se paga el transporte → el aviso refleja el saldo restante.
  // H: pierde el vínculo con hijo2. I: la cuenta queda bloqueada. Jc: correo inválido persiste.
  modos.delete(D.email); modos.delete(G.email); modos.delete(H.email); modos.delete(I.email)
  pagar(C.perfil, hijo3, items(hijo3, '2026-11-01', 'CUOTA'), 'APROBADO')
  pagar(A.perfil, hijo1, items(hijo1, '2026-11-01', 'TRANSPORTE'), 'APROBADO')
  desvincular(H.perfil, hijo2)
  sql(`UPDATE public.perfiles SET estado_acceso='BLOQUEADO' WHERE id='${I.perfil}'`)
  reloj('2026-11-21')
  const r3 = await cron()
  assert.equal(r3.sin_confirmar, 0)
  assert.equal(envioAviso(D.perfil, EVENTO).omitido_motivo !== null, true)
  assert.equal(envioAviso(D.perfil, EVENTO).estado, 'FALLIDO'); assert.equal(envioAviso(D.perfil, EVENTO).enviado, false)
  assert.ok(envioAviso(D.perfil, EVENTO).ultimo_error) // la historia del fallo previo se conserva
  assert.deepEqual(intentosAviso(D.perfil, EVENTO).map((i) => i.resultado), ['FALLIDO', 'OMITIDO'])
  assert.equal((await mensajes(D.email)).length, 0)
  assert.equal(envioAviso(H.perfil, EVENTO).omitido_motivo !== null, true) // sin hijos autorizados no hay qué avisar
  assert.equal((await mensajes(H.email)).length, 0)
  assert.equal(envioAviso(I.perfil, EVENTO).estado, 'FALLIDO'); assert.match(envioAviso(I.perfil, EVENTO).ultimo_error, /no está habilitada/u)
  assert.equal((await mensajes(I.email)).length, 0)
  assert.equal(envioAviso(Jc.perfil, EVENTO).intentos, 2)
  const mG = await unico(G)
  assert.ok(mG.Text.includes('21/11/2026') && mG.Text.includes('Total de deuda: ARS 221,30'), 'la deuda restante real, al corte del 21')
  assert.ok(!mG.Text.includes('ARS 30,30') && !mG.Text.includes('Bruno'))
  assert.equal(envioAviso(G.perfil, EVENTO).estado, 'ENVIADO')
  assert.equal(envioAviso(G.perfil, EVENTO).intentos, 2); assert.equal(envioAviso(G.perfil, EVENTO).corte_fecha, '2026-11-21')
  assert.equal(sql(`SELECT count(*) FROM public.envios_correo WHERE padre_id='${G.perfil}' AND tipo='AVISO_DEUDA'`), '1')
  assert.equal(envioAviso(E.perfil, EVENTO).estado, 'INCIERTO'); assert.equal((await mensajes(E.email)).length, 1)
  ok('reintento del día 21 con identidad original: pago total → omisión honesta sin ENVIADO; pago parcial → saldo restante real; vínculo revocado y cuenta bloqueada revalidados; INCIERTO intacto')

  // ---------------------------------------------------------------- 9. Reintento diario hasta el último día del mes inclusive
  const P = await crearPadre('p', [hijo2]); modos.set(P.email, 'rechazar') // rechazo permanente
  reloj(EVENTO); await cron() // ya fuera de la ventana de creación? No: el día 20 vuelve a evaluar y programa a P
  for (let d = 21; d <= 30; d++) { reloj('2026-11-' + String(d)); await cron() }
  const intentosP = envioAviso(P.perfil, EVENTO).intentos
  assert.equal(intentosP, 11) // 20, 21 … 30 de noviembre
  reloj('2026-12-01'); await cron(); await cron()
  assert.equal(envioAviso(P.perfil, EVENTO).intentos, 11)
  assert.equal(envioAviso(P.perfil, EVENTO).estado, 'FALLIDO')
  assert.equal(sql(`SELECT count(*) FROM public.envios_correo WHERE padre_id='${P.perfil}' AND tipo='AVISO_DEUDA'`), '1')
  assert.equal(envioAviso(E.perfil, EVENTO).intentos, 1)
  ok('reintento diario hasta el 30/11 inclusive (11 intentos) y ninguno el 1/12; identidad única; INCIERTO nunca se reintenta')

  // ---------------------------------------------------------------- 11. Aviso y recordatorio son eventos distintos
  reloj('2026-11-30'); // último día hábil de noviembre y último reintento del aviso de noviembre
  const antesAviso = sql(`SELECT count(*), coalesce(sum(intentos),0) FROM public.envios_correo WHERE tipo='AVISO_DEUDA'`)
  compuertaRecordatorio(true)
  sql(`SELECT app_private.recordatorio_plan();`)
  assert.equal(sql(`SELECT count(*), coalesce(sum(intentos),0) FROM public.envios_correo WHERE tipo='AVISO_DEUDA'`), antesAviso)
  assert.ok(Number(sql(`SELECT count(*) FROM public.envios_correo WHERE tipo='RECORDATORIO_MENSUAL'`)) > 0)
  const recordatorios = sql(`SELECT md5(string_agg(e::text, '' ORDER BY id)) FROM public.envios_correo e WHERE tipo='RECORDATORIO_MENSUAL'`)
  await cron()
  assert.equal(sql(`SELECT md5(string_agg(e::text, '' ORDER BY id)) FROM public.envios_correo e WHERE tipo='RECORDATORIO_MENSUAL'`), recordatorios)
  compuertaRecordatorio(false)
  ok('el plan del recordatorio no toca filas AVISO_DEUDA y una ejecución del aviso no altera filas RECORDATORIO_MENSUAL')

  // ---------------------------------------------------------------- 10. El mes siguiente es otro evento (día 20 en domingo)
  modos.delete(P.email)
  reloj(DIC)
  const antes = await totalMensajes()
  const r4 = await cron()
  assert.equal(r4.sin_confirmar, 0)
  assert.ok(r4.enviados >= 4)
  assert.equal(envioAviso(A.perfil, DIC).estado, 'ENVIADO')
  assert.equal(sql(`SELECT count(*) FROM public.envios_correo WHERE padre_id='${A.perfil}' AND tipo='AVISO_DEUDA'`), '2')
  assert.equal((await mensajes(A.email)).length, 2)
  assert.equal(envioAviso(Z.perfil, DIC), null)
  assert.equal(envioAviso(D.perfil, DIC), null) // D ya pagó todo
  assert.ok((await totalMensajes()) > antes)
  const mA2 = (await Promise.all((await mensajes(A.email)).map((m) => mensaje(m.ID)))).find((m) => m.Text.includes('20/12/2026'))
  assert.ok(mA2.Text.includes('Total de deuda: ARS 421,50')) // 451,80 − 30,30 (transporte pagado el 21/11)
  assert.equal(envioAviso(P.perfil, DIC).estado, 'ENVIADO') // P no hereda el límite del evento anterior
  ok('día 20 domingo: evento nuevo con identidad propia, A recibe su segundo aviso (421,50), saldo cero sin aviso')

  // ---------------------------------------------------------------- 12. Reservas: crash antes y después de la frontera
  reloj(DIC)
  const Lp = await crearPadre('l', [hijo1]); const Mp = await crearPadre('m', [hijo1])
  sql(`SELECT app_private.aviso_deuda_plan();`) // programa las filas sin despachar
  const rsv = async (p) => (await rpc(local, local.SERVICE_ROLE_KEY, 'aviso_deuda_reservar_job', { p_padre: p.perfil, p_fecha: DIC })).cuerpo
  const rL = await rsv(Lp)
  assert.equal(rL.reservado, true)
  assert.equal((await rsv(Lp)).reservado, false)
  sql(`UPDATE public.envios_correo SET reserva_hasta=clock_timestamp()-interval '1 second' WHERE padre_id='${Lp.perfil}' AND tipo='AVISO_DEUDA'`)
  const rL2 = await rsv(Lp)
  assert.equal(rL2.reservado, true); assert.notEqual(rL2.token, rL.token)
  const viejo = await rpc(local, local.SERVICE_ROLE_KEY, 'aviso_deuda_resultado_job', { p_padre: Lp.perfil, p_fecha: DIC, p_token: rL.token, p_estado: 'ENVIADO', p_error: '' })
  assert.equal(viejo.cuerpo, false)
  assert.equal((await rpc(local, local.SERVICE_ROLE_KEY, 'aviso_deuda_omitir_job', { p_padre: Lp.perfil, p_fecha: DIC, p_token: rL.token, p_motivo: 'x' })).cuerpo, false)
  assert.equal(envioAviso(Lp.perfil, DIC).estado, 'PENDIENTE')
  ok('crash antes de SMTP: la reserva vencida sin frontera se retoma; un intento viejo no confirma ni omite')
  const rM = await rsv(Mp)
  assert.equal((await rpc(local, local.SERVICE_ROLE_KEY, 'aviso_deuda_datos_job', { p_padre: Mp.perfil, p_fecha: DIC, p_token: rM.token })).estado, 200)
  assert.equal((await rpc(local, local.SERVICE_ROLE_KEY, 'aviso_deuda_frontera_job', { p_padre: Mp.perfil, p_fecha: DIC, p_token: rM.token })).cuerpo, true)
  assert.equal((await rpc(local, local.SERVICE_ROLE_KEY, 'aviso_deuda_omitir_job', { p_padre: Mp.perfil, p_fecha: DIC, p_token: rM.token, p_motivo: 'x' })).cuerpo, false)
  assert.notEqual((await rpc(local, local.SERVICE_ROLE_KEY, 'aviso_deuda_datos_job', { p_padre: Mp.perfil, p_fecha: DIC, p_token: rM.token })).estado, 200)
  sql(`UPDATE public.envios_correo SET reserva_hasta=clock_timestamp()-interval '1 second' WHERE padre_id IN ('${Mp.perfil}','${Lp.perfil}') AND tipo='AVISO_DEUDA'`)
  const r5 = await cron()
  assert.equal(envioAviso(Mp.perfil, DIC).estado, 'INCIERTO'); assert.equal((await mensajes(Mp.email)).length, 0)
  assert.deepEqual(intentosAviso(Mp.perfil, DIC).map((i) => i.resultado), ['INCIERTO'])
  assert.equal(envioAviso(Lp.perfil, DIC).estado, 'ENVIADO'); assert.equal((await mensajes(Lp.email)).length, 1)
  assert.equal(r5.sin_confirmar, 0)
  reloj('2026-12-22'); await cron()
  assert.equal(envioAviso(Mp.perfil, DIC).estado, 'INCIERTO'); assert.equal((await mensajes(Mp.email)).length, 0)
  // Un INCIERTO tampoco se reabre porque el saldo cambie
  pagar(Mp.perfil, hijo1, items(hijo1, '2026-11-01', 'COMEDOR'), 'APROBADO')
  reloj('2026-12-23'); await cron()
  assert.equal(envioAviso(Mp.perfil, DIC).estado, 'INCIERTO'); assert.equal((await mensajes(Mp.email)).length, 0)
  ok('crash después de la frontera: barrido a INCIERTO sin envío; INCIERTO no se reabre aunque el saldo cambie; la historia lo registra')

  // ---------------------------------------------------------------- 13. Concurrencia con la aprobación de un pago
  // Un pago se aprueba (commit tardío) mientras el aviso se arma: el correo es coherente con UNA lectura (cuerpo == total registrado).
  const K = await crearPadre('k', [hijo2]); modos.delete(K.email)
  reloj('2026-12-24')
  sql(`DELETE FROM public.envios_correo WHERE padre_id='${K.perfil}'`) // sin filas previas; evento del día 20 ya pasó: se arma por RPC
  sql(`INSERT INTO public.envios_correo(padre_id,tipo,fecha_programada,periodo) VALUES('${K.perfil}','AVISO_DEUDA','${DIC}','2026-12-01')`)
  const sesionSql = spawn('docker', ['exec', '-i', contenedor, 'psql', '-X', '-q', '-A', '-t', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], { stdio: ['pipe', 'ignore', 'inherit'] })
  const terminado = new Promise((r) => sesionSql.on('close', r))
  const itemK = items(hijo2, '2026-11-01', 'CUOTA')
  sesionSql.stdin.end(`BEGIN;
    WITH nuevo AS (INSERT INTO public.pagos(padre_id,alumno_id,total_calculado,importe_informado,fecha_transferencia,numero_operacion,estado,verificado_por,verificado_en)
      VALUES('${K.perfil}','${hijo2}',200.20,200.20,'2026-12-23','OP-EPT116-CARRERA','APROBADO','${director}',now()) RETURNING id)
    INSERT INTO public.imputaciones_pago(pago_id,item_factura_id,alumno_id,importe) SELECT n.id,'${itemK[0]}','${hijo2}',200.20 FROM nuevo n;
    UPDATE public.items_factura SET estado_pago='PAGADO' WHERE id='${itemK[0]}';
    SELECT pg_sleep(2);
    COMMIT;`)
  await new Promise((r) => setTimeout(r, 600))
  const rk = await cron() // corre mientras el pago está sin confirmar: lee el estado ANTERIOR (la deuda sigue vigente)
  await terminado
  const mensajesK = await mensajes(K.email)
  assert.ok(rk.enviados + rk.fallidos + rk.sin_confirmar >= 1)
  if (mensajesK.length === 1) {
    const mk = await mensaje(mensajesK[0].ID)
    const fila = envioAviso(K.perfil, DIC)
    assert.ok(mk.Text.includes(`Total de deuda: ARS ${fila.total.replace('.', ',')}`), 'el total del correo coincide con el registrado')
    assert.ok(mk.Text.includes('ARS 200,20'), 'lectura anterior a la aprobación concurrente')
  }
  // Con el pago ya confirmado, ningún aviso nuevo del mismo evento se envía
  const previos = (await mensajes(K.email)).length
  reloj('2026-12-25'); await cron()
  assert.equal((await mensajes(K.email)).length, previos)
  ok('aprobación de pago concurrente: el correo sale de una lectura coherente (cuerpo == total registrado) y una aprobación posterior no genera otro envío')

  // ---------------------------------------------------------------- 14. Confirmación perdida tras aceptación SMTP
  const Q = await crearPadre('q', [hijo1]); reloj('2026-12-26')
  sql(`INSERT INTO public.envios_correo(padre_id,tipo,fecha_programada,periodo) VALUES('${Q.perfil}','AVISO_DEUDA','${DIC}','2026-12-01')`)
  const inicioQ = intermediario.registro.length
  intermediario.planear('perder-respuesta', (p) => p.ruta === '/rest/v1/rpc/aviso_deuda_resultado_job')
  const rq = await cron()
  assert.deepEqual([rq.enviados, rq.inciertos, rq.sin_confirmar], [1, 0, 0])
  assert.equal(envioAviso(Q.perfil, DIC).estado, 'ENVIADO'); assert.equal((await mensajes(Q.email)).length, 1)
  const traficoQ = intermediario.registro.slice(inicioQ)
  assert.ok(traficoQ.findIndex((x) => x.endsWith('/aviso_deuda_estado_job')) > traficoQ.findIndex((x) => x.endsWith('/aviso_deuda_resultado_job')))
  assert.equal(traficoQ.filter((x) => x.endsWith('/aviso_deuda_resultado_job')).length, 1)
  ok('respuesta de confirmación perdida: se consulta el estado antes de repetir, queda ENVIADO (no INCIERTO) y no se repite el despacho')

  // ---------------------------------------------------------------- 15. Permisos y exposición
  reloj(DIC)
  const llamadas = [['aviso_deuda_plan_job', {}], ['aviso_deuda_reservar_job', { p_padre: A.perfil, p_fecha: DIC }],
    ['aviso_deuda_datos_job', { p_padre: A.perfil, p_fecha: DIC, p_token: A.perfil }], ['aviso_deuda_frontera_job', { p_padre: A.perfil, p_fecha: DIC, p_token: A.perfil }],
    ['aviso_deuda_resultado_job', { p_padre: A.perfil, p_fecha: DIC, p_token: A.perfil, p_estado: 'ENVIADO', p_error: '' }],
    ['aviso_deuda_omitir_job', { p_padre: A.perfil, p_fecha: DIC, p_token: A.perfil, p_motivo: 'x' }], ['aviso_deuda_estado_job', { p_padre: A.perfil, p_fecha: DIC }]]
  for (const [nombre, args] of llamadas) {
    for (const token of [null, sesionA.access_token, sesionDir.access_token]) {
      const r = await rpc(local, token, nombre, args)
      assert.ok([401, 403].includes(r.estado), `${nombre} cerrada a clientes (${r.estado})`)
    }
  }
  assert.deepEqual((await rest(local, sesionA.access_token, 'envios_correo?select=id')).cuerpo, [])
  assert.deepEqual((await rest(local, sesionA.access_token, 'envios_correo_intentos?select=envio_id')).cuerpo, [])
  const vista = await rest(local, sesionDir.access_token, `envios_correo?select=estado,ultimo_error,omitido_motivo,corte_fecha,total_adeudado&tipo=eq.AVISO_DEUDA&padre_id=eq.${E.perfil}`)
  assert.equal(vista.cuerpo[0].estado, 'INCIERTO'); assert.ok(vista.cuerpo[0].ultimo_error)
  assert.ok((await rest(local, sesionDir.access_token, 'envios_correo_intentos?select=envio_id,resultado')).cuerpo.length > 0)
  assert.equal((await rest(local, sesionDir.access_token, 'aviso_deuda_config')).estado, 404)
  assert.ok([401, 403].includes((await rest(local, sesionDir.access_token, 'envios_correo_intentos', { method: 'POST', body: { envio_id: A.perfil, intento: 9, resultado: 'ENVIADO' } })).estado))
  for (const r of [await rest(local, local.SERVICE_ROLE_KEY, `envios_correo?padre_id=eq.${A.perfil}`, { method: 'PATCH', body: { estado: 'PENDIENTE' } }),
    await rest(local, local.SERVICE_ROLE_KEY, `envios_correo_intentos?intento=eq.1`, { method: 'DELETE' }),
    await rest(local, local.SERVICE_ROLE_KEY, 'envios_correo_intentos', { method: 'POST', body: { envio_id: A.perfil, intento: 9, resultado: 'ENVIADO' } })]) {
    assert.ok([401, 403].includes(r.estado), `service_role sin DML sobre el registro (${r.estado})`)
  }
  assert.equal(envioAviso(A.perfil, DIC).estado, 'ENVIADO')
  ok('PostgREST: RPC solo de servidor; padre no ve auditoría ni errores; Dirección sí; config fuera de la API; sin DML directo ni de cliente ni de servicio')

  // ---------------------------------------------------------------- 16. Compuerta de entorno prevalece
  await servidor.detener()
  const antesGate = await totalMensajes()
  await servidor.iniciar({ ...variables, EPT_AVISO_DEUDA_HABILITADO: 'deshabilitado' })
  const apagadoEnv = await cron()
  assert.equal(apagadoEnv.habilitada, false)
  assert.equal(await totalMensajes(), antesGate)
  ok('con la compuerta de entorno apagada aunque la base esté activa: sin consulta ni SMTP')

  assert.ok(!servidor.registro.includes(secreto) && !servidor.registro.includes(local.SERVICE_ROLE_KEY))
  assert.ok(![A, B, C, D, E].some((p) => servidor.registro.includes(p.email)))
  ok('secreto, service_role y destinatarios ausentes de los logs de la aplicación')
  console.log(`PASS ${n} escenarios Next/PostgREST/SMTP/Mailpit en ${Math.round((Date.now() - inicioSuite) / 1000)} s.`)
} finally {
  await servidor.detener()
  await intermediario.cerrar()
  await smtp.cerrar()
  try { sql(limpieza) } catch (e) { console.error('limpieza SQL', e.message) }
  limpiarFixture({ prefijoDni: '941152', prefijoCorreo: 'ept115-av-', dominio: DOMINIO })
  sql(`DELETE FROM public.perfiles WHERE dni='94115991'`)
  sql(`DELETE FROM auth.users WHERE email LIKE 'ept115-av-%@${DOMINIO}' OR email='sin-arroba-ept116'`)
  await limpiarBuzon()
}
