/**
 * Administración de tarifas contra PostgREST y GoTrue reales (EPT-103).
 *
 * Complementa `tarifas_administracion_rls.sql`: el SQL simula al actor con
 * `SET ROLE` y claims; este script lo hace como un cliente cualquiera, con un
 * JWT emitido por GoTrue, llamando a la Data API sin pasar por la aplicación de
 * Next. Demuestra lo que importa de una llamada directa:
 *
 *   · anon y todo actor que no sea DIRECTOR habilitado reciben 401/403 con
 *     SQLSTATE 42501, también con metadata de usuario falsificada;
 *   · un JWT con el payload alterado no autentica (firma inválida);
 *   · el esquema `app_private` no está expuesto;
 *   · la escritura directa sobre `tarifas` está cerrada para todos, también para
 *     la Dirección;
 *   · un JWT emitido antes de un bloqueo o de un cambio de rol deja de servir;
 *   · el importe se valida antes del cast: `10.005`, como texto y como número
 *     JSON, se rechaza y no se almacena como 10.01;
 *   · los errores de dominio llegan con sus SQLSTATE propios (P68xx);
 *   · dos altas solapadas simultáneas confirman una sola.
 *
 * Uso con el stack aislado de la unidad:
 *
 *     EPT_SUPABASE_WORKDIR=<directorio con supabase/config.toml> \
 *     EPT_SUPABASE_DB_CONTAINER=supabase_db_ept103 \
 *       node supabase/tests/tarifas_postgrest.mjs
 *
 * Solo corre contra una API de bucle local. Crea cuentas con el dominio
 * `ept103-api.local` y filas con el prefijo «E2E Tarifas PG», y las retira al
 * final. Nunca imprime claves ni tokens.
 */

import { execFileSync } from 'node:child_process'
import {
  afirmar,
  conteo,
  crearCuentaConPerfil,
  iniciarSesion,
  rest,
  sql,
} from './_arnes-ept59.mjs'

const ANFITRIONES_LOCALES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
const DOMINIO = 'ept103-api.local'
const CONTRASENA = 'prueba-ept-103-postgrest'
const DEPORTE = 'e1030000-0000-4000-8000-0000000000b1'
const DEPORTE_2 = 'e1030000-0000-4000-8000-0000000000b2'
const NOMBRE = 'E2E Tarifas PG'

function leerEntorno() {
  const argumentos = ['supabase', 'status', '-o', 'env']
  if (process.env.EPT_SUPABASE_WORKDIR) argumentos.push('--workdir', process.env.EPT_SUPABASE_WORKDIR)
  const salida = execFileSync('npx', argumentos, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  const valores = {}
  for (const linea of salida.split(/\r?\n/u)) {
    const m = /^([A-Z0-9_]+)="?(.*?)"?$/u.exec(linea.trim())
    if (m) valores[m[1]] = m[2]
  }
  if (!valores.API_URL || !valores.ANON_KEY) throw new Error('no se pudo leer la instancia local')
  if (!ANFITRIONES_LOCALES.has(new URL(valores.API_URL).hostname)) {
    throw new Error('la API no es de bucle local: la suite se niega a correr')
  }
  return valores
}

const local = leerEntorno()

const PERSONAS = {
  director: { rol: 'DIRECTOR', dni: '95103101' },
  degradable: { rol: 'DIRECTOR', dni: '95103102' },
  bloqueable: { rol: 'DIRECTOR', dni: '95103103' },
  padre: { rol: 'PADRE', dni: '95103104' },
  estudiante: { rol: 'ESTUDIANTE', dni: '95103105', legajo: 'LEG-PG-EPT103-1' },
  docente: { rol: 'DOCENTE', dni: '95103106', legajo: 'LEG-PG-EPT103-2' },
  personal: { rol: 'PERSONAL', dni: '95103107' },
}

const tokens = {}
const perfiles = {}

function limpiar() {
  sql(`
    BEGIN;
    DELETE FROM public.tarifas WHERE deporte_id IN ('${DEPORTE}', '${DEPORTE_2}');
    DELETE FROM public.deportes WHERE id IN ('${DEPORTE}', '${DEPORTE_2}');
    DELETE FROM public.matriculas WHERE alumno_id IN (SELECT id FROM public.perfiles WHERE dni LIKE '951031%');
    DELETE FROM public.alumnos WHERE perfil_id IN (SELECT id FROM public.perfiles WHERE dni LIKE '951031%');
    ALTER TABLE public.profesores_estados_historial DISABLE TRIGGER impedir_modificar_historial_profesor;
    DELETE FROM public.profesores_estados_historial
      WHERE profesor_id IN (SELECT id FROM public.perfiles WHERE dni LIKE '951031%')
         OR actor_id IN (SELECT id FROM public.perfiles WHERE dni LIKE '951031%');
    ALTER TABLE public.profesores_estados_historial ENABLE TRIGGER impedir_modificar_historial_profesor;
    DELETE FROM public.profesores WHERE perfil_id IN (SELECT id FROM public.perfiles WHERE dni LIKE '951031%');
    ALTER TABLE public.perfiles_historial DISABLE TRIGGER impedir_modificar_historial_perfiles;
    DELETE FROM public.perfiles_historial
      WHERE perfil_id IN (SELECT id FROM public.perfiles WHERE dni LIKE '951031%')
         OR actor_perfil_id IN (SELECT id FROM public.perfiles WHERE dni LIKE '951031%');
    ALTER TABLE public.perfiles_historial ENABLE TRIGGER impedir_modificar_historial_perfiles;
    DELETE FROM public.perfiles WHERE dni LIKE '951031%';
    COMMIT;
    DELETE FROM auth.users WHERE email LIKE 'ept103-pg-%@${DOMINIO}';
  `)
}

const rolId = (nombre) => Number(sql(`SELECT id FROM public.roles WHERE nombre = '${nombre}';`))

async function sembrar() {
  sql(`INSERT INTO public.deportes (id, nombre) VALUES ('${DEPORTE}', '${NOMBRE} 1'), ('${DEPORTE_2}', '${NOMBRE} 2');`)
  for (const [clave, p] of Object.entries(PERSONAS)) {
    const email = `ept103-pg-${clave}@${DOMINIO}`
    const userId = await crearCuentaConPerfil(local, {
      email,
      password: CONTRASENA,
      perfil: {
        nombre: 'Prueba',
        apellido: `Tarifas PG ${clave}`,
        dni: p.dni,
        rol_id: rolId(p.rol),
        legajo_nro: p.legajo ?? null,
      },
    })
    perfiles[clave] = sql(`SELECT id FROM public.perfiles WHERE user_id = '${userId}';`)
    const sesion = await iniciarSesion(local, email, CONTRASENA)
    if (!sesion.sesion) throw new Error(`no se pudo iniciar sesión como ${clave} (${sesion.estado})`)
    tokens[clave] = sesion.sesion.access_token
  }
}

const rpc = (clave, funcion, cuerpo, opciones = {}) =>
  rest(local, clave === null ? null : tokens[clave], `rpc/${funcion}`, { method: 'POST', body: cuerpo, ...opciones })

const alta = (importe, desde, hasta = null, deporte = DEPORTE) => ({
  p_concepto: 'DEPORTE',
  p_nivel_id: null,
  p_deporte_id: deporte,
  p_servicio_id: null,
  p_importe: importe,
  p_desde: desde,
  p_hasta: hasta,
})

const contarTarifas = (filtro) => Number(sql(`SELECT count(*) FROM public.tarifas WHERE ${filtro};`))
const codigo = (r) => r.cuerpo?.code ?? null

async function main() {
  limpiar()
  await sembrar()

  // ---------------- Actores sin autoridad ----------------
  const intento = alta('1', '2070-01-01', '2070-01-31')
  const anon = await rpc(null, 'crear_tarifa', intento)
  afirmar(anon.estado === 401 && codigo(anon) === '42501', `anon: 401 con SQLSTATE 42501 (obtuvo ${anon.estado} ${codigo(anon)})`)

  for (const clave of ['padre', 'estudiante', 'docente', 'personal']) {
    for (const funcion of ['crear_tarifa', 'cambiar_tarifa']) {
      const r = await rpc(clave, funcion, intento)
      afirmar(r.estado === 403 && codigo(r) === '42501', `${clave} ${funcion}: 403 / 42501 (obtuvo ${r.estado} ${codigo(r)})`)
    }
    const a = await rpc(clave, 'actualizar_tarifa', {
      p_tarifa_id: DEPORTE, p_importe: '1', p_desde: '2070-01-01', p_hasta: null,
      p_importe_previo: '1', p_desde_previo: '2070-01-01', p_hasta_previo: null,
    })
    afirmar(a.estado === 403 && codigo(a) === '42501', `${clave} actualizar_tarifa: 403 / 42501 (obtuvo ${a.estado} ${codigo(a)})`)
  }
  afirmar(contarTarifas(`deporte_id = '${DEPORTE}'`) === 0, 'ningún actor sin autoridad escribió nada')

  // Metadata de usuario falsificada en el cuerpo: no cambia nada (la identidad sale del JWT).
  const falsificada = await rpc('padre', 'crear_tarifa', { ...intento, user_metadata: { rol: 'DIRECTOR' }, p_rol: 'DIRECTOR' })
  afirmar(falsificada.estado === 404 || falsificada.estado === 400, `un cuerpo con argumentos ajenos no es una función existente (${falsificada.estado})`)
  afirmar(contarTarifas(`deporte_id = '${DEPORTE}'`) === 0, 'y no escribió nada')

  // Un JWT con el payload alterado no autentica: la firma ya no coincide.
  const [cabecera, , firma] = tokens.padre.split('.')
  const carga = Buffer.from(JSON.stringify({ role: 'service_role', sub: perfiles.director })).toString('base64url')
  const alterado = await rest(local, `${cabecera}.${carga}.${firma}`, 'rpc/crear_tarifa', { method: 'POST', body: intento })
  afirmar(alterado.estado === 401, `un JWT con el payload alterado recibe 401 (obtuvo ${alterado.estado})`)

  // ---------------- Superficie ----------------
  const privado = await rpc('director', 'crear_tarifa', intento, {
    headers: { 'content-profile': 'app_private' },
  })
  afirmar(privado.estado === 406 && codigo(privado) === 'PGRST106', `app_private no está expuesto (obtuvo ${privado.estado} ${codigo(privado)})`)

  const lecturaGet = await rest(local, tokens.director, 'rpc/crear_tarifa?p_concepto=DEPORTE', { method: 'GET' })
  afirmar(lecturaGet.estado === 405 || lecturaGet.estado === 404, `una operación que escribe no admite GET (obtuvo ${lecturaGet.estado})`)

  for (const clave of ['director', 'padre']) {
    for (const [metodo, ruta, cuerpo] of [
      ['POST', 'tarifas', { concepto: 'DEPORTE', deporte_id: DEPORTE, importe: 1, desde: '2070-02-01' }],
      ['PATCH', `tarifas?deporte_id=eq.${DEPORTE}`, { importe: 1 }],
      ['DELETE', `tarifas?deporte_id=eq.${DEPORTE}`, undefined],
    ]) {
      const r = await rest(local, tokens[clave], ruta, { method: metodo, body: cuerpo })
      afirmar(r.estado === 403 && codigo(r) === '42501', `${clave} ${metodo} directo sobre tarifas: 403 / 42501 (obtuvo ${r.estado} ${codigo(r)})`)
    }
  }
  const lecturaPadre = await rest(local, tokens.padre, 'tarifas?select=id')
  afirmar(lecturaPadre.estado === 200 && lecturaPadre.cuerpo?.length === 0, 'el padre lee 0 tarifas (RLS)')

  // ---------------- Contrato monetario por la Data API ----------------
  const valido = await rpc('director', 'crear_tarifa', alta('1234.5', '2071-01-01', '2071-12-31'))
  afirmar(valido.estado === 200 && valido.cuerpo?.importe === '1234.50' && typeof valido.cuerpo?.importe === 'string',
    `el DIRECTOR crea y recibe el importe como texto exacto (${valido.estado} ${JSON.stringify(valido.cuerpo?.importe)})`)
  afirmar(sql(`SELECT importe::text FROM public.tarifas WHERE deporte_id = '${DEPORTE}' AND desde = '2071-01-01';`) === '1234.50', 'la relectura en la base es 1234.50')

  const cero = await rpc('director', 'crear_tarifa', alta('0', '2072-01-01', '2072-12-31'))
  afirmar(cero.estado === 200 && cero.cuerpo?.importe === '0.00', 'el cero se acepta y se conserva')

  const antes = contarTarifas(`deporte_id = '${DEPORTE}'`)
  const rechazos = [
    ['10.005', 'P6812'], ['-1', 'P6811'], ['NaN', 'P6810'], ['Infinity', 'P6810'], ['1e3', 'P6810'],
    ['1,5', 'P6810'], ['1.234,50', 'P6810'], ['10000000000', 'P6813'], ['', 'P6810'], [' 10', 'P6810'],
    ['007', 'P6810'], ['10.5.5', 'P6810'],
  ]
  for (const [importe, esperado] of rechazos) {
    const r = await rpc('director', 'crear_tarifa', alta(importe, '2073-01-01', '2073-01-31'))
    afirmar(r.estado === 400 && codigo(r) === esperado, `importe ${JSON.stringify(importe)} -> ${esperado} (obtuvo ${r.estado} ${codigo(r)})`)
  }
  const sinImporte = await rpc('director', 'crear_tarifa', alta(null, '2073-01-01', '2073-01-31'))
  afirmar(sinImporte.estado === 400 && codigo(sinImporte) === 'P6810', `importe nulo -> P6810 (obtuvo ${sinImporte.estado} ${codigo(sinImporte)})`)

  // Importe como NÚMERO JSON: PostgREST lo pasa como texto; 10.005 nunca se redondea.
  const numero = await rpc('director', 'crear_tarifa', { ...alta('x', '2073-01-01', '2073-01-31'), p_importe: 10.005 })
  afirmar(numero.estado === 400 && codigo(numero) === 'P6812', `10.005 enviado como número JSON -> P6812 (obtuvo ${numero.estado} ${codigo(numero)})`)
  afirmar(contarTarifas(`deporte_id = '${DEPORTE}'`) === antes, 'ningún rechazo dejó filas: nada se almacenó como 10.01')
  afirmar(contarTarifas('importe = 10.01') === 0, 'no existe ninguna tarifa 10.01 por redondeo')

  // ---------------- Fechas y vigencia ----------------
  for (const [desde, hasta, esperado] of [
    [null, null, 'P6820'], ['infinity', null, 'P6821'], ['-infinity', null, 'P6821'],
    ['2074-01-01', 'infinity', 'P6821'], ['2074-02-01', '2074-01-01', 'P6822'],
  ]) {
    const r = await rpc('director', 'crear_tarifa', alta('1', desde, hasta))
    afirmar(r.estado === 400 && codigo(r) === esperado, `fechas ${desde}/${hasta} -> ${esperado} (obtuvo ${r.estado} ${codigo(r)})`)
  }
  const imposible = await rpc('director', 'crear_tarifa', alta('1', '2074-02-30', null))
  afirmar(imposible.estado === 400 && ['22008', '22007'].includes(codigo(imposible)), `una fecha que no existe no llega a la función (${imposible.estado} ${codigo(imposible)})`)

  const dia = await rpc('director', 'crear_tarifa', alta('5', '2075-03-10', '2075-03-10'))
  afirmar(dia.estado === 200, 'una vigencia de un solo día es válida (extremos incluidos)')
  const compartido = await rpc('director', 'crear_tarifa', alta('6', '2075-03-10', '2075-03-31'))
  afirmar(compartido.estado === 400 && codigo(compartido) === 'P6830', 'compartir el día 10 se rechaza (P6830)')
  const adyacente = await rpc('director', 'crear_tarifa', alta('6', '2075-03-11', '2075-03-31'))
  afirmar(adyacente.estado === 200, 'D-1 / D adyacentes se aceptan')

  // ---------------- Sucesión y edición ----------------
  const abierta = await rpc('director', 'crear_tarifa', alta('100', '2076-01-01', null))
  afirmar(abierta.estado === 200, 'alta de una versión abierta')
  const cambioOk = await rpc('director', 'cambiar_tarifa', alta('150.5', '2076-07-01', null))
  afirmar(
    cambioOk.estado === 200 && cambioOk.cuerpo?.anterior?.hasta === '2076-06-30' && cambioOk.cuerpo?.nueva?.importe === '150.50',
    `la sucesión cierra la anterior en D-1 y abre la nueva (${cambioOk.estado})`
  )
  const repetido = await rpc('director', 'cambiar_tarifa', alta('999', '2076-07-01', null))
  afirmar(repetido.estado === 400 && codigo(repetido) === 'P6830', 'repetir la sucesión: P6830')
  afirmar(
    sql(`SELECT string_agg(importe::text || ':' || desde::text || ':' || COALESCE(hasta::text, ''), '|' ORDER BY desde)
         FROM public.tarifas WHERE deporte_id = '${DEPORTE}' AND desde >= '2076-01-01' AND desde < '2077-01-01';`)
      === '100.00:2076-01-01:2076-06-30|150.50:2076-07-01:',
    'el rechazo no dejó escrituras parciales'
  )

  const idNueva = cambioOk.cuerpo?.nueva?.id
  const previo = { p_importe_previo: '150.50', p_desde_previo: '2076-07-01', p_hasta_previo: null }
  const edicionOk = await rpc('director', 'actualizar_tarifa', {
    p_tarifa_id: idNueva, p_importe: '175', p_desde: '2076-07-01', p_hasta: null, ...previo,
  })
  afirmar(edicionOk.estado === 200 && edicionOk.cuerpo?.importe === '175.00', 'la edición con los valores previos se aplica')
  const conflicto = await rpc('director', 'actualizar_tarifa', {
    p_tarifa_id: idNueva, p_importe: '999', p_desde: '2076-07-01', p_hasta: null, ...previo,
  })
  afirmar(conflicto.estado === 400 && codigo(conflicto) === 'P6831', 'editar sobre un valor viejo: P6831, sin sobrescribir')
  afirmar(sql(`SELECT importe::text FROM public.tarifas WHERE id = '${idNueva}';`) === '175.00', 'el valor de la primera edición se conserva')

  // ---------------- Sesión: JWT previo al bloqueo y al cambio de rol ----------------
  const antesBloqueo = await rpc('bloqueable', 'crear_tarifa', alta('1', '2077-01-01', '2077-01-31', DEPORTE_2))
  afirmar(antesBloqueo.estado === 200, 'el DIRECTOR habilitado escribe con su JWT')
  sql(`UPDATE public.perfiles SET estado_acceso = 'BLOQUEADO' WHERE id = '${perfiles.bloqueable}';`)
  const trasBloqueo = await rpc('bloqueable', 'crear_tarifa', alta('1', '2077-02-01', '2077-02-28', DEPORTE_2))
  afirmar(trasBloqueo.estado === 403 && codigo(trasBloqueo) === '42501', `bloqueado, el MISMO JWT deja de servir (${trasBloqueo.estado} ${codigo(trasBloqueo)})`)
  const lecturaBloqueado = await rest(local, tokens.bloqueable, 'tarifas?select=id')
  afirmar(lecturaBloqueado.estado === 200 && lecturaBloqueado.cuerpo?.length === 0, 'y tampoco lee tarifas')

  const antesDegradar = await rpc('degradable', 'crear_tarifa', alta('1', '2078-01-01', '2078-01-31', DEPORTE_2))
  afirmar(antesDegradar.estado === 200, 'antes del cambio de rol, el segundo DIRECTOR escribe')
  sql(`UPDATE public.perfiles SET rol_id = ${rolId('PERSONAL')} WHERE id = '${perfiles.degradable}';`)
  const trasDegradar = await rpc('degradable', 'crear_tarifa', alta('1', '2078-02-01', '2078-02-28', DEPORTE_2))
  afirmar(trasDegradar.estado === 403 && codigo(trasDegradar) === '42501', 'con el rol cambiado a PERSONAL (mismo JWT), 403 / 42501')
  sql(`UPDATE public.perfiles SET rol_id = ${rolId('DIRECTOR')} WHERE id = '${perfiles.degradable}';`)
  const restituido = await rpc('degradable', 'crear_tarifa', alta('1', '2078-02-01', '2078-02-28', DEPORTE_2))
  afirmar(restituido.estado === 200, 'restituido el rol, el mismo JWT vuelve a escribir')

  // ---------------- Concurrencia por la Data API ----------------
  const [a, b] = await Promise.all([
    rpc('director', 'crear_tarifa', alta('300', '2079-01-01', '2079-06-30', DEPORTE_2)),
    rpc('director', 'crear_tarifa', alta('400', '2079-06-30', '2079-12-31', DEPORTE_2)),
  ])
  const estados = [a.estado, b.estado].sort()
  afirmar(estados[0] === 200 && estados[1] === 400, `dos altas solapadas simultáneas: una gana y la otra recibe error (${estados})`)
  afirmar([a, b].some((r) => codigo(r) === 'P6830'), 'la perdedora recibe P6830')
  afirmar(contarTarifas(`deporte_id = '${DEPORTE_2}' AND desde >= '2079-01-01'`) === 1, 'queda exactamente una vigencia')
}

try {
  await main()
} catch (error) {
  conteo.fallos += 1
  console.error(`FALLO  la prueba terminó con una excepción: ${error instanceof Error ? error.message : error}`)
} finally {
  try {
    limpiar()
  } catch (error) {
    console.error(`AVISO  no se pudo limpiar: ${error instanceof Error ? error.message : error}`)
  }
}

console.log(`\n${conteo.afirmaciones} afirmación(es), ${conteo.fallos} fallo(s).`)
process.exit(conteo.fallos === 0 ? 0 : 1)
