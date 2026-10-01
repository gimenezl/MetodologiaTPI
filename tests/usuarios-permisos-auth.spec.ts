import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import {
  expect,
  request as crearContexto,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test'
import { capturarSinHerramientas } from './_captura'
import { exigirContraste } from './_contraste'
import { exigirSinControlesAnidados } from './_semantica'
import { exigirMensajeSinDetalleTecnico, exigirPantallaSinDetalleTecnico } from './_sin-detalle-tecnico'

/**
 * EPT-59 — Usuarios, roles, acceso bloqueado y vínculo presencial de cuentas.
 *
 * Sesiones reales creadas por `tests/auth.setup.ts`: las habilitadas de cada
 * rol, la cuenta sin perfil y cinco identidades que iniciaron sesión con el
 * perfil HABILITADO y quedaron BLOQUEADAS después (sus JWT son anteriores al
 * bloqueo). Sin mocks: cada acción atraviesa cookies SSR, las guardas del
 * servidor, las RPC de la migración de EPT-59, PostgreSQL, GoTrue y el correo
 * real de Mailpit (el código de D5 se lee desde su API).
 *
 * Cada proyecto de Playwright vuelve a sembrar los legajos de esta suite
 * (DNI 99.959.1xx, correos `*.e2e59.prueba@ept.local`), así que el estado de
 * partida no depende del orden de los proyectos. Todo es sintético y solo corre
 * contra la base local descartable. Nada de esta suite imprime claves, tokens,
 * contraseñas ni códigos.
 */

test.skip(
  process.env.EPT_SUPABASE_LOCAL !== '1',
  'Requiere EPT_SUPABASE_LOCAL=1 y un reset de la base local.'
)

const BASE_URL = process.env.EPT_BASE_URL ?? 'http://localhost:3000'
const CONTENEDOR = process.env.EPT_SUPABASE_DB_CONTAINER ?? 'supabase_db_educar-para-transformar'
const CAPTURAR = process.env.EPT_CAPTURAS === '1'
const EVIDENCIA = 'docs/evidence/EPT-59'
const ESCRITORIO = { width: 1280, height: 900 }
const MOVIL = { width: 375, height: 812 }
const ANFITRIONES_LOCALES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

const MAILPIT = (process.env.EPT_MAILPIT_URL ?? 'http://127.0.0.1:54324').replace(/\/$/u, '')
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const CLAVE_ANONIMA = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

const DNI_DIRECTORA = '99900001'
const DNI_DIRECTORA_CIERRE = '99900007'
const MOTIVO = 'Prueba de permisos de EPT-59'
const MENSAJE_BLOQUEO = 'Tu acceso está bloqueado. Comunicate con Dirección.'

type Fixture = { id: string; nombre: string; apellido: string; dni: string; rol: string }

/** Legajos sin cuenta de esta suite. Cada prueba usa el suyo. */
const F = {
  rol: { id: 'e5900000-0000-4000-8000-000000000101', nombre: 'Rosa', apellido: 'Cambiante', dni: '99959101', rol: 'PERSONAL' },
  datos: { id: 'e5900000-0000-4000-8000-000000000102', nombre: 'Dora', apellido: 'Editable', dni: '99959102', rol: 'PERSONAL' },
  teclado: { id: 'e5900000-0000-4000-8000-000000000103', nombre: 'Tomas', apellido: 'Teclado', dni: '99959103', rol: 'PERSONAL' },
  matriz: { id: 'e5900000-0000-4000-8000-000000000104', nombre: 'Mateo', apellido: 'Matriz', dni: '99959104', rol: 'PERSONAL' },
  api: { id: 'e5900000-0000-4000-8000-000000000105', nombre: 'Abel', apellido: 'Reserva', dni: '99959105', rol: 'PERSONAL' },
  vinculo: { id: 'e5900000-0000-4000-8000-000000000106', nombre: 'Vera', apellido: 'Vinculable', dni: '99959106', rol: 'PERSONAL' },
  vinculoMovil: { id: 'e5900000-0000-4000-8000-000000000107', nombre: 'Valen', apellido: 'Movil', dni: '99959107', rol: 'PADRE' },
  diseno: { id: 'e5900000-0000-4000-8000-000000000108', nombre: 'Lara', apellido: 'Pantallas', dni: '99959108', rol: 'PERSONAL' },
} satisfies Record<string, Fixture>

/** Persona con cuenta de acceso real, para bloquear y reactivar. */
const CON_CUENTA = {
  email: 'acceso.e2e59.prueba@ept.local',
  password: 'prueba-ept-59-acceso',
  nombre: 'Aldo',
  apellido: 'Acceso',
  dni: '99959109',
}

const CORREO_MATRIZ = 'matriz.e2e59.prueba@ept.local'
const CORREOS_CON_CUENTA = [
  CON_CUENTA.email,
  'vinculo.e2e59.prueba@ept.local',
  'vinculo.movil.e2e59.prueba@ept.local',
]

const BLOQUEADOS = [
  { rol: 'DIRECTOR', dni: '99959001', apellido: 'Zuloaga Director', rutas: ['/dashboard/usuarios', '/dashboard/alumnos'] },
  { rol: 'DOCENTE', dni: '99959002', apellido: 'Zuloaga Docente', rutas: ['/dashboard/mis-asignaciones', '/dashboard/asistencias'] },
  { rol: 'ESTUDIANTE', dni: '99959003', apellido: 'Zuloaga Estudiante', rutas: ['/dashboard/mi-legajo', '/dashboard/comedor'] },
  { rol: 'PADRE', dni: '99959004', apellido: 'Zuloaga Padre', rutas: ['/dashboard/hijos', '/dashboard/cupos'] },
  { rol: 'PERSONAL', dni: '99959005', apellido: 'Zuloaga Personal', rutas: ['/dashboard/perfil'] },
] as const

// ================================================================
// Infraestructura
// ================================================================

function sql(sentencia: string) {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTENEDOR, 'psql', '-X', '-q', '-A', '-t', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    { input: sentencia, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim()
}

const contar = (consulta: string) => Number(sql(`SELECT pg_catalog.count(*) ${consulta};`))

function exigirLocal() {
  for (const url of [SUPABASE_URL, MAILPIT]) {
    if (!url || !ANFITRIONES_LOCALES.has(new URL(url).hostname)) {
      throw new Error('La suite de EPT-59 solo corre contra Supabase y Mailpit de bucle local.')
    }
  }
}

function clienteAdmin() {
  exigirLocal()
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!clave) throw new Error('Falta la clave de servicio local (usá supabase/tests/correr-autenticadas.mjs).')
  return createClient(SUPABASE_URL, clave, { auth: { autoRefreshToken: false, persistSession: false } })
}

/** Retira todo lo que crea esta suite, respetando las guardas de solo agregado. */
function limpiarFixtures() {
  const correos = CORREOS_CON_CUENTA.map((c) => `'${c}'`).join(', ')
  sql(`
    BEGIN;
    CREATE TEMPORARY TABLE e2e59 ON COMMIT DROP AS
      SELECT id FROM public.perfiles WHERE dni LIKE '999591%';
    ALTER TABLE public.perfiles_historial DISABLE TRIGGER impedir_modificar_historial_perfiles;
    DELETE FROM public.perfiles_historial WHERE perfil_id IN (SELECT id FROM e2e59);
    ALTER TABLE public.perfiles_historial ENABLE TRIGGER impedir_modificar_historial_perfiles;
    ALTER TABLE app_private.vinculos_cuenta DISABLE TRIGGER impedir_borrar_vinculos_cuenta;
    DELETE FROM app_private.vinculos_cuenta WHERE perfil_id IN (SELECT id FROM e2e59);
    ALTER TABLE app_private.vinculos_cuenta ENABLE TRIGGER impedir_borrar_vinculos_cuenta;
    ALTER TABLE public.profesores_estados_historial DISABLE TRIGGER impedir_modificar_historial_profesor;
    DELETE FROM public.profesores_estados_historial WHERE profesor_id IN (SELECT id FROM e2e59);
    ALTER TABLE public.profesores_estados_historial ENABLE TRIGGER impedir_modificar_historial_profesor;
    DELETE FROM public.profesores WHERE perfil_id IN (SELECT id FROM e2e59);
    DELETE FROM public.padres_hijos WHERE padre_id IN (SELECT id FROM e2e59) OR hijo_id IN (SELECT id FROM e2e59);
    DELETE FROM public.perfiles WHERE id IN (SELECT id FROM e2e59);
    COMMIT;
    DELETE FROM auth.users WHERE email IN (${correos});
  `)
}

async function sembrarFixtures() {
  const valores = Object.values(F)
    .map((f) => `('${f.id}'::uuid, '${f.nombre}', '${f.apellido}', '${f.dni}', '${f.rol}')`)
    .join(',\n')
  sql(`
    INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni)
    SELECT v.id, NULL, r.id, v.nombre, v.apellido, v.dni
    FROM (VALUES ${valores}) AS v(id, nombre, apellido, dni, rol)
    JOIN public.roles r ON r.nombre = v.rol;
  `)

  // La cuenta con acceso nace por el mismo camino que el alta de Usuarios
  // (migración 010): GoTrue crea la cuenta y el perfil en una transacción.
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  const rolPersonal = Number(sql(`SELECT id FROM public.roles WHERE nombre = 'PERSONAL';`))
  const respuesta = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: clave, authorization: `Bearer ${clave}` },
    body: JSON.stringify({
      email: CON_CUENTA.email,
      password: CON_CUENTA.password,
      email_confirm: true,
      app_metadata: {
        ept_alta: {
          nombre: CON_CUENTA.nombre,
          apellido: CON_CUENTA.apellido,
          dni: CON_CUENTA.dni,
          rol_id: rolPersonal,
          telefono: null,
          direccion: null,
          legajo_nro: null,
        },
      },
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!respuesta.ok) throw new Error(`No se pudo sembrar la cuenta con acceso (${respuesta.status}).`)
}

function idConCuenta() {
  return sql(`SELECT id FROM public.perfiles WHERE dni = '${CON_CUENTA.dni}';`)
}

function rolYAcceso(perfilId: string) {
  return sql(`SELECT COALESCE(r.nombre, '-') || '|' || p.estado_acceso FROM public.perfiles p
    LEFT JOIN public.roles r ON r.id = p.rol_id WHERE p.id = '${perfilId}';`)
}

// ---- Mailpit ----

async function idsDeMensajes(destinatario: string): Promise<string[]> {
  const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${destinatario}"`)}`, {
    signal: AbortSignal.timeout(5000),
  })
  if (!r.ok) throw new Error(`Mailpit no respondió la búsqueda (${r.status})`)
  return (((await r.json()).messages ?? []) as { ID: string }[]).map((m) => m.ID)
}

/** Espera un mensaje nuevo para el destinatario y devuelve su código. No lo imprime. */
async function codigoNuevo(destinatario: string, vistos: Set<string>): Promise<string> {
  for (let intento = 0; intento < 60; intento += 1) {
    const nuevo = (await idsDeMensajes(destinatario)).find((id) => !vistos.has(id))
    if (nuevo) {
      vistos.add(nuevo)
      const detalle = await fetch(`${MAILPIT}/api/v1/message/${nuevo}`, { signal: AbortSignal.timeout(5000) })
      const mensaje = (await detalle.json()) as { Text?: string }
      const codigo = /código de verificación es: (\d{6})/u.exec(mensaje.Text ?? '')?.[1]
      if (!codigo) throw new Error('El correo no trae un código de 6 dígitos.')
      return codigo
    }
    await new Promise((resolver) => setTimeout(resolver, 250))
  }
  throw new Error('El código no llegó a Mailpit.')
}

async function borrarBuzon(destinatario: string) {
  await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${destinatario}"`)}`, {
    method: 'DELETE',
    signal: AbortSignal.timeout(5000),
  }).catch(() => undefined)
}

// ---- Sesiones y PostgREST ----

/** JWT de acceso de una sesión guardada. Solo se usa en memoria; nunca se imprime. */
function tokenDeSesion(archivo: string): string {
  const estado = JSON.parse(fs.readFileSync(archivo, 'utf8')) as { cookies: { name: string; value: string }[] }
  const sufijo = (nombre: string) => Number(/\.(\d+)$/u.exec(nombre)?.[1] ?? -1)
  const partes = estado.cookies
    .filter((c) => /^sb-.+-auth-token(?:\.\d+)?$/u.test(c.name))
    .sort((a, b) => sufijo(a.name) - sufijo(b.name))
  let valor = partes.map((c) => c.value).join('')
  if (valor.startsWith('base64-')) valor = Buffer.from(valor.slice('base64-'.length), 'base64').toString('utf8')
  const sesion = JSON.parse(valor) as { access_token?: string }
  if (!sesion.access_token) throw new Error('La sesión guardada no tiene token de acceso.')
  return sesion.access_token
}

/**
 * Token de la sesión guardada si sigue vigente; si venció (la suite completa
 * puede durar más que el JWT), uno nuevo de la misma cuenta. El perfil es el
 * mismo, así que la base lo trata igual. Nunca se imprime.
 */
async function tokenVigente(archivo: string, correo: string, contrasena: string): Promise<string> {
  const guardado = tokenDeSesion(archivo)
  const carga = JSON.parse(Buffer.from(guardado.split('.')[1] ?? '', 'base64').toString('utf8')) as { exp?: number }
  if ((carga.exp ?? 0) * 1000 > Date.now() + 60_000) return guardado
  const respuesta = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: CLAVE_ANONIMA },
    body: JSON.stringify({ email: correo, password: contrasena }),
    signal: AbortSignal.timeout(10_000),
  })
  const cuerpo = (await respuesta.json().catch(() => null)) as { access_token?: string } | null
  if (!cuerpo?.access_token) throw new Error(`No se pudo renovar la sesión de prueba (${respuesta.status}).`)
  return cuerpo.access_token
}

async function rest(token: string, ruta: string, init: RequestInit = {}) {
  const respuesta = await fetch(`${SUPABASE_URL}/rest/v1/${ruta}`, {
    ...init,
    headers: {
      apikey: CLAVE_ANONIMA,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(10_000),
  })
  return { estado: respuesta.status, cuerpo: await respuesta.json().catch(() => null) }
}

// ---- Pantalla ----

async function capturar(page: Page, nombre: string, { dialogo = false }: { dialogo?: boolean } = {}) {
  if (!CAPTURAR) return
  const ancho = (page.viewportSize()?.width ?? 1280) < 640 ? 'movil-375' : 'escritorio-1280'
  fs.mkdirSync(EVIDENCIA, { recursive: true })
  await capturarSinHerramientas(page, path.join(EVIDENCIA, `${ancho}-${nombre}.png`), {
    paginaCompleta: !dialogo,
  })
}

async function exigirSinDesbordeHorizontal(page: Page, contexto: string) {
  const medida = await page.evaluate(() => ({
    desplazamiento: document.documentElement.scrollWidth,
    visible: document.documentElement.clientWidth,
  }))
  expect(
    medida.desplazamiento,
    `${contexto}: la página se desplaza horizontalmente (${medida.desplazamiento} > ${medida.visible})`
  ).toBeLessThanOrEqual(medida.visible)
}

function etiquetaDeAncho(vista: { width: number }) {
  return vista.width < 640 ? 'movil-375' : 'escritorio-1280'
}

// ---- Matriz de la API ----

type Llamada = { metodo: 'GET' | 'POST' | 'PATCH'; ruta: string; datos?: Record<string, unknown> }

function datosPersonales(f: Fixture, extra: Record<string, unknown> = {}) {
  return {
    nombre: f.nombre,
    apellido: f.apellido,
    dni: f.dni,
    fecha_nacimiento: null,
    telefono: null,
    direccion: null,
    legajo_nro: null,
    ...extra,
  }
}

/** Cada endpoint y método nuevo de EPT-59, con cuerpos válidos sobre un legajo real. */
function matrizDeEndpoints(): Llamada[] {
  const id = F.matriz.id
  const operacion = randomUUID()
  return [
    { metodo: 'GET', ruta: '/api/usuarios' },
    { metodo: 'GET', ruta: `/api/usuarios/${id}` },
    { metodo: 'PATCH', ruta: `/api/usuarios/${id}`, datos: datosPersonales(F.matriz, { telefono: '0362 4999999' }) },
    { metodo: 'POST', ruta: `/api/usuarios/${id}/rol`, datos: { rol_esperado: 'PERSONAL', rol_nuevo: 'PADRE', motivo: MOTIVO } },
    { metodo: 'POST', ruta: `/api/usuarios/${id}/acceso`, datos: { estado_esperado: 'HABILITADO', estado_nuevo: 'BLOQUEADO', motivo: MOTIVO } },
    { metodo: 'POST', ruta: `/api/usuarios/${id}/acceso/sincronizar` },
    { metodo: 'GET', ruta: `/api/usuarios/${id}/historial` },
    {
      metodo: 'POST',
      ruta: '/api/usuarios/vinculos',
      datos: { operacion_id: operacion, perfil_id: id, dni: F.matriz.dni, modalidad: 'TITULAR', documento_verificado: true },
    },
    { metodo: 'GET', ruta: `/api/usuarios/vinculos/${operacion}` },
    { metodo: 'POST', ruta: `/api/usuarios/vinculos/${operacion}/desafio`, datos: { correo: CORREO_MATRIZ } },
    { metodo: 'POST', ruta: `/api/usuarios/vinculos/${operacion}/verificacion`, datos: { codigo: '123456', contrasena: 'contrasena-de-prueba' } },
    { metodo: 'POST', ruta: `/api/usuarios/vinculos/${operacion}/cancelacion` },
  ]
}

function pedir(contexto: APIRequestContext, llamada: Llamada) {
  return contexto.fetch(llamada.ruta, { method: llamada.metodo, data: llamada.datos })
}

/** Cada endpoint rechaza al actor con el estado y el código esperados, y nada cambia. */
async function exigirMatrizDenegada(contexto: APIRequestContext, estado: 401 | 403, codigo: string) {
  for (const llamada of matrizDeEndpoints()) {
    const respuesta = await pedir(contexto, llamada)
    const contexto_ = `${llamada.metodo} ${llamada.ruta.replace(/[0-9a-f-]{36}/gu, ':id')}`
    expect(respuesta.status(), contexto_).toBe(estado)
    expect(respuesta.headers()['cache-control'] ?? '', contexto_).toContain('no-store')
    const texto = await respuesta.text()
    const cuerpo = JSON.parse(texto) as { error: string; codigo: string }
    expect(cuerpo.codigo, contexto_).toBe(codigo)
    exigirMensajeSinDetalleTecnico(contexto_, cuerpo.error)
    expect(texto, `${contexto_}: la respuesta no menciona a la persona`).not.toContain(F.matriz.dni)
    expect(texto).not.toContain(F.matriz.apellido)
  }
  expect(rolYAcceso(F.matriz.id)).toBe('PERSONAL|HABILITADO')
  expect(sql(`SELECT COALESCE(telefono, '') FROM public.perfiles WHERE id = '${F.matriz.id}';`)).toBe('')
  expect(contar(`FROM public.perfiles_historial WHERE perfil_id = '${F.matriz.id}'`)).toBe(0)
  expect(contar(`FROM app_private.vinculos_cuenta WHERE perfil_id = '${F.matriz.id}'`)).toBe(0)
}

// ================================================================
// Siembra por proyecto
// ================================================================

test.beforeAll(async () => {
  exigirLocal()
  limpiarFixtures()
  await sembrarFixtures()
})

test.afterAll(() => {
  limpiarFixtures()
})

// ================================================================
// DIRECTOR habilitado
// ================================================================

test.describe('DIRECTOR autenticado — usuarios y permisos (EPT-59)', () => {
  test('sin sesión, cada endpoint nuevo responde 401 y la pantalla de bloqueo lleva al inicio de sesión', async ({
    browser,
  }) => {
    const anonimo = await crearContexto.newContext({
      baseURL: BASE_URL,
      storageState: { cookies: [], origins: [] },
    })
    try {
      await exigirMatrizDenegada(anonimo, 401, 'NO_AUTENTICADO')
    } finally {
      await anonimo.dispose()
    }

    const contexto = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    try {
      const pagina = await contexto.newPage()
      await pagina.goto('/acceso-bloqueado')
      await expect(pagina).toHaveURL(/\/login(?:\?|$)/u)
    } finally {
      await contexto.close()
    }
  })

  test('la API de la dirección lista, consulta, edita, cambia rol y acceso y reserva un vínculo', async ({
    request,
  }) => {
    const id = F.api.id

    const listado = await request.get(`/api/usuarios?busqueda=${F.api.dni}`)
    expect(listado.status()).toBe(200)
    expect(listado.headers()['cache-control']).toContain('no-store')
    const pagina = await listado.json()
    expect(pagina.total).toBe(1)
    expect(pagina.usuarios[0]).toMatchObject({ id, rol: 'PERSONAL', estado_acceso: 'HABILITADO', tiene_cuenta: false })
    expect(Object.keys(pagina.usuarios[0])).not.toContain('correo')

    // La búsqueda busca los comodines literalmente.
    const comodin = await request.get(`/api/usuarios?busqueda=${encodeURIComponent('%')}`)
    expect(comodin.status()).toBe(200)
    expect((await comodin.json()).total).toBe(0)

    const detalle = await request.get(`/api/usuarios/${id}`)
    expect(detalle.status()).toBe(200)
    const datos = await detalle.json()
    expect(datos).toMatchObject({ id, puede_vincular: true, vinculo_disponible: true, correo_enmascarado: null })

    const edicion = await request.patch(`/api/usuarios/${id}`, { data: datosPersonales(F.api, { telefono: '0362 4111111' }) })
    expect(edicion.status()).toBe(200)
    expect(sql(`SELECT telefono FROM public.perfiles WHERE id = '${id}';`)).toBe('0362 4111111')

    const rol = await request.post(`/api/usuarios/${id}/rol`, {
      data: { rol_esperado: 'PERSONAL', rol_nuevo: 'PADRE', motivo: MOTIVO },
    })
    expect(rol.status()).toBe(200)
    expect(await rol.json()).toMatchObject({ perfil_id: id, rol: 'PADRE' })

    const historial = await request.get(`/api/usuarios/${id}/historial`)
    expect(historial.status()).toBe(200)
    expect((await historial.json()).historial[0]).toMatchObject({
      tipo: 'ROL',
      valor_anterior: 'PERSONAL',
      valor_nuevo: 'PADRE',
      motivo: MOTIVO,
      actor_nombre: 'Ana',
      actor_apellido: 'Directora',
    })

    const bloqueo = await request.post(`/api/usuarios/${id}/acceso`, {
      data: { estado_esperado: 'HABILITADO', estado_nuevo: 'BLOQUEADO', motivo: MOTIVO },
    })
    expect(bloqueo.status()).toBe(200)
    expect(await bloqueo.json()).toMatchObject({ estado_acceso: 'BLOQUEADO', tiene_cuenta: false, auth_sincronizado: true })
    const reactivacion = await request.post(`/api/usuarios/${id}/acceso`, {
      data: { estado_esperado: 'BLOQUEADO', estado_nuevo: 'HABILITADO', motivo: MOTIVO },
    })
    expect(reactivacion.status()).toBe(200)

    const sincronizacion = await request.post(`/api/usuarios/${id}/acceso/sincronizar`)
    expect(sincronizacion.status()).toBe(200)
    expect(await sincronizacion.json()).toMatchObject({ estado_acceso: 'HABILITADO', auth_sincronizado: true })

    // Vínculo D5: reserva idempotente, código enviado y nunca devuelto.
    const operacion = randomUUID()
    const reserva = { operacion_id: operacion, perfil_id: id, dni: F.api.dni, modalidad: 'TITULAR', documento_verificado: true }
    const primera = await request.post('/api/usuarios/vinculos', { data: reserva })
    expect(primera.status()).toBe(201)
    const segunda = await request.post('/api/usuarios/vinculos', { data: reserva })
    expect(segunda.status()).toBe(200)

    const consulta = await request.get(`/api/usuarios/vinculos/${operacion}`)
    expect(consulta.status()).toBe(200)
    const estadoReserva = await consulta.json()
    expect(estadoReserva).toMatchObject({ estado: 'PENDIENTE', desafio_emitido: false })
    for (const clave of ['cuenta_id', 'desafio_hash', 'correo']) expect(Object.keys(estadoReserva)).not.toContain(clave)

    await borrarBuzon(CORREO_MATRIZ)
    const vistos = new Set(await idsDeMensajes(CORREO_MATRIZ))
    const envio = await request.post(`/api/usuarios/vinculos/${operacion}/desafio`, { data: { correo: CORREO_MATRIZ } })
    expect(envio.status()).toBe(202)
    const textoEnvio = await envio.text()
    expect(JSON.parse(textoEnvio)).toMatchObject({ enviado: true, correo_enmascarado: 'm***@ept.local' })
    const codigo = await codigoNuevo(CORREO_MATRIZ, vistos)
    expect(textoEnvio.includes(codigo), 'la respuesta del envío no trae el código').toBe(false)
    expect(Object.keys(JSON.parse(textoEnvio))).not.toContain('codigo')

    const incorrecto = codigo === '000000' ? '111111' : '000000'
    const verificacion = await request.post(`/api/usuarios/vinculos/${operacion}/verificacion`, {
      data: { codigo: incorrecto, contrasena: 'contrasena-de-prueba' },
    })
    expect(verificacion.status()).toBe(422)
    const rechazo = await verificacion.json()
    expect(rechazo).toMatchObject({ codigo: 'CODIGO_INCORRECTO', intentos_restantes: 4 })
    exigirMensajeSinDetalleTecnico('código incorrecto', rechazo.error)

    const cancelacion = await request.post(`/api/usuarios/vinculos/${operacion}/cancelacion`)
    expect(cancelacion.status()).toBe(200)
    expect(await cancelacion.json()).toMatchObject({ estado: 'CANCELADA' })
    expect(sql(`SELECT user_id IS NULL FROM public.perfiles WHERE id = '${id}';`)).toBe('t')
    await borrarBuzon(CORREO_MATRIZ)
  })

  test('404, 405, 409 y 422 con mensajes de dominio y sin cambios', async ({ request }) => {
    const inexistente = '00000000-0000-4000-8000-00000000abcd'
    for (const ruta of [`/api/usuarios/${inexistente}`, '/api/usuarios/no-es-un-identificador', `/api/usuarios/${inexistente}/historial`]) {
      const respuesta = await request.get(ruta)
      expect(respuesta.status(), ruta).toBe(404)
      const cuerpo = await respuesta.json()
      expect(cuerpo.codigo).toBe('PERFIL_INEXISTENTE')
      exigirMensajeSinDetalleTecnico(ruta, cuerpo.error)
    }
    const reserva = await request.get(`/api/usuarios/vinculos/${inexistente}`)
    expect(reserva.status()).toBe(404)
    expect((await reserva.json()).codigo).toBe('RESERVA_INEXISTENTE')

    for (const [metodo, ruta] of [
      ['PUT', `/api/usuarios/${F.matriz.id}`],
      ['DELETE', `/api/usuarios/${F.matriz.id}`],
      ['GET', `/api/usuarios/${F.matriz.id}/rol`],
      ['GET', `/api/usuarios/${F.matriz.id}/acceso`],
      ['DELETE', '/api/usuarios/vinculos'],
      ['PATCH', `/api/usuarios/vinculos/${inexistente}`],
    ] as const) {
      expect((await request.fetch(ruta, { method: metodo })).status(), `${metodo} ${ruta}`).toBe(405)
    }

    // Rol obsoleto: la pantalla mostraba DOCENTE, pero la persona es PERSONAL.
    const obsoleto = await request.post(`/api/usuarios/${F.matriz.id}/rol`, {
      data: { rol_esperado: 'DOCENTE', rol_nuevo: 'PADRE', motivo: MOTIVO },
    })
    expect(obsoleto.status()).toBe(409)
    expect((await obsoleto.json()).codigo).toBe('VALOR_OBSOLETO')

    for (const [ruta, datos] of [
      [`/api/usuarios/${F.matriz.id}/rol`, { rol_esperado: 'PERSONAL', rol_nuevo: 'PADRE', motivo: 'abc' }],
      [`/api/usuarios/${F.matriz.id}/acceso`, { estado_esperado: 'HABILITADO', estado_nuevo: 'BLOQUEADO', motivo: '    ' }],
    ] as const) {
      const respuesta = await request.post(ruta, { data: datos })
      expect(respuesta.status(), ruta).toBe(422)
      const cuerpo = await respuesta.json()
      expect(cuerpo.codigo).toBe('MOTIVO_INVALIDO')
      exigirMensajeSinDetalleTecnico(ruta, cuerpo.error)
    }

    const transicionEstudiante = await request.post(`/api/usuarios/${F.matriz.id}/rol`, {
      data: { rol_esperado: 'PERSONAL', rol_nuevo: 'ESTUDIANTE', motivo: MOTIVO },
    })
    expect(transicionEstudiante.status()).toBe(422)
    expect((await transicionEstudiante.json()).codigo).toBe('TRANSICION_ESTUDIANTE')

    // Sobre la propia cuenta: ni rol ni acceso.
    const propio = sql(`SELECT id FROM public.perfiles WHERE dni = '${DNI_DIRECTORA}';`)
    for (const [ruta, datos] of [
      [`/api/usuarios/${propio}/rol`, { rol_esperado: 'DIRECTOR', rol_nuevo: 'PERSONAL', motivo: MOTIVO }],
      [`/api/usuarios/${propio}/acceso`, { estado_esperado: 'HABILITADO', estado_nuevo: 'BLOQUEADO', motivo: MOTIVO }],
    ] as const) {
      const respuesta = await request.post(ruta, { data: datos })
      expect(respuesta.status(), ruta).toBe(403)
      expect((await respuesta.json()).codigo).toBe('OPERACION_PROPIA')
    }

    expect(rolYAcceso(F.matriz.id)).toBe('PERSONAL|HABILITADO')
    expect(rolYAcceso(propio)).toBe('DIRECTOR|HABILITADO')
    expect(contar(`FROM public.perfiles_historial WHERE perfil_id = '${F.matriz.id}'`)).toBe(0)
  })

  test('la regla del último Director efectivo responde 409 y no cambia nada', async ({ request }) => {
    const cierre = sql(`SELECT id FROM public.perfiles WHERE dni = '${DNI_DIRECTORA_CIERRE}';`)
    const usuarioDirectora = sql(`SELECT user_id FROM public.perfiles WHERE dni = '${DNI_DIRECTORA}';`)
    // La directora de la sesión deja de contar como Director efectivo (correo
    // sin confirmar) solo durante esta prueba. Si la base local tuviera otro
    // Director efectivo, la regla no sería alcanzable sin tocar datos ajenos.
    // Se guarda el valor exacto para restituirlo tal cual (auditoría, ronda 2).
    const confirmadaEn = sql(`SELECT email_confirmed_at::TEXT FROM auth.users WHERE id = '${usuarioDirectora}';`)
    sql(`UPDATE auth.users SET email_confirmed_at = NULL WHERE id = '${usuarioDirectora}';`)
    try {
      const otros = Number(sql(`SELECT app_private.contar_directores_efectivos('${cierre}'::uuid);`))
      test.skip(otros !== 0, 'La base local tiene otro Director efectivo: la regla no es alcanzable con estos datos.')

      const respuesta = await request.post(`/api/usuarios/${cierre}/rol`, {
        data: { rol_esperado: 'DIRECTOR', rol_nuevo: 'PERSONAL', motivo: MOTIVO },
      })
      expect(respuesta.status()).toBe(409)
      const cuerpo = await respuesta.json()
      expect(cuerpo.codigo).toBe('ULTIMO_DIRECTOR')
      exigirMensajeSinDetalleTecnico('último Director', cuerpo.error)

      const bloqueo = await request.post(`/api/usuarios/${cierre}/acceso`, {
        data: { estado_esperado: 'HABILITADO', estado_nuevo: 'BLOQUEADO', motivo: MOTIVO },
      })
      expect(bloqueo.status()).toBe(409)
      expect((await bloqueo.json()).codigo).toBe('ULTIMO_DIRECTOR')
      expect(rolYAcceso(cierre)).toBe('DIRECTOR|HABILITADO')
    } finally {
      sql(
        confirmadaEn
          ? `UPDATE auth.users SET email_confirmed_at = '${confirmadaEn}'::timestamptz WHERE id = '${usuarioDirectora}';`
          : `UPDATE auth.users SET email_confirmed_at = now() WHERE id = '${usuarioDirectora}';`
      )
    }
  })

  test('el listado busca, muestra el estado de la cuenta sin el correo completo y se reintenta ante un error', async ({
    page,
  }) => {
    await page.setViewportSize(ESCRITORIO)
    // Falla hasta que la prueba lo decida: en desarrollo, React monta dos veces
    // y descarta la primera petición, así que «fallar solo una vez» no alcanza.
    let fallar = true
    await page.route(
      (url) => url.pathname === '/api/usuarios',
      async (ruta) => {
        if (fallar && ruta.request().method() === 'GET') {
          await ruta.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({
              error: 'No pudimos completar la operación. Volvé a intentarlo en unos minutos.',
              codigo: 'ERROR_INESPERADO',
            }),
          })
          return
        }
        await ruta.continue()
      }
    )

    await page.goto('/dashboard/usuarios')
    const seccion = page.locator('#cuentas-y-perfiles')
    await expect(seccion.getByRole('heading', { name: 'Cuentas y perfiles' })).toBeVisible()
    const aviso = seccion.getByRole('alert').filter({ hasText: 'No pudimos cargar el listado' })
    await expect(aviso).toBeVisible()
    await exigirPantallaSinDetalleTecnico(page, 'error de carga del listado')
    fallar = false
    await aviso.getByRole('button', { name: 'Reintentar' }).click()

    const tabla = seccion.getByRole('table', { name: 'Cuentas y perfiles' })
    await expect(tabla).toBeVisible()

    // El alta con cuenta sigue en la misma pantalla.
    await expect(page.getByRole('link', { name: 'Crear usuario con cuenta' })).toHaveAttribute('href', '#alta-usuario')
    await expect(page.getByRole('heading', { name: 'Nuevo usuario' })).toBeVisible()

    const busqueda = seccion.getByLabel('Buscar por nombre, apellido, DNI o legajo')
    await busqueda.fill('Cambiante')
    await expect(tabla.getByRole('row')).toHaveCount(2)
    const fila = tabla.getByRole('row').filter({ hasText: F.rol.dni })
    await expect(fila).toContainText('Rosa Cambiante')
    await expect(fila).toContainText('PERSONAL')
    await expect(fila).toContainText('Habilitado')
    await expect(fila).toContainText('Sin cuenta')
    await expect(fila.getByRole('link', { name: 'Rosa Cambiante' })).toHaveAttribute('href', `/dashboard/usuarios/${F.rol.id}`)

    await busqueda.fill(DNI_DIRECTORA)
    const directora = tabla.getByRole('row').filter({ hasText: DNI_DIRECTORA })
    await expect(directora).toContainText('Activa')
    await expect(directora).toContainText('d***@ept.local')
    expect(await page.content()).not.toContain('directora.prueba@ept.local')

    await busqueda.fill('Inexistentezzq')
    await expect(seccion.getByText('Ninguna persona coincide con la búsqueda')).toBeVisible()

    await busqueda.fill('Cambiante')
    await expect(tabla.getByRole('row')).toHaveCount(2)
    await exigirContraste(page, 'listado de cuentas y perfiles', {
      raiz: '#cuentas-y-perfiles',
      esenciales: ['#cuentas-y-perfiles h2', '#cuentas-y-perfiles th', '#cuentas-y-perfiles td a'],
    })
    await exigirPantallaSinDetalleTecnico(page, 'listado de cuentas y perfiles')
  })

  test('el detalle edita los datos personales con las validaciones de Legajos', async ({ page }) => {
    await page.setViewportSize(ESCRITORIO)
    await page.goto('/dashboard/usuarios')
    const seccion = page.locator('#cuentas-y-perfiles')
    await seccion.getByLabel('Buscar por nombre, apellido, DNI o legajo').fill(F.datos.dni)
    await seccion.getByRole('table', { name: 'Cuentas y perfiles' }).getByRole('link', { name: 'Dora Editable' }).click()
    await expect(page).toHaveURL(new RegExp(`/dashboard/usuarios/${F.datos.id}$`, 'u'))
    await expect(page.getByRole('heading', { level: 1, name: 'Dora Editable' })).toBeVisible()
    for (const titulo of ['Datos personales', 'Rol', 'Acceso', 'Cuenta', 'Historial']) {
      await expect(page.getByRole('heading', { level: 2, name: titulo, exact: true })).toBeVisible()
    }

    const formulario = page.getByRole('form', { name: 'Datos personales' })
    await formulario.getByLabel('DNI').fill('12ab')
    await formulario.getByRole('button', { name: 'Guardar datos personales' }).click()
    await expect(formulario.getByText('El DNI debe tener entre 7 y 8 dígitos numéricos')).toBeVisible()

    await formulario.getByLabel('DNI').fill(F.datos.dni)
    await formulario.getByLabel('Teléfono').fill('0362 4555555')
    await formulario.getByLabel('Dirección').fill('Calle de Prueba 123')
    await formulario.getByRole('button', { name: 'Guardar datos personales' }).click()
    await expect(formulario.getByRole('status')).toHaveText('Datos personales guardados.')
    expect(sql(`SELECT telefono || '|' || direccion FROM public.perfiles WHERE id = '${F.datos.id}';`)).toBe(
      '0362 4555555|Calle de Prueba 123'
    )
    await exigirSinControlesAnidados(page, 'detalle de usuario')
    await exigirContraste(page, 'detalle de usuario', {
      raiz: 'main',
      esenciales: ['main h1', 'main h2', 'main label'],
    })
  })

  test('cambia el rol con motivo, lo registra en el historial y explica un rol obsoleto', async ({ page }) => {
    await page.setViewportSize(ESCRITORIO)
    await page.goto(`/dashboard/usuarios/${F.rol.id}`)
    await page.getByRole('button', { name: 'Cambiar rol' }).click()
    const dialogo = page.getByRole('dialog', { name: 'Cambiar rol' })
    await expect(dialogo).toBeVisible()
    await expect(page.locator('#titulo-cambio-rol')).toBeFocused()

    const opciones = await dialogo.getByLabel('Rol nuevo').locator('option').allTextContents()
    // Sin cuenta confirmada no se ofrece DIRECTOR; ESTUDIANTE nunca.
    expect(opciones).toEqual(['Seleccionar rol', 'DOCENTE', 'PADRE'])
    await expect(dialogo).toContainText('El rol ESTUDIANTE no se asigna ni se quita desde acá')
    await expect(dialogo).toContainText('El rol DIRECTOR solo se asigna a una persona con cuenta confirmada.')

    await dialogo.getByLabel('Rol nuevo').selectOption('PADRE')
    await dialogo.getByLabel('Motivo').fill('abc')
    await dialogo.getByRole('button', { name: 'Confirmar cambio de rol' }).click()
    await expect(dialogo.getByText('Escribí un motivo de entre 5 y 500 caracteres.')).toBeVisible()

    await dialogo.getByLabel('Motivo').fill('Cambio de función administrativa')
    await expect(dialogo).toContainText('32 de 500 caracteres')
    await dialogo.getByRole('button', { name: 'Confirmar cambio de rol' }).click()
    await expect(dialogo).toHaveCount(0)
    await expect(page.getByRole('status').filter({ hasText: 'Rol de Rosa Cambiante cambiado a PADRE.' })).toBeVisible()
    await expect(page.locator('#seccion-rol')).toContainText('PADRE')
    expect(rolYAcceso(F.rol.id)).toBe('PADRE|HABILITADO')

    const historial = page.getByRole('table', { name: 'Historial de cambios' })
    const fila = historial.getByRole('row').filter({ hasText: 'Cambio de función administrativa' })
    await expect(fila).toContainText('Rol')
    await expect(fila).toContainText('PERSONAL')
    await expect(fila).toContainText('PADRE')
    await expect(fila).toContainText('Ana Directora')

    // Otra persona cambió el rol mientras el diálogo estaba abierto.
    await page.getByRole('button', { name: 'Cambiar rol' }).click()
    await expect(dialogo).toBeVisible()
    sql(`UPDATE public.perfiles SET rol_id = (SELECT id FROM public.roles WHERE nombre = 'PERSONAL')
         WHERE id = '${F.rol.id}';`)
    await dialogo.getByLabel('Rol nuevo').selectOption('PERSONAL')
    await dialogo.getByLabel('Motivo').fill('Vuelve a su función anterior')
    await dialogo.getByRole('button', { name: 'Confirmar cambio de rol' }).click()
    await expect(dialogo).toHaveCount(0)
    await expect(page.getByRole('alert').filter({ hasText: 'Los datos cambiaron mientras los consultabas' })).toBeVisible()
    await expect(page.locator('#seccion-rol')).toContainText('PERSONAL')
    expect(contar(`FROM public.perfiles_historial WHERE perfil_id = '${F.rol.id}'`)).toBe(1)
    await exigirPantallaSinDetalleTecnico(page, 'rol obsoleto')
  })

  test('el diálogo de rol se opera solo con teclado y devuelve el foco', async ({ page }) => {
    await page.setViewportSize(ESCRITORIO)
    await page.goto(`/dashboard/usuarios/${F.teclado.id}`)
    const boton = page.getByRole('button', { name: 'Cambiar rol' })
    const titulo = page.locator('#titulo-cambio-rol')
    const dialogo = page.getByRole('dialog', { name: 'Cambiar rol' })

    await boton.focus()
    await page.keyboard.press('Enter')
    await expect(titulo).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialogo).toHaveCount(0)
    await expect(boton).toBeFocused()

    await page.keyboard.press('Enter')
    await expect(titulo).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(dialogo.getByRole('button', { name: 'Cerrar diálogo' })).toBeFocused()
    await page.keyboard.press('Tab')
    const selector = dialogo.getByLabel('Rol nuevo')
    await expect(selector).toBeFocused()
    await page.keyboard.type('PA')
    await expect(selector).toHaveValue('PADRE')
    await page.keyboard.press('Tab')
    await expect(dialogo.getByLabel('Motivo')).toBeFocused()
    await page.keyboard.type('Reasignación de tareas')
    await page.keyboard.press('Tab')
    await expect(dialogo.getByRole('button', { name: 'Cancelar' })).toBeFocused()
    await page.keyboard.press('Tab')
    const confirmar = dialogo.getByRole('button', { name: 'Confirmar cambio de rol' })
    await expect(confirmar).toBeFocused()
    // Tab desde el último control vuelve al primero: el foco no sale del diálogo.
    await page.keyboard.press('Tab')
    await expect(dialogo.getByRole('button', { name: 'Cerrar diálogo' })).toBeFocused()
    await confirmar.focus()
    await page.keyboard.press('Enter')

    await expect(dialogo).toHaveCount(0)
    await expect(page.getByRole('status').filter({ hasText: 'cambiado a PADRE' })).toBeVisible()
    await expect(boton).toBeFocused()
    expect(rolYAcceso(F.teclado.id)).toBe('PADRE|HABILITADO')
  })

  test('bloquea y reactiva una cuenta real, sincroniza Auth y lo muestra en la cuenta y el historial', async ({
    page,
  }) => {
    await page.setViewportSize(ESCRITORIO)
    const admin = clienteAdmin()
    const perfilId = idConCuenta()
    const userId = sql(`SELECT user_id FROM public.perfiles WHERE id = '${perfilId}';`)
    const baneada = async () => {
      const { data } = await admin.auth.admin.getUserById(userId)
      const hasta = (data.user as { banned_until?: string | null } | null)?.banned_until
      return Boolean(hasta && new Date(hasta).getTime() > Date.now())
    }

    await page.goto(`/dashboard/usuarios/${perfilId}`)
    const cuenta = page.locator('#seccion-cuenta')
    const acceso = page.locator('#seccion-acceso')
    await expect(cuenta).toContainText('Activa')
    await expect(cuenta).toContainText('a***@ept.local')
    expect(await page.content()).not.toContain(CON_CUENTA.email)

    await acceso.getByRole('button', { name: 'Bloquear acceso' }).click()
    const dialogo = page.getByRole('dialog', { name: 'Bloquear acceso' })
    await expect(page.locator('#titulo-cambio-acceso')).toBeFocused()
    await dialogo.getByLabel('Motivo').fill('Licencia prolongada sin goce')
    await capturar(page, 'bloqueo-confirmacion', { dialogo: true })
    await dialogo.getByRole('button', { name: 'Confirmar bloqueo' }).click()
    await expect(dialogo).toHaveCount(0)
    await expect(page.getByRole('status').filter({ hasText: 'Acceso de Aldo Acceso bloqueado.' })).toBeVisible()
    await expect(acceso).toContainText('Bloqueado')
    await expect(cuenta).toContainText('Ingreso bloqueado')
    await expect(acceso.getByText('La cuenta de ingreso todavía no refleja este estado')).toHaveCount(0)
    expect(rolYAcceso(perfilId)).toBe('PERSONAL|BLOQUEADO')
    expect(await baneada()).toBe(true)
    await capturar(page, 'bloqueo-resultado')

    // La cuenta quedó sin baneo (Auth pendiente): la pantalla lo detecta y lo repara.
    await admin.auth.admin.updateUserById(userId, { ban_duration: 'none' })
    await page.reload()
    const aviso = acceso.getByText('La cuenta de ingreso todavía no refleja este estado')
    await expect(aviso).toBeVisible()
    await acceso.getByRole('button', { name: 'Reintentar sincronización' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'La cuenta quedó sincronizada' })).toBeVisible()
    await expect(aviso).toHaveCount(0)
    expect(await baneada()).toBe(true)

    // Auditoría, ronda 2 (B1): con la cuenta baneada, el inicio de sesión
    // explica el bloqueo en español y no muestra el texto de GoTrue.
    const contextoIngreso = await page.context().browser()!.newContext({ storageState: { cookies: [], origins: [] } })
    try {
      const ingreso = await contextoIngreso.newPage()
      await ingreso.goto('/login')
      await ingreso.getByLabel('Email institucional').fill(CON_CUENTA.email)
      await ingreso.getByLabel('Contraseña').fill(CON_CUENTA.password)
      await ingreso.getByRole('button', { name: /ingresar|iniciar/iu }).click()
      await expect(ingreso.getByText('Tu acceso está bloqueado. Comunicate con Dirección.')).toBeVisible()
      await expect(ingreso.getByText(/banned/iu)).toHaveCount(0)
      await expect(ingreso).toHaveURL(/\/login/u)
    } finally {
      await contextoIngreso.close()
    }

    await acceso.getByRole('button', { name: 'Reactivar acceso' }).click()
    const reactivar = page.getByRole('dialog', { name: 'Reactivar acceso' })
    await reactivar.getByLabel('Motivo').fill('Regreso de la licencia')
    await reactivar.getByRole('button', { name: 'Confirmar reactivación' }).click()
    await expect(reactivar).toHaveCount(0)
    await expect(acceso).toContainText('Habilitado')
    await expect(cuenta).toContainText('Activa')
    expect(rolYAcceso(perfilId)).toBe('PERSONAL|HABILITADO')
    expect(await baneada()).toBe(false)

    const historial = page.getByRole('table', { name: 'Historial de cambios' })
    await expect(historial.getByRole('row').filter({ hasText: 'Licencia prolongada sin goce' })).toContainText('Bloqueado')
    await expect(historial.getByRole('row').filter({ hasText: 'Regreso de la licencia' })).toContainText('Habilitado')
  })

  for (const [vista, fixture, correo, modalidad] of [
    [ESCRITORIO, F.vinculo, 'vinculo.e2e59.prueba@ept.local', 'TITULAR'],
    [MOVIL, F.vinculoMovil, 'vinculo.movil.e2e59.prueba@ept.local', 'REPRESENTANTE'],
  ] as const) {
    test(`asistente D5 de punta a punta con el código real de Mailpit (${etiquetaDeAncho(vista)})`, async ({
      page,
    }) => {
      test.setTimeout(120_000)
      await page.setViewportSize(vista)
      await borrarBuzon(correo)
      const vistos = new Set(await idsDeMensajes(correo))
      const respuestas: Promise<string>[] = []
      page.on('response', (respuesta) => {
        if (respuesta.url().includes('/api/usuarios/vinculos')) {
          respuestas.push(respuesta.text().catch(() => ''))
        }
      })
      const nombre = `${fixture.nombre} ${fixture.apellido}`
      const contrasena = 'prueba-ept-59-vinculo'

      await page.goto(`/dashboard/usuarios/${fixture.id}`)
      await page.getByRole('button', { name: 'Vincular cuenta' }).click()
      const dialogo = page.getByRole('dialog', { name: `Vincular cuenta de ${nombre}` })
      const paso = page.locator('#titulo-paso-vinculo')
      await expect(paso).toHaveText('Paso 1 de 4: Identidad presencial')
      await expect(paso).toBeFocused()
      await exigirSinDesbordeHorizontal(page, 'asistente, paso 1')
      await capturar(page, 'asistente-d5-paso-1', { dialogo: true })

      // Sin la constancia de verificación presencial no se reserva nada.
      await dialogo.getByLabel('DNI de la persona').fill(fixture.dni)
      await dialogo.getByRole('button', { name: 'Continuar' }).click()
      await expect(dialogo.getByText('Confirmá que verificaste presencialmente el documento.')).toBeVisible()
      expect(contar(`FROM app_private.vinculos_cuenta WHERE perfil_id = '${fixture.id}'`)).toBe(0)

      // Un DNI que no coincide con el legajo se rechaza en la base.
      await dialogo.getByLabel('DNI de la persona').fill('99959199')
      await dialogo.getByLabel('Verifiqué presencialmente el documento de la persona que realiza el trámite').check()
      if (modalidad === 'REPRESENTANTE') {
        await dialogo.getByLabel('Un representante autorizado').check()
        await dialogo.getByLabel('DNI del representante').fill('99959198')
      }
      await dialogo.getByRole('button', { name: 'Continuar' }).click()
      await expect(dialogo.getByText('El DNI ingresado no coincide con el del legajo')).toBeVisible()

      await dialogo.getByLabel('DNI de la persona').fill(fixture.dni)
      await dialogo.getByRole('button', { name: 'Continuar' }).click()
      await expect(paso).toHaveText('Paso 2 de 4: Correo de la persona')
      await expect(paso).toBeFocused()
      await expect(dialogo.getByRole('timer')).toHaveText(/^\d{2}:\d{2}$/u)
      expect(
        sql(`SELECT modalidad || '|' || estado FROM app_private.vinculos_cuenta WHERE perfil_id = '${fixture.id}';`)
      ).toBe(`${modalidad}|PENDIENTE`)
      await exigirSinDesbordeHorizontal(page, 'asistente, paso 2')
      await capturar(page, 'asistente-d5-paso-2', { dialogo: true })

      await dialogo.getByLabel('Correo electrónico de la persona').fill(correo)
      await dialogo.getByRole('button', { name: 'Enviar código' }).click()
      await expect(paso).toHaveText('Paso 3 de 4: Código y contraseña')
      await expect(paso).toBeFocused()
      await expect(dialogo).toContainText('v***@ept.local')

      const codigo = await codigoNuevo(correo, vistos)
      // El código nunca está en la página antes de que la persona lo escriba:
      // ni en el HTML, ni en el valor de un campo.
      const pagina = await page.evaluate(
        () =>
          document.documentElement.outerHTML +
          '\n' +
          Array.from(document.querySelectorAll('input, textarea'))
            .map((campo) => (campo as HTMLInputElement).value)
            .join('\n')
      )
      expect(pagina.includes(codigo), 'el código aparece en la página antes de escribirlo').toBe(false)
      await expect(dialogo.getByLabel('Código de verificación')).toHaveAttribute('type', 'password')
      await expect(dialogo.getByLabel('Código de verificación')).toHaveAttribute('autocomplete', 'one-time-code')
      await expect(dialogo.getByLabel('Código de verificación')).toHaveAttribute('inputmode', 'numeric')
      await expect(dialogo.getByLabel('Contraseña nueva')).toHaveAttribute('autocomplete', 'new-password')
      await exigirSinDesbordeHorizontal(page, 'asistente, paso 3')
      await capturar(page, 'asistente-d5-paso-3', { dialogo: true })

      const incorrecto = codigo === '000000' ? '111111' : '000000'
      await dialogo.getByLabel('Código de verificación').fill(incorrecto)
      await dialogo.getByLabel('Contraseña nueva').fill(contrasena)
      await dialogo.getByLabel('Repetí la contraseña').fill(contrasena)
      await dialogo.getByRole('button', { name: 'Verificar y crear la cuenta' }).click()
      await expect(dialogo.getByText('El código no es correcto. Quedan 4 intentos.')).toBeVisible()
      await expect(dialogo.getByLabel('Código de verificación')).toHaveValue('')
      expect(sql(`SELECT user_id IS NULL FROM public.perfiles WHERE id = '${fixture.id}';`)).toBe('t')

      await dialogo.getByLabel('Código de verificación').fill(codigo)
      await dialogo.getByRole('button', { name: 'Verificar y crear la cuenta' }).click()
      await expect(paso).toHaveText('Paso 4 de 4: Resultado', { timeout: 30_000 })
      await expect(dialogo).toContainText('La cuenta quedó vinculada.')
      await exigirSinDesbordeHorizontal(page, 'asistente, paso 4')
      await capturar(page, 'asistente-d5-paso-4', { dialogo: true })

      const textos = await Promise.all(respuestas)
      expect(textos.length).toBeGreaterThanOrEqual(3)
      expect(textos.some((texto) => texto.includes(codigo)), 'una respuesta de la API trae el código').toBe(false)

      await dialogo.getByRole('button', { name: 'Cerrar', exact: true }).click()
      await expect(dialogo).toHaveCount(0)
      const cuenta = page.locator('#seccion-cuenta')
      await expect(cuenta).toContainText('Activa')
      await expect(cuenta).toContainText('v***@ept.local')
      await expect(page.locator('#seccion-historial')).toContainText('Cuenta vinculada')

      // El mismo perfil quedó enlazado a una cuenta nueva con ese correo.
      expect(
        sql(`SELECT u.email FROM public.perfiles p JOIN auth.users u ON u.id = p.user_id WHERE p.id = '${fixture.id}';`)
      ).toBe(correo)
      expect(rolYAcceso(fixture.id)).toBe(`${fixture.rol}|HABILITADO`)

      // La contraseña que eligió la persona inicia sesión.
      const ingreso = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', apikey: CLAVE_ANONIMA },
        body: JSON.stringify({ email: correo, password: contrasena }),
        signal: AbortSignal.timeout(10_000),
      })
      expect(ingreso.status).toBe(200)
      await borrarBuzon(correo)
    })
  }

  for (const vista of [ESCRITORIO, MOVIL]) {
    test(`listado, detalle y diálogos sin desplazamiento horizontal (${etiquetaDeAncho(vista)})`, async ({ page }) => {
      await page.setViewportSize(vista)
      const movil = vista.width < 768

      await page.goto('/dashboard/usuarios')
      const seccion = page.locator('#cuentas-y-perfiles')
      await seccion.getByLabel('Buscar por nombre, apellido, DNI o legajo').fill('999591')
      // Los legajos de esta suite: 8 sin cuenta y 1 con cuenta.
      await expect(seccion.getByRole('status')).toHaveText('Se encontraron 9 personas.')
      if (movil) {
        await expect(seccion.getByRole('table', { name: 'Cuentas y perfiles' })).toBeHidden()
        await expect(seccion.getByRole('list', { name: 'Cuentas y perfiles' }).getByRole('listitem').first()).toBeVisible()
      } else {
        await expect(seccion.getByRole('table', { name: 'Cuentas y perfiles' }).getByRole('row').nth(1)).toBeVisible()
        await expect(seccion.getByRole('list', { name: 'Cuentas y perfiles' })).toBeHidden()
      }
      await exigirSinDesbordeHorizontal(page, 'listado')
      await capturar(page, 'listado')

      await page.goto(`/dashboard/usuarios/${F.diseno.id}`)
      await expect(page.getByRole('heading', { level: 1, name: 'Lara Pantallas' })).toBeVisible()
      await expect(page.locator('#seccion-historial')).toContainText('Todavía no hay cambios')
      await exigirSinDesbordeHorizontal(page, 'detalle')
      await capturar(page, 'detalle')

      await page.getByRole('button', { name: 'Cambiar rol' }).click()
      await expect(page.getByRole('dialog', { name: 'Cambiar rol' })).toBeVisible()
      await exigirSinDesbordeHorizontal(page, 'diálogo de rol')
      await capturar(page, 'dialogo-rol', { dialogo: true })
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)

      await page.getByRole('button', { name: 'Bloquear acceso' }).click()
      await expect(page.getByRole('dialog', { name: 'Bloquear acceso' })).toBeVisible()
      await exigirSinDesbordeHorizontal(page, 'diálogo de bloqueo')
      await capturar(page, 'dialogo-bloqueo', { dialogo: true })
      await page.keyboard.press('Escape')
      await expect(page.getByRole('button', { name: 'Bloquear acceso' })).toBeFocused()
      expect(rolYAcceso(F.diseno.id)).toBe('PERSONAL|HABILITADO')
    })

    test(`Legajos no ofrece DIRECTOR en el alta sin cuenta (${etiquetaDeAncho(vista)})`, async ({ page }) => {
      await page.setViewportSize(vista)
      await page.goto('/dashboard/legajos')
      await page.getByRole('button', { name: 'Nuevo legajo' }).click()
      const selector = page.getByRole('combobox', { name: /^Rol/u })
      await expect(selector.locator('option')).not.toHaveCount(1)
      const opciones = await selector.locator('option').allTextContents()
      expect(opciones).not.toContain('DIRECTOR')
      expect(opciones).toEqual(expect.arrayContaining(['DOCENTE', 'PADRE', 'ESTUDIANTE', 'PERSONAL']))
      await expect(page.getByText('Para registrar a un Director, usá el alta con cuenta en Usuarios.')).toBeVisible()
      await exigirSinDesbordeHorizontal(page, 'legajos, alta sin cuenta')
      await capturar(page, 'legajos-selector')
    })
  }

  test('una sesión habilitada no se queda en la pantalla de acceso bloqueado', async ({ page }) => {
    await page.goto('/acceso-bloqueado')
    await expect(page).toHaveURL(/\/dashboard$/u)
  })
})

// ================================================================
// Actores sin permiso de dirección
// ================================================================

for (const actor of ['DOCENTE', 'ESTUDIANTE', 'PADRE', 'PERSONAL', 'SIN PERFIL'] as const) {
  test.describe(`${actor} autenticado — usuarios y permisos (EPT-59)`, () => {
    test('cada endpoint nuevo responde 403 y no cambia nada', async ({ request }) => {
      await exigirMatrizDenegada(request, 403, 'SIN_PERMISO')
    })

    test('Usuarios, su detalle y Legajos muestran «Acceso restringido»', async ({ page }) => {
      for (const ruta of ['/dashboard/usuarios', `/dashboard/usuarios/${F.matriz.id}`, '/dashboard/legajos']) {
        await page.goto(ruta)
        await expect(page.getByRole('heading', { name: 'Acceso restringido' }), ruta).toBeVisible()
        await expect(page.locator('#cuentas-y-perfiles')).toHaveCount(0)
        await expect(page.getByText(F.matriz.apellido)).toHaveCount(0)
      }
    })

    if (actor === 'PERSONAL') {
      test('PERSONAL solo tiene Inicio y Mi perfil, de solo lectura', async ({ page }) => {
        await page.setViewportSize(ESCRITORIO)
        await page.goto('/dashboard')
        const menu = page.getByRole('navigation', { name: 'Menú del dashboard' })
        await expect(menu.getByRole('link')).toHaveText(['Inicio', 'Mi perfil'])
        await expect(page.locator('main').getByRole('link', { name: /Mi perfil/u })).toBeVisible()
        await exigirSinDesbordeHorizontal(page, 'inicio de PERSONAL')
        await capturar(page, 'personal-inicio')

        await page.goto('/dashboard/perfil')
        await expect(page.getByRole('heading', { level: 1, name: 'Mi perfil' })).toBeVisible()
        await expect(page.locator('main').locator('input, textarea, select')).toHaveCount(0)
        await expect(page.locator('main').getByRole('button')).toHaveCount(0)

        for (const ruta of ['/dashboard/asistencias', '/dashboard/cupos', '/dashboard/alumnos', '/dashboard/comedor']) {
          await page.goto(ruta)
          await expect(page.getByRole('heading', { name: 'Acceso restringido' }), ruta).toBeVisible()
        }

        await page.setViewportSize(MOVIL)
        await page.goto('/dashboard')
        await expect(page.getByRole('navigation', { name: 'Navegación rápida' }).getByRole('link')).toHaveText([
          'Noticias',
          'Perfil',
        ])
        await exigirSinDesbordeHorizontal(page, 'inicio de PERSONAL (móvil)')
        await capturar(page, 'personal-inicio')
      })
    }

    if (actor === 'SIN PERFIL') {
      test('el inicio explica que falta el perfil y no ofrece ninguna sección', async ({ page }) => {
        for (const vista of [ESCRITORIO, MOVIL]) {
          await page.setViewportSize(vista)
          await page.goto('/dashboard')
          await expect(
            page.getByText('Tu cuenta todavía no tiene un perfil asociado. Comunicate con Dirección para completarlo.')
          ).toBeVisible()
          await expect(page.getByRole('navigation', { name: 'Menú del dashboard' }).getByRole('link')).toHaveCount(0)
          await exigirSinDesbordeHorizontal(page, `sin perfil (${etiquetaDeAncho(vista)})`)
          await capturar(page, 'sin-perfil')
        }
        await page.goto('/dashboard/perfil')
        await expect(page.getByRole('heading', { name: 'Acceso restringido' })).toBeVisible()
      })
    }
  })
}

// ================================================================
// Identidades BLOQUEADAS (sesión emitida antes del bloqueo)
// ================================================================

for (const bloqueado of BLOQUEADOS) {
  const archivo = `tests/.auth/${bloqueado.rol.toLowerCase()}-bloqueado.json`
  const correo = `${bloqueado.rol.toLowerCase()}.bloqueado.prueba@ept.local`

  test.describe(`${bloqueado.rol} BLOQUEADO autenticado — acceso bloqueado (EPT-59)`, () => {
    test('el panel y los enlaces directos llevan a «Acceso bloqueado», sin datos', async ({ page }) => {
      for (const ruta of ['/dashboard', ...bloqueado.rutas, `/dashboard/usuarios/${F.matriz.id}`]) {
        await page.goto(ruta)
        await expect(page, ruta).toHaveURL(/\/acceso-bloqueado$/u)
        await expect(page.getByRole('heading', { level: 1, name: 'Acceso bloqueado' })).toBeVisible()
        await expect(
          page.getByText('Dirección bloqueó el acceso de tu cuenta. Si creés que es un error, comunicate con la escuela.')
        ).toBeVisible()
        await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible()
        await expect(page.getByRole('navigation', { name: 'Menú del dashboard' })).toHaveCount(0)
        const texto = await page.locator('body').innerText()
        for (const dato of [bloqueado.apellido, bloqueado.dni, correo, F.matriz.apellido]) {
          expect(texto, `${ruta}: la pantalla muestra un dato personal`).not.toContain(dato)
        }
      }
      await exigirPantallaSinDetalleTecnico(page, 'acceso bloqueado')
      await exigirSinControlesAnidados(page, 'acceso bloqueado')

      if (bloqueado.rol === 'PERSONAL') {
        await exigirContraste(page, 'acceso bloqueado', {
          raiz: 'main',
          esenciales: ['main h1', 'main section > p', 'main button'],
          minimoMedidos: 3,
        })
        for (const vista of [ESCRITORIO, MOVIL]) {
          await page.setViewportSize(vista)
          await page.goto('/acceso-bloqueado')
          await expect(page.getByRole('heading', { name: 'Acceso bloqueado' })).toBeVisible()
          await exigirSinDesbordeHorizontal(page, `acceso bloqueado (${etiquetaDeAncho(vista)})`)
          await capturar(page, 'acceso-bloqueado')
        }
      }
    })

    test('la API y la base le niegan todo aunque el JWT siga vigente', async ({ request }) => {
      await exigirMatrizDenegada(request, 403, 'ACCESO_BLOQUEADO')
      expect((await (await request.get('/api/usuarios')).json()).error).toBe(MENSAJE_BLOQUEO)

      // Rutas que ya existían: ninguna le devuelve datos.
      const alta = await request.post('/api/usuarios', {
        data: { email: 'intruso.e2e59@ept.local', password: 'contrasena-de-prueba', nombre: 'Intruso', apellido: 'Bloqueado', dni: '99959190', rol_id: 5 },
      })
      expect(alta.status()).toBe(403)
      for (const ruta of ['/api/profesores', '/api/hijos', '/api/mis-asignaciones']) {
        expect((await request.get(ruta)).status(), ruta).toBe(403)
      }

      // PostgREST con el JWT emitido antes del bloqueo: nada de datos protegidos.
      const token = await tokenVigente(archivo, correo, `prueba-ept-59-${bloqueado.rol.toLowerCase()}-bloqueado`)
      const perfiles = await rest(token, 'perfiles?select=id,dni')
      expect(perfiles.estado).toBe(200)
      expect(perfiles.cuerpo).toEqual([])
      const historial = await rest(token, 'perfiles_historial?select=id')
      expect(historial.cuerpo).toEqual([])
      const estado = await rest(token, 'rpc/mi_estado_acceso', { method: 'POST', body: '{}' })
      expect(estado.cuerpo).toBe('BLOQUEADO')
      expect(contar(`FROM auth.users WHERE email = 'intruso.e2e59@ept.local'`)).toBe(0)
    })

    if (bloqueado.rol === 'DOCENTE') {
      test('un bloqueo durante la navegación del cliente lleva a «Acceso bloqueado»', async ({ page }) => {
        const condicion = `dni = '${bloqueado.dni}'`
        sql(`UPDATE public.perfiles SET estado_acceso = 'HABILITADO' WHERE ${condicion};`)
        try {
          await page.goto('/dashboard')
          const menu = page.getByRole('navigation', { name: 'Menú del dashboard' })
          await expect(menu.getByRole('link', { name: 'Mi perfil' })).toBeVisible()
          sql(`UPDATE public.perfiles SET estado_acceso = 'BLOQUEADO' WHERE ${condicion};`)
          await menu.getByRole('link', { name: 'Mi perfil' }).click()
          await expect(page).toHaveURL(/\/acceso-bloqueado$/u, { timeout: 15_000 })
          await expect(page.getByRole('heading', { name: 'Acceso bloqueado' })).toBeVisible()
        } finally {
          sql(`UPDATE public.perfiles SET estado_acceso = 'BLOQUEADO' WHERE ${condicion};`)
        }
      })
    }

    if (bloqueado.rol === 'PERSONAL') {
      test('«Cerrar sesión» cierra la sesión de este dispositivo', async ({ browser }) => {
        // Sesión nueva y propia: cerrar la del proyecto dejaría sin sesión a las
        // demás pruebas de esta identidad.
        const contexto = await browser.newContext({ storageState: { cookies: [], origins: [] } })
        try {
          const pagina = await contexto.newPage()
          await pagina.goto('/login')
          await pagina.getByLabel('Email institucional').fill(correo)
          await pagina.getByLabel('Contraseña').fill('prueba-ept-59-personal-bloqueado')
          await pagina.getByRole('button', { name: /ingresar|iniciar/iu }).click()
          await expect(pagina).toHaveURL(/\/acceso-bloqueado$/u, { timeout: 20_000 })
          await pagina.getByRole('button', { name: 'Cerrar sesión' }).click()
          await expect(pagina).toHaveURL(/\/login$/u, { timeout: 15_000 })
          await pagina.goto('/acceso-bloqueado')
          await expect(pagina).toHaveURL(/\/login$/u)
        } finally {
          await contexto.close()
        }
      })
    }
  })
}
