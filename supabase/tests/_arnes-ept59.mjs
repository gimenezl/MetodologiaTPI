/**
 * Piezas comunes de las pruebas de API de EPT-59 (bloqueo de acceso y vínculo
 * presencial de cuentas).
 *
 * - Credenciales: se leen en el proceso desde `npx supabase status -o env` y se
 *   niega a seguir si la API o Mailpit no son de bucle local. No se escribe
 *   nada en disco ni se imprime ninguna clave.
 * - Base: `docker exec psql` contra el contenedor local, como el resto de las
 *   suites.
 * - Servidor de Next propio, en el puerto que pida cada suite, con una lista
 *   blanca de variables y el registro completo en memoria (para buscar en él
 *   filtraciones).
 * - Intermediario HTTP delante de Supabase con planes por petición, para
 *   inyectar fallos en el tráfico administrativo del servidor.
 */

import { execFileSync, execSync, spawn } from 'node:child_process'
import http from 'node:http'
import { setTimeout as esperar } from 'node:timers/promises'
import { CLI_NEXT, RAIZ, detener as detenerArbol } from './_arnes-produccion.mjs'

export { RAIZ }

export const CONTENEDOR =
  process.env.EPT_SUPABASE_DB_CONTAINER ?? 'supabase_db_educar-para-transformar'

const ANFITRIONES_LOCALES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

// ================================================================
// Afirmaciones
// ================================================================
export const conteo = { afirmaciones: 0, fallos: 0 }

export function afirmar(condicion, descripcion) {
  conteo.afirmaciones += 1
  if (condicion) {
    console.log(`OK  ${descripcion}`)
    return true
  }
  conteo.fallos += 1
  console.error(`FALLO  ${descripcion}`)
  return false
}

// ================================================================
// Entorno local
// ================================================================
export function entornoLocal() {
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
  if (!valores.API_URL || !valores.SERVICE_ROLE_KEY || !valores.ANON_KEY) {
    throw new Error('no se pudo leer la instancia local de Supabase (¿supabase start?)')
  }
  for (const clave of ['API_URL', 'MAILPIT_URL']) {
    if (valores[clave] && !ANFITRIONES_LOCALES.has(new URL(valores[clave]).hostname)) {
      throw new Error(`${clave} no es de bucle local: la suite se niega a correr`)
    }
  }
  const dockerHost = process.env.DOCKER_HOST ?? ''
  if (dockerHost && !/^(npipe|unix):/iu.test(dockerHost)) {
    throw new Error('DOCKER_HOST apunta a un daemon remoto: la suite se niega a correr')
  }
  return valores
}

// ================================================================
// Base de datos
// ================================================================
export function sql(sentencia, usuario = 'postgres') {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTENEDOR, 'psql', '-X', '-q', '-A', '-t', '-U', usuario,
     '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    { input: sentencia, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim()
}

export const contar = (consulta) => Number(sql(`SELECT pg_catalog.count(*) ${consulta};`))

export function exigirBaseLocal() {
  const origen = sql(`SELECT COALESCE(host(inet_server_addr()), 'socket-local');`)
  if (!['socket-local', '127.0.0.1', '::1'].includes(origen)) {
    throw new Error(`la conexión a la base no es local (${origen})`)
  }
  const migracion = sql(`SELECT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations
                                        WHERE version = '20260926190000');`)
  if (migracion !== 't') throw new Error('la base local no tiene aplicada la migración EPT-59')
}

/**
 * Borra todo lo que una suite creó, respetando las guardas de solo agregado.
 *
 * El historial de perfiles, las reservas de vínculo y el historial de estados
 * de profesor no se pueden borrar ni siquiera como propietario. Solo esta
 * limpieza local deshabilita sus guardas, dentro de una única transacción que
 * además cubre la invariante diferida alumnos ⇔ matrículas.
 */
export function limpiarFixture({ prefijoDni, prefijoCorreo, dominio, curso }) {
  const fixture = `(SELECT id FROM public.perfiles WHERE dni LIKE '${prefijoDni}%')`
  sql(`
    BEGIN;
    ALTER TABLE public.perfiles_historial DISABLE TRIGGER impedir_modificar_historial_perfiles;
    DELETE FROM public.perfiles_historial
      WHERE perfil_id IN ${fixture} OR actor_perfil_id IN ${fixture};
    ALTER TABLE public.perfiles_historial ENABLE TRIGGER impedir_modificar_historial_perfiles;
    ALTER TABLE app_private.vinculos_cuenta DISABLE TRIGGER impedir_borrar_vinculos_cuenta;
    DELETE FROM app_private.vinculos_cuenta
      WHERE perfil_id IN ${fixture} OR director_perfil_id IN ${fixture};
    ALTER TABLE app_private.vinculos_cuenta ENABLE TRIGGER impedir_borrar_vinculos_cuenta;
    ALTER TABLE public.profesores_estados_historial DISABLE TRIGGER impedir_modificar_historial_profesor;
    DELETE FROM public.profesores_estados_historial
      WHERE profesor_id IN ${fixture} OR actor_id IN ${fixture};
    ALTER TABLE public.profesores_estados_historial ENABLE TRIGGER impedir_modificar_historial_profesor;
    DELETE FROM public.matriculas WHERE alumno_id IN ${fixture};
    DELETE FROM public.alumnos WHERE perfil_id IN ${fixture};
    DELETE FROM public.padres_hijos WHERE padre_id IN ${fixture} OR hijo_id IN ${fixture};
    DELETE FROM public.profesores WHERE perfil_id IN ${fixture};
    DELETE FROM public.perfiles WHERE dni LIKE '${prefijoDni}%';
    ${curso ? `DELETE FROM public.cursos WHERE denominacion = '${curso}';` : ''}
    COMMIT;
    DELETE FROM auth.users WHERE email LIKE '${prefijoCorreo}%@${dominio}';
  `)
}

// ================================================================
// Auth
// ================================================================
/** Crea una cuenta con su perfil por el mismo camino que el alta (migración 010). */
export async function crearCuentaConPerfil(local, { email, password, perfil }) {
  const respuesta = await fetch(`${local.API_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: local.SERVICE_ROLE_KEY,
      authorization: `Bearer ${local.SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      app_metadata: {
        ept_alta: {
          telefono: null, direccion: null, legajo_nro: null, ...perfil,
        },
      },
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!respuesta.ok) throw new Error(`no se pudo sembrar una cuenta (${respuesta.status})`)
  const cuerpo = await respuesta.json()
  return cuerpo.id
}

/** Inicia sesión con contraseña. Devuelve el estado HTTP y, si hubo éxito, la sesión. */
export async function iniciarSesion(local, email, password) {
  const respuesta = await fetch(`${local.API_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: local.ANON_KEY },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(10_000),
  })
  const cuerpo = await respuesta.json().catch(() => null)
  return { estado: respuesta.status, sesion: respuesta.ok ? cuerpo : null, codigo: cuerpo?.error_code ?? cuerpo?.code ?? null }
}

export async function exigirSesion(local, email, password) {
  const r = await iniciarSesion(local, email, password)
  if (!r.sesion) throw new Error(`no se pudo iniciar sesión en una cuenta de la suite (${r.estado})`)
  return r.sesion
}

export async function renovarSesion(local, refreshToken) {
  const respuesta = await fetch(`${local.API_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: local.ANON_KEY },
    body: JSON.stringify({ refresh_token: refreshToken }),
    signal: AbortSignal.timeout(10_000),
  })
  const cuerpo = await respuesta.json().catch(() => null)
  return { estado: respuesta.status, codigo: cuerpo?.error_code ?? cuerpo?.code ?? null }
}

/** Cookie de sesión tal como la escribe `@supabase/ssr` para un anfitrión 127.0.0.1. */
export function cookieDe(sesion) {
  const valor = Buffer.from(JSON.stringify(sesion), 'utf8').toString('base64')
  return `sb-127-auth-token=base64-${valor}`
}

/** Petición a PostgREST con un JWT (o anónima con `null`). */
export async function rest(local, token, ruta, { method = 'GET', body, headers = {} } = {}) {
  const respuesta = await fetch(`${local.API_URL}/rest/v1/${ruta}`, {
    method,
    headers: {
      apikey: local.ANON_KEY,
      authorization: `Bearer ${token ?? local.ANON_KEY}`,
      'content-type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  })
  const texto = await respuesta.text()
  let cuerpo = null
  try {
    cuerpo = JSON.parse(texto)
  } catch {
    cuerpo = null
  }
  return { estado: respuesta.status, cuerpo, texto, cabeceras: respuesta.headers }
}

export const rpc = (local, token, funcion, argumentos = {}) =>
  rest(local, token, `rpc/${funcion}`, { method: 'POST', body: argumentos })

// ================================================================
// Intermediario con planes por petición
// ================================================================
/**
 * Intermediario delante de Supabase. Cada plan tiene un predicado sobre
 * `{ metodo, ruta }` y una acción; el primer plan que coincide se consume.
 *
 * Acciones: `fallar` (502 sin reenviar), `perder-respuesta` (reenvía, espera la
 * respuesta real y devuelve 502) y `retener` (no reenvía hasta que se resuelve
 * la promesa `hasta`; simula una escritura en Auth que llega tarde).
 */
export function crearIntermediario(origen) {
  const arriba = new URL(origen)
  const planes = []
  const tareas = new Set()
  const registro = []

  async function reenviar(peticion, cuerpo) {
    const respuesta = await fetch(`${arriba.origin}${peticion.url}`, {
      method: peticion.method,
      headers: { ...peticion.headers, host: arriba.host },
      body: ['GET', 'HEAD'].includes(peticion.method) ? undefined : cuerpo,
      signal: AbortSignal.timeout(30_000),
    })
    return { respuesta, contenido: Buffer.from(await respuesta.arrayBuffer()) }
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

  const servidor = http.createServer((peticion, salida) => {
    const trozos = []
    peticion.on('data', (t) => trozos.push(t))
    peticion.on('end', () => {
      const cuerpo = Buffer.concat(trozos)
      const ruta = (peticion.url ?? '').split('?')[0]
      const pedido = { metodo: peticion.method, ruta }
      const indice = planes.findIndex((p) => p.coincide(pedido))
      const plan = indice >= 0 ? planes.splice(indice, 1)[0] : null
      registro.push(`${peticion.method} ${ruta}`)

      const tarea = (async () => {
        try {
          if (plan?.accion === 'fallar') {
            plan.avisar?.('aplicado')
            responder502(salida)
            return
          }
          if (plan?.accion === 'retener') {
            plan.avisar?.('retenido')
            await plan.hasta
          }
          const r = await reenviar(peticion, cuerpo)
          if (plan?.accion === 'perder-respuesta') {
            plan.avisar?.(r.respuesta.status)
            responder502(salida)
            return
          }
          responder(salida, r)
        } catch {
          responder502(salida)
        }
      })()
      tareas.add(tarea)
      tarea.finally(() => tareas.delete(tarea))
    })
  })

  return {
    registro,
    /** Agrega un plan; devuelve una promesa que se resuelve cuando se aplica. */
    planear(accion, coincide, { hasta } = {}) {
      let avisar
      const aplicado = new Promise((resolver) => { avisar = resolver })
      planes.push({ accion, coincide, avisar, hasta })
      return aplicado
    },
    pendientes: () => planes.length,
    descartarPlanes: () => { planes.length = 0 },
    async escuchar(puerto) {
      await new Promise((resolver, rechazar) => {
        servidor.once('error', rechazar)
        servidor.listen(puerto, '127.0.0.1', resolver)
      })
    },
    async cerrar() {
      await Promise.allSettled([...tareas])
      servidor.closeAllConnections()
      await new Promise((resolver) => servidor.close(() => resolver()))
    },
  }
}

// ================================================================
// Servidor de Next
// ================================================================
export async function puertoLibre(puerto) {
  try {
    await fetch(`http://127.0.0.1:${puerto}/`, { signal: AbortSignal.timeout(1500) })
    return false
  } catch {
    return true
  }
}

/**
 * Levanta `next dev` en un puerto con exactamente las variables indicadas
 * (más las del sistema que Node necesita). El registro completo queda en
 * memoria para buscar filtraciones.
 */
export function crearServidorNext(puerto) {
  let proceso = null
  const estado = { registro: '' }

  return {
    url: `http://127.0.0.1:${puerto}`,
    get registro() { return estado.registro },
    async iniciar(variables) {
      if (!(await puertoLibre(puerto))) {
        throw new Error(`el puerto ${puerto} ya está ocupado; se mediría otro servidor`)
      }
      const env = Object.fromEntries(Object.entries({
        PATH: process.env.PATH,
        SYSTEMROOT: process.env.SYSTEMROOT,
        COMSPEC: process.env.COMSPEC,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        NODE_ENV: 'development',
        NEXT_TELEMETRY_DISABLED: '1',
        ...variables,
      }).filter(([, valor]) => valor !== undefined))
      proceso = spawn(process.execPath, [CLI_NEXT, 'dev', '--port', String(puerto)], {
        cwd: RAIZ,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        windowsHide: true,
      })
      proceso.stdout.on('data', (t) => { estado.registro += t })
      proceso.stderr.on('data', (t) => { estado.registro += t })

      for (let i = 0; i < 150; i += 1) {
        if (proceso.exitCode !== null) break
        try {
          const r = await fetch(`http://127.0.0.1:${puerto}/login`, {
            redirect: 'manual',
            signal: AbortSignal.timeout(3000),
          })
          if (r.status > 0) return
        } catch {
          // Todavía no atiende.
        }
        await esperar(1000)
      }
      throw new Error('el servidor de la aplicación no llegó a atender peticiones')
    },
    async detener() {
      const actual = proceso
      proceso = null
      await detenerArbol(actual)
    },
  }
}

/** Petición a la API de la aplicación. */
export async function api(servidor, ruta, { method = 'GET', cookie, body, limiteMs = 60_000 } = {}) {
  const respuesta = await fetch(`${servidor.url}${ruta}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
    signal: AbortSignal.timeout(limiteMs),
  })
  const texto = await respuesta.text()
  let cuerpo = null
  try {
    cuerpo = JSON.parse(texto)
  } catch {
    cuerpo = null
  }
  return {
    estado: respuesta.status,
    cuerpo,
    texto,
    cacheControl: respuesta.headers.get('cache-control'),
    allow: respuesta.headers.get('allow'),
  }
}

// ================================================================
// Guardia de filtraciones en las respuestas
// ================================================================
const FRAGMENTOS_TECNICOS = [
  /\bP\d{4}\b/u,
  /\b(?:23505|23514|23503|42501|42P01|40001|57014)\b/u,
  /PGRST\d{3}/u,
  /permission denied|duplicate key|violates|constraint|\brelation\b/iu,
  /unexpected_failure|email_exists|user_already_exists|validation_failed|user_banned/iu,
  /auth\.users|app_metadata|ept_vinculo|ept_alta|raw_app_meta_data|cuenta_id|desafio_hash/iu,
  /https?:\/\//iu,
  /\bat [\w.<>]+ \(/u,
  /supabase|postgres|postgrest|gotrue|service_role/iu,
  /eyJ[A-Za-z0-9_-]{10,}/u,
]

export function detalleTecnicoEn(texto) {
  return FRAGMENTOS_TECNICOS.find((patron) => patron.test(texto)) ?? null
}
