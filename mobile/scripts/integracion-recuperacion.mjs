// Integración real de EPT-106: recuperación y cambio de contraseña contra GoTrue y Mailpit locales.
//
// Qué prueba (todo sobre el stack descartable, nunca producción):
//   1. solicitud real a GoTrue y correo capturado por Mailpit;
//   2. extracción controlada del enlace (sin imprimirlo) y retorno a la app por el esquema propio;
//   3. canje PKCE con el MISMO código de la aplicación (`src/servicios/recuperacion.ts`, ejecutado tal cual);
//   4. cambio de contraseña, login con la nueva, rechazo de la anterior;
//   5. identidades de usuario/perfil/rol/vínculos conservadas y sin duplicados;
//   6. correo inexistente sin enumeración, enlace inválido/vencido/reutilizado, falta de verificador, falla de red,
//      otra cuenta con sesión iniciada, cambio desde el perfil y reautenticación.
//
// La SERVICE_ROLE_KEY solo se usa para crear y retirar fixtures sintéticos y para retroceder relojes de tokens
// en el stack efímero (simulación de vencimiento, documentada); la aceptación nunca depende de ella.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { createClient } from '@supabase/supabase-js'

import {
  DESTINO_RECUPERACION,
  actualizarContrasena,
  intercambiarCodigo,
  interpretarEnlace,
  pedirCodigoDeVerificacion,
  solicitarRecuperacion,
} from '../src/servicios/recuperacion.ts'
import { contenedorDb } from './integracion-cuotas.mjs'
import {
  borrarCorreos,
  confirmarSinCorreo,
  describirRetorno,
  esperarCorreo,
  extraerEnlaceDeVerificacion,
  resolverRetornoDeApp,
  validarMailpitLocal,
} from './recuperacion-utils.mjs'

const raiz = resolve(import.meta.dirname, '../..')
const workdir = process.env.EPT_MOBILE_SUPABASE_WORKDIR
const anfitrionesLocales = new Set(['127.0.0.1', 'localhost'])
let local
let etapa = 'estadoStack'
const actores = []

function entornoManual() {
  const api = process.env.EPT_RECUPERACION_API_URL
  if (!api) return null
  return {
    api,
    anon: process.env.EPT_RECUPERACION_ANON_KEY,
    service: process.env.EPT_RECUPERACION_SERVICE_KEY,
    mailpit: process.env.EPT_RECUPERACION_MAILPIT_URL,
  }
}

function entornoDelStack() {
  const manual = entornoManual()
  if (manual) return manual
  assert.ok(process.env.EPT_SUPABASE_CLI_ENTRY, 'Falta la CLI Supabase aislada.')
  assert.ok(workdir, 'Falta el identificador del Supabase efímero local.')
  const salida = execFileSync('python3', [resolve(raiz, 'scripts/ci/run-stage.py'), '--stage', 'recovery-status', '--seconds', '30', '--capture', '--',
    process.execPath, process.env.EPT_SUPABASE_CLI_ENTRY, 'status', '-o', 'env', '--workdir', workdir], {
    cwd: raiz, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  })
  const env = {}
  for (const linea of salida.split(/\r?\n/u)) {
    const m = /^([A-Z0-9_]+)="?(.*?)"?$/u.exec(linea.trim())
    if (m) env[m[1]] = m[2]
  }
  return { api: env.API_URL, anon: env.ANON_KEY, service: env.SERVICE_ROLE_KEY, mailpit: env.MAILPIT_URL ?? env.INBUCKET_URL }
}

function validarEntorno(entorno) {
  const api = new URL(entorno.api ?? '')
  assert.equal(api.protocol, 'http:', 'El endpoint de Auth debe ser local y HTTP.')
  assert.ok(anfitrionesLocales.has(api.hostname), 'El endpoint no está en loopback.')
  assert.ok(entorno.anon && entorno.service, 'Faltan claves locales emitidas por Supabase.')
  assert.ok(entorno.mailpit, 'El stack no expone Mailpit: este perfil de pruebas lo necesita.')
  validarMailpitLocal(entorno.mailpit)
  return { ...entorno, api: entorno.api.replace(/\/$/u, ''), mailpit: entorno.mailpit.replace(/\/$/u, '') }
}

// ---- Acceso a datos de fixtures (service_role solo para preparar) ---------------------------------------

async function http(ruta, { key = local.anon, token, method = 'GET', body, prefer } = {}) {
  const cabeceras = { apikey: key }
  if (token) cabeceras.authorization = `Bearer ${token}`
  if (body !== undefined) cabeceras['content-type'] = 'application/json'
  if (prefer) cabeceras.prefer = prefer
  const respuesta = await fetch(`${local.api}${ruta}`, {
    method, headers: cabeceras, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
  })
  const texto = await respuesta.text()
  let data = null
  try { data = texto ? JSON.parse(texto) : null } catch { /* El cuerpo nunca se imprime. */ }
  return { status: respuesta.status, data }
}

const admin = (ruta, method = 'GET', body, prefer) => http(ruta, { key: local.service, token: local.service, method, body, prefer })

function exigir(resultado, permitidos, etiqueta) {
  assert.ok(permitidos.includes(resultado.status), `${etiqueta}: estado HTTP inesperado (${resultado.status}).`)
  return resultado.data
}

const sufijo = () => randomBytes(4).toString('hex')
const dni = () => String(10_000_000 + Math.floor(Math.random() * 80_000_000))
const contrasenaAleatoria = () => `${randomBytes(30).toString('base64url')}A1!`

async function crearActor(rol, { legajo = false } = {}) {
  const s = sufijo()
  const email = `ept106-${s}@ept106.invalid`
  const password = contrasenaAleatoria()
  const roles = exigir(await admin(`/rest/v1/roles?select=id&nombre=eq.${encodeURIComponent(rol)}`), [200], 'Lectura del rol')
  assert.equal(roles?.length, 1, `No existe exactamente un rol local ${rol}.`)
  const alta = { nombre: 'Prueba', apellido: `EPT106-${s}`, dni: dni(), rol_id: roles[0].id, telefono: null, direccion: null, legajo_nro: legajo ? `E106-${s.toUpperCase()}` : null }
  const creado = exigir(await admin('/auth/v1/admin/users', 'POST', {
    email, password, email_confirm: true, app_metadata: { ept_alta: alta },
    user_metadata: { role: rol, estado_acceso: 'HABILITADO', display_role: rol },
  }), [200, 201], 'Alta sintética')
  assert.match(creado.id, /^[0-9a-f-]{36}$/iu)
  const perfiles = exigir(await admin(`/rest/v1/perfiles?select=id,rol_id&user_id=eq.${creado.id}`), [200], 'Perfil del actor')
  assert.equal(perfiles?.length, 1, 'El alta transaccional no creó el perfil.')
  const actor = { id: creado.id, email, password, rol, perfilId: perfiles[0].id, rolId: perfiles[0].rol_id }
  actores.push(actor)
  return actor
}

async function usuariosConCorreo(email) {
  const lista = exigir(await admin('/auth/v1/admin/users?per_page=1000'), [200], 'Listado de usuarios')
  return (lista.users ?? []).filter(u => u.email === email)
}

async function instantanea(actor) {
  const perfiles = exigir(await admin(`/rest/v1/perfiles?select=id,user_id,rol_id,estado_acceso&user_id=eq.${actor.id}`), [200], 'Perfiles')
  const vinculos = exigir(await admin(`/rest/v1/padres_hijos?select=padre_id,hijo_id&or=(padre_id.eq.${actor.perfilId},hijo_id.eq.${actor.perfilId})&order=padre_id,hijo_id`), [200], 'Vínculos')
  const usuarios = await usuariosConCorreo(actor.email)
  return { perfiles, vinculos, usuarios: usuarios.map(u => u.id) }
}

function sql(texto) {
  const contenedor = process.env.EPT_RECUPERACION_DB_CONTAINER ?? contenedorDb(workdir)
  return execFileSync('docker', ['exec', '-i', contenedor, 'psql', '-X', '-q', '-A', '-t', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
    input: texto, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  }).trim()
}

// ---- Cliente equivalente al de la app -------------------------------------------------------------------

/** Mismas opciones que `crearClienteSupabase` (la prueba de Jest fija flowType y detectSessionInUrl). */
function crearClienteApp(url = local.api) {
  const memoria = new Map()
  const cliente = createClient(url, local.anon, {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storage: {
        getItem: clave => memoria.get(clave) ?? null,
        setItem: (clave, valor) => { memoria.set(clave, valor) },
        removeItem: clave => { memoria.delete(clave) },
      },
    },
  })
  const eventos = []
  cliente.auth.onAuthStateChange(evento => { eventos.push(evento) })
  return { cliente, eventos, memoria }
}

async function pedirEnlace(app, actor, { desdeCorreo = true } = {}) {
  await borrarCorreos(local.mailpit, actor.email)
  const solicitud = await solicitarRecuperacion(app.cliente.auth, actor.email)
  assert.equal(solicitud.tipo, 'enviada', 'La solicitud real a GoTrue no fue aceptada.')
  if (!desdeCorreo) return null
  const correo = await esperarCorreo(local.mailpit, actor.email)
  const enlace = extraerEnlaceDeVerificacion(correo, local.api)
  assert.equal(new URL(enlace).searchParams.get('redirect_to'), DESTINO_RECUPERACION, 'GoTrue no respetó el destino exacto de la app.')
  assert.equal(new URL(enlace).searchParams.get('type'), 'recovery')
  return enlace
}

async function iniciarSesion(email, password) {
  return http('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } })
}

async function rpc(token, nombre) {
  return exigir(await http(`/rest/v1/rpc/${nombre}`, { method: 'POST', token, body: {} }), [200], `RPC ${nombre}`)
}

function ok(texto) { console.log(`OK ${texto}`) }
function observacion(texto) { console.log(`OBSERVACIÓN ${texto}`) }

// ---- Escenarios ------------------------------------------------------------------------------------------

async function flujoCompleto() {
  etapa = 'flujoCompleto'
  const padre = await crearActor('PADRE')
  const hijo = await crearActor('ESTUDIANTE', { legajo: true })
  exigir(await admin('/rest/v1/padres_hijos', 'POST', [{ padre_id: padre.perfilId, hijo_id: hijo.perfilId }], 'return=minimal'), [201, 204], 'Vínculo sintético')
  const antes = await instantanea(padre)
  assert.equal(antes.usuarios.length, 1)
  assert.equal(antes.vinculos.length, 1)

  // Sesión previa del mismo usuario en otro dispositivo, para documentar cómo se comporta tras el cambio.
  const previa = exigir(await iniciarSesion(padre.email, padre.password), [200], 'Sesión previa')

  const app = crearClienteApp()
  const enlace = await pedirEnlace(app, padre)
  ok('Solicitud real a GoTrue; correo capturado en Mailpit con el destino exacto de la app y type=recovery.')

  const retorno = await resolverRetornoDeApp(enlace)
  const interpretado = interpretarEnlace(retorno)
  assert.equal(interpretado.tipo, 'codigo', `El retorno no es un enlace de recuperación válido: ${describirRetorno(retorno)}`)
  ok(`El retorno de GoTrue (${describirRetorno(retorno)}) es admitido por el parser de la app.`)

  app.eventos.length = 0
  const canje = await intercambiarCodigo(app.cliente.auth, interpretado)
  assert.deepEqual(canje, { tipo: 'ok', usuarioId: padre.id })
  assert.ok(app.eventos.includes('PASSWORD_RECOVERY'), 'El canje no emitió PASSWORD_RECOVERY.')
  assert.ok(!app.eventos.includes('SIGNED_IN'), 'El canje de recuperación se trató como un ingreso ordinario.')
  ok('Canje PKCE con el verificador del dispositivo: se emite PASSWORD_RECOVERY y no SIGNED_IN.')

  const nueva = contrasenaAleatoria()
  app.eventos.length = 0
  assert.deepEqual(await actualizarContrasena(app.cliente.auth, nueva, { usuarioEsperado: padre.id }), { tipo: 'ok' })
  assert.ok(app.eventos.includes('USER_UPDATED'), 'El cambio no emitió USER_UPDATED.')
  await app.cliente.auth.signOut({ scope: 'local' })
  const { data: sinSesion } = await app.cliente.auth.getSession()
  assert.equal(sinSesion.session, null, 'La sesión de recuperación quedó guardada tras cerrar.')
  ok('Cambio de contraseña con Auth (USER_UPDATED) y cierre local de la sesión de recuperación.')

  const conNueva = exigir(await iniciarSesion(padre.email, nueva), [200], 'Login con la contraseña nueva')
  assert.equal(await rpc(conNueva.access_token, 'mi_estado_acceso'), 'HABILITADO')
  assert.equal(await rpc(conNueva.access_token, 'rol_actual'), 'PADRE')
  const conVieja = await iniciarSesion(padre.email, padre.password)
  assert.ok([400, 401, 422].includes(conVieja.status), `La contraseña anterior siguió siendo válida (HTTP ${conVieja.status}).`)
  ok('Login correcto con la contraseña nueva y rechazo de la anterior; el rol y el estado de acceso no cambiaron.')

  const despues = await instantanea(padre)
  assert.deepEqual(despues, antes, 'Cambiaron usuario, perfil, rol o vínculos como efecto de cambiar la contraseña.')
  assert.equal(despues.usuarios.length, 1, 'Hay usuarios duplicados para el mismo correo.')
  ok('Una sola identidad de Auth, mismo perfil, rol, estado y vínculos: nada se duplicó ni se alteró.')

  // Comportamiento real de las sesiones anteriores (se documenta lo observado; no se afirma una revocación).
  const identidad = await http('/auth/v1/user', { token: previa.access_token })
  const refresco = await http('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: previa.refresh_token } })
  observacion(`Tras cambiar la contraseña, el access token previo ${identidad.status === 200 ? 'sigue siendo válido hasta su vencimiento' : `fue rechazado (HTTP ${identidad.status})`}.`)
  observacion(`Tras cambiar la contraseña, el refresh token previo ${refresco.status === 200 ? 'todavía permite renovar la sesión' : `fue rechazado (HTTP ${refresco.status})`}.`)
  return { padre, retorno }
}

async function enlaceReutilizado({ retorno }) {
  etapa = 'enlaceReutilizado'
  // El mismo código ya canjeado: sin el verificador (el SDK lo descartó) no hay forma de reutilizarlo.
  const interpretado = interpretarEnlace(retorno)
  const otraApp = crearClienteApp()
  assert.deepEqual(await intercambiarCodigo(otraApp.cliente.auth, interpretado), { tipo: 'sin_verificador' })
  ok('Un código ya usado, presentado sin su verificador, no abre la recuperación.')

  // Y con verificador presente, GoTrue rechaza el código de un solo uso.
  const actor = await crearActor('PADRE')
  const app = crearClienteApp()
  const enlace = await pedirEnlace(app, actor)
  const codigo = interpretarEnlace(await resolverRetornoDeApp(enlace))
  assert.equal(codigo.tipo, 'codigo')
  const copiaDelEstado = new Map(app.memoria)
  assert.equal((await intercambiarCodigo(app.cliente.auth, codigo)).tipo, 'ok')
  const repetidora = crearClienteApp()
  for (const [clave, valor] of copiaDelEstado) repetidora.memoria.set(clave, valor)
  const repetido = await intercambiarCodigo(repetidora.cliente.auth, codigo)
  assert.equal(repetido.tipo, 'enlace_invalido', 'GoTrue aceptó un código de recuperación por segunda vez.')
  ok('Un código de un solo uso presentado dos veces, aun con el verificador original, es rechazado por Auth.')

  // El enlace del correo (token) tampoco sirve por segunda vez.
  const segundaVisita = await resolverRetornoDeApp(enlace)
  const resultado = interpretarEnlace(segundaVisita)
  assert.equal(resultado.tipo, 'rechazado', `La segunda visita al enlace del correo no fue rechazada: ${describirRetorno(segundaVisita)}`)
  ok(`El enlace del correo ya consumido vuelve con error (${describirRetorno(segundaVisita)}) y la app lo trata como no disponible (${resultado.motivo}).`)
}

async function enlaceInvalidoYSinVerificador() {
  etapa = 'enlaceInvalido'
  const actor = await crearActor('PADRE')
  const app = crearClienteApp()
  const enlace = await pedirEnlace(app, actor)
  const codigoFalso = interpretarEnlace(`${DESTINO_RECUPERACION}?code=${crypto.randomUUID()}`)
  assert.equal(codigoFalso.tipo, 'codigo')
  assert.equal((await intercambiarCodigo(app.cliente.auth, codigoFalso)).tipo, 'enlace_invalido')
  ok('Un código inexistente se rechaza como enlace no disponible.')

  // Falta el verificador: otra instalación (estado vacío) no puede canjear el enlace… y el dueño sí puede después.
  // El canje con el verificador del dueño ya fue consumido arriba por el código falso, así que se pide uno nuevo.
  // Auth limita la frecuencia por usuario (max_frequency = 1 s en el stack local): se respeta antes de volver a pedir.
  await new Promise(resolve => setTimeout(resolve, 1_300))
  const dueña = crearClienteApp()
  const segundoEnlace = await pedirEnlace(dueña, actor)
  const retorno = await resolverRetornoDeApp(segundoEnlace)
  const codigo = interpretarEnlace(retorno)
  assert.equal(codigo.tipo, 'codigo')
  const ajena = crearClienteApp()
  assert.deepEqual(await intercambiarCodigo(ajena.cliente.auth, codigo), { tipo: 'sin_verificador' })
  assert.deepEqual(await intercambiarCodigo(dueña.cliente.auth, codigo), { tipo: 'ok', usuarioId: actor.id })
  ok('Sin el verificador de la instalación el enlace no se canjea (y no se consume): la instalación que lo pidió sí puede.')
  void enlace
}

async function enlaceVencido() {
  etapa = 'enlaceVencido'
  const actor = await crearActor('PADRE')
  const app = crearClienteApp()
  const enlace = await pedirEnlace(app, actor)
  // Simulación local y documentada: se retrocede el reloj del token para no esperar el vencimiento real.
  sql(`UPDATE auth.users SET recovery_sent_at = now() - interval '3 hours' WHERE id = '${actor.id}';
       UPDATE auth.one_time_tokens SET created_at = now() - interval '3 hours' WHERE user_id = '${actor.id}';`)
  const retorno = await resolverRetornoDeApp(enlace)
  const resultado = interpretarEnlace(retorno)
  assert.equal(resultado.tipo, 'rechazado', `El enlace vencido no fue rechazado: ${describirRetorno(retorno)}`)
  ok(`Enlace vencido (reloj retrocedido en el stack local): GoTrue responde ${describirRetorno(retorno)}; la app lo clasifica como «${resultado.motivo}».`)

  // El código canjeable también vence.
  const otra = await crearActor('PADRE')
  const app2 = crearClienteApp()
  const enlace2 = await pedirEnlace(app2, otra)
  const codigo = interpretarEnlace(await resolverRetornoDeApp(enlace2))
  assert.equal(codigo.tipo, 'codigo')
  sql(`UPDATE auth.flow_state SET auth_code_issued_at = now() - interval '2 hours', created_at = now() - interval '2 hours' WHERE user_id = '${otra.id}';`)
  assert.equal((await intercambiarCodigo(app2.cliente.auth, codigo)).tipo, 'enlace_invalido')
  ok('Un código canjeable vencido (reloj retrocedido en el stack local) es rechazado.')
}

async function cuentaInexistente(existente) {
  etapa = 'cuentaInexistente'
  const app = crearClienteApp()
  const fantasma = `ept106-fantasma-${sufijo()}@ept106.invalid`
  await borrarCorreos(local.mailpit, fantasma)
  await borrarCorreos(local.mailpit, existente.email)
  const paraFantasma = await solicitarRecuperacion(app.cliente.auth, fantasma)
  const paraExistente = await solicitarRecuperacion(crearClienteApp().cliente.auth, existente.email)
  assert.deepEqual(paraFantasma, paraExistente, 'La respuesta distingue cuentas existentes de inexistentes.')
  assert.equal(await confirmarSinCorreo(local.mailpit, fantasma), true, 'Se envió un correo a una cuenta inexistente.')
  assert.equal((await usuariosConCorreo(fantasma)).length, 0, 'La recuperación creó una cuenta.')
  await esperarCorreo(local.mailpit, existente.email)
  ok('Correo inexistente: misma respuesta que uno existente, sin correo enviado y sin cuenta creada (sin enumeración).')
}

async function errorDeConexion() {
  etapa = 'errorDeConexion'
  const sinServicio = crearClienteApp('http://127.0.0.1:9')
  assert.deepEqual(await solicitarRecuperacion(sinServicio.cliente.auth, 'a@b.test'), { tipo: 'sin_conexion' })
  ok('Sin servicio, la solicitud informa falla de conexión.')

  // Falla de red durante el intercambio: el SDK descarta el verificador, así que se debe pedir un enlace nuevo.
  const actor = await crearActor('PADRE')
  const app = crearClienteApp()
  const enlace = await pedirEnlace(app, actor)
  const codigo = interpretarEnlace(await resolverRetornoDeApp(enlace))
  assert.equal(codigo.tipo, 'codigo')
  const clienteCaido = createClient('http://127.0.0.1:9', local.anon, {
    auth: { flowType: 'pkce', autoRefreshToken: false, persistSession: true, detectSessionInUrl: false, storage: {
      getItem: clave => app.memoria.get(clave) ?? null,
      setItem: (clave, valor) => { app.memoria.set(clave, valor) },
      removeItem: clave => { app.memoria.delete(clave) },
    } },
  })
  assert.deepEqual(await intercambiarCodigo(clienteCaido.auth, codigo), { tipo: 'sin_conexion' })
  // El SDK descarta el verificador aunque la petición no haya llegado: el reintento ya no puede canjear el enlace.
  const reintento = await intercambiarCodigo(app.cliente.auth, codigo)
  assert.equal(reintento.tipo, 'sin_verificador', 'El reintento tras una falla de red no debería poder canjear el enlace')
  observacion('Falla de red durante el canje: el reintento con el mismo enlace devuelve «sin_verificador»; la app pide un enlace nuevo.')
  assert.equal((await iniciarSesion(actor.email, actor.password)).status, 200, 'La contraseña cambió tras una falla de red')
  ok('Falla de red durante el canje: se informa «sin conexión» sin cambiar la contraseña.')
}

async function otraCuentaConSesion() {
  etapa = 'otraCuenta'
  const cuentaA = await crearActor('PADRE')
  const cuentaB = await crearActor('PADRE')
  const app = crearClienteApp()
  const login = await app.cliente.auth.signInWithPassword({ email: cuentaA.email, password: cuentaA.password })
  assert.equal(login.data.user?.id, cuentaA.id)

  const enlace = await pedirEnlace(app, cuentaB)
  const codigo = interpretarEnlace(await resolverRetornoDeApp(enlace))
  assert.equal(codigo.tipo, 'codigo')
  assert.deepEqual(await intercambiarCodigo(app.cliente.auth, codigo), { tipo: 'ok', usuarioId: cuentaB.id })

  // Con la sesión de B, un intento de cambiar la contraseña «de A» no escribe nada.
  const intruso = await actualizarContrasena(app.cliente.auth, contrasenaAleatoria(), { usuarioEsperado: cuentaA.id })
  assert.deepEqual(intruso, { tipo: 'usuario_distinto' })
  assert.equal((await iniciarSesion(cuentaA.email, cuentaA.password)).status, 200, 'La contraseña de la cuenta anterior cambió.')
  const nuevaB = contrasenaAleatoria()
  assert.deepEqual(await actualizarContrasena(app.cliente.auth, nuevaB, { usuarioEsperado: cuentaB.id }), { tipo: 'ok' })
  assert.equal((await iniciarSesion(cuentaB.email, nuevaB)).status, 200)
  assert.equal((await iniciarSesion(cuentaA.email, cuentaA.password)).status, 200)
  ok('Otra cuenta con sesión iniciada: el enlace solo cambia la contraseña de la cuenta que lo pidió; la de la cuenta anterior queda intacta.')
}

async function cambioDesdePerfil() {
  etapa = 'cambioDesdePerfil'
  const actor = await crearActor('ESTUDIANTE', { legajo: true })
  const antes = await instantanea(actor)
  const app = crearClienteApp()
  const login = await app.cliente.auth.signInWithPassword({ email: actor.email, password: actor.password })
  assert.equal(login.data.user?.id, actor.id)

  const nueva = contrasenaAleatoria()
  assert.deepEqual(await actualizarContrasena(app.cliente.auth, nueva, { usuarioEsperado: actor.id }), { tipo: 'ok' })
  assert.equal((await iniciarSesion(actor.email, nueva)).status, 200)
  assert.notEqual((await iniciarSesion(actor.email, actor.password)).status, 200)
  assert.deepEqual(await instantanea(actor), antes)
  ok('Cambio desde el perfil con la sesión vigente: contraseña nueva válida, anterior rechazada, identidad intacta.')

  // Reautenticación soportada por Auth. El stack efímero activa «secure_password_change»: con una sesión que
  // no es reciente, Auth exige un código enviado por correo (nonce). La antigüedad se simula retrocediendo el
  // reloj de la sesión en el stack local (documentado); no se toca ninguna configuración remota.
  sql(`UPDATE auth.sessions SET created_at = now() - interval '3 days' WHERE user_id = '${actor.id}';
       UPDATE auth.users SET last_sign_in_at = now() - interval '3 days' WHERE id = '${actor.id}';`)
  const sinCodigo = await actualizarContrasena(app.cliente.auth, contrasenaAleatoria(), { usuarioEsperado: actor.id })
  assert.equal(sinCodigo.tipo, 'reautenticar', `Auth debía exigir reautenticación para una sesión antigua (resultado ${sinCodigo.tipo}); ¿está activo secure_password_change?`)
  await borrarCorreos(local.mailpit, actor.email)
  assert.deepEqual(await pedirCodigoDeVerificacion(app.cliente.auth), { tipo: 'enviado' })
  const correo = await esperarCorreo(local.mailpit, actor.email)
  const codigo = /\b(\d{6})\b/u.exec(correo.texto)?.[1]
  assert.ok(codigo, 'El correo de reautenticación no trae un código de 6 dígitos.')
  const errado = await actualizarContrasena(app.cliente.auth, contrasenaAleatoria(), { usuarioEsperado: actor.id, nonce: codigo === '000000' ? '111111' : '000000' })
  assert.equal(errado.tipo, 'codigo_invalido', `Un código errado debe rechazarse (resultado ${errado.tipo}).`)
  const final = contrasenaAleatoria()
  assert.deepEqual(await actualizarContrasena(app.cliente.auth, final, { usuarioEsperado: actor.id, nonce: codigo }), { tipo: 'ok' })
  assert.equal((await iniciarSesion(actor.email, final)).status, 200)
  assert.notEqual((await iniciarSesion(actor.email, nueva)).status, 200)
  ok('Reautenticación real de Auth con sesión antigua: se exige el código por correo, se rechaza el errado y el cambio con el nonce correcto funciona.')

  // Sesión vencida o cerrada: no hay cambio.
  await app.cliente.auth.signOut({ scope: 'local' })
  const sinSesion = await actualizarContrasena(app.cliente.auth, contrasenaAleatoria(), { usuarioEsperado: actor.id })
  assert.equal(sinSesion.tipo, 'sesion_expirada')
  assert.equal((await iniciarSesion(actor.email, final)).status, 200)
  ok('Sin sesión no se cambia ninguna contraseña.')
}

async function exportarParaMaestro() {
  const githubEnv = process.env.GITHUB_ENV
  if (!githubEnv) return
  etapa = 'exportacion'
  const actor = await crearActor('ESTUDIANTE', { legajo: true })
  const valores = {
    MAESTRO_RECUPERACION_EMAIL: actor.email,
    MAESTRO_RECUPERACION_PASSWORD: actor.password,
    MAESTRO_RECUPERACION_NUEVA: contrasenaAleatoria(),
    MAESTRO_RECUPERACION_NUEVA2: contrasenaAleatoria(),
  }
  for (const valor of Object.values(valores)) console.log(`::add-mask::${valor}`)
  const lineas = Object.entries(valores).map(([clave, valor]) => `${clave}=${valor}`)
  lineas.push(`EPT_RECUPERACION_API_URL=${local.api}`, `EPT_RECUPERACION_MAILPIT_URL=${local.mailpit}`)
  appendFileSync(githubEnv, `${lineas.join('\n')}\n`)
  ok('Actor sintético para el escenario móvil exportado al runner (credenciales enmascaradas).')
}

async function limpiar() {
  for (const actor of actores) {
    await borrarCorreos(local.mailpit, actor.email).catch(() => undefined)
    if (process.env.EPT_RECUPERACION_LIMPIAR !== '1') continue
    await admin(`/auth/v1/admin/users/${actor.id}`, 'DELETE').catch(() => undefined)
  }
}

try {
  local = validarEntorno(entornoDelStack())
  const flujo = await flujoCompleto()
  await enlaceReutilizado(flujo)
  await enlaceInvalidoYSinVerificador()
  await enlaceVencido()
  await cuentaInexistente(flujo.padre)
  await errorDeConexion()
  await otraCuentaConSesion()
  await cambioDesdePerfil()
  await exportarParaMaestro()
  await limpiar()
  console.log('Recuperación de contraseña: integración real completada.')
} catch (error) {
  // No se imprimen objetos del proveedor ni enlaces: solo la etapa y el mensaje de la aserción.
  const mensaje = error instanceof Error ? error.message.replace(/(code|token|password)=[^\s&]+/giu, '$1=<oculto>') : 'error desconocido'
  console.error(`Falló la integración de recuperación en la etapa «${etapa}»: ${mensaje}`)
  process.exitCode = 1
}
