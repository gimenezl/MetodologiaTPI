// Auth, PostgREST, API web, SQL monetario y concurrencia reales. Sin producción.
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { setTimeout as pausa } from 'node:timers/promises'
import { chromium } from 'playwright'
import {
  sql,
  rpc,
  rest,
  crearCuentaConPerfil,
  exigirSesion,
  cookieDe,
  crearServidorNext,
  limpiarFixture,
} from './_arnes-ept59.mjs'
import { SesionPsql } from './_sesion-psql.mjs'
import { ID, fixture, limpiarEconomia, roles } from './_reportes-economicos-fixture.mjs'

// Espera exclusiva de EPT-112: el sondeo reduce CPU, pero nunca acredita el orden.
// Solo la observación del PID exacto en pg_blocking_pids permite continuar.
async function esperarBloqueoEconomico(sesion, bloqueador, bloqueado, limiteMs = 10_000) {
  assert.ok(Number.isInteger(bloqueador) && bloqueador > 0 && Number.isInteger(bloqueado) && bloqueado > 0)
  const hasta = performance.now() + limiteMs
  let observado = null
  const fallo = () =>
    new Error(
      `Barrera EPT112 no observada dentro de ${limiteMs} ms: ${JSON.stringify({ bloqueador, bloqueado, observado })}`
    )
  while (performance.now() < hasta) {
    let temporizador
    try {
      observado = JSON.parse(
        await Promise.race([
          sesion.escalar(
            `jsonb_build_object('bloqueadores',pg_catalog.pg_blocking_pids(${bloqueado}),
              'actividad',(SELECT jsonb_build_object('estado',state,'espera_tipo',wait_event_type,'espera',wait_event)
                FROM pg_catalog.pg_stat_activity WHERE pid=${bloqueado}))`,
            'barrera_economica'
          ),
          new Promise((_, reject) => {
            temporizador = setTimeout(() => reject(fallo()), Math.max(0, hasta - performance.now()))
          }),
        ])
      )
    } finally {
      clearTimeout(temporizador)
    }
    if (observado.bloqueadores.includes(bloqueador)) return observado
    await pausa(Math.min(20, Math.max(0, hasta - performance.now())))
  }
  throw fallo()
}

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
const ui = process.argv.includes('--ui'),
  base = ui ? process.env.EPT_REPORTES_UI_BASE_URL : undefined
if (base) assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname))
const servidor = base
  ? { url: base, iniciar: async () => {}, detener: async () => {} }
  : crearServidorNext(Number(process.env.EPT_PUERTO_NEXT ?? 3112))
const actores = {},
  sesiones = {},
  password = 'prueba-ept112-sintetica'
let navegador,
  errorPrimario,
  afirmaciones = 0
const comprobar = (condicion, mensaje) => {
  assert.ok(condicion, mensaje)
  console.log(`OK ${++afirmaciones}: ${mensaje}`)
}
const argumentos = (id, extra = {}) => ({ p_reporte: id, p_desde: '2030-01-01', p_hasta: '2030-12-31', ...extra })
const reporte = async (id, extra = {}, actor = 'director') => {
  const r = await rpc(local, actor ? sesiones[actor].access_token : null, 'reporte_economico', argumentos(id, extra))
  assert.equal(r.estado, 200, JSON.stringify(r.cuerpo))
  return r.cuerpo
}
const ruta = (id) => `/api/reportes/economicos/${id}?desde=2030-01-01&hasta=2030-12-31`
async function web(id, actor = 'director', extra = '') {
  const r = await fetch(`${servidor.url}${ruta(id)}${extra}`, {
    headers: actor ? { cookie: cookieDe(sesiones[actor]) } : {},
    redirect: 'manual',
    signal: AbortSignal.timeout(60_000),
  })
  return { estado: r.status, cuerpo: await r.json(), cache: r.headers.get('cache-control') }
}
const sum = (filas) => filas.reduce((n, f) => n + BigInt(f.imputado_centavos), BigInt(0)).toString()
const huellaEconomia = () =>
  sql(`SELECT md5(concat(
  (SELECT string_agg(row_to_json(p)::TEXT,'' ORDER BY id) FROM public.pagos p),
  (SELECT string_agg(row_to_json(i)::TEXT,'' ORDER BY id) FROM public.items_factura i),
  (SELECT string_agg(row_to_json(ip)::TEXT,'' ORDER BY pago_id,item_factura_id) FROM public.imputaciones_pago ip)));`)
function limpiar() {
  sql(`BEGIN; ${limpiarEconomia()} COMMIT;`)
  limpiarFixture({ prefijoDni: '97112', prefijoCorreo: 'ept112.', dominio: 'ept.local' })
  sql(`DELETE FROM public.cursos WHERE id::TEXT LIKE 'b1120000-%';`)
}
try {
  limpiar()
  for (const [i, [key, rol]] of Object.entries(roles).entries()) {
    const email = `ept112.${key}@ept.local`
    const usuario = await crearCuentaConPerfil(local, {
      email,
      password,
      perfil: {
        nombre: 'Prueba',
        apellido: `EPT112 ${key}`,
        dni: `97112${String(i + 1).padStart(3, '0')}`,
        rol_id: Number(sql(`SELECT id FROM public.roles WHERE nombre='${rol}';`)),
        legajo_nro: ['ESTUDIANTE', 'DOCENTE'].includes(rol) ? `EPT112-${key}` : null,
      },
    })
    actores[key] = sql(`SELECT id FROM public.perfiles WHERE user_id='${usuario}';`)
    sesiones[key] = await exigirSesion(local, email, password)
  }
  sql(
    `BEGIN; ${fixture(actores)} UPDATE public.perfiles SET estado_acceso='BLOQUEADO' WHERE id='${actores.bloqueado}'; COMMIT;`
  )
  await servidor.iniciar({
    NEXT_PUBLIC_SUPABASE_URL: local.API_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: local.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY,
  })
  const economiaInicial = huellaEconomia()
  const ingresos = await reporte('ingresos')
  comprobar(
    ingresos.total === 5 &&
      ingresos.totales.informado_centavos === '45900' &&
      ingresos.totales.imputado_centavos === '46000',
    'RF17: pago multifactura y varios archivos cuentan una vez, informado distinto de imputado'
  )
  comprobar(
    sum(ingresos.filas) === ingresos.totales.imputado_centavos && ingresos.totales.diferencia_centavos === '-100',
    'Detalle e importes globales reconcilian exactamente'
  )
  const cursoDe = (n) => ingresos.filas.find((f) => f.pago_id === ID(n)).curso
  comprobar(
    cursoDe(801).curso === 'EPT112 Primero' &&
      cursoDe(804).causa === 'Varias matrículas posibles' &&
      cursoDe(806).curso === 'EPT112 Tercero',
    'Curso histórico, cambio intradía ambiguo y cambio exacto a medianoche Buenos Aires'
  )
  const sinHistoria = await reporte('ingresos', { p_desde: '2028-12-31', p_hasta: '2028-12-31' })
  comprobar(
    sinHistoria.filas[0].curso.causa === 'Historial insuficiente' && sinHistoria.totales.imputado_centavos === '10000',
    'Fecha anterior al historial conserva registro e importe sin sustituir curso actual'
  )
  const completo = await reporte('completos'),
    incompleto = await reporte('incompletos')
  comprobar(
    completo.filas.filter((f) => f.factura_id === ID(601)).length === 2 && completo.totales.facturas === 5,
    'RF18: clasificación por factura, varios pagos y cero sin pago ficticio; facturas únicas en totales'
  )
  comprobar(
    incompleto.filas.some((f) => f.factura_id === ID(603) && f.saldo_centavos === '4000') &&
      [604, 605, 606].every((n) =>
        incompleto.filas.some((f) => f.factura_id === ID(n) && f.pago_id === null && f.criterio_fecha === 'Vencimiento')
      ),
    'RF19: deuda parcial y sin aprobados aunque haya pendientes o rechazados'
  )
  comprobar(
    completo.filas.some((f) => f.pago_id === ID(801)) && incompleto.filas.some((f) => f.pago_id === ID(801)),
    'Un pago multifactura participa en clasificaciones diferentes según la factura'
  )
  const sinAprobadosEnRango = await reporte('incompletos', { p_desde: '2030-01-11', p_hasta: '2030-12-31' })
  comprobar(
    !sinAprobadosEnRango.filas.some((f) => f.factura_id === ID(603)),
    'No confunde ausencia de aprobados en intervalo con ausencia histórica'
  )
  const deporte = await reporte('deportes'),
    recorrido = await reporte('recorridos')
  comprobar(
    deporte.total === 1 &&
      deporte.filas[0].horarios.length === 2 &&
      deporte.totales.imputado_centavos === '2000' &&
      deporte.filas[0].profesor_id === actores.docente,
    'RF20: dos horarios no duplican imputación ni profesor'
  )
  comprobar(
    recorrido.total === 1 && recorrido.totales.imputado_centavos === '2000' && recorrido.filas[0].item_id === ID(703),
    'RF21: recorrido desde ítem e inscripción, no desde situación actual'
  )
  const recorridoActual = sql(`SELECT servicio_id FROM public.inscripciones_servicios WHERE id='${ID(404)}';`)
  comprobar(
    recorrido.filas[0].recorrido_id !== recorridoActual,
    'El recorrido actual distinto no reemplaza la referencia facturada anterior'
  )
  const horarioId = deporte.filas[0].horarios[0].id
  comprobar(
    (await reporte('deportes', { p_filtros: { horario: horarioId, profesor: actores.docente } })).total === 1,
    'Filtros reales de horario y profesor conservan el grano'
  )
  const desconocido = await reporte('ingresos', { p_filtros: { causa: 'Varias matrículas posibles' } })
  comprobar(
    desconocido.total === 1 &&
      desconocido.totales.imputado_centavos === '10000' &&
      sum(desconocido.filas) === desconocido.totales.imputado_centavos,
    'Grupo Curso no determinable reconcilia con su detalle'
  )
  const civil = JSON.parse(
    sql(`DO $$BEGIN PERFORM set_config('request.jwt.claims','${JSON.stringify({ sub: sesiones.director.user.id, role: 'authenticated' })}',false); END$$;
    SET ROLE authenticated;
    SELECT jsonb_build_array(app_private.curso_reporte_economico('${actores.estudiante}','2030-01-10'),
      app_private.curso_reporte_economico('${actores.otroAlumno}','2030-01-10'),
      app_private.curso_reporte_economico('${actores.estudiante}','2029-01-01'));
    RESET ROLE;`)
  )
  comprobar(
    civil[0].curso === civil[1].curso && civil[0].nivel_id === civil[1].nivel_id && !('division' in civil[0]),
    'Dos divisiones distintas comparten agrupación nivel y denominación'
  )
  comprobar(civil[2].curso === 'EPT112 Primero', 'Alta exacta a medianoche local cubre el día completo')
  const limites = JSON.parse(
    sql(`BEGIN;
    UPDATE public.matriculas SET fecha_inicio='2029-01-01T12:00:00Z' WHERE id='${ID(201)}';
    UPDATE public.matriculas SET fecha_inicio='2030-06-16T12:00:00Z' WHERE id='${ID(202)}';
    DO $$BEGIN PERFORM set_config('request.jwt.claims','${JSON.stringify({ sub: sesiones.director.user.id, role: 'authenticated' })}',false); END$$;
    SET LOCAL ROLE authenticated;
    SELECT jsonb_build_array(app_private.curso_reporte_economico('${actores.estudiante}','2029-01-01'),
      app_private.curso_reporte_economico('${actores.estudiante}','2030-06-15'));
    RESET ROLE; ROLLBACK;`)
  )
  comprobar(
    limites.every((c) => c.causa === 'Historial insuficiente'),
    'Alta o cierre intradía sin cobertura completa no inventan hora de transferencia'
  )
  for (const actor of ['padre', 'estudiante', 'docente', 'personal', 'bloqueado', 'otraFamilia', 'otroAlumno', null]) {
    const token = actor ? sesiones[actor].access_token : null
    for (const id of ['ingresos', 'completos', 'incompletos', 'deportes', 'recorridos', 'desconocido']) {
      const r = await rpc(local, token, 'reporte_economico', argumentos(id))
      comprobar(
        [401, 403].includes(r.estado) && !JSON.stringify(r.cuerpo).includes('EPT112 Primero'),
        `${actor ?? 'anon'}: PostgREST niega ${id} sin filas ni totales`
      )
    }
    const r = await web('ingresos', actor)
    comprobar(r.estado === (actor ? 403 : 401), `${actor ?? 'anon'}: API real no revela reporte`)
  }
  const padrePropio = await rest(
    local,
    sesiones.padre.access_token,
    `estado_cuotas_alumno?alumno_id=eq.${actores.estudiante}`
  )
  const ajeno = await rest(
    local,
    sesiones.otraFamilia.access_token,
    `estado_cuotas_alumno?alumno_id=eq.${actores.estudiante}`
  )
  comprobar(
    padrePropio.cuerpo.length === 10 && ajeno.cuerpo.length === 0,
    'No se rompe RLS económica propia entre las dos familias'
  )
  for (const extra of ['&hasta=2030-01-01', '&desde=2030-02-30', '&tamano=1000', '&actor=director']) {
    comprobar((await web('ingresos', 'director', extra)).estado === 400, `API rechaza filtro inválido ${extra}`)
  }
  for (const id of ['ingresos', 'completos', 'incompletos', 'deportes', 'recorridos']) {
    const r = await web(id)
    comprobar(
      r.estado === 200 &&
        /no-store/.test(r.cache) &&
        !/ruta_archivo|storage\/|numero_operacion|service_role/.test(JSON.stringify(r.cuerpo)),
      `API ${id}: sesión real, sin caché ni secretos innecesarios`
    )
  }
  comprobar(
    economiaInicial === huellaEconomia(),
    'Consultar y filtrar por API/RPC no modifica pagos, ítems ni imputaciones'
  )
  if (!ui) {
    // 9010 importes máximos exceden Number.MAX_SAFE_INTEGER en centavos.
    sql(`BEGIN;
      -- Estadísticas de la base pequeña ANTES del crecimiento: la lectura inmediata
      -- no puede depender de que autovacuum analice las 9010 filas recién insertadas.
      ANALYZE public.facturas,public.items_factura,public.pagos,public.imputaciones_pago;
      INSERT INTO public.facturas(id,alumno_id,periodo,vencimiento,total)
        SELECT ('b1120000-0000-4000-8000-'||lpad((300000+n)::TEXT,12,'0'))::UUID,'${actores.estudiante}',
        (DATE '4000-01-01'+(n||' months')::INTERVAL)::DATE,(DATE '4000-01-10'+(n||' months')::INTERVAL)::DATE,9999999999.99 FROM generate_series(1,9010) n;
      INSERT INTO public.items_factura(id,factura_id,alumno_id,tipo,tarifa_id,matricula_id,importe,estado_pago)
        SELECT ('b1120000-0000-4000-8000-'||lpad((200000+n)::TEXT,12,'0'))::UUID,
        ('b1120000-0000-4000-8000-'||lpad((300000+n)::TEXT,12,'0'))::UUID,'${actores.estudiante}','CUOTA','${ID(501)}','${ID(201)}',9999999999.99,'PAGADO' FROM generate_series(1,9010) n;
      INSERT INTO public.pagos(id,padre_id,alumno_id,total_calculado,importe_informado,fecha_transferencia,numero_operacion,estado,verificado_por,verificado_en)
        SELECT ('b1120000-0000-4000-8000-'||lpad((100000+n)::TEXT,12,'0'))::UUID,'${actores.padre}','${actores.estudiante}',9999999999.99,9999999999.99,'2032-01-01','EPT112-grande-'||n,'APROBADO','${actores.director}',now() FROM generate_series(1,9010) n;
      INSERT INTO public.imputaciones_pago(pago_id,item_factura_id,alumno_id,importe)
        SELECT ('b1120000-0000-4000-8000-'||lpad((100000+n)::TEXT,12,'0'))::UUID,
        ('b1120000-0000-4000-8000-'||lpad((200000+n)::TEXT,12,'0'))::UUID,'${actores.estudiante}',9999999999.99 FROM generate_series(1,9010) n;
      COMMIT;`)
    const grandes = await reporte('ingresos', { p_desde: '2032-01-01', p_hasta: '2032-01-01', p_tamano: 25 })
    const segunda = await reporte('ingresos', {
      p_desde: '2032-01-01',
      p_hasta: '2032-01-01',
      p_tamano: 25,
      p_pagina: 2,
      p_huella: grandes.huella,
    })
    comprobar(
      grandes.total === 9010 &&
        grandes.filas.length === 25 &&
        grandes.totales.imputado_centavos === '9009999999990990' &&
        segunda.totales.imputado_centavos === grandes.totales.imputado_centavos &&
        segunda.huella === grandes.huella &&
        !segunda.filas.some((f) => grandes.filas.some((g) => g.id === f.id)),
      'Paginación estable y totales globales exactos por encima del entero seguro JS'
    )
    // Lectura detenida tras materializar el documento; una decisión real confirma mientras está en vuelo.
    const gate = new SesionPsql('ept112_gate'),
      lector = new SesionPsql('ept112_lector'),
      observador = new SesionPsql('ept112_observador')
    try {
      await gate.ejecutar('BEGIN; SELECT pg_advisory_xact_lock(112005);', 'barrera')
      const pidGate = Number(await gate.escalar('pg_backend_pid()', 'pid')),
        pidLector = Number(await lector.escalar('pg_backend_pid()', 'pid'))
      await lector.ejecutar(
        `SET ROLE authenticated; SET request.jwt.claims='${JSON.stringify({ sub: sesiones.director.user.id, role: 'authenticated' })}';`,
        'actor'
      )
      // Demora controlada superior a los 0,9 s del fallo Linux. No ordena la
      // decisión: esta sigue condicionada a observar el bloqueo real del lector.
      const inicioEspera = performance.now()
      const enVuelo = lector.escalar(
        `(WITH q AS MATERIALIZED (SELECT public.reporte_economico('ingresos','2030-01-01','2030-12-31') AS doc,
          pg_catalog.pg_sleep(1.2) AS demora_prueba)
        SELECT q.doc FROM q CROSS JOIN LATERAL (SELECT pg_advisory_xact_lock(112000+(q.doc->>'total')::INTEGER)) b)`,
        'lectura'
      )
      await esperarBloqueoEconomico(observador, pidGate, pidLector)
      const esperaObservadaMs = performance.now() - inicioEspera
      const decision = await rpc(local, sesiones.director.access_token, 'verificar_pago', {
        p_pago_id: ID(807),
        p_decision: 'APROBADO',
        p_motivo: null,
      })
      assert.equal(decision.estado, 200, JSON.stringify(decision.cuerpo))
      await gate.ejecutar('COMMIT;', 'liberar')
      const anterior = JSON.parse(await enVuelo),
        actual = await reporte('ingresos')
      comprobar(
        esperaObservadaMs >= 1_200 &&
          anterior.total === 5 &&
          anterior.totales.imputado_centavos === '46000' &&
          actual.total === 6 &&
          actual.totales.imputado_centavos === '56000',
        'Aprobación concurrente: cada respuesta es íntegra, nunca mezcla pendiente e ingreso'
      )
      const cambiada = await web('ingresos', 'director', `&huella=${anterior.huella}&pagina=2`)
      comprobar(cambiada.estado === 409, 'Cambio monetario entre páginas exige actualizar, no publica mezcla')
      await gate.ejecutar('BEGIN; SELECT pg_advisory_xact_lock(112006);', 'barrera_rechazo')
      const rechazoEnVuelo = lector.escalar(
        `(WITH q AS MATERIALIZED (SELECT public.reporte_economico('ingresos','2030-01-01','2030-12-31') AS doc)
        SELECT q.doc FROM q CROSS JOIN LATERAL (SELECT pg_advisory_xact_lock(112000+(q.doc->>'total')::INTEGER)) b)`,
        'lectura_rechazo'
      )
      await esperarBloqueoEconomico(observador, pidGate, pidLector)
      const rechazo = await rpc(local, sesiones.director.access_token, 'verificar_pago', {
        p_pago_id: ID(809),
        p_decision: 'RECHAZADO',
        p_motivo: 'Rechazo sintético EPT112',
      })
      assert.equal(rechazo.estado, 200, JSON.stringify(rechazo.cuerpo))
      await gate.ejecutar('COMMIT;', 'liberar_rechazo')
      const duranteRechazo = JSON.parse(await rechazoEnVuelo),
        despuesRechazo = await reporte('ingresos')
      comprobar(
        duranteRechazo.huella === actual.huella &&
          despuesRechazo.huella === actual.huella &&
          despuesRechazo.totales.imputado_centavos === '56000',
        'Rechazo concurrente: ni pendiente ni rechazado figuran como ingreso'
      )
    } finally {
      await gate.cerrar()
      await lector.cerrar()
      await observador.cerrar()
    }
  }
  if (ui) {
    const urlNavegador = servidor.url.replace('127.0.0.1', 'localhost')
    navegador = await chromium.launch()
    const contexto = await navegador.newContext()
    // Cookie SSR producida por el arnés real; no se simula la API económica.
    const cookie = cookieDe(sesiones.director).split(';')[0],
      igual = cookie.indexOf('=')
    await contexto.addCookies([{ name: cookie.slice(0, igual), value: cookie.slice(igual + 1), url: urlNavegador }])
    const pagina = await contexto.newPage()
    await pagina.goto(`${urlNavegador}/dashboard/reportes`)
    await pagina
      .getByRole('heading', { name: 'Reportes académicos', exact: true })
      .waitFor({ timeout: 30_000 })
      .catch(async () => {
        throw new Error(`No cargó índice académico: ${(await pagina.locator('body').innerText()).slice(-1500)}`)
      })
    for (const [id, titulo] of Object.entries({
      ingresos: 'Ingresos por período',
      completos: 'Pagos completos',
      incompletos: 'Pagos incompletos',
      deportes: 'Pagos por deporte',
      recorridos: 'Pagos por recorrido',
    })) {
      await pagina.goto(`${urlNavegador}/dashboard/reportes/economicos/${id}?desde=2030-01-01&hasta=2030-12-31`)
      await pagina.getByRole('heading', { name: titulo, exact: true }).waitFor()
      comprobar(
        (await pagina.getByRole('table').count()) === 1,
        `UI ${id}: navegación, filtros y tabla con backend real`
      )
    }
    await pagina.getByLabel('Desde', { exact: true }).fill('2050-01-01')
    await pagina.getByLabel('Hasta', { exact: true }).fill('2050-12-31')
    await pagina.getByRole('button', { name: 'Consultar', exact: true }).click()
    await pagina.getByText('No hay resultados con estos filtros.', { exact: true }).waitFor()
    comprobar(true, 'UI: vacío conserva fechas aplicadas y ofrece ampliar período')
    await pagina.setViewportSize({ width: 390, height: 844 })
    comprobar(
      await pagina.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      'UI responsive sin desbordamiento de página'
    )
    // Se retira/restaura EXECUTE solo en la base descartable para probar el error real del servidor.
    try {
      sql(
        'REVOKE EXECUTE ON FUNCTION public.reporte_economico(TEXT,DATE,DATE,JSONB,INTEGER,INTEGER,TEXT) FROM authenticated;'
      )
      await pagina.goto(`${urlNavegador}/dashboard/reportes/economicos/ingresos?desde=2030-01-01&hasta=2030-12-31`)
      await pagina.getByRole('link', { name: 'Reintentar', exact: true }).waitFor()
    } finally {
      sql(
        'GRANT EXECUTE ON FUNCTION public.reporte_economico(TEXT,DATE,DATE,JSONB,INTEGER,INTEGER,TEXT) TO authenticated;'
      )
    }
    await pagina.getByRole('link', { name: 'Reintentar', exact: true }).click()
    await pagina.getByRole('table').waitFor()
    comprobar(true, 'UI error real y reintento conserva fechas y recupera resultados')
    comprobar(
      await pagina.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      'UI con tabla económica en viewport390 contiene el desplazamiento horizontal en su región accesible'
    )
    if (process.env.EPT_REPORTES_CAPTURA) {
      await pagina.screenshot({ path: process.env.EPT_REPORTES_CAPTURA, fullPage: true })
    }
    let liberarAnterior
    let avisarRetenida
    const liberada = new Promise((resolve) => {
      liberarAnterior = resolve
    })
    const retenida = new Promise((resolve) => {
      avisarRetenida = resolve
    })
    await pagina.route('**/dashboard/reportes/economicos/ingresos?**', async (route) => {
      avisarRetenida()
      await liberada
      await route.continue().catch(() => {}) // El navegador puede haber cancelado ya la navegación anterior.
    })
    const anterior = pagina
      .goto(`${urlNavegador}/dashboard/reportes/economicos/ingresos?desde=2028-01-01&hasta=2028-12-31`)
      .catch(() => {})
    await retenida
    try {
      await pagina.goto(`${urlNavegador}/dashboard/reportes/economicos/deportes?desde=2030-01-01&hasta=2030-12-31`)
      await pagina.getByRole('heading', { name: 'Pagos por deporte', exact: true }).waitFor()
    } finally {
      liberarAnterior()
    }
    await anterior
    await pagina.unroute('**/dashboard/reportes/economicos/ingresos?**')
    comprobar(
      pagina.url().includes('/deportes?') &&
        (await pagina.getByRole('heading', { name: 'Ingresos por período', exact: true }).count()) === 0,
      'Una navegación anterior retenida no sustituye el contexto nuevo; respuestas económicas no simuladas'
    )
    const nivel = sql(`SELECT nivel_id FROM public.cursos WHERE id='${ID(101)}';`)
    const filtrosAplicados = {
      nivel,
      deporte: deporte.filas[0].deporte_id,
      profesor: actores.docente,
      horario: horarioId,
    }
    const filtroUrl = (valores) => new URLSearchParams({ desde: '2030-01-01', hasta: '2030-12-31', ...valores })
    async function conservarFiltros(valores) {
      for (const [campo, valor] of Object.entries(valores)) {
        assert.equal(
          await pagina.locator(`select[name="${campo}"]`).inputValue(),
          valor,
          `Selector ${campo} conserva filtro`
        )
      }
      await pagina.getByRole('button', { name: 'Consultar', exact: true }).click()
      await pagina.getByRole('heading', { name: 'Resultado del 01/01/2030 al 31/12/2030', exact: true }).waitFor()
      for (const [campo, valor] of Object.entries(valores)) {
        assert.equal(new URL(pagina.url()).searchParams.get(campo), valor, `GET conserva ${campo}`)
      }
    }
    try {
      sql('REVOKE EXECUTE ON FUNCTION public.catalogos_reportes() FROM authenticated;')
      await pagina.goto(`${urlNavegador}/dashboard/reportes/economicos/deportes?${filtroUrl(filtrosAplicados)}`)
      await pagina.getByRole('alert').filter({ hasText: 'No se pudieron cargar las listas.' }).waitFor()
      await conservarFiltros(filtrosAplicados)
      comprobar(
        (await pagina.getByRole('table').count()) === 1,
        'Catálogo falla realmente: nivel, deporte, profesor y horario aplicados sobreviven Consultar'
      )
      await pagina.goto(
        `${urlNavegador}/dashboard/reportes/economicos/recorridos?${filtroUrl({ recorrido: recorrido.filas[0].recorrido_id })}`
      )
      await pagina.getByRole('alert').filter({ hasText: 'No se pudieron cargar las listas.' }).waitFor()
      await conservarFiltros({ recorrido: recorrido.filas[0].recorrido_id })
      comprobar(true, 'Catálogo no disponible conserva también el recorrido aplicado')
    } finally {
      sql('GRANT EXECUTE ON FUNCTION public.catalogos_reportes() TO authenticated;')
    }
    const ausentes = { nivel: '9999', deporte: ID(999991), profesor: ID(999992), horario: ID(999993) }
    await pagina.goto(`${urlNavegador}/dashboard/reportes/economicos/deportes?${filtroUrl(ausentes)}`)
    await conservarFiltros(ausentes)
    const catalogosRepuestos = await rpc(local, sesiones.director.access_token, 'catalogos_reportes', {})
    comprobar(
      catalogosRepuestos.estado === 200 &&
        (await pagina.getByRole('alert').filter({ hasText: 'No se pudieron cargar las listas.' }).count()) === 0,
      'Catálogo responde correctamente pero no contiene valores activos: tampoco se descartan'
    )
    await pagina.locator('select[name="deporte"]').selectOption('')
    await pagina.getByRole('button', { name: 'Consultar', exact: true }).click()
    await pagina.getByText('No hay resultados con estos filtros.', { exact: true }).waitFor()
    comprobar(
      new URL(pagina.url()).searchParams.get('deporte') === '' &&
        new URL(pagina.url()).searchParams.get('profesor') === ausentes.profesor,
      'Quitar un filtro es explícito y no elimina los demás filtros ausentes del catálogo'
    )
    await pagina.goto(
      `${urlNavegador}/dashboard/reportes/economicos/recorridos?${filtroUrl({ recorrido: ID(999994) })}`
    )
    await conservarFiltros({ recorrido: ID(999994) })
    comprobar(true, 'Recorrido activo ausente de un catálogo disponible se conserva al consultar')
    const denegado = await navegador.newContext()
    const cookiePadre = cookieDe(sesiones.padre).split(';')[0],
      separador = cookiePadre.indexOf('=')
    await denegado.addCookies([
      { name: cookiePadre.slice(0, separador), value: cookiePadre.slice(separador + 1), url: urlNavegador },
    ])
    const sinPermiso = await denegado.newPage()
    await sinPermiso.goto(`${urlNavegador}/dashboard/reportes/economicos/ingresos`)
    await sinPermiso.getByRole('heading', { name: 'Acceso restringido', exact: true }).waitFor()
    comprobar(
      (await sinPermiso.getByRole('table').count()) === 0,
      'UI padre sin permiso no muestra datos económicos globales'
    )
    await denegado.close()
    await contexto.close()
  }
  comprobar(true, `Finalizaron ${afirmaciones} comprobaciones reales EPT112`)
} catch (error) {
  errorPrimario = error
  console.error(error)
  process.exitCode = 1
} finally {
  if (navegador) await navegador.close()
  await servidor.detener()
  try {
    limpiar()
  } catch (error) {
    console.error('Falló limpieza propia EPT112', error)
    process.exitCode = 1
    if (!errorPrimario) throw error
  }
}
