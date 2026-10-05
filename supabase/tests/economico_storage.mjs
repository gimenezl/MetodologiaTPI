/**
 * EPT-101 — Seguridad económica contra PostgREST y Storage REALES.
 *
 * Lo que ninguna prueba SQL puede mostrar: cómo se traducen las políticas al
 * servicio Storage, qué responde la API con un JWT de GoTrue y qué pasa con un
 * JWT emitido ANTES de un bloqueo, un cambio de rol o una desvinculación.
 *
 *   1. PostgREST con JWT reales por actor: lectura por tabla, embeds, RPC,
 *      escrituras rechazadas y metadata de JWT que no autoriza nada.
 *   2. Storage real con binarios sintéticos (JPEG, PNG y PDF): lectura, firma,
 *      listado y descarga como cargador y DIRECTOR; denegación al copadre, al
 *      estudiante, a ajenos, a docente, personal, anónimo y bloqueado; ruta
 *      cruzada, traversal y metadata falsa; otro bucket; subida, reemplazo,
 *      borrado, movimiento y copia de clientes (todo cerrado).
 *   3. Límites del bucket aplicados por el SERVICIO: 5242880 bytes sí,
 *      5242881 no; MIME aprobados sí, otros no (con credencial de servidor,
 *      que no pasa por la tabla de metadatos).
 *   4. URLs firmadas: TTL corto, vencimiento real, firma solo bajo las
 *      credenciales del usuario y VIGENCIA RESIDUAL de una URL ya emitida tras
 *      un bloqueo o una desvinculación (capacidad temporal, no revocable).
 *
 *     EPT_SUPABASE_WORKDIR=<dir del stack aislado> \
 *     EPT_SUPABASE_DB_CONTAINER=supabase_db_ept101 \
 *       node supabase/tests/economico_storage.mjs
 *
 * Autosuficiente: siembra su fixture (DNI 9610xxxx, correos ept101.*@ept.local) y
 * lo limpia al terminar. Solo acepta una instancia de Supabase de bucle local.
 * No imprime claves, tokens ni URLs firmadas.
 */

import { createHash, createHmac } from 'node:crypto'
import { execSync } from 'node:child_process'
import { setTimeout as esperar } from 'node:timers/promises'
import {
  afirmar,
  conteo,
  crearCuentaConPerfil,
  exigirSesion,
  limpiarFixture,
  sql,
} from './_arnes-ept59.mjs'

const BUCKET = 'comprobantes-pago'
const MAXIMO = 5 * 1024 * 1024 // 5242880
const PREFIJO_DNI = '9610'
const PREFIJO_CORREO = 'ept101.'
const DOMINIO = 'ept.local'
const CURSO = 'Curso EPT-101 storage'
const CONTRASENA = 'prueba-ept-101-storage'
const ID = (n) => `b2020000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ANFITRIONES_LOCALES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

// ================================================================
// Entorno local (con directorio de trabajo opcional del stack aislado)
// ================================================================
function entorno() {
  const dir = process.env.EPT_SUPABASE_WORKDIR
  const salida = execSync(
    `npx --yes supabase@${process.env.EPT_SUPABASE_CLI ?? '2.117.0'} status -o env` +
      (dir ? ` --workdir "${dir}"` : ''),
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }
  )
  const valores = {}
  for (const linea of salida.split(/\r?\n/u)) {
    const m = /^([A-Z0-9_]+)="?(.*?)"?$/u.exec(linea.trim())
    if (m) valores[m[1]] = m[2]
  }
  if (!valores.API_URL || !valores.SERVICE_ROLE_KEY || !valores.ANON_KEY || !valores.JWT_SECRET) {
    throw new Error('no se pudo leer la instancia local de Supabase (¿supabase start?)')
  }
  if (!ANFITRIONES_LOCALES.has(new URL(valores.API_URL).hostname)) {
    throw new Error('API_URL no es de bucle local: la suite se niega a correr')
  }
  const dockerHost = process.env.DOCKER_HOST ?? ''
  if (dockerHost && !/^(npipe|unix):/iu.test(dockerHost)) {
    throw new Error('DOCKER_HOST apunta a un daemon remoto: la suite se niega a correr')
  }
  return valores
}

const local = entorno()
const STORAGE = `${local.API_URL}/storage/v1`

// ================================================================
// HTTP
// ================================================================
async function http(metodo, url, { token, apikey, cabeceras = {}, cuerpo, json } = {}) {
  const h = { ...cabeceras }
  h.apikey = apikey ?? local.ANON_KEY
  h.authorization = `Bearer ${token ?? apikey ?? local.ANON_KEY}`
  let body = cuerpo
  if (json !== undefined) {
    h['content-type'] = 'application/json'
    body = JSON.stringify(json)
  }
  const respuesta = await fetch(url, { method: metodo, headers: h, body, signal: AbortSignal.timeout(30_000) })
  const buffer = Buffer.from(await respuesta.arrayBuffer())
  let datos = null
  try {
    datos = JSON.parse(buffer.toString('utf8'))
  } catch {
    datos = null
  }
  return { estado: respuesta.status, buffer, datos, cabeceras: respuesta.headers }
}

const rest = (token, ruta, opciones = {}) => http(opciones.metodo ?? 'GET', `${local.API_URL}/rest/v1/${ruta}`, { token, ...opciones })
const rpc = (token, funcion, argumentos) =>
  http('POST', `${local.API_URL}/rest/v1/rpc/${funcion}`, { token, json: argumentos })

/** Cabeceras de servidor (clave de servicio): solo para sembrar y verificar. */
const SERVIDOR = { apikey: local.SERVICE_ROLE_KEY, token: local.SERVICE_ROLE_KEY }

const objetoAutenticado = (token, ruta) =>
  http('GET', `${STORAGE}/object/authenticated/${BUCKET}/${ruta}`, token ? { token } : {})
const firmar = (token, ruta, expiraEn = 60) =>
  http('POST', `${STORAGE}/object/sign/${BUCKET}/${ruta}`, { token, json: { expiresIn: expiraEn } })
const listar = (token, prefijo) =>
  http('POST', `${STORAGE}/object/list/${BUCKET}`, { token, json: { prefix: prefijo, limit: 100, offset: 0 } })

const sha = (buffer) => createHash('sha256').update(buffer).digest('hex')

// ================================================================
// Binarios sintéticos reales
// ================================================================
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)
const JPG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=',
  'base64'
)
const PDF = Buffer.from(
  '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 3 3]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  'latin1'
)
const MIME = { jpg: 'image/jpeg', png: 'image/png', pdf: 'application/pdf' }
const BINARIO = { jpg: JPG, png: PNG, pdf: PDF }

// ================================================================
// JWT con el secreto local, para probar que la metadata no autoriza nada
// ================================================================
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
function firmarJwtLocal(claims) {
  const cuerpo = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    iss: 'supabase-demo',
    aud: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 600,
    role: 'authenticated',
    ...claims,
  })}`
  return `${cuerpo}.${createHmac('sha256', local.JWT_SECRET).update(cuerpo).digest('base64url')}`
}

// ================================================================
// Fixture
// ================================================================
const PERSONAS = {
  director: { dni: '96100001', rol: 'DIRECTOR', apellido: 'Directora' },
  estudianteA: { dni: '96100002', rol: 'ESTUDIANTE', apellido: 'AlumnaA', legajo_nro: 'LEG-EPT101-S2' },
  estudianteB: { dni: '96100003', rol: 'ESTUDIANTE', apellido: 'AlumnoB', legajo_nro: 'LEG-EPT101-S3' },
  docente: { dni: '96100004', rol: 'DOCENTE', apellido: 'Docente', legajo_nro: 'LEG-EPT101-S4' },
  padreA: { dni: '96100005', rol: 'PADRE', apellido: 'PadreA' },
  copadre: { dni: '96100006', rol: 'PADRE', apellido: 'CopadreA' },
  padreC: { dni: '96100007', rol: 'PADRE', apellido: 'PadreC' },
  personal: { dni: '96100008', rol: 'PERSONAL', apellido: 'Personal' },
  bloqueado: { dni: '96100009', rol: 'PADRE', apellido: 'Bloqueado' },
}
const correo = (clave) => `${PREFIJO_CORREO}${clave}@${DOMINIO}`
const rolId = (nombre) => Number(sql(`SELECT id FROM public.roles WHERE nombre = '${nombre}';`))

const IDS = {
  tarifa: ID(401), facturaA: ID(801), facturaB: ID(802), itemA: ID(901), itemB: ID(911), itemA2: ID(902),
  pagoA: ID(1001), pagoCop: ID(1002), pagoC: ID(1003),
  c1: ID(1301), c2: ID(1302), c3: ID(1303), c4: ID(1304), huerfano: ID(1399),
}
const EXT = { c1: 'jpg', c2: 'pdf', c3: 'png', c4: 'jpg' }
const PAGO_DE = { c1: IDS.pagoA, c2: IDS.pagoA, c3: IDS.pagoCop, c4: IDS.pagoC }
const ruta = (c) => `${PAGO_DE[c]}/${IDS[c]}.${EXT[c]}`
const RUTA_HUERFANA = `${IDS.pagoA}/${IDS.huerfano}.jpg`

const actores = {}
let tokenSinPerfil = ''

function limpiarEconomia() {
  sql(`
    DELETE FROM public.comprobantes_pago WHERE pago_id IN ('${IDS.pagoA}','${IDS.pagoCop}','${IDS.pagoC}');
    DELETE FROM public.recibos WHERE pago_id IN ('${IDS.pagoA}','${IDS.pagoCop}','${IDS.pagoC}');
    DELETE FROM public.imputaciones_pago WHERE pago_id IN ('${IDS.pagoA}','${IDS.pagoCop}','${IDS.pagoC}');
    DELETE FROM public.pagos WHERE id IN ('${IDS.pagoA}','${IDS.pagoCop}','${IDS.pagoC}');
    DELETE FROM public.items_factura WHERE id IN ('${IDS.itemA}','${IDS.itemB}','${IDS.itemA2}');
    DELETE FROM public.facturas WHERE id IN ('${IDS.facturaA}','${IDS.facturaB}');
    DELETE FROM public.tarifas WHERE id = '${IDS.tarifa}';
  `)
}

/** Bucket auxiliar de la prueba «otro bucket»: se retira al sembrar y al terminar, falle lo que falle. */
async function limpiarOtroBucket() {
  await http('DELETE', `${STORAGE}/object/ept101-otro`, { ...SERVIDOR, json: { prefixes: ['prueba.png'] } })
  await http('DELETE', `${STORAGE}/bucket/ept101-otro`, SERVIDOR)
}

async function limpiarObjetos() {
  await limpiarOtroBucket()
  // Todo lo que haya bajo las carpetas de los tres pagos del fixture (también lo que
  // un intento de escritura de cliente hubiera dejado, si una política se aflojara).
  const rutas = [...Object.keys(EXT).map(ruta), RUTA_HUERFANA]
  for (const pago of [IDS.pagoA, IDS.pagoCop, IDS.pagoC]) {
    const lista = await http('POST', `${STORAGE}/object/list/${BUCKET}`, {
      ...SERVIDOR, json: { prefix: pago, limit: 1000, offset: 0 },
    })
    if (Array.isArray(lista.datos)) rutas.push(...lista.datos.map((o) => `${pago}/${o.name}`))
  }
  await http('DELETE', `${STORAGE}/object/${BUCKET}`, { ...SERVIDOR, json: { prefixes: [...new Set(rutas)] } })
  const lista = await http('POST', `${STORAGE}/object/list/${BUCKET}`, {
    ...SERVIDOR, json: { prefix: 'ept101-pruebas', limit: 100, offset: 0 },
  })
  if (Array.isArray(lista.datos) && lista.datos.length > 0) {
    await http('DELETE', `${STORAGE}/object/${BUCKET}`, {
      ...SERVIDOR, json: { prefixes: lista.datos.map((o) => `ept101-pruebas/${o.name}`) },
    })
  }
}

async function subirComoServidor(rutaObjeto, buffer, tipo, extra = {}) {
  return http('POST', `${STORAGE}/object/${BUCKET}/${rutaObjeto}`, {
    ...SERVIDOR, cabeceras: { 'content-type': tipo, 'x-upsert': 'true', ...extra }, cuerpo: buffer,
  })
}

async function sembrar() {
  limpiarEconomia()
  await limpiarObjetos()
  limpiarFixture({ prefijoDni: PREFIJO_DNI, prefijoCorreo: PREFIJO_CORREO, dominio: DOMINIO, curso: CURSO })

  for (const [clave, p] of Object.entries(PERSONAS)) {
    const userId = await crearCuentaConPerfil(local, {
      email: correo(clave),
      password: CONTRASENA,
      perfil: {
        nombre: 'Prueba', apellido: `S101${p.apellido}`, dni: p.dni,
        rol_id: rolId(p.rol), legajo_nro: p.legajo_nro ?? null,
      },
    })
    actores[clave] = { userId, perfil: sql(`SELECT id FROM public.perfiles WHERE user_id = '${userId}';`) }
  }
  // Un sujeto con cuenta válida pero SIN perfil.
  const r = await http('POST', `${local.API_URL}/auth/v1/admin/users`, {
    ...SERVIDOR, json: { email: correo('sinperfil'), password: CONTRASENA, email_confirm: true },
  })
  if (r.estado >= 300) throw new Error(`no se pudo crear la cuenta sin perfil (${r.estado})`)

  const a = (c) => actores[c].perfil
  sql(`
    BEGIN;
    INSERT INTO public.cursos (nivel_id, denominacion, division, activo)
    VALUES ((SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), '${CURSO}', 'A', TRUE);
    INSERT INTO public.matriculas (alumno_id, curso_id)
    SELECT p.id, (SELECT id FROM public.cursos WHERE denominacion = '${CURSO}')
    FROM public.perfiles p WHERE p.id IN ('${a('estudianteA')}', '${a('estudianteB')}');
    UPDATE public.alumnos SET estado = 'ACTIVO' WHERE perfil_id IN ('${a('estudianteA')}', '${a('estudianteB')}');
    SET CONSTRAINTS ALL IMMEDIATE;
    SET CONSTRAINTS ALL DEFERRED;
    INSERT INTO public.padres_hijos (padre_id, hijo_id) VALUES
      ('${a('padreA')}', '${a('estudianteA')}'), ('${a('copadre')}', '${a('estudianteA')}'),
      ('${a('bloqueado')}', '${a('estudianteA')}'), ('${a('padreC')}', '${a('estudianteB')}');
    COMMIT;
    INSERT INTO public.tarifas (id, concepto, nivel_id, importe, desde)
      VALUES ('${IDS.tarifa}', 'CUOTA', (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 50000, '2026-01-01');
    INSERT INTO public.facturas (id, alumno_id, periodo, vencimiento, total) VALUES
      ('${IDS.facturaA}', '${a('estudianteA')}', '2026-11-01', '2026-11-10', 50000),
      ('${IDS.facturaB}', '${a('estudianteB')}', '2026-11-01', '2026-11-10', 50000);
    INSERT INTO public.items_factura (id, factura_id, alumno_id, tipo, tarifa_id, matricula_id, importe) VALUES
      ('${IDS.itemA}', '${IDS.facturaA}', '${a('estudianteA')}', 'CUOTA', '${IDS.tarifa}',
        (SELECT id FROM public.matriculas WHERE alumno_id = '${a('estudianteA')}'), 50000),
      ('${IDS.itemB}', '${IDS.facturaB}', '${a('estudianteB')}', 'CUOTA', '${IDS.tarifa}',
        (SELECT id FROM public.matriculas WHERE alumno_id = '${a('estudianteB')}'), 50000);
    INSERT INTO public.pagos (id, padre_id, alumno_id, total_calculado) VALUES
      ('${IDS.pagoA}', '${a('padreA')}', '${a('estudianteA')}', 50000),
      ('${IDS.pagoCop}', '${a('copadre')}', '${a('estudianteA')}', 50000),
      ('${IDS.pagoC}', '${a('padreC')}', '${a('estudianteB')}', 50000);
    INSERT INTO public.recibos (pago_id, numero, archivo_path) VALUES
      ('${IDS.pagoA}', 9610001, 'recibos-futuros/secreto.pdf');
    INSERT INTO public.comprobantes_pago (id, pago_id, subido_por, ruta_archivo, tipo_mime, tamano_bytes) VALUES
      ('${IDS.c1}', '${IDS.pagoA}', '${a('padreA')}', '${ruta('c1')}', 'image/jpeg', ${JPG.length}),
      ('${IDS.c2}', '${IDS.pagoA}', '${a('padreA')}', '${ruta('c2')}', 'application/pdf', ${PDF.length}),
      ('${IDS.c3}', '${IDS.pagoCop}', '${a('copadre')}', '${ruta('c3')}', 'image/png', ${PNG.length}),
      ('${IDS.c4}', '${IDS.pagoC}', '${a('padreC')}', '${ruta('c4')}', 'image/jpeg', ${JPG.length});
  `)
  for (const c of Object.keys(EXT)) {
    const r = await subirComoServidor(ruta(c), BINARIO[EXT[c]], MIME[EXT[c]])
    if (r.estado !== 200) throw new Error(`no se pudo sembrar el objeto ${c} (${r.estado})`)
  }
  // Objeto SIN registro, aunque su ruta parezca canónica y su metadata afirme un dueño.
  const h = await subirComoServidor(RUTA_HUERFANA, JPG, 'image/jpeg', {
    'x-metadata': JSON.stringify({ subido_por: a('padreA'), owner: a('padreA') }),
  })
  if (h.estado !== 200) throw new Error(`no se pudo sembrar el objeto huérfano (${h.estado})`)

  for (const clave of Object.keys(PERSONAS)) {
    actores[clave].token = (await exigirSesion(local, correo(clave), CONTRASENA)).access_token
  }
  tokenSinPerfil = (await exigirSesion(local, correo('sinperfil'), CONTRASENA)).access_token
  // El bloqueo llega DESPUÉS de emitir su JWT: el token ya firmado sigue siendo válido para GoTrue.
  sql(`UPDATE public.perfiles SET estado_acceso = 'BLOQUEADO' WHERE id = '${actores.bloqueado.perfil}';`)
}

async function limpiarTodo() {
  // Cada paso por separado: que uno falle no deja sin limpiar a los demás.
  const pasos = [
    ['objetos', () => limpiarObjetos()],
    ['economía', () => limpiarEconomia()],
    ['fixture', () => limpiarFixture({ prefijoDni: PREFIJO_DNI, prefijoCorreo: PREFIJO_CORREO, dominio: DOMINIO, curso: CURSO })],
    ['cuenta sin perfil', () => sql(`DELETE FROM auth.users WHERE email = '${correo('sinperfil')}';`)],
  ]
  for (const [nombre, paso] of pasos) {
    try {
      await paso()
    } catch (e) {
      console.error(`FALLO  la limpieza de ${nombre} no terminó: ${e.message}`)
      conteo.fallos += 1
    }
  }
}

// ================================================================
// Utilidades de afirmación
// ================================================================
const cuantos = (r) => (Array.isArray(r.datos) ? r.datos.length : -1)
const urlFirmada = (r) => {
  const rel = r.datos?.signedURL ?? r.datos?.signedUrl
  return typeof rel === 'string' ? `${STORAGE}${rel.startsWith('/') ? '' : '/'}${rel}` : null
}
/** GET sin ninguna cabecera de autorización: lo que haría quien solo tiene la URL. */
async function soloUrl(url) {
  const respuesta = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  return { estado: respuesta.status, buffer: Buffer.from(await respuesta.arrayBuffer()) }
}

async function main() {
  await sembrar()
  const A = actores.estudianteA.perfil
  const B = actores.estudianteB.perfil
  const filtro = (tabla) => ({
    facturas: `facturas?select=id&alumno_id=in.(${A},${B})`,
    items_factura: `items_factura?select=id&alumno_id=in.(${A},${B})`,
    pagos: `pagos?select=id&alumno_id=in.(${A},${B})`,
    imputaciones_pago: `imputaciones_pago?select=pago_id&alumno_id=in.(${A},${B})`,
    recibos: `recibos?select=id,pago_id,numero,emitido_en`,
    comprobantes_pago: `comprobantes_pago?select=id&pago_id=in.(${IDS.pagoA},${IDS.pagoCop},${IDS.pagoC})`,
    tarifas: `tarifas?select=id&id=eq.${IDS.tarifa}`,
    feriados: `feriados?select=fecha`,
    envios_correo: `envios_correo?select=id`,
  })[tabla]

  // ==============================================================
  // 1. PostgREST con JWT reales
  // ==============================================================
  console.log('\n— 1. PostgREST con JWT reales —')
  const lecturas = [
    // actor, facturas, items, pagos, comprobantes, tarifas, recibos(columnas permitidas)
    ['director', 2, 2, 3, 4, 1, 1],
    ['padreA', 1, 1, 2, 2, 0, 1],
    ['copadre', 1, 1, 2, 1, 0, 1],
    ['padreC', 1, 1, 1, 1, 0, 0],
    ['estudianteA', 1, 1, 2, 0, 0, 1],
    ['estudianteB', 1, 1, 1, 0, 0, 0],
    ['docente', 0, 0, 0, 0, 0, 0],
    ['personal', 0, 0, 0, 0, 0, 0],
    ['bloqueado', 0, 0, 0, 0, 0, 0],
  ]
  for (const [clave, fac, ite, pag, comp, tar, rec] of lecturas) {
    const t = actores[clave].token
    const r = {
      facturas: await rest(t, filtro('facturas')),
      items: await rest(t, filtro('items_factura')),
      pagos: await rest(t, filtro('pagos')),
      comp: await rest(t, filtro('comprobantes_pago')),
      tar: await rest(t, filtro('tarifas')),
      rec: await rest(t, filtro('recibos')),
    }
    afirmar(
      r.facturas.estado === 200 && cuantos(r.facturas) === fac && r.items.estado === 200 && cuantos(r.items) === ite &&
        r.pagos.estado === 200 && cuantos(r.pagos) === pag && r.comp.estado === 200 && cuantos(r.comp) === comp &&
        r.tar.estado === 200 && cuantos(r.tar) === tar && r.rec.estado === 200 && cuantos(r.rec) === rec,
      `${clave}: facturas ${fac}, ítems ${ite}, pagos ${pag}, comprobantes ${comp}, tarifas ${tar}, recibos ${rec}`
    )
  }

  const sp = await rest(tokenSinPerfil, filtro('facturas'))
  afirmar(sp.estado === 200 && cuantos(sp) === 0, 'sujeto con JWT válido y sin perfil: 0 facturas')
  for (const tabla of ['facturas', 'items_factura', 'pagos', 'imputaciones_pago', 'recibos', 'comprobantes_pago', 'tarifas', 'feriados', 'envios_correo']) {
    const r = await rest(null, filtro(tabla))
    afirmar([401, 403].includes(r.estado) && r.datos?.code === '42501',
      `anónimo: ${tabla} responde ${r.estado} con código ${r.datos?.code} (sin privilegio)`)
  }

  // Embeds: la ruta del otro padre no sale por ninguna relación.
  const emb = await rest(actores.copadre.token, `pagos?select=id,comprobantes_pago(id,ruta_archivo)&id=eq.${IDS.pagoA}`)
  afirmar(emb.estado === 200 && cuantos(emb) === 1 && emb.datos[0].comprobantes_pago.length === 0,
    'embed pagos→comprobantes_pago: el copadre ve el pago del otro pero 0 de sus archivos')
  const emb2 = await rest(actores.padreA.token, `pagos?select=id,comprobantes_pago(id)&id=eq.${IDS.pagoA}`)
  afirmar(emb2.estado === 200 && emb2.datos?.[0]?.comprobantes_pago?.length === 2,
    'embed pagos→comprobantes_pago: el cargador ve sus dos archivos')
  const emb3 = await rest(actores.padreA.token, `pagos?select=id,recibos(archivo_path)&id=eq.${IDS.pagoA}`)
  afirmar(emb3.estado === 403 && emb3.datos?.code === '42501', 'embed pagos→recibos(archivo_path): 42501, la ruta del recibo no se filtra')
  const emb4 = await rest(actores.padreA.token, `recibos?select=*`)
  afirmar(emb4.estado === 403 && emb4.datos?.code === '42501', '`recibos?select=*` pide `archivo_path`: 42501')
  const emb5 = await rest(actores.director.token, `recibos?select=archivo_path`)
  afirmar(emb5.estado === 403, 'ni el DIRECTOR lee `recibos.archivo_path`')

  // RPC del registro del comprobante.
  const r1 = await rpc(actores.padreA.token, 'resumen_comprobantes_pago', { p_pago_id: IDS.pagoA })
  afirmar(r1.estado === 200 && r1.datos?.length === 1 && r1.datos[0].cantidad_archivos === 2 &&
    Object.keys(r1.datos[0]).sort().join() === 'cantidad_archivos,pago_id,ultima_carga_en',
    'RPC resumen: el cargador ve cantidad 2 y solo (pago_id, cantidad_archivos, ultima_carga_en)')
  const r2 = await rpc(actores.padreA.token, 'resumen_comprobantes_pago', { p_pago_id: IDS.pagoCop })
  afirmar(r2.estado === 200 && r2.datos?.[0]?.cantidad_archivos === 1, 'RPC resumen: el padre A ve que el pago del copadre tiene un comprobante (sin su ruta)')
  const r3 = await rpc(actores.estudianteA.token, 'resumen_comprobantes_pago', { p_pago_id: IDS.pagoA })
  afirmar(r3.estado === 200 && r3.datos?.[0]?.cantidad_archivos === 2, 'RPC resumen: el estudiante propio ve el registro')
  for (const clave of ['padreC', 'estudianteB', 'docente', 'personal', 'bloqueado']) {
    const r = await rpc(actores[clave].token, 'resumen_comprobantes_pago', { p_pago_id: IDS.pagoA })
    afirmar(r.estado === 200 && Array.isArray(r.datos) && r.datos.length === 0, `RPC resumen: ${clave} recibe 0 filas del pago ajeno`)
  }
  const ra = await rpc(null, 'resumen_comprobantes_pago', { p_pago_id: IDS.pagoA })
  afirmar([401, 403, 404].includes(ra.estado) && !(Array.isArray(ra.datos) && ra.datos.length > 0),
    `RPC resumen: anónimo no obtiene datos (${ra.estado}, ${ra.datos?.code})`)

  // Escrituras directas: todas rechazadas y nada cambia.
  const huella = () => sql(`SELECT md5(string_agg(row_to_json(p)::text, '|' ORDER BY p.id)) FROM public.pagos p WHERE p.id IN ('${IDS.pagoA}','${IDS.pagoCop}','${IDS.pagoC}');`)
  const antes = huella()
  for (const clave of ['director', 'padreA', 'estudianteA', 'docente']) {
    const t = actores[clave].token
    const ins = await rest(t, 'pagos', { metodo: 'POST', json: { padre_id: actores.padreA.perfil, alumno_id: A, total_calculado: 1 } })
    const upd = await rest(t, `pagos?id=eq.${IDS.pagoA}`, { metodo: 'PATCH', json: { total_calculado: 1, estado: 'APROBADO' } })
    const del = await rest(t, `pagos?id=eq.${IDS.pagoA}`, { metodo: 'DELETE' })
    const cins = await rest(t, 'comprobantes_pago', { metodo: 'POST', json: { pago_id: IDS.pagoA, subido_por: actores.padreA.perfil, ruta_archivo: 'x', tipo_mime: 'image/png', tamano_bytes: 1 } })
    const cupd = await rest(t, `comprobantes_pago?id=eq.${IDS.c1}`, { metodo: 'PATCH', json: { subido_por: actores.padreC.perfil } })
    const cdel = await rest(t, `comprobantes_pago?id=eq.${IDS.c1}`, { metodo: 'DELETE' })
    afirmar([ins, upd, del, cins, cupd, cdel].every((x) => x.estado === 403 && x.datos?.code === '42501'),
      `${clave}: INSERT/PATCH/DELETE directos sobre pagos y comprobantes_pago → 42501 (HTTP 403)`)
  }
  afirmar(huella() === antes && sql(`SELECT count(*) FROM public.comprobantes_pago WHERE pago_id IN ('${IDS.pagoA}','${IDS.pagoCop}','${IDS.pagoC}');`) === '4',
    'tras todos los intentos de escritura, pagos y comprobantes no cambiaron')

  // Metadata de JWT: no autoriza nada. Se firma con el secreto LOCAL.
  const meta = firmarJwtLocal({
    sub: actores.padreA.userId,
    user_metadata: { rol: 'DIRECTOR', role: 'DIRECTOR' },
    app_metadata: { rol: 'DIRECTOR', role: 'DIRECTOR' },
  })
  const rm = await rest(meta, filtro('facturas'))
  afirmar(rm.estado === 200 && cuantos(rm) === 1, 'JWT del padre A con metadata «DIRECTOR»: sigue viendo 1 factura (la de su hijo), no 2')
  const metaDesconocido = firmarJwtLocal({ sub: ID(5000), user_metadata: { rol: 'DIRECTOR' }, app_metadata: { rol: 'DIRECTOR' } })
  const rd = await rest(metaDesconocido, filtro('facturas'))
  afirmar(rd.estado === 200 && cuantos(rd) === 0, 'JWT de un sub inexistente con metadata «DIRECTOR»: 0 facturas')

  // ==============================================================
  // 2. Storage real: lectura, firma y listado
  // ==============================================================
  console.log('\n— 2. Storage real —')
  const lee = async (clave, c) => (await objetoAutenticado(actores[clave].token, ruta(c)))
  for (const [clave, c] of [['padreA', 'c1'], ['padreA', 'c2'], ['copadre', 'c3'], ['padreC', 'c4']]) {
    const r = await lee(clave, c)
    afirmar(r.estado === 200 && r.buffer.equals(BINARIO[EXT[c]]), `${clave} descarga su ${c} (${EXT[c]}) byte a byte`)
  }
  for (const c of Object.keys(EXT)) {
    const r = await lee('director', c)
    afirmar(r.estado === 200 && r.buffer.equals(BINARIO[EXT[c]]), `DIRECTOR descarga ${c}`)
  }

  const negados = [
    ['copadre', 'c1'], ['copadre', 'c2'], ['padreA', 'c3'], ['padreA', 'c4'], ['padreC', 'c1'],
    ['estudianteA', 'c1'], ['estudianteB', 'c4'], ['docente', 'c1'], ['personal', 'c1'], ['bloqueado', 'c1'],
  ]
  const estadosNegados = new Set()
  for (const [clave, c] of negados) {
    const r = await lee(clave, c)
    estadosNegados.add(r.estado)
    const f = await firmar(actores[clave].token, ruta(c))
    afirmar(r.estado !== 200 && !r.buffer.equals(BINARIO[EXT[c]]) && urlFirmada(f) === null,
      `${clave} NO descarga ni obtiene firma de ${c} (descarga HTTP ${r.estado}, firma HTTP ${f.estado})`)
  }
  console.log(`    estados de denegación observados en la descarga: ${[...estadosNegados].join(', ')}`)
  afirmar(estadosNegados.size === 1 && estadosNegados.has(400), 'toda denegación de descarga responde HTTP 400 (Storage local 1.72.1, objeto no encontrado bajo RLS)')
  const anonimo = await objetoAutenticado(null, ruta('c1'))
  const publico = await http('GET', `${STORAGE}/object/public/${BUCKET}/${ruta('c1')}`, { cabeceras: {} })
  afirmar(anonimo.estado !== 200 && publico.estado !== 200 && !publico.buffer.equals(JPG),
    `anónimo no descarga por la ruta autenticada (${anonimo.estado}) ni por la pública (${publico.estado})`)
  const sinPerfil = await objetoAutenticado(tokenSinPerfil, ruta('c1'))
  afirmar(sinPerfil.estado !== 200, `sujeto sin perfil no descarga (${sinPerfil.estado})`)
  const metaStorage = await objetoAutenticado(meta, ruta('c3'))
  afirmar(metaStorage.estado !== 200, 'JWT del padre A con metadata «DIRECTOR»: no descarga el archivo del copadre')

  // Objeto sin registro: ni el cargador aparente ni el DIRECTOR lo leen.
  const h1 = await objetoAutenticado(actores.padreA.token, RUTA_HUERFANA)
  const h2 = await objetoAutenticado(actores.director.token, RUTA_HUERFANA)
  afirmar(h1.estado !== 200 && h2.estado !== 200,
    'un objeto sin fila en comprobantes_pago (aunque su metadata nombre a un dueño) no se lee desde el cliente')

  // Ruta cruzada y traversal.
  const cruzada = await objetoAutenticado(actores.padreC.token, `${IDS.pagoC}/../${IDS.pagoA}/${IDS.c1}.jpg`)
  const cruzada2 = await objetoAutenticado(actores.padreC.token, `${IDS.pagoC}%2F..%2F${IDS.pagoA}%2F${IDS.c1}.jpg`)
  const cruzada3 = await objetoAutenticado(actores.padreC.token, `${IDS.pagoA}/${IDS.c1}.jpg`)
  afirmar([cruzada, cruzada2, cruzada3].every((r) => r.estado !== 200 || !r.buffer.equals(JPG)),
    'ruta cruzada y traversal (.., %2F) no entregan el archivo de otra familia')

  // Listado.
  const lA = await listar(actores.padreA.token, IDS.pagoA)
  afirmar(lA.estado === 200 && Array.isArray(lA.datos) && lA.datos.map((o) => o.name).sort().join() ===
    [`${IDS.c1}.jpg`, `${IDS.c2}.pdf`].sort().join(),
    'listado del padre A bajo su pago: exactamente sus dos archivos (no el huérfano)')
  const lCop = await listar(actores.copadre.token, IDS.pagoA)
  afirmar(lCop.estado === 200 && Array.isArray(lCop.datos) && lCop.datos.length === 0, 'listado del copadre bajo el pago de A: vacío')
  const lAC = await listar(actores.padreA.token, IDS.pagoCop)
  afirmar(lAC.estado === 200 && Array.isArray(lAC.datos) && lAC.datos.length === 0, 'listado del padre A bajo el pago del copadre: vacío')
  const lDir = await listar(actores.director.token, IDS.pagoA)
  afirmar(lDir.estado === 200 && lDir.datos.length === 2, 'listado del DIRECTOR bajo un pago: los dos archivos registrados')
  const lRaiz = await listar(actores.padreC.token, '')
  afirmar(lRaiz.estado === 200 && Array.isArray(lRaiz.datos) && lRaiz.datos.length === 1 && lRaiz.datos[0].name === IDS.pagoC,
    'listado raíz del padre C: solo la carpeta de su propio pago')
  for (const clave of ['estudianteA', 'docente', 'personal', 'bloqueado']) {
    const l = await listar(actores[clave].token, IDS.pagoA)
    afirmar(l.estado !== 200 || (Array.isArray(l.datos) && l.datos.length === 0), `listado de ${clave}: vacío o denegado`)
  }
  const lAnon = await listar(null, IDS.pagoA)
  afirmar(lAnon.estado !== 200 || (Array.isArray(lAnon.datos) && lAnon.datos.length === 0), 'listado anónimo: vacío o denegado')

  // Firma por lote: solo lo que el llamante puede leer.
  const lote = await http('POST', `${STORAGE}/object/sign/${BUCKET}`, {
    token: actores.copadre.token, json: { expiresIn: 60, paths: [ruta('c1'), ruta('c3')] },
  })
  afirmar(lote.estado === 200 && Array.isArray(lote.datos) && lote.datos.length === 2 &&
    lote.datos.find((x) => x.path === ruta('c1'))?.signedURL == null && lote.datos.find((x) => x.path === ruta('c3'))?.signedURL,
    'firma por lote del copadre: firma su archivo y NO el de A')

  // Otro bucket: nuestras políticas no abren nada ajeno.
  await http('POST', `${STORAGE}/bucket`, { ...SERVIDOR, json: { id: 'ept101-otro', name: 'ept101-otro', public: false } })
  await http('POST', `${STORAGE}/object/ept101-otro/prueba.png`, { ...SERVIDOR, cabeceras: { 'content-type': 'image/png' }, cuerpo: PNG })
  const otro = await http('GET', `${STORAGE}/object/authenticated/ept101-otro/prueba.png`, { token: actores.director.token })
  afirmar(otro.estado !== 200, `ni el DIRECTOR lee un objeto de otro bucket sin política propia (${otro.estado})`)
  const confirmacion = await http('GET', `${STORAGE}/object/authenticated/ept101-otro/prueba.png`, SERVIDOR)
  afirmar(confirmacion.estado === 200, 'control: el objeto del otro bucket existe (la denegación no era por ausencia)')
  await http('DELETE', `${STORAGE}/object/ept101-otro`, { ...SERVIDOR, json: { prefixes: ['prueba.png'] } })
  await http('DELETE', `${STORAGE}/bucket/ept101-otro`, SERVIDOR)

  // ==============================================================
  // 3. Escritura de clientes: todo cerrado
  // ==============================================================
  console.log('\n— 3. Escritura de clientes —')
  const sello = async (c) => {
    const r = await http('GET', `${STORAGE}/object/authenticated/${BUCKET}/${ruta(c)}`, SERVIDOR)
    return r.estado === 200 ? sha(r.buffer) : `estado-${r.estado}`
  }
  const sellosAntes = {}
  for (const c of Object.keys(EXT)) sellosAntes[c] = await sello(c)
  const intentosEscritura = []
  for (const clave of ['director', 'padreA', 'copadre', 'estudianteA', 'docente', 'bloqueado']) {
    const t = actores[clave].token
    const nueva = `${IDS.pagoA}/${ID(2000 + intentosEscritura.length)}.jpg`
    const subida = await http('POST', `${STORAGE}/object/${BUCKET}/${nueva}`, { token: t, cabeceras: { 'content-type': 'image/jpeg' }, cuerpo: JPG })
    const reemplazo = await http('POST', `${STORAGE}/object/${BUCKET}/${ruta('c1')}`, { token: t, cabeceras: { 'content-type': 'image/jpeg', 'x-upsert': 'true' }, cuerpo: Buffer.concat([JPG, Buffer.from('x')]) })
    const actualiza = await http('PUT', `${STORAGE}/object/${BUCKET}/${ruta('c1')}`, { token: t, cabeceras: { 'content-type': 'image/jpeg' }, cuerpo: Buffer.concat([JPG, Buffer.from('y')]) })
    const borrado = await http('DELETE', `${STORAGE}/object/${BUCKET}/${ruta('c1')}`, { token: t })
    const lote = await http('DELETE', `${STORAGE}/object/${BUCKET}`, { token: t, json: { prefixes: [ruta('c1'), ruta('c3')] } })
    const mover = await http('POST', `${STORAGE}/object/move`, { token: t, json: { bucketId: BUCKET, sourceKey: ruta('c1'), destinationKey: `${IDS.pagoA}/${ID(2900)}.jpg` } })
    const copiar = await http('POST', `${STORAGE}/object/copy`, { token: t, json: { bucketId: BUCKET, sourceKey: ruta('c1'), destinationKey: `${IDS.pagoA}/${ID(2901)}.jpg` } })
    intentosEscritura.push(subida, reemplazo, actualiza, borrado, lote, mover, copiar)
    afirmar([subida, reemplazo, actualiza, mover, copiar].every((r) => r.estado >= 400),
      `${clave}: subida, reemplazo (upsert), PUT, mover y copiar son rechazados (${[subida, reemplazo, actualiza, mover, copiar].map((r) => r.estado).join('/')})`)
  }
  const anonSube = await http('POST', `${STORAGE}/object/${BUCKET}/${IDS.pagoA}/${ID(2950)}.jpg`, { cabeceras: { 'content-type': 'image/jpeg' }, cuerpo: JPG })
  afirmar(anonSube.estado >= 400, `anónimo no sube (${anonSube.estado})`)
  const sellosDespues = {}
  for (const c of Object.keys(EXT)) sellosDespues[c] = await sello(c)
  afirmar(Object.keys(EXT).every((c) => sellosDespues[c] === sellosAntes[c] && /^[0-9a-f]{64}$/u.test(sellosDespues[c])),
    'tras subidas, reemplazos, borrados, movimientos y copias de clientes, los cuatro objetos siguen idénticos (SHA-256)')
  const extras = await http('POST', `${STORAGE}/object/list/${BUCKET}`, { ...SERVIDOR, json: { prefix: IDS.pagoA, limit: 100, offset: 0 } })
  afirmar(Array.isArray(extras.datos) && extras.datos.length === 3,
    'el pago A conserva exactamente tres objetos con credencial de servidor: dos registrados y el huérfano, sin objetos nuevos de clientes')

  // ==============================================================
  // 4. Límites aplicados por el servicio
  // ==============================================================
  console.log('\n— 4. Límites del bucket (credencial de servidor) —')
  const base = 'ept101-pruebas'
  const limite = async (nombre, buffer, tipo) =>
    http('POST', `${STORAGE}/object/${BUCKET}/${base}/${nombre}`, { ...SERVIDOR, cabeceras: { 'content-type': tipo, 'x-upsert': 'true' }, cuerpo: buffer })
  const exacto = await limite('exacto.jpg', Buffer.alloc(MAXIMO, 0x61), 'image/jpeg')
  afirmar(exacto.estado === 200, `exactamente ${MAXIMO} bytes (5 MiB) en image/jpeg: aceptado (${exacto.estado})`)
  const pasado = await limite('pasado.jpg', Buffer.alloc(MAXIMO + 1, 0x61), 'image/jpeg')
  afirmar(pasado.estado === 413 || (pasado.estado >= 400 && /exceed|size|large/iu.test(pasado.buffer.toString())),
    `${MAXIMO + 1} bytes: rechazado por el servicio (${pasado.estado})`)
  for (const [tipo, nombre] of [['image/png', 'ok.png'], ['application/pdf', 'ok.pdf']]) {
    const r = await limite(nombre, tipo === 'application/pdf' ? PDF : PNG, tipo)
    afirmar(r.estado === 200, `${tipo} pequeño: aceptado (${r.estado})`)
  }
  for (const [tipo, nombre] of [['image/gif', 'x.gif'], ['text/plain', 'x.txt'], ['application/x-msdownload', 'x.exe'], ['image/svg+xml', 'x.svg'], ['application/octet-stream', 'x.bin']]) {
    const r = await limite(nombre, Buffer.from('contenido'), tipo)
    afirmar(r.estado === 415 || r.estado >= 400, `${tipo}: rechazado por el servicio (${r.estado})`)
  }
  // Límite de Storage: el MIME es el DECLARADO por quien sube; no se inspecciona el contenido.
  const disfraz = await limite('disfrazado.jpg', Buffer.from('<?php echo 1; ?>'), 'image/jpeg')
  console.log(`    (límite conocido) un texto declarado como image/jpeg: HTTP ${disfraz.estado}; la validación real del binario es de EPT-109`)
  afirmar(disfraz.estado === 200, 'documentado: Storage valida el MIME declarado, no el contenido (queda para EPT-109)')
  // Multipart con tipo no permitido.
  const formulario = new FormData()
  formulario.append('file', new Blob([Buffer.from('gif')], { type: 'image/gif' }), 'x.gif')
  const mp = await fetch(`${STORAGE}/object/${BUCKET}/${base}/mp.gif`, {
    method: 'POST', headers: { apikey: SERVIDOR.apikey, authorization: `Bearer ${SERVIDOR.token}` }, body: formulario,
  })
  afirmar(mp.status >= 400, `multipart con image/gif: rechazado (${mp.status})`)

  // ==============================================================
  // 5. URLs firmadas
  // ==============================================================
  console.log('\n— 5. URLs firmadas —')
  const f60 = await firmar(actores.padreA.token, ruta('c1'), 60)
  const url60 = urlFirmada(f60)
  afirmar(f60.estado === 200 && url60 !== null, 'el cargador obtiene una URL firmada con TTL de 60 s bajo sus credenciales')
  const dl = url60 ? await soloUrl(url60) : { estado: 0, buffer: Buffer.alloc(0) }
  afirmar(dl.estado === 200 && dl.buffer.equals(JPG), 'la URL firmada descarga el archivo sin ninguna cabecera de autorización')
  // LÍMITE VERIFICADO: Storage no impone un TTL máximo. El tope (60 s recomendado) es disciplina
  // del cliente y de las RPC futuras; lo que queda acotado es QUIÉN puede firmar (solo quien hoy
  // puede leer el archivo).
  const fAnual = await firmar(actores.padreA.token, ruta('c1'), 31_536_000)
  afirmar(fAnual.estado === 200 && urlFirmada(fAnual) !== null,
    'LÍMITE DOCUMENTADO: Storage acepta una firma de un año; el tope de TTL no lo impone el servicio')
  const fAnualAjena = await firmar(actores.copadre.token, ruta('c1'), 31_536_000)
  afirmar(urlFirmada(fAnualAjena) === null, 'aun con un TTL enorme, quien no puede leer el archivo no obtiene firma')
  const f2 = await firmar(actores.padreA.token, ruta('c1'), 2)
  const url2 = urlFirmada(f2)
  const ahora = url2 ? await soloUrl(url2) : { estado: 0 }
  await esperar(4000)
  const luego = url2 ? await soloUrl(url2) : { estado: 0 }
  afirmar(ahora.estado === 200 && luego.estado !== 200, `una URL de 2 s sirve al emitirse (${ahora.estado}) y vence de verdad (${luego.estado})`)
  const fAjena = await firmar(actores.copadre.token, ruta('c1'), 60)
  afirmar(urlFirmada(fAjena) === null, 'el copadre no obtiene firma del archivo de A')

  // Vigencia residual: bloqueo de cuenta con una URL ya emitida.
  const antesBloqueo = await firmar(actores.padreA.token, ruta('c2'), 60)
  const urlResidual = urlFirmada(antesBloqueo)
  sql(`UPDATE public.perfiles SET estado_acceso = 'BLOQUEADO' WHERE id = '${actores.padreA.perfil}';`)
  const nueva = await firmar(actores.padreA.token, ruta('c2'), 60)
  const directa = await objetoAutenticado(actores.padreA.token, ruta('c2'))
  const lecturaRest = await rest(actores.padreA.token, filtro('comprobantes_pago'))
  afirmar(urlFirmada(nueva) === null && directa.estado !== 200 && cuantos(lecturaRest) === 0,
    'bloqueada la cuenta: el MISMO JWT no obtiene nuevas firmas, no descarga y no lee la tabla')
  const residual = urlResidual ? await soloUrl(urlResidual) : { estado: 0, buffer: Buffer.alloc(0) }
  afirmar(residual.estado === 200 && residual.buffer.equals(PDF),
    'RIESGO RESIDUAL DOCUMENTADO: la URL emitida ANTES del bloqueo sigue sirviendo hasta que vence (Storage no la revoca)')
  sql(`UPDATE public.perfiles SET estado_acceso = 'HABILITADO' WHERE id = '${actores.padreA.perfil}';`)
  const reabierto = await objetoAutenticado(actores.padreA.token, ruta('c2'))
  afirmar(reabierto.estado === 200, 'reactivada la cuenta, el mismo JWT vuelve a descargar')

  // Cambio de rol y desvinculación con el token ya emitido.
  sql(`UPDATE public.perfiles SET rol_id = ${rolId('PERSONAL')} WHERE id = '${actores.copadre.perfil}';`)
  const sinRol = await objetoAutenticado(actores.copadre.token, ruta('c3'))
  afirmar(sinRol.estado !== 200 && cuantos(await rest(actores.copadre.token, filtro('facturas'))) === 0,
    'con el rol cambiado a PERSONAL (mismo JWT): ni el archivo ni la economía')
  sql(`UPDATE public.perfiles SET rol_id = ${rolId('PADRE')} WHERE id = '${actores.copadre.perfil}';`)
  const firmaCop = await firmar(actores.copadre.token, ruta('c3'), 60)
  const urlCop = urlFirmada(firmaCop)
  sql(`DELETE FROM public.padres_hijos WHERE padre_id = '${actores.copadre.perfil}' AND hijo_id = '${A}';`)
  const sinVinculo = await objetoAutenticado(actores.copadre.token, ruta('c3'))
  const firmaNueva = await firmar(actores.copadre.token, ruta('c3'), 60)
  afirmar(sinVinculo.estado !== 200 && urlFirmada(firmaNueva) === null,
    'desvinculado del hijo (mismo JWT): no descarga ni obtiene una firma nueva de lo que cargó')
  const residualCop = urlCop ? await soloUrl(urlCop) : { estado: 0, buffer: Buffer.alloc(0) }
  afirmar(residualCop.estado === 200 && residualCop.buffer.equals(PNG),
    'RIESGO RESIDUAL DOCUMENTADO: la URL emitida antes de desvincular sigue vigente hasta vencer')
  sql(`INSERT INTO public.padres_hijos (padre_id, hijo_id) VALUES ('${actores.copadre.perfil}', '${A}');`)
}

let codigoSalida = 0
try {
  await main()
} catch (error) {
  console.error(`FALLO  la suite terminó con una excepción: ${error.stack ?? error.message}`)
  conteo.fallos += 1
} finally {
  await limpiarTodo()
}
console.log(`\n${conteo.afirmaciones} afirmaciones, ${conteo.fallos} fallo(s).`)
if (conteo.fallos > 0) codigoSalida = 1
process.exit(codigoSalida)
