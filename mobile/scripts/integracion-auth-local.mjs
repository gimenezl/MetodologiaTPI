// Integración real con GoTrue/PostgREST y RLS sobre un proyecto local efímero.
// SERVICE_ROLE_KEY solo se usa para crear/restaurar fixtures sintéticos en este proceso.
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { esperarBearerExpirado, mensajeFalloEtapaAuth, validarLineaBaseExpiracion } from './integracion-auth-utils.mjs'

const root = resolve(import.meta.dirname, '../..')
const workdir = process.env.EPT_MOBILE_SUPABASE_WORKDIR
const safeTimeout = 15_000
const localOnly = new Set(['127.0.0.1', 'localhost'])

function runStatus() {
  assert.ok(process.env.EPT_SUPABASE_CLI_ENTRY, 'Falta la CLI Supabase aislada.')
  const stdout = execFileSync('python3', [resolve(root, 'scripts/ci/run-stage.py'), '--stage', 'auth-status', '--seconds', '30', '--capture', '--', process.execPath, process.env.EPT_SUPABASE_CLI_ENTRY, 'status', '-o', 'env', '--workdir', workdir], {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  })
  const env = {}
  for (const line of stdout.split(/\r?\n/u)) {
    const m = /^([A-Z0-9_]+)="?(.*?)"?$/u.exec(line.trim())
    if (m) env[m[1]] = m[2]
  }
  const url = new URL(env.API_URL ?? '')
  assert.equal(url.protocol, 'http:', 'El endpoint de Auth debe ser local y HTTP.')
  assert.ok(localOnly.has(url.hostname), 'El endpoint no está en loopback.')
  assert.equal(url.port, '54321', 'El endpoint no usa el puerto efímero fijado.')
  assert.ok(env.ANON_KEY && env.SERVICE_ROLE_KEY, 'Faltan claves locales emitidas por Supabase.')
  return { api: env.API_URL, anon: env.ANON_KEY, service: env.SERVICE_ROLE_KEY }
}

let local
let etapaActual = 'estadoStack'
const timeoutSignal = timeoutMs => AbortSignal.timeout(timeoutMs)

async function respuesta(path, { key = local.anon, token, method = 'GET', body, prefer, timeoutMs = safeTimeout } = {}) {
  const headers = { apikey: key }
  if (token) headers.authorization = `Bearer ${token}`
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (prefer) headers.prefer = prefer
  let response
  try {
    response = await fetch(`${local.api}${path}`, {
      method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: timeoutSignal(timeoutMs),
    })
  } catch {
    throw new Error('No se pudo completar una petición al stack local de integración.')
  }
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { /* El cuerpo nunca se imprime. */ }
  return { status: response.status, data }
}

function exigirStatus(result, allowed, label) {
  assert.ok(allowed.includes(result.status), `${label}: estado HTTP inesperado (${result.status}).`)
  return result.data
}

async function authAdmin(path, method, body) {
  return exigirStatus(await respuesta(path, {
    key: local.service, token: local.service, method, body,
  }), method === 'POST' ? [200, 201] : [200, 204], 'Preparación sintética de Auth')
}

async function restAdmin(path, method, body, prefer) {
  return exigirStatus(await respuesta(`/rest/v1/${path}`, {
    key: local.service, token: local.service, method, body, prefer,
  }), [200, 201, 204], 'Preparación sintética de datos')
}

const idSuffix = () => randomBytes(4).toString('hex')
const dniSuffix = () => String(10_000_000 + Math.floor(Math.random() * 80_000_000))
const actors = []

async function crearActor(rol, { nombre = 'Prueba', userRole = 'PERSONAL', legajo = false } = {}) {
  const suffix = idSuffix()
  const email = `ept105-${suffix}@ept105.invalid`
  const password = `${randomBytes(30).toString('base64url')}A1!`
  const roles = await restAdmin(`roles?select=id&nombre=eq.${encodeURIComponent(rol)}`, 'GET')
  assert.equal(roles?.length, 1, `No existe exactamente un rol local ${rol}.`)
  const alta = {
    nombre, apellido: `EPT105-${suffix}`, dni: dniSuffix(), rol_id: roles[0].id,
    telefono: null, direccion: null, legajo_nro: legajo ? `E105-${suffix.toUpperCase()}` : null,
  }
  const created = await authAdmin('/auth/v1/admin/users', 'POST', {
    email, password, email_confirm: true,
    app_metadata: { ept_alta: alta },
    user_metadata: { role: userRole, estado_acceso: 'HABILITADO', display_role: userRole },
  })
  assert.equal(typeof created?.id, 'string', 'Auth no devolvió el campo raíz id esperado.')
  assert.match(created.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu, 'Auth devolvió un id con formato inesperado.')
  const actor = { id: created.id, email, password, rol }
  actor.legajoNro = alta.legajo_nro
  actors.push(actor)
  const profiles = await restAdmin(`perfiles?select=id&user_id=eq.${actor.id}`, 'GET')
  assert.equal(profiles?.length, 1, `El perfil transaccional no se creó para el rol ${rol}.`)
  actor.profileId = profiles[0].id
  return actor
}

async function iniciar(actor) {
  const result = exigirStatus(await respuesta('/auth/v1/token?grant_type=password', {
    method: 'POST', body: { email: actor.email, password: actor.password },
  }), [200], 'Inicio de sesión local')
  assert.ok(result.access_token && result.refresh_token, 'Auth no devolvió tokens de sesión.')
  return result
}

async function rpc(actor, nombre) {
  const session = actor.access_token ? actor : await iniciar(actor)
  const result = exigirStatus(await respuesta(`/rest/v1/rpc/${nombre}`, {
    method: 'POST', token: session.access_token, body: {},
  }), [200], `RPC ${nombre}`)
  return result
}

async function idsVisibles(actor, tabla = 'perfiles', columna = 'id') {
  const session = actor.access_token ? actor : await iniciar(actor)
  return exigirStatus(await respuesta(`/rest/v1/${tabla}?select=${columna}`, {
    token: session.access_token,
  }), [200], `Lectura RLS ${tabla}`).map(row => row[columna])
}

async function comprobarAuthUsuario(actor, expectedUserRole = actor.rol) {
  const session = await iniciar(actor)
  const user = exigirStatus(await respuesta('/auth/v1/user', { token: session.access_token }), [200], 'Validación remota de identidad')
  assert.equal(user.id, actor.id)
  assert.equal(user.user_metadata?.role, expectedUserRole)
  assert.equal(await rpc({ ...actor, ...session }, 'mi_estado_acceso'), 'HABILITADO')
  assert.equal(await rpc({ ...actor, ...session }, 'rol_actual'), actor.rol)
  actor.access_token = session.access_token
  return session
}

function ok(label) { console.log(`OK ${label}`) }

async function ejecutar() {
  const rols = ['DIRECTOR', 'DOCENTE', 'PADRE', 'ESTUDIANTE', 'PERSONAL']
  const roleActors = {}
  etapaActual = 'fixtures'
  for (const rol of rols) {
    roleActors[rol] = await crearActor(rol, { userRole: rol, legajo: rol === 'ESTUDIANTE' })
  }

  const padreA = await crearActor('PADRE', { userRole: 'DIRECTOR' })
  const padreB = await crearActor('PADRE', { userRole: 'ESTUDIANTE' })
  const estudianteA = roleActors.ESTUDIANTE
  const estudianteB = await crearActor('ESTUDIANTE', { userRole: 'PADRE', legajo: true })
  const estudianteSinVinculo = await crearActor('ESTUDIANTE', { userRole: 'DIRECTOR', legajo: true })
  const bloqueada = await crearActor('PADRE')
  const sinPerfil = await crearActor('PADRE')
  const desconocido = await crearActor('PADRE')
  const expiracion = await crearActor('PADRE')

  await restAdmin('padres_hijos', 'POST', [
    { padre_id: padreA.profileId, hijo_id: estudianteA.profileId },
    { padre_id: padreB.profileId, hijo_id: estudianteB.profileId },
  ], 'return=minimal')

  const rolDesconocido = exigirStatus(await respuesta('/rest/v1/roles', {
    key: local.service, token: local.service, method: 'POST',
    body: { nombre: `EPT105_${idSuffix()}` }, prefer: 'return=representation',
  }), [201], 'Alta de rol sintético desconocido')?.[0]
  assert.ok(rolDesconocido?.id, 'No se creó el rol desconocido efímero.')
  await restAdmin(`perfiles?user_id=eq.${desconocido.id}`, 'PATCH', { rol_id: rolDesconocido.id }, 'return=minimal')
  await restAdmin(`perfiles?user_id=eq.${bloqueada.id}`, 'PATCH', { estado_acceso: 'BLOQUEADO' }, 'return=minimal')
  await restAdmin(`perfiles?user_id=eq.${sinPerfil.id}`, 'DELETE', undefined, 'return=minimal')

  etapaActual = 'roles'
  for (const rol of rols) {
    const actor = roleActors[rol]
    const session = await comprobarAuthUsuario(actor, rol)
    assert.ok(session.access_token)
  }
  const sesionManipulada = await iniciar(padreA)
  const usuarioManipulado = exigirStatus(await respuesta('/auth/v1/user', { token: sesionManipulada.access_token }), [200], 'Lectura de metadata manipulada')
  assert.equal(usuarioManipulado.user_metadata?.role, 'DIRECTOR')
  assert.equal(await rpc({ ...padreA, ...sesionManipulada }, 'rol_actual'), 'PADRE')
  ok('Auth remoto, perfil, estado y rol de los cinco roles; user_metadata editable no altera el rol vigente.')

  etapaActual = 'rlsPadres'
  const padreSession = await iniciar(padreA)
  const visibleFamiliaA = await idsVisibles({ ...padreA, ...padreSession })
  assert.ok(visibleFamiliaA.includes(padreA.profileId))
  assert.ok(visibleFamiliaA.includes(estudianteA.profileId))
  assert.ok(!visibleFamiliaA.includes(padreB.profileId))
  assert.ok(!visibleFamiliaA.includes(estudianteB.profileId))
  assert.ok(!visibleFamiliaA.includes(estudianteSinVinculo.profileId))
  const vinculosA = exigirStatus(await respuesta('/rest/v1/padres_hijos?select=padre_id,hijo_id', {
    token: padreSession.access_token,
  }), [200], 'Vínculos de PADRE bajo RLS')
  assert.deepEqual(vinculosA.map(row => row.hijo_id), [estudianteA.profileId])
  const alumnosAcademicosPadre = exigirStatus(await respuesta('/rest/v1/alumnos_academicos?select=id,legajo_nro', {
    token: padreSession.access_token,
  }), [200], 'Vista académica de PADRE bajo RLS')
  assert.deepEqual(alumnosAcademicosPadre, [{ id: estudianteA.profileId, legajo_nro: estudianteA.legajoNro }],
    'PADRE debe consultar en alumnos_academicos solo el legajo de su hijo vinculado.')

  const padreBSesion = await iniciar(padreB)
  const visibleFamiliaB = await idsVisibles({ ...padreB, ...padreBSesion })
  assert.ok(visibleFamiliaB.includes(estudianteB.profileId))
  assert.ok(!visibleFamiliaB.includes(estudianteA.profileId))
  assert.ok(!visibleFamiliaB.includes(estudianteSinVinculo.profileId))
  ok('Dos familias vinculadas y un estudiante no vinculado: los padres no cruzan el límite RLS.')

  etapaActual = 'rlsEstudiante'
  const sesionEstudiante = await iniciar(estudianteA)
  const perfilesEstudiante = await idsVisibles({ ...estudianteA, ...sesionEstudiante })
  assert.deepEqual(perfilesEstudiante, [estudianteA.profileId])
  const alumnosEstudiante = await idsVisibles({ ...estudianteA, ...sesionEstudiante }, 'alumnos', 'perfil_id')
  assert.deepEqual(alumnosEstudiante, [estudianteA.profileId])
  const linksComoHijo = exigirStatus(await respuesta('/rest/v1/padres_hijos?select=padre_id,hijo_id', {
    token: sesionEstudiante.access_token,
  }), [200], 'Vínculo propio de ESTUDIANTE')
  assert.deepEqual(linksComoHijo.map(row => row.hijo_id), [estudianteA.profileId])
  const anon = await respuesta('/rest/v1/perfiles?select=id', { token: undefined })
  assert.ok([200, 401, 403].includes(anon.status))
  if (anon.status === 200) assert.deepEqual(anon.data, [])
  ok('ESTUDIANTE consulta solo su perfil/legajo; la API anónima no lee perfiles.')

  etapaActual = 'estadosAcceso'
  const sesionBloqueada = await iniciar(bloqueada)
  assert.equal(await rpc({ ...bloqueada, ...sesionBloqueada }, 'mi_estado_acceso'), 'BLOQUEADO')
  assert.equal(await rpc({ ...bloqueada, ...sesionBloqueada }, 'rol_actual'), null)
  assert.deepEqual(await idsVisibles({ ...bloqueada, ...sesionBloqueada }), [])

  const sesionSinPerfil = await iniciar(sinPerfil)
  assert.equal(await rpc({ ...sinPerfil, ...sesionSinPerfil }, 'mi_estado_acceso'), 'SIN_PERFIL')
  assert.equal(await rpc({ ...sinPerfil, ...sesionSinPerfil }, 'rol_actual'), null)

  const sesionDesconocida = await iniciar(desconocido)
  assert.equal(await rpc({ ...desconocido, ...sesionDesconocida }, 'mi_estado_acceso'), 'HABILITADO')
  assert.equal(await rpc({ ...desconocido, ...sesionDesconocida }, 'rol_actual'), rolDesconocido.nombre)
  assert.deepEqual(await idsVisibles({ ...desconocido, ...sesionDesconocida }), [desconocido.profileId])
  ok('JWT bloqueado, perfil ausente y rol no soportado quedan autenticados pero sin autorización ampliada.')

  etapaActual = 'refresh'
  const sesionRefreshable = await iniciar(padreA)
  const refrescada = exigirStatus(await respuesta('/auth/v1/token?grant_type=refresh_token', {
    method: 'POST', body: { refresh_token: sesionRefreshable.refresh_token },
  }), [200], 'Refresco real de Auth')
  const usuarioRefresh = exigirStatus(await respuesta('/auth/v1/user', { token: refrescada.access_token }), [200], 'Identidad después del refresh')
  assert.equal(usuarioRefresh.id, padreA.id)
  assert.ok(refrescada.expires_at >= sesionRefreshable.expires_at, 'El refresh no renovó la vigencia reportada de la sesión.')
  assert.equal(await rpc({ ...padreA, ...refrescada }, 'rol_actual'), 'PADRE')
  ok('Refresh token real emitido por GoTrue renueva la sesión sin cambiar el rol de base.')

  etapaActual = 'expiracion'
  const sesionExpirable = await iniciar(expiracion)
  const [, carga] = sesionExpirable.access_token.split('.')
  const exp = JSON.parse(Buffer.from(carga, 'base64url').toString('utf8')).exp
  etapaActual = 'identidadInicial'
  const identidadInicial = await respuesta('/auth/v1/user', {
    token: sesionExpirable.access_token, timeoutMs: 5_000,
  })
  validarLineaBaseExpiracion(exp, identidadInicial.status)
  assert.equal(identidadInicial.data?.id, expiracion.id, 'La sesión recién emitida no corresponde al fixture esperado.')
  const demora = Math.max(0, exp * 1000 - Date.now())
  etapaActual = 'esperaExp'
  if (demora > 0) await new Promise(resolve => setTimeout(resolve, demora))
  etapaActual = 'sondeoExp'
  const comprobacionesExpiracion = await esperarBearerExpirado(() => respuesta('/auth/v1/user', {
    token: sesionExpirable.access_token, timeoutMs: 5_000,
  }).then(result => result.status), {
    registrarIntento: ({ intento, estado }) => console.log(`Sondeo de expiración: intento ${intento}, estado HTTP ${estado ?? 'desconocido'}.`),
  })
  etapaActual = 'refreshExpirado'
  const recuperada = exigirStatus(await respuesta('/auth/v1/token?grant_type=refresh_token', {
    method: 'POST', body: { refresh_token: sesionExpirable.refresh_token },
  }), [200], 'Refresh de sesión después de expirar access token')
  assert.equal(await rpc({ ...expiracion, ...recuperada }, 'rol_actual'), 'PADRE')
  etapaActual = 'logoutExpirado'
  exigirStatus(await respuesta('/auth/v1/logout?scope=global', {
    method: 'POST', token: recuperada.access_token,
  }), [204], 'Revocación global de fixture efímero')
  etapaActual = 'refreshRevocado'
  assert.ok([400, 401].includes((await respuesta('/auth/v1/token?grant_type=refresh_token', {
    method: 'POST', body: { refresh_token: recuperada.refresh_token },
  })).status), 'El refresh token revocado volvió a emitir sesión.')
  ok(`La identidad rechazó el access token tras ${comprobacionesExpiracion} comprobaciones; refresh válido y logout global revocan la sesión.`)

  etapaActual = 'exportacion'
  const githubEnv = process.env.GITHUB_ENV
  assert.ok(githubEnv, 'Las credenciales efímeras solo se exportan a un runner GitHub.')
  const actorMaestro = [
    ['MAESTRO_PADRE', padreA],
    ['MAESTRO_ESTUDIANTE', roleActors.ESTUDIANTE],
    ['MAESTRO_DOCENTE', roleActors.DOCENTE],
  ]
  const invalid = { email: `ept105-invalid-${idSuffix()}@ept105.invalid`, password: `${randomBytes(30).toString('base64url')}A1!` }
  for (const [prefix, actor] of [...actorMaestro, ['MAESTRO_INVALIDO', invalid]]) {
    console.log(`::add-mask::${actor.email}`)
    console.log(`::add-mask::${actor.password}`)
    appendFileSync(githubEnv, `${prefix}_EMAIL=${actor.email}\n${prefix}_PASSWORD=${actor.password}\n`)
  }
}

try {
  assert.ok(workdir, 'Falta el identificador del Supabase efímero local.')
  etapaActual = 'estadoStack'
  local = runStatus()
  await ejecutar()
} catch (_error) {
  // No imprimir objetos de proveedor ni trazas: pueden incluir credenciales o material JWT.
  console.error(mensajeFalloEtapaAuth(etapaActual))
  process.exitCode = 1
}
