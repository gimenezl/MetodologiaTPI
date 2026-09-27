/**
 * EPT-59 — Vínculo presencial de una cuenta a un perfil existente (D5), de
 * punta a punta: API de Next, PostgreSQL, GoTrue y correo real (Mailpit).
 *
 * El servidor de Next de esta suite corre con `EPT_VINCULO_CUENTAS=habilitado`
 * y envía por SMTP a Mailpit a través de un reenviador TCP propio, que la
 * prueba puede cortar para simular un fallo de transporte. El tráfico del
 * servidor hacia Supabase pasa por un intermediario HTTP que puede perder la
 * respuesta de `createUser` después de reenviarla.
 *
 * Escenarios:
 *   A. Camino feliz: reservar → enviar → leer el código en Mailpit → verificar y
 *      crear. Mismo perfil, mismas relaciones y fichas, historial VINCULO, la
 *      contraseña elegida inicia sesión, mi_estado_acceso = HABILITADO.
 *   B. Código atado a la operación y al buzón: el código de otra operación no
 *      sirve; un código reemplazado por un reenvío no sirve; otro correo para la
 *      misma operación se rechaza.
 *   C. Código incorrecto: intentos restantes decrecientes, 5 intentos agotan el
 *      código (ni el correcto sirve después), un reenvío habilita de nuevo.
 *      Dos verificaciones simultáneas crean una sola cuenta.
 *   D. Código vencido.
 *   E. Reservas: idempotencia, operación reutilizada por otro Director, reserva
 *      en curso, dos Directores a la vez, otro Director no puede enviar ni
 *      verificar, reserva vencida, cancelación.
 *   F. Fallo de transporte SMTP: 502 y el hash queda anulado.
 *   G. Respuesta perdida de GoTrue en createUser: se reconcilia sin duplicar.
 *   H. `ept_vinculo` en user_metadata (alta pública) no enlaza nada.
 *   I. Ningún código aparece en respuestas de la API ni en el registro del
 *      servidor.
 *   J. Sin SMTP configurado: cada endpoint D5 responde 503.
 *
 *     node supabase/tests/usuarios_vinculo_cuenta.mjs
 *
 * Autosuficiente: DNI 9593xxxx, correos ept59vinc.*@ept.local, Next en 3213,
 * intermediario HTTP en 54395 y reenviador SMTP en 54396. Limpia base y buzón
 * al terminar. Solo acepta Supabase y Mailpit de bucle local.
 */

import { randomUUID } from 'node:crypto'
import net from 'node:net'
import { setTimeout as esperar } from 'node:timers/promises'
import {
  afirmar,
  api,
  conteo,
  contar,
  cookieDe,
  crearCuentaConPerfil,
  crearIntermediario,
  crearServidorNext,
  detalleTecnicoEn,
  entornoLocal,
  exigirBaseLocal,
  exigirSesion,
  iniciarSesion,
  limpiarFixture,
  puertoLibre,
  rpc,
  sql,
} from './_arnes-ept59.mjs'

const PUERTO_APP = 3213
const PUERTO_PROXY = 54395
const PUERTO_SMTP = 54396
const PREFIJO_DNI = '9593'
const PREFIJO_CORREO = 'ept59vinc.'
const DOMINIO = 'ept.local'
const CONTRASENA_DIRECCION = 'prueba-ept-59-vinculo-direccion'
const CONTRASENA_NUEVA = 'Clave-vinculo-EPT59'

const correo = (nombre) => `${PREFIJO_CORREO}${nombre}@${DOMINIO}`

const local = entornoLocal()
if (!local.MAILPIT_URL) throw new Error('la instancia local no informa MAILPIT_URL')
const MAILPIT = local.MAILPIT_URL.replace(/\/$/u, '')
const SMTP_ARRIBA = {
  host: '127.0.0.1',
  port: Number(process.env.EPT_TEST_SMTP_PORT ?? 54325),
}

const intermediario = crearIntermediario(local.API_URL)
const servidor = crearServidorNext(PUERTO_APP)

const rolId = (nombre) => Number(sql(`SELECT id FROM public.roles WHERE nombre = '${nombre}';`))

// ================================================================
// Reenviador SMTP con corte a demanda
// ================================================================
const smtp = { modo: 'normal', conexiones: new Set() }
const reenviadorSmtp = net.createServer((entrada) => {
  smtp.conexiones.add(entrada)
  entrada.on('close', () => smtp.conexiones.delete(entrada))
  if (smtp.modo === 'cortar') {
    entrada.destroy()
    return
  }
  const salida = net.connect(SMTP_ARRIBA)
  smtp.conexiones.add(salida)
  salida.on('close', () => smtp.conexiones.delete(salida))
  entrada.pipe(salida).pipe(entrada)
  entrada.on('error', () => salida.destroy())
  salida.on('error', () => entrada.destroy())
})

// ================================================================
// Mailpit
// ================================================================
async function mensajesPara(destinatario) {
  const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${destinatario}"`)}`, {
    signal: AbortSignal.timeout(5000),
  })
  if (!r.ok) throw new Error(`Mailpit no respondió la búsqueda (${r.status})`)
  return (await r.json()).messages ?? []
}

/** Espera un mensaje nuevo (no incluido en `vistos`) y devuelve su código de 6 dígitos. */
async function codigoNuevo(destinatario, vistos) {
  for (let i = 0; i < 40; i += 1) {
    const nuevo = (await mensajesPara(destinatario)).find((m) => !vistos.has(m.ID))
    if (nuevo) {
      vistos.add(nuevo.ID)
      const detalle = await fetch(`${MAILPIT}/api/v1/message/${nuevo.ID}`, { signal: AbortSignal.timeout(5000) })
      const mensaje = await detalle.json()
      const codigo = /código de verificación es: (\d{6})/u.exec(mensaje.Text ?? '')?.[1]
      if (!codigo) throw new Error('el correo no trae un código de 6 dígitos')
      return { codigo, asunto: mensaje.Subject, texto: mensaje.Text }
    }
    await esperar(250)
  }
  throw new Error('el código no llegó a Mailpit')
}

async function borrarBuzon() {
  await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${PREFIJO_CORREO}`)}`, {
    method: 'DELETE',
    signal: AbortSignal.timeout(5000),
  }).catch(() => undefined)
}

// ================================================================
// Registro de respuestas (para buscar códigos filtrados)
// ================================================================
const respuestas = []
const codigosVistos = new Set()

async function llamar(ruta, opciones) {
  const r = await api(servidor, ruta, opciones)
  respuestas.push(r.texto)
  return r
}

function exigirLimpia(etiqueta, r) {
  const filtracion = detalleTecnicoEn(r.texto)
  afirmar(!filtracion, `${etiqueta}: la respuesta no trae detalle técnico${filtracion ? ` (${filtracion})` : ''}`)
  afirmar(r.cacheControl?.includes('no-store') === true, `${etiqueta}: Cache-Control: no-store`)
}

const otroCodigo = (codigo) => String((Number(codigo) + 1) % 1_000_000).padStart(6, '0')

// ================================================================
// Fixture
// ================================================================
const P = (n) => `f5930000-0000-4000-8000-0000000000${n}`
const LEGAJOS = {
  hijo: { id: P('10'), dni: '95930010', rol: 'ESTUDIANTE', legajo: 'LEG-EPT59-VINC-HIJO' },
  padre: { id: P('11'), dni: '95930011', rol: 'PADRE' },
  intentos: { id: P('12'), dni: '95930012', rol: 'PERSONAL' },
  vencido: { id: P('13'), dni: '95930013', rol: 'PERSONAL' },
  reservas: { id: P('14'), dni: '95930014', rol: 'PERSONAL' },
  reservaVencida: { id: P('15'), dni: '95930015', rol: 'PERSONAL' },
  transporte: { id: P('16'), dni: '95930016', rol: 'PERSONAL' },
  docente: { id: P('17'), dni: '95930017', rol: 'DOCENTE', legajo: 'LEG-EPT59-VINC-DOC' },
  otraOperacion: { id: P('18'), dni: '95930018', rol: 'PERSONAL' },
  metadatos: { id: P('19'), dni: '95930019', rol: 'PERSONAL' },
  sinRol: { id: P('20'), dni: '95930020', rol: null },
}

const direccion = {}

async function sembrar() {
  for (const [clave, dni] of [['a', '95930001'], ['b', '95930002']]) {
    const email = correo(`director${clave}`)
    await crearCuentaConPerfil(local, {
      email,
      password: CONTRASENA_DIRECCION,
      perfil: { nombre: 'Prueba', apellido: `VinculoDirector${clave.toUpperCase()}`, dni, rol_id: rolId('DIRECTOR') },
    })
    const sesion = await exigirSesion(local, email, CONTRASENA_DIRECCION)
    direccion[clave] = {
      cookie: cookieDe(sesion),
      token: sesion.access_token,
      perfil: sql(`SELECT id FROM public.perfiles WHERE dni = '${dni}';`),
    }
  }

  const filas = Object.values(LEGAJOS).map((l) =>
    `('${l.id}', ${l.rol ? `(SELECT id FROM public.roles WHERE nombre = '${l.rol}')` : 'NULL'}, 'Prueba', 'Vinculo', '${l.dni}', ${l.legajo ? `'${l.legajo}'` : 'NULL'})`)
  sql(`BEGIN;
       INSERT INTO public.perfiles (id, rol_id, nombre, apellido, dni, legajo_nro) VALUES ${filas.join(',\n')};
       INSERT INTO public.padres_hijos (padre_id, hijo_id) VALUES ('${LEGAJOS.padre.id}', '${LEGAJOS.hijo.id}');
       COMMIT;`)
}

const reservar = (quien, legajo, extra = {}) => {
  const cuerpo = {
    operacion_id: randomUUID(),
    perfil_id: legajo.id,
    dni: legajo.dni,
    modalidad: 'TITULAR',
    documento_verificado: true,
    ...extra,
  }
  return llamar('/api/usuarios/vinculos', { method: 'POST', cookie: direccion[quien].cookie, body: cuerpo })
    .then((r) => ({ ...r, operacion: cuerpo.operacion_id, cuerpoEnviado: cuerpo }))
}

const enviar = (quien, operacion, email) =>
  llamar(`/api/usuarios/vinculos/${operacion}/desafio`, { method: 'POST', cookie: direccion[quien].cookie, body: { correo: email } })

const verificar = (quien, operacion, codigo, contrasena = CONTRASENA_NUEVA) =>
  llamar(`/api/usuarios/vinculos/${operacion}/verificacion`, {
    method: 'POST', cookie: direccion[quien].cookie, body: { codigo, contrasena },
  })

const consultar = (quien, operacion) =>
  llamar(`/api/usuarios/vinculos/${operacion}`, { cookie: direccion[quien].cookie })

const reserva = (operacion) =>
  sql(`SELECT row_to_json(v)::text FROM (SELECT estado, cuenta_id, correo, desafio_hash IS NULL AS sin_hash,
         desafio_intentos, desafios_emitidos, correo_verificado_en IS NOT NULL AS verificado
       FROM app_private.vinculos_cuenta WHERE operacion_id = '${operacion}') v;`)
const datosReserva = (operacion) => JSON.parse(reserva(operacion) || 'null')

const cuentasCon = (email) => contar(`FROM auth.users WHERE lower(email) = lower('${email}')`)
const usuarioDe = (perfil) => sql(`SELECT COALESCE(user_id::text, '') FROM public.perfiles WHERE id = '${perfil}';`)

// ================================================================
// Escenarios
// ================================================================
async function escenarioFeliz() {
  const legajo = LEGAJOS.padre
  const email = correo('padre')
  const huellaRelaciones = sql(`SELECT md5(string_agg(row_to_json(h)::text, '|')) FROM public.padres_hijos h WHERE padre_id = '${legajo.id}';`)

  const r1 = await reservar('a', legajo)
  afirmar(r1.estado === 201 && r1.cuerpo?.estado === 'PENDIENTE' && r1.cuerpo?.desafio_emitido === false,
    `A: la reserva nueva responde 201 PENDIENTE (${r1.estado})`)
  exigirLimpia('A-reserva', r1)
  afirmar(!('cuenta_id' in (r1.cuerpo ?? {})), 'A: la reserva no expone cuenta_id')

  const repetida = await llamar('/api/usuarios/vinculos', { method: 'POST', cookie: direccion.a.cookie, body: r1.cuerpoEnviado })
  afirmar(repetida.estado === 200 && repetida.cuerpo?.operacion_id === r1.operacion, `A: reintentar la misma reserva responde 200 (${repetida.estado})`)

  const envio = await enviar('a', r1.operacion, email)
  afirmar(envio.estado === 202 && envio.cuerpo?.enviado === true && envio.cuerpo?.correo_enmascarado === 'e***@ept.local',
    `A: el envío responde 202 con el correo enmascarado (${envio.estado})`)
  exigirLimpia('A-envio', envio)
  afirmar(!('codigo' in (envio.cuerpo ?? {})), 'A: la respuesta del envío no trae el código')

  const vistos = new Set()
  const { codigo, asunto, texto } = await codigoNuevo(email, vistos)
  codigosVistos.add(codigo)
  afirmar(asunto === 'Código de verificación — Educar para Transformar' &&
    texto.includes('Si no estás realizando este trámite en la escuela, ignorá este mensaje.') && /vence a las \d{2}:\d{2}/u.test(texto),
    'A: el correo trae asunto, vencimiento y aviso en español')
  afirmar(datosReserva(r1.operacion)?.sin_hash === false && !reserva(r1.operacion).includes(codigo),
    'A: la base guarda un hash, nunca el código')

  const final = await verificar('a', r1.operacion, codigo)
  afirmar(final.estado === 201 && final.cuerpo?.vinculado === true && final.cuerpo?.perfil_id === legajo.id,
    `A: verificar crea la cuenta enlazada al mismo perfil (${final.estado})`)
  exigirLimpia('A-verificacion', final)

  const datos = datosReserva(r1.operacion)
  afirmar(datos.estado === 'COMPLETADA' && usuarioDe(legajo.id) === datos.cuenta_id && cuentasCon(email) === 1,
    'A: una sola cuenta, con el id reservado, enlazada al perfil existente')
  afirmar(contar(`FROM public.perfiles WHERE dni = '${legajo.dni}'`) === 1 &&
    sql(`SELECT md5(string_agg(row_to_json(h)::text, '|')) FROM public.padres_hijos h WHERE padre_id = '${legajo.id}';`) === huellaRelaciones,
    'A: el perfil conserva su id y sus vínculos familiares')
  afirmar(contar(`FROM public.perfiles_historial WHERE perfil_id = '${legajo.id}' AND tipo = 'VINCULO'
                  AND operacion_id = '${r1.operacion}' AND actor_perfil_id = '${direccion.a.perfil}'`) === 1,
    'A: el historial registra el VINCULO con la operación y la Dirección que lo hizo')
  afirmar(sql(`SELECT (raw_app_meta_data ? 'ept_vinculo')::text || ',' || (email_confirmed_at IS NOT NULL)::text
               FROM auth.users WHERE id = '${datos.cuenta_id}';`) === 'false,true',
    'A: la cuenta no conserva el pedido de vínculo y tiene el correo confirmado')

  const ingreso = await iniciarSesion(local, email, CONTRASENA_NUEVA)
  afirmar(ingreso.estado === 200, `A: la persona inicia sesión con la contraseña que eligió (${ingreso.estado})`)
  afirmar((await rpc(local, ingreso.sesion.access_token, 'mi_estado_acceso')).cuerpo === 'HABILITADO' &&
    (await rpc(local, ingreso.sesion.access_token, 'rol_actual')).cuerpo === 'PADRE',
    'A: mi_estado_acceso = HABILITADO y conserva el rol PADRE')

  const otra = await verificar('a', r1.operacion, codigo)
  afirmar(otra.estado === 200 && otra.cuerpo?.vinculado === true && cuentasCon(email) === 1,
    `A: reutilizar el código de una operación completada responde 200 sin crear otra cuenta (${otra.estado})`)
  const estado = await consultar('a', r1.operacion)
  afirmar(estado.estado === 200 && estado.cuerpo?.estado === 'COMPLETADA' && estado.cuerpo?.vinculado === true,
    'A: la consulta informa COMPLETADA y vinculado')
  const cancelar = await llamar(`/api/usuarios/vinculos/${r1.operacion}/cancelacion`, { method: 'POST', cookie: direccion.a.cookie })
  afirmar(cancelar.estado === 409 && cancelar.cuerpo?.codigo === 'RESERVA_NO_VIGENTE', `A: una vinculación completada no se cancela (${cancelar.estado})`)
  const detalle = await llamar(`/api/usuarios/${legajo.id}`, { cookie: direccion.a.cookie })
  afirmar(detalle.estado === 200 && detalle.cuerpo?.tiene_cuenta === true && detalle.cuerpo?.vinculo_disponible === true &&
    detalle.cuerpo?.puede_vincular === false, 'A: el detalle muestra la cuenta y vinculo_disponible=true')

  // Reglas de la reserva.
  let r = await reservar('a', legajo)
  afirmar(r.estado === 409 && r.cuerpo?.codigo === 'CUENTA_EXISTENTE', `A: un perfil con cuenta no se reserva (${r.estado})`)
  r = await reservar('a', LEGAJOS.intentos, { dni: '95939999' })
  afirmar(r.estado === 422 && r.cuerpo?.codigo === 'DNI_NO_COINCIDE', `A: un DNI distinto del legajo es 422 (${r.estado})`)
  r = await reservar('a', LEGAJOS.sinRol)
  afirmar(r.estado === 422 && r.cuerpo?.codigo === 'ROL_SIN_VINCULO', `A: un legajo sin rol no se vincula (${r.estado})`)
  r = await reservar('a', LEGAJOS.intentos, { documento_verificado: false })
  afirmar(r.estado === 422 && r.cuerpo?.codigo === 'RESERVA_INVALIDA', `A: sin constancia del documento es 422 (${r.estado})`)
  r = await reservar('a', LEGAJOS.intentos, { modalidad: 'REPRESENTANTE' })
  afirmar(r.estado === 422 && r.cuerpo?.codigo === 'RESERVA_INVALIDA', `A: un representante sin DNI es 422 (${r.estado})`)
  r = await reservar('a', { id: direccion.b.perfil, dni: '95930002' })
  afirmar(r.estado === 409 && r.cuerpo?.codigo === 'CUENTA_EXISTENTE', `A: un Director con cuenta no se reserva (${r.estado})`)
}

async function escenarioOperacionYBuzon() {
  // Operación X (intentos) y operación Y (otraOperacion), cada una con su buzón.
  const x = await reservar('a', LEGAJOS.otraOperacion)
  const y = await reservar('a', LEGAJOS.metadatos, { modalidad: 'REPRESENTANTE', representante_dni: '95930099' })
  afirmar(x.estado === 201 && y.estado === 201, 'B: dos operaciones reservadas (una por representante)')
  const buzonX = correo('buzonx')
  const buzonY = correo('buzony')
  await enviar('a', x.operacion, buzonX)
  await enviar('a', y.operacion, buzonY)
  const vistos = new Set()
  const cx = (await codigoNuevo(buzonX, vistos)).codigo
  const cy = (await codigoNuevo(buzonY, vistos)).codigo
  codigosVistos.add(cx)
  codigosVistos.add(cy)

  let r = cx === cy ? null : await verificar('a', y.operacion, cx)
  afirmar(r === null || (r.estado === 422 && r.cuerpo?.codigo === 'CODIGO_INCORRECTO' && r.cuerpo?.intentos_restantes === 4),
    `B: el código del buzón X no sirve para la operación Y (${r?.estado ?? 'códigos iguales por azar'})`)
  afirmar(cuentasCon(buzonX) === 0 && cuentasCon(buzonY) === 0 && usuarioDe(LEGAJOS.metadatos.id) === '', 'B: no se creó ninguna cuenta')

  r = await enviar('a', x.operacion, correo('otrobuzon'))
  afirmar(r.estado === 409 && r.cuerpo?.codigo === 'CORREO_DISTINTO', `B: la operación no acepta otro correo (${r.estado})`)

  // Un código reemplazado por un reenvío deja de servir.
  r = await enviar('a', x.operacion, buzonX)
  const cx2 = (await codigoNuevo(buzonX, vistos)).codigo
  codigosVistos.add(cx2)
  if (cx2 !== cx) {
    r = await verificar('a', x.operacion, cx)
    afirmar(r.estado === 422 && r.cuerpo?.codigo === 'CODIGO_INCORRECTO', `B: el código anterior al reenvío ya no sirve (${r.estado})`)
  }
  r = await verificar('a', x.operacion, cx2)
  afirmar(r.estado === 201 && usuarioDe(LEGAJOS.otraOperacion.id) === datosReserva(x.operacion).cuenta_id,
    `B: el código vigente del buzón correcto sí vincula (${r.estado})`)

  // El correo de X ya está en uso: Y no puede usarlo.
  r = await llamar('/api/usuarios/vinculos', {
    method: 'POST', cookie: direccion.a.cookie,
    body: { operacion_id: randomUUID(), perfil_id: LEGAJOS.intentos.id, dni: LEGAJOS.intentos.dni, modalidad: 'TITULAR', documento_verificado: true },
  })
  const z = r.cuerpo?.operacion_id
  r = await enviar('a', z, buzonX)
  afirmar(r.estado === 409 && r.cuerpo?.codigo === 'CORREO_EN_USO', `B: un correo con cuenta no recibe códigos (${r.estado})`)
  await llamar(`/api/usuarios/vinculos/${z}/cancelacion`, { method: 'POST', cookie: direccion.a.cookie })
  return { y }
}

async function escenarioIntentos() {
  const legajo = LEGAJOS.intentos
  const email = correo('intentos')
  const op = await reservar('a', legajo)
  afirmar(op.estado === 201, `C: reserva (${op.estado})`)
  const vistos = new Set()
  await enviar('a', op.operacion, email)
  const { codigo } = await codigoNuevo(email, vistos)
  codigosVistos.add(codigo)

  const restantes = []
  for (let i = 0; i < 5; i += 1) {
    const r = await verificar('a', op.operacion, otroCodigo(codigo))
    restantes.push(`${r.estado}:${r.cuerpo?.intentos_restantes}`)
    if (i === 0) exigirLimpia('C-incorrecto', r)
  }
  afirmar(restantes.join(',') === '422:4,422:3,422:2,422:1,422:0', `C: cada código incorrecto descuenta un intento (${restantes.join(',')})`)
  let r = await verificar('a', op.operacion, codigo)
  afirmar(r.estado === 429 && r.cuerpo?.codigo === 'CODIGO_SIN_INTENTOS', `C: agotados los intentos, ni el código correcto sirve (${r.estado})`)
  afirmar(cuentasCon(email) === 0 && datosReserva(op.operacion).sin_hash === true, 'C: no hay cuenta y el hash quedó anulado')

  r = await enviar('a', op.operacion, email)
  afirmar(r.estado === 202, `C: un reenvío habilita un código nuevo (${r.estado})`)
  const nuevo = (await codigoNuevo(email, vistos)).codigo
  codigosVistos.add(nuevo)

  // Doble envío simultáneo de la verificación: una sola cuenta.
  const [v1, v2] = await Promise.all([verificar('a', op.operacion, nuevo), verificar('a', op.operacion, nuevo)])
  afirmar([v1.estado, v2.estado].every((e) => e === 200 || e === 201) && [v1.estado, v2.estado].includes(201),
    `C: dos verificaciones simultáneas terminan bien (${v1.estado}, ${v2.estado})`)
  afirmar(cuentasCon(email) === 1 && usuarioDe(legajo.id) === datosReserva(op.operacion).cuenta_id,
    'C: exactamente una cuenta, enlazada al perfil')
}

async function escenarioCodigoVencido() {
  const legajo = LEGAJOS.vencido
  const email = correo('vencido')
  const op = await reservar('a', legajo)
  await enviar('a', op.operacion, email)
  const { codigo } = await codigoNuevo(email, new Set())
  codigosVistos.add(codigo)
  sql(`UPDATE app_private.vinculos_cuenta SET desafio_vence_en = now() - interval '1 second'
       WHERE operacion_id = '${op.operacion}';`)
  let r = await verificar('a', op.operacion, codigo)
  afirmar(r.estado === 409 && r.cuerpo?.codigo === 'CODIGO_VENCIDO', `D: un código vencido es 409 CODIGO_VENCIDO (${r.estado})`)
  exigirLimpia('D-vencido', r)
  r = await verificar('a', op.operacion, codigo)
  afirmar(r.estado === 409 && r.cuerpo?.codigo === 'SIN_CODIGO_VIGENTE', `D: después, no hay código vigente (${r.estado})`)
  afirmar(cuentasCon(email) === 0 && usuarioDe(legajo.id) === '', 'D: no se creó ninguna cuenta')
}

async function escenarioReservas() {
  const legajo = LEGAJOS.reservas

  // Dos Directores a la vez sobre el mismo perfil.
  const [ra, rb] = await Promise.all([reservar('a', legajo), reservar('b', legajo)])
  const estados = [ra.estado, rb.estado].sort().join(',')
  afirmar(estados === '201,409' && [ra, rb].some((r) => r.cuerpo?.codigo === 'RESERVA_EN_CURSO'),
    `E: dos Directores a la vez: una reserva y un 409 RESERVA_EN_CURSO (${estados})`)
  afirmar(contar(`FROM app_private.vinculos_cuenta WHERE perfil_id = '${legajo.id}'`) === 1, 'E: quedó una sola reserva')
  const ganadora = ra.estado === 201 ? ra : rb
  const duena = ra.estado === 201 ? 'a' : 'b'
  const ajena = duena === 'a' ? 'b' : 'a'

  let r = await llamar('/api/usuarios/vinculos', { method: 'POST', cookie: direccion[ajena].cookie, body: ganadora.cuerpoEnviado })
  afirmar(r.estado === 409 && r.cuerpo?.codigo === 'RESERVA_REUTILIZADA', `E: otro Director no puede reutilizar la operación (${r.estado})`)
  r = await reservar(duena, legajo)
  afirmar(r.estado === 409 && r.cuerpo?.codigo === 'RESERVA_EN_CURSO', `E: una segunda operación sobre el mismo perfil es 409 (${r.estado})`)

  r = await enviar(ajena, ganadora.operacion, correo('reservas'))
  afirmar(r.estado === 409 && r.cuerpo?.codigo === 'RESERVA_DE_OTRO_DIRECTOR', `E: otro Director no puede enviar el código (${r.estado})`)
  r = await verificar(ajena, ganadora.operacion, '123456')
  afirmar(r.estado === 409 && r.cuerpo?.codigo === 'RESERVA_DE_OTRO_DIRECTOR', `E: otro Director no puede verificar (${r.estado})`)
  afirmar(datosReserva(ganadora.operacion).desafios_emitidos === 0, 'E: el intento ajeno no emitió ningún código')

  r = await consultar(ajena, ganadora.operacion)
  afirmar(r.estado === 200 && r.cuerpo?.estado === 'PENDIENTE', 'E: cualquier Director habilitado puede consultar')
  r = await consultar(duena, randomUUID())
  afirmar(r.estado === 404 && r.cuerpo?.codigo === 'RESERVA_INEXISTENTE', `E: una operación inexistente es 404 (${r.estado})`)

  // Cancelación idempotente.
  r = await llamar(`/api/usuarios/vinculos/${ganadora.operacion}/cancelacion`, { method: 'POST', cookie: direccion[duena].cookie })
  afirmar(r.estado === 200 && r.cuerpo?.estado === 'CANCELADA', `E: cancelar deja la reserva CANCELADA (${r.estado})`)
  r = await llamar(`/api/usuarios/vinculos/${ganadora.operacion}/cancelacion`, { method: 'POST', cookie: direccion[duena].cookie })
  afirmar(r.estado === 200 && r.cuerpo?.estado === 'CANCELADA', 'E: cancelar dos veces es idempotente')
  r = await enviar(duena, ganadora.operacion, correo('reservas'))
  afirmar(r.estado === 409 && r.cuerpo?.codigo === 'RESERVA_NO_VIGENTE', `E: una reserva cancelada no envía códigos (${r.estado})`)
  afirmar(contar(`FROM app_private.vinculos_cuenta WHERE perfil_id = '${legajo.id}'`) === 1, 'E: cancelar no borra la reserva')

  // Reserva vencida.
  const vencida = await reservar('a', LEGAJOS.reservaVencida)
  sql(`UPDATE app_private.vinculos_cuenta SET vence_en = now() - interval '1 minute' WHERE operacion_id = '${vencida.operacion}';`)
  r = await consultar('a', vencida.operacion)
  afirmar(r.estado === 200 && r.cuerpo?.estado === 'VENCIDA', 'E: una reserva vencida se informa VENCIDA')
  r = await enviar('a', vencida.operacion, correo('vencida'))
  afirmar(r.estado === 409 && r.cuerpo?.codigo === 'RESERVA_NO_VIGENTE', `E: una reserva vencida no envía códigos (${r.estado})`)
  r = await llamar('/api/usuarios/vinculos', { method: 'POST', cookie: direccion.a.cookie, body: vencida.cuerpoEnviado })
  afirmar(r.estado === 409 && r.cuerpo?.codigo === 'RESERVA_VENCIDA', `E: reintentar una reserva vencida es 409 RESERVA_VENCIDA (${r.estado})`)
  r = await reservar('a', LEGAJOS.reservaVencida)
  afirmar(r.estado === 201, `E: vencida la anterior, una operación nueva se reserva (${r.estado})`)
  await llamar(`/api/usuarios/vinculos/${r.operacion}/cancelacion`, { method: 'POST', cookie: direccion.a.cookie })
}

async function escenarioTransporte() {
  const legajo = LEGAJOS.transporte
  const email = correo('transporte')
  const op = await reservar('a', legajo)
  smtp.modo = 'cortar'
  let r = await enviar('a', op.operacion, email)
  smtp.modo = 'normal'
  afirmar(r.estado === 502 && r.cuerpo?.codigo === 'ENVIO_FALLIDO', `F: si el SMTP falla, el envío responde 502 ENVIO_FALLIDO (${r.estado})`)
  exigirLimpia('F-envio-fallido', r)
  const datos = datosReserva(op.operacion)
  afirmar(datos.sin_hash === true && datos.desafios_emitidos === 1, 'F: el hash del código no enviado quedó anulado')
  afirmar((await mensajesPara(email)).length === 0, 'F: no llegó ningún correo')
  r = await verificar('a', op.operacion, '000000')
  afirmar(r.estado === 409 && r.cuerpo?.codigo === 'SIN_CODIGO_VIGENTE', `F: no hay código vigente que adivinar (${r.estado})`)
  r = await enviar('a', op.operacion, email)
  afirmar(r.estado === 202, `F: con el SMTP restablecido, el reenvío funciona (${r.estado})`)
  codigosVistos.add((await codigoNuevo(email, new Set())).codigo)
  await llamar(`/api/usuarios/vinculos/${op.operacion}/cancelacion`, { method: 'POST', cookie: direccion.a.cookie })
}

async function escenarioRespuestaPerdida() {
  const legajo = LEGAJOS.docente
  const email = correo('docente')
  const huellaFicha = sql(`SELECT md5(row_to_json(f)::text) FROM public.profesores f WHERE perfil_id = '${legajo.id}';`)
  afirmar(huellaFicha !== '', 'G: el legajo DOCENTE tiene su ficha')
  const op = await reservar('a', legajo)
  await enviar('a', op.operacion, email)
  const { codigo } = await codigoNuevo(email, new Set())
  codigosVistos.add(codigo)

  const perdida = intermediario.planear('perder-respuesta',
    (p) => p.metodo === 'POST' && p.ruta === '/auth/v1/admin/users')
  const r = await verificar('a', op.operacion, codigo)
  const estadoArriba = await perdida
  afirmar(estadoArriba === 200, `G: GoTrue confirmó la cuenta aunque la respuesta se perdió (${estadoArriba})`)
  afirmar(r.estado === 201 && r.cuerpo?.vinculado === true && r.cuerpo?.reconciliado === true,
    `G: el servidor reconcilia y responde 201 reconciliado (${r.estado})`)
  const datos = datosReserva(op.operacion)
  afirmar(cuentasCon(email) === 1 && usuarioDe(legajo.id) === datos.cuenta_id && datos.estado === 'COMPLETADA',
    'G: exactamente una cuenta con ese correo y perfil.user_id = cuenta_id')
  afirmar(sql(`SELECT md5(row_to_json(f)::text) FROM public.profesores f WHERE perfil_id = '${legajo.id}';`) === huellaFicha,
    'G: la ficha de profesor quedó intacta')
  afirmar((await iniciarSesion(local, email, CONTRASENA_NUEVA)).estado === 200, 'G: la cuenta reconciliada inicia sesión')
  const otra = await verificar('a', op.operacion, codigo)
  afirmar(otra.estado === 200 && cuentasCon(email) === 1, `G: reintentar después responde 200 sin duplicar (${otra.estado})`)
}

async function escenarioMetadatosPublicos(y) {
  // Y quedó PENDIENTE sin verificar desde B. Un alta pública con
  // `ept_vinculo` en user_metadata no puede enlazarla.
  const email = correo('publico')
  const respuesta = await fetch(`${local.API_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: local.ANON_KEY },
    body: JSON.stringify({ email, password: CONTRASENA_NUEVA, data: { ept_vinculo: { operacion_id: y.operacion } } }),
    signal: AbortSignal.timeout(10_000),
  })
  await respuesta.arrayBuffer()
  afirmar(usuarioDe(LEGAJOS.metadatos.id) === '' && datosReserva(y.operacion).estado === 'PENDIENTE',
    `H: ept_vinculo en user_metadata no enlaza ni completa nada (alta pública ${respuesta.status})`)
  afirmar(contar(`FROM auth.users WHERE email = '${email}' AND raw_app_meta_data ? 'ept_vinculo'`) === 0,
    'H: user_metadata nunca llega a app_metadata')
  await llamar(`/api/usuarios/vinculos/${y.operacion}/cancelacion`, { method: 'POST', cookie: direccion.a.cookie })
}

/**
 * Quita marcas de tiempo (sus microsegundos son seis dígitos) e identificadores
 * UUID antes de buscar códigos: así una coincidencia es una filtración real y
 * no el azar de un timestamp.
 */
const sinRuido = (texto) => texto
  .replace(/\d{4}-\d{2}-\d{2}[T ][\d:.]+(?:Z|[+-]\d{2}(?::?\d{2})?)?/gu, '<fecha>')
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu, '<uuid>')

function escenarioSinFiltraciones() {
  const codigos = [...codigosVistos]
  afirmar(codigos.length >= 8, `I: se observaron ${codigos.length} códigos reales en Mailpit`)
  const textos = respuestas.map(sinRuido)
  const registro = sinRuido(servidor.registro)
  const enRespuestas = codigos.filter((c) => textos.some((t) => t.includes(c)))
  afirmar(enRespuestas.length === 0, `I: ningún código aparece en ${respuestas.length} respuestas de la API`)
  const enRegistro = codigos.filter((c) => registro.includes(c))
  afirmar(enRegistro.length === 0, `I: ningún código aparece en el registro del servidor (${servidor.registro.length} caracteres)`)
  afirmar(!servidor.registro.includes(`${PREFIJO_CORREO}`), 'I: el registro del servidor no trae correos de la suite')
}

async function escenarioSinSmtp() {
  await servidor.detener()
  await servidor.iniciar({
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${PUERTO_PROXY}`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: local.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY,
    EPT_VINCULO_CUENTAS: 'habilitado',
    // Sin EPT_SMTP_HOST: la bandera sola no alcanza.
    EPT_SMTP_REMITENTE: 'Educar para Transformar <no-responder@ept.local>',
  })
  const operacion = randomUUID()
  const pedidos = [
    ['POST', '/api/usuarios/vinculos', { operacion_id: operacion, perfil_id: LEGAJOS.vencido.id, dni: LEGAJOS.vencido.dni, modalidad: 'TITULAR', documento_verificado: true }],
    ['GET', `/api/usuarios/vinculos/${operacion}`],
    ['POST', `/api/usuarios/vinculos/${operacion}/desafio`, { correo: correo('sinsmtp') }],
    ['POST', `/api/usuarios/vinculos/${operacion}/verificacion`, { codigo: '123456', contrasena: CONTRASENA_NUEVA }],
    ['POST', `/api/usuarios/vinculos/${operacion}/cancelacion`],
  ]
  for (const [method, ruta, body] of pedidos) {
    const r = await llamar(ruta, { method, cookie: direccion.a.cookie, body })
    afirmar(r.estado === 503 && r.cuerpo?.codigo === 'VINCULO_DESHABILITADO', `J: sin SMTP, ${method} ${ruta.replace(operacion, ':op')} responde 503 (${r.estado})`)
  }
  const detalle = await llamar(`/api/usuarios/${LEGAJOS.vencido.id}`, { cookie: direccion.a.cookie })
  afirmar(detalle.estado === 200 && detalle.cuerpo?.vinculo_disponible === false, 'J: el detalle informa vinculo_disponible=false')
  afirmar(contar(`FROM app_private.vinculos_cuenta WHERE operacion_id = '${operacion}'`) === 0, 'J: no se reservó nada')
  const sinSesion = await llamar('/api/usuarios/vinculos', { method: 'POST', body: {} })
  afirmar(sinSesion.estado === 401, `J: sin sesión, la guarda responde antes que la bandera (${sinSesion.estado})`)
  for (const [metodo, ruta] of [['GET', '/api/usuarios/vinculos'], ['DELETE', `/api/usuarios/vinculos/${operacion}`], ['GET', `/api/usuarios/vinculos/${operacion}/desafio`]]) {
    const r = await llamar(ruta, { method: metodo, cookie: direccion.a.cookie })
    afirmar(r.estado === 405, `J: ${metodo} ${ruta.replace(operacion, ':op')} responde 405 (${r.estado})`)
  }
}

// ================================================================
// Arranque y cierre
// ================================================================
const LIMPIEZA = { prefijoDni: PREFIJO_DNI, prefijoCorreo: PREFIJO_CORREO, dominio: DOMINIO }

try {
  exigirBaseLocal()
  for (const puerto of [PUERTO_PROXY, PUERTO_SMTP]) {
    if (!(await puertoLibre(puerto))) throw new Error(`el puerto ${puerto} ya está ocupado`)
  }
  limpiarFixture(LIMPIEZA)
  await borrarBuzon()
  await sembrar()
  await intermediario.escuchar(PUERTO_PROXY)
  await new Promise((resolver, rechazar) => {
    reenviadorSmtp.once('error', rechazar)
    reenviadorSmtp.listen(PUERTO_SMTP, '127.0.0.1', resolver)
  })
  await servidor.iniciar({
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${PUERTO_PROXY}`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: local.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY,
    EPT_VINCULO_CUENTAS: 'habilitado',
    EPT_SMTP_HOST: '127.0.0.1',
    EPT_SMTP_PORT: String(PUERTO_SMTP),
    EPT_SMTP_SECURE: 'false',
    EPT_SMTP_REMITENTE: 'Educar para Transformar <no-responder@ept.local>',
  })
  console.log(`Instancia local verificada; aplicación en ${servidor.url}`)

  await escenarioFeliz()
  const { y } = await escenarioOperacionYBuzon()
  await escenarioIntentos()
  await escenarioCodigoVencido()
  await escenarioReservas()
  await escenarioTransporte()
  await escenarioRespuestaPerdida()
  await escenarioMetadatosPublicos(y)
  escenarioSinFiltraciones()
  await escenarioSinSmtp()
  afirmar(intermediario.pendientes() === 0, 'todas las fallas planeadas se aplicaron')
  afirmar(contar(`FROM auth.users u LEFT JOIN public.perfiles p ON p.user_id = u.id
                  WHERE u.email LIKE '${PREFIJO_CORREO}%@${DOMINIO}' AND p.id IS NULL AND u.email <> '${correo('publico')}'`) === 0,
    'ninguna cuenta de la suite quedó sin perfil')
} catch (error) {
  conteo.fallos += 1
  console.error(`FALLO  ${error instanceof Error ? error.message : String(error)}`)
  if (servidor.registro) console.error(servidor.registro.slice(-3000).replace(/\b\d{6}\b/gu, '######'))
} finally {
  await servidor.detener()
  intermediario.descartarPlanes()
  await intermediario.cerrar()
  for (const conexion of smtp.conexiones) conexion.destroy()
  await new Promise((resolver) => reenviadorSmtp.close(() => resolver()))
  try {
    limpiarFixture(LIMPIEZA)
  } catch (error) {
    conteo.fallos += 1
    console.error(`FALLO  la limpieza no terminó: ${error instanceof Error ? error.message : String(error)}`)
  }
  await borrarBuzon()
  afirmar(
    contar(`FROM auth.users WHERE email LIKE '${PREFIJO_CORREO}%@${DOMINIO}'`) === 0 &&
      contar(`FROM public.perfiles WHERE dni LIKE '${PREFIJO_DNI}%'`) === 0 &&
      contar(`FROM app_private.vinculos_cuenta v LEFT JOIN public.perfiles p ON p.id = v.perfil_id WHERE p.id IS NULL`) === 0,
    'la base quedó sin datos de la suite'
  )
  afirmar(await puertoLibre(PUERTO_APP), `el puerto ${PUERTO_APP} quedó libre`)
  console.log(`\n${conteo.afirmaciones} afirmaciones, ${conteo.fallos} incumplida(s).`)
  process.exitCode = conteo.fallos > 0 ? 1 : 0
}
