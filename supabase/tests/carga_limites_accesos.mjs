#!/usr/bin/env node
/**
 * Medición de los límites del registro de accesos con QR (EPT-65) contra el
 * endpoint REAL y un stack local descartable.
 *
 * Mide, con una sesión real de PERSONAL y QR firmados con una clave efímera:
 *   1. latencia de una solicitud válida (p50 / p95) y el techo teórico de una
 *      sola cuenta;
 *   2. en qué solicitud aparece el primer 429 por volumen y su Retry-After;
 *   3. cuánto dura el bloqueo (sin esperar: se corre el reloj de los contadores);
 *   4. el umbral de intentos con firma inválida;
 *   5. un modelo de cola: a qué cadencia de escaneo una sola cuenta alcanza el tope.
 *
 * NO mide producción ni una persona real: mide la aplicación sobre datos
 * sintéticos. La cadencia humana de un comedor es una hipótesis, no un dato.
 *
 * Requiere la aplicación compilada (`npm run build`) y las variables de
 * `correr-autenticadas.mjs`:
 *   EPT_SUPABASE_WORKDIR=<stack aislado> node supabase/tests/carga_limites_accesos.mjs
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import fs from 'node:fs'

const PUERTO = Number(process.env.EPT_PUERTO_CARGA ?? '3102')
const BASE = `http://127.0.0.1:${PUERTO}`
const COMEDOR = 'e0000000-0000-4000-8000-000000000010'
const directorioSupabase = process.env.EPT_SUPABASE_WORKDIR
const ANFITRIONES_LOCALES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

function fallar(mensaje) {
  console.error(`FALLO  ${mensaje}`)
  if (globalThis.cerrarServidor) globalThis.cerrarServidor(1)
  process.exit(1)
}

// --- Stack local ---------------------------------------------------------------
const salida = execFileSync(
  'npx',
  ['supabase', 'status', '-o', 'env', ...(directorioSupabase ? ['--workdir', directorioSupabase] : [])],
  { encoding: 'utf8', shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] }
)
const local = {}
for (const linea of salida.split(/\r?\n/u)) {
  const m = /^([A-Z0-9_]+)="?(.*?)"?$/u.exec(linea.trim())
  if (m) local[m[1]] = m[2]
}
if (!local.API_URL || !ANFITRIONES_LOCALES.has(new URL(local.API_URL).hostname)) fallar('la API no es de bucle local.')
const proyecto = /^project_id\s*=\s*"([^"]+)"/mu.exec(fs.readFileSync(`${directorioSupabase ?? '.'}/supabase/config.toml`, 'utf8'))?.[1]
const contenedor = `supabase_db_${proyecto}`

function sql(consulta) {
  return execFileSync(
    'docker',
    ['exec', '-i', contenedor, 'psql', '-X', '-q', '-t', '-A', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    { input: consulta, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim()
}

// --- Siembra de las identidades sintéticas -----------------------------------
console.log('Sembrando identidades sintéticas…')
const siembra = spawnSync('node', ['supabase/tests/correr-autenticadas.mjs', '--project=setup', '--reporter=dot'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, EPT_PUERTO_APP: process.env.EPT_PUERTO_APP ?? '3100' },
})
if (siembra.status !== 0) fallar('no se pudo sembrar.')

const alumna = sql("SELECT a.perfil_id FROM public.alumnos a JOIN public.perfiles p ON p.id = a.perfil_id WHERE p.dni = '99900002';")
if (!/^[0-9a-f-]{36}$/iu.test(alumna)) fallar('no se encontró a la alumna sintética.')
if (!sql(`SELECT 1 FROM public.credenciales_qr WHERE alumno_id = '${alumna}' AND estado = 'ACTIVA';`)) {
  sql(`INSERT INTO public.credenciales_qr (alumno_id, clave_kid, emitida_por)
       VALUES ('${alumna}', 'carga', (SELECT id FROM public.perfiles WHERE dni = '99900001'));`)
}
sql(`INSERT INTO public.inscripciones_servicios (alumno_id, servicio_id)
     SELECT '${alumna}', '${COMEDOR}'
     WHERE NOT EXISTS (SELECT 1 FROM public.inscripciones_servicios WHERE alumno_id = '${alumna}' AND servicio_id = '${COMEDOR}' AND estado = 'ACTIVA');`)
const credencial = sql(`SELECT id FROM public.credenciales_qr WHERE alumno_id = '${alumna}' AND estado = 'ACTIVA';`)
const kid = sql(`SELECT clave_kid FROM public.credenciales_qr WHERE id = '${credencial}';`)
const operador = sql("SELECT id FROM public.perfiles WHERE dni = '99900006';")

// --- Clave efímera, firma y servidor -------------------------------------------
const clave = randomBytes(32)
function payloadFirmado(id) {
  const idBytes = Buffer.from(id.replaceAll('-', ''), 'hex')
  const mensaje = Buffer.concat([Buffer.from('EPT-QR-V1'), Buffer.from([0]), Buffer.from(kid), Buffer.from([0]), idBytes])
  const firma = createHmac('sha256', clave).update(mensaje).digest()
  return ['EPT1', kid, idBytes.toString('base64url'), firma.toString('base64url')].join('.')
}
const payloadValido = payloadFirmado(credencial)
const payloadInvalido = () => {
  const p = payloadFirmado(credencial).split('.')
  p[3] = randomBytes(32).toString('base64url')
  return p.join('.')
}

const servidor = spawn('npx', ['next', 'start', '-p', String(PUERTO), '-H', '127.0.0.1'], {
  shell: process.platform === 'win32',
  stdio: 'ignore',
  env: {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: local.API_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: local.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY,
    QR_CREDENCIAL_KID_ACTIVA: kid,
    QR_CREDENCIAL_CLAVES: `${kid}:${clave.toString('base64url')}`,
  },
})
function cerrar(codigo) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(servidor.pid), '/T', '/F'], { stdio: 'ignore' })
  else servidor.kill()
  process.exit(codigo)
}
globalThis.cerrarServidor = cerrar
process.on('SIGINT', () => cerrar(130))

async function esperarServidor() {
  for (let i = 0; i < 120; i += 1) {
    try {
      if ((await fetch(`${BASE}/login`)).status === 200) return
    } catch {
      /* todavía no */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  fallar('el servidor no respondió.')
}

const sesion = JSON.parse(fs.readFileSync('tests/.auth/personal.json', 'utf8'))
const cookie = sesion.cookies.map((c) => `${c.name}=${c.value}`).join('; ')

async function escanear(payload) {
  const t0 = performance.now()
  const r = await fetch(`${BASE}/api/accesos-servicios/registro`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, origin: BASE },
    body: JSON.stringify({ payload, intento_id: randomUUID(), servicio_id: COMEDOR }),
  })
  const ms = performance.now() - t0
  let codigo = null
  try {
    const cuerpo = await r.json()
    codigo = cuerpo.codigo ?? cuerpo.error ?? null
  } catch {
    /* sin cuerpo */
  }
  return { estado: r.status, codigo, reintentarEn: r.headers.get('retry-after'), ms }
}

const percentil = (v, p) => [...v].sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor((p / 100) * v.length))]
const limpiarContadores = () => sql('DELETE FROM app_private.contadores_escaneo;')
const contar = (tipo) => Number(sql(`SELECT count(*) FROM app_private.contadores_escaneo WHERE operador_perfil_id = '${operador}' AND tipo = '${tipo}';`))
const resultado = {}

try {
  await esperarServidor()
  limpiarContadores()

  // 1. Latencia de solicitudes válidas (por debajo del tope).
  const tiempos = []
  for (let i = 0; i < 30; i += 1) {
    const r = await escanear(payloadValido)
    if (r.estado !== 200) fallar(`una solicitud válida respondió ${r.estado} (${r.codigo}); ¿la sesión de PERSONAL es válida?`)
    tiempos.push(r.ms)
  }
  resultado.latencia = { muestras: tiempos.length, p50_ms: Math.round(percentil(tiempos, 50)), p95_ms: Math.round(percentil(tiempos, 95)) }
  resultado.techoTeoricoPorCuenta_porMinuto = Math.floor(60000 / percentil(tiempos, 50))

  // 2. Tope por volumen: se sigue hasta el primer 429.
  let permitidas = tiempos.length
  let primer429 = null
  for (let i = 0; i < 100 && !primer429; i += 1) {
    const r = await escanear(payloadValido)
    if (r.estado === 429) primer429 = r
    else permitidas += 1
  }
  if (!primer429) fallar('no apareció ningún 429 en 130 solicitudes.')
  const siguientes = []
  for (let i = 0; i < 3; i += 1) siguientes.push((await escanear(payloadValido)).estado)
  resultado.tope = {
    solicitudesPermitidas: permitidas,
    codigo: primer429.codigo,
    retryAfter_s: primer429.reintentarEn,
    siguientes,
    filasSolicitud: contar('SOLICITUD'),
    filasBloqueo: contar('BLOQUEO'),
    bloqueoDura_min: Number(sql(`SELECT round(extract(epoch FROM (bloqueado_hasta - ocurrido_en)) / 60) FROM app_private.contadores_escaneo WHERE operador_perfil_id = '${operador}' AND tipo = 'BLOQUEO' ORDER BY id DESC LIMIT 1;`)),
  }

  // 3. Duración del bloqueo: se corre el reloj de los contadores (no se espera).
  sql(`UPDATE app_private.contadores_escaneo SET ocurrido_en = ocurrido_en - INTERVAL '14 minutes', bloqueado_hasta = bloqueado_hasta - INTERVAL '14 minutes';`)
  const aLos14 = (await escanear(payloadValido)).estado
  sql(`UPDATE app_private.contadores_escaneo SET ocurrido_en = ocurrido_en - INTERVAL '2 minutes', bloqueado_hasta = bloqueado_hasta - INTERVAL '2 minutes';`)
  const aLos16 = (await escanear(payloadValido)).estado
  resultado.bloqueo = { estadoA_los14min: aLos14, estadoA_los16min: aLos16 }

  // 4. Intentos con firma inválida.
  limpiarContadores()
  const invalidos = []
  for (let i = 0; i < 12; i += 1) invalidos.push((await escanear(payloadInvalido())).estado)
  const trasInvalidos = (await escanear(payloadValido)).estado
  resultado.invalidos = {
    estadosPorIntento: invalidos,
    primer429EnIntento: invalidos.findIndex((e) => e === 429) + 1 || null,
    unaSolicitudValidaDespues: trasInvalidos,
    filasInvalido: contar('INVALIDO'),
  }

  // 5. Modelo de cola de una sola cuenta.
  resultado.modeloDeCola = [2, 3, 4, 5, 6, 8, 10].map((s) => ({
    segundosPorAlumno: s,
    alumnosPorMinuto: +(60 / s).toFixed(1),
    solicitudesEn5min: Math.floor(300 / s),
    alcanzaElTope60: Math.floor(300 / s) >= 60,
    minutosHastaElPrimer429: Math.floor(300 / s) >= 60 ? +((61 * s) / 60).toFixed(1) : null,
  }))
  console.log(JSON.stringify(resultado, null, 2))
} finally {
  limpiarContadores()
  cerrar(0)
}
