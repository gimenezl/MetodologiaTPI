/**
 * EPT-109 — Carga de comprobantes de transferencia contra Auth, PostgREST,
 * Storage y el servidor de Next REALES, con JWT de cada actor.
 *
 * Lo que ninguna prueba simulada puede mostrar: que la política de INSERT del
 * bucket temporal funciona con el servicio real (y solo para la carga propia),
 * que la finalización autentica el Bearer contra Auth, que una carga repetida o
 * concurrente no duplica nada y que ante cada falla el estado durable queda
 * coherente (sin comprobante aparente sin archivo válido y sin borrar archivos
 * confirmados).
 *
 *   1. Preparar: actores, pagos ajenos, datos inválidos, importe antes del cast,
 *      idempotencia, número de operación y tope técnico de cargas sin completar.
 *   2. Storage temporal: INSERT solo para la carga propia; sin reemplazo, lectura,
 *      listado, firma, borrado, movimiento ni copia; límite y MIME del servicio.
 *   3. Finalización por HTTP (Bearer real): archivo válido, varios archivos por
 *      pago, pago con varias facturas, datos que no se sobrescriben, contenido
 *      inválido o contradictorio, objeto ausente, repetición y concurrencia.
 *   4. Fallas intermedias: vínculo revocado, cuenta bloqueada, pago rechazado y
 *      número de operación duplicado entre dos pagos concurrentes.
 *   5. Lectura: solo el cargador y Dirección acceden al original; copadre y
 *      estudiante, solo al registro saneado.
 *   6. Conciliación: vencimiento, retiro de temporales y de huérfanos sin tocar
 *      comprobantes confirmados, repetida.
 *
 *     EPT_SUPABASE_WORKDIR=<dir del stack aislado> \
 *     EPT_SUPABASE_DB_CONTAINER=supabase_db_ept109 \
 *       node supabase/tests/comprobantes_carga.mjs
 *
 * Autosuficiente: siembra su fixture (DNI 9611xxxx, correos ept109.*@ept.local) y
 * lo limpia al terminar. Solo acepta una instancia de Supabase de bucle local.
 * No imprime claves, tokens ni URLs firmadas.
 */

import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import {
  afirmar,
  api,
  conteo,
  cookieDe,
  crearCuentaConPerfil,
  crearServidorNext,
  detalleTecnicoEn,
  exigirSesion,
  limpiarFixture,
  sql,
} from './_arnes-ept59.mjs'

const BUCKET = 'comprobantes-pago'
const TEMPORAL = 'comprobantes-pago-temporal'
const MAXIMO = 5 * 1024 * 1024
const PREFIJO_DNI = '9611'
const PREFIJO_CORREO = 'ept109.'
const DOMINIO = 'ept.local'
const CURSO = 'Curso EPT-109 comprobantes'
const CONTRASENA = 'prueba-ept-109-comprobantes'
const PUERTO = Number(process.env.EPT_PUERTO_NEXT ?? 3109)
const ID = (n) => `b3090000-0000-4000-8000-${String(n).padStart(12, '0')}`
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
const SECRETO_CRON = `ept109-${Math.random().toString(16).slice(2)}`

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

const rpc = (token, funcion, argumentos) =>
  http('POST', `${local.API_URL}/rest/v1/rpc/${funcion}`, { token, json: argumentos })
const rest = (token, ruta) => http('GET', `${local.API_URL}/rest/v1/${ruta}`, { token })
const SERVIDOR = { apikey: local.SERVICE_ROLE_KEY, token: local.SERVICE_ROLE_KEY }
const sha = (b) => createHash('sha256').update(b).digest('hex')

/** Sube un objeto al bucket indicado con las credenciales de `token`. */
const subir = (bucket, ruta, buffer, tipo, { token, upsert = false, servidor = false } = {}) =>
  http('POST', `${STORAGE}/object/${bucket}/${ruta}`, {
    ...(servidor ? SERVIDOR : { token }),
    cabeceras: { 'content-type': tipo, 'x-upsert': upsert ? 'true' : 'false' },
    cuerpo: buffer,
  })
const bajar = (bucket, ruta, token) =>
  http('GET', `${STORAGE}/object/authenticated/${bucket}/${ruta}`, token ? { token } : {})
const bajarComoServidor = (bucket, ruta) => http('GET', `${STORAGE}/object/${bucket}/${ruta}`, SERVIDOR)
const existeComoServidor = async (bucket, ruta) => (await bajarComoServidor(bucket, ruta)).estado === 200

// ================================================================
// Binarios sintéticos reales
// ================================================================
const { default: sharp } = await import('sharp')
const img = (formato, color) =>
  sharp({ create: { width: 64, height: 48, channels: 3, background: color } })[formato]().toBuffer()

function pdfMinimo(relleno = '', extraCatalogo = '') {
  const objetos = [
    `<< /Type /Catalog /Pages 2 0 R${extraCatalogo} >>`,
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>',
  ]
  let s = `%PDF-1.4\n%${relleno}\n`
  const offs = []
  objetos.forEach((o, i) => {
    offs.push(s.length)
    s += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = s.length
  s += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`
  for (const o of offs) s += `${String(o).padStart(10, '0')} 00000 n \n`
  s += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(s, 'latin1')
}

// ================================================================
// Fixture
// ================================================================
const PERSONAS = {
  director: { dni: '96110001', rol: 'DIRECTOR', apellido: 'Directora' },
  estudianteA: { dni: '96110002', rol: 'ESTUDIANTE', apellido: 'AlumnaA', legajo_nro: 'LEG-EPT109-S2' },
  estudianteC: { dni: '96110003', rol: 'ESTUDIANTE', apellido: 'AlumnoC', legajo_nro: 'LEG-EPT109-S3' },
  docente: { dni: '96110004', rol: 'DOCENTE', apellido: 'Docente', legajo_nro: 'LEG-EPT109-S4' },
  padreA: { dni: '96110005', rol: 'PADRE', apellido: 'PadreA' },
  copadre: { dni: '96110006', rol: 'PADRE', apellido: 'CopadreA' },
  padreC: { dni: '96110007', rol: 'PADRE', apellido: 'PadreC' },
  personal: { dni: '96110008', rol: 'PERSONAL', apellido: 'Personal' },
  padreD: { dni: '96110009', rol: 'PADRE', apellido: 'PadreD' },
  padreE: { dni: '96110010', rol: 'PADRE', apellido: 'PadreE' },
  padreF: { dni: '96110011', rol: 'PADRE', apellido: 'PadreF' },
}
const correo = (clave) => `${PREFIJO_CORREO}${clave}@${DOMINIO}`
const rolId = (nombre) => Number(sql(`SELECT id FROM public.roles WHERE nombre = '${nombre}';`))
const actores = {}
const TARIFA = ID(401)
let contadorFactura = 0
const facturasCreadas = []

function crearItem(alumnoClave) {
  contadorFactura += 1
  const factura = ID(800 + contadorFactura)
  const item = ID(900 + contadorFactura)
  const alumno = actores[alumnoClave].perfil
  const periodo = `${2026 + Math.floor((contadorFactura + 9) / 12)}-${String(((contadorFactura + 9) % 12) + 1).padStart(2, '0')}-01`
  sql(`
    INSERT INTO public.facturas (id, alumno_id, periodo, vencimiento, total)
      VALUES ('${factura}', '${alumno}', '${periodo}', '${periodo}'::DATE + 9, 50000);
    INSERT INTO public.items_factura (id, factura_id, alumno_id, tipo, tarifa_id, matricula_id, importe)
      VALUES ('${item}', '${factura}', '${alumno}', 'CUOTA', '${TARIFA}',
        (SELECT id FROM public.matriculas WHERE alumno_id = '${alumno}'), 50000);
  `)
  facturasCreadas.push(factura)
  return item
}

let claveContador = 0
const clave = () => `b3091000-0000-4000-8000-${String(++claveContador).padStart(12, '0')}`

/** Registra un pago real con `registrar_pago` (EPT-108) y devuelve su id. */
async function registrarPago(actor, itemIds) {
  const r = await rpc(actor.token, 'registrar_pago', {
    p_clave_intento: clave(),
    p_item_ids: itemIds,
    p_total_esperado_centavos: itemIds.length * 5_000_000,
  })
  if (r.estado !== 200) throw new Error(`no se pudo registrar el pago de la fixture (${r.estado})`)
  return r.datos.pago_id
}

function limpiarEconomia() {
  const pagos = `(SELECT id FROM public.pagos WHERE alumno_id IN (SELECT id FROM public.perfiles WHERE dni LIKE '${PREFIJO_DNI}%'))`
  sql(`
    DELETE FROM public.cargas_comprobante WHERE pago_id IN ${pagos};
    DELETE FROM public.comprobantes_pago WHERE pago_id IN ${pagos};
    DELETE FROM public.recibos WHERE pago_id IN ${pagos};
    DELETE FROM public.imputaciones_pago WHERE pago_id IN ${pagos};
    DELETE FROM public.pagos WHERE id IN ${pagos};
    DELETE FROM public.items_factura WHERE alumno_id IN (SELECT id FROM public.perfiles WHERE dni LIKE '${PREFIJO_DNI}%');
    DELETE FROM public.facturas WHERE alumno_id IN (SELECT id FROM public.perfiles WHERE dni LIKE '${PREFIJO_DNI}%');
    DELETE FROM public.tarifas WHERE id = '${TARIFA}';
  `)
}

async function limpiarObjetos() {
  const carpetas = sql(`SELECT id FROM public.pagos WHERE alumno_id IN
    (SELECT id FROM public.perfiles WHERE dni LIKE '${PREFIJO_DNI}%');`)
    .split('\n').filter(Boolean)
  for (const bucket of [BUCKET, TEMPORAL]) {
    const rutas = []
    for (const pago of carpetas) {
      const lista = await http('POST', `${STORAGE}/object/list/${bucket}`, {
        ...SERVIDOR, json: { prefix: pago, limit: 1000, offset: 0 },
      })
      if (Array.isArray(lista.datos)) rutas.push(...lista.datos.map((o) => `${pago}/${o.name}`))
    }
    if (rutas.length > 0) {
      await http('DELETE', `${STORAGE}/object/${bucket}`, { ...SERVIDOR, json: { prefixes: rutas } })
    }
  }
}

async function sembrar() {
  limpiarEconomia()
  limpiarFixture({ prefijoDni: PREFIJO_DNI, prefijoCorreo: PREFIJO_CORREO, dominio: DOMINIO, curso: CURSO })

  for (const [claveActor, p] of Object.entries(PERSONAS)) {
    const userId = await crearCuentaConPerfil(local, {
      email: correo(claveActor),
      password: CONTRASENA,
      perfil: {
        nombre: 'Prueba', apellido: `S109${p.apellido}`, dni: p.dni,
        rol_id: rolId(p.rol), legajo_nro: p.legajo_nro ?? null,
      },
    })
    actores[claveActor] = { userId, perfil: sql(`SELECT id FROM public.perfiles WHERE user_id = '${userId}';`) }
  }
  const a = (c) => actores[c].perfil
  sql(`
    BEGIN;
    INSERT INTO public.cursos (nivel_id, denominacion, division, activo)
    VALUES ((SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), '${CURSO}', 'A', TRUE);
    INSERT INTO public.matriculas (alumno_id, curso_id)
    SELECT p.id, (SELECT id FROM public.cursos WHERE denominacion = '${CURSO}')
    FROM public.perfiles p WHERE p.id IN ('${a('estudianteA')}', '${a('estudianteC')}');
    UPDATE public.alumnos SET estado = 'ACTIVO' WHERE perfil_id IN ('${a('estudianteA')}', '${a('estudianteC')}');
    SET CONSTRAINTS ALL IMMEDIATE;
    SET CONSTRAINTS ALL DEFERRED;
    INSERT INTO public.padres_hijos (padre_id, hijo_id) VALUES
      ('${a('padreA')}', '${a('estudianteA')}'), ('${a('copadre')}', '${a('estudianteA')}'),
      ('${a('padreD')}', '${a('estudianteA')}'), ('${a('padreE')}', '${a('estudianteA')}'),
      ('${a('padreF')}', '${a('estudianteA')}'), ('${a('padreC')}', '${a('estudianteC')}');
    COMMIT;
    INSERT INTO public.tarifas (id, concepto, nivel_id, importe, desde)
      VALUES ('${TARIFA}', 'CUOTA', (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 50000, '2026-01-01');
  `)
  for (const claveActor of Object.keys(PERSONAS)) {
    actores[claveActor].token = (await exigirSesion(local, correo(claveActor), CONTRASENA)).access_token
    actores[claveActor].sesion = null
  }
}

async function limpiarTodo() {
  const pasos = [
    ['objetos', () => limpiarObjetos()],
    ['economía', () => limpiarEconomia()],
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
}

// ================================================================
// Operaciones de la historia
// ================================================================
const FECHA = '2026-10-14'
/** Una carga adicional no reenvía los datos: los hereda del pago. */
const HEREDA = { fecha: null, importe: null, numero: null }
const prepararCarga = (actor, o = {}) =>
  rpc(actor.token, 'preparar_carga_comprobante', {
    p_clave_carga: o.clave ?? clave(),
    p_pago_id: o.pago,
    p_fecha: 'fecha' in o ? o.fecha : FECHA,
    p_importe: 'importe' in o ? o.importe : '50000.00',
    p_numero: 'numero' in o ? o.numero : `OP-${claveContador}-${Math.random().toString(16).slice(2, 8)}`,
    p_tipo_mime: o.tipo ?? 'image/jpeg',
    p_tamano: o.tamano ?? 1000,
  })

let servidor = null
const finalizar = (actor, cargaId, { token } = {}) =>
  fetch(`${servidor.url}/api/comprobantes/cargas/${cargaId}/finalizacion`, {
    method: 'POST',
    headers: token === null ? {} : { authorization: `Bearer ${token ?? actor.token}` },
    signal: AbortSignal.timeout(90_000),
  }).then(async (r) => {
    const texto = await r.text()
    let cuerpo = null
    try {
      cuerpo = JSON.parse(texto)
    } catch {
      cuerpo = null
    }
    return { estado: r.status, cuerpo, texto, cacheControl: r.headers.get('cache-control') }
  })

/** Prepara, sube el archivo a la ruta temporal y devuelve la carga. */
async function cargarArchivo(actor, pago, buffer, tipo, o = {}) {
  const prep = await prepararCarga(actor, { pago, tipo, tamano: buffer.length, ...o })
  if (prep.estado !== 200) {
    console.error(`  (la preparación devolvió ${prep.estado}: ${JSON.stringify(prep.datos)})`)
    return { prep }
  }
  const subida = await subir(TEMPORAL, prep.datos.ruta_temporal, buffer, tipo, { token: actor.token })
  return { prep, carga: prep.datos, subida }
}

const filaPago = (id) => sql(`SELECT estado || '|' || COALESCE(numero_operacion,'') || '|' ||
  COALESCE(importe_informado::TEXT,'') || '|' || COALESCE(fecha_transferencia::TEXT,'') || '|' ||
  total_calculado::TEXT FROM public.pagos WHERE id = '${id}';`)
const contar = (consulta) => Number(sql(`SELECT count(*) ${consulta};`))
const cantidadComprobantes = (pago) => contar(`FROM public.comprobantes_pago WHERE pago_id = '${pago}'`)
const estadoCarga = (id) => sql(`SELECT estado || ':' || COALESCE(motivo_descarte,'') FROM public.cargas_comprobante WHERE id = '${id}';`)
const rutaFinal = (carga, ext) => `${carga.pago_id}/${carga.carga_id}.${ext}`

async function main() {
  await sembrar()
  servidor = crearServidorNext(PUERTO)
  await servidor.iniciar({
    NEXT_PUBLIC_SUPABASE_URL: local.API_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: local.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY,
    CRON_SECRET: SECRETO_CRON,
  })

  const A = actores.padreA
  const JPG = await img('jpeg', '#2060a0')
  const JPG2 = await img('jpeg', '#20a060')
  const PNG = await img('png', '#a06020')
  const PDF = pdfMinimo('uno')
  const PDF2 = pdfMinimo('dos')

  // Un pago con DOS facturas del mismo hijo y su fixture de comparación.
  const itemsA1 = [crearItem('estudianteA'), crearItem('estudianteA')]
  const pagoA1 = await registrarPago(A, itemsA1)
  const pagoA2 = await registrarPago(A, [crearItem('estudianteA')])
  const pagoC = await registrarPago(actores.padreC, [crearItem('estudianteC')])
  const antes = {
    pagos: contar(`FROM public.pagos WHERE id IN ('${pagoA1}','${pagoA2}')`),
    imputaciones: contar(`FROM public.imputaciones_pago WHERE pago_id = '${pagoA1}'`),
    estadoItems: sql(`SELECT string_agg(estado_pago::TEXT, ',' ORDER BY id) FROM public.items_factura
                      WHERE id IN ('${itemsA1[0]}','${itemsA1[1]}');`),
    total: sql(`SELECT total_calculado::TEXT FROM public.pagos WHERE id = '${pagoA1}';`),
  }
  const fotoSaldo = () => sql(`SELECT string_agg(factura_id || ':' || saldo_centavos || ':' || estado || ':' ||
    items_en_verificacion, ',' ORDER BY factura_id) FROM public.estado_cuotas_alumno
    WHERE alumno_id = '${actores.estudianteA.perfil}';`)
  antes.saldo = fotoSaldo()
  afirmar(antes.imputaciones === 2 && antes.estadoItems === 'EN_VERIFICACION,EN_VERIFICACION',
    'fixture: un pago pendiente con DOS facturas y sus ítems EN_VERIFICACION')

  // ==============================================================
  // 1. Preparar
  // ==============================================================
  console.log('\n— 1. Preparar —')
  const claveA = clave()
  const numeroA = `OP-A-${Date.now()}`
  const p1 = await prepararCarga(A, { clave: claveA, pago: pagoA1, numero: numeroA, tipo: 'image/jpeg', tamano: JPG.length })
  afirmar(p1.estado === 200 && p1.datos.estado === 'PREPARADA' && p1.datos.repetido === false &&
    p1.datos.ruta_temporal === `${pagoA1}/${p1.datos.carga_id}` && p1.datos.importe_centavos === 5_000_000 &&
    p1.datos.bucket_temporal === TEMPORAL,
  'el padre del pago prepara una carga: ruta temporal canónica, importe en centavos exactos')
  afirmar(filaPago(pagoA1).startsWith('PENDIENTE_VERIFICACION||||'),
    'preparar NO toca el pago: sin número, fecha ni importe, y sigue pendiente')
  const pRep = await prepararCarga(A, { clave: claveA, pago: pagoA1, numero: numeroA, tipo: 'image/jpeg', tamano: JPG.length })
  afirmar(pRep.estado === 200 && pRep.datos.carga_id === p1.datos.carga_id && pRep.datos.repetido === true &&
    contar(`FROM public.cargas_comprobante WHERE clave_carga = '${claveA}'`) === 1,
  'reintento idéntico: la misma carga, repetido = true, sin fila nueva')
  const pOtro = await prepararCarga(A, { clave: claveA, pago: pagoA1, numero: numeroA, tipo: 'image/png', tamano: JPG.length })
  afirmar(pOtro.estado >= 400 && pOtro.datos?.code === 'P6864',
    'misma clave con otro archivo declarado: conflicto explícito, no se reutiliza')
  const pOtroNum = await prepararCarga(A, { clave: claveA, pago: pagoA1, numero: 'OTRO', tipo: 'image/jpeg', tamano: JPG.length })
  afirmar(pOtroNum.datos?.code === 'P6864', 'misma clave con otro número de operación: conflicto explícito')

  const rechazos = [
    ['copadre sobre un pago ajeno del mismo hijo', actores.copadre, { pago: pagoA1 }, 'P6861'],
    ['otra familia', actores.padreC, { pago: pagoA1 }, 'P6861'],
    ['pago inexistente', A, { pago: ID(9999) }, 'P6861'],
    ['tipo no permitido (SVG)', A, { pago: pagoA2, tipo: 'image/svg+xml' }, 'P6860'],
    ['tipo no permitido (HTML)', A, { pago: pagoA2, tipo: 'text/html' }, 'P6860'],
    ['archivo vacío', A, { pago: pagoA2, tamano: 0 }, 'P6860'],
    ['un byte sobre el máximo', A, { pago: pagoA2, tamano: MAXIMO + 1 }, 'P6860'],
    ['importe con tres decimales (no se redondea)', A, { pago: pagoA2, importe: '1500.505' }, 'P6860'],
    ['importe negativo', A, { pago: pagoA2, importe: '-1' }, 'P6860'],
    ['importe en notación científica', A, { pago: pagoA2, importe: '1e3' }, 'P6860'],
    ['importe NaN', A, { pago: pagoA2, importe: 'NaN' }, 'P6860'],
    ['importe con coma', A, { pago: pagoA2, importe: '10,50' }, 'P6860'],
    ['importe de 11 dígitos enteros', A, { pago: pagoA2, importe: '12345678901' }, 'P6860'],
    ['fecha inexistente', A, { pago: pagoA2, fecha: '2026-02-30' }, 'P6860'],
    ['fecha infinity', A, { pago: pagoA2, fecha: 'infinity' }, 'P6860'],
    ['fecha con formato local', A, { pago: pagoA2, fecha: '14/10/2026' }, 'P6860'],
    ['número de operación vacío', A, { pago: pagoA2, numero: '   ' }, 'P6860'],
    ['número de operación sobre el tope técnico', A, { pago: pagoA2, numero: 'x'.repeat(2001) }, 'P6860'],
    ['datos incompletos (sin importe)', A, { pago: pagoA2, importe: null }, 'P6860'],
  ]
  for (const [nombre, actor, o, codigo] of rechazos) {
    const r = await prepararCarga(actor, o)
    afirmar(r.estado >= 400 && r.datos?.code === codigo, `preparar rechaza: ${nombre} (${codigo})`)
  }
  afirmar(contar(`FROM public.cargas_comprobante WHERE pago_id = '${pagoA2}'`) === 0,
    'ningún rechazo dejó una carga registrada')

  for (const [nombre, token] of [
    ['anónimo', null], ['estudiante', actores.estudianteA.token], ['docente', actores.docente.token],
    ['personal', actores.personal.token], ['director', actores.director.token],
  ]) {
    const r = await prepararCarga({ token }, { pago: pagoA2 })
    afirmar(r.estado >= 400 && contar(`FROM public.cargas_comprobante WHERE pago_id = '${pagoA2}'`) === 0,
      `preparar deniega a ${nombre} y no escribe`)
  }
  const directa = await http('POST', `${local.API_URL}/rest/v1/cargas_comprobante`, {
    token: A.token, json: { padre_id: A.perfil, pago_id: pagoA1, clave_carga: clave() },
  })
  afirmar(directa.estado >= 400, 'una escritura directa en cargas_comprobante está cerrada')
  const directaC = await http('POST', `${local.API_URL}/rest/v1/comprobantes_pago`, {
    token: A.token, json: { pago_id: pagoA1, subido_por: A.perfil, ruta_archivo: 'x', tipo_mime: 'image/png', tamano_bytes: 1 },
  })
  afirmar(directaC.estado >= 400 && cantidadComprobantes(pagoA1) === 0,
    'una escritura directa en comprobantes_pago está cerrada')
  for (const funcion of ['confirmar_carga_comprobante', 'obtener_carga_para_finalizar', 'descartar_carga_comprobante']) {
    const r = await rpc(A.token, funcion, {
      p_usuario_id: A.userId, p_carga_id: p1.datos.carga_id, p_sha256: sha(JPG),
      p_tamano: JPG.length, p_tipo_mime: 'image/jpeg', p_motivo: 'ARCHIVO_INVALIDO',
    })
    afirmar(r.estado >= 400 && estadoCarga(p1.datos.carga_id).startsWith('PREPARADA'),
      `un cliente no puede invocar ${funcion} (solo service_role)`)
  }
  const sinToken = await rpc({ token: null }, 'preparar_carga_comprobante', {
    p_clave_carga: clave(), p_pago_id: pagoA2, p_fecha: FECHA, p_importe: '1', p_numero: 'Z',
    p_tipo_mime: 'image/png', p_tamano: 10,
  })
  afirmar(sinToken.estado >= 400, 'preparar sin sesión: denegado')

  // ==============================================================
  // 2. Storage temporal
  // ==============================================================
  console.log('\n— 2. Storage temporal —')
  const rutaT = p1.datos.ruta_temporal
  const subida = await subir(TEMPORAL, rutaT, JPG, 'image/jpeg', { token: A.token })
  afirmar(subida.estado === 200, 'el padre sube el archivo a la ruta temporal de SU carga preparada')
  const reemplazo = await subir(TEMPORAL, rutaT, JPG2, 'image/jpeg', { token: A.token })
  afirmar(reemplazo.estado >= 400, 'sin reemplazo: una segunda subida a la misma ruta se rechaza')
  const upsert = await subir(TEMPORAL, rutaT, JPG2, 'image/jpeg', { token: A.token, upsert: true })
  afirmar(upsert.estado >= 400, 'sin upsert: x-upsert=true tampoco reemplaza el objeto')
  afirmar((await bajarComoServidor(TEMPORAL, rutaT)).buffer.equals(JPG),
    'tras los intentos de reemplazo, el contenido sigue siendo el original')

  const ajena = await subir(TEMPORAL, rutaT.replace(/\/.*/u, `/${ID(7777)}`), JPG, 'image/jpeg', { token: A.token })
  afirmar(ajena.estado >= 400, 'una ruta que no corresponde a ninguna carga preparada se rechaza')
  const delOtro = await prepararCarga(A, { pago: pagoA1, numero: `OP-OTRO-${Date.now()}`, tamano: 10 })
  const cruzada = await subir(TEMPORAL, delOtro.datos.ruta_temporal, JPG, 'image/jpeg', { token: actores.copadre.token })
  afirmar(cruzada.estado >= 400, 'el copadre no puede subir a la ruta de una carga del otro padre')
  for (const [nombre, token] of [['estudiante', actores.estudianteA.token], ['director', actores.director.token],
    ['personal', actores.personal.token], ['docente', actores.docente.token], ['anónimo', null]]) {
    const r = await subir(TEMPORAL, delOtro.datos.ruta_temporal, JPG, 'image/jpeg', { token })
    afirmar(r.estado >= 400, `${nombre} no puede subir a la carga de un padre`)
  }
  const aFinal = await subir(BUCKET, `${pagoA1}/${ID(7001)}.jpg`, JPG, 'image/jpeg', { token: A.token })
  afirmar(aFinal.estado >= 400, 'ningún cliente sube al bucket FINAL: las rutas confirmadas solo las publica el servidor')
  const trav = await subir(TEMPORAL, `${pagoA1}/../${delOtro.datos.carga_id}`, JPG, 'image/jpeg', { token: A.token })
  afirmar(trav.estado >= 400, 'una ruta con traversal se rechaza')

  for (const [nombre, token] of [['el cargador', A.token], ['el copadre', actores.copadre.token],
    ['Dirección', actores.director.token], ['anónimo', null]]) {
    const r = await bajar(TEMPORAL, rutaT, token)
    afirmar(r.estado !== 200, `${nombre} no lee el objeto temporal`)
  }
  const lista = await http('POST', `${STORAGE}/object/list/${TEMPORAL}`, {
    token: actores.director.token, json: { prefix: pagoA1, limit: 100, offset: 0 },
  })
  afirmar(Array.isArray(lista.datos) && lista.datos.length === 0, 'Dirección no lista el bucket temporal')
  const firma = await http('POST', `${STORAGE}/object/sign/${TEMPORAL}/${rutaT}`, {
    token: A.token, json: { expiresIn: 60 },
  })
  afirmar(firma.estado >= 400 || !firma.datos?.signedURL, 'nadie firma una URL de un objeto temporal con credenciales de usuario')
  const borrado = await http('DELETE', `${STORAGE}/object/${TEMPORAL}`, { token: A.token, json: { prefixes: [rutaT] } })
  afirmar(await existeComoServidor(TEMPORAL, rutaT), `el cargador no borra su objeto temporal (${borrado.estado})`)
  const mover = await http('POST', `${STORAGE}/object/move`, {
    token: A.token, json: { bucketId: TEMPORAL, sourceKey: rutaT, destinationKey: `${pagoA1}/movido` },
  })
  afirmar(mover.estado >= 400 && await existeComoServidor(TEMPORAL, rutaT), 'no se mueve un objeto temporal')
  const copiar = await http('POST', `${STORAGE}/object/copy`, {
    token: A.token, json: { bucketId: TEMPORAL, sourceKey: rutaT, destinationBucket: BUCKET, destinationKey: `${pagoA1}/${p1.datos.carga_id}.jpg` },
  })
  afirmar(copiar.estado >= 400 && !(await existeComoServidor(BUCKET, `${pagoA1}/${p1.datos.carga_id}.jpg`)),
    'no se copia un temporal al bucket final con credenciales de cliente')

  const grande = await subir(TEMPORAL, delOtro.datos.ruta_temporal, Buffer.alloc(MAXIMO + 1, 1), 'image/jpeg', { token: A.token })
  afirmar(grande.estado >= 400, 'el servicio rechaza un objeto de 5 MiB + 1 byte')
  const mime = await subir(TEMPORAL, delOtro.datos.ruta_temporal, Buffer.from('<html></html>'), 'text/html', { token: A.token })
  afirmar(mime.estado >= 400, 'el servicio rechaza un Content-Type no permitido (text/html)')

  // ==============================================================
  // 3. Finalización por HTTP
  // ==============================================================
  console.log('\n— 3. Finalización (Bearer real) —')
  const sinBearer = await finalizar(A, p1.datos.carga_id, { token: null })
  afirmar(sinBearer.estado === 401 && sinBearer.cacheControl === 'no-store', 'sin Authorization: 401 y sin caché')
  const basura = await finalizar(A, p1.datos.carga_id, { token: 'no.es.untoken' })
  afirmar(basura.estado === 401, 'un Bearer con forma de JWT pero inválido: 401')
  const firmaFalsa = await finalizar(A, p1.datos.carga_id, {
    token: `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: A.userId, role: 'authenticated', exp: 9999999999 })).toString('base64url')}.firma`,
  })
  afirmar(firmaFalsa.estado === 401, 'un JWT con el sub correcto pero firma falsa: 401 (decodificar no es autenticar)')
  afirmar(estadoCarga(p1.datos.carga_id).startsWith('PREPARADA'), 'las llamadas no autenticadas no cambiaron la carga')
  const ajeno = await finalizar(actores.copadre, p1.datos.carga_id)
  afirmar(ajeno.estado === 404, 'el copadre no puede finalizar la carga de otro padre (404, sin revelar)')
  const estud = await finalizar(actores.estudianteA, p1.datos.carga_id)
  afirmar(estud.estado === 403, 'el estudiante no puede finalizar una carga (403)')
  afirmar(estadoCarga(p1.datos.carga_id).startsWith('PREPARADA'), 'y su intento no cerró la carga ajena')
  const malId = await finalizar(A, 'no-es-un-uuid')
  afirmar(malId.estado === 400, 'un id de carga mal formado: 400')

  const ok1 = await finalizar(A, p1.datos.carga_id)
  afirmar(ok1.estado === 200 && ok1.cuerpo?.carga?.estado === 'CONFIRMADA' && ok1.cuerpo.carga.cantidad_archivos === 1,
    'primer archivo válido: 200 y CONFIRMADA')
  afirmar(filaPago(pagoA1) === `PENDIENTE_VERIFICACION|${numeroA}|50000.00|${FECHA}|${antes.total}`,
    'los datos de la transferencia se registraron en el pago, que sigue PENDIENTE_VERIFICACION')
  const fila = sql(`SELECT c.tipo_mime || '|' || c.tamano_bytes || '|' || c.ruta_archivo || '|' || k.sha256_contenido
                    FROM public.comprobantes_pago c
                    JOIN public.cargas_comprobante k ON k.id = c.id
                    WHERE c.id = '${p1.datos.carga_id}';`)
  afirmar(fila === `image/jpeg|${JPG.length}|${rutaFinal(p1.datos, 'jpg')}|${sha(JPG)}`,
    'el comprobante registra tipo, tamaño y ruta canónica; la carga, el SHA-256 de los bytes validados')
  const pub = await bajarComoServidor(BUCKET, rutaFinal(p1.datos, 'jpg'))
  afirmar(pub.estado === 200 && pub.buffer.equals(JPG), 'el objeto publicado tiene exactamente los bytes subidos')
  afirmar(!(await existeComoServidor(TEMPORAL, rutaT)), 'el objeto temporal se retiró tras confirmar')
  afirmar(sql(`SELECT temporal_eliminado_en IS NOT NULL FROM public.cargas_comprobante WHERE id = '${p1.datos.carga_id}';`) === 't',
    'la carga registra que su temporal ya se eliminó')

  const otra = await finalizar(A, p1.datos.carga_id)
  afirmar(otra.estado === 200 && cantidadComprobantes(pagoA1) === 1, 'repetir la finalización: mismo resultado, sin duplicar')

  // Segundo y tercer archivo del MISMO pago, sin reenviar los datos.
  const c2 = await cargarArchivo(A, pagoA1, PDF, 'application/pdf', HEREDA)
  afirmar(c2.prep.estado === 200 && c2.prep.datos.numero_operacion === numeroA && c2.prep.datos.importe_centavos === 5_000_000,
    'una carga adicional hereda los datos ya informados del pago')
  afirmar((await finalizar(A, c2.carga.carga_id)).estado === 200, 'segundo archivo (PDF) del mismo pago: 200')
  const c3 = await cargarArchivo(A, pagoA1, PNG, 'image/png', { fecha: FECHA, importe: '50000', numero: ` ${numeroA} ` })
  afirmar(c3.prep.estado === 200, 'repetir los MISMOS datos en una carga adicional no es un falso duplicado')
  afirmar((await finalizar(A, c3.carga.carga_id)).estado === 200 && cantidadComprobantes(pagoA1) === 3,
    'tercer archivo (PNG): el pago tiene tres comprobantes')
  afirmar(filaPago(pagoA1) === `PENDIENTE_VERIFICACION|${numeroA}|50000.00|${FECHA}|${antes.total}`,
    'agregar archivos no modificó fecha, importe ni número')
  const difiere = await prepararCarga(A, { pago: pagoA1, importe: '49999.99', numero: numeroA })
  afirmar(difiere.datos?.code === 'P6865', 'un importe distinto al ya informado: conflicto explícito, no se sobrescribe')
  const diferenum = await prepararCarga(A, { pago: pagoA1, numero: 'OTRO-NUMERO' })
  afirmar(diferenum.datos?.code === 'P6865', 'otro número de operación sobre un pago que ya tiene uno: conflicto')

  afirmar(contar(`FROM public.pagos WHERE id IN ('${pagoA1}','${pagoA2}')`) === antes.pagos &&
    contar(`FROM public.imputaciones_pago WHERE pago_id = '${pagoA1}'`) === antes.imputaciones &&
    sql(`SELECT string_agg(estado_pago::TEXT, ',' ORDER BY id) FROM public.items_factura WHERE id IN ('${itemsA1[0]}','${itemsA1[1]}');`) === antes.estadoItems &&
    sql(`SELECT total_calculado::TEXT FROM public.pagos WHERE id = '${pagoA1}';`) === antes.total,
  'saldo, reservas, imputaciones y total histórico intactos: el pago sigue con sus dos facturas')
  afirmar(fotoSaldo() === antes.saldo,
    'el saldo y el estado de las cuotas no cambiaron: un comprobante no baja el saldo ni paga la factura')

  // Duplicado de número entre pagos.
  const dup = await prepararCarga(A, { pago: pagoA2, numero: numeroA })
  afirmar(dup.datos?.code === 'P6863', 'un número ya registrado en otro pago no rechazado: P6863')
  const dupEspacios = await prepararCarga(A, { pago: pagoA2, numero: `\t${numeroA}\n` })
  afirmar(dupEspacios.datos?.code === 'P6863', 'la comparación recorta espacios, tabulaciones y saltos de línea')
  const dupMay = await prepararCarga(A, { pago: pagoA2, numero: numeroA.toLowerCase() })
  afirmar(dupMay.estado === 200, 'las mayúsculas no se normalizan: otro texto no es duplicado')

  // Contenido inválido y contradictorio.
  const html = await cargarArchivo(A, pagoA2, Buffer.from('<html><script>alert(1)</script></html>'), 'image/jpeg')
  const rHtml = await finalizar(A, html.carga.carga_id)
  afirmar(rHtml.estado === 422 && estadoCarga(html.carga.carga_id).startsWith('DESCARTADA:') &&
    !(await existeComoServidor(TEMPORAL, html.carga.ruta_temporal)) &&
    !(await existeComoServidor(BUCKET, rutaFinal(html.carga, 'jpg'))),
  'HTML declarado como JPEG: 422, carga descartada, sin publicar y temporal retirado')
  afirmar(cantidadComprobantes(pagoA2) === 0 && filaPago(pagoA2).includes('||||'),
    'el archivo inválido no dejó comprobante ni datos en el pago')
  const svg = await cargarArchivo(A, pagoA2, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'), 'image/png')
  afirmar((await finalizar(A, svg.carga.carga_id)).estado === 422, 'SVG declarado como PNG: 422')
  const contra = await cargarArchivo(A, pagoA2, PNG, 'image/jpeg')
  const rContra = await finalizar(A, contra.carga.carga_id)
  afirmar(rContra.estado === 422 && rContra.cuerpo?.codigo === 'CONTENIDO_NO_COINCIDE',
    'PNG real declarado como JPEG: contenido que no coincide')
  const roto = await cargarArchivo(A, pagoA2, JPG.subarray(0, Math.floor(JPG.length / 2)), 'image/jpeg')
  afirmar((await finalizar(A, roto.carga.carga_id)).estado === 422, 'JPEG truncado: 422')
  const cero = await prepararCarga(A, { pago: pagoA2, tamano: 0 })
  afirmar(cero.estado >= 400, 'cero bytes: rechazado antes de subir')
  const falsoTam = await cargarArchivo(A, pagoA2, JPG, 'image/jpeg', { tamano: JPG.length + 7 })
  afirmar((await finalizar(A, falsoTam.carga.carga_id)).estado === 422,
    'un tamaño declarado que no coincide con los bytes reales: 422')
  const limite = Buffer.concat([JPG, Buffer.alloc(MAXIMO - JPG.length)])
  const justo = await cargarArchivo(A, pagoA2, limite, 'image/jpeg')
  afirmar(justo.subida?.estado === 200 && (await finalizar(A, justo.carga.carga_id)).estado === 200,
    'un archivo de exactamente 5 MiB válido: aceptado de punta a punta')
  afirmar(sql(`SELECT tamano_bytes FROM public.comprobantes_pago WHERE id = '${justo.carga.carga_id}';`) === String(MAXIMO),
    'el comprobante de 5 MiB registra 5242880 bytes')
  const pdfConJs = pdfMinimo('x', ' /OpenAction << /S /JavaScript /JS (app.alert(1)) >>')
  const pdfActivo = await cargarArchivo(A, pagoA2, pdfConJs, 'application/pdf', HEREDA)
  const rPdfActivo = await finalizar(A, pdfActivo.carga.carga_id)
  afirmar(rPdfActivo.estado === 422 && rPdfActivo.cuerpo?.codigo === 'CONTENIDO_ACTIVO',
    'un PDF con JavaScript: rechazado')

  // Objeto ausente: no se descarta, se puede reintentar.
  const sinObjeto = await prepararCarga(A, { pago: pagoA2, tipo: 'application/pdf', tamano: PDF.length, ...HEREDA })
  const rSin = await finalizar(A, sinObjeto.datos.carga_id)
  afirmar(rSin.estado === 409 && rSin.cuerpo?.codigo === 'ARCHIVO_NO_SUBIDO' &&
    estadoCarga(sinObjeto.datos.carga_id).startsWith('PREPARADA'),
  'sin objeto temporal: 409 y la carga sigue PREPARADA')
  // El archivo llega después del 409: el mismo intento se puede completar.
  await subir(TEMPORAL, sinObjeto.datos.ruta_temporal, PDF2, 'application/pdf', { token: A.token })
  const rTarde = await finalizar(A, sinObjeto.datos.carga_id)
  afirmar(PDF2.length === PDF.length && rTarde.estado === 200 &&
    estadoCarga(sinObjeto.datos.carga_id) === 'CONFIRMADA:',
  'tras el 409, al llegar el archivo el mismo intento se confirma')

  // Concurrencia: la MISMA carga finalizada dos veces a la vez.
  const conc = await cargarArchivo(A, pagoA1, JPG2, 'image/jpeg', HEREDA)
  const [r1, r2] = await Promise.all([finalizar(A, conc.carga.carga_id), finalizar(A, conc.carga.carga_id)])
  afirmar([r1.estado, r2.estado].every((e) => e === 200 || e === 503) && [r1.estado, r2.estado].includes(200) &&
    contar(`FROM public.comprobantes_pago WHERE id = '${conc.carga.carga_id}'`) === 1 &&
    (await existeComoServidor(BUCKET, rutaFinal(conc.carga, 'jpg'))),
  'la misma carga finalizada en paralelo: un solo comprobante y un solo objeto')
  const rec = await finalizar(A, conc.carga.carga_id)
  afirmar(rec.estado === 200 && cantidadComprobantes(pagoA1) === 4, 'y la repetición posterior devuelve el mismo resultado')

  // ==============================================================
  // 4. Fallas intermedias
  // ==============================================================
  console.log('\n— 4. Fallas intermedias —')
  // Vínculo revocado entre la carga y la finalización.
  const pagoE = await registrarPago(actores.padreE, [crearItem('estudianteA')])
  const ce = await cargarArchivo(actores.padreE, pagoE, JPG, 'image/jpeg')
  sql(`DELETE FROM public.padres_hijos WHERE padre_id = '${actores.padreE.perfil}' AND hijo_id = '${actores.estudianteA.perfil}';`)
  const rE = await finalizar(actores.padreE, ce.carga.carga_id)
  afirmar(rE.estado === 409 && estadoCarga(ce.carga.carga_id) === 'DESCARTADA:VINCULO_REVOCADO' &&
    cantidadComprobantes(pagoE) === 0 && !(await existeComoServidor(BUCKET, rutaFinal(ce.carga, 'jpg'))),
  'vínculo revocado durante la carga: se descarta, sin comprobante ni objeto publicado')
  afirmar(filaPago(pagoE).includes('||||'), 'y el pago no recibió datos de transferencia')

  // Cuenta bloqueada después de subir (con su JWT todavía vigente).
  const pagoD = await registrarPago(actores.padreD, [crearItem('estudianteA')])
  const cd = await cargarArchivo(actores.padreD, pagoD, JPG, 'image/jpeg')
  sql(`UPDATE public.perfiles SET estado_acceso = 'BLOQUEADO' WHERE id = '${actores.padreD.perfil}';`)
  const rD = await finalizar(actores.padreD, cd.carga.carga_id)
  afirmar(rD.estado === 403 && cantidadComprobantes(pagoD) === 0 &&
    !(await existeComoServidor(BUCKET, rutaFinal(cd.carga, 'jpg'))),
  'cuenta bloqueada durante la carga: 403, no se registra ni se publica nada')
  afirmar(estadoCarga(cd.carga.carga_id) === 'DESCARTADA:CUENTA_NO_HABILITADA',
    'y la carga queda cerrada por cuenta no habilitada, nunca confirmada')
  const bloqPrep = await prepararCarga(actores.padreD, { pago: pagoD })
  afirmar(bloqPrep.estado >= 400, 'una cuenta bloqueada no prepara cargas nuevas')
  const bloqSube = await subir(TEMPORAL, `${pagoD}/${ID(7002)}`, JPG, 'image/jpeg', { token: actores.padreD.token })
  afirmar(bloqSube.estado >= 400, 'ni sube objetos temporales')

  // Pago rechazado (Dirección) entre la carga y la finalización.
  const pagoF = await registrarPago(actores.padreF, [crearItem('estudianteA')])
  const cf = await cargarArchivo(actores.padreF, pagoF, JPG, 'image/jpeg')
  sql(`UPDATE public.pagos SET estado = 'RECHAZADO', verificado_por = '${actores.director.perfil}',
       verificado_en = NOW(), motivo_rechazo = 'prueba' WHERE id = '${pagoF}';`)
  const rF = await finalizar(actores.padreF, cf.carga.carga_id)
  afirmar(rF.estado === 409 && estadoCarga(cf.carga.carga_id) === 'DESCARTADA:PAGO_NO_PENDIENTE' &&
    cantidadComprobantes(pagoF) === 0 && !(await existeComoServidor(BUCKET, rutaFinal(cf.carga, 'jpg'))),
  'pago rechazado durante la carga: se descarta y no se publica nada')
  const prepRech = await prepararCarga(actores.padreF, { pago: pagoF })
  afirmar(prepRech.datos?.code === 'P6862', 'un pago ya no pendiente no admite cargas nuevas')

  // El mismo número de operación en DOS pagos distintos, en paralelo.
  const numeroCarrera = `OP-CARRERA-${Date.now()}`
  const pagoB1 = await registrarPago(actores.copadre, [crearItem('estudianteA')])
  const cB1 = await cargarArchivo(actores.copadre, pagoB1, JPG, 'image/jpeg', { numero: numeroCarrera })
  const cB2 = await cargarArchivo(actores.padreC, pagoC, JPG2, 'image/jpeg', { numero: numeroCarrera })
  afirmar(cB1.prep.estado === 200 && cB2.prep.estado === 200,
    'preparar no reserva el número: dos pagos pueden prepararlo a la vez (la autoridad es la confirmación)')
  const [rB1, rB2] = await Promise.all([
    finalizar(actores.copadre, cB1.carga.carga_id), finalizar(actores.padreC, cB2.carga.carga_id),
  ])
  afirmar([rB1.estado, rB2.estado].sort().join() === '200,409' &&
    contar(`FROM public.pagos WHERE numero_operacion = '${numeroCarrera}'`) === 1,
  'dos finalizaciones concurrentes con el mismo número: exactamente una gana')
  const perdedora = rB1.estado === 409 ? cB1 : cB2
  afirmar(estadoCarga(perdedora.carga.carga_id) === 'DESCARTADA:OPERACION_DUPLICADA' &&
    !(await existeComoServidor(BUCKET, rutaFinal(perdedora.carga, 'jpg'))) &&
    cantidadComprobantes(perdedora.carga.pago_id) === 0,
  'la perdedora queda descartada, sin comprobante ni objeto huérfano')

  // Tope técnico de cargas sin completar.
  const pagoTope = await registrarPago(actores.copadre, [crearItem('estudianteA')])
  let creadas = 0
  let codigoTope = null
  for (let i = 0; i < 12; i += 1) {
    const r = await prepararCarga(actores.copadre, { pago: pagoTope, numero: `OP-TOPE-${i}-${Date.now()}`, tamano: 10 })
    if (r.estado === 200) creadas += 1
    else { codigoTope = r.datos?.code; break }
  }
  afirmar(codigoTope === 'P6868' && creadas >= 1 && creadas <= 10,
    `el tope técnico de cargas sin completar se aplica (${creadas} creadas, luego ${codigoTope})`)

  // ==============================================================
  // 5. Lectura
  // ==============================================================
  console.log('\n— 5. Lectura del original y registro saneado —')
  const idC = p1.datos.carga_id
  const jar = await exigirSesion(local, correo('director'), CONTRASENA)
  const cookieDirector = cookieDe(jar)
  const dir = await fetch(`${servidor.url}/api/comprobantes/${idC}/archivo`, {
    headers: { cookie: cookieDirector }, redirect: 'manual', signal: AbortSignal.timeout(30_000),
  })
  const ubic = dir.headers.get('location')
  afirmar(dir.status === 302 && ubic?.includes('/object/sign/') && dir.headers.get('cache-control') === 'no-store',
    'Dirección recibe una redirección a una URL firmada, sin caché')
  const bytesDir = ubic ? Buffer.from(await (await fetch(ubic)).arrayBuffer()) : Buffer.alloc(0)
  afirmar(bytesDir.equals(JPG), 'la URL firmada entrega los bytes originales')
  const cookieA = cookieDe(await exigirSesion(local, correo('padreA'), CONTRASENA))
  const own = await fetch(`${servidor.url}/api/comprobantes/${idC}/archivo`, {
    headers: { cookie: cookieA }, redirect: 'manual', signal: AbortSignal.timeout(30_000),
  })
  afirmar(own.status === 302, 'el padre que lo cargó accede a su original')
  for (const clave2 of ['copadre', 'estudianteA', 'personal', 'docente', 'padreC']) {
    const c = cookieDe(await exigirSesion(local, correo(clave2), CONTRASENA))
    const r = await fetch(`${servidor.url}/api/comprobantes/${idC}/archivo`, {
      headers: { cookie: c }, redirect: 'manual', signal: AbortSignal.timeout(30_000),
    })
    afirmar(r.status === 404 && !r.headers.get('location'), `${clave2}: no accede al original (404, sin ruta ni URL)`)
  }
  const anon = await fetch(`${servidor.url}/api/comprobantes/${idC}/archivo`, { redirect: 'manual' })
  afirmar(anon.status === 401, 'anónimo: 401')
  const inexistente = await fetch(`${servidor.url}/api/comprobantes/${ID(8888)}/archivo`, {
    headers: { cookie: cookieDirector }, redirect: 'manual',
  })
  afirmar(inexistente.status === 404, 'un comprobante inexistente: 404')

  for (const [nombre, actor, esperado] of [
    ['padreA (cargador)', actores.padreA, 4], ['copadre', actores.copadre, 0], ['estudiante', actores.estudianteA, 0],
    ['director', actores.director, null],
  ]) {
    const filas = await rest(actor.token, `comprobantes_pago?select=id,ruta_archivo&pago_id=eq.${pagoA1}`)
    const n = Array.isArray(filas.datos) ? filas.datos.length : -1
    afirmar(esperado === null ? n >= 4 : n === esperado, `${nombre}: ve ${n} filas de comprobantes_pago del pago`)
  }
  for (const actor of [actores.copadre, actores.estudianteA, actores.padreA, actores.director]) {
    const r = await rpc(actor.token, 'resumen_comprobantes_pago', { p_pago_id: pagoA1 })
    afirmar(r.estado === 200 && r.datos?.[0]?.cantidad_archivos === 4 &&
      !('ruta_archivo' in (r.datos?.[0] ?? {})), 'el registro saneado informa cantidad sin ruta')
  }
  const copPago = await rest(actores.copadre.token, `pagos?select=id,numero_operacion,importe_informado&id=eq.${pagoA1}`)
  afirmar(copPago.datos?.[0]?.numero_operacion === numeroA, 'el copadre ve los datos del pago (historial del hijo), no el archivo')

  // ==============================================================
  // 6. Conciliación
  // ==============================================================
  console.log('\n— 6. Conciliación —')
  const sinSecreto = await api(servidor, '/api/comprobantes/conciliacion', { method: 'POST' })
  afirmar(sinSecreto.estado === 401, 'la conciliación sin secreto: 401')
  const pagoV = await registrarPago(actores.padreC, [crearItem('estudianteC')])
  const abandonada = await prepararCarga(actores.padreC, { pago: pagoV, numero: `OP-VIEJA-${Date.now()}`, tamano: PDF.length, tipo: 'application/pdf' })
  await subir(TEMPORAL, abandonada.datos.ruta_temporal, PDF, 'application/pdf', { token: actores.padreC.token })
  // Un objeto final huérfano de una carga descartada (finalización interrumpida).
  const huerfanoRuta = `${abandonada.datos.pago_id}/${abandonada.datos.carga_id}.pdf`
  await subir(BUCKET, huerfanoRuta, PDF, 'application/pdf', { servidor: true })
  sql(`UPDATE public.cargas_comprobante SET creado_en = NOW() - INTERVAL '3 days' WHERE id = '${abandonada.datos.carga_id}';`)
  const estadoPagoAntes = filaPago(pagoV)
  const finalesAntes = (await bajarComoServidor(BUCKET, rutaFinal(p1.datos, 'jpg'))).buffer
  const conc1 = await fetch(`${servidor.url}/api/comprobantes/conciliacion`, {
    method: 'POST', headers: { authorization: `Bearer ${SECRETO_CRON}` }, signal: AbortSignal.timeout(60_000),
  })
  const cuerpo1 = await conc1.json()
  afirmar(conc1.status === 200 && cuerpo1.examinadas >= 1 && cuerpo1.pendientes === 0,
    'la conciliación procesa las cargas vencidas sin pendientes')
  afirmar(estadoCarga(abandonada.datos.carga_id) === 'EXPIRADA:EXPIRADA' &&
    !(await existeComoServidor(TEMPORAL, abandonada.datos.ruta_temporal)) &&
    !(await existeComoServidor(BUCKET, huerfanoRuta)),
  'una carga vencida: EXPIRADA, temporal retirado y el final huérfano sin fila, también')
  afirmar(filaPago(pagoV) === estadoPagoAntes, 'la limpieza no cancela ni cambia el pago pendiente')
  afirmar((await bajarComoServidor(BUCKET, rutaFinal(p1.datos, 'jpg'))).buffer.equals(finalesAntes) &&
    cantidadComprobantes(pagoA1) === 4,
  'y no toca ningún comprobante confirmado')
  const tardia = await finalizar(actores.padreC, abandonada.datos.carga_id)
  afirmar(tardia.estado === 410 && cantidadComprobantes(pagoV) === 0,
    'finalizar una carga vencida: 410, sin registrar nada')
  const conc2 = await fetch(`${servidor.url}/api/comprobantes/conciliacion`, {
    method: 'POST', headers: { authorization: `Bearer ${SECRETO_CRON}` }, signal: AbortSignal.timeout(60_000),
  })
  const cuerpo2 = await conc2.json()
  afirmar(conc2.status === 200 && cuerpo2.temporalesRetirados === 0 && cantidadComprobantes(pagoA1) === 4,
    'repetir la conciliación es idempotente y no duplica ni borra comprobantes')

  // Sin filtraciones técnicas en las respuestas de la API.
  for (const [nombre, r] of [['sin Authorization', sinBearer], ['token inválido', basura], ['carga ajena', ajeno],
    ['archivo inválido', rHtml], ['objeto ausente', rSin], ['pago rechazado', rF]]) {
    afirmar(detalleTecnicoEn(r.texto) === null, `la respuesta «${nombre}» no filtra detalles técnicos`)
  }
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
console.log(`\n${conteo.afirmaciones} afirmaciones, ${conteo.fallos} fallo(s).`)
if (conteo.fallos > 0) codigoSalida = 1
process.exit(codigoSalida)
