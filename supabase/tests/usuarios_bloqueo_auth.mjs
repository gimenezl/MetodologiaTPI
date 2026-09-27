/**
 * EPT-59 — Bloqueo de acceso contra la Auth y el PostgREST reales.
 *
 * Lo que ninguna prueba SQL puede mostrar: qué hace un JWT emitido ANTES del
 * bloqueo. GoTrue sigue firmando ese JWT como válido hasta que vence y
 * PostgREST lo acepta; la barrera tiene que estar en PostgreSQL.
 *
 *   1. Para cada uno de los cinco roles: se inicia sesión, se mide lo que ese
 *      JWT puede leer, una Dirección lo bloquea por la RPC y se reutiliza el
 *      MISMO JWT: cero filas protegidas, superficies públicas idénticas a
 *      `anon`, RPC de rol vacías y `mi_estado_acceso` = BLOQUEADO. Después se
 *      banea en Auth: el inicio de sesión y la renovación fallan.
 *   2. Bloquear no altera fichas, matrículas ni vínculos familiares.
 *   3. Baneo parcial (la base bloqueó y Auth no): la base sigue negando todo, las
 *      guardas del servidor responden ACCESO_BLOQUEADO y
 *      `…/acceso/sincronizar` lo repara. El fallo se inyecta con un
 *      intermediario delante de Auth.
 *   4. Reactivación: si Auth no levanta el baneo, 503 sin tocar la base; con Auth
 *      habilitado y la base todavía bloqueada, sigue sin acceso; recién la RPC
 *      lo devuelve. Si la RPC falla después de levantar el baneo, se vuelve a
 *      banear. Un valor esperado obsoleto responde 409 sin tocar Auth.
 *   5. Inactivar la ficha de un alumno o de un profesor no bloquea el ingreso.
 *   6. Humo de la API de Usuarios: listado, detalle, datos personales, rol,
 *      historial, 401/403, `Cache-Control: no-store` y 405 automáticos.
 *
 *     node supabase/tests/usuarios_bloqueo_auth.mjs
 *
 * Autosuficiente: siembra su fixture (DNI 9592xxxx, correos
 * ept59bloq.*@ept.local), levanta Next en el puerto 3212 con el tráfico a
 * Supabase por un intermediario en 54397 y limpia todo al terminar. Solo acepta
 * una instancia de Supabase de bucle local.
 */

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
  renovarSesion,
  rest,
  rpc,
  sql,
} from './_arnes-ept59.mjs'

const PUERTO_APP = 3212
const PUERTO_PROXY = 54397
const PREFIJO_DNI = '9592'
const PREFIJO_CORREO = 'ept59bloq.'
const DOMINIO = 'ept.local'
const CURSO = 'Curso bloqueo EPT59'
const CONTRASENA = 'prueba-ept-59-bloqueo'
const MOTIVO = 'Prueba automatizada de bloqueo EPT-59'

const correo = (nombre) => `${PREFIJO_CORREO}${nombre}@${DOMINIO}`

const PERSONAS = {
  directora: { email: correo('directora'), dni: '95920001', rol: 'DIRECTOR', apellido: 'Directora' },
  director: { email: correo('director'), dni: '95920002', rol: 'DIRECTOR', apellido: 'Director' },
  docente: { email: correo('docente'), dni: '95920003', rol: 'DOCENTE', apellido: 'Docente', legajo_nro: 'LEG-EPT59-BLOQ-DOC' },
  padre: { email: correo('padre'), dni: '95920004', rol: 'PADRE', apellido: 'Padre' },
  estudiante: { email: correo('estudiante'), dni: '95920005', rol: 'ESTUDIANTE', apellido: 'Estudiante', legajo_nro: 'LEG-EPT59-BLOQ-EST' },
  personal: { email: correo('personal'), dni: '95920006', rol: 'PERSONAL', apellido: 'Personal' },
}

const local = entornoLocal()
const intermediario = crearIntermediario(local.API_URL)
const servidor = crearServidorNext(PUERTO_APP)

const ids = {}
let cookieDirectora = ''
let tokenDirectora = ''

const rolId = (nombre) => Number(sql(`SELECT id FROM public.roles WHERE nombre = '${nombre}';`))
const estadoAcceso = (perfil) => sql(`SELECT estado_acceso FROM public.perfiles WHERE id = '${perfil}';`)
const baneado = (perfil) =>
  sql(`SELECT COALESCE(u.banned_until > now(), false) FROM auth.users u
       JOIN public.perfiles p ON p.user_id = u.id WHERE p.id = '${perfil}';`) === 't'
const historialAcceso = (perfil) =>
  contar(`FROM public.perfiles_historial WHERE perfil_id = '${perfil}' AND tipo = 'ACCESO'`)

/** Huella de fichas, matrículas y vínculos del fixture, para compararla sin volcarla. */
const huellaAcademica = () =>
  sql(`SELECT md5(COALESCE((SELECT string_agg(t, '|' ORDER BY t) FROM (
         SELECT 'A' || row_to_json(a)::text AS t FROM public.alumnos a
           WHERE a.perfil_id IN (SELECT id FROM public.perfiles WHERE dni LIKE '${PREFIJO_DNI}%')
         UNION ALL SELECT 'M' || row_to_json(m)::text FROM public.matriculas m
           WHERE m.alumno_id IN (SELECT id FROM public.perfiles WHERE dni LIKE '${PREFIJO_DNI}%')
         UNION ALL SELECT 'P' || row_to_json(f)::text FROM public.profesores f
           WHERE f.perfil_id IN (SELECT id FROM public.perfiles WHERE dni LIKE '${PREFIJO_DNI}%')
         UNION ALL SELECT 'H' || row_to_json(h)::text FROM public.padres_hijos h
           WHERE h.padre_id IN (SELECT id FROM public.perfiles WHERE dni LIKE '${PREFIJO_DNI}%')
       ) s), ''));`)

/** Tablas y vistas expuestas de `public`. */
const RELACIONES = sql(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v') ORDER BY 1;`)
  .split('\n').filter(Boolean)

/**
 * Vistas que `anon` no puede consultar por nombre pero cuyas filas lee igual
 * desde una tabla pública: la comparación con anon usa esa lectura. `materias`
 * es `security_invoker` sobre `actividades` (superficie pública) filtrada por
 * CURRICULAR; solo `authenticated` tiene GRANT sobre la vista.
 */
const EQUIVALENTES_PUBLICOS = {
  materias: 'actividades?select=id,nombre,activo&tipo=eq.CURRICULAR',
}

/** Filas legibles por relación con un JWT (o `null` para anon). Un error cuenta como 0. */
async function medir(token) {
  const resultado = {}
  for (const relacion of RELACIONES) {
    let r = await rest(local, token, `${relacion}?select=*`)
    if (token === null && r.estado !== 200 && EQUIVALENTES_PUBLICOS[relacion]) {
      r = await rest(local, null, EQUIVALENTES_PUBLICOS[relacion])
    }
    resultado[relacion] = r.estado === 200 && Array.isArray(r.cuerpo) ? r.cuerpo.length : 0
  }
  return resultado
}

/** Las filas de `materias` que ve un JWT bloqueado son exactamente las públicas. */
async function materiasSonPublicas(etiqueta, token) {
  const propias = await rest(local, token, 'materias?select=id,nombre,activo&order=id')
  const publicas = await rest(local, null, `${EQUIVALENTES_PUBLICOS.materias}&order=id`)
  afirmar(propias.estado === 200 && publicas.estado === 200 && propias.texto === publicas.texto,
    `${etiqueta}: la vista materias solo muestra lo que anon lee en actividades`)
}

const total = (medida) => Object.values(medida).reduce((a, b) => a + b, 0)

async function mismoQueAnon(etiqueta, token, anon) {
  const medida = await medir(token)
  const distintas = RELACIONES.filter((r) => medida[r] !== anon[r])
  afirmar(distintas.length === 0,
    `${etiqueta}: con el JWT previo, cada tabla y vista devuelve lo mismo que anon${distintas.length ? ` (difieren: ${distintas.join(', ')})` : ''}`)
  await materiasSonPublicas(etiqueta, token)
  return medida
}

async function banearDirecto(userId, bloquear) {
  const r = await fetch(`${local.API_URL}/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      apikey: local.SERVICE_ROLE_KEY,
      authorization: `Bearer ${local.SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ ban_duration: bloquear ? '876000h' : 'none' }),
    signal: AbortSignal.timeout(10_000),
  })
  await r.arrayBuffer()
  if (!r.ok) throw new Error(`no se pudo cambiar el baneo de una cuenta de la suite (${r.status})`)
}

const cambiarAccesoRpc = (token, perfil, esperado, nuevo) =>
  rpc(local, token, 'cambiar_acceso_perfil', {
    p_perfil_id: perfil, p_estado_esperado: esperado, p_estado_nuevo: nuevo, p_motivo: MOTIVO,
  })

const esAdminDeCuenta = (userId) => (p) =>
  p.metodo === 'PUT' && p.ruta === `/auth/v1/admin/users/${userId}`

function exigirLimpia(etiqueta, r) {
  const filtracion = detalleTecnicoEn(r.texto)
  afirmar(!filtracion, `${etiqueta}: la respuesta no trae detalle técnico${filtracion ? ` (${filtracion})` : ''}`)
  afirmar(r.cacheControl?.includes('no-store') === true, `${etiqueta}: la respuesta lleva Cache-Control: no-store`)
}

// ================================================================
// Fixture
// ================================================================
async function sembrar() {
  for (const [clave, p] of Object.entries(PERSONAS)) {
    const userId = await crearCuentaConPerfil(local, {
      email: p.email,
      password: CONTRASENA,
      perfil: {
        nombre: 'Prueba', apellido: `Bloqueo${p.apellido}`, dni: p.dni,
        rol_id: rolId(p.rol), legajo_nro: p.legajo_nro ?? null,
      },
    })
    ids[clave] = { userId, perfil: sql(`SELECT id FROM public.perfiles WHERE user_id = '${userId}';`) }
  }
  // Un curso, una matrícula para el estudiante y un vínculo familiar: datos
  // protegidos que cada rol puede leer y que el bloqueo no debe alterar.
  sql(`INSERT INTO public.cursos (nivel_id, denominacion, division, activo)
       VALUES ((SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), '${CURSO}', 'A', TRUE);
       INSERT INTO public.padres_hijos (padre_id, hijo_id) VALUES ('${ids.padre.perfil}', '${ids.estudiante.perfil}');`)
  const sesion = await exigirSesion(local, PERSONAS.directora.email, CONTRASENA)
  tokenDirectora = sesion.access_token
  cookieDirectora = cookieDe(sesion)
  const curso = sql(`SELECT id FROM public.cursos WHERE denominacion = '${CURSO}';`)
  const r = await rpc(local, tokenDirectora, 'reactivar_alumno', { p_alumno_id: ids.estudiante.perfil, p_curso_id: curso })
  if (r.estado !== 200 && r.estado !== 204) throw new Error(`no se pudo matricular al estudiante (${r.estado})`)
}

// ================================================================
// Escenarios
// ================================================================
async function escenarioPorRol(anon) {
  const huellaAntes = huellaAcademica()
  afirmar(contar(`FROM public.matriculas WHERE alumno_id = '${ids.estudiante.perfil}' AND fecha_cierre IS NULL`) === 1,
    'fixture: el estudiante tiene una matrícula vigente')

  for (const clave of ['director', 'docente', 'padre', 'estudiante', 'personal']) {
    const persona = PERSONAS[clave]
    const { perfil, userId } = ids[clave]
    const etiqueta = `1-${persona.rol}`

    const sesion = await exigirSesion(local, persona.email, CONTRASENA)
    const jwt = sesion.access_token
    const antes = await medir(jwt)
    const propio = await rest(local, jwt, `perfiles?select=id&id=eq.${perfil}`)
    afirmar(propio.cuerpo?.length === 1 && total(antes) > total(anon),
      `${etiqueta}: antes del bloqueo el JWT lee su perfil y más filas que anon (${total(antes)} contra ${total(anon)})`)
    afirmar((await rpc(local, jwt, 'rol_actual')).cuerpo === persona.rol, `${etiqueta}: antes del bloqueo rol_actual = ${persona.rol}`)

    const bloqueo = await cambiarAccesoRpc(tokenDirectora, perfil, 'HABILITADO', 'BLOQUEADO')
    afirmar(bloqueo.estado === 200 && estadoAcceso(perfil) === 'BLOQUEADO', `${etiqueta}: la Dirección lo bloquea por la RPC`)

    await mismoQueAnon(etiqueta, jwt, anon)
    afirmar((await rest(local, jwt, `perfiles?select=id&id=eq.${perfil}`)).cuerpo?.length === 0,
      `${etiqueta}: el JWT previo ya no ve ni su propio perfil`)
    afirmar((await rpc(local, jwt, 'mi_estado_acceso')).cuerpo === 'BLOQUEADO', `${etiqueta}: mi_estado_acceso = BLOQUEADO`)
    afirmar((await rpc(local, jwt, 'rol_actual')).cuerpo === null, `${etiqueta}: rol_actual queda vacío`)
    afirmar((await rpc(local, jwt, 'es_director_actual')).cuerpo === false, `${etiqueta}: es_director_actual = false`)

    const escritura = await rest(local, jwt, `perfiles?id=eq.${perfil}`, {
      method: 'PATCH', body: { telefono: '0362 4999999' }, headers: { prefer: 'return=representation' },
    })
    afirmar(
      (escritura.estado !== 200 || (Array.isArray(escritura.cuerpo) && escritura.cuerpo.length === 0)) &&
        sql(`SELECT COALESCE(telefono, '') FROM public.perfiles WHERE id = '${perfil}';`) !== '0362 4999999',
      `${etiqueta}: el JWT previo no puede escribir su perfil`
    )

    if (clave === 'director') {
      const listado = await rpc(local, jwt, 'listar_usuarios', { p_busqueda: null, p_limite: 5, p_desplazamiento: 0 })
      const cambio = await cambiarAccesoRpc(jwt, ids.personal.perfil, 'HABILITADO', 'BLOQUEADO')
      afirmar(listado.estado !== 200 && cambio.estado !== 200 && estadoAcceso(ids.personal.perfil) === 'HABILITADO',
        `${etiqueta}: un Director bloqueado no lista usuarios ni bloquea a nadie`)
    }
    if (clave === 'padre') {
      const hijo = await rpc(local, jwt, 'consultar_detalle_hijo', { p_hijo_id: ids.estudiante.perfil })
      afirmar(hijo.estado !== 200 || hijo.cuerpo == null || (Array.isArray(hijo.cuerpo) && hijo.cuerpo.length === 0),
        `${etiqueta}: un PADRE bloqueado no consulta a su hijo`)
    }

    // Segunda barrera: el baneo en Auth.
    await banearDirecto(userId, true)
    const ingreso = await iniciarSesion(local, persona.email, CONTRASENA)
    afirmar(ingreso.estado >= 400 && ingreso.codigo === 'user_banned', `${etiqueta}: con el baneo, el inicio de sesión falla (${ingreso.estado} ${ingreso.codigo})`)
    const renovacion = await renovarSesion(local, sesion.refresh_token)
    afirmar(renovacion.estado >= 400, `${etiqueta}: con el baneo, la renovación de la sesión falla (${renovacion.estado} ${renovacion.codigo})`)
    await mismoQueAnon(`${etiqueta}-baneado`, jwt, anon)
  }

  afirmar(huellaAcademica() === huellaAntes, '2: bloquear y banear no alteró fichas, matrículas ni vínculos familiares')

  // Restitución para los escenarios siguientes.
  for (const clave of ['director', 'docente', 'padre', 'estudiante', 'personal']) {
    const r = await cambiarAccesoRpc(tokenDirectora, ids[clave].perfil, 'BLOQUEADO', 'HABILITADO')
    await banearDirecto(ids[clave].userId, false)
    if (r.estado !== 200) throw new Error(`no se pudo restituir el acceso de ${clave} (${r.estado})`)
  }
  afirmar(huellaAcademica() === huellaAntes, '2: reactivar tampoco alteró fichas, matrículas ni vínculos')
}

async function escenarioBaneoParcial(anon) {
  const { perfil, userId } = ids.personal
  const persona = PERSONAS.personal

  // Falla transitoria: un solo intento fallido de Auth. La convergencia relee la
  // base y reintenta, así que el bloqueo queda sincronizado sin intervención.
  {
    const { perfil: perfilT, userId: userIdT } = ids.padre
    const unaFalla = intermediario.planear('fallar', esAdminDeCuenta(userIdT))
    const t = await api(servidor, `/api/usuarios/${perfilT}/acceso`, {
      method: 'POST', cookie: cookieDirectora,
      body: { estado_esperado: 'HABILITADO', estado_nuevo: 'BLOQUEADO', motivo: MOTIVO },
    })
    await unaFalla
    afirmar(t.estado === 200 && t.cuerpo?.auth_sincronizado === true && baneado(perfilT),
      `3: una falla transitoria de Auth se reintenta y el bloqueo queda sincronizado (${t.estado})`)
    const vuelta = await api(servidor, `/api/usuarios/${perfilT}/acceso`, {
      method: 'POST', cookie: cookieDirectora,
      body: { estado_esperado: 'BLOQUEADO', estado_nuevo: 'HABILITADO', motivo: MOTIVO },
    })
    if (vuelta.estado !== 200 || baneado(perfilT)) throw new Error(`no se pudo restituir a la familia (${vuelta.estado})`)
  }

  // Caída sostenida: fallan el intento inicial y los tres de la convergencia.
  const fallos = Array.from({ length: 4 }, () => intermediario.planear('fallar', esAdminDeCuenta(userId)))
  const r = await api(servidor, `/api/usuarios/${perfil}/acceso`, {
    method: 'POST', cookie: cookieDirectora,
    body: { estado_esperado: 'HABILITADO', estado_nuevo: 'BLOQUEADO', motivo: MOTIVO },
  })
  await fallos[0]
  // Si el servidor hizo menos intentos, las fallas restantes no deben alcanzar
  // a los escenarios siguientes.
  intermediario.descartarPlanes()
  afirmar(r.estado === 200 && r.cuerpo?.auth_sincronizado === false && r.cuerpo?.estado_acceso === 'BLOQUEADO',
    `3: con Auth caído, bloquear responde 200 con auth_sincronizado=false (${r.estado})`)
  exigirLimpia('3-bloqueo-parcial', r)
  afirmar(estadoAcceso(perfil) === 'BLOQUEADO' && !baneado(perfil), '3: la base quedó BLOQUEADO y la cuenta sin banear')

  const sesion = await exigirSesion(local, persona.email, CONTRASENA)
  afirmar(true, '3: sin baneo, la persona todavía puede iniciar sesión')
  await mismoQueAnon('3-sesion-nueva', sesion.access_token, anon)
  afirmar((await rpc(local, sesion.access_token, 'mi_estado_acceso')).cuerpo === 'BLOQUEADO', '3: la sesión nueva ve mi_estado_acceso = BLOQUEADO')

  const cookie = cookieDe(sesion)
  const guardaDirector = await api(servidor, '/api/usuarios', { cookie })
  afirmar(guardaDirector.estado === 403 && guardaDirector.cuerpo?.codigo === 'ACCESO_BLOQUEADO' &&
    guardaDirector.cuerpo?.error === 'Tu acceso está bloqueado. Comunicate con Dirección.',
    `3: requerirDirector responde 403 ACCESO_BLOQUEADO (${guardaDirector.estado} ${guardaDirector.cuerpo?.codigo})`)
  const guardaSesionConRol = await api(servidor, '/api/deportes/compatibilidad', { cookie })
  afirmar(guardaSesionConRol.estado === 403 && guardaSesionConRol.cuerpo?.error === 'Tu acceso está bloqueado. Comunicate con Dirección.',
    `3: requerirSesionConRol responde 403 con el mensaje de bloqueo (${guardaSesionConRol.estado})`)

  const sincronizar = await api(servidor, `/api/usuarios/${perfil}/acceso/sincronizar`, { method: 'POST', cookie: cookieDirectora })
  afirmar(sincronizar.estado === 200 && sincronizar.cuerpo?.auth_sincronizado === true && baneado(perfil),
    `3: sincronizar aplica el baneo pendiente (${sincronizar.estado})`)
  exigirLimpia('3-sincronizar', sincronizar)
  const ingreso = await iniciarSesion(local, persona.email, CONTRASENA)
  afirmar(ingreso.codigo === 'user_banned', '3: después de sincronizar, el inicio de sesión falla')
  const repetido = await api(servidor, `/api/usuarios/${perfil}/acceso/sincronizar`, { method: 'POST', cookie: cookieDirectora })
  afirmar(repetido.estado === 200 && repetido.cuerpo?.auth_sincronizado === true && baneado(perfil), '3: sincronizar es idempotente')
}

async function escenarioReactivacion() {
  const { perfil, userId } = ids.personal
  const persona = PERSONAS.personal
  const reactivar = (esperado = 'BLOQUEADO') => api(servidor, `/api/usuarios/${perfil}/acceso`, {
    method: 'POST', cookie: cookieDirectora,
    body: { estado_esperado: esperado, estado_nuevo: 'HABILITADO', motivo: MOTIVO },
  })

  // (a) Auth no levanta el baneo: 503 y la base intacta.
  let registros = historialAcceso(perfil)
  const falloAuth = intermediario.planear('fallar', esAdminDeCuenta(userId))
  let r = await reactivar()
  await falloAuth
  afirmar(r.estado === 503 && r.cuerpo?.codigo === 'AUTH_PENDIENTE', `4a: si Auth no responde, reactivar da 503 AUTH_PENDIENTE (${r.estado})`)
  exigirLimpia('4a', r)
  afirmar(estadoAcceso(perfil) === 'BLOQUEADO' && historialAcceso(perfil) === registros && baneado(perfil),
    '4a: la base sigue BLOQUEADO, sin historial nuevo, y la cuenta sigue baneada')

  // (b) La RPC falla después de levantar el baneo: se vuelve a banear.
  const falloRpc = intermediario.planear('fallar', (p) => p.metodo === 'POST' && p.ruta === '/rest/v1/rpc/cambiar_acceso_perfil')
  r = await reactivar()
  await falloRpc
  afirmar(r.estado >= 500 && r.cuerpo?.codigo === 'SERVICIO_NO_DISPONIBLE', `4b: si la base no responde, reactivar informa el error (${r.estado})`)
  afirmar(estadoAcceso(perfil) === 'BLOQUEADO' && baneado(perfil), '4b: la base sigue BLOQUEADO y la cuenta volvió a quedar baneada')

  // (c) Auth habilitado y la base todavía bloqueada: sigue sin acceso.
  await banearDirecto(userId, false)
  const sesion = await exigirSesion(local, persona.email, CONTRASENA)
  const jwt = sesion.access_token
  afirmar((await rest(local, jwt, `perfiles?select=id&id=eq.${perfil}`)).cuerpo?.length === 0 &&
    (await rpc(local, jwt, 'mi_estado_acceso')).cuerpo === 'BLOQUEADO',
    '4c: con Auth habilitado y la base bloqueada, la persona inicia sesión pero no ve nada')

  // (d) Reactivación completa por la API.
  registros = historialAcceso(perfil)
  r = await reactivar()
  afirmar(r.estado === 200 && r.cuerpo?.auth_sincronizado === true && r.cuerpo?.estado_acceso === 'HABILITADO',
    `4d: reactivar responde 200 con auth_sincronizado=true (${r.estado})`)
  exigirLimpia('4d', r)
  afirmar(estadoAcceso(perfil) === 'HABILITADO' && !baneado(perfil) && historialAcceso(perfil) === registros + 1,
    '4d: la base queda HABILITADO, la cuenta sin baneo y un registro ACCESO nuevo')
  afirmar((await rest(local, jwt, `perfiles?select=id&id=eq.${perfil}`)).cuerpo?.length === 1 &&
    (await rpc(local, jwt, 'mi_estado_acceso')).cuerpo === 'HABILITADO',
    '4d: con la base reactivada, el mismo JWT vuelve a ver su perfil')

  // (e) Valor esperado obsoleto: 409 sin tocar Auth.
  const antes = intermediario.registro.filter((l) => l === `PUT /auth/v1/admin/users/${userId}`).length
  r = await reactivar('BLOQUEADO')
  const despues = intermediario.registro.filter((l) => l === `PUT /auth/v1/admin/users/${userId}`).length
  afirmar(r.estado === 409 && r.cuerpo?.codigo === 'VALOR_OBSOLETO' && antes === despues,
    `4e: reactivar con un valor esperado obsoleto responde 409 sin tocar Auth (${r.estado})`)

  // (f) Bloqueo completo por la API: base y Auth.
  r = await api(servidor, `/api/usuarios/${ids.docente.perfil}/acceso`, {
    method: 'POST', cookie: cookieDirectora,
    body: { estado_esperado: 'HABILITADO', estado_nuevo: 'BLOQUEADO', motivo: MOTIVO },
  })
  afirmar(r.estado === 200 && r.cuerpo?.auth_sincronizado === true && baneado(ids.docente.perfil) &&
    estadoAcceso(ids.docente.perfil) === 'BLOQUEADO', `4f: bloquear por la API banea la cuenta (${r.estado})`)
  r = await api(servidor, `/api/usuarios/${ids.docente.perfil}/acceso`, {
    method: 'POST', cookie: cookieDirectora,
    body: { estado_esperado: 'BLOQUEADO', estado_nuevo: 'HABILITADO', motivo: MOTIVO },
  })
  afirmar(r.estado === 200 && !baneado(ids.docente.perfil) && estadoAcceso(ids.docente.perfil) === 'HABILITADO',
    `4f: reactivar por la API levanta el baneo (${r.estado})`)

  // (g) Reglas que decide la base, traducidas.
  r = await api(servidor, `/api/usuarios/${ids.directora.perfil}/acceso`, {
    method: 'POST', cookie: cookieDirectora,
    body: { estado_esperado: 'HABILITADO', estado_nuevo: 'BLOQUEADO', motivo: MOTIVO },
  })
  afirmar(r.estado === 403 && r.cuerpo?.codigo === 'OPERACION_PROPIA', `4g: nadie se bloquea a sí mismo (${r.estado} ${r.cuerpo?.codigo})`)
  r = await api(servidor, `/api/usuarios/${ids.docente.perfil}/acceso`, {
    method: 'POST', cookie: cookieDirectora,
    body: { estado_esperado: 'HABILITADO', estado_nuevo: 'BLOQUEADO', motivo: 'cor' },
  })
  afirmar(r.estado === 422 && r.cuerpo?.codigo === 'MOTIVO_INVALIDO', `4g: un motivo corto es 422 MOTIVO_INVALIDO (${r.estado})`)
  r = await api(servidor, `/api/usuarios/${ids.docente.perfil}/acceso`, {
    method: 'POST', cookie: cookieDirectora,
    body: { estado_esperado: 'HABILITADO', estado_nuevo: 'HABILITADO', motivo: MOTIVO },
  })
  afirmar(r.estado === 422 && r.cuerpo?.codigo === 'MISMO_VALOR', `4g: pedir el mismo estado es 422 MISMO_VALOR (${r.estado})`)

  // (h) Auditoría EPT-59, hallazgo 2: un baneo demorado no puede pisar una
  // reactivación posterior. El baneo del bloqueo queda retenido en el
  // intermediario; mientras tanto la base se reactiva; al liberarlo, el
  // servidor relee la base y deja la cuenta sin banear.
  const { perfil: perfilH, userId: userIdH } = ids.docente
  let liberar
  const hasta = new Promise((resolver) => { liberar = resolver })
  const retenido = intermediario.planear('retener', esAdminDeCuenta(userIdH), { hasta })
  const bloqueoDemorado = api(servidor, `/api/usuarios/${perfilH}/acceso`, {
    method: 'POST', cookie: cookieDirectora,
    body: { estado_esperado: 'HABILITADO', estado_nuevo: 'BLOQUEADO', motivo: MOTIVO },
  })
  await retenido
  afirmar(estadoAcceso(perfilH) === 'BLOQUEADO' && !baneado(perfilH), '4h: la base ya bloqueó y el baneo está demorado')
  const reactivacion = await cambiarAccesoRpc(tokenDirectora, perfilH, 'BLOQUEADO', 'HABILITADO')
  afirmar(reactivacion.estado === 200 && estadoAcceso(perfilH) === 'HABILITADO', `4h: otra operación reactiva mientras tanto (${reactivacion.estado})`)
  liberar()
  r = await bloqueoDemorado
  afirmar(r.estado === 200 && r.cuerpo?.auth_sincronizado === true, `4h: el bloqueo responde 200 sincronizado (${r.estado})`)
  exigirLimpia('4h-baneo-demorado', r)
  afirmar(estadoAcceso(perfilH) === 'HABILITADO' && !baneado(perfilH),
    '4h: el baneo demorado no quedó aplicado: Auth coincide con la base (HABILITADO, sin baneo)')
  const ingresoH = await iniciarSesion(local, PERSONAS.docente.email, CONTRASENA)
  afirmar(ingresoH.estado === 200, '4h: la persona reactivada puede iniciar sesión')

  // (i) Ronda 2 de la auditoría (A2): la Directora A bloquea al Director B y
  // el baneo queda demorado; A reactiva a B; B bloquea a A. Al liberar el
  // baneo, la sesión de A ya no puede leer nada: la relectura tiene que hacerse
  // con el cliente administrativo para no dejar a B baneado (cero efectivos).
  const { perfil: perfilB, userId: userIdB } = ids.director
  const sesionB = await exigirSesion(local, PERSONAS.director.email, CONTRASENA)
  let liberarI
  const hastaI = new Promise((resolver) => { liberarI = resolver })
  const retenidoI = intermediario.planear('retener', esAdminDeCuenta(userIdB), { hasta: hastaI })
  const bloqueoDeB = api(servidor, `/api/usuarios/${perfilB}/acceso`, {
    method: 'POST', cookie: cookieDirectora,
    body: { estado_esperado: 'HABILITADO', estado_nuevo: 'BLOQUEADO', motivo: MOTIVO },
  })
  await retenidoI
  const reactivaB = await cambiarAccesoRpc(tokenDirectora, perfilB, 'BLOQUEADO', 'HABILITADO')
  afirmar(reactivaB.estado === 200, `4i: A reactiva a B mientras el baneo está demorado (${reactivaB.estado})`)
  const bloqueaA = await cambiarAccesoRpc(sesionB.access_token, ids.directora.perfil, 'HABILITADO', 'BLOQUEADO')
  afirmar(bloqueaA.estado === 200 && estadoAcceso(ids.directora.perfil) === 'BLOQUEADO',
    `4i: B bloquea a A (${bloqueaA.estado})`)
  liberarI()
  const respuestaI = await bloqueoDeB
  afirmar(respuestaI.estado === 200, `4i: el bloqueo original de A responde 200 (${respuestaI.estado})`)
  afirmar(estadoAcceso(perfilB) === 'HABILITADO' && !baneado(perfilB),
    '4i: B quedó HABILITADO y sin baneo aunque la sesión de A ya estaba bloqueada')
  const ingresoB = await iniciarSesion(local, PERSONAS.director.email, CONTRASENA)
  afirmar(ingresoB.estado === 200, '4i: B, el único Director efectivo, puede iniciar sesión')

  // Restitución: B reactiva a A.
  const restituyeA = await cambiarAccesoRpc(sesionB.access_token, ids.directora.perfil, 'BLOQUEADO', 'HABILITADO')
  if (restituyeA.estado !== 200) throw new Error(`no se pudo restituir a la Directora (${restituyeA.estado})`)
}

async function escenarioFichas() {
  let r = await rpc(local, tokenDirectora, 'inactivar_alumno', { p_alumno_id: ids.estudiante.perfil })
  afirmar(r.estado === 200 || r.estado === 204, `5: la Dirección inactiva la ficha del alumno (${r.estado})`)
  let ingreso = await iniciarSesion(local, PERSONAS.estudiante.email, CONTRASENA)
  afirmar(ingreso.estado === 200 && (await rpc(local, ingreso.sesion.access_token, 'mi_estado_acceso')).cuerpo === 'HABILITADO' &&
    estadoAcceso(ids.estudiante.perfil) === 'HABILITADO', '5: un alumno INACTIVO sigue pudiendo iniciar sesión (acceso HABILITADO)')

  r = await rpc(local, tokenDirectora, 'cambiar_estado_profesor', { p_profesor_id: ids.docente.perfil, p_estado: 'INACTIVO', p_motivo: null })
  afirmar(r.estado === 200 || r.estado === 204, `5: la Dirección inactiva la ficha del profesor (${r.estado})`)
  ingreso = await iniciarSesion(local, PERSONAS.docente.email, CONTRASENA)
  afirmar(ingreso.estado === 200 && (await rpc(local, ingreso.sesion.access_token, 'mi_estado_acceso')).cuerpo === 'HABILITADO' &&
    estadoAcceso(ids.docente.perfil) === 'HABILITADO', '5: un profesor con ficha INACTIVA sigue pudiendo iniciar sesión')
}

async function escenarioApi() {
  const sinSesion = await api(servidor, '/api/usuarios')
  afirmar(sinSesion.estado === 401 && sinSesion.cuerpo?.codigo === 'NO_AUTENTICADO', `6: sin sesión, el listado es 401 (${sinSesion.estado})`)
  const personal = cookieDe(await exigirSesion(local, PERSONAS.personal.email, CONTRASENA))
  const ajeno = await api(servidor, `/api/usuarios/${ids.docente.perfil}`, { cookie: personal })
  afirmar(ajeno.estado === 403 && ajeno.cuerpo?.codigo === 'SIN_PERMISO', `6: un PERSONAL no ve el detalle (${ajeno.estado})`)

  let r = await api(servidor, `/api/usuarios?busqueda=${PREFIJO_DNI}&pagina=1`, { cookie: cookieDirectora })
  afirmar(r.estado === 200 && r.cuerpo?.total === Object.keys(PERSONAS).length && r.cuerpo?.usuarios?.every((u) => u.correo_enmascarado?.includes('***@')),
    `6: el listado filtra por DNI y enmascara los correos (${r.estado}, total ${r.cuerpo?.total})`)
  exigirLimpia('6-listado', r)
  afirmar(!r.texto.includes(PERSONAS.docente.email), '6: el listado no trae ningún correo completo')
  r = await api(servidor, '/api/usuarios?pagina=0', { cookie: cookieDirectora })
  afirmar(r.estado === 422 && r.cuerpo?.codigo === 'DATOS_INVALIDOS', `6: una página inválida es 422 (${r.estado})`)

  r = await api(servidor, `/api/usuarios/${ids.padre.perfil}`, { cookie: cookieDirectora })
  afirmar(r.estado === 200 && r.cuerpo?.id === ids.padre.perfil && r.cuerpo?.vinculo_disponible === false && r.cuerpo?.rol === 'PADRE',
    `6: el detalle informa rol y vinculo_disponible=false sin la bandera D5 (${r.estado})`)
  exigirLimpia('6-detalle', r)
  r = await api(servidor, '/api/usuarios/00000000-0000-4000-8000-000000000000', { cookie: cookieDirectora })
  afirmar(r.estado === 404 && r.cuerpo?.codigo === 'PERFIL_INEXISTENTE', `6: un perfil inexistente es 404 (${r.estado})`)

  const datos = { nombre: 'Prueba', apellido: 'BloqueoPadre', dni: PERSONAS.padre.dni, telefono: '0362 4123456' }
  r = await api(servidor, `/api/usuarios/${ids.padre.perfil}`, { method: 'PATCH', cookie: cookieDirectora, body: datos })
  afirmar(r.estado === 200 && sql(`SELECT telefono FROM public.perfiles WHERE id = '${ids.padre.perfil}';`) === '0362 4123456',
    `6: PATCH guarda los datos personales (${r.estado})`)
  r = await api(servidor, `/api/usuarios/${ids.padre.perfil}`, { method: 'PATCH', cookie: cookieDirectora, body: { ...datos, dni: PERSONAS.personal.dni } })
  afirmar(r.estado === 409 && r.cuerpo?.codigo === 'DNI_DUPLICADO', `6: un DNI ajeno es 409 DNI_DUPLICADO (${r.estado})`)
  exigirLimpia('6-dni-duplicado', r)
  r = await api(servidor, `/api/usuarios/${ids.padre.perfil}`, { method: 'PATCH', cookie: cookieDirectora, body: { ...datos, legajo_nro: ' LEG-CON-ESPACIO' } })
  afirmar(r.estado === 422 && r.cuerpo?.codigo === 'DATOS_INVALIDOS', `6: un legajo que la base rechaza es 422 (${r.estado})`)
  exigirLimpia('6-legajo-invalido', r)
  r = await api(servidor, `/api/usuarios/${ids.padre.perfil}`, { method: 'PATCH', cookie: cookieDirectora, body: { ...datos, rol_id: rolId('DIRECTOR') } })
  afirmar(r.estado === 422 && sql(`SELECT r.nombre FROM public.perfiles p JOIN public.roles r ON r.id = p.rol_id WHERE p.id = '${ids.padre.perfil}';`) === 'PADRE',
    `6: PATCH no acepta rol_id (${r.estado})`)

  r = await api(servidor, `/api/usuarios/${ids.personal.perfil}/rol`, {
    method: 'POST', cookie: cookieDirectora, body: { rol_esperado: 'PERSONAL', rol_nuevo: 'PADRE', motivo: MOTIVO },
  })
  afirmar(r.estado === 200 && r.cuerpo?.rol === 'PADRE', `6: cambio de rol PERSONAL→PADRE (${r.estado})`)
  exigirLimpia('6-rol', r)
  r = await api(servidor, `/api/usuarios/${ids.personal.perfil}/rol`, {
    method: 'POST', cookie: cookieDirectora, body: { rol_esperado: 'PERSONAL', rol_nuevo: 'DOCENTE', motivo: MOTIVO },
  })
  afirmar(r.estado === 409 && r.cuerpo?.codigo === 'VALOR_OBSOLETO', `6: un rol esperado obsoleto es 409 (${r.estado})`)
  r = await api(servidor, `/api/usuarios/${ids.padre.perfil}/rol`, {
    method: 'POST', cookie: cookieDirectora, body: { rol_esperado: 'PADRE', rol_nuevo: 'PERSONAL', motivo: MOTIVO },
  })
  afirmar(r.estado === 409 && r.cuerpo?.codigo === 'PADRE_CON_VINCULOS', `6: un PADRE con hijos no cambia de rol (${r.estado})`)
  r = await api(servidor, `/api/usuarios/${ids.estudiante.perfil}/rol`, {
    method: 'POST', cookie: cookieDirectora, body: { rol_esperado: 'ESTUDIANTE', rol_nuevo: 'PERSONAL', motivo: MOTIVO },
  })
  afirmar(r.estado === 422 && r.cuerpo?.codigo === 'TRANSICION_ESTUDIANTE', `6: ESTUDIANTE no se cambia desde Usuarios (${r.estado})`)
  r = await api(servidor, `/api/usuarios/${ids.directora.perfil}/rol`, {
    method: 'POST', cookie: cookieDirectora, body: { rol_esperado: 'DIRECTOR', rol_nuevo: 'PERSONAL', motivo: MOTIVO },
  })
  afirmar(r.estado === 403 && r.cuerpo?.codigo === 'OPERACION_PROPIA', `6: nadie cambia su propio rol (${r.estado})`)
  r = await api(servidor, `/api/usuarios/${ids.personal.perfil}/rol`, {
    method: 'POST', cookie: cookieDirectora, body: { rol_esperado: 'PADRE', rol_nuevo: 'NO_EXISTE', motivo: MOTIVO },
  })
  afirmar(r.estado === 422 && r.cuerpo?.codigo === 'ROL_INVALIDO', `6: un rol inexistente es 422 (${r.estado})`)

  r = await api(servidor, `/api/usuarios/${ids.personal.perfil}/historial`, { cookie: cookieDirectora })
  const tipos = new Set((r.cuerpo?.historial ?? []).map((h) => h.tipo))
  afirmar(r.estado === 200 && tipos.has('ROL') && tipos.has('ACCESO'), `6: el historial trae los cambios de rol y de acceso (${r.estado})`)
  exigirLimpia('6-historial', r)

  r = await api(servidor, '/api/usuarios/vinculos', { method: 'POST', cookie: cookieDirectora, body: {} })
  afirmar(r.estado === 503 && r.cuerpo?.codigo === 'VINCULO_DESHABILITADO', `6: sin la bandera, D5 responde 503 VINCULO_DESHABILITADO (${r.estado})`)

  for (const [metodo, ruta] of [
    ['DELETE', `/api/usuarios/${ids.padre.perfil}`],
    ['PUT', `/api/usuarios/${ids.padre.perfil}`],
    ['GET', `/api/usuarios/${ids.padre.perfil}/rol`],
    ['GET', `/api/usuarios/${ids.padre.perfil}/acceso`],
    ['DELETE', `/api/usuarios/${ids.padre.perfil}/historial`],
    ['DELETE', '/api/usuarios'],
  ]) {
    r = await api(servidor, ruta, { method: metodo, cookie: cookieDirectora })
    afirmar(r.estado === 405, `6: ${metodo} ${ruta.replace(ids.padre.perfil, ':id')} responde 405 (${r.estado})`)
  }
}

// ================================================================
// Arranque y cierre
// ================================================================
try {
  exigirBaseLocal()
  if (!(await puertoLibre(PUERTO_PROXY))) throw new Error(`el puerto ${PUERTO_PROXY} ya está ocupado`)
  limpiarFixture({ prefijoDni: PREFIJO_DNI, prefijoCorreo: PREFIJO_CORREO, dominio: DOMINIO, curso: CURSO })
  await sembrar()
  await intermediario.escuchar(PUERTO_PROXY)
  await servidor.iniciar({
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${PUERTO_PROXY}`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: local.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY,
  })
  console.log(`Instancia local verificada; aplicación en ${servidor.url}, intermediario en 127.0.0.1:${PUERTO_PROXY}`)

  const anon = await medir(null)
  await escenarioPorRol(anon)
  await escenarioBaneoParcial(anon)
  await escenarioReactivacion()
  await escenarioFichas()
  await escenarioApi()
  afirmar(intermediario.pendientes() === 0, 'todas las fallas planeadas se aplicaron')
} catch (error) {
  conteo.fallos += 1
  console.error(`FALLO  ${error instanceof Error ? error.message : String(error)}`)
  if (servidor.registro) console.error(servidor.registro.slice(-3000))
} finally {
  await servidor.detener()
  intermediario.descartarPlanes()
  await intermediario.cerrar()
  try {
    limpiarFixture({ prefijoDni: PREFIJO_DNI, prefijoCorreo: PREFIJO_CORREO, dominio: DOMINIO, curso: CURSO })
  } catch (error) {
    conteo.fallos += 1
    console.error(`FALLO  la limpieza no terminó: ${error instanceof Error ? error.message : String(error)}`)
  }
  afirmar(
    contar(`FROM auth.users WHERE email LIKE '${PREFIJO_CORREO}%@${DOMINIO}'`) === 0 &&
      contar(`FROM public.perfiles WHERE dni LIKE '${PREFIJO_DNI}%'`) === 0,
    'la base quedó sin datos de la suite'
  )
  afirmar(await puertoLibre(PUERTO_APP), `el puerto ${PUERTO_APP} quedó libre`)
  console.log(`\n${conteo.afirmaciones} afirmaciones, ${conteo.fallos} incumplida(s).`)
  process.exitCode = conteo.fallos > 0 ? 1 : 0
}
