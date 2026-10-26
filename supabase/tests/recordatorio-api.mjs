import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import net from 'node:net'
import { renameSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { extractText } from 'unpdf'
import { entorno, sql, sembrar, tarifas, facturar, limpieza, vincular, desvincular, perfilDe, reloj, compuerta,
  envio, id, hijo1, hijo2, hijo3, hijo4, DOMINIO } from './_recordatorio-fixture.mjs'
import { crearServidorNext, crearCuentaConPerfil, exigirSesion, rpc, rest, limpiarFixture, crearIntermediario, RAIZ } from './_arnes-ept59.mjs'
import { programarRecordatorio } from '../../scripts/recordatorio-local.mjs'

/**
 * EPT-115 — punta a punta: endpoint Next, PostgreSQL/PostgREST, scheduler real y
 * SMTP real (Mailpit del stack aislado ept115). Cuentas y datos sintéticos.
 */
const inicioSuite = Date.now()
const local = entorno()
const PUERTO_NEXT = 31615
const PUERTO_SUPABASE = 31715
const PUERTO_SMTP = 31815
const servidor = crearServidorNext(PUERTO_NEXT)
const intermediario = crearIntermediario(local.API_URL)
const secreto = randomBytes(32).toString('hex')
const password = randomBytes(20).toString('hex')
if (!/^\d{1,5}$/u.test(process.env.EPT_TEST_SMTP_PORT ?? '')) throw new Error('Falta EPT_TEST_SMTP_PORT (smtp_port del stack aislado).')
const smtpMailpit = Number(process.env.EPT_TEST_SMTP_PORT)
const mailpit = local.MAILPIT_URL
if (!['127.0.0.1', 'localhost'].includes(new URL(mailpit).hostname)) throw new Error('Mailpit no es local.')
const fuente = path.join(RAIZ, 'mobile/assets/fonts/Outfit_400Regular.ttf')
const fuenteOculta = `${fuente}.oculta-ept115`

let n = 0
const ok = (nombre) => { n++; console.log(`OK ${n}: ${nombre}`) }
const correo = (corto) => `ept115-${corto}@${DOMINIO}`
// correo → 'rechazar' (RCPT 550) | 'cortar' (aceptado arriba, respuesta final perdida) |
// 'data-rechazo' (554 al comando DATA) | 'fin-4xx' / 'fin-5xx' (rechazo al terminar DATA, sin entregar el cuerpo) |
// 'corte-medio' (se corta la conexión tras el 354, antes de que arriba reciba el cuerpo) |
// 'corte-pre-data' (se corta la conexión en RCPT TO, antes de que el cliente envíe DATA)
const modos = new Map()
// Lo que el intermediario hizo de verdad: permite contrastar el estado durable con la realidad, no con error.code.
const bitacora = []

// ---------------------------------------------------------------- SMTP intermedio (por destinatario)
function crearReenviadorSmtp(puertoDestino) {
  const conexiones = new Set()
  const srv = net.createServer((cliente) => {
    const arriba = net.connect(puertoDestino, '127.0.0.1')
    conexiones.add(cliente); conexiones.add(arriba)
    let enDatos = false; let modo = null; let cortar = false; let cola = ''; let para = ''
    const cerrarArriba = () => arriba.destroy()
    cliente.on('data', (d) => {
      const s = d.toString('latin1')
      if (!enDatos) {
        const m = /RCPT TO:<([^>]+)>/iu.exec(s)
        if (m) {
          para = m[1].toLowerCase()
          modo = modos.get(para) ?? null
          if (modo === 'corte-pre-data') { bitacora.push([para, 'corte-en-RCPT']); cliente.destroy(); cerrarArriba(); return }
          if (modo === 'rechazar') { cliente.write('550 5.1.1 Destinatario rechazado por la prueba\r\n'); return }
        }
        if (/^DATA\r\n/iu.test(s)) {
          if (modo === 'data-rechazo') {
            bitacora.push([para, 'DATA-rechazado']); cliente.write('554 5.3.0 DATA rechazado por la prueba\r\n'); cerrarArriba(); return
          }
          enDatos = true
        }
      } else {
        if (modo === 'corte-medio') { bitacora.push([para, 'corte-tras-354']); cliente.destroy(); cerrarArriba(); return }
        cola = (cola + s).slice(-8)
        if ((modo === 'fin-4xx' || modo === 'fin-5xx') && cola.includes('\r\n.\r\n')) {
          // El chunk con el terminador no se entrega: arriba nunca completa el mensaje.
          bitacora.push([para, modo === 'fin-4xx' ? 'fin-451' : 'fin-554'])
          cliente.write(modo === 'fin-4xx' ? '451 4.3.0 Rechazo temporal al terminar DATA\r\n' : '554 5.6.0 Rechazo permanente al terminar DATA\r\n')
          cerrarArriba(); return
        }
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
async function adjuntos(idm) {
  const m = await mensaje(idm)
  const salida = []
  for (const a of m.Attachments ?? []) {
    const r = await fetch(`${mailpit}/api/v1/message/${idm}/part/${a.PartID}`)
    salida.push({ nombre: a.FileName, tipo: a.ContentType, bytes: new Uint8Array(await r.arrayBuffer()) })
  }
  return { m, adjuntos: salida }
}
async function textoPdf(bytes) { return (await extractText(bytes, { mergePages: true })).text }
const totalMensajes = async () => (await (await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${DOMINIO}`)}`)).json()).messages_count ?? 0
async function limpiarBuzon() {
  await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${DOMINIO}`)}`, { method: 'DELETE' })
}

// ---------------------------------------------------------------- HTTP
async function llamar(ruta, { token, method = 'GET', cabeceras = {} } = {}) {
  return fetch(`${servidor.url}${ruta}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...cabeceras },
    signal: AbortSignal.timeout(70_000) })
}
const cron = async () => {
  const r = await llamar('/api/cron/recordatorio-mensual', { token: secreto })
  const cuerpo = await r.json()
  return { estado: r.status, ...cuerpo }
}
let cuentas = 0
async function crearPadre(corto, hijos, { dni } = {}) {
  cuentas++
  const email = correo(corto)
  await crearCuentaConPerfil(local, { email, password, perfil: { nombre: `Padre ${corto}`, apellido: 'EPT115',
    dni: dni ?? `941151${String(cuentas).padStart(2, '0')}`, rol_id: Number(sql(`SELECT id FROM public.roles WHERE nombre='PADRE'`)) } })
  const perfil = perfilDe(email)
  for (const h of hijos) vincular(perfil, h)
  return { email, perfil }
}
const sinTildes = (s) => s.normalize('NFD').replace(/\p{M}/gu, '')
const EVENTO = '2026-10-30'
const PERIODO = '2026-11-01'

try {
  sql(limpieza); sembrar(); tarifas()
  await limpiarBuzon()
  for (const h of [hijo1, hijo2, hijo3]) facturar(h, PERIODO)
  const dirCuenta = await crearCuentaConPerfil(local, { email: correo('dir'), password, perfil: { nombre: 'Dir', apellido: 'API EPT115',
    dni: '94115990', rol_id: Number(sql(`SELECT id FROM public.roles WHERE nombre='DIRECTOR'`)) } })
  void dirCuenta
  const A = await crearPadre('a', [hijo1, hijo2])
  const B = await crearPadre('b', [hijo1])
  const C = await crearPadre('c', [hijo3])
  const sesionDir = await exigirSesion(local, correo('dir'), password)
  const sesionA = await exigirSesion(local, A.email, password)

  await smtp.escuchar()
  await intermediario.escuchar(PUERTO_SUPABASE)
  const variables = { NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${PUERTO_SUPABASE}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: local.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY, CRON_SECRET: secreto, EPT_RECORDATORIO_HABILITADO: 'habilitado',
    EPT_SMTP_HOST: '127.0.0.1', EPT_SMTP_PORT: String(PUERTO_SMTP), EPT_SMTP_SECURE: 'false', EPT_SMTP_REMITENTE: 'no-responder@ept.local' }
  await servidor.iniciar(variables)

  // ---------------------------------------------------------------- 1. Protección del endpoint
  assert.equal((await llamar('/api/cron/recordatorio-mensual')).status, 401)
  assert.equal((await llamar('/api/cron/recordatorio-mensual', { token: 'incorrecto' })).status, 401)
  assert.equal((await llamar('/api/cron/recordatorio-mensual', { token: sesionDir.access_token })).status, 401)
  assert.equal((await llamar('/api/cron/recordatorio-mensual', { token: sesionA.access_token })).status, 401)
  assert.equal((await llamar('/api/cron/recordatorio-mensual?fecha=2026-10-30', { token: secreto })).status, 400)
  assert.equal((await llamar('/api/cron/recordatorio-mensual?destino=x@y.z&importe=1', { token: secreto })).status, 400)
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal((await llamar('/api/cron/recordatorio-mensual', { token: secreto, method })).status, 405)
  }
  ok('endpoint rechaza sin secreto, secreto ajeno, sesión de Dirección/padre, parámetros de fecha/destino/importe y métodos no permitidos')

  // ---------------------------------------------------------------- 2. Compuerta de base apagada
  reloj(EVENTO)
  const apagadoDb = await cron()
  assert.equal(apagadoDb.habilitada, false)
  assert.equal(sql(`SELECT count(*) FROM public.envios_correo WHERE tipo='RECORDATORIO_MENSUAL'`), '0')
  assert.equal(await totalMensajes(), 0)
  ok('con la compuerta de base apagada (aunque el entorno esté activo) no hay filas, SMTP ni mensajes')

  // ---------------------------------------------------------------- 3. Calendario: sin primer envío fuera del último hábil
  compuerta(true)
  for (const fecha of ['2026-10-29', '2026-11-02']) {
    reloj(fecha)
    const r = await cron()
    assert.equal(r.enviados, 0)
    assert.equal(sql(`SELECT count(*) FROM public.envios_correo WHERE tipo='RECORDATORIO_MENSUAL'`), '0')
  }
  assert.equal(await totalMensajes(), 0)
  ok('el día anterior (29/10) y el posterior (02/11) al último hábil no generan primer envío')

  // ---------------------------------------------------------------- 3b. Renderer fallido (primer uso tras iniciar) y recuperación
  reloj(EVENTO)
  renameSync(fuente, fuenteOculta)
  let rr
  try { rr = await cron() } finally { if (existsSync(fuenteOculta)) renameSync(fuenteOculta, fuente) }
  assert.deepEqual([rr.estado, rr.enviados, rr.fallidos, rr.sin_confirmar], [200, 0, 3, 0])
  for (const p of [A, B, C]) {
    assert.equal(envio(p.perfil, EVENTO).estado, 'FALLIDO'); assert.match(envio(p.perfil, EVENTO).ultimo_error, /PDF/u)
  }
  assert.equal(await totalMensajes(), 0)
  assert.equal((await cron()).fallidos, 0) // mismo día: sin reintento
  ok('renderer fallido (fuente ausente): FALLIDO para todos, sin correo parcial, sin reintento el mismo día')
  reloj('2026-10-31') // el siguiente día retoma con la misma identidad; la lectura de la fuente se recupera sola

  // ---------------------------------------------------------------- 4. Último hábil: un correo por padre con todos sus hijos
  const t0 = Date.now()
  const r1 = await cron()
  const dur1 = Date.now() - t0
  assert.deepEqual([r1.estado, r1.enviados, r1.fallidos, r1.inciertos, r1.sin_confirmar], [200, 3, 0, 0, 0])
  assert.equal(sql(`SELECT count(*) FROM public.envios_correo WHERE tipo='RECORDATORIO_MENSUAL'`), '3')
  for (const [p, cant] of [[A, 2], [B, 1], [C, 1]]) {
    const ms = await mensajes(p.email)
    assert.equal(ms.length, 1, `un solo correo para ${p.email}`)
    const { m, adjuntos: ad } = await adjuntos(ms[0].ID)
    assert.equal(m.To.length, 1)
    assert.equal(m.To[0].Address, p.email)
    assert.equal(ad.length, cant)
    for (const a of ad) {
      assert.equal(a.tipo, 'application/pdf')
      assert.match(a.nombre, /^factura-2026-11-\d-[A-Za-z0-9-]+\.pdf$/u)
      assert.equal(Buffer.from(a.bytes.slice(0, 5)).toString(), '%PDF-')
    }
  }
  // Composición exacta
  const mA = await adjuntos((await mensajes(A.email))[0].ID)
  assert.match(mA.m.Text, /Ana/u); assert.match(mA.m.Text, /Bruno/u)
  for (const x of ['Cuota', 'Deporte EPT115 A', 'Deporte EPT115 B', 'Transporte EPT115', 'Comedor EPT115',
    'ARS 100,10', 'ARS 20,20', 'ARS 30,30', 'ARS 40,40', 'ARS 200,20', 'ARS 0,00']) assert.ok(mA.m.Text.includes(x), `cuerpo contiene ${x}`)
  assert.ok(mA.m.Text.includes('Total facturado: ARS 391,20') && mA.m.Text.includes('Saldo por abonar: ARS 391,20'))
  assert.ok(mA.m.Text.includes('10/11/2026'))
  // Inspección visual (EPT-118): con EPT_PDF_MUESTRAS los PDF realmente recibidos en Mailpit se guardan fuera del repositorio.
  if (process.env.EPT_PDF_MUESTRAS) {
    mkdirSync(path.resolve(process.env.EPT_PDF_MUESTRAS), { recursive: true })
    for (const a of mA.adjuntos) writeFileSync(path.join(path.resolve(process.env.EPT_PDF_MUESTRAS), `mailpit-${a.nombre.replace(/[^A-Za-z0-9._-]/gu, '_')}`), a.bytes)
  }
  const textosA = await Promise.all(mA.adjuntos.map((a) => textoPdf(a.bytes)))
  assert.ok(textosA.some((t) => t.includes('Ana') && t.includes('ARS 191,00') && t.includes('Transporte') && t.includes('Comedor')))
  assert.ok(textosA.some((t) => t.includes('Bruno') && t.includes('ARS 200,20')))
  assert.ok(textosA.every((t) => t.includes('Factura institucional') && t.includes('noviembre de 2026') && t.includes('10/11/2026')))
  assert.ok(textosA.every((t) => !t.includes('Recibo institucional')))
  const mB = await adjuntos((await mensajes(B.email))[0].ID)
  assert.ok(mB.m.Text.includes('Total facturado: ARS 191,00') && !mB.m.Text.includes('Bruno'))
  const mC = await adjuntos((await mensajes(C.email))[0].ID)
  assert.ok(mC.m.Text.includes('Total facturado: ARS 100,10') && !mC.m.Text.includes('Ana') && !mC.m.Text.includes('Pérez'))
  assert.ok(!(await textoPdf(mC.adjuntos[0].bytes)).includes('Pérez'))
  assert.ok(!servidor.registro.includes(A.email))
  ok(`un correo por padre con todos sus hijos; PDF de factura por hijo (MIME, nombre, texto, importes, acentos); dos padres del mismo hijo reciben cada uno el suyo; otra familia aislada (${dur1} ms)`)
  assert.equal(sql(`SELECT count(*) FROM public.envios_correo_facturas f JOIN public.envios_correo e ON e.id=f.envio_id WHERE e.padre_id='${A.perfil}'`), '2')
  assert.equal(sql(`SELECT count(*) FROM public.envios_correo WHERE estado='ENVIADO' AND intentos=2 AND enviado_en IS NOT NULL AND fecha_programada='${EVENTO}' AND periodo='${PERIODO}'`), '3')
  ok('registro durable ENVIADO (intentos=2 tras el fallo del renderer, evento original, período M+1) y facturas adjuntas auditadas')

  // ---------------------------------------------------------------- 5. Doble ejecución y concurrencia
  const resultados = await Promise.all([cron(), cron(), cron(), cron()])
  assert.ok(resultados.every((r) => r.enviados === 0))
  assert.equal(await totalMensajes(), 3)
  ok('cuatro ejecuciones simultáneas del mismo día no reenvían un ENVIADO confirmado')

  // ---------------------------------------------------------------- 6. Scheduler real
  assert.equal(programarRecordatorio({ url: servidor.url + '/api/cron/recordatorio-mensual', secreto }).activo, false)
  let resolver; let rechazar
  const dosTicks = new Promise((r, j) => { resolver = r; rechazar = j })
  const vistos = []
  const limite = setTimeout(() => rechazar(new Error('El scheduler no produjo dos ejecuciones.')), 60_000)
  const tarea = programarRecordatorio({ url: servidor.url + '/api/cron/recordatorio-mensual', secreto, habilitada: true, intervaloMs: 30,
    alResultado: (r) => { vistos.push(r); if (vistos.length === 2) { tarea.detener(); resolver() } }, alError: (r) => rechazar(new Error(`Scheduler: ${r.estado}`)) })
  try { await dosTicks } finally { clearTimeout(limite); tarea.detener() }
  assert.ok(vistos.every((r) => r.enviados === 0) && await totalMensajes() === 3)
  ok('scheduler con temporizadores reales llama Next/PostgREST/SMTP dos veces sin duplicar y queda inactivo por defecto')

  // ---------------------------------------------------------------- 7. Fallo claro, incierto, impedimentos y progreso del lote
  const D = await crearPadre('d', [hijo3]); modos.set(D.email, 'rechazar')
  const E = await crearPadre('e', [hijo3]); modos.set(E.email, 'cortar')
  const F = await crearPadre('f', [hijo4])         // hijo4 sin factura
  const Pr = await crearPadre('p', [hijo2]); modos.set(Pr.email, 'rechazar') // rechazo permanente (límite día 10)
  const Jc = await crearPadre('j', [hijo2])        // correo inválido
  const Jm = await crearPadre('jm', [hijo2])       // dos destinatarios en un solo campo
  sql(`UPDATE auth.users SET email='sin-arroba-ept115' WHERE id=(SELECT user_id FROM public.perfiles WHERE id='${Jc.perfil}')`)
  sql(`UPDATE auth.users SET email='ept115-jm-a@${DOMINIO},ept115-jm-b@${DOMINIO}' WHERE id=(SELECT user_id FROM public.perfiles WHERE id='${Jm.perfil}')`)
  reloj(EVENTO)
  const r2 = await cron()
  assert.equal(r2.sin_confirmar, 0)
  assert.equal(r2.estado, 200)
  assert.equal(r2.inciertos, 1)  // E
  assert.equal(r2.fallidos, 5)   // D (rechazo), F (sin factura), Pr (rechazo), Jc y Jm (correo inválido)
  assert.equal(r2.enviados, 0)
  assert.equal(envio(D.perfil, EVENTO).estado, 'FALLIDO')
  assert.equal(envio(E.perfil, EVENTO).estado, 'INCIERTO')
  assert.equal(envio(F.perfil, EVENTO).estado, 'FALLIDO'); assert.match(envio(F.perfil, EVENTO).ultimo_error, /Falta la factura/u)
  assert.equal(envio(Jc.perfil, EVENTO).estado, 'FALLIDO'); assert.match(envio(Jc.perfil, EVENTO).ultimo_error, /correo válido/u)
  assert.equal(envio(E.perfil, EVENTO).enviado, false)
  assert.equal((await mensajes(E.email)).length, 1, 'el INCIERTO sí fue aceptado por SMTP: quedó en el buzón')
  assert.equal((await mensajes(D.email)).length, 0); assert.equal((await mensajes(F.email)).length, 0)
  ok('progreso del lote: fallo claro (rechazo SMTP) → FALLIDO, aceptación con respuesta cortada → INCIERTO sin enviado_en, factura faltante/correo inválido → FALLIDO sin mensaje')
  assert.equal(r2.enviados + r2.fallidos + r2.inciertos, 6)

  // Mismo día: sin reintento ni de FALLIDO ni de INCIERTO
  const r2b = await cron()
  assert.deepEqual([r2b.enviados, r2b.fallidos, r2b.inciertos], [0, 0, 0])
  assert.equal(envio(D.perfil, EVENTO).intentos, 1)
  ok('el mismo día no hay reintento de FALLIDO y nunca de INCIERTO')

  // ---------------------------------------------------------------- 8. Reintento diario hasta el día 10 inclusive
  // Se emite la factura faltante (hijo4) y se levanta el rechazo de D.
  facturar(hijo4, PERIODO); modos.delete(D.email)
  reloj('2026-10-31')
  const r3 = await cron()
  assert.equal(r3.enviados, 2) // D y F
  assert.equal(envio(D.perfil, EVENTO).estado, 'ENVIADO'); assert.equal(envio(D.perfil, EVENTO).intentos, 2)
  assert.equal((await mensajes(D.email)).length, 1)
  const mF = await adjuntos((await mensajes(F.email))[0].ID)
  const textoF = await textoPdf(mF.adjuntos[0].bytes)
  assert.ok(sinTildes(textoF.replace(/\s+/gu, ' ')).includes('Montenegro'))
  assert.ok(textoF.includes('Ángeles') || sinTildes(textoF).includes('Angeles'))
  assert.equal(sql(`SELECT count(*) FROM public.envios_correo WHERE padre_id='${D.perfil}'`), '1')
  assert.equal(envio(D.perfil, EVENTO).enviado, true)
  ok('FALLIDO se retoma al día siguiente con la misma identidad (fecha_programada original), nombre largo con acentos sin recorte, sin filas nuevas')

  // INCIERTO no vuelve a enviarse en ningún día de la ventana
  for (let d = 1; d <= 10; d++) { reloj('2026-11-' + String(d).padStart(2, '0')); await cron() } // un día a la vez, hasta el 10 inclusive
  assert.equal((await mensajes(E.email)).length, 1)
  assert.equal(envio(E.perfil, EVENTO).estado, 'INCIERTO')
  assert.equal(envio(E.perfil, EVENTO).intentos, 1)
  ok('INCIERTO queda marcado y consultable, sin reintento automático ni identidad nueva')

  // Padre con rechazo permanente: un intento por día hasta el 10 inclusive y ninguno después
  const intentosDia10 = envio(Pr.perfil, EVENTO).intentos
  assert.equal(intentosDia10, 12) // 30/10, 31/10, 01..10/11
  reloj('2026-11-11'); await cron(); await cron()
  assert.equal(envio(Pr.perfil, EVENTO).intentos, 12)
  assert.equal(envio(Pr.perfil, EVENTO).estado, 'FALLIDO')
  assert.equal(sql(`SELECT count(*) FROM public.envios_correo WHERE padre_id='${Pr.perfil}'`), '1')
  assert.equal((await mensajes(Pr.email)).length, 0)
  ok('reintento diario hasta el día 10 inclusive (12 intentos), ninguno el día 11, identidad única')

  // Pasada la ventana, una fila que nunca salió ni cruzó la frontera queda FALLIDO (no PENDIENTE para siempre)
  reloj(EVENTO)
  const V = await crearPadre('v', [hijo2])
  sql(`SELECT app_private.recordatorio_plan();`)
  assert.equal(envio(V.perfil, EVENTO).estado, 'PENDIENTE')
  reloj('2026-11-11'); sql(`SELECT app_private.recordatorio_plan();`)
  assert.equal(envio(V.perfil, EVENTO).estado, 'FALLIDO'); assert.match(envio(V.perfil, EVENTO).ultimo_error, /Venció el plazo/u)
  assert.equal((await mensajes(V.email)).length, 0)
  ok('vencida la ventana (día 11) una fila PENDIENTE sin frontera queda FALLIDO y sin mensaje')

  // ---------------------------------------------------------------- 9. Reservas: crash antes y después de la frontera
  reloj(EVENTO)
  const L = await crearPadre('l', [hijo2]); const M = await crearPadre('m', [hijo2])
  sql(`SELECT app_private.recordatorio_plan();`) // programa las filas sin despachar
  const rsv = async (p) => (await rpc(local, local.SERVICE_ROLE_KEY, 'recordatorio_reservar_job', { p_padre: p.perfil, p_fecha: EVENTO })).cuerpo
  const rL = await rsv(L)
  assert.equal(rL.reservado, true)
  assert.equal((await rsv(L)).reservado, false) // reserva vigente: otro worker no despacha
  // worker caído ANTES de SMTP: reserva vencida sin frontera → se retoma, el viejo no confirma
  sql(`UPDATE public.envios_correo SET reserva_hasta=clock_timestamp()-interval '1 second' WHERE padre_id='${L.perfil}'`)
  const rL2 = await rsv(L)
  assert.equal(rL2.reservado, true); assert.notEqual(rL2.token, rL.token)
  const viejo = await rpc(local, local.SERVICE_ROLE_KEY, 'recordatorio_resultado_job', { p_padre: L.perfil, p_fecha: EVENTO, p_token: rL.token, p_estado: 'ENVIADO', p_error: '' })
  assert.equal(viejo.cuerpo, false)
  assert.equal(envio(L.perfil, EVENTO).estado, 'PENDIENTE')
  ok('crash antes de SMTP: la reserva vencida sin frontera se retoma y un intento viejo no confirma')
  // worker caído DESPUÉS de cruzar la frontera: INCIERTO, nunca reenvío
  const rM = await rsv(M)
  const datosM = await rpc(local, local.SERVICE_ROLE_KEY, 'recordatorio_datos_job', { p_padre: M.perfil, p_fecha: EVENTO, p_token: rM.token })
  assert.equal(datosM.estado, 200)
  assert.equal((await rpc(local, local.SERVICE_ROLE_KEY, 'recordatorio_frontera_job', { p_padre: M.perfil, p_fecha: EVENTO, p_token: rM.token })).cuerpo, true)
  // Cruzada la frontera, la auditoría de adjuntos ya no se puede reescribir
  assert.notEqual((await rpc(local, local.SERVICE_ROLE_KEY, 'recordatorio_datos_job', { p_padre: M.perfil, p_fecha: EVENTO, p_token: rM.token })).estado, 200)
  sql(`UPDATE public.envios_correo SET reserva_hasta=clock_timestamp()-interval '1 second' WHERE padre_id IN ('${M.perfil}','${L.perfil}')`)
  const antes = await totalMensajes()
  const r4 = await cron()
  assert.equal(envio(M.perfil, EVENTO).estado, 'INCIERTO')
  assert.equal((await mensajes(M.email)).length, 0)
  assert.equal(envio(L.perfil, EVENTO).estado, 'ENVIADO') // L (sin frontera) se retoma y sale una sola vez
  assert.equal((await mensajes(L.email)).length, 1)
  assert.equal(r4.sin_confirmar, 0)
  reloj('2026-11-05'); await cron()
  assert.equal(envio(M.perfil, EVENTO).estado, 'INCIERTO'); assert.equal((await mensajes(M.email)).length, 0)
  assert.ok((await totalMensajes()) >= antes + 1)
  ok('crash después de la frontera: barrido a INCIERTO sin envío ni reintento posterior')

  // ---------------------------------------------------------------- 10. Revalidación: cuenta, rol y vínculo
  reloj(EVENTO)
  const G = await crearPadre('g', [hijo2]); const H = await crearPadre('h', [hijo2]); const I = await crearPadre('i', [hijo2])
  sql(`SELECT app_private.recordatorio_plan();`)
  // H pierde el vínculo y la cuenta de I queda bloqueada DESPUÉS de programar el evento
  desvincular(H.perfil, hijo2)
  const intento = (corto) => sql(`SELECT app_private.cambiar_acceso_perfil((SELECT id FROM public.perfiles WHERE dni='${corto}'),'BLOQUEADO','HABILITADO','prueba EPT-115 bloqueo')`)
  try { sql(`UPDATE public.perfiles SET estado_acceso='BLOQUEADO' WHERE id='${I.perfil}'`) } catch { void intento }
  const r5 = await cron()
  assert.equal(envio(H.perfil, EVENTO).estado, 'FALLIDO'); assert.match(envio(H.perfil, EVENTO).ultimo_error, /hijos vinculados/u)
  assert.equal(envio(I.perfil, EVENTO).estado, 'FALLIDO'); assert.match(envio(I.perfil, EVENTO).ultimo_error, /no está habilitada/u)
  assert.equal((await mensajes(H.email)).length, 0); assert.equal((await mensajes(I.email)).length, 0)
  assert.equal(envio(G.perfil, EVENTO).estado, 'ENVIADO')
  assert.ok(r5.fallidos >= 2)
  // Un padre bloqueado ANTES del evento ni siquiera se programa
  const Bq = await crearPadre('bq', [hijo2])
  sql(`UPDATE public.perfiles SET estado_acceso='BLOQUEADO' WHERE id='${Bq.perfil}'`)
  await cron()
  assert.equal(envio(Bq.perfil, EVENTO), null)
  ok('vínculo revocado y cuenta bloqueada se revalidan antes del despacho; cuenta bloqueada antes del evento no se programa')

  // ---------------------------------------------------------------- 11. Concurrencia entre workers
  const grupo = []
  for (let i = 0; i < 8; i++) grupo.push(await crearPadre(`w${i}`, [hijo2]))
  const rs = await Promise.all([cron(), cron(), cron(), cron()])
  assert.ok(rs.every((r) => r.sin_confirmar === 0))
  for (const p of grupo) {
    assert.equal((await mensajes(p.email)).length, 1, `un solo correo para ${p.email}`)
    assert.equal(envio(p.perfil, EVENTO).estado, 'ENVIADO')
    assert.equal(envio(p.perfil, EVENTO).intentos, 1)
  }
  ok('cuatro workers simultáneos sobre ocho padres: exactamente un correo e intento por padre')

  // ---------------------------------------------------------------- 12. Confirmación perdida tras aceptación SMTP
  reloj(EVENTO)
  const K = await crearPadre('k', [hijo2])
  sql(`SELECT app_private.recordatorio_plan();`)
  const inicioK = intermediario.registro.length
  intermediario.planear('perder-respuesta', (p) => p.ruta === '/rest/v1/rpc/recordatorio_resultado_job')
  const rk = await cron()
  assert.deepEqual([rk.enviados, rk.inciertos, rk.sin_confirmar], [1, 0, 0])
  assert.equal(envio(K.perfil, EVENTO).estado, 'ENVIADO')
  assert.equal((await mensajes(K.email)).length, 1)
  const traficoK = intermediario.registro.slice(inicioK)
  assert.ok(traficoK.findIndex((x) => x.endsWith('/recordatorio_estado_job')) > traficoK.findIndex((x) => x.endsWith('/recordatorio_resultado_job')))
  assert.equal(traficoK.filter((x) => x.endsWith('/recordatorio_resultado_job')).length, 1)
  ok('respuesta de confirmación perdida: se consulta el estado primero, queda ENVIADO (no INCIERTO) y no se repite el despacho')

  // ---------------------------------------------------------------- 12b. Clasificación SMTP durante DATA (EPT-118)
  // Rechazo explícito 4xx/5xx en DATA → fallo claro reintentable; corte tras cruzar la frontera → INCIERTO sin reenvío.
  // El intermediario registra lo que hizo y arriba (Mailpit) nunca recibe el mensaje: se contrasta con el estado durable.
  reloj(EVENTO)
  // `cp` es el caso simétrico de `cm`: otro corte sin respuesta, pero ANTES de DATA, que sí es un fallo claro.
  const datos = { rd: 'data-rechazo', r4: 'fin-4xx', r5: 'fin-5xx', cm: 'corte-medio', cp: 'corte-pre-data' }
  const X = {}
  for (const [corto, modo] of Object.entries(datos)) { X[corto] = await crearPadre(`x${corto}`, [hijo2]); modos.set(X[corto].email, modo) }
  sql(`SELECT app_private.recordatorio_plan();`)
  const inicioBit = bitacora.length
  const rx = await cron()
  assert.deepEqual([rx.enviados, rx.fallidos, rx.inciertos, rx.sin_confirmar], [0, 4, 1, 0])
  assert.deepEqual(bitacora.slice(inicioBit).map(([p, e]) => `${p}:${e}`).sort(), [
    [X.rd.email, 'DATA-rechazado'], [X.r4.email, 'fin-451'], [X.r5.email, 'fin-554'], [X.cm.email, 'corte-tras-354'],
    [X.cp.email, 'corte-en-RCPT'],
  ].map(([p, e]) => `${p}:${e}`).sort())
  for (const p of Object.values(X)) assert.equal((await mensajes(p.email)).length, 0, 'arriba nunca aceptó el mensaje')
  for (const [corto, codigo] of [['rd', '554'], ['r4', '451'], ['r5', '554']]) {
    const e = envio(X[corto].perfil, EVENTO)
    assert.equal(e.estado, 'FALLIDO'); assert.equal(e.intentos, 1); assert.equal(e.enviado, false)
    assert.match(e.ultimo_error, new RegExp(`^Fallo SMTP \\(.*\\b${codigo}\\)$`, 'u'))
    assert.ok(!e.ultimo_error.includes(X[corto].email))
  }
  assert.match(envio(X.rd.perfil, EVENTO).ultimo_error, /\bDATA\b/u)
  // Corte sin código de respuesta: la fase decide. Antes de DATA nada pudo aceptarse; tras el 354 sí pudo.
  const ep = envio(X.cp.perfil, EVENTO)
  assert.equal(ep.estado, 'FALLIDO'); assert.equal(ep.intentos, 1); assert.equal(ep.enviado, false)
  assert.doesNotMatch(ep.ultimo_error, /\b[45]\d\d\)$/u)
  const ec = envio(X.cm.perfil, EVENTO)
  assert.equal(ec.estado, 'INCIERTO'); assert.equal(ec.frontera, true); assert.equal(ec.enviado, false); assert.equal(ec.intentos, 1)
  ok('DATA: 554 al comando, 451 y 554 al terminar → FALLIDO con código saneado; corte antes de DATA → FALLIDO; corte tras el 354 → INCIERTO con frontera cruzada (la fase decide, no error.code)')
  // Siguiente día: los FALLIDO reintentan con la misma identidad y salen una vez; el INCIERTO no se reenvía aunque arriba nunca lo recibió
  reloj('2026-10-31')
  for (const corto of ['rd', 'r4', 'r5', 'cm', 'cp']) modos.delete(X[corto].email)
  const rx2 = await cron()
  assert.equal(rx2.enviados, 4)
  for (const corto of ['rd', 'r4', 'r5', 'cp']) {
    const e = envio(X[corto].perfil, EVENTO)
    assert.equal(e.estado, 'ENVIADO'); assert.equal(e.intentos, 2); assert.equal(e.enviado, true)
    assert.equal((await mensajes(X[corto].email)).length, 1)
    assert.equal(sql(`SELECT count(*) FROM public.envios_correo WHERE padre_id='${X[corto].perfil}'`), '1')
  }
  await cron(); await cron()
  assert.equal(envio(X.cm.perfil, EVENTO).estado, 'INCIERTO'); assert.equal(envio(X.cm.perfil, EVENTO).intentos, 1)
  assert.equal((await mensajes(X.cm.email)).length, 0, 'el INCIERTO no se reenvía automáticamente')
  ok('siguiente intento: FALLIDO de DATA → ENVIADO (intentos=2, una fila, un mensaje); INCIERTO sin reenvío ni intento nuevo')

  // ---------------------------------------------------------------- 13. Permisos y exposición
  reloj(EVENTO)
  for (const [nombre, args] of [['recordatorio_plan_job', {}], ['recordatorio_reservar_job', { p_padre: A.perfil, p_fecha: EVENTO }],
    ['recordatorio_datos_job', { p_padre: A.perfil, p_fecha: EVENTO, p_token: id(1) }],
    ['recordatorio_frontera_job', { p_padre: A.perfil, p_fecha: EVENTO, p_token: id(1) }],
    ['recordatorio_resultado_job', { p_padre: A.perfil, p_fecha: EVENTO, p_token: id(1), p_estado: 'ENVIADO', p_error: '' }],
    ['recordatorio_estado_job', { p_padre: A.perfil, p_fecha: EVENTO }]]) {
    for (const token of [null, sesionA.access_token, sesionDir.access_token]) {
      const r = await rpc(local, token, nombre, args)
      assert.ok([401, 403].includes(r.estado), `${nombre} cerrada a clientes (${r.estado})`)
    }
  }
  assert.deepEqual((await rest(local, sesionA.access_token, 'envios_correo?select=id')).cuerpo, [])
  assert.deepEqual((await rest(local, sesionA.access_token, 'envios_correo_facturas?select=envio_id')).cuerpo, [])
  const vista = await rest(local, sesionDir.access_token, `envios_correo?select=estado,ultimo_error,periodo,frontera_smtp_en&padre_id=eq.${E.perfil}`)
  assert.equal(vista.cuerpo[0].estado, 'INCIERTO'); assert.ok(vista.cuerpo[0].ultimo_error)
  assert.ok((await rest(local, sesionDir.access_token, 'envios_correo_facturas?select=envio_id')).cuerpo.length > 0)
  for (const tabla of ['recordatorio_config', 'recordatorio_reloj']) assert.equal((await rest(local, sesionDir.access_token, tabla)).estado, 404)
  const escribir = await rest(local, sesionDir.access_token, 'envios_correo', { method: 'POST', body: { padre_id: A.perfil, tipo: 'RECORDATORIO_MENSUAL', fecha_programada: '2030-01-01' } })
  assert.ok([401, 403].includes(escribir.estado))
  // La credencial de servidor tampoco escribe el registro por fuera de la máquina de estados
  for (const r of [await rest(local, local.SERVICE_ROLE_KEY, `envios_correo?padre_id=eq.${A.perfil}`, { method: 'PATCH', body: { estado: 'PENDIENTE' } }),
    await rest(local, local.SERVICE_ROLE_KEY, 'envios_correo', { method: 'POST', body: { padre_id: A.perfil, tipo: 'RECORDATORIO_MENSUAL', fecha_programada: '2030-01-01' } }),
    await rest(local, local.SERVICE_ROLE_KEY, `envios_correo?padre_id=eq.${A.perfil}`, { method: 'DELETE' })]) {
    assert.ok([401, 403].includes(r.estado), `service_role sin DML sobre envios_correo (${r.estado})`)
  }
  assert.equal(envio(A.perfil, EVENTO).estado, 'ENVIADO')
  ok('PostgREST: RPC solo de servidor; padre no ve auditoría; Dirección sí ve estado/error; config y reloj fuera de la API; sin DML de cliente')

  // Canal de Dirección (EPT-118): la misma lectura que usa la pantalla, con identidades reales de cada rol.
  // Las columnas se leen del servicio real: si alguien agrega una columna interna al select, esta suite lo detecta.
  const fuenteServicio = readFileSync(path.join(RAIZ, 'src/services/envios-correo-lectura.service.ts'), 'utf8')
  const columnasPantalla = /\.from\('envios_correo'\)\s*\.select\('([^']+)'\)/u.exec(fuenteServicio)?.[1].replace(/\s+/gu, '')
  assert.ok(columnasPantalla, 'no se encontró el select del servicio de lectura')
  assert.doesNotMatch(columnasPantalla, /reserva|frontera|token|total_adeudado|omitido|\*/u)
  const lecturaDir = await rest(local, sesionDir.access_token, `envios_correo?select=${columnasPantalla}&order=fecha_programada.desc,id.desc&limit=51`)
  assert.equal(lecturaDir.estado, 200); assert.ok(lecturaDir.cuerpo.length > 5)
  assert.ok(lecturaDir.cuerpo.some((f) => f.estado === 'INCIERTO') && lecturaDir.cuerpo.some((f) => f.estado === 'ENVIADO'))
  assert.ok(!JSON.stringify(lecturaDir.cuerpo).includes('reserva_token'))
  for (const [i, rol] of ['ESTUDIANTE', 'DOCENTE', 'PERSONAL'].entries()) {
    const email = correo(`rol-${rol.toLowerCase()}`)
    await crearCuentaConPerfil(local, { email, password, perfil: { nombre: `Rol ${rol}`, apellido: 'EPT118', dni: `9411581${i + 1}`,
      rol_id: Number(sql(`SELECT id FROM public.roles WHERE nombre='${rol}'`)) } })
    const sesion = await exigirSesion(local, email, password)
    assert.deepEqual((await rest(local, sesion.access_token, `envios_correo?select=${columnasPantalla}`)).cuerpo, [], `${rol} sin filas`)
    assert.deepEqual((await rest(local, sesion.access_token, 'envios_correo_intentos?select=envio_id')).cuerpo, [], `${rol} sin intentos`)
  }
  assert.deepEqual((await rest(local, undefined, `envios_correo?select=${columnasPantalla}`)).cuerpo?.length ?? 0, 0)
  // Cuenta de Dirección bloqueada con un JWT todavía vigente: la base no entrega ninguna fila.
  const emailDirB = correo('dir-bloq')
  await crearCuentaConPerfil(local, { email: emailDirB, password, perfil: { nombre: 'Dir', apellido: 'Bloq EPT118', dni: '94115815',
    rol_id: Number(sql(`SELECT id FROM public.roles WHERE nombre='DIRECTOR'`)) } })
  const sesionDirB = await exigirSesion(local, emailDirB, password)
  assert.ok((await rest(local, sesionDirB.access_token, `envios_correo?select=${columnasPantalla}&limit=5`)).cuerpo.length > 0)
  sql(`UPDATE public.perfiles SET estado_acceso='BLOQUEADO' WHERE dni='94115815'`)
  assert.deepEqual((await rest(local, sesionDirB.access_token, `envios_correo?select=${columnasPantalla}`)).cuerpo, [])
  assert.deepEqual((await rest(local, sesionDirB.access_token, 'envios_correo_facturas?select=envio_id')).cuerpo, [])
  ok('lectura de la pantalla de Dirección: DIRECTOR ve INCIERTO/ENVIADO sin reserva_token; estudiante, docente, personal, anónimo y Dirección bloqueada con JWT vigente no reciben filas')

  // ---------------------------------------------------------------- 14. Compuerta de entorno prevalece
  await servidor.detener()
  const antesGate = await totalMensajes()
  await servidor.iniciar({ ...variables, EPT_RECORDATORIO_HABILITADO: 'deshabilitado' })
  const apagadoEnv = await cron()
  assert.equal(apagadoEnv.habilitada, false)
  assert.equal(await totalMensajes(), antesGate)
  ok('con la compuerta de entorno apagada aunque la base esté activa: sin consulta ni SMTP')

  assert.ok(!servidor.registro.includes(secreto) && !servidor.registro.includes(local.SERVICE_ROLE_KEY))
  assert.ok(![A, B, C, D, E].some((p) => servidor.registro.includes(p.email)))
  ok('secreto, service_role y destinatarios ausentes de los logs de la aplicación')
  console.log(`PASS ${n} escenarios Next/PostgREST/SMTP/Mailpit en ${Math.round((Date.now() - inicioSuite) / 1000)} s.`)
} finally {
  if (existsSync(fuenteOculta)) renameSync(fuenteOculta, fuente)
  await servidor.detener()
  await intermediario.cerrar()
  await smtp.cerrar()
  // Cada paso es independiente: que uno falle no deja huérfanos los siguientes.
  const paso = async (nombre, accion) => { try { await accion() } catch (e) { console.error(`limpieza ${nombre}`, e.message) } }
  await paso('SQL', () => sql(limpieza))
  await paso('fixture', () => limpiarFixture({ prefijoDni: '941151', prefijoCorreo: 'ept115-', dominio: DOMINIO }))
  await paso('perfiles', () => sql(`DELETE FROM public.alumnos WHERE perfil_id IN (SELECT id FROM public.perfiles WHERE dni IN ('94115811','94115812','94115813'));
       DELETE FROM public.profesores WHERE perfil_id IN (SELECT id FROM public.perfiles WHERE dni IN ('94115811','94115812','94115813'));
       DELETE FROM public.perfiles WHERE dni IN ('94115990','94115811','94115812','94115813','94115815')`))
  await paso('cuentas', () => sql(`DELETE FROM auth.users WHERE email LIKE 'ept115-%@${DOMINIO}' OR email='sin-arroba-ept115'`))
  await paso('buzón', limpiarBuzon)
}
