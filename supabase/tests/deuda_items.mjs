// EPT-114: historial de deuda por ítem con Auth, PostgREST y SQL reales. Sin producción.
//
// EPT-157: reconciliación con los reportes web. El fixture de EPT-112 (importes y estados escritos a mano) se
// reutiliza para contrastar tres lecturas independientes entre sí: la RPC móvil, `estado_cuotas_alumno` (EPT-107)
// y RF19 (`reporte_economico('incompletos')`). Los resultados esperados son constantes calculadas a mano; ninguna
// comprobación depende de que dos pantallas llamen al mismo ayudante.
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import {
  sql,
  rpc,
  rest,
  crearCuentaConPerfil,
  exigirSesion,
  limpiarFixture,
} from './_arnes-ept59.mjs'
import { SesionPsql } from './_sesion-psql.mjs'
import { ID, fixture, limpiarEconomia, roles } from './_reportes-economicos-fixture.mjs'

const dir = process.env.EPT_SUPABASE_WORKDIR
const salida = execSync(
  `npx --yes supabase@${process.env.EPT_SUPABASE_CLI ?? '2.117.0'} status -o env${dir ? ` --workdir "${dir}"` : ''}`,
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }
)
const local = Object.fromEntries(
  salida
    .split(/\r?\n/)
    .map((l) => /^([A-Z0-9_]+)="?(.*?)"?$/.exec(l.trim()))
    .filter(Boolean)
    .map((m) => [m[1], m[2]])
)
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(local.API_URL).hostname), 'Solo API local')
if (process.env.DOCKER_HOST && !/^(npipe|unix):/i.test(process.env.DOCKER_HOST)) throw new Error('Solo Docker local')

const actores = {}
const sesiones = {}
const password = 'prueba-ept114-sintetica'
let afirmaciones = 0
const comprobar = (condicion, mensaje) => {
  assert.ok(condicion, mensaje)
  console.log(`OK ${++afirmaciones}: ${mensaje}`)
}

// ---- Lecturas -------------------------------------------------------------------------------------------
const deuda = async (actor, alumno, extra = {}) => {
  const r = await rpc(local, actor ? sesiones[actor].access_token : null, 'historial_deuda_items', {
    p_alumno_id: alumno,
    ...extra,
  })
  return r
}
const documento = async (actor, alumno, extra = {}) => {
  const r = await deuda(actor, alumno, extra)
  assert.equal(r.estado, 200, JSON.stringify(r.cuerpo))
  return r.cuerpo
}
/** Todas las páginas de un filtro; verifica que ninguna fila falte ni se repita. */
async function recorrer(actor, alumno, extra = {}, tamano = 25) {
  const filas = []
  let huella = null
  let primera = null
  for (let pagina = 1; ; pagina++) {
    const d = await documento(actor, alumno, { ...extra, p_pagina: pagina, p_tamano: tamano, ...(huella ? { p_huella: huella } : {}) })
    assert.ok(!d.actualizado, 'el contenido no debía cambiar durante el recorrido')
    primera ??= d
    huella ??= d.huella
    filas.push(...d.filas)
    if (filas.length >= d.total || d.filas.length === 0) return { filas, primera }
  }
}
const idsDe = (filas) => new Set(filas.map((f) => f.item_id))
const facturasConSaldo = (filas) => {
  const porFactura = new Map()
  for (const f of filas) porFactura.set(f.factura_id, (porFactura.get(f.factura_id) ?? 0n) + BigInt(f.saldo_centavos))
  return new Map([...porFactura].filter(([, saldo]) => saldo > 0n))
}
const igualesConjuntos = (a, b) => a.size === b.size && [...a].every((x) => b.has(x))
const suma = (mapa) => [...mapa.values()].reduce((n, v) => n + v, 0n)
const reporte = async (id, extra = {}) => {
  const r = await rpc(local, sesiones.director.access_token, 'reporte_economico', {
    p_reporte: id,
    p_desde: '2030-01-01',
    p_hasta: '2030-12-31',
    ...extra,
  })
  assert.equal(r.estado, 200, JSON.stringify(r.cuerpo))
  return r.cuerpo
}
/** RF19 completo: todas las páginas, para comparar el conjunto entero de facturas antes de sumar. */
async function rf19(desde, hasta) {
  const filas = []
  let ultimo = null
  for (let pagina = 1; ; pagina++) {
    const r = await reporte('incompletos', { p_desde: desde, p_hasta: hasta, p_pagina: pagina, p_tamano: 25 })
    ultimo ??= r
    filas.push(...r.filas)
    if (filas.length >= r.total || r.filas.length === 0) return { filas, totales: ultimo.totales, total: ultimo.total }
  }
}
const estado107 = async (alumno) => {
  const r = await rest(local, sesiones.padre.access_token, `estado_cuotas_alumno?alumno_id=eq.${alumno}&select=factura_id,saldo_centavos,inconsistente,total_centavos`)
  assert.equal(r.estado, 200, r.texto)
  return r.cuerpo
}
const huellaEconomia = () =>
  sql(`SELECT md5(concat(
  (SELECT string_agg(row_to_json(p)::TEXT,'' ORDER BY id) FROM public.pagos p),
  (SELECT string_agg(row_to_json(i)::TEXT,'' ORDER BY id) FROM public.items_factura i),
  (SELECT string_agg(row_to_json(ip)::TEXT,'' ORDER BY pago_id,item_factura_id) FROM public.imputaciones_pago ip)));`)

function limpiar() {
  sql(`BEGIN; ${limpiarEconomia()}
    DELETE FROM public.comprobantes_pago WHERE pago_id::TEXT LIKE 'b1120000-%';
    COMMIT;`)
  limpiarFixture({ prefijoDni: '97114', prefijoCorreo: 'ept114.', dominio: 'ept.local' })
  sql(`DELETE FROM public.cursos WHERE id::TEXT LIKE 'b1120000-%';`)
}

/** Factura 611 (noviembre de 2030): tres ítems, DOS pagos aprobados distintos y un ítem sin pagar. */
function facturaConVariasRelaciones(a) {
  return `
    INSERT INTO public.facturas(id,alumno_id,periodo,vencimiento,total)
      VALUES('${ID(611)}','${a.estudiante}','2030-11-01','2030-11-10',100);
    INSERT INTO public.items_factura(id,factura_id,alumno_id,tipo,tarifa_id,matricula_id,inscripcion_deportiva_id,inscripcion_servicio_id,importe) VALUES
      ('${ID(714)}','${ID(611)}','${a.estudiante}','CUOTA','${ID(501)}','${ID(201)}',NULL,NULL,30),
      ('${ID(715)}','${ID(611)}','${a.estudiante}','DEPORTE','${ID(502)}',NULL,'${ID(401)}',NULL,30),
      ('${ID(716)}','${ID(611)}','${a.estudiante}','COMEDOR','${ID(504)}',NULL,NULL,'${ID(403)}',40);
    INSERT INTO public.pagos(id,padre_id,alumno_id,total_calculado,importe_informado,fecha_transferencia,numero_operacion,estado,verificado_por,verificado_en) VALUES
      ('${ID(810)}','${a.padre}','${a.estudiante}',30,30,'2030-11-02','EPT114-810','APROBADO','${a.director}',now()),
      ('${ID(811)}','${a.padre}','${a.estudiante}',30,30,'2030-11-05','EPT114-811','APROBADO','${a.director}',now());
    INSERT INTO public.imputaciones_pago(pago_id,item_factura_id,alumno_id,importe,activa) VALUES
      ('${ID(810)}','${ID(714)}','${a.estudiante}',30,TRUE),('${ID(811)}','${ID(715)}','${a.estudiante}',30,TRUE);
    UPDATE public.items_factura SET estado_pago='PAGADO' WHERE id IN ('${ID(714)}','${ID(715)}');`
}

/** Historial de 120 ítems para otro alumno de otra familia: pagina más de una vez con tamaño 25. */
function historialExtenso(a) {
  return `
    INSERT INTO public.facturas(id,alumno_id,periodo,vencimiento,total)
      SELECT ('b1120000-0000-4000-8000-' || lpad((3000 + m)::TEXT, 12, '0'))::UUID,'${a.otroAlumno}',
        (DATE '2020-01-01' + make_interval(months => m))::DATE,(DATE '2020-01-01' + make_interval(months => m))::DATE + 9, 100 + m
      FROM generate_series(0, 119) g(m);
    INSERT INTO public.items_factura(id,factura_id,alumno_id,tipo,tarifa_id,matricula_id,importe)
      SELECT ('b1120000-0000-4000-8000-' || lpad((4000 + m)::TEXT, 12, '0'))::UUID,
        ('b1120000-0000-4000-8000-' || lpad((3000 + m)::TEXT, 12, '0'))::UUID,'${a.otroAlumno}','CUOTA','${ID(501)}','${ID(204)}',100 + m
      FROM generate_series(0, 119) g(m);`
}

try {
  limpiar()
  for (const [i, [key, rol]] of Object.entries(roles).entries()) {
    const email = `ept114.${key}@ept.local`
    const usuario = await crearCuentaConPerfil(local, {
      email,
      password,
      perfil: {
        nombre: 'Prueba',
        apellido: `EPT114 ${key}`,
        dni: `97114${String(i + 1).padStart(3, '0')}`,
        rol_id: Number(sql(`SELECT id FROM public.roles WHERE nombre='${rol}';`)),
        legajo_nro: ['ESTUDIANTE', 'DOCENTE'].includes(rol) ? `EPT114-${key}` : null,
      },
    })
    actores[key] = sql(`SELECT id FROM public.perfiles WHERE user_id='${usuario}';`)
    sesiones[key] = await exigirSesion(local, email, password)
  }
  sql(`BEGIN; ${fixture(actores)} ${facturaConVariasRelaciones(actores)} ${historialExtenso(actores)}
    UPDATE public.perfiles SET estado_acceso='BLOQUEADO' WHERE id='${actores.bloqueado}'; COMMIT;`)
  const economiaInicial = huellaEconomia()
  const A = actores.estudiante

  // ================================================================
  // 1. Autorización con JWT reales y PostgREST
  // ================================================================
  const completo = await documento('padre', A)
  comprobar(
    completo.total === 16 && completo.totales.adeudado_centavos === '38000' && completo.totales.facturas === 11,
    'El padre ve 16 ítems en 11 facturas y un total adeudado de ARS 380,00 (cálculo a mano)'
  )
  comprobar(
    typeof completo.totales.adeudado_centavos === 'string' && completo.filas.every((f) => typeof f.saldo_centavos === 'string'),
    'Los importes viajan como texto entero, no como número de coma flotante'
  )
  for (const actor of ['estudiante', 'director']) {
    const d = await documento(actor, A)
    comprobar(d.totales.adeudado_centavos === '38000' && d.huella === completo.huella, `${actor}: misma deuda y misma huella que el padre`)
  }
  for (const [actor, alumno] of [
    ['otraFamilia', A],
    ['otroAlumno', A],
    ['padre', actores.otroAlumno],
    ['estudiante', actores.otroAlumno],
    ['docente', A],
    ['personal', A],
    ['bloqueado', A],
  ]) {
    const d = await documento(actor, alumno)
    comprobar(
      d.total === 0 && d.filas.length === 0 && d.grupos.length === 0 && d.totales.adeudado_centavos === '0',
      `${actor}: sin acceso económico al alumno consultado, documento vacío indistinguible del de un alumno sin ítems`
    )
  }
  const anonimo = await deuda(null, A)
  comprobar([401, 403].includes(anonimo.estado) && !JSON.stringify(anonimo.cuerpo).includes(A), 'anon: PostgREST niega la lectura')
  const invalidos = await deuda('padre', A, { p_tamano: 10 })
  comprobar(invalidos.estado >= 400 && invalidos.cuerpo?.code === 'P6872', 'Un tamaño de página no admitido se rechaza con su código')
  const invertido = await deuda('padre', A, { p_desde: '2030-02-01', p_hasta: '2030-01-01' })
  comprobar(invertido.estado >= 400 && invertido.cuerpo?.code === 'P6871', 'Un rango invertido se rechaza con su código')

  // Vínculo revocado y cuenta bloqueada: la siguiente lectura ya no entrega nada, aunque el JWT siga vigente.
  sql(`DELETE FROM public.padres_hijos WHERE padre_id='${actores.padre}' AND hijo_id='${A}';`)
  comprobar((await documento('padre', A)).total === 0, 'Vínculo revocado: la siguiente lectura devuelve cero ítems')
  sql(`INSERT INTO public.padres_hijos(padre_id,hijo_id) VALUES('${actores.padre}','${A}');`)
  sql(`UPDATE public.perfiles SET estado_acceso='BLOQUEADO' WHERE id='${actores.padre}';`)
  comprobar((await documento('padre', A)).total === 0, 'Cuenta bloqueada con JWT vigente: la lectura devuelve cero ítems')
  sql(`UPDATE public.perfiles SET estado_acceso='HABILITADO' WHERE id='${actores.padre}';`)
  comprobar((await documento('padre', A)).total === 16, 'Restablecidos el vínculo y la cuenta, la lectura vuelve')

  // ================================================================
  // 2. Cálculo con el fixture de EPT-112, contra constantes a mano
  // ================================================================
  const porItem = new Map(completo.filas.map((f) => [f.item_id, f]))
  const item = (n) => porItem.get(ID(700 + n))
  // Los períodos del fixture caen en 2030: hoy son futuros y, desde marzo de 2030, estarán vencidos. La regla se
  // contrasta con la fecha de corte del propio servidor en lugar de fijar el estado a un reloj.
  const vencido = (f) => completo.fecha_corte > f.vencimiento
  comprobar(
    item(1).saldo_centavos === '0' && item(1).estado === 'PAGADO' && item(6).saldo_centavos === '4000' &&
      item(6).vencido === vencido(item(6)) && item(6).estado === (vencido(item(6)) ? 'VENCIDO' : 'PENDIENTE') &&
      item(10).estado === 'SIN_CARGO' && item(10).importe_centavos === '0',
    'Pagado, parcialmente pendiente (factura 603) y sin cargo se distinguen por ítem'
  )
  comprobar(
    item(7).saldo_centavos === '10000' && item(7).pagado_centavos === '0' && item(8).saldo_centavos === '10000',
    'Un pago en verificación no reduce la deuda; un pago rechazado la mantiene (ítems 7, 8, 9)'
  )
  comprobar(item(9).saldo_centavos === '10000' && item(9).en_verificacion === false, 'El rechazo libera la reserva del ítem')
  comprobar(item(5).pagado_centavos === '6000' && item(5).estado === 'PAGADO', 'El pago multifactura imputa 60,00 a la cuota 5 y 60,00 a la cuota 1')
  const factura603 = completo.filas.filter((f) => f.factura_id === ID(603))
  comprobar(
    factura603.length === 2 && factura603.reduce((n, f) => n + BigInt(f.saldo_centavos), 0n) === 4000n,
    'La factura 603 con un ítem pagado y otro pendiente es «pago parcial» a nivel factura: saldo 40,00'
  )
  const grupos = Object.fromEntries(completo.grupos.map((g) => [g.tipo, g]))
  comprobar(
    completo.grupos.length === 4 && grupos.CUOTA.saldo_centavos === '30000' && grupos.COMEDOR.saldo_centavos === '8000' &&
      grupos.DEPORTE.saldo_centavos === '0' && grupos.TRANSPORTE.saldo_centavos === '0',
    'Subtotales por agrupación a mano: cuota 300,00, comedor 80,00, deporte y transporte 0,00'
  )
  const transporteActual = sql(`SELECT se.nombre FROM public.inscripciones_servicios i JOIN public.servicios_escolares se ON se.id=i.servicio_id WHERE i.id='${ID(404)}';`)
  const transporteFacturado = sql(`SELECT se.nombre FROM public.inscripciones_servicios i JOIN public.servicios_escolares se ON se.id=i.servicio_id WHERE i.id='${ID(402)}';`)
  comprobar(
    item(3).concepto === transporteFacturado && item(3).concepto !== transporteActual && item(3).origen_estado === 'CANCELADA',
    'El recorrido facturado (inscripción cancelada) no se reemplaza por el recorrido actual'
  )
  comprobar(
    completo.filas.reduce((n, f) => n + BigInt(f.saldo_centavos), 0n) === BigInt(completo.totales.adeudado_centavos),
    'El total adeudado es la suma exacta de los saldos del conjunto'
  )

  // ================================================================
  // 3. EPT-157: reconciliación con EPT-107 y con RF19
  // ================================================================
  const a107 = await estado107(A)
  const porFactura107 = new Map(a107.map((f) => [f.factura_id, BigInt(f.saldo_centavos)]))
  const porFacturaMovil = new Map()
  for (const f of completo.filas) porFacturaMovil.set(f.factura_id, (porFacturaMovil.get(f.factura_id) ?? 0n) + BigInt(f.saldo_centavos))
  comprobar(
    igualesConjuntos(new Set(porFactura107.keys()), new Set(porFacturaMovil.keys())) &&
      [...porFacturaMovil].every(([id, saldo]) => porFactura107.get(id) === saldo),
    'EPT-107: mismo conjunto de 11 facturas y mismo saldo por factura, con ítems agregados por factura única'
  )
  comprobar(a107.every((f) => f.inconsistente === false), 'EPT-107 no declara inconsistencias en el fixture; la RPC tampoco')
  comprobar(completo.totales.hay_inconsistencias === false, 'La RPC móvil no declara inconsistencias en el fixture')

  const anual = await rf19('2030-01-01', '2030-12-31')
  const anualMovil = await recorrer('padre', A, { p_desde: '2030-01-01', p_hasta: '2030-12-31' })
  const idsRf19 = new Set(anual.filas.map((f) => f.factura_id))
  const idsMovil = new Set(facturasConSaldo(anualMovil.filas).keys())
  comprobar(
    igualesConjuntos(idsRf19, new Set([ID(603), ID(604), ID(605), ID(606), ID(611)])) && igualesConjuntos(idsMovil, idsRf19),
    'Universo completo de facturas con saldo: RF19, EPT-107 y la RPC móvil coinciden en {603,604,605,606,611}'
  )
  comprobar(
    anual.totales.saldo_facturas_centavos === '38000' && suma(facturasConSaldo(anualMovil.filas)) === 38000n &&
      BigInt(anualMovil.primera.totales.adeudado_centavos) === 38000n,
    'Deuda total del universo: RF19 saldo_facturas_centavos = móvil = 380,00'
  )
  const relaciones611 = anual.filas.filter((f) => f.factura_id === ID(611))
  comprobar(
    relaciones611.length === 2 && relaciones611.every((f) => f.saldo_centavos === '4000') && anual.totales.facturas === 5,
    'La factura 611 aparece en dos relaciones de RF19 y su deuda se cuenta una sola vez (5 facturas únicas)'
  )
  comprobar(
    ['604', '605', '606'].every((n) =>
      anual.filas.some((f) => f.factura_id === ID(Number(n)) && f.pago_id === null && f.criterio_fecha === 'Vencimiento') &&
      anualMovil.filas.some((f) => f.factura_id === ID(Number(n)) && f.saldo_centavos === '10000' && f.pagado_centavos === '0')
    ),
    'Facturas sin ningún pago aprobado: RF19 las ubica por vencimiento y la RPC móvil las muestra completas'
  )
  const sumaRelaciones = anual.filas.reduce((n, f) => n + BigInt(f.saldo_centavos), 0n)
  comprobar(
    sumaRelaciones !== BigInt(anual.totales.saldo_facturas_centavos),
    'Sumar el saldo de cada relación de RF19 duplicaría la deuda de la factura 611: por eso se agrega por factura única'
  )

  // Subconjuntos definidos: abril-junio (facturas sin aprobados) y noviembre (dos relaciones) coinciden en ambos filtros.
  for (const [desde, hasta, esperadas, centavos, razon] of [
    ['2030-04-01', '2030-06-30', [ID(604), ID(605), ID(606)], 30000n, 'abril a junio: tres facturas sin aprobados'],
    ['2030-11-01', '2030-11-30', [ID(611)], 4000n, 'noviembre: una factura con dos relaciones'],
  ]) {
    const web = await rf19(desde, hasta)
    const movil = await recorrer('padre', A, { p_desde: desde, p_hasta: hasta })
    const idsW = new Set(web.filas.map((f) => f.factura_id))
    const idsM = new Set(facturasConSaldo(movil.filas).keys())
    comprobar(
      igualesConjuntos(idsW, new Set(esperadas)) && igualesConjuntos(idsM, idsW) &&
        BigInt(web.totales.saldo_facturas_centavos) === centavos && suma(facturasConSaldo(movil.filas)) === centavos,
      `Subconjunto con el mismo rango literal (${razon}): mismo universo y misma deuda`
    )
  }
  // Diferencias legítimas: transferencia (RF19) y período de factura (móvil) NO seleccionan el mismo universo.
  const marzoWeb = await rf19('2030-03-01', '2030-03-31')
  const marzoMovil = await recorrer('padre', A, { p_desde: '2030-03-01', p_hasta: '2030-03-31' })
  comprobar(
    marzoWeb.filas.length === 0 && marzoWeb.totales.saldo_facturas_centavos === '0' &&
      igualesConjuntos(new Set(facturasConSaldo(marzoMovil.filas).keys()), new Set([ID(603)])) && suma(facturasConSaldo(marzoMovil.filas)) === 4000n,
    'Diferencia legítima 1: marzo en RF19 (transferencias) no incluye la factura 603; marzo móvil (período) sí, con su saldo vigente 40,00'
  )
  const eneroWeb = await rf19('2030-01-01', '2030-01-31')
  const eneroMovil = await recorrer('padre', A, { p_desde: '2030-01-01', p_hasta: '2030-01-31' })
  comprobar(
    igualesConjuntos(new Set(eneroWeb.filas.map((f) => f.factura_id)), new Set([ID(603)])) && eneroWeb.totales.saldo_facturas_centavos === '4000' &&
      facturasConSaldo(eneroMovil.filas).size === 0 && eneroMovil.primera.totales.adeudado_centavos === '0',
    'Diferencia legítima 2: enero en RF19 trae la factura 603 por la transferencia del 10/01; enero móvil solo la factura 601, ya pagada'
  )
  const pagoFuera = eneroMovil.filas.find((f) => f.factura_id === ID(601))
  comprobar(
    pagoFuera && pagoFuera.saldo_centavos === '0',
    'Un pago aprobado fuera del intervalo de factura sigue contando: la factura 601 de enero figura sin saldo'
  )
  // La ubicación temporal de RF19 y del filtro móvil no se confunde con la deuda imputada del período.
  const imputadoEnero = (await reporte('ingresos', { p_desde: '2030-01-01', p_hasta: '2030-01-31' })).totales.imputado_centavos
  comprobar(
    imputadoEnero !== eneroMovil.primera.totales.adeudado_centavos,
    'El total imputado del período (RF17) es otra magnitud: no se compara con la deuda'
  )

  // ================================================================
  // 4. Historial que supera una página, orden estable y total global
  // ================================================================
  const O = actores.otroAlumno
  const extenso = await recorrer('otraFamilia', O, {}, 25)
  const esperado = sql(`SELECT md5(string_agg(i.id::TEXT, ',' ORDER BY f.periodo DESC, i.id)) FROM public.items_factura i JOIN public.facturas f ON f.id=i.factura_id WHERE i.alumno_id='${O}';`)
  const idsExtenso = extenso.filas.map((f) => f.item_id)
  const md5 = (await import('node:crypto')).createHash('md5').update(idsExtenso.join(',')).digest('hex')
  comprobar(
    extenso.filas.length === 120 && idsDe(extenso.filas).size === 120 && md5 === esperado,
    '120 ítems en 5 páginas de 25: ninguno omitido ni duplicado, en el orden estable calculado desde las tablas'
  )
  const suma120 = extenso.filas.reduce((n, f) => n + BigInt(f.saldo_centavos), 0n)
  comprobar(
    suma120 === BigInt(extenso.primera.totales.adeudado_centavos) && suma120 === BigInt(120 * 100 + (119 * 120) / 2) * 100n,
    'El total global del filtro (no el de la página) es la suma exacta de los 120 saldos'
  )
  const huellaPrimera = extenso.primera.huella
  sql(`INSERT INTO public.facturas(id,alumno_id,periodo,vencimiento,total) VALUES('${ID(3500)}','${O}','2031-01-01','2031-01-10',50);
    INSERT INTO public.items_factura(id,factura_id,alumno_id,tipo,tarifa_id,matricula_id,importe) VALUES('${ID(4500)}','${ID(3500)}','${O}','CUOTA','${ID(501)}','${ID(204)}',50);`)
  const cambio = await documento('otraFamilia', O, { p_pagina: 2, p_tamano: 25, p_huella: huellaPrimera })
  comprobar(
    cambio.actualizado === true && !('filas' in cambio) && cambio.huella !== huellaPrimera,
    'Un cambio entre páginas devuelve solo la señal de actualización, sin mezclar versiones'
  )
  const recargado = await documento('otraFamilia', O, { p_pagina: 1, p_tamano: 25 })
  comprobar(recargado.total === 121 && recargado.huella === cambio.huella, 'Al recargar desde la primera página se obtiene la versión nueva con 121 ítems')

  // ================================================================
  // 5. Coherencia bajo aprobación y rechazo concurrentes
  // ================================================================
  // Se conmuta la imputación del pago 803 (cuota 4 de la factura 602, 100,00): con ella activa la deuda total es
  // 380,00 y sin ella 480,00. Cada documento debe pertenecer por completo a uno de los dos estados; nunca una
  // mezcla entre filas, subtotales y total.
  const valores = new Set([38000n, 48000n])
  const observados = new Set()
  let lecturas = 0
  let terminado = false
  // El escritor conmuta sin pausa hasta que los lectores hayan visto AMBOS estados: así se prueba que hubo
  // intercalado real y no solo lecturas sueltas antes o después de la escritura.
  const escritor = new SesionPsql('escritor', 'EPT114')
  const alternar = async () => {
    let pasos = 0
    while (!terminado && pasos < 20_000) {
      await escritor.ejecutar(`UPDATE public.imputaciones_pago SET activa = NOT activa WHERE pago_id='${ID(803)}';`, 'conmutar')
      pasos++
    }
    return pasos
  }
  const limiteLectura = performance.now() + 40_000
  const lector = async () => {
    while (!terminado && performance.now() < limiteLectura) {
      lecturas++
      const d = await documento('padre', A)
      const filas = d.filas.reduce((n, f) => n + BigInt(f.saldo_centavos), 0n)
      const subtotales = d.grupos.reduce((n, g) => n + BigInt(g.saldo_centavos), 0n)
      const adeudado = BigInt(d.totales.adeudado_centavos)
      assert.ok(filas === adeudado && subtotales === adeudado, `documento incoherente: ${filas}/${subtotales}/${adeudado}`)
      assert.ok(valores.has(adeudado), `total fuera de los estados válidos: ${adeudado}`)
      assert.equal(d.totales.items_con_saldo, d.filas.filter((f) => BigInt(f.saldo_centavos) > 0n).length)
      observados.add(adeudado)
      if (observados.size === valores.size && lecturas >= 40) terminado = true
    }
  }
  const [pasos] = await Promise.all([alternar(), lector(), lector(), lector(), lector()])
  terminado = true
  await escritor.cerrar()
  comprobar(
    pasos > 0 && observados.size === valores.size && lecturas >= 40,
    `Cuatro lectores y un escritor concurrente (${pasos} conmutaciones, ${lecturas} lecturas): ambos estados observados y cada documento coherente en sí mismo`
  )
  // Restablece el estado original de la imputación conmutada.
  sql(`UPDATE public.imputaciones_pago SET activa = TRUE WHERE pago_id='${ID(803)}';`)
  comprobar((await documento('padre', A)).totales.adeudado_centavos === '38000', 'Tras restablecer la imputación, el total vuelve a 380,00')

  // Respuesta leída antes de una aprobación: la huella la delata en la siguiente página.
  const antes = await documento('padre', A, { p_tamano: 25 })
  sql(`UPDATE public.pagos SET estado='APROBADO',verificado_por='${actores.director}',verificado_en=now() WHERE id='${ID(809)}';
       UPDATE public.items_factura SET estado_pago='PAGADO' WHERE id='${ID(707)}';`)
  const despues = await documento('padre', A, { p_tamano: 25, p_pagina: 2, p_huella: antes.huella })
  comprobar(
    despues.actualizado === true && BigInt((await documento('padre', A)).totales.adeudado_centavos) === 28000n,
    'Aprobar un pago en verificación entre páginas cambia la huella y baja la deuda en 100,00'
  )

  // ================================================================
  // 6. La consulta no modifica nada
  // ================================================================
  const final = huellaEconomia()
  comprobar(final !== economiaInicial, 'Control: las escrituras del propio test (aprobación y alta extra) sí cambian la huella')
  const antesLeer = huellaEconomia()
  for (let i = 0; i < 5; i++) {
    await documento('padre', A)
    await documento('director', A, { p_desde: '2030-01-01', p_hasta: '2030-12-31' })
  }
  comprobar(huellaEconomia() === antesLeer, 'Leer la deuda (también como Dirección) no modifica pagos, ítems ni imputaciones')
  const escritura = await rest(local, sesiones.padre.access_token, 'items_factura', { method: 'PATCH', body: { importe: 1 } })
  comprobar(escritura.estado >= 400 || (Array.isArray(escritura.cuerpo) && escritura.cuerpo.length === 0), 'El padre no puede escribir importes por ninguna vía')
  console.log(`\nEPT-114 deuda_items.mjs: ${afirmaciones} comprobaciones correctas.`)
} finally {
  try {
    limpiar()
  } catch (error) {
    console.error('Limpieza incompleta:', error.message)
    process.exitCode = 1
  }
}
