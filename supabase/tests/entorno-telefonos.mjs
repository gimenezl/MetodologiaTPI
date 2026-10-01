#!/usr/bin/env node
/**
 * Entorno LOCAL para probar EPT-65 (registro de accesos con QR) con teléfonos
 * REALES: Android Chrome e iPhone Safari.
 *
 * Qué hace:
 *   1. Lee el stack local de Supabase y se niega si no es de bucle local.
 *   2. Siembra las identidades sintéticas de `tests/auth.setup.ts` y deja a la
 *      alumna de prueba con credencial vigente e inscripción a comedor y al
 *      recorrido NORTE.
 *   3. Compila y sirve la aplicación (`next build` + `next start`) con la API de
 *      Supabase y la app bajo UN solo origen HTTPS, de modo que el navegador del
 *      teléfono no sufra contenido mixto ni CORS y acepte un único certificado.
 *   4. Firma los QR con una clave EFÍMERA que nace en este proceso, no se imprime
 *      ni se guarda y deja de valer al cortar el script.
 *
 * Qué NO hace: no abre ningún túnel público, no toca producción, no imprime
 * claves. Escucha SOLO en la dirección de red local indicada.
 *
 * Uso (certificado propio; ver docs/evidence/EPT-65.md, sección 11):
 *   EPT_SUPABASE_WORKDIR=<stack aislado> node supabase/tests/entorno-telefonos.mjs \
 *     --ip 192.168.0.31 --cert <cert.pem> --key <key.pem> [--puerto-https 8443] [--omitir-build]
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'

const ANFITRIONES_LOCALES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
const PUERTO_APP = 3101
const RUTAS_DE_SUPABASE = ['/auth/v1', '/rest/v1', '/storage/v1', '/realtime/v1']

function argumento(nombre, porDefecto) {
  const indice = process.argv.indexOf(`--${nombre}`)
  return indice >= 0 ? process.argv[indice + 1] : porDefecto
}
const marcado = (nombre) => process.argv.includes(`--${nombre}`)

function fallar(mensaje) {
  console.error(`FALLO  ${mensaje}`)
  process.exit(1)
}

const ip = argumento('ip')
const rutaCert = argumento('cert')
const rutaClave = argumento('key')
const puertoHttps = Number(argumento('puerto-https', '8443'))
if (!ip || !net.isIPv4(ip)) fallar('indicá la IP de red local del equipo con --ip (por ejemplo 192.168.0.31).')
if (ip === '0.0.0.0') fallar('no se escucha en todas las interfaces: usá la IP de la red local.')
if (!rutaCert || !rutaClave || !fs.existsSync(rutaCert) || !fs.existsSync(rutaClave)) {
  fallar('faltan --cert y --key (certificado y clave PEM con la IP en subjectAltName).')
}

// --- 1. Stack local ----------------------------------------------------------
const directorioSupabase = process.env.EPT_SUPABASE_WORKDIR
const argumentosStatus = ['supabase', 'status', '-o', 'env', ...(directorioSupabase ? ['--workdir', directorioSupabase] : [])]
let salidaStatus
try {
  salidaStatus = execFileSync('npx', argumentosStatus, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
} catch {
  fallar('no se pudo leer la instancia local de Supabase. ¿Está levantada y EPT_SUPABASE_WORKDIR es correcto?')
}
const local = {}
for (const linea of salidaStatus.split(/\r?\n/u)) {
  const coincidencia = /^([A-Z0-9_]+)="?(.*?)"?$/u.exec(linea.trim())
  if (coincidencia) local[coincidencia[1]] = coincidencia[2]
}
if (!local.API_URL || !local.ANON_KEY || !local.SERVICE_ROLE_KEY) fallar('Supabase local no informó la API o las claves.')
const apiLocal = new URL(local.API_URL)
if (!ANFITRIONES_LOCALES.has(apiLocal.hostname)) fallar(`la API apunta a «${apiLocal.hostname}», que no es de bucle local.`)

const contenedor = `supabase_db_${/^project_id\s*=\s*"([^"]+)"/mu.exec(
  fs.readFileSync(`${directorioSupabase ?? '.'}/supabase/config.toml`, 'utf8')
)?.[1]}`

function sql(consulta) {
  return execFileSync(
    'docker',
    ['exec', '-i', contenedor, 'psql', '-X', '-q', '-t', '-A', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    { input: consulta, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim()
}

// --- 3. Siembra ----------------------------------------------------------------
console.log('Sembrando las identidades sintéticas…')
const siembra = spawnSync('node', ['supabase/tests/correr-autenticadas.mjs', '--project=setup', '--reporter=dot'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, EPT_PUERTO_APP: process.env.EPT_PUERTO_APP ?? '3100' },
})
if (siembra.status !== 0) fallar('no se pudieron sembrar las identidades de prueba.')

const alumna = sql(
  "SELECT a.perfil_id FROM public.alumnos a JOIN public.perfiles p ON p.id = a.perfil_id WHERE p.dni = '99900002';"
)
if (!/^[0-9a-f-]{36}$/iu.test(alumna)) fallar('no se encontró a la alumna sintética (DNI 99900002).')
if (!sql(`SELECT 1 FROM public.credenciales_qr WHERE alumno_id = '${alumna}' AND estado = 'ACTIVA';`)) {
  sql(`
    INSERT INTO public.credenciales_qr (alumno_id, clave_kid, emitida_por)
    VALUES ('${alumna}', 'tel1', (SELECT id FROM public.perfiles WHERE dni = '99900001'));
  `)
}
for (const servicio of ['e0000000-0000-4000-8000-000000000010', 'e0000000-0000-4000-8000-000000000020']) {
  sql(`
    INSERT INTO public.inscripciones_servicios (alumno_id, servicio_id)
    SELECT '${alumna}', '${servicio}'
    WHERE NOT EXISTS (SELECT 1 FROM public.inscripciones_servicios
      WHERE alumno_id = '${alumna}' AND servicio_id = '${servicio}' AND estado = 'ACTIVA');
  `)
}

// --- Clave efímera y entorno de la aplicación ----------------------------------
// La tarjeta firma con el `clave_kid` GUARDADO en la credencial, no con el activo:
// el servidor tiene que conocer exactamente ese identificador.
const kid = sql(`SELECT clave_kid FROM public.credenciales_qr WHERE alumno_id = '${alumna}' AND estado = 'ACTIVA';`)
const origen = `https://${ip}:${puertoHttps}`
const entorno = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: origen,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: local.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY,
  QR_CREDENCIAL_KID_ACTIVA: kid,
  QR_CREDENCIAL_CLAVES: `${kid}:${randomBytes(32).toString('base64url')}`,
  // El servidor de Next también habla con la API por el origen HTTPS: se confía
  // en el certificado propio en vez de desactivar la verificación.
  NODE_EXTRA_CA_CERTS: rutaCert,
}

// --- 4. Compilación y servidor -------------------------------------------------
if (!marcado('omitir-build')) {
  console.log('Compilando la aplicación con el origen HTTPS local (unos minutos)…')
  const build = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', shell: process.platform === 'win32', env: entorno })
  if (build.status !== 0) fallar('la compilación falló.')
}
const app = spawn('npx', ['next', 'start', '-p', String(PUERTO_APP), '-H', '127.0.0.1'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: entorno,
})

// --- 5. Proxy HTTPS de un solo origen ---------------------------------------------
const servidor = https.createServer({ cert: fs.readFileSync(rutaCert), key: fs.readFileSync(rutaClave) }, (peticion, respuesta) => {
  const haciaSupabase = RUTAS_DE_SUPABASE.some((prefijo) => peticion.url.startsWith(prefijo))
  const destino = haciaSupabase ? { host: apiLocal.hostname, port: Number(apiLocal.port) } : { host: '127.0.0.1', port: PUERTO_APP }
  const saliente = http.request(
    { ...destino, method: peticion.method, path: peticion.url, headers: { ...peticion.headers, 'x-forwarded-proto': 'https' } },
    (recibida) => {
      respuesta.writeHead(recibida.statusCode ?? 502, recibida.headers)
      recibida.pipe(respuesta)
    }
  )
  saliente.on('error', () => {
    respuesta.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
    respuesta.end('El servidor local todavía no responde.')
  })
  peticion.pipe(saliente)
})
servidor.listen(puertoHttps, ip, () => {
  console.log(`
==============================================================
 EPT-65 · entorno de teléfonos listo (solo red local)
==============================================================
 Dirección para el teléfono y para esta PC:  ${origen}
 Operador (Personal):   personal.prueba@ept.local
 Alumna (muestra el QR): estudiante.prueba@ept.local
 Dirección (auditoría):  directora.prueba@ept.local
 Las contraseñas están en tests/auth.setup.ts (identidades sintéticas).
 Cortá con Ctrl+C: la clave de firma deja de existir y los QR dejan de valer.
==============================================================
`)
})

function cerrar() {
  servidor.close()
  app.kill()
  process.exit(0)
}
process.on('SIGINT', cerrar)
process.on('SIGTERM', cerrar)
