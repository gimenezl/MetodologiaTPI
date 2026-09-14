/**
 * Alta de cuentas ante resultados ambiguos (EPT-9, cuarta revisión).
 *
 * El alta toca Auth y PostgreSQL. La migración 010 hace que la cuenta y el
 * perfil se confirmen en una sola transacción, pero la respuesta HTTP igual
 * puede perderse, llegar tarde o no llegar. Estas son las situaciones que una
 * lectura desde fuera no distingue, y que ninguna prueba sobre SQL puede
 * producir. Por eso el arnés levanta un intermediario delante de Auth y de
 * PostgREST que decide, petición por petición, qué hacer con cada escritura:
 *
 * - `perder-respuesta`: reenvía, espera la confirmación y devuelve 502.
 * - `en-vuelo`: devuelve 502 al instante y reenvía la escritura más tarde, de
 *   modo que el error llega ANTES de que la escritura exista.
 * - `retener`: reenvía, espera la confirmación y no responde nunca.
 * - `retener-sin-reenviar`: guarda la escritura sin reenviarla hasta que la
 *   prueba la libera.
 * - `cortar`: cierra la conexión sin reenviar nada.
 *
 * Además ejecuta, fuera de Next, el código REAL de la ruta anterior (commit
 * 4b593a70, extraído de Git y transpilado) frente a la misma carrera: es la
 * prueba inversa de que ese código borraba cuentas que no debía.
 *
 *     node supabase/tests/usuarios_reconciliacion.mjs
 *
 * Es autosuficiente: siembra su propia directora, levanta su propio servidor
 * de Next en el puerto 3210 y limpia todo al terminar, falle lo que falle.
 * Solo acepta una instancia de Supabase de bucle local.
 */

import { execFileSync, execSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as esperar } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { CLI_NEXT, RAIZ, carreraConPlazo, detener as detenerArbol } from './_arnes-produccion.mjs'

const requerir = createRequire(path.join(RAIZ, 'package.json'))

const CONTENEDOR =
  process.env.EPT_SUPABASE_DB_CONTAINER ?? 'supabase_db_educar-para-transformar'

const PUERTO_PROXY = 54399
const PUERTO_APP = 3210
const APP = `http://127.0.0.1:${PUERTO_APP}`
const PROXY = `http://127.0.0.1:${PUERTO_PROXY}`

/** Commit cuya ruta de alta se ejecuta en la prueba inversa. */
const SHA_RUTA_ANTERIOR = '4b593a70aa2030c6d1f3051f47d5131b6d41292c'

const PREFIJO_DNI = '96'
const DOMINIO = 'ept.local'
const PREFIJO_EMAIL = 'reconciliacion.'
const DIRECTORA = {
  email: `${PREFIJO_EMAIL}directora@${DOMINIO}`,
  password: 'prueba-ept-9-reconciliacion-directora',
  dni: `${PREFIJO_DNI}999999`,
}
const CONTRASENA = 'prueba-ept-9-reconciliacion'

let fallos = 0
let afirmaciones = 0

function afirmar(condicion, descripcion) {
  afirmaciones += 1
  if (condicion) {
    console.log(`OK  ${descripcion}`)
    return
  }
  fallos += 1
  console.error(`FALLO  ${descripcion}`)
}

// ================================================================
// Base de datos
// ================================================================
function sql(sentencia) {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTENEDOR, 'psql', '-X', '-q', '-A', '-t', '-U', 'postgres',
     '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    { input: sentencia, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim()
}

/**
 * SQL como `supabase_admin`. Solo para deshabilitar y volver a habilitar el
 * trigger de la migración 010: `auth.users` pertenece a `supabase_auth_admin`,
 * y `postgres` no puede alterarla.
 */
function sqlComoAdministrador(sentencia) {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTENEDOR, 'psql', '-X', '-q', '-A', '-t', '-U', 'supabase_admin',
     '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    { input: sentencia, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim()
}

const estadoDelTriggerDeAlta = () =>
  sqlComoAdministrador(`SELECT tgenabled FROM pg_catalog.pg_trigger
                        WHERE tgname = 'registrar_perfil_al_crear_cuenta'
                          AND tgrelid = 'auth.users'::regclass;`)

const contar = (consulta) => Number(sql(`SELECT pg_catalog.count(*) ${consulta};`))
const rolId = (nombre) => Number(sql(`SELECT id FROM public.roles WHERE nombre = '${nombre}';`))

const cuentas = (email) => contar(`FROM auth.users WHERE email = '${email}'`)
const perfilesConDni = (dni) => contar(`FROM public.perfiles WHERE dni = '${dni}'`)
const alumnosConDni = (dni) =>
  contar(`FROM public.alumnos a JOIN public.perfiles p ON p.id = a.perfil_id WHERE p.dni = '${dni}'`)

function inyectarRechazoDePerfil() {
  sql(`
    CREATE OR REPLACE FUNCTION public.rechazar_perfil_de_prueba()
    RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
    BEGIN
        IF NEW.apellido = 'RechazoConfirmado' THEN
            RAISE EXCEPTION 'Rechazo inyectado por la suite de reconciliacion.';
        END IF;
        RETURN NEW;
    END; $fn$;
    DROP TRIGGER IF EXISTS trg_rechazar_perfil_de_prueba ON public.perfiles;
    CREATE TRIGGER trg_rechazar_perfil_de_prueba BEFORE INSERT ON public.perfiles
        FOR EACH ROW EXECUTE FUNCTION public.rechazar_perfil_de_prueba();
  `)
}

function retirarInyecciones() {
  sql(`
    DROP TRIGGER IF EXISTS trg_rechazar_perfil_de_prueba ON public.perfiles;
    DROP FUNCTION IF EXISTS public.rechazar_perfil_de_prueba();
  `)
}

/** Borra todo lo que esta suite pudo haber creado, incluidos los huérfanos. */
function limpiar() {
  retirarInyecciones()
  sql(`
    BEGIN;
    DELETE FROM public.matriculas WHERE alumno_id IN
      (SELECT id FROM public.perfiles WHERE dni LIKE '${PREFIJO_DNI}%');
    DELETE FROM public.alumnos WHERE perfil_id IN
      (SELECT id FROM public.perfiles WHERE dni LIKE '${PREFIJO_DNI}%');
    DELETE FROM public.perfiles WHERE dni LIKE '${PREFIJO_DNI}%';
    COMMIT;
    DELETE FROM auth.users WHERE email LIKE '${PREFIJO_EMAIL}%@${DOMINIO}';
  `)
}

/**
 * Invariantes globales: se comprueban después de cada escenario.
 *
 * Una cuenta sin perfil es exactamente lo que dejaba la compensación mal
 * disparada; un perfil sin cuenta, lo que dejaba borrar Auth con la escritura en
 * vuelo. Ninguno de los dos puede existir.
 */
function exigirInvariantes(escenario) {
  afirmar(
    contar(`FROM auth.users u LEFT JOIN public.perfiles p ON p.user_id = u.id
            WHERE u.email LIKE '${PREFIJO_EMAIL}%@${DOMINIO}' AND p.id IS NULL`) === 0,
    `${escenario}: ninguna cuenta quedó sin perfil`
  )
  afirmar(
    contar(`FROM public.perfiles p LEFT JOIN auth.users u ON u.id = p.user_id
            WHERE p.dni LIKE '${PREFIJO_DNI}%' AND p.user_id IS NOT NULL AND u.id IS NULL`) === 0,
    `${escenario}: ningún perfil quedó apuntando a una cuenta borrada`
  )
  afirmar(
    contar(`FROM public.perfiles p JOIN public.roles r ON r.id = p.rol_id
            LEFT JOIN public.alumnos a ON a.perfil_id = p.id
            WHERE p.dni LIKE '${PREFIJO_DNI}%' AND r.nombre = 'ESTUDIANTE' AND a.perfil_id IS NULL`) === 0,
    `${escenario}: ningún ESTUDIANTE quedó sin legajo académico`
  )
  afirmar(
    contar(`FROM public.matriculas m JOIN public.perfiles p ON p.id = m.alumno_id
            WHERE p.dni LIKE '${PREFIJO_DNI}%'`) === 0,
    `${escenario}: el alta no dejó matrículas parciales`
  )
  afirmar(
    contar(`FROM auth.users WHERE raw_app_meta_data ? 'ept_alta'`) === 0,
    `${escenario}: ninguna cuenta conserva los datos del alta en app_metadata`
  )
}

// ================================================================
// Entorno local
// ================================================================
function entornoLocal() {
  // Una sola cadena de comando: no hay argumentos que el intérprete concatene.
  const salida = execSync('npx supabase status -o env', {
    cwd: RAIZ,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
  })
  const valores = {}
  for (const linea of salida.split(/\r?\n/u)) {
    const m = /^([A-Z0-9_]+)="?(.*?)"?$/u.exec(linea.trim())
    if (m) valores[m[1]] = m[2]
  }
  return valores
}

const local = entornoLocal()
if (!local.API_URL || !local.SERVICE_ROLE_KEY || !local.ANON_KEY) {
  console.error('FALLO  no se pudo leer la instancia local de Supabase.')
  process.exitCode = 1
} else if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(local.API_URL).hostname)) {
  console.error('FALLO  la instancia de Supabase no es de bucle local.')
  process.exitCode = 1
}
const entornoValido = process.exitCode !== 1
const arriba = entornoValido ? new URL(local.API_URL) : null

// ================================================================
// Intermediario con planes por petición
// ================================================================
/**
 * Crea un plan para la próxima escritura de un tipo.
 *
 * Expone promesas para que la prueba sepa exactamente cuándo la escritura quedó
 * retenida, cuándo terminó arriba y cuándo aterrizó una escritura retrasada.
 */
function plan(tipo, { retrasoMs = 0 } = {}) {
  const avisos = {}
  const promesa = (nombre) => new Promise((resolver) => { avisos[nombre] = resolver })
  return {
    tipo,
    retrasoMs,
    retenido: promesa('retenido'),
    escrito: promesa('escrito'),
    aterrizaje: promesa('aterrizaje'),
    liberado: promesa('liberado'),
    avisar: (nombre, valor) => avisos[nombre]?.(valor),
    liberar: () => avisos.liberado(),
  }
}

const planes = { alta: [], perfil: [] }
const tareasEnCurso = new Set()

function seguir(tarea) {
  tareasEnCurso.add(tarea)
  tarea.finally(() => tareasEnCurso.delete(tarea))
  return tarea
}

async function reenviar(peticion, cuerpo) {
  const cabeceras = { ...peticion.headers, host: arriba.host }
  const respuesta = await fetch(`${arriba.origin}${peticion.url}`, {
    method: peticion.method,
    headers: cabeceras,
    body: ['GET', 'HEAD'].includes(peticion.method) ? undefined : cuerpo,
    signal: AbortSignal.timeout(30_000),
  })
  const contenido = Buffer.from(await respuesta.arrayBuffer())
  return { respuesta, contenido }
}

function responder(salida, { respuesta, contenido }) {
  if (salida.writableEnded || salida.destroyed) return
  const cabeceras = {}
  respuesta.headers.forEach((valor, clave) => {
    if (!['content-encoding', 'transfer-encoding', 'content-length'].includes(clave)) {
      cabeceras[clave] = valor
    }
  })
  salida.writeHead(respuesta.status, cabeceras)
  salida.end(contenido)
}

function responder502(salida) {
  if (salida.writableEnded || salida.destroyed) return
  salida.writeHead(502, { 'content-type': 'text/plain' })
  salida.end('502 Bad Gateway')
}

const proxy = http.createServer((peticion, salida) => {
  const trozos = []
  peticion.on('data', (t) => trozos.push(t))
  peticion.on('end', () => {
    const cuerpo = Buffer.concat(trozos)
    const ruta = (peticion.url ?? '').split('?')[0]
    const esAlta = peticion.method === 'POST' && ruta === '/auth/v1/admin/users'
    const esPerfil = peticion.method === 'POST' && ruta === '/rest/v1/perfiles'
    const actual = esAlta ? planes.alta.shift() : esPerfil ? planes.perfil.shift() : undefined

    seguir((async () => {
      try {
        switch (actual?.tipo) {
          case 'perder-respuesta': {
            const r = await reenviar(peticion, cuerpo)
            actual.avisar('escrito', r.respuesta.status)
            responder502(salida)
            return
          }
          case 'en-vuelo': {
            responder502(salida)
            await esperar(actual.retrasoMs)
            const r = await reenviar(peticion, cuerpo)
            actual.avisar('aterrizaje', r.respuesta.status)
            return
          }
          case 'retener': {
            const r = await reenviar(peticion, cuerpo)
            actual.avisar('escrito', r.respuesta.status)
            await actual.liberado
            responder502(salida)
            return
          }
          case 'retener-sin-reenviar': {
            actual.avisar('retenido')
            await actual.liberado
            const r = await reenviar(peticion, cuerpo)
            actual.avisar('aterrizaje', r.respuesta.status)
            responder502(salida)
            return
          }
          case 'cortar':
            salida.socket?.destroy()
            return
          default:
            responder(salida, await reenviar(peticion, cuerpo))
        }
      } catch (error) {
        actual?.avisar('aterrizaje', `error: ${error instanceof Error ? error.name : 'desconocido'}`)
        responder502(salida)
      }
    })())
  })
})

// ================================================================
// Servidor de la aplicación
// ================================================================
/**
 * Sólo estas variables llegan al proceso hijo. No se hereda el entorno
 * completo: arrastraría cualquier secreto que hubiera en la sesión.
 */
function entornoDelServidor() {
  return {
    PATH: process.env.PATH,
    SYSTEMROOT: process.env.SYSTEMROOT,
    COMSPEC: process.env.COMSPEC,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    NODE_ENV: 'development',
    NEXT_TELEMETRY_DISABLED: '1',
    // El cliente de la aplicación y el administrativo pasan por el intermediario.
    NEXT_PUBLIC_SUPABASE_URL: PROXY,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: local.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY,
  }
}

let servidor = null
let registroDelServidor = ''

async function puertoLibre(puerto) {
  try {
    await fetch(`http://127.0.0.1:${puerto}/`, { signal: AbortSignal.timeout(1500) })
    return false
  } catch {
    return true
  }
}

/** Baja el servidor de la aplicación con todo su árbol de procesos. */
async function detenerServidor() {
  const proceso = servidor
  servidor = null
  await detenerArbol(proceso)
}

async function iniciarServidor() {
  if (!(await puertoLibre(PUERTO_APP))) {
    throw new Error(`el puerto ${PUERTO_APP} ya está ocupado; se mediría otro servidor`)
  }
  registroDelServidor = ''
  // Next se ejecuta directamente con Node, sin intérprete de comandos: el
  // proceso raíz del árbol es el propio servidor.
  servidor = spawn(process.execPath, [CLI_NEXT, 'dev', '--port', String(PUERTO_APP)], {
    cwd: RAIZ,
    env: entornoDelServidor(),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    windowsHide: true,
  })
  servidor.stdout.on('data', (t) => { registroDelServidor = (registroDelServidor + t).slice(-16_000) })
  servidor.stderr.on('data', (t) => { registroDelServidor = (registroDelServidor + t).slice(-16_000) })

  for (let i = 0; i < 120; i += 1) {
    try {
      const r = await fetch(`${APP}/login`, { redirect: 'manual', signal: AbortSignal.timeout(3000) })
      if (r.status > 0) return
    } catch {
      // Todavía no.
    }
    await esperar(1000)
  }
  throw new Error('el servidor de la aplicación no llegó a atender peticiones')
}

// ================================================================
// Identidad de la directora
// ================================================================
async function sembrarDirectora() {
  const respuesta = await fetch(`${local.API_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: local.SERVICE_ROLE_KEY,
      authorization: `Bearer ${local.SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      email: DIRECTORA.email,
      password: DIRECTORA.password,
      email_confirm: true,
      app_metadata: {
        ept_alta: {
          nombre: 'Prueba', apellido: 'DirectoraReconciliacion', dni: DIRECTORA.dni,
          rol_id: rolId('DIRECTOR'), telefono: null, direccion: null, legajo_nro: null,
        },
      },
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!respuesta.ok) throw new Error(`no se pudo sembrar la directora (${respuesta.status})`)
}

/** Construye la cookie de sesión igual que la escribe `@supabase/ssr`. */
async function sesionDeDirectora() {
  const respuesta = await fetch(`${local.API_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: local.ANON_KEY },
    body: JSON.stringify({ email: DIRECTORA.email, password: DIRECTORA.password }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!respuesta.ok) throw new Error(`no se pudo iniciar sesión como directora (${respuesta.status})`)
  const sesion = await respuesta.json()
  const valor = Buffer.from(JSON.stringify(sesion), 'utf8').toString('base64')
  return { token: sesion.access_token, cookie: `sb-127-auth-token=base64-${valor}` }
}

let cookie = ''

function datosDeAlta(sufijo, extra = {}) {
  const dni = `${PREFIJO_DNI}${sufijo}`
  return {
    operacion_id: randomUUID(),
    email: `${PREFIJO_EMAIL}${dni}@${DOMINIO}`,
    password: CONTRASENA,
    nombre: 'Reconciliacion',
    apellido: 'DePrueba',
    dni,
    rol_id: rolId('ESTUDIANTE'),
    legajo_nro: `LEG-RECON-${sufijo}`,
    ...extra,
  }
}

/** Llama al alta con la sesión de la directora. */
async function crearUsuario(datos, { limiteMs = 60_000 } = {}) {
  const respuesta = await fetch(`${APP}/api/usuarios`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(datos),
    signal: AbortSignal.timeout(limiteMs),
  })
  const texto = await respuesta.text()
  let cuerpo = null
  try {
    cuerpo = JSON.parse(texto)
  } catch {
    cuerpo = null
  }
  return { estado: respuesta.status, cuerpo, texto }
}

// ================================================================
// Guardia de filtraciones en las respuestas
// ================================================================
const FRAGMENTOS_TECNICOS = [
  /\b\d{2}[0-9A-Z]{3}\b/u, // SQLSTATE: 23505, 42P01, 57014…
  /\bP\d{4}\b/u,
  /PGRST\d{3}/u,
  /schema cache/iu,
  /permission denied/iu,
  /duplicate key/iu,
  /violates/iu,
  /constraint/iu,
  /\brelation\b/iu,
  /database error/iu,
  /unexpected_failure|email_exists|user_already_exists|validation_failed/iu,
  /auth\.users|\bperfiles\b|\balumnos\b|app_metadata|ept_alta/iu,
  /https?:\/\//iu,
  /\bat [\w.<>]+ \(/u,
  /\b(?:TypeError|Error|AuthApiError|AuthRetryableFetchError):/u,
  /supabase|postgres|postgrest|gotrue|service_role/iu,
  /eyJ[A-Za-z0-9_-]{10,}/u,
]

const CODIGOS_CONOCIDOS = new Set([
  'NO_AUTENTICADO', 'SIN_PERMISO', 'CUERPO_INVALIDO', 'DATOS_INVALIDOS',
  'VINCULO_NO_DISPONIBLE', 'ROL_INEXISTENTE', 'DNI_DUPLICADO', 'LEGAJO_DUPLICADO',
  'EMAIL_DUPLICADO', 'CONTRASENA_RECHAZADA', 'OPERACION_REUTILIZADA', 'ALTA_RECHAZADA',
  'ALTA_SIN_CONFIRMAR', 'ESTADO_INCONSISTENTE', 'SIN_CAMBIOS', 'CARGA_FALLIDA',
  'SERVICIO_NO_DISPONIBLE', 'ERROR_INESPERADO',
])

function exigirRespuestaLimpia(escenario, r) {
  const filtracion = FRAGMENTOS_TECNICOS.find((patron) => patron.test(r.texto))
  afirmar(!filtracion, `${escenario}: la respuesta no contiene detalle técnico${filtracion ? ` (${filtracion})` : ''}`)
  if (r.estado >= 400) {
    afirmar(
      CODIGOS_CONOCIDOS.has(r.cuerpo?.codigo) && typeof r.cuerpo?.error === 'string',
      `${escenario}: el error trae un código de dominio y un mensaje`
    )
  }
}

// ================================================================
// Ruta anterior, para la prueba inversa
// ================================================================
/**
 * Materializa la ruta del commit 4b593a70 fuera de Next.
 *
 * Se toma el archivo tal cual está en Git y se transpila. Solo se reemplazan
 * las cuatro dependencias de marco: la respuesta de Next, el cliente de sesión
 * (que queda ligado a la sesión real de la directora), el cliente
 * administrativo (que apunta al intermediario, igual que en el servidor) y los
 * alias de importación. La lógica de reconciliación y compensación no se toca.
 */
async function cargarRutaAnterior(directorio, configuracion) {
  const ts = requerir('typescript')
  const git = (ruta) =>
    execFileSync('git', ['-C', RAIZ, 'show', `${SHA_RUTA_ANTERIOR}:${ruta}`], { encoding: 'utf8' })
  const transpilar = (fuente) =>
    ts.transpileModule(fuente, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText

  const zod = pathToFileURL(path.join(RAIZ, 'node_modules', 'zod', 'index.js')).href
  const supabase = pathToFileURL(
    path.join(RAIZ, 'node_modules', '@supabase', 'supabase-js', 'dist', 'index.mjs')
  ).href

  const reemplazar = (codigo) => {
    const salida = codigo
      .replaceAll("from 'zod'", `from '${zod}'`)
      .replaceAll("from 'next/server'", "from './next-server.mjs'")
      .replaceAll("from '@/lib/validations'", "from './validations.mjs'")
      .replaceAll("from '@/services/supabase.server'", "from './supabase.server.mjs'")
      .replaceAll("from '@/services/supabase.admin'", "from './supabase.admin.mjs'")
    if (/from '(?:@\/|next\/)/u.test(salida)) {
      throw new Error('la ruta anterior importa algo que la prueba inversa no reemplazó')
    }
    return salida
  }

  writeFileSync(path.join(directorio, 'validations.mjs'), reemplazar(transpilar(git('src/lib/validations.ts'))))
  writeFileSync(path.join(directorio, 'route.mjs'), reemplazar(transpilar(git('src/app/api/usuarios/route.ts'))))
  writeFileSync(
    path.join(directorio, 'next-server.mjs'),
    `export const NextResponse = {
  json: (cuerpo, inicio = {}) => new Response(JSON.stringify(cuerpo), {
    status: inicio.status ?? 200, headers: { 'content-type': 'application/json' },
  }),
}\n`
  )
  writeFileSync(
    path.join(directorio, 'supabase.server.mjs'),
    `import { createClient } from '${supabase}'
export async function createServerSupabaseClient() {
  const c = globalThis.__EPT9_RUTA_ANTERIOR__
  const cliente = createClient(c.url, c.anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: 'Bearer ' + c.token } },
  })
  const getUser = cliente.auth.getUser.bind(cliente.auth)
  cliente.auth.getUser = () => getUser(c.token)
  return cliente
}\n`
  )
  writeFileSync(
    path.join(directorio, 'supabase.admin.mjs'),
    `import { createClient } from '${supabase}'
export function createAdminClient() {
  const c = globalThis.__EPT9_RUTA_ANTERIOR__
  return createClient(c.proxy, c.servicio, { auth: { autoRefreshToken: false, persistSession: false } })
}\n`
  )

  globalThis.__EPT9_RUTA_ANTERIOR__ = configuracion
  return import(pathToFileURL(path.join(directorio, 'route.mjs')).href)
}

// ================================================================
// Escenarios
// ================================================================
async function escenarios(token) {
  const estudiante = rolId('ESTUDIANTE')

  // ---------------------------------------------------------------
  // A. Alta sin incidentes.
  // ---------------------------------------------------------------
  const base = datosDeAlta('000001')
  {
    const r = await crearUsuario(base)
    afirmar(r.estado === 200 && r.cuerpo?.reconciliada === false, `A: el alta directa responde 200 sin reconciliar (${r.estado})`)
    afirmar(r.cuerpo?.user_id === base.operacion_id, 'A: el id de la cuenta es el de la operación')
    afirmar(cuentas(base.email) === 1 && perfilesConDni(base.dni) === 1 && alumnosConDni(base.dni) === 1,
      'A: quedaron una cuenta, un perfil y un legajo académico')
    exigirRespuestaLimpia('A', r)
    exigirInvariantes('A')
  }

  // ---------------------------------------------------------------
  // B. Rechazo determinista de PostgreSQL.
  // ---------------------------------------------------------------
  {
    const datos = datosDeAlta('000002', { apellido: 'RechazoConfirmado' })
    inyectarRechazoDePerfil()
    let r
    try {
      r = await crearUsuario(datos)
    } finally {
      retirarInyecciones()
    }
    afirmar(r.estado === 422 && r.cuerpo?.codigo === 'ALTA_RECHAZADA', `B: un rechazo confirmado responde 422 ALTA_RECHAZADA (${r.estado} ${r.cuerpo?.codigo})`)
    afirmar(/^[0-9a-f-]{36}$/u.test(r.cuerpo?.referencia ?? ''), 'B: trae una referencia técnica aleatoria')
    afirmar(cuentas(datos.email) === 0, 'B: la transacción revirtió también la cuenta')
    afirmar(perfilesConDni(datos.dni) === 0 && contar(`FROM public.perfiles WHERE legajo_nro = '${datos.legajo_nro}'`) === 0,
      'B: no quedaron reservados el DNI ni el legajo')
    exigirRespuestaLimpia('B', r)
    exigirInvariantes('B')

    const reintento = await crearUsuario({ ...datos, apellido: 'SinRechazo' })
    afirmar(reintento.estado === 200, `B: con el rechazo retirado, la misma operación se completa (${reintento.estado})`)
    afirmar(cuentas(datos.email) === 1 && perfilesConDni(datos.dni) === 1, 'B: sin duplicados tras el reintento')
    exigirInvariantes('B-reintento')
  }

  // ---------------------------------------------------------------
  // C. Escritura confirmada, respuesta perdida.
  // ---------------------------------------------------------------
  {
    const datos = datosDeAlta('000003')
    const perdida = plan('perder-respuesta')
    planes.alta.push(perdida)
    const r = await crearUsuario(datos)
    afirmar((await perdida.escrito) === 200, 'C: la escritura sí confirmó arriba antes de perder la respuesta')
    afirmar(r.estado === 200 && r.cuerpo?.reconciliada === true, `C: la ruta la reconcilia como confirmada (${r.estado})`)
    afirmar(cuentas(datos.email) === 1 && perfilesConDni(datos.dni) === 1 && alumnosConDni(datos.dni) === 1,
      'C: nada se borró: cuenta, perfil y legajo siguen juntos')
    exigirRespuestaLimpia('C', r)
    exigirInvariantes('C')
  }

  // ---------------------------------------------------------------
  // D. Escrituras en vuelo cuando llega el error: lectura inicial vacía y
  //    confirmación tardía. Después, reintento de la misma operación.
  // ---------------------------------------------------------------
  {
    const datos = datosDeAlta('000004')
    const enVuelo = [plan('en-vuelo', { retrasoMs: 3000 }), plan('en-vuelo', { retrasoMs: 3000 }), plan('en-vuelo', { retrasoMs: 3000 })]
    planes.alta.push(...enVuelo)
    const inicio = Date.now()
    const r = await crearUsuario(datos)
    const duracion = Date.now() - inicio

    afirmar(r.estado === 503 && r.cuerpo?.codigo === 'ALTA_SIN_CONFIRMAR', `D: con todo en vuelo responde 503 ALTA_SIN_CONFIRMAR (${r.estado} ${r.cuerpo?.codigo})`)
    afirmar(duracion < 20_000, `D: responde en un tiempo acotado (${duracion} ms)`)
    afirmar(cuentas(datos.email) === 0 && perfilesConDni(datos.dni) === 0,
      'D: en el momento de responder la lectura está vacía: la escritura todavía no llegó')

    const aterrizajes = await Promise.all(enVuelo.map((p) => p.aterrizaje))
    afirmar(aterrizajes.filter((estado) => estado === 200).length === 1,
      `D: de las escrituras tardías confirmó exactamente una (${aterrizajes.join(', ')})`)
    afirmar(cuentas(datos.email) === 1 && perfilesConDni(datos.dni) === 1 && alumnosConDni(datos.dni) === 1,
      'D: confirmación tardía: cuenta, perfil y legajo existen y nada se borró')
    exigirRespuestaLimpia('D', r)
    exigirInvariantes('D')

    const reintento = await crearUsuario(datos)
    afirmar(reintento.estado === 200 && reintento.cuerpo?.reconciliada === true,
      `D: reintentar la misma operación confirma sin duplicar (${reintento.estado})`)
    afirmar(cuentas(datos.email) === 1 && perfilesConDni(datos.dni) === 1, 'D: sigue habiendo una sola cuenta y un solo perfil')
    exigirInvariantes('D-reintento')
  }

  // ---------------------------------------------------------------
  // E. Primera escritura en vuelo, segunda normal.
  // ---------------------------------------------------------------
  {
    const datos = datosDeAlta('000005')
    const tardia = plan('en-vuelo', { retrasoMs: 2500 })
    planes.alta.push(tardia)
    const r = await crearUsuario(datos)
    afirmar(r.estado === 200, `E: el reintento interno confirma el alta (${r.estado})`)
    const estadoTardio = await tardia.aterrizaje
    afirmar(estadoTardio !== 200, `E: la escritura tardía no creó una segunda cuenta (${estadoTardio})`)
    afirmar(cuentas(datos.email) === 1 && perfilesConDni(datos.dni) === 1, 'E: una sola cuenta y un solo perfil')
    exigirRespuestaLimpia('E', r)
    exigirInvariantes('E')
  }

  // ---------------------------------------------------------------
  // F. Perfil existente coherente: la misma operación, otra vez.
  // ---------------------------------------------------------------
  {
    const r = await crearUsuario(base)
    afirmar(r.estado === 200 && r.cuerpo?.reconciliada === true, `F: repetir una operación confirmada responde 200 reconciliada (${r.estado})`)
    afirmar(cuentas(base.email) === 1 && perfilesConDni(base.dni) === 1, 'F: no se duplicó nada')
    exigirInvariantes('F')
  }

  // ---------------------------------------------------------------
  // G. Perfil existente incompatible: misma operación, otros datos.
  // ---------------------------------------------------------------
  {
    const otroDni = `${PREFIJO_DNI}000007`
    const otroEmail = `${PREFIJO_EMAIL}${otroDni}@${DOMINIO}`
    const r = await crearUsuario({ ...base, dni: otroDni, email: otroEmail, legajo_nro: 'LEG-RECON-000007' })
    afirmar(r.estado === 409 && r.cuerpo?.codigo === 'OPERACION_REUTILIZADA', `G: otra identidad con la misma operación responde 409 OPERACION_REUTILIZADA (${r.estado} ${r.cuerpo?.codigo})`)
    afirmar(perfilesConDni(base.dni) === 1 && cuentas(base.email) === 1, 'G: la cuenta y el perfil originales siguen intactos')
    afirmar(perfilesConDni(otroDni) === 0 && cuentas(otroEmail) === 0, 'G: no se creó la otra identidad')
    exigirRespuestaLimpia('G', r)

    const mismoEmail = await crearUsuario({ ...base, dni: otroDni, legajo_nro: 'LEG-RECON-000007' })
    afirmar(mismoEmail.estado === 409 && mismoEmail.cuerpo?.codigo === 'OPERACION_REUTILIZADA', `G: mismo email y otro DNI con la misma operación también es 409 (${mismoEmail.estado} ${mismoEmail.cuerpo?.codigo})`)
    exigirInvariantes('G')
  }

  // ---------------------------------------------------------------
  // H. Duplicados ajenos: otra operación con un email o un DNI existentes.
  // ---------------------------------------------------------------
  {
    const emailAjeno = await crearUsuario({ ...datosDeAlta('000008'), email: base.email })
    afirmar(emailAjeno.estado === 409 && emailAjeno.cuerpo?.codigo === 'EMAIL_DUPLICADO', `H: un email ajeno responde 409 EMAIL_DUPLICADO (${emailAjeno.estado} ${emailAjeno.cuerpo?.codigo})`)
    afirmar(perfilesConDni(`${PREFIJO_DNI}000008`) === 0, 'H: el email ajeno no dejó ningún perfil')
    exigirRespuestaLimpia('H-email', emailAjeno)

    const datosDni = { ...datosDeAlta('000009'), dni: base.dni }
    const dniAjeno = await crearUsuario(datosDni)
    afirmar(dniAjeno.estado === 409 && dniAjeno.cuerpo?.codigo === 'DNI_DUPLICADO', `H: un DNI ajeno responde 409 DNI_DUPLICADO (${dniAjeno.estado} ${dniAjeno.cuerpo?.codigo})`)
    afirmar(cuentas(datosDni.email) === 0, 'H: el DNI ajeno no creó ninguna cuenta')
    exigirRespuestaLimpia('H-dni', dniAjeno)

    const datosLegajo = { ...datosDeAlta('000010'), legajo_nro: base.legajo_nro.toLowerCase() }
    const legajoAjeno = await crearUsuario(datosLegajo)
    afirmar(legajoAjeno.estado === 409 && legajoAjeno.cuerpo?.codigo === 'LEGAJO_DUPLICADO', `H: un legajo ajeno en minúsculas responde 409 LEGAJO_DUPLICADO (${legajoAjeno.estado} ${legajoAjeno.cuerpo?.codigo})`)
    afirmar(cuentas(datosLegajo.email) === 0, 'H: el legajo ajeno no creó ninguna cuenta')
    exigirInvariantes('H')
  }

  // ---------------------------------------------------------------
  // I. Dos envíos simultáneos de la misma operación.
  // ---------------------------------------------------------------
  {
    const datos = datosDeAlta('000011')
    const [uno, otro] = await Promise.all([crearUsuario(datos), crearUsuario(datos)])
    afirmar(uno.estado === 200 && otro.estado === 200, `I: los dos envíos concurrentes responden 200 (${uno.estado}, ${otro.estado})`)
    afirmar([uno, otro].filter((r) => r.cuerpo?.reconciliada === false).length <= 1,
      'I: a lo sumo uno creó la cuenta; el otro la reconcilió')
    afirmar(cuentas(datos.email) === 1 && perfilesConDni(datos.dni) === 1, 'I: una sola cuenta y un solo perfil')
    exigirInvariantes('I')
  }

  // ---------------------------------------------------------------
  // J. Conexión cortada en todos los intentos: nada se crea ni se borra.
  // ---------------------------------------------------------------
  {
    const datos = datosDeAlta('000012')
    planes.alta.push(plan('cortar'), plan('cortar'), plan('cortar'))
    const r = await crearUsuario(datos)
    afirmar(r.estado === 503 && r.cuerpo?.codigo === 'ALTA_SIN_CONFIRMAR', `J: sin respuesta de Auth responde 503 ALTA_SIN_CONFIRMAR (${r.estado} ${r.cuerpo?.codigo})`)
    afirmar(cuentas(datos.email) === 0 && perfilesConDni(datos.dni) === 0, 'J: no se creó nada')
    exigirRespuestaLimpia('J', r)
    exigirInvariantes('J')
  }

  // ---------------------------------------------------------------
  // K. Estado inconsistente: una cuenta con el id de la operación y sin perfil.
  // ---------------------------------------------------------------
  {
    const datos = datosDeAlta('000013')
    const creada = await fetch(`${local.API_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: local.SERVICE_ROLE_KEY, authorization: `Bearer ${local.SERVICE_ROLE_KEY}` },
      body: JSON.stringify({ id: datos.operacion_id, email: datos.email, password: CONTRASENA, email_confirm: true }),
      signal: AbortSignal.timeout(10_000),
    })
    afirmar(creada.ok, 'K: se preparó una cuenta sin perfil fuera de la ruta')
    const r = await crearUsuario(datos)
    afirmar(r.estado === 500 && r.cuerpo?.codigo === 'ESTADO_INCONSISTENTE', `K: la ruta lo informa como 500 ESTADO_INCONSISTENTE (${r.estado} ${r.cuerpo?.codigo})`)
    afirmar(cuentas(datos.email) === 1, 'K: la cuenta inconsistente NO se borró a ciegas')
    afirmar(perfilesConDni(datos.dni) === 0, 'K: tampoco se le inventó un perfil')
    exigirRespuestaLimpia('K', r)
    sql(`DELETE FROM auth.users WHERE email = '${datos.email}';`)
    exigirInvariantes('K')
  }

  // ---------------------------------------------------------------
  // O. GoTrue confirma, pero la garantía de la migración 010 no está: con el
  //    trigger deshabilitado la cuenta nace sin perfil. La ruta no puede
  //    informar eso como un alta exitosa, ni borrar la cuenta, ni inventar el
  //    perfil.
  // ---------------------------------------------------------------
  {
    const datos = datosDeAlta('000017')
    afirmar(estadoDelTriggerDeAlta() === 'O', 'O: el trigger de alta estaba habilitado antes del escenario')
    let r
    try {
      sqlComoAdministrador('ALTER TABLE auth.users DISABLE TRIGGER registrar_perfil_al_crear_cuenta;')
      r = await crearUsuario(datos)
    } finally {
      sqlComoAdministrador('ALTER TABLE auth.users ENABLE TRIGGER registrar_perfil_al_crear_cuenta;')
    }
    afirmar(estadoDelTriggerDeAlta() === 'O', 'O: el trigger quedó habilitado otra vez')
    afirmar(r.estado === 500 && r.cuerpo?.codigo === 'ESTADO_INCONSISTENTE',
      `O: sin el trigger, la ruta no afirma éxito: responde 500 ESTADO_INCONSISTENTE (${r.estado} ${r.cuerpo?.codigo})`)
    afirmar(/^[0-9a-f-]{36}$/u.test(r.cuerpo?.referencia ?? ''), 'O: trae una referencia técnica aleatoria')
    afirmar(cuentas(datos.email) === 1, 'O: la cuenta que GoTrue confirmó NO se borró')
    afirmar(perfilesConDni(datos.dni) === 0, 'O: tampoco se le inventó un perfil')
    exigirRespuestaLimpia('O', r)
    // Sin el trigger nadie retiró `ept_alta`: la cuenta de prueba guarda los
    // datos del alta en `app_metadata` y se borra antes de las invariantes.
    sql(`DELETE FROM auth.users WHERE email = '${datos.email}';`)
    exigirInvariantes('O')
  }

  // ---------------------------------------------------------------
  // L. Caída del servidor con la escritura confirmada y la respuesta pendiente.
  // ---------------------------------------------------------------
  {
    const datos = datosDeAlta('000014')
    const retenida = plan('retener')
    planes.alta.push(retenida)
    const pedido = crearUsuario(datos).catch((error) => ({ caida: error instanceof Error ? error.name : 'error' }))
    afirmar((await retenida.escrito) === 200, 'L: la escritura confirmó arriba mientras la respuesta quedó retenida')
    await detenerServidor()
    retenida.liberar()
    const resultado = await pedido
    afirmar('caida' in resultado, 'L: el pedido original murió con el servidor')
    afirmar(cuentas(datos.email) === 1 && perfilesConDni(datos.dni) === 1 && alumnosConDni(datos.dni) === 1,
      'L: tras la caída, cuenta, perfil y legajo están juntos')
    exigirInvariantes('L-caida')

    await iniciarServidor()
    const reintento = await crearUsuario(datos)
    afirmar(reintento.estado === 200 && reintento.cuerpo?.reconciliada === true, `L: después de reiniciar, la misma operación se reconcilia (${reintento.estado})`)
    afirmar(cuentas(datos.email) === 1 && perfilesConDni(datos.dni) === 1, 'L: sin duplicados después del reinicio')
    exigirInvariantes('L')
  }

  // ---------------------------------------------------------------
  // M. Caída del servidor con la escritura todavía sin reenviar.
  // ---------------------------------------------------------------
  {
    const datos = datosDeAlta('000015')
    const guardada = plan('retener-sin-reenviar')
    planes.alta.push(guardada)
    const pedido = crearUsuario(datos).catch((error) => ({ caida: error instanceof Error ? error.name : 'error' }))
    await guardada.retenido
    await detenerServidor()
    await pedido
    afirmar(cuentas(datos.email) === 0, 'M: al caer el servidor la escritura todavía no existía')
    guardada.liberar()
    afirmar((await guardada.aterrizaje) === 200, 'M: la escritura llegó después de la caída y confirmó')
    afirmar(cuentas(datos.email) === 1 && perfilesConDni(datos.dni) === 1 && alumnosConDni(datos.dni) === 1,
      'M: la escritura tardía dejó cuenta, perfil y legajo juntos')
    exigirInvariantes('M-caida')

    await iniciarServidor()
    const reintento = await crearUsuario(datos)
    afirmar(reintento.estado === 200 && reintento.cuerpo?.reconciliada === true, `M: después de reiniciar, la misma operación se reconcilia (${reintento.estado})`)
    exigirInvariantes('M')
  }

  // ---------------------------------------------------------------
  // N. Prueba inversa: el código anterior frente a la escritura en vuelo.
  // ---------------------------------------------------------------
  {
    const dni = `${PREFIJO_DNI}000016`
    const email = `${PREFIJO_EMAIL}${dni}@${DOMINIO}`
    const directorio = mkdtempSync(path.join(tmpdir(), 'ept9-ruta-anterior-'))
    try {
      const rutaAnterior = await cargarRutaAnterior(directorio, {
        url: local.API_URL, anon: local.ANON_KEY, token, proxy: PROXY, servicio: local.SERVICE_ROLE_KEY,
      })
      const tardio = plan('en-vuelo', { retrasoMs: 2000 })
      planes.perfil.push(tardio)
      const respuesta = await rutaAnterior.POST(new Request(`${APP}/api/usuarios`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: CONTRASENA, nombre: 'Reconciliacion', apellido: 'RutaAnterior', dni, rol_id: estudiante, legajo_nro: 'LEG-RECON-000016' }),
      }))
      afirmar(respuesta.status >= 400, `N: la ruta anterior informó el alta como fallida (${respuesta.status})`)
      afirmar(cuentas(email) === 0, 'N: la ruta anterior BORRÓ la cuenta tras una sola lectura vacía')
      afirmar((await tardio.aterrizaje) === 201, 'N: el INSERT que seguía en vuelo confirmó después')
      afirmar(
        contar(`FROM public.perfiles p LEFT JOIN auth.users u ON u.id = p.user_id WHERE p.dni = '${dni}' AND u.id IS NULL`) === 1,
        'N: resultado del código anterior: un perfil huérfano, sin cuenta'
      )
      afirmar(alumnosConDni(dni) === 1, 'N: y un legajo académico colgado de ese perfil huérfano')
    } finally {
      rmSync(directorio, { recursive: true, force: true })
      delete globalThis.__EPT9_RUTA_ANTERIOR__
      sql(`BEGIN;
        DELETE FROM public.alumnos WHERE perfil_id IN (SELECT id FROM public.perfiles WHERE dni = '${dni}');
        DELETE FROM public.perfiles WHERE dni = '${dni}';
        COMMIT;
        DELETE FROM auth.users WHERE email = '${email}';`)
    }
    exigirInvariantes('N-limpieza')
  }
}

// ================================================================
// Arranque, ejecución y cierre
// ================================================================
if (entornoValido) {
  try {
    if (!(await puertoLibre(PUERTO_PROXY))) {
      throw new Error(`el puerto ${PUERTO_PROXY} del intermediario ya está ocupado`)
    }
    await new Promise((resolver, rechazar) => {
      proxy.once('error', rechazar)
      proxy.listen(PUERTO_PROXY, '127.0.0.1', resolver)
    })
    console.log(`Instancia local verificada; intermediario en 127.0.0.1:${PUERTO_PROXY}`)

    limpiar()
    await sembrarDirectora()
    const sesion = await sesionDeDirectora()
    cookie = sesion.cookie

    await iniciarServidor()
    console.log(`Aplicación escuchando en ${APP}`)

    await escenarios(sesion.token)
  } catch (error) {
    fallos += 1
    console.error(`FALLO  ${error instanceof Error ? error.message : String(error)}`)
    if (registroDelServidor) console.error(registroDelServidor.slice(-2000))
  } finally {
    await detenerServidor()
    for (const p of [...planes.alta, ...planes.perfil]) p.liberar()
    planes.alta.length = 0
    planes.perfil.length = 0
    await carreraConPlazo(Promise.allSettled([...tareasEnCurso]), 15_000)
    // Las conexiones persistentes del propio arnés mantendrían vivo el
    // intermediario hasta que venciera su inactividad.
    proxy.closeAllConnections()
    await new Promise((resolver) => proxy.close(() => resolver()))
    try {
      limpiar()
    } catch (error) {
      fallos += 1
      console.error(`FALLO  la limpieza no terminó: ${error instanceof Error ? error.message : String(error)}`)
    }
    afirmar(await puertoLibre(PUERTO_APP), `el puerto ${PUERTO_APP} quedó libre al terminar`)
    afirmar(await puertoLibre(PUERTO_PROXY), `el puerto ${PUERTO_PROXY} quedó libre al terminar`)
    afirmar(
      contar(`FROM auth.users WHERE email LIKE '${PREFIJO_EMAIL}%@${DOMINIO}'`) === 0 &&
        contar(`FROM public.perfiles WHERE dni LIKE '${PREFIJO_DNI}%'`) === 0,
      'la base quedó sin datos de la suite'
    )
  }

  console.log(`\n${afirmaciones} afirmaciones, ${fallos} incumplida(s).`)
  process.exitCode = fallos > 0 ? 1 : 0
}
