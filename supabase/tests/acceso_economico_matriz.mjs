/**
 * EPT-120 — Matriz de acceso por rol y de archivos privados contra Auth,
 * PostgREST, Storage y el servidor de Next REALES, con el JWT de cada actor.
 *
 * Cierra las brechas de la matriz recurso × actor × canal × operación × resultado
 * que las suites previas dejaban sin cruzar (ver docs/parte3/EPT-119-121/matriz-acceso.md,
 * donde cada caso `[XNN]` de esta salida figura con su resultado esperado):
 *
 *   R  PostgREST económico: lectura por tabla y embeds, columna `archivo_path`,
 *      escrituras directas y verificación por quien no puede.
 *   S  Registro saneado (RPC de resumen y de consulta), sin ruta ni URL.
 *   O  ORIGINAL del comprobante en Storage directo: descarga, firma, listado y
 *      escritura de clientes, por cada actor y por cada comprobante.
 *   E  Endpoint `/api/comprobantes/[id]/archivo` con cookies, con Bearer y su URL.
 *   T  Bucket temporal de cargas: subida, reemplazo, lectura, listado, firma,
 *      borrado, movimiento y copia por cada actor ajeno.
 *   C  Endpoint `/api/recibos/[id]/pdf` con cookies y con Bearer; no existe
 *      bucket de recibos y `archivo_path` no se lee ni se filtra.
 *   V  Revocaciones con el JWT todavía vigente: bloqueo, vínculo y rol.
 *   L  Límites DOCUMENTADOS (no son garantías): una URL firmada ya emitida sigue
 *      sirviendo hasta vencer y Storage no impone un TTL máximo.
 *
 * Reglas que se verifican (no se cambian para simplificar la prueba): el original
 * de una transferencia lo leen SOLO quien lo cargó y Dirección; estudiante y
 * copadre vinculado, no. Registro saneado y datos económicos: por alcance del
 * hijo. Recibo: distinto del original; padre, copadre vinculado, estudiante propio
 * y Dirección. PERSONAL sin acceso económico. Dirección verifica pero no edita
 * importes.
 *
 * Toda negativa va precedida, dentro de su caso, de la positiva del actor
 * autorizado sobre el MISMO recurso y de la confirmación, con credencial de
 * servidor, de que el recurso existe; así una denegación no puede provenir de un
 * fixture roto. La credencial de servidor (service_role) se usa solo para
 * preparar o verificar: ninguna operación bajo prueba la emplea.
 *
 *     EPT_SUPABASE_WORKDIR=<dir del stack aislado> \
 *     EPT_SUPABASE_DB_CONTAINER=supabase_db_ept119 \
 *       node supabase/tests/acceso_economico_matriz.mjs
 *
 * Autosuficiente: siembra su fixture (DNI 97119xxx, correos ept119.*@ept.local) y
 * lo limpia al terminar. Solo acepta una instancia de Supabase de bucle local. No
 * imprime claves, tokens ni URLs firmadas.
 */

import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import sharp from 'sharp'
import {
  afirmar,
  conteo,
  cookieDe,
  crearCuentaConPerfil,
  crearServidorNext,
  detalleTecnicoEn,
  exigirSesion,
  limpiarFixture,
  rest,
  rpc,
  sql,
} from './_arnes-ept59.mjs'
import { ID, ITEMS, limpiarEconomia, roles, economiaFixture } from './_verificacion-fixture.mjs'

const BUCKET = 'comprobantes-pago'
const TEMPORAL = 'comprobantes-pago-temporal'
const PREFIJO_DNI = '97119'
const PREFIJO_CORREO = 'ept119.'
const DOMINIO = 'ept.local'
const CURSO = 'Curso EPT111' // lo siembra `economiaFixture`; se retira con `limpiarEconomia`
const CONTRASENA = 'prueba-ept119-sintetica'
const PUERTO = Number(process.env.EPT_PUERTO_NEXT ?? 3120)
const ANFITRIONES_LOCALES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
const RUTA_RECIBO_FUTURA = 'recibos-futuros/secreto-ept119.pdf'
const INICIO = Date.now()

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
  if (!valores.API_URL || !valores.SERVICE_ROLE_KEY || !valores.ANON_KEY) {
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
const SERVIDOR = { apikey: local.SERVICE_ROLE_KEY, token: local.SERVICE_ROLE_KEY }
const sha = (b) => createHash('sha256').update(b).digest('hex')

// ================================================================
// HTTP y atajos de Storage (todos con el JWT del actor, salvo `srv`)
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
  const respuesta = await fetch(url, { method: metodo, headers: h, body, signal: AbortSignal.timeout(60_000) })
  const buffer = Buffer.from(await respuesta.arrayBuffer())
  let datos = null
  try {
    datos = JSON.parse(buffer.toString('utf8'))
  } catch {
    datos = null
  }
  return { estado: respuesta.status, buffer, datos }
}

const sesiones = {}
const perfiles = {}
const tk = (k) => (k ? sesiones[k].access_token : null)
const cookie = (k) => cookieDe(sesiones[k])
const nom = (k) => k ?? 'anónimo'

const st = {
  bajar: (k, b, r) => http('GET', `${STORAGE}/object/authenticated/${b}/${r}`, { token: tk(k) }),
  publico: (b, r) => http('GET', `${STORAGE}/object/public/${b}/${r}`, {}),
  firmar: (k, b, r, exp = 60) => http('POST', `${STORAGE}/object/sign/${b}/${r}`, { token: tk(k), json: { expiresIn: exp } }),
  firmarLote: (k, b, rutas) => http('POST', `${STORAGE}/object/sign/${b}`, { token: tk(k), json: { expiresIn: 60, paths: rutas } }),
  firmarSubida: (k, b, r) => http('POST', `${STORAGE}/object/upload/sign/${b}/${r}`, { token: tk(k) }),
  listar: (k, b, prefijo) => http('POST', `${STORAGE}/object/list/${b}`, { token: tk(k), json: { prefix: prefijo, limit: 100, offset: 0 } }),
  subir: (k, b, r, buf, tipo, upsert = false) =>
    http('POST', `${STORAGE}/object/${b}/${r}`, { token: tk(k), cabeceras: { 'content-type': tipo, 'x-upsert': String(upsert) }, cuerpo: buf }),
  reemplazar: (k, b, r, buf, tipo) => http('PUT', `${STORAGE}/object/${b}/${r}`, { token: tk(k), cabeceras: { 'content-type': tipo }, cuerpo: buf }),
  borrar: (k, b, rutas) => http('DELETE', `${STORAGE}/object/${b}`, { token: tk(k), json: { prefixes: rutas } }),
  mover: (k, b, origen, destino) => http('POST', `${STORAGE}/object/move`, { token: tk(k), json: { bucketId: b, sourceKey: origen, destinationKey: destino } }),
  copiar: (k, b, origen, destino, destinoBucket = b) =>
    http('POST', `${STORAGE}/object/copy`, { token: tk(k), json: { bucketId: b, sourceKey: origen, destinationBucket: destinoBucket, destinationKey: destino } }),
}
/** Solo para preparar y verificar el estado de Storage; nunca como operación bajo prueba. */
const srv = {
  leer: (b, r) => http('GET', `${STORAGE}/object/${b}/${r}`, SERVIDOR),
  listar: (b, prefijo) => http('POST', `${STORAGE}/object/list/${b}`, { ...SERVIDOR, json: { prefix: prefijo, limit: 1000, offset: 0 } }),
  borrar: (b, rutas) => http('DELETE', `${STORAGE}/object/${b}`, { ...SERVIDOR, json: { prefixes: rutas } }),
}
const existe = async (b, r) => (await srv.leer(b, r)).estado === 200
const nombres = async (b, prefijo) => {
  const l = await srv.listar(b, prefijo)
  return Array.isArray(l.datos) ? l.datos.map((o) => o.name).sort() : null
}
const visibles = (r) => (Array.isArray(r.datos) ? r.datos.map((o) => o.name) : [])
const urlFirmada = (r) => {
  const rel = r.datos?.signedURL ?? r.datos?.signedUrl
  return typeof rel === 'string' ? `${STORAGE}${rel.startsWith('/') ? '' : '/'}${rel}` : null
}
const urlDeLote = (r, ruta) => {
  const rel = Array.isArray(r.datos) ? r.datos.find((x) => x.path === ruta)?.signedURL : null
  return typeof rel === 'string' && rel ? rel : null
}
/** GET sin ninguna cabecera de autorización: lo que haría quien solo tiene la URL. */
async function soloUrl(url) {
  const respuesta = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  return { estado: respuesta.status, buffer: Buffer.from(await respuesta.arrayBuffer()) }
}
const segundosRestantes = (url) => {
  const token = new URL(url).searchParams.get('token')
  const exp = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).exp
  return exp - Math.floor(Date.now() / 1000)
}

// ================================================================
// Casos agrupados: cada comprobación cuenta, y un fallo nombra a quien falló
// ================================================================
let comprobaciones = 0
function grupo(id, descripcion, filas) {
  comprobaciones += filas.length
  const fallos = filas.filter(([c]) => !c).map(([, etiqueta]) => etiqueta)
  return afirmar(
    fallos.length === 0,
    `[${id}] ${descripcion} — ${filas.length} comprobaciones${fallos.length ? `; FALLAN: ${fallos.join(' | ')}` : ''}`
  )
}

// ================================================================
// Fixture
// ================================================================
const ACTORES = ['director', 'segundo', 'padre', 'copadre', 'alumno', 'otraFamilia', 'ajeno', 'docente', 'personal', 'bloqueado', null]
const dniDe = (k) => `${PREFIJO_DNI}${String(Object.keys(roles).indexOf(k) + 1).padStart(3, '0')}`
const correo = (k) => `${PREFIJO_CORREO}${k}@${DOMINIO}`
const rolId = (nombre) => Number(sql(`SELECT id FROM public.roles WHERE nombre='${nombre}';`))
const idExtra = (n) => `b3119000-0000-4000-8000-${String(n).padStart(12, '0')}`
let contador = 0
const nuevaClave = () => idExtra(++contador)

const objetos = [] // objetos creados por la suite (se retiran al terminar)
const P = {} // pagos
const C = {} // comprobantes: { id, ruta, bytes }
const R = {} // recibos
const CARGA = {} // cargas temporales de P2
let servidor = null
const png = (color) => sharp({ create: { width: 12, height: 12, channels: 3, background: color } }).png().toBuffer()

function limpiezaEconomica() {
  const alumno = sql(`SELECT id FROM public.perfiles WHERE dni='${dniDe('alumno')}';`)
  const ajeno = sql(`SELECT id FROM public.perfiles WHERE dni='${dniDe('ajeno')}';`)
  if (alumno && ajeno) sql(`BEGIN; ${limpiarEconomia({ alumno, ajeno })} COMMIT;`)
}

async function limpiarObjetos() {
  const pagos = sql(`SELECT id FROM public.pagos WHERE alumno_id IN
    (SELECT id FROM public.perfiles WHERE dni LIKE '${PREFIJO_DNI}%');`).split('\n').filter(Boolean)
  for (const bucket of [BUCKET, TEMPORAL]) {
    const rutas = objetos.filter((o) => o.bucket === bucket).map((o) => o.ruta)
    for (const pago of pagos) {
      const lista = await srv.listar(bucket, pago)
      if (Array.isArray(lista.datos)) rutas.push(...lista.datos.map((o) => `${pago}/${o.name}`))
    }
    if (rutas.length > 0) await srv.borrar(bucket, [...new Set(rutas)])
  }
}

function limpiarTodo() {
  return (async () => {
    const pasos = [
      ['objetos', () => limpiarObjetos()],
      ['economía', () => limpiezaEconomica()],
      ['fixture', () => limpiarFixture({ prefijoDni: PREFIJO_DNI, prefijoCorreo: PREFIJO_CORREO, dominio: DOMINIO, curso: CURSO })],
    ]
    for (const [nombre, paso] of pasos) {
      try {
        await paso()
      } catch (e) {
        console.error(`FALLO  la limpieza de ${nombre} no terminó: ${e.message}`)
        conteo.fallos += 1
      }
    }
  })()
}

async function registrarPago(actor, items, totalCentavos) {
  const r = await rpc(local, tk(actor), 'registrar_pago', {
    p_clave_intento: nuevaClave(), p_item_ids: items, p_total_esperado_centavos: totalCentavos,
  })
  if (r.estado !== 200) throw new Error(`no se pudo registrar el pago de ${actor} (${r.estado}): ${r.texto.slice(0, 200)}`)
  return r.cuerpo.pago_id
}

async function prepararCarga(actor, pago, { numero, importe, bytes }) {
  const r = await rpc(local, tk(actor), 'preparar_carga_comprobante', {
    p_clave_carga: nuevaClave(), p_pago_id: pago, p_fecha: '2026-10-17', p_importe: importe, p_numero: numero,
    p_tipo_mime: 'image/png', p_tamano: bytes.length,
  })
  if (r.estado !== 200) throw new Error(`no se pudo preparar la carga de ${actor} (${r.estado}): ${r.texto.slice(0, 200)}`)
  objetos.push({ bucket: TEMPORAL, ruta: r.cuerpo.ruta_temporal })
  return r.cuerpo
}

/** Carga real: prepara, sube al bucket temporal con el JWT del padre y finaliza por HTTP con su Bearer. */
async function cargarOriginal(actor, pago, numero, importe, color) {
  const bytes = await png(color)
  const carga = await prepararCarga(actor, pago, { numero, importe, bytes })
  const subida = await st.subir(actor, TEMPORAL, carga.ruta_temporal, bytes, 'image/png')
  if (subida.estado !== 200) throw new Error(`no se pudo subir el temporal de ${actor} (${subida.estado})`)
  const final = await fetch(`${servidor.url}/api/comprobantes/cargas/${carga.carga_id}/finalizacion`, {
    method: 'POST', headers: { authorization: `Bearer ${tk(actor)}` }, signal: AbortSignal.timeout(120_000),
  })
  if (final.status !== 200) throw new Error(`no se pudo finalizar la carga de ${actor} (${final.status})`)
  const ruta = `${pago}/${carga.carga_id}.png`
  objetos.push({ bucket: BUCKET, ruta })
  return { id: carga.carga_id, ruta, bytes }
}

async function sembrar() {
  limpiezaEconomica()
  limpiarFixture({ prefijoDni: PREFIJO_DNI, prefijoCorreo: PREFIJO_CORREO, dominio: DOMINIO, curso: CURSO })
  for (const [k, rol] of Object.entries(roles)) {
    const usuario = await crearCuentaConPerfil(local, {
      email: correo(k),
      password: CONTRASENA,
      perfil: {
        nombre: 'Prueba', apellido: `EPT119 ${k}`, dni: dniDe(k), rol_id: rolId(rol),
        legajo_nro: ['ESTUDIANTE', 'DOCENTE'].includes(rol) ? `EPT119-${k}` : null,
      },
    })
    perfiles[k] = sql(`SELECT id FROM public.perfiles WHERE user_id='${usuario}';`)
    sesiones[k] = await exigirSesion(local, correo(k), CONTRASENA) // los JWT se emiten ANTES de cualquier bloqueo
  }
  // Fixture económico compartido + una cuarta factura del hijo para un segundo pago del copadre.
  sql(`BEGIN; ${economiaFixture(perfiles)}
    INSERT INTO public.facturas(id,alumno_id,periodo,vencimiento,total)
      VALUES('${ID(804)}','${perfiles.alumno}','2027-03-01','2027-03-10',500);
    INSERT INTO public.items_factura(id,factura_id,alumno_id,tipo,tarifa_id,matricula_id,inscripcion_deportiva_id,importe)
      VALUES('${ID(8041)}','${ID(804)}','${perfiles.alumno}','CUOTA','${ID(401)}','${ID(701)}',NULL,500);
    COMMIT;`)
  servidor = crearServidorNext(PUERTO)
  await servidor.iniciar({
    NEXT_PUBLIC_SUPABASE_URL: local.API_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: local.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY,
  })

  // P1: padre → alumno, dos facturas, original C1, aprobado con recibo R1.
  // P2: copadre → alumno, pendiente SIN archivo: sus cargas alimentan el bucket temporal.
  // P3: otra familia → alumno ajeno, original C3, aprobado con recibo R3.
  // P4: copadre → alumno, original C4 (cargado por el OTRO padre del mismo hijo), pendiente.
  P.p1 = await registrarPago('padre', ITEMS, 100000)
  P.p2 = await registrarPago('copadre', [ID(8012)], 30000)
  P.p3 = await registrarPago('otraFamilia', [ID(8031)], 50000)
  P.p4 = await registrarPago('copadre', [ID(8041)], 50000)
  C.c1 = await cargarOriginal('padre', P.p1, 'OP-EPT119-1', '990.00', '#305080')
  C.c3 = await cargarOriginal('otraFamilia', P.p3, 'OP-EPT119-3', '500.00', '#803050')
  C.c4 = await cargarOriginal('copadre', P.p4, 'OP-EPT119-4', '500.00', '#508030')
  for (const pago of [P.p1, P.p3]) {
    const r = await rpc(local, tk('director'), 'verificar_pago', { p_pago_id: pago, p_decision: 'APROBADO', p_motivo: null })
    if (r.estado !== 200) throw new Error(`Dirección no pudo aprobar el pago del fixture (${r.estado})`)
  }
  R.r1 = sql(`SELECT id FROM public.recibos WHERE pago_id='${P.p1}';`)
  R.r3 = sql(`SELECT id FROM public.recibos WHERE pago_id='${P.p3}';`)
  // Una ruta de recibo imaginaria en la columna que ningún rol de aplicación puede leer.
  sql(`UPDATE public.recibos SET archivo_path='${RUTA_RECIBO_FUTURA}' WHERE id='${R.r1}';`)

  // Cinco cargas PREPARADAS del copadre sobre P2 (ninguna se finaliza).
  const bytes = await png('#aaaaaa')
  for (const n of ['a', 'b', 'c', 'd', 'e']) {
    CARGA[n] = await prepararCarga('copadre', P.p2, { numero: `OP-EPT119-T${n}`, importe: '300.00', bytes })
  }
  CARGA.bytes = bytes
}

// ================================================================
// Expectativas de la matriz
// ================================================================
const LECTORES_ORIGINAL = {
  c1: ['director', 'segundo', 'padre'],
  c3: ['director', 'segundo', 'otraFamilia'],
  c4: ['director', 'segundo', 'copadre'],
}
const LECTORES_RECIBO = {
  r1: ['director', 'segundo', 'padre', 'copadre', 'alumno'],
  r3: ['director', 'segundo', 'otraFamilia', 'ajeno'],
}
const AUTORIZADOS_REGISTRO = {
  alumno: ['director', 'segundo', 'padre', 'copadre', 'alumno'],
  ajeno: ['director', 'segundo', 'otraFamilia', 'ajeno'],
}
// facturas, ítems, pagos, imputaciones, comprobantes, recibos (sobre los alumnos del fixture)
const CONTEOS = {
  director: [4, 5, 4, 5, 3, 2], segundo: [4, 5, 4, 5, 3, 2],
  padre: [3, 4, 3, 4, 1, 1], copadre: [3, 4, 3, 4, 1, 1], alumno: [3, 4, 3, 4, 0, 1],
  otraFamilia: [1, 1, 1, 1, 1, 1], ajeno: [1, 1, 1, 1, 0, 1],
  docente: [0, 0, 0, 0, 0, 0], personal: [0, 0, 0, 0, 0, 0], bloqueado: [0, 0, 0, 0, 0, 0],
}
const CEROS = [0, 0, 0, 0, 0, 0]
const NOMBRES_CONSULTA = ['facturas', 'items', 'pagos', 'imputaciones', 'comprobantes', 'recibos']
let consultas = null
const cuantos = (r) => (Array.isArray(r.cuerpo) ? r.cuerpo.length : -1)
const sinPrivilegio = (r) => [401, 403].includes(r.estado) && r.cuerpo?.code === '42501'

async function conteos(k) {
  const salida = []
  for (const nombre of NOMBRES_CONSULTA) salida.push(cuantos(await rest(local, tk(k), consultas[nombre])))
  return salida
}

const archivo = async (k, id, canal = 'cookie') => {
  const headers = !k ? {} : canal === 'cookie' ? { cookie: cookie(k) } : { authorization: `Bearer ${tk(k)}` }
  const r = await fetch(`${servidor.url}/api/comprobantes/${id}/archivo`, { headers, redirect: 'manual', signal: AbortSignal.timeout(120_000) })
  const buf = await r.arrayBuffer()
  let cuerpo = null
  try {
    cuerpo = JSON.parse(Buffer.from(buf).toString('utf8'))
  } catch {
    cuerpo = null
  }
  return {
    estado: r.status, ubicacion: r.headers.get('location'), cache: r.headers.get('cache-control'),
    cuerpo, texto: Buffer.from(buf).toString('utf8'),
  }
}
const pdf = async (k, id, canal = 'cookie', extra = {}) => {
  const headers = { ...(!k ? {} : canal === 'cookie' ? { cookie: cookie(k) } : { authorization: `Bearer ${tk(k)}` }), ...extra }
  const r = await fetch(`${servidor.url}/api/recibos/${id}/pdf`, { headers, redirect: 'manual', signal: AbortSignal.timeout(120_000) })
  const buffer = Buffer.from(await r.arrayBuffer())
  return { estado: r.status, tipo: r.headers.get('content-type'), buffer, texto: buffer.subarray(0, 600).toString('utf8') }
}
const esPdf = (r) => r.estado === 200 && r.tipo === 'application/pdf' && r.buffer.subarray(0, 5).toString() === '%PDF-'
const sello = async (bucket, ruta) => {
  const r = await srv.leer(bucket, ruta)
  return r.estado === 200 ? sha(r.buffer) : `estado-${r.estado}`
}
const huella = () => {
  const al = `'${perfiles.alumno}','${perfiles.ajeno}'`
  const ps = Object.values(P).map((x) => `'${x}'`).join(',')
  return sql(`SELECT md5(concat_ws('#',
    (SELECT string_agg(f::TEXT,'|' ORDER BY f.id) FROM public.facturas f WHERE f.alumno_id IN (${al})),
    (SELECT string_agg(i::TEXT,'|' ORDER BY i.id) FROM public.items_factura i WHERE i.alumno_id IN (${al})),
    (SELECT string_agg(x::TEXT,'|' ORDER BY x.pago_id, x.item_factura_id) FROM public.imputaciones_pago x WHERE x.alumno_id IN (${al})),
    (SELECT string_agg(p::TEXT,'|' ORDER BY p.id) FROM public.pagos p WHERE p.id IN (${ps})),
    (SELECT string_agg(r::TEXT,'|' ORDER BY r.id) FROM public.recibos r WHERE r.pago_id IN (${ps})),
    (SELECT string_agg(c::TEXT,'|' ORDER BY c.id) FROM public.comprobantes_pago c WHERE c.pago_id IN (${ps})),
    (SELECT string_agg(t::TEXT,'|' ORDER BY t.id) FROM public.tarifas t WHERE t.id IN ('${ID(401)}','${ID(402)}'))));`)
}

/** Lo que un actor alcanza hoy sobre la familia del fixture, por todos los canales. */
async function foto(k, { pagoResumen, comp, alumnoRegistro, recibo }) {
  const t = tk(k)
  const resumen = await rpc(local, t, 'resumen_comprobantes_pago', { p_pago_id: pagoResumen })
  const registro = await rpc(local, t, 'consultar_registro_comprobantes', {
    p_alumno_id: alumnoRegistro, p_criterio: 'PERIODO_FACTURA', p_desde: '2027-01-01', p_hasta: '2027-12-31',
  })
  const original = (await st.bajar(k, BUCKET, comp.ruta)).estado === 200 ? 'bytes' : 'negado'
  const endpoint = (await archivo(k, comp.id)).estado
  return {
    conteos: (await conteos(k)).join(),
    resumen: Array.isArray(resumen.cuerpo) ? resumen.cuerpo.length : -1,
    registro: Array.isArray(registro.cuerpo) ? registro.cuerpo.length : -1,
    original,
    endpoint,
    pdfCookie: (await pdf(k, recibo, 'cookie')).estado,
    pdfBearer: (await pdf(k, recibo, 'bearer')).estado,
  }
}
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// ================================================================
// Casos
// ================================================================
async function main() {
  await sembrar()
  const A = perfiles.alumno
  const todosLosPagos = Object.values(P)
  consultas = {
    facturas: `facturas?select=id&alumno_id=in.(${A},${perfiles.ajeno})`,
    items: `items_factura?select=id&alumno_id=in.(${A},${perfiles.ajeno})`,
    pagos: `pagos?select=id&alumno_id=in.(${A},${perfiles.ajeno})`,
    imputaciones: `imputaciones_pago?select=pago_id&alumno_id=in.(${A},${perfiles.ajeno})`,
    comprobantes: `comprobantes_pago?select=id&pago_id=in.(${todosLosPagos.join(',')})`,
    recibos: `recibos?select=id,pago_id,numero,emitido_en&pago_id=in.(${todosLosPagos.join(',')})`,
  }

  // ==============================================================
  // 0. Precondiciones positivas y estado previo al bloqueo
  // ==============================================================
  console.log('\n— 0. Precondiciones: el fixture existe y los autorizados acceden —')
  const ant = {
    c1: await sello(BUCKET, C.c1.ruta), c3: await sello(BUCKET, C.c3.ruta), c4: await sello(BUCKET, C.c4.ruta),
  }
  grupo('P00', 'los tres originales existen en Storage (servidor) con los bytes sembrados', [
    [ant.c1 === sha(C.c1.bytes), 'C1'], [ant.c3 === sha(C.c3.bytes), 'C3'], [ant.c4 === sha(C.c4.bytes), 'C4'],
    [sql(`SELECT count(*) FROM public.comprobantes_pago WHERE pago_id IN ('${P.p1}','${P.p3}','${P.p4}');`) === '3', 'tres filas de comprobantes_pago'],
    [sql(`SELECT count(*) FROM public.recibos WHERE pago_id IN ('${P.p1}','${P.p3}');`) === '2', 'dos recibos emitidos'],
    [sql(`SELECT count(*) FROM public.cargas_comprobante WHERE pago_id='${P.p2}' AND estado='PREPARADA';`) === '5', 'cinco cargas PREPARADAS del copadre'],
    [sql(`SELECT archivo_path FROM public.recibos WHERE id='${R.r1}';`) === RUTA_RECIBO_FUTURA, 'archivo_path sembrado en R1'],
  ])
  const antesBloqueado = await foto('bloqueado', { pagoResumen: P.p1, comp: C.c1, alumnoRegistro: A, recibo: R.r1 })
  grupo('P01', 'ANTES del bloqueo, el futuro DIRECTOR bloqueado accede a todo (no es un fixture roto)', [
    [antesBloqueado.conteos === CONTEOS.director.join(), `conteos ${antesBloqueado.conteos}`],
    [antesBloqueado.resumen === 1 && antesBloqueado.registro === 3, `resumen ${antesBloqueado.resumen}, registro ${antesBloqueado.registro}`],
    [antesBloqueado.original === 'bytes' && antesBloqueado.endpoint === 302, `original ${antesBloqueado.original}, endpoint ${antesBloqueado.endpoint}`],
    [antesBloqueado.pdfCookie === 200 && antesBloqueado.pdfBearer === 200, `recibo ${antesBloqueado.pdfCookie}/${antesBloqueado.pdfBearer}`],
  ])
  // Una URL firmada emitida ANTES del bloqueo (para el límite L01).
  const firmaPrevia = await st.firmar('bloqueado', BUCKET, C.c1.ruta, 60)
  const urlPrevia = urlFirmada(firmaPrevia)
  const previaDirecta = urlPrevia ? await soloUrl(urlPrevia) : { estado: 0, buffer: Buffer.alloc(0) }
  grupo('P02', 'antes del bloqueo el futuro bloqueado firma una URL que sirve el original', [
    [urlPrevia !== null && previaDirecta.estado === 200 && previaDirecta.buffer.equals(C.c1.bytes), 'URL previa sirve C1'],
  ])
  const gotrueAntes = await http('GET', `${local.API_URL}/auth/v1/user`, { token: tk('bloqueado') })
  sql(`UPDATE public.perfiles SET estado_acceso='BLOQUEADO' WHERE id='${perfiles.bloqueado}';`)
  const gotrueDespues = await http('GET', `${local.API_URL}/auth/v1/user`, { token: tk('bloqueado') })
  grupo('V00', 'bloquear la cuenta NO invalida el JWT en GoTrue: la denegación posterior la decide la base', [
    [gotrueAntes.estado === 200, 'GoTrue acepta el JWT antes'],
    [gotrueDespues.estado === 200, 'GoTrue sigue aceptando el mismo JWT después del bloqueo'],
  ])
  // Límite L01: se mide EN EL ACTO (la URL vive 60 s) y se informa más abajo con el resto de los límites.
  const nuevaBloqueado = await st.firmar('bloqueado', BUCKET, C.c1.ruta, 60)
  const residualBloqueado = urlPrevia ? await soloUrl(urlPrevia) : { estado: 0, buffer: Buffer.alloc(0) }
  const vigenciaPrevia = urlPrevia ? segundosRestantes(urlPrevia) : -1

  // ==============================================================
  // R. PostgREST económico
  // ==============================================================
  console.log('\n— R. PostgREST económico por actor —')
  const filasR01 = []
  const huellaInicial = huella()
  for (const k of ACTORES.filter(Boolean)) {
    const obtenido = await conteos(k)
    filasR01.push([igual(obtenido, CONTEOS[k]), `${k} esperaba ${CONTEOS[k]} y obtuvo ${obtenido}`])
  }
  for (const nombre of NOMBRES_CONSULTA) {
    const r = await rest(local, null, consultas[nombre])
    filasR01.push([sinPrivilegio(r), `anónimo: ${nombre} → ${r.estado}/${r.cuerpo?.code}`])
  }
  grupo('R01', 'facturas, ítems, pagos, imputaciones, comprobantes y recibos por actor (autorizados primero)', filasR01)

  const embeds = []
  const consultaPagos = `pagos?select=id,imputaciones_pago(item_factura_id),comprobantes_pago(id),recibos(numero)&alumno_id=eq.${A}`
  const consultaFacturas = `facturas?select=id,items_factura(id,importe)&alumno_id=eq.${A}`
  const esperadoEmbed = { // pagos, imputaciones, comprobantes, recibos | facturas, ítems
    director: [3, 4, 2, 1, 3, 4], segundo: [3, 4, 2, 1, 3, 4], padre: [3, 4, 1, 1, 3, 4], copadre: [3, 4, 1, 1, 3, 4],
    alumno: [3, 4, 0, 1, 3, 4], otraFamilia: [0, 0, 0, 0, 0, 0], ajeno: [0, 0, 0, 0, 0, 0],
    docente: [0, 0, 0, 0, 0, 0], personal: [0, 0, 0, 0, 0, 0], bloqueado: [0, 0, 0, 0, 0, 0],
  }
  for (const k of ACTORES.filter(Boolean)) {
    const rp = await rest(local, tk(k), consultaPagos)
    const rf = await rest(local, tk(k), consultaFacturas)
    // `recibos` es uno a uno (pago_id único): PostgREST lo devuelve como objeto o null, no como lista.
    const largo = (v) => (Array.isArray(v) ? v.length : v ? 1 : 0)
    const suma = (campo) => (Array.isArray(rp.cuerpo) ? rp.cuerpo.reduce((s, p) => s + largo(p[campo]), 0) : -1)
    const obtenido = [
      cuantos(rp), suma('imputaciones_pago'), suma('comprobantes_pago'), suma('recibos'),
      cuantos(rf), Array.isArray(rf.cuerpo) ? rf.cuerpo.reduce((s, f) => s + f.items_factura.length, 0) : -1,
    ]
    embeds.push([igual(obtenido, esperadoEmbed[k]), `${k} esperaba ${esperadoEmbed[k]} y obtuvo ${obtenido}`])
  }
  grupo('R02', 'embeds pagos→(imputaciones, comprobantes, recibos) y facturas→ítems respetan el alcance de cada actor', embeds)

  const tarifasQ = `tarifas?select=id&id=in.(${ID(401)},${ID(402)})`
  const filasR03 = []
  for (const k of ACTORES) {
    const r = await rest(local, tk(k), tarifasQ)
    const cargas = await rest(local, tk(k), 'cargas_comprobante?select=id')
    filasR03.push([k === null ? sinPrivilegio(r) : r.estado === 200 && cuantos(r) === (['director', 'segundo'].includes(k) ? 2 : 0), `${nom(k)}: tarifas ${r.estado}/${cuantos(r)}`])
    filasR03.push([sinPrivilegio(cargas), `${nom(k)}: cargas_comprobante → ${cargas.estado}/${cargas.cuerpo?.code} (cerrada a todos, incluida Dirección)`])
  }
  grupo('R03', 'tarifas solo para Dirección; cargas_comprobante cerrada a todos los roles de aplicación', filasR03)

  // Columna archivo_path: no se lee, no se filtra y no se ordena (un filtro sería un oráculo de existencia).
  const rPadre = await rest(local, tk('padre'), `recibos?select=id,numero&id=eq.${R.r1}`)
  const variantes = [
    'recibos?select=archivo_path', 'recibos?select=*', `recibos?select=id&archivo_path=not.is.null`,
    `recibos?select=id&archivo_path=eq.${encodeURIComponent(RUTA_RECIBO_FUTURA)}`, 'recibos?select=id&order=archivo_path',
    `pagos?select=id,recibos(archivo_path)&id=eq.${P.p1}`,
  ]
  const filasR04 = [
    [rPadre.estado === 200 && cuantos(rPadre) === 1, 'precondición: el padre ve el recibo R1 por sus columnas permitidas'],
    [sql(`SELECT count(*) FROM public.recibos WHERE archivo_path IS NOT NULL;`) !== '0', 'precondición: la columna archivo_path tiene un valor'],
  ]
  for (const k of ACTORES) {
    for (const q of variantes) {
      const r = await rest(local, tk(k), q)
      filasR04.push([sinPrivilegio(r), `${nom(k)}: ${q} → ${r.estado}/${r.cuerpo?.code}`])
    }
  }
  grupo('R04', 'recibos.archivo_path da 42501 (columna, filtro, orden y embed) a todos los actores, incluida Dirección', filasR04)

  // Escrituras directas a toda tabla económica, por cada actor: todas cerradas y sin efectos.
  const filasR05 = []
  const intentos = (k) => {
    const alumno = perfiles.alumno
    return [
      ['facturas', 'POST', 'facturas', { alumno_id: alumno, periodo: '2030-01-01', vencimiento: '2030-01-10', total: 1 }],
      ['facturas', 'PATCH', `facturas?id=eq.${ID(801)}`, { total: 1 }],
      ['facturas', 'DELETE', `facturas?id=eq.${ID(801)}`],
      ['items_factura', 'POST', 'items_factura', { factura_id: ID(801), alumno_id: alumno, tipo: 'CUOTA', importe: 1 }],
      ['items_factura', 'PATCH', `items_factura?id=eq.${ITEMS[0]}`, { importe: 1 }],
      ['items_factura', 'DELETE', `items_factura?id=eq.${ITEMS[0]}`],
      ['imputaciones_pago', 'POST', 'imputaciones_pago', { pago_id: P.p1, item_factura_id: ITEMS[0], alumno_id: alumno, importe: 1 }],
      ['imputaciones_pago', 'PATCH', `imputaciones_pago?pago_id=eq.${P.p1}`, { importe: 1 }],
      ['imputaciones_pago', 'DELETE', `imputaciones_pago?pago_id=eq.${P.p1}`],
      ['pagos', 'POST', 'pagos', { padre_id: perfiles.padre, alumno_id: alumno, total_calculado: 1 }],
      ['pagos', 'PATCH', `pagos?id=eq.${P.p4}`, { estado: 'APROBADO', importe_informado: 1 }],
      ['pagos', 'DELETE', `pagos?id=eq.${P.p4}`],
      ['recibos', 'POST', 'recibos', { pago_id: P.p4, numero: 990001 }],
      ['recibos', 'PATCH', `recibos?id=eq.${R.r1}`, { numero: 990002 }],
      ['recibos', 'DELETE', `recibos?id=eq.${R.r1}`],
      ['comprobantes_pago', 'POST', 'comprobantes_pago', { pago_id: P.p1, subido_por: perfiles.padre, ruta_archivo: 'x', tipo_mime: 'image/png', tamano_bytes: 1 }],
      ['comprobantes_pago', 'PATCH', `comprobantes_pago?id=eq.${C.c1.id}`, { subido_por: perfiles.copadre }],
      ['comprobantes_pago', 'DELETE', `comprobantes_pago?id=eq.${C.c1.id}`],
      ['cargas_comprobante', 'PATCH', `cargas_comprobante?id=eq.${CARGA.a.carga_id}`, { estado: 'CONFIRMADA' }],
      ['cargas_comprobante', 'DELETE', `cargas_comprobante?id=eq.${CARGA.a.carga_id}`],
      ['tarifas', 'PATCH', `tarifas?id=eq.${ID(401)}`, { importe: 1 }],
      ['tarifas', 'DELETE', `tarifas?id=eq.${ID(401)}`],
    ].map(([tabla, metodo, ruta, json]) => ({ tabla, metodo, ruta, json, k }))
  }
  for (const k of ACTORES) {
    for (const i of intentos(k)) {
      const r = await rest(local, tk(k), i.ruta, { method: i.metodo, body: i.json })
      filasR05.push([sinPrivilegio(r), `${nom(k)}: ${i.metodo} ${i.tabla} → ${r.estado}/${r.cuerpo?.code}`])
    }
  }
  grupo('R05', 'ningún actor (Dirección incluida) inserta, edita ni borra importes, imputaciones, pagos, recibos ni comprobantes', filasR05)
  grupo('R05b', 'tras todos los intentos de escritura el contenido económico es idéntico (huella SHA de filas)', [
    [huella() === huellaInicial, 'huella antes y después'],
    [sql(`SELECT count(*) FROM public.cargas_comprobante WHERE pago_id='${P.p2}' AND estado='PREPARADA';`) === '5', 'las cinco cargas siguen PREPARADAS'],
  ])

  // Dirección verifica; nadie más (ni el bloqueado) puede decidir.
  const filasR06 = [[sql(`SELECT estado FROM public.pagos WHERE id='${P.p1}';`) === 'APROBADO', 'precondición: Dirección ya verificó P1 y P3 (RPC con su JWT)']]
  for (const k of ACTORES.filter((x) => x !== 'director' && x !== 'segundo')) {
    const r = await rpc(local, tk(k), 'verificar_pago', { p_pago_id: P.p4, p_decision: 'APROBADO', p_motivo: null })
    filasR06.push([[401, 403].includes(r.estado), `${nom(k)}: verificar_pago → ${r.estado}`])
  }
  filasR06.push([sql(`SELECT estado FROM public.pagos WHERE id='${P.p4}';`) === 'PENDIENTE_VERIFICACION', 'P4 sigue pendiente'])
  grupo('R06', 'verificar_pago por RPC: solo Dirección habilitada; el DIRECTOR bloqueado con JWT vigente, no', filasR06)

  // ==============================================================
  // S. Registro saneado
  // ==============================================================
  console.log('\n— S. Registro saneado (RPC) —')
  const filasS01 = []
  const resumenEsperado = { [P.p1]: [AUTORIZADOS_REGISTRO.alumno, 1], [P.p2]: [AUTORIZADOS_REGISTRO.alumno, 0], [P.p3]: [AUTORIZADOS_REGISTRO.ajeno, 1] }
  for (const [pago, [autorizados, cantidad]] of Object.entries(resumenEsperado)) {
    for (const k of [...autorizados, ...ACTORES.filter((x) => x && !autorizados.includes(x)), null]) {
      const r = await rpc(local, tk(k), 'resumen_comprobantes_pago', { p_pago_id: pago })
      if (autorizados.includes(k)) {
        filasS01.push([r.estado === 200 && r.cuerpo?.length === 1 && r.cuerpo[0].cantidad_archivos === cantidad &&
          Object.keys(r.cuerpo[0]).sort().join() === 'cantidad_archivos,pago_id,ultima_carga_en', `${k} ve ${cantidad} archivo(s) del pago ${pago.slice(-4)} y solo (pago_id, cantidad, última carga)`])
      } else if (k === null) {
        filasS01.push([[401, 403].includes(r.estado) && !(Array.isArray(r.cuerpo) && r.cuerpo.length > 0), `anónimo: ${r.estado}`])
      } else {
        filasS01.push([r.estado === 200 && Array.isArray(r.cuerpo) && r.cuerpo.length === 0, `${k}: 0 filas del pago ${pago.slice(-4)} (${r.estado})`])
      }
    }
  }
  grupo('S01', 'resumen_comprobantes_pago: cantidad real al autorizado (también 0 si no hay archivo); cero filas al resto', filasS01)

  const filasS02 = []
  const peligroso = /ruta_archivo|archivo_path|storage\/|https?:|token=|signed|secreto-ept119/iu
  for (const [clave, autorizados] of Object.entries(AUTORIZADOS_REGISTRO)) {
    const esperadas = clave === 'alumno' ? 3 : 1
    for (const k of [...autorizados, ...ACTORES.filter((x) => x && !autorizados.includes(x)), null]) {
      const r = await rpc(local, tk(k), 'consultar_registro_comprobantes', {
        p_alumno_id: perfiles[clave], p_criterio: 'PERIODO_FACTURA', p_desde: '2027-01-01', p_hasta: '2027-12-31',
      })
      if (autorizados.includes(k)) {
        filasS02.push([r.estado === 200 && r.cuerpo?.length === esperadas && !peligroso.test(JSON.stringify(r.cuerpo)),
          `${k} recibe ${esperadas} pago(s) de ${clave} sin ruta ni URL (${r.estado}/${r.cuerpo?.length})`])
      } else if (k === null) {
        filasS02.push([[401, 403].includes(r.estado), `anónimo: ${r.estado}`])
      } else {
        filasS02.push([r.estado === 200 && Array.isArray(r.cuerpo) && r.cuerpo.length === 0, `${k}: 0 pagos de ${clave} (${r.estado})`])
      }
    }
  }
  grupo('S02', 'consultar_registro_comprobantes por hijo propio, vinculado o ajeno: alcance por hijo y sin ruta ni URL', filasS02)

  // ==============================================================
  // O. Original en Storage directo
  // ==============================================================
  console.log('\n— O. Original del comprobante en Storage —')
  const rutas = { c1: C.c1.ruta, c3: C.c3.ruta, c4: C.c4.ruta }
  const bytes = { c1: C.c1.bytes, c3: C.c3.bytes, c4: C.c4.bytes }
  const pagoDe = { c1: P.p1, c3: P.p3, c4: P.p4 }
  const filasO01 = []
  const filasO02 = []
  for (const c of ['c1', 'c3', 'c4']) {
    const lectores = LECTORES_ORIGINAL[c]
    filasO01.push([await existe(BUCKET, rutas[c]), `precondición: ${c} existe en Storage (servidor)`])
    for (const k of [...lectores, ...ACTORES.filter((x) => x && !lectores.includes(x)), null]) {
      const leido = await st.bajar(k, BUCKET, rutas[c])
      const firma = await st.firmar(k, BUCKET, rutas[c])
      const url = urlFirmada(firma)
      const lote = await st.firmarLote(k, BUCKET, [rutas.c1, rutas.c3, rutas.c4])
      if (lectores.includes(k)) {
        filasO01.push([leido.estado === 200 && leido.buffer.equals(bytes[c]), `${k} descarga ${c} byte a byte`])
        const servida = url ? await soloUrl(url) : { estado: 0, buffer: Buffer.alloc(0) }
        filasO02.push([url !== null && servida.estado === 200 && servida.buffer.equals(bytes[c]), `${k} firma ${c} y la URL sirve los bytes`])
        filasO02.push([urlDeLote(lote, rutas[c]) !== null, `${k} obtiene la firma por lote de ${c}`])
      } else {
        filasO01.push([leido.estado >= 400 && !leido.buffer.equals(bytes[c]), `${nom(k)} NO descarga ${c} (${leido.estado})`])
        filasO02.push([url === null, `${nom(k)} NO obtiene firma de ${c} (${firma.estado})`])
        filasO02.push([urlDeLote(lote, rutas[c]) === null, `${nom(k)} NO obtiene firma por lote de ${c}`])
      }
    }
  }
  grupo('O01', 'descarga del original por cada actor y comprobante: solo el cargador y Dirección', filasO01)
  grupo('O02', 'firma (individual y por lote) del original: solo quien puede leerlo; la URL sirve los bytes', filasO02)

  const filasO03 = []
  for (const k of ACTORES) {
    const raiz = await st.listar(k, BUCKET, '')
    const carpetas = visibles(raiz).filter((n) => todosLosPagos.includes(n)).sort()
    const esperadas = ['c1', 'c3', 'c4'].filter((c) => LECTORES_ORIGINAL[c].includes(k)).map((c) => pagoDe[c]).sort()
    filasO03.push([igual(carpetas, esperadas), `${nom(k)}: listado raíz muestra ${carpetas.length} carpeta(s) de pagos, esperaba ${esperadas.length}`])
    for (const c of ['c1', 'c3', 'c4']) {
      const lista = await st.listar(k, BUCKET, pagoDe[c])
      const quiere = LECTORES_ORIGINAL[c].includes(k) ? [rutas[c].split('/')[1]] : []
      filasO03.push([igual(visibles(lista).sort(), quiere), `${nom(k)}: listado del pago de ${c} → ${visibles(lista).length}, esperaba ${quiere.length}`])
    }
  }
  grupo('O03', 'listado de Storage (raíz y por pago): cada actor ve solo el original que puede leer', filasO03)

  const filasO04 = []
  for (const c of ['c1', 'c3', 'c4']) {
    const r = await st.publico(BUCKET, rutas[c])
    filasO04.push([r.estado >= 400 && !r.buffer.equals(bytes[c]), `ruta pública de ${c} → ${r.estado}`])
  }
  grupo('O04', 'el bucket es privado: ninguna ruta pública sirve un original', filasO04)

  const filasO05 = [[(await existe(BUCKET, rutas.c1)) && (await existe(BUCKET, rutas.c3)) && (await existe(BUCKET, rutas.c4)), 'precondición: C1, C3 y C4 existen (y sus lectores acceden: O01)']]
  const carpetasAntes = { c1: await nombres(BUCKET, P.p1), c3: await nombres(BUCKET, P.p3), c4: await nombres(BUCKET, P.p4) }
  let n = 0
  for (const k of ACTORES) {
    const t = ++n
    const nueva = `${P.p1}/${idExtra(9000 + t)}.png`
    const r = {
      subir: await st.subir(k, BUCKET, nueva, C.c1.bytes, 'image/png'),
      upsert: await st.subir(k, BUCKET, rutas.c1, Buffer.concat([C.c1.bytes, Buffer.from('x')]), 'image/png', true),
      put: await st.reemplazar(k, BUCKET, rutas.c3, Buffer.concat([C.c3.bytes, Buffer.from('y')]), 'image/png'),
      mover: await st.mover(k, BUCKET, rutas.c4, `${P.p4}/${idExtra(9100 + t)}.png`),
      copiar: await st.copiar(k, BUCKET, rutas.c1, `${P.p1}/${idExtra(9200 + t)}.png`),
    }
    await st.borrar(k, BUCKET, [rutas.c1])
    await st.borrar(k, BUCKET, [rutas.c3, rutas.c4]) // el borrado «exitoso» sin efecto se detecta con los SHA de más abajo
    filasO05.push([Object.values(r).every((x) => x.estado >= 400), `${nom(k)}: subida, upsert, PUT, mover y copiar → ${Object.values(r).map((x) => x.estado).join('/')}`])
  }
  const selloPost = { c1: await sello(BUCKET, rutas.c1), c3: await sello(BUCKET, rutas.c3), c4: await sello(BUCKET, rutas.c4) }
  filasO05.push([selloPost.c1 === ant.c1 && selloPost.c3 === ant.c3 && selloPost.c4 === ant.c4, 'los tres originales siguen idénticos (SHA-256) tras subir, reemplazar, borrar, mover y copiar'])
  filasO05.push([
    igual(await nombres(BUCKET, P.p1), carpetasAntes.c1) && igual(await nombres(BUCKET, P.p3), carpetasAntes.c3) && igual(await nombres(BUCKET, P.p4), carpetasAntes.c4),
    'ninguna escritura de cliente dejó objetos nuevos en las carpetas de pago (listado con credencial de servidor)',
  ])
  grupo('O05', 'escritura de clientes sobre el bucket final (subir, upsert, PUT, borrar, mover, copiar): cerrada a todos', filasO05)

  // ==============================================================
  // E. Endpoint del original
  // ==============================================================
  console.log('\n— E. Endpoint /api/comprobantes/[id]/archivo —')
  const filasE01 = []
  const urlsEmitidas = {}
  for (const c of ['c1', 'c3', 'c4']) {
    const lectores = LECTORES_ORIGINAL[c]
    for (const k of [...lectores, ...ACTORES.filter((x) => x && !lectores.includes(x)), null]) {
      const r = await archivo(k, C[c].id)
      if (lectores.includes(k)) {
        const servida = r.ubicacion ? await soloUrl(r.ubicacion) : { estado: 0, buffer: Buffer.alloc(0) }
        filasE01.push([r.estado === 302 && r.cache === 'no-store' && servida.estado === 200 && servida.buffer.equals(bytes[c]),
          `${k} recibe 302 sin caché a una URL firmada que sirve ${c} (${r.estado})`])
        urlsEmitidas[`${k}:${c}`] = r.ubicacion
      } else {
        const esperado = k === null ? 401 : k === 'bloqueado' ? 403 : 404
        filasE01.push([r.estado === esperado && !r.ubicacion && detalleTecnicoEn(r.texto) === null &&
          (k !== 'bloqueado' || r.cuerpo?.codigo === 'ACCESO_BLOQUEADO'),
        `${nom(k)}: ${c} → ${r.estado} (esperaba ${esperado}), sin ubicación ni detalle técnico`])
      }
    }
  }
  const desconocido = await archivo('director', ID(99119))
  const malformado = await archivo('director', 'no-es-un-uuid')
  filasE01.push([desconocido.estado === 404 && malformado.estado === 404, 'identificador inexistente o mal formado → 404 (también para Dirección)'])
  grupo('E01', 'endpoint del original con cookies: 302 al cargador y a Dirección; 404 al resto; 403 al bloqueado; 401 al anónimo', filasE01)

  // (e) El endpoint solo autentica por cookies: con Bearer NO entrega nada. Se documenta, no se cambia el producto.
  const filasE02 = [[(await archivo('padre', C.c1.id, 'cookie')).estado === 302, 'precondición: el mismo padre, con cookies, recibe 302']]
  for (const k of ACTORES.filter(Boolean)) {
    const r = await archivo(k, C.c1.id, 'bearer')
    filasE02.push([r.estado === 401 && !r.ubicacion && detalleTecnicoEn(r.texto) === null, `${k} con Bearer válido y sin cookies → ${r.estado} (esperaba 401)`])
  }
  const mixto = await fetch(`${servidor.url}/api/comprobantes/${C.c1.id}/archivo`, {
    headers: { authorization: `Bearer ${tk('director')}`, cookie: cookie('padre') }, redirect: 'manual', signal: AbortSignal.timeout(60_000),
  })
  filasE02.push([mixto.status === 302, 'con Bearer de Dirección y cookie del cargador decide la COOKIE (el Bearer se ignora): 302 como cargador'])
  const mixto2 = await fetch(`${servidor.url}/api/comprobantes/${C.c3.id}/archivo`, {
    headers: { authorization: `Bearer ${tk('director')}`, cookie: cookie('padre') }, redirect: 'manual', signal: AbortSignal.timeout(60_000),
  })
  filasE02.push([mixto2.status === 404 && !mixto2.headers.get('location'), 'y un Bearer de Dirección NO amplía a la cookie de otra familia: 404'])
  grupo('E02', 'LÍMITE DOCUMENTADO: el original solo se entrega con cookies; el Bearer móvil recibe 401', filasE02)

  const ubicacionPadre = urlsEmitidas['padre:c1']
  const restante = ubicacionPadre ? segundosRestantes(ubicacionPadre) : -1
  grupo('E03', 'la URL emitida por el endpoint vence en ~60 s (tope del PRODUCTO, no de Storage)', [
    [restante > 0 && restante <= 61, `segundos restantes ${restante}`],
  ])

  // ==============================================================
  // T. Bucket temporal de cargas
  // ==============================================================
  console.log('\n— T. Bucket temporal —')
  const rutaA = CARGA.a.ruta_temporal
  const rutaB = CARGA.b.ruta_temporal
  const rutaPrefijo = P.p2
  const subidaB = await st.subir('copadre', TEMPORAL, rutaB, CARGA.bytes, 'image/png')
  const firmaSubidaA = await st.firmarSubida('copadre', TEMPORAL, rutaA)
  const selloB = await sello(TEMPORAL, rutaB)
  grupo('T00', 'precondición: la carga es PREPARADA y su dueño (copadre) sube su archivo; el objeto existe en Storage', [
    [subidaB.estado === 200, `el copadre sube a su carga B (${subidaB.estado})`],
    [selloB === sha(CARGA.bytes), 'el servidor lee el objeto temporal byte a byte'],
    [firmaSubidaA.estado === 200, `el copadre puede firmar una subida a su carga A (${firmaSubidaA.estado})`],
    [!(await existe(TEMPORAL, rutaA)), 'la carga A todavía no tiene objeto'],
  ])
  const filasT = { subida: [], upsert: [], lectura: [], listado: [], firma: [], borrado: [], mover: [] }
  for (const k of ACTORES) {
    const dueno = k === 'copadre'
    const es = (r) => r.estado >= 400
    if (!dueno) {
      const nueva = await st.subir(k, TEMPORAL, rutaA, CARGA.bytes, 'image/png')
      const firmaS = await st.firmarSubida(k, TEMPORAL, rutaA)
      filasT.subida.push([es(nueva) && es(firmaS), `${nom(k)}: subida (${nueva.estado}) y firma de subida (${firmaS.estado}) a la carga ajena`])
    }
    const up = await st.subir(k, TEMPORAL, rutaB, Buffer.concat([CARGA.bytes, Buffer.from('z')]), 'image/png', true)
    const put = await st.reemplazar(k, TEMPORAL, rutaB, Buffer.concat([CARGA.bytes, Buffer.from('w')]), 'image/png')
    filasT.upsert.push([es(up) && es(put), `${nom(k)}: reemplazo con upsert (${up.estado}) y PUT (${put.estado})`])
    const leido = await st.bajar(k, TEMPORAL, rutaB)
    const publico = k === null ? await st.publico(TEMPORAL, rutaB) : { estado: 400, buffer: Buffer.alloc(0) }
    filasT.lectura.push([es(leido) && !leido.buffer.equals(CARGA.bytes) && es(publico), `${nom(k)}: lectura (${leido.estado}) y ruta pública (${publico.estado})`])
    const l1 = await st.listar(k, TEMPORAL, rutaPrefijo)
    const l2 = await st.listar(k, TEMPORAL, '')
    filasT.listado.push([visibles(l1).length === 0 && visibles(l2).filter((x) => x === rutaPrefijo).length === 0, `${nom(k)}: listado del pago (${visibles(l1).length}) y de la raíz`])
    const f1 = await st.firmar(k, TEMPORAL, rutaB)
    const f2 = await st.firmarLote(k, TEMPORAL, [rutaB])
    filasT.firma.push([urlFirmada(f1) === null && urlDeLote(f2, rutaB) === null, `${nom(k)}: firma de lectura individual (${f1.estado}) y por lote`])
    const b1 = await st.borrar(k, TEMPORAL, [rutaB])
    const b2 = await st.borrar(k, TEMPORAL, [rutaB, rutaA])
    filasT.borrado.push([await existe(TEMPORAL, rutaB), `${nom(k)}: tras borrar (${b1.estado}/${b2.estado}) el objeto B sigue existiendo`])
    const m = await st.mover(k, TEMPORAL, rutaB, `${rutaPrefijo}/${idExtra(9500)}`)
    const c = await st.copiar(k, TEMPORAL, rutaB, `${P.p2}/${idExtra(9501)}.png`, BUCKET)
    filasT.mover.push([es(m) && es(c), `${nom(k)}: mover (${m.estado}) y copiar al bucket final (${c.estado})`])
  }
  grupo('T01', 'subida y firma de subida a una carga ajena: solo la dueña; copadre, padre, estudiantes, otra familia, docente, personal, Dirección, bloqueado y anónimo, no', filasT.subida)
  grupo('T02', 'reemplazo (upsert y PUT) de un temporal existente: nadie, tampoco su dueña', filasT.upsert)
  grupo('T03', 'lectura (autenticada y pública) de un temporal: nadie, tampoco la dueña ni Dirección', filasT.lectura)
  grupo('T04', 'listado del bucket temporal: nadie ve nada', filasT.listado)
  grupo('T05', 'firma de lectura (individual y por lote) de un temporal: nadie', filasT.firma)
  grupo('T06', 'borrado de un temporal: nadie lo borra', filasT.borrado)
  grupo('T07', 'mover un temporal o copiarlo al bucket final: nadie', filasT.mover)
  grupo('T08', 'tras todos los ataques: B idéntico, A sin objeto y la carpeta del pago solo con B (servidor)', [
    [(await sello(TEMPORAL, rutaB)) === selloB, 'el objeto B sigue idéntico (SHA-256)'],
    [!(await existe(TEMPORAL, rutaA)), 'la carga A sigue sin objeto: ningún ajeno pudo ocuparla'],
    [igual(await nombres(TEMPORAL, rutaPrefijo), [rutaB.split('/')[1]]), 'la carpeta temporal del pago contiene solo B'],
    [!(await existe(BUCKET, `${P.p2}/${idExtra(9501)}.png`)), 'nada se copió al bucket final'],
  ])
  const subidaA = await st.subir('copadre', TEMPORAL, rutaA, CARGA.bytes, 'image/png')
  grupo('T09', 'la carga A era una ranura válida y estaba intacta: su dueña sube sin upsert y es aceptado', [
    [subidaA.estado === 200, `subida de la dueña a A (${subidaA.estado})`],
  ])

  // ==============================================================
  // C / B. Recibos
  // ==============================================================
  console.log('\n— C. Recibos institucionales —')
  const filasC01 = []
  const filasC02 = []
  for (const r of ['r1', 'r3']) {
    const lectores = LECTORES_RECIBO[r]
    for (const k of [...lectores, ...ACTORES.filter((x) => x && !lectores.includes(x)), null]) {
      const cookieR = await pdf(k, R[r], 'cookie')
      const bearerR = await pdf(k, R[r], 'bearer')
      if (lectores.includes(k)) {
        filasC01.push([esPdf(cookieR) && cookieR.estado === 200, `${k} descarga ${r} con cookies (${cookieR.estado})`])
        filasC02.push([esPdf(bearerR), `${k} descarga ${r} con Bearer (${bearerR.estado})`])
      } else {
        const esperado = k === null ? 401 : 403
        filasC01.push([cookieR.estado === esperado && detalleTecnicoEn(cookieR.texto) === null, `${nom(k)}: ${r} con cookies → ${cookieR.estado} (esperaba ${esperado})`])
        filasC02.push([(k === null ? bearerR.estado === 401 : bearerR.estado === 403) && detalleTecnicoEn(bearerR.texto) === null, `${nom(k)}: ${r} con Bearer → ${bearerR.estado}`])
      }
    }
  }
  grupo('C01', 'PDF del recibo con cookies: padre, copadre vinculado, estudiante propio y Dirección; el resto 403; anónimo 401', filasC01)
  grupo('C02', 'PDF del recibo con Bearer (móvil): mismo reparto que con cookies', filasC02)
  const mezclaPadreDir = await pdf('padre', R.r3, 'bearer', { cookie: cookie('director') })
  const mezclaBasura = await pdf('director', R.r1, 'cookie', { authorization: 'Bearer no.es.untoken' })
  grupo('C03', 'cookie y Bearer a la vez: manda el Bearer; no se suman privilegios', [
    [esPdf(await pdf('director', R.r3, 'cookie')), 'precondición: Dirección con cookies descarga R3'],
    [mezclaPadreDir.estado === 403, `Bearer del padre + cookie de Dirección sobre un recibo ajeno → ${mezclaPadreDir.estado}`],
    [mezclaBasura.estado === 401, `cookie de Dirección + Bearer inválido → ${mezclaBasura.estado}`],
  ])

  console.log('\n— B. No hay bucket ni ruta de recibos —')
  const listaBuckets = await http('GET', `${STORAGE}/bucket`, SERVIDOR)
  const idsBuckets = Array.isArray(listaBuckets.datos) ? listaBuckets.datos.map((b) => b.id) : []
  const rutasRecibo = [RUTA_RECIBO_FUTURA, `${P.p1}/${R.r1}.pdf`, `recibos/${R.r1}.pdf`]
  const filasB = [
    [!idsBuckets.some((id) => /recibo/iu.test(id)) && idsBuckets.includes(BUCKET), `precondición: buckets reales = ${idsBuckets.join(', ')} (ninguno de recibos)`],
    [esPdf(await pdf('padre', R.r1, 'cookie')), 'precondición: el recibo R1 existe y su padre lo descarga por el endpoint'],
    [sql(`SELECT archivo_path FROM public.recibos WHERE id='${R.r1}';`) === RUTA_RECIBO_FUTURA, 'precondición: R1 tiene archivo_path en la base'],
  ]
  for (const k of ACTORES) {
    for (const bucket of ['recibos', BUCKET, TEMPORAL]) {
      for (const ruta of rutasRecibo) {
        const leido = await st.bajar(k, bucket, ruta)
        const firma = await st.firmar(k, bucket, ruta)
        filasB.push([leido.estado >= 400 && urlFirmada(firma) === null, `${nom(k)}: ${bucket}/${ruta.slice(0, 18)}… descarga ${leido.estado}, firma ${firma.estado}`])
      }
      const lista = await st.listar(k, bucket, 'recibos-futuros')
      filasB.push([visibles(lista).length === 0, `${nom(k)}: listado de ${bucket}/recibos-futuros vacío`])
    }
  }
  grupo('B01', 'firmar, listar o leer un recibo vía Storage es imposible para todos, Dirección incluida', filasB)
  const filasB02 = []
  for (const k of ['director', 'padre', null]) {
    const crear = await http('POST', `${STORAGE}/bucket`, { token: tk(k), json: { id: 'recibos', name: 'recibos', public: false } })
    const subirR = await st.subir(k, 'recibos', `${R.r1}.pdf`, Buffer.from('%PDF-1.4\n%%EOF\n'), 'application/pdf')
    filasB02.push([crear.estado >= 400 && subirR.estado >= 400, `${nom(k)}: crear bucket «recibos» (${crear.estado}) y subir un PDF (${subirR.estado}) denegados`])
  }
  const tras = await http('GET', `${STORAGE}/bucket`, SERVIDOR)
  const creados = Array.isArray(tras.datos) ? tras.datos.filter((b) => /recibo/iu.test(b.id)).map((b) => b.id) : ['(lista ilegible)']
  filasB02.push([creados.length === 0, `tras los intentos no existe ningún bucket de recibos (${creados.join(',')})`])
  for (const id of creados) if (id !== '(lista ilegible)') await http('DELETE', `${STORAGE}/bucket/${id}`, SERVIDOR) // retira el daño si una política se aflojara
  grupo('B02', 'los clientes no pueden crear un bucket de recibos ni escribir en él', filasB02)
  const consultaRecibo = await rpc(local, tk('padre'), 'consultar_recibo', { p_recibo_id: R.r1 })
  grupo('B03', 'la fuente del recibo que entrega consultar_recibo no contiene archivo_path, rutas ni URL de Storage', [
    [consultaRecibo.estado === 200 && consultaRecibo.cuerpo?.recibo_id === R.r1, 'precondición: el padre obtiene la fuente de R1'],
    [!peligroso.test(JSON.stringify(consultaRecibo.cuerpo)), 'sin campos de ruta ni URL'],
  ])

  // ==============================================================
  // V. Revocaciones con JWT vigente
  // ==============================================================
  console.log('\n— V. Revocación con el JWT todavía vigente —')
  // V01: bloqueo (el DIRECTOR bloqueado ya fue probado en R–C como cualquier actor; acá, su efecto completo).
  const fotoBloqueado = await foto('bloqueado', { pagoResumen: P.p1, comp: C.c1, alumnoRegistro: A, recibo: R.r1 })
  grupo('V01', 'DIRECTOR bloqueado con JWT emitido antes del bloqueo: pierde PostgREST, RPC, Storage y ambos endpoints', [
    [antesBloqueado.original === 'bytes' && antesBloqueado.endpoint === 302, 'precondición (P01): antes del bloqueo sí accedía'],
    [fotoBloqueado.conteos === CEROS.join(), `conteos ${fotoBloqueado.conteos}`],
    [fotoBloqueado.resumen === 0 && fotoBloqueado.registro === 0, `resumen ${fotoBloqueado.resumen}, registro ${fotoBloqueado.registro}`],
    [fotoBloqueado.original === 'negado', 'Storage directo: descarga negada'],
    [fotoBloqueado.endpoint === 403, `endpoint del original → ${fotoBloqueado.endpoint} (ACCESO_BLOQUEADO)`],
    [fotoBloqueado.pdfCookie === 403 && fotoBloqueado.pdfBearer === 403, `recibo con cookies y Bearer → ${fotoBloqueado.pdfCookie}/${fotoBloqueado.pdfBearer}`],
  ])

  // V02/V03: vínculo revocado (copadre y padre cargador).
  const revocar = (k) => sql(`DELETE FROM public.padres_hijos WHERE padre_id='${perfiles[k]}' AND hijo_id='${A}';`)
  const restaurar = (k) => sql(`INSERT INTO public.padres_hijos(padre_id,hijo_id) VALUES('${perfiles[k]}','${A}');`)

  const vigente = (k) => ({
    conteos: CONTEOS[k].join(), resumen: 1, registro: 3, original: 'bytes', endpoint: 302, pdfCookie: 200, pdfBearer: 200,
  })
  const vacio = { estado: 0, buffer: Buffer.alloc(0) }
  const esperadoRevocado = { conteos: CEROS.join(), resumen: 0, registro: 0, original: 'negado', endpoint: 404, pdfCookie: 403, pdfBearer: 403 }
  const cfgCop = { pagoResumen: P.p4, comp: C.c4, alumnoRegistro: A, recibo: R.r1 }
  const cfgPad = { pagoResumen: P.p1, comp: C.c1, alumnoRegistro: A, recibo: R.r1 }
  const sinRef = (f) => ({ conteos: f.conteos, resumen: f.resumen, registro: f.registro, original: f.original, endpoint: f.endpoint, pdfCookie: f.pdfCookie, pdfBearer: f.pdfBearer })

  // Copadre: temporal + URL ya emitidas (se prueban EN EL ACTO: viven 60 s).
  const copAntes = await foto('copadre', cfgCop)
  const dSube = await st.subir('copadre', TEMPORAL, CARGA.d.ruta_temporal, CARGA.bytes, 'image/png')
  const urlCopFirmada = urlFirmada(await st.firmar('copadre', BUCKET, C.c4.ruta, 60))
  const urlCopAnual = urlFirmada(await st.firmar('copadre', BUCKET, C.c4.ruta, 31_536_000))
  const urlCopEndpoint = (await archivo('copadre', C.c4.id)).ubicacion
  revocar('copadre')
  const residualCop = urlCopFirmada ? await soloUrl(urlCopFirmada) : vacio
  const residualCopAnual = urlCopAnual ? await soloUrl(urlCopAnual) : vacio
  const residualCopEndpoint = urlCopEndpoint ? await soloUrl(urlCopEndpoint) : vacio
  const vigenciaEndpoint = urlCopEndpoint ? segundosRestantes(urlCopEndpoint) : -1
  const copDespues = await foto('copadre', cfgCop)
  const cSube = await st.subir('copadre', TEMPORAL, CARGA.c.ruta_temporal, CARGA.bytes, 'image/png')
  const cAusente = !(await existe(TEMPORAL, CARGA.c.ruta_temporal))
  const copFirmaNueva = await st.firmar('copadre', BUCKET, C.c4.ruta, 60)
  restaurar('copadre')
  const copRestaurado = await foto('copadre', cfgCop)
  const cSubeTras = await st.subir('copadre', TEMPORAL, CARGA.c.ruta_temporal, CARGA.bytes, 'image/png')
  grupo('V02', 'copadre desvinculado con JWT vigente: pierde pagos, imputaciones, registro, resumen, original, recibo y subida temporal; al revincular, vuelve', [
    [igual(sinRef(copAntes), vigente('copadre')), `precondición: vinculado accede a todo (${JSON.stringify(sinRef(copAntes))})`],
    [dSube.estado === 200, 'precondición: vinculado sube a su carga temporal D'],
    [igual(sinRef(copDespues), esperadoRevocado), `desvinculado: ${JSON.stringify(sinRef(copDespues))}`],
    [cSube.estado >= 400 && cAusente, `desvinculado no sube a su carga C (${cSube.estado}) y el objeto no existe`],
    [urlFirmada(copFirmaNueva) === null, 'desvinculado no obtiene una firma nueva del original que cargó'],
    [igual(sinRef(copRestaurado), vigente('copadre')), 'revinculado: recupera el mismo acceso (la causa era el vínculo)'],
    [cSubeTras.estado === 200, 'revinculado sube a C: la ranura era válida y seguía libre'],
  ])
  grupo('L02', 'LÍMITE DOCUMENTADO tras desvincular: las URL firmadas ya emitidas (60 s, 1 año y la del endpoint) siguen sirviendo hasta vencer; Storage no las revoca ni acota su TTL', [
    [urlCopFirmada !== null && urlCopAnual !== null && urlCopEndpoint !== null, 'las tres URL se emitieron mientras estaba vinculado'],
    [residualCop.estado === 200 && residualCop.buffer.equals(C.c4.bytes), 'la URL de 60 s sigue sirviendo el original'],
    [residualCopEndpoint.estado === 200 && residualCopEndpoint.buffer.equals(C.c4.bytes), 'la URL emitida por el endpoint sigue sirviendo hasta vencer'],
    [residualCopAnual.estado === 200 && urlCopAnual !== null && segundosRestantes(urlCopAnual) > 300 * 24 * 3600,
      'Storage aceptó firmar a un año (sin TTL máximo global): la URL anual sigue sirviendo'],
    [vigenciaEndpoint > 0 && vigenciaEndpoint <= 61, `el tope de 60 s es del endpoint del producto, no de Storage (${vigenciaEndpoint} s restantes)`],
  ])

  // Padre cargador: original y economía.
  const padAntes = await foto('padre', cfgPad)
  revocar('padre')
  const padDespues = await foto('padre', cfgPad)
  const padListado = await st.listar('padre', BUCKET, P.p1)
  restaurar('padre')
  const padRestaurado = await foto('padre', cfgPad)
  grupo('V03', 'padre cargador desvinculado con JWT vigente: pierde su propio original, la economía, el registro y el recibo; al revincular, vuelve', [
    [igual(sinRef(padAntes), vigente('padre')), `precondición: vinculado accede a todo (${JSON.stringify(sinRef(padAntes))})`],
    [igual(sinRef(padDespues), esperadoRevocado), `desvinculado: ${JSON.stringify(sinRef(padDespues))}`],
    [visibles(padListado).length === 0, 'desvinculado no lista su carpeta de Storage'],
    [igual(sinRef(padRestaurado), vigente('padre')), 'revinculado: recupera el mismo acceso'],
  ])

  // Rol revocado: un DIRECTOR pasa a PERSONAL con su JWT vigente.
  const cfgDir = { pagoResumen: P.p1, comp: C.c1, alumnoRegistro: A, recibo: R.r1 }
  const dirAntes = await foto('segundo', cfgDir)
  sql(`UPDATE public.perfiles SET rol_id=${rolId('PERSONAL')} WHERE id='${perfiles.segundo}';`)
  const dirDespues = await foto('segundo', cfgDir)
  const dirVerificar = await rpc(local, tk('segundo'), 'verificar_pago', { p_pago_id: P.p4, p_decision: 'APROBADO', p_motivo: null })
  sql(`UPDATE public.perfiles SET rol_id=${rolId('DIRECTOR')} WHERE id='${perfiles.segundo}';`)
  const dirRestaurado = await foto('segundo', cfgDir)
  grupo('V04', 'DIRECTOR que pasa a PERSONAL con JWT vigente: pierde toda la economía, los originales y los recibos; al restaurar el rol, vuelve', [
    [igual(sinRef(dirAntes), vigente('segundo')), `precondición: como DIRECTOR accede a todo (${JSON.stringify(sinRef(dirAntes))})`],
    [igual(sinRef(dirDespues), esperadoRevocado), `como PERSONAL: ${JSON.stringify(sinRef(dirDespues))}`],
    [[401, 403].includes(dirVerificar.estado) && sql(`SELECT estado FROM public.pagos WHERE id='${P.p4}';`) === 'PENDIENTE_VERIFICACION', 'como PERSONAL no verifica pagos'],
    [igual(sinRef(dirRestaurado), vigente('segundo')), 'con el rol restaurado recupera el acceso (la causa era el rol)'],
  ])

  // ==============================================================
  // L. Límite documentado con el DIRECTOR bloqueado (medido justo después del bloqueo)
  // ==============================================================
  console.log('\n— L. Límites documentados —')
  grupo('L01', 'LÍMITE DOCUMENTADO: la URL firmada por el DIRECTOR antes de su bloqueo sigue sirviendo hasta vencer; no se afirma revocación instantánea', [
    [urlFirmada(nuevaBloqueado) === null, 'bloqueado: ya no obtiene firmas nuevas'],
    [residualBloqueado.estado === 200 && residualBloqueado.buffer.equals(C.c1.bytes), 'la URL previa al bloqueo todavía sirve los bytes (capacidad temporal, no revocable)'],
    [vigenciaPrevia > 0 && vigenciaPrevia <= 61, `su vigencia era de 60 s (${vigenciaPrevia} s restantes): el riesgo lo acota quien firma, no Storage`],
  ])

  grupo('R99', 'al terminar, el contenido económico es el del inicio (nada se alteró durante toda la matriz)', [
    [huella() === huellaInicial, 'huella SHA de filas'],
    [(await sello(BUCKET, rutas.c1)) === ant.c1 && (await sello(BUCKET, rutas.c3)) === ant.c3 && (await sello(BUCKET, rutas.c4)) === ant.c4, 'originales idénticos'],
  ])
}

let codigoSalida = 0
try {
  await main()
} catch (error) {
  console.error(`FALLO  la suite terminó con una excepción: ${error.stack ?? error.message}`)
  conteo.fallos += 1
} finally {
  try {
    await servidor?.detener()
  } catch {
    // El proceso ya no existe.
  }
  await limpiarTodo()
}
const segundos = Math.round((Date.now() - INICIO) / 1000)
console.log(`\n${conteo.afirmaciones} casos, ${comprobaciones} comprobaciones, ${conteo.fallos} fallo(s) en ${segundos} s.`)
if (conteo.fallos > 0) codigoSalida = 1
process.exit(codigoSalida)
