/**
 * EPT-58 — Matriz de acceso por la API de datos (PostgREST) con sesiones reales.
 *
 * Cada actor inicia sesión en el GoTrue local y consulta tablas y RPC de
 * profesores por HTTP, igual que lo haría un cliente. Se comprueban los
 * códigos que devuelve PostgREST (401 anónimo, 403 autenticado sin permiso,
 * 405 por método, 406 por esquema no expuesto) y el contenido que cada actor
 * recibe. Ningún rechazo se acepta si no trae el SQLSTATE esperado.
 *
 *     node supabase/tests/profesores_postgrest.mjs
 *
 * Solo contra la instancia local de bucle; se niega a correr contra otra.
 * Crea sus usuarios y perfiles y los borra al terminar.
 */

import { execFileSync } from 'node:child_process'

const CONTENEDOR =
  process.env.EPT_SUPABASE_DB_CONTAINER ?? 'supabase_db_educar-para-transformar'

function leerEntornoLocal() {
  const salida = execFileSync('npx', ['supabase', 'status', '-o', 'env'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const valores = {}
  for (const linea of salida.split(/\r?\n/u)) {
    const coincidencia = /^([A-Z0-9_]+)="?(.*?)"?$/u.exec(linea.trim())
    if (coincidencia) valores[coincidencia[1]] = coincidencia[2]
  }
  return valores
}

const local = leerEntornoLocal()
if (!local.API_URL || !local.ANON_KEY || !local.SERVICE_ROLE_KEY) {
  console.error('FALLO  no se pudo leer la instancia local de Supabase (¿supabase start?).')
  process.exit(1)
}
if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(local.API_URL).hostname)) {
  console.error('FALLO  la API no es de bucle local: esta prueba crea y borra usuarios.')
  process.exit(1)
}

function psql(sql) {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTENEDOR, 'psql', '-X', '-q', '-A', '-t', '-U', 'postgres', '-d', 'postgres',
     '-v', 'ON_ERROR_STOP=1'],
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim()
}

const DOMINIO = 'ept58-api.local'
const ACTORES = {
  director: { rol: 'DIRECTOR', dni: '95840001', legajo: null },
  docenteA: { rol: 'DOCENTE', dni: '95840002', legajo: 'LEG-EPT58-API-A' },
  docenteB: { rol: 'DOCENTE', dni: '95840003', legajo: null },
  estudiante: { rol: 'ESTUDIANTE', dni: '95840004', legajo: 'LEG-EPT58-API-E' },
  padre: { rol: 'PADRE', dni: '95840005', legajo: null },
  personal: { rol: 'PERSONAL', dni: '95840006', legajo: null },
  sinPerfil: { rol: null },
}
const CLAVE = 'prueba-ept-58-api'

let fallos = 0
function afirmar(condicion, descripcion) {
  if (condicion) {
    console.log(`OK  ${descripcion}`)
    return
  }
  fallos += 1
  console.error(`FALLO  ${descripcion}`)
}

async function admin(ruta, opciones = {}) {
  return fetch(`${local.API_URL}/auth/v1/admin/${ruta}`, {
    ...opciones,
    headers: {
      apikey: local.SERVICE_ROLE_KEY,
      authorization: `Bearer ${local.SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
    },
  })
}

async function limpiar() {
  const listado = await (await admin('users?per_page=1000')).json()
  const propios = (listado.users ?? []).filter((u) => (u.email ?? '').endsWith(`@${DOMINIO}`))
  const ids = propios.map((u) => `'${u.id}'`).join(',')
  if (ids) {
    psql(`BEGIN;
      DELETE FROM public.padres_hijos
        WHERE padre_id IN (SELECT id FROM public.perfiles WHERE user_id IN (${ids}))
           OR hijo_id IN (SELECT id FROM public.perfiles WHERE user_id IN (${ids}));
      DELETE FROM public.profesores
        WHERE perfil_id IN (SELECT id FROM public.perfiles WHERE user_id IN (${ids}));
      DELETE FROM public.alumnos
        WHERE perfil_id IN (SELECT id FROM public.perfiles WHERE user_id IN (${ids}));
      DELETE FROM public.perfiles WHERE user_id IN (${ids});
      COMMIT;`)
  }
  for (const usuario of propios) await admin(`users/${usuario.id}`, { method: 'DELETE' })
}

async function iniciarSesion(correo) {
  const respuesta = await fetch(`${local.API_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: local.ANON_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email: correo, password: CLAVE }),
  })
  const cuerpo = await respuesta.json()
  if (!cuerpo.access_token) throw new Error(`No se pudo iniciar sesión como ${correo}`)
  return cuerpo.access_token
}

/** Llama a PostgREST y devuelve estado HTTP, cuerpo y código SQLSTATE. */
async function rest(token, metodo, ruta, cuerpo, cabeceras = {}) {
  const respuesta = await fetch(`${local.API_URL}/rest/v1/${ruta}`, {
    method: metodo,
    headers: {
      apikey: local.ANON_KEY,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'content-type': 'application/json',
      ...cabeceras,
    },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  })
  const texto = await respuesta.text()
  let datos = null
  try {
    datos = texto ? JSON.parse(texto) : null
  } catch {
    datos = texto
  }
  return { estado: respuesta.status, datos, codigo: datos && typeof datos === 'object' ? datos.code : undefined }
}

const esperado = (r, estado, codigo) => r.estado === estado && (codigo === undefined || r.codigo === codigo)
const describir = (r) => `${r.estado}${r.codigo ? ` ${r.codigo}` : ''}`

try {
  await limpiar()

  // 1. Usuarios reales en Auth y perfiles con cada rol. Los DOCENTE reciben su
  //    ficha por el trigger de A.
  const perfiles = {}
  for (const [clave, actor] of Object.entries(ACTORES)) {
    const correo = `${clave.toLowerCase()}@${DOMINIO}`
    const alta = await (await admin('users', {
      method: 'POST',
      body: JSON.stringify({ email: correo, password: CLAVE, email_confirm: true }),
    })).json()
    if (!alta.id) throw new Error(`No se pudo crear ${correo}`)
    actor.correo = correo
    if (actor.rol) {
      perfiles[clave] = psql(`
        INSERT INTO public.perfiles (user_id, rol_id, nombre, apellido, dni, legajo_nro)
        SELECT '${alta.id}', r.id, 'Prueba', 'API ${clave}', '${actor.dni}',
               ${actor.legajo ? `'${actor.legajo}'` : 'NULL'}
        FROM public.roles r WHERE r.nombre = '${actor.rol}'
        RETURNING id;`).split(/\r?\n/u)[0]
    }
  }
  psql(`INSERT INTO public.padres_hijos (padre_id, hijo_id) VALUES ('${perfiles.padre}', '${perfiles.estudiante}');`)

  const token = {}
  for (const [clave, actor] of Object.entries(ACTORES)) token[clave] = await iniciarSesion(actor.correo)
  console.log('OK  siete sesiones reales (dirección, dos docentes, estudiante, padre, personal y sin perfil)')

  // 2. Anónimo: 401 con el SQLSTATE de privilegio.
  for (const [metodo, ruta, cuerpo] of [
    ['GET', 'profesores?select=perfil_id'],
    ['GET', 'profesores_estados_historial?select=id'],
    ['POST', 'rpc/listar_profesores', {}],
    ['POST', 'rpc/consultar_ficha_profesor', {}],
    ['POST', 'rpc/listar_estudiantes_para_gestion', {}],
    ['POST', 'rpc/cambiar_estado_profesor', { p_profesor_id: perfiles.docenteA, p_estado: 'INACTIVO' }],
  ]) {
    const r = await rest(null, metodo, ruta, cuerpo)
    afirmar(esperado(r, 401, '42501'), `anónimo ${metodo} ${ruta.split('?')[0]} → 401 42501 (llegó ${describir(r)})`)
  }

  // 3. app_private no está expuesto por la API, ni siquiera para la dirección.
  for (const [metodo, ruta, cabecera] of [
    ['POST', 'rpc/listar_profesores', { 'content-profile': 'app_private' }],
    ['GET', 'profesores?select=perfil_id', { 'accept-profile': 'app_private' }],
  ]) {
    const r = await rest(token.director, metodo, ruta, metodo === 'POST' ? {} : undefined, cabecera)
    afirmar(esperado(r, 406, 'PGRST106'), `app_private no expuesto: ${metodo} ${ruta.split('?')[0]} → 406 PGRST106 (llegó ${describir(r)})`)
  }

  // 4. Dirección: lectura completa, escritura solo por RPC.
  let r = await rest(token.director, 'POST', 'rpc/listar_profesores', {})
  afirmar(
    r.estado === 200 &&
      [perfiles.docenteA, perfiles.docenteB].every((id) => r.datos.some((f) => f.perfil_id === id)),
    'dirección lista todas las fichas por RPC (200)'
  )
  r = await rest(token.director, 'POST', 'rpc/consultar_ficha_profesor', { p_profesor_id: perfiles.docenteA })
  afirmar(
    r.estado === 200 && r.datos.length === 1 && r.datos[0].dni === '95840002' && !('email' in r.datos[0]),
    'dirección consulta la ficha con datos personales y sin correo (200)'
  )
  r = await rest(token.director, 'POST', 'rpc/actualizar_ficha_profesor', {
    p_profesor_id: perfiles.docenteB, p_legajo_nro: 'LEG-EPT58-API-B', p_especialidad: '  Biología   Marina ',
  })
  afirmar(r.estado === 200 && r.datos.especialidad === 'Biología Marina', 'dirección completa una ficha por RPC y se normaliza (200)')
  r = await rest(token.director, 'POST', 'rpc/actualizar_ficha_profesor', {
    p_profesor_id: perfiles.docenteB, p_legajo_nro: 'LEG-EPT58-API-B', p_especialidad: 'X',
  })
  afirmar(esperado(r, 400, 'P5604') && /2 y 100/u.test(r.datos.message), `especialidad corta → 400 P5604 con mensaje en español (llegó ${describir(r)})`)
  r = await rest(token.director, 'GET', 'profesores?select=perfil_id')
  afirmar(r.estado === 200 && r.datos.length >= 2, 'dirección lee la tabla de fichas directamente (200)')
  for (const [metodo, ruta, cuerpo] of [
    ['PATCH', `profesores?perfil_id=eq.${perfiles.docenteA}`, { estado: 'INACTIVO' }],
    ['DELETE', `profesores?perfil_id=eq.${perfiles.docenteA}`],
    ['POST', 'profesores', { perfil_id: perfiles.personal }],
    ['DELETE', 'profesores_estados_historial?id=gt.0'],
  ]) {
    r = await rest(token.director, metodo, ruta, cuerpo)
    afirmar(esperado(r, 403, '42501'), `dirección ${metodo} directo sobre ${ruta.split('?')[0]} → 403 42501 (llegó ${describir(r)})`)
  }
  r = await rest(token.director, 'GET', 'rpc/cambiar_estado_profesor?p_profesor_id=' + perfiles.docenteA + '&p_estado=INACTIVO')
  afirmar(r.estado === 405, `GET sobre una RPC de escritura → 405 (llegó ${describir(r)})`)

  // 5. DOCENTE: solo lo propio; pedir otra ficha → 403.
  r = await rest(token.docenteA, 'POST', 'rpc/consultar_ficha_profesor', {})
  afirmar(r.estado === 200 && r.datos.length === 1 && r.datos[0].perfil_id === perfiles.docenteA, 'docente consulta su propia ficha (200)')
  r = await rest(token.docenteA, 'POST', 'rpc/consultar_ficha_profesor', { p_profesor_id: perfiles.docenteB })
  afirmar(esperado(r, 403, '42501'), `docente pide la ficha de otro docente → 403 42501 (llegó ${describir(r)})`)
  r = await rest(token.docenteA, 'POST', 'rpc/listar_asignaciones_profesor', { p_profesor_id: perfiles.docenteB })
  afirmar(esperado(r, 403, '42501'), `docente pide asignaciones ajenas → 403 42501 (llegó ${describir(r)})`)
  r = await rest(token.docenteA, 'GET', 'profesores?select=perfil_id')
  afirmar(r.estado === 200 && r.datos.length === 1 && r.datos[0].perfil_id === perfiles.docenteA, 'docente lee directamente solo su ficha (200, 1 fila)')
  r = await rest(token.docenteA, 'POST', 'rpc/listar_estudiantes_para_gestion', {})
  const fila = Array.isArray(r.datos) ? r.datos.find((e) => e.id === perfiles.estudiante) : null
  afirmar(
    r.estado === 200 && fila && Object.keys(fila).sort().join(',') === 'apellido,id,legajo_nro,nombre',
    'docente recibe la consulta mínima de estudiantes con cuatro columnas (200)'
  )
  for (const [ruta, cuerpo] of [
    ['rpc/listar_profesores', {}],
    ['rpc/cambiar_estado_profesor', { p_profesor_id: perfiles.docenteA, p_estado: 'INACTIVO' }],
    ['rpc/listar_historial_estados_profesor', { p_profesor_id: perfiles.docenteA }],
  ]) {
    r = await rest(token.docenteA, 'POST', ruta, cuerpo)
    afirmar(esperado(r, 403, '42501'), `docente ${ruta} → 403 42501 (llegó ${describir(r)})`)
  }

  // 6. ESTUDIANTE, PADRE, PERSONAL y sesión sin perfil: sin superficie nueva.
  for (const actor of ['estudiante', 'padre', 'personal', 'sinPerfil']) {
    for (const [ruta, cuerpo] of [
      ['rpc/listar_profesores', {}],
      ['rpc/consultar_ficha_profesor', {}],
      ['rpc/listar_estudiantes_para_gestion', {}],
    ]) {
      r = await rest(token[actor], 'POST', ruta, cuerpo)
      afirmar(esperado(r, 403, '42501'), `${actor} ${ruta} → 403 42501 (llegó ${describir(r)})`)
    }
    r = await rest(token[actor], 'GET', 'profesores?select=perfil_id')
    afirmar(r.estado === 200 && Array.isArray(r.datos) && r.datos.length === 0, `${actor} lee la tabla de fichas y recibe 0 filas (200)`)
  }
} finally {
  await limpiar()
  const restos = psql(`SELECT pg_catalog.count(*) FROM public.perfiles WHERE dni LIKE '958400%';`)
  afirmar(restos === '0', 'usuarios y perfiles de la prueba eliminados')
}

if (fallos > 0) {
  console.error(`\n${fallos} afirmación(es) incumplida(s).`)
  process.exit(1)
}
console.log('\nTodas las afirmaciones se cumplieron.')
