/**
 * Reconciliación entre Auth y PostgreSQL cuando el resultado es ambiguo.
 *
 * El alta de una cuenta toca dos sistemas que no comparten confirmación. Un
 * error del cliente de PostgREST puede significar dos cosas muy distintas: que
 * PostgreSQL rechazó la escritura, o que no sabemos qué pasó porque la
 * respuesta no llegó. Compensar en los dos casos es lo que dejaba perfiles y
 * legajos huérfanos cuando el INSERT sí se había confirmado.
 *
 * Probar eso exige producir de verdad el caso «comprometido en la base,
 * respuesta perdida», y eso no se puede hacer desde SQL: la escritura ya está
 * confirmada cuando la respuesta se pierde. Así que esta prueba levanta un
 * intermediario delante de PostgREST y de Auth, reenvía la petición, espera la
 * respuesta de arriba —con lo cual la fila ya quedó— y recién entonces
 * devuelve un error de transporte al servidor de la aplicación.
 *
 *     node supabase/tests/usuarios_reconciliacion.mjs
 *
 * Levanta su propio servidor de Next en un puerto propio, así que no interfiere
 * con la suite de Playwright ni con el arnés de producción.
 */

import { execFileSync, spawn } from 'node:child_process'
import http from 'node:http'
import { setTimeout as esperar } from 'node:timers/promises'

const CONTENEDOR =
  process.env.EPT_SUPABASE_DB_CONTAINER ?? 'supabase_db_educar-para-transformar'

const PUERTO_PROXY = 54399
const PUERTO_APP = 3210
const APP = `http://127.0.0.1:${PUERTO_APP}`

const DIRECTORA = { email: 'directora.prueba@ept.local', password: 'prueba-ept-8-directora' }
const PREFIJO_DNI = '96'
const DOMINIO = 'ept.local'

let fallos = 0

function afirmar(condicion, descripcion) {
  if (condicion) {
    console.log(`OK  ${descripcion}`)
    return
  }
  fallos += 1
  console.error(`FALLO  ${descripcion}`)
}

// ================================================================
// Base de datos
// ================================================================
function sql(sentencia) {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTENEDOR, 'psql', '-X', '-q', '-A', '-t', '-U', 'postgres',
     '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    { input: sentencia, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim()
}

const contar = (consulta) => Number(sql(`SELECT pg_catalog.count(*) ${consulta};`))

/** Hace fallar el INSERT en `perfiles` para un apellido concreto. */
function inyectarRechazoDePerfil() {
  sql(`
    CREATE OR REPLACE FUNCTION public.rechazar_perfil_de_prueba()
    RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
    BEGIN
        IF NEW.apellido = 'RechazoConfirmado' THEN
            RAISE EXCEPTION 'Rechazo inyectado por la suite de reconciliacion.';
        END IF;
        RETURN NEW;
    END; $fn$;
    DROP TRIGGER IF EXISTS trg_rechazar_perfil_de_prueba ON public.perfiles;
    CREATE TRIGGER trg_rechazar_perfil_de_prueba BEFORE INSERT ON public.perfiles
        FOR EACH ROW EXECUTE FUNCTION public.rechazar_perfil_de_prueba();
  `)
}

/** Impide que nazca la fila de `alumnos`, dejando el conjunto a medias. */
function inyectarLegajoAusente() {
  sql(`
    CREATE OR REPLACE FUNCTION public.omitir_alumno_de_prueba()
    RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
    BEGIN
        -- Devolver NULL en un disparador BEFORE cancela la fila sin error.
        RETURN NULL;
    END; $fn$;
    DROP TRIGGER IF EXISTS trg_omitir_alumno_de_prueba ON public.alumnos;
    CREATE TRIGGER trg_omitir_alumno_de_prueba BEFORE INSERT ON public.alumnos
        FOR EACH ROW EXECUTE FUNCTION public.omitir_alumno_de_prueba();
  `)
}

function retirarInyecciones() {
  sql(`
    DROP TRIGGER IF EXISTS trg_rechazar_perfil_de_prueba ON public.perfiles;
    DROP FUNCTION IF EXISTS public.rechazar_perfil_de_prueba();
    DROP TRIGGER IF EXISTS trg_omitir_alumno_de_prueba ON public.alumnos;
    DROP FUNCTION IF EXISTS public.omitir_alumno_de_prueba();
  `)
}

function limpiar() {
  retirarInyecciones()
  sql(`
    BEGIN;
    DELETE FROM public.matriculas WHERE alumno_id IN
      (SELECT id FROM public.perfiles WHERE dni LIKE '${PREFIJO_DNI}%');
    DELETE FROM public.alumnos WHERE perfil_id IN
      (SELECT id FROM public.perfiles WHERE dni LIKE '${PREFIJO_DNI}%');
    DELETE FROM public.perfiles WHERE dni LIKE '${PREFIJO_DNI}%';
    COMMIT;
    DELETE FROM auth.users WHERE email LIKE 'reconciliacion.%@${DOMINIO}';
  `)
}

// ================================================================
// Entorno local
// ================================================================
function entornoLocal() {
  const salida = execFileSync('npx', ['supabase', 'status', '-o', 'env'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  const valores = {}
  for (const linea of salida.split(/\r?\n/u)) {
    const m = /^([A-Z0-9_]+)="?(.*?)"?$/u.exec(linea.trim())
    if (m) valores[m[1]] = m[2]
  }
  return valores
}

const local = entornoLocal()
if (!local.API_URL || !local.SERVICE_ROLE_KEY) {
  console.error('FALLO  no se pudo leer la instancia local de Supabase.')
  process.exit(1)
}
const anfitrion = new URL(local.API_URL).hostname
if (!['127.0.0.1', 'localhost', '::1'].includes(anfitrion)) {
  console.error(`FALLO  la instancia apunta a «${anfitrion}», que no es de bucle local.`)
  process.exit(1)
}
console.log(`Instancia local verificada: ${local.API_URL}`)

// ================================================================
// Intermediario
// ================================================================
/**
 * Modo del intermediario.
 *
 * - `normal`: reenvía todo tal cual.
 * - `perder-respuesta-perfiles`: reenvía el alta de un perfil, espera a que
 *   PostgreSQL confirme y recién entonces devuelve un error de transporte.
 *   Es el escenario que no se puede producir desde SQL.
 * - `fallar-borrado-auth`: deja pasar todo menos el borrado administrativo de
 *   una cuenta, que devuelve un error. Sirve para la compensación fallida.
 */
let modo = 'normal'
const arriba = new URL(local.API_URL)

const proxy = http.createServer((peticion, respuesta) => {
  const trozos = []
  peticion.on('data', (t) => trozos.push(t))
  peticion.on('end', async () => {
    const cuerpo = Buffer.concat(trozos)
    const esAltaDePerfil =
      peticion.method === 'POST' && peticion.url.startsWith('/rest/v1/perfiles')
    const esBorradoDeCuenta =
      peticion.method === 'DELETE' && peticion.url.startsWith('/auth/v1/admin/users/')

    if (modo === 'fallar-borrado-auth' && esBorradoDeCuenta) {
      respuesta.writeHead(500, { 'content-type': 'application/json' })
      respuesta.end(JSON.stringify({ message: 'borrado rechazado por la prueba' }))
      return
    }

    const cabeceras = { ...peticion.headers, host: arriba.host }
    let arribaRespuesta
    try {
      arribaRespuesta = await fetch(`${arriba.origin}${peticion.url}`, {
        method: peticion.method,
        headers: cabeceras,
        body: ['GET', 'HEAD'].includes(peticion.method) ? undefined : cuerpo,
      })
    } catch (error) {
      respuesta.writeHead(502, { 'content-type': 'application/json' })
      respuesta.end(JSON.stringify({ message: String(error) }))
      return
    }

    const contenido = Buffer.from(await arribaRespuesta.arrayBuffer())

    if (modo === 'perder-respuesta-perfiles' && esAltaDePerfil) {
      // La fila ya quedó: arriba respondió. Lo que se pierde es la respuesta.
      // Se devuelve un error sin SQLSTATE, como haría un intermediario roto.
      respuesta.writeHead(502, { 'content-type': 'text/plain' })
      respuesta.end('502 Bad Gateway')
      return
    }

    const salida = {}
    arribaRespuesta.headers.forEach((valor, clave) => {
      if (!['content-encoding', 'transfer-encoding', 'content-length'].includes(clave)) {
        salida[clave] = valor
      }
    })
    respuesta.writeHead(arribaRespuesta.status, salida)
    respuesta.end(contenido)
  })
})

// ================================================================
// Servidor de la aplicación
// ================================================================
/**
 * Sólo estas variables llegan al proceso hijo.
 *
 * No se hereda el entorno completo: el servidor no necesita más que esto y
 * heredar a ciegas arrastraría cualquier secreto que hubiera en la sesión.
 */
function entornoDelServidor() {
  return {
    PATH: process.env.PATH,
    SYSTEMROOT: process.env.SYSTEMROOT,
    COMSPEC: process.env.COMSPEC,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    NODE_ENV: 'development',
    NEXT_TELEMETRY_DISABLED: '1',
    // El cliente de la aplicación y el administrativo pasan por el proxy.
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${PUERTO_PROXY}`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: local.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY,
  }
}

let servidor = null

async function detener(proceso) {
  if (!proceso || proceso.exitCode !== null) return
  const terminado = new Promise((r) => proceso.once('exit', r))
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/pid', String(proceso.pid), '/T', '/F'], {
        stdio: 'ignore',
      })
    } catch {
      // Ya no estaba.
    }
  } else {
    proceso.kill('SIGTERM')
  }
  await Promise.race([terminado, esperar(5000)])
}

async function esperarAlServidor(intentos = 120) {
  for (let i = 0; i < intentos; i += 1) {
    try {
      const r = await fetch(`${APP}/login`, {
        redirect: 'manual',
        signal: AbortSignal.timeout(3000),
      })
      if (r.status > 0) return true
    } catch {
      // Todavía no.
    }
    await esperar(1000)
  }
  return false
}

// ================================================================
// Sesión de la directora
// ================================================================
/**
 * Construye la cookie de sesión igual que la escribe `@supabase/ssr`.
 *
 * Se firma con la contraseña real contra Auth, así que la sesión es legítima:
 * la ruta la valida con `auth.getUser()` como con cualquier otra.
 */
async function cookieDeDirectora() {
  const respuesta = await fetch(
    `${local.API_URL}/auth/v1/token?grant_type=password`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: local.ANON_KEY },
      body: JSON.stringify(DIRECTORA),
      signal: AbortSignal.timeout(10_000),
    }
  )
  if (!respuesta.ok) {
    throw new Error(
      `No se pudo iniciar sesión como directora (${respuesta.status}). ` +
        'Ejecutá antes el proyecto `setup` de Playwright para sembrar las identidades.'
    )
  }
  const sesion = await respuesta.json()
  const valor = Buffer.from(JSON.stringify(sesion), 'utf8').toString('base64')
  return `sb-127-auth-token=base64-${valor}`
}

let cookie = ''

/** Llama al alta con la sesión de la directora. */
async function crearUsuario(datos) {
  const respuesta = await fetch(`${APP}/api/usuarios`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      password: 'prueba-ept-9-reconciliacion',
      nombre: 'Reconciliacion',
      ...datos,
    }),
    signal: AbortSignal.timeout(30_000),
  })
  let cuerpo = null
  try {
    cuerpo = await respuesta.json()
  } catch {
    cuerpo = null
  }
  return { estado: respuesta.status, cuerpo }
}

const rolEstudiante = Number(sql("SELECT id FROM public.roles WHERE nombre = 'ESTUDIANTE';"))
const rolDocente = Number(sql("SELECT id FROM public.roles WHERE nombre = 'DOCENTE';"))

// ================================================================
// Escenarios
// ================================================================
async function principal() {
  limpiar()

  // ---------------------------------------------------------------
  // 1. Rechazo confirmado de PostgreSQL: se compensa la cuenta.
  // ---------------------------------------------------------------
  {
    const dni = `${PREFIJO_DNI}000001`
    const email = `reconciliacion.${dni}@${DOMINIO}`
    inyectarRechazoDePerfil()
    const r = await crearUsuario({
      email,
      apellido: 'RechazoConfirmado',
      dni,
      rol_id: rolEstudiante,
      legajo_nro: 'LEG-RECON-0001',
    })
    retirarInyecciones()

    afirmar(r.estado === 400, `un rechazo confirmado devuelve 400 (devolvió ${r.estado})`)
    afirmar(
      contar(`FROM auth.users WHERE email = '${email}'`) === 0,
      'la cuenta de Auth se compensó tras un rechazo confirmado'
    )
    afirmar(
      contar(`FROM public.perfiles WHERE dni = '${dni}'`) === 0,
      'no quedó ningún perfil tras el rechazo confirmado'
    )
    // 7. Ni el DNI ni el legajo quedan reservados.
    afirmar(
      contar(`FROM public.perfiles WHERE legajo_nro = 'LEG-RECON-0001'`) === 0,
      'no quedó reservado el legajo tras el rechazo confirmado'
    )
  }

  // ---------------------------------------------------------------
  // 2. Escritura confirmada y respuesta perdida: no se borra Auth.
  // ---------------------------------------------------------------
  let userIdPerdido = ''
  {
    const dni = `${PREFIJO_DNI}000002`
    const email = `reconciliacion.${dni}@${DOMINIO}`
    modo = 'perder-respuesta-perfiles'
    const r = await crearUsuario({
      email,
      apellido: 'RespuestaPerdida',
      dni,
      rol_id: rolEstudiante,
      legajo_nro: 'LEG-RECON-0002',
    })
    modo = 'normal'

    afirmar(
      contar(`FROM public.perfiles WHERE dni = '${dni}'`) === 1,
      'la escritura sí se había confirmado en PostgreSQL'
    )
    afirmar(
      contar(`FROM auth.users WHERE email = '${email}'`) === 1,
      'la cuenta de Auth NO se borró: no quedaron perfil ni legajo huérfanos'
    )
    afirmar(
      contar(
        `FROM public.alumnos a JOIN public.perfiles p ON p.id = a.perfil_id
         WHERE p.dni = '${dni}'`
      ) === 1,
      'el legajo académico también quedó, y con su cuenta'
    )
    afirmar(
      r.estado === 200 && r.cuerpo?.reconciliado === true,
      `la ruta informa el alta como reconciliada (estado ${r.estado})`
    )
    userIdPerdido = sql(
      `SELECT user_id FROM public.perfiles WHERE dni = '${dni}';`
    )
    afirmar(userIdPerdido.length === 36, 'el perfil conserva su vínculo con la cuenta')
  }

  // ---------------------------------------------------------------
  // 3. Perfil confirmado con legajo académico ausente: error operativo.
  // ---------------------------------------------------------------
  {
    const dni = `${PREFIJO_DNI}000003`
    const email = `reconciliacion.${dni}@${DOMINIO}`
    inyectarLegajoAusente()
    modo = 'perder-respuesta-perfiles'
    const r = await crearUsuario({
      email,
      apellido: 'EstadoParcial',
      dni,
      rol_id: rolEstudiante,
      legajo_nro: 'LEG-RECON-0003',
    })
    modo = 'normal'
    retirarInyecciones()

    afirmar(r.estado === 500, `un estado parcial devuelve 500 (devolvió ${r.estado})`)
    afirmar(
      typeof r.cuerpo?.error === 'string' && /referencia/i.test(r.cuerpo.error),
      'el error operativo trae una referencia de correlación'
    )
    afirmar(
      !/[0-9A-Z]{5}:/.test(r.cuerpo?.error ?? '') &&
        !/relation|permission denied|schema cache/i.test(r.cuerpo?.error ?? ''),
      'el error operativo no filtra detalles técnicos'
    )
    // Nada se destruyó a ciegas: perfil y cuenta siguen ahí.
    afirmar(
      contar(`FROM public.perfiles WHERE dni = '${dni}'`) === 1,
      'el perfil del estado parcial no se borró a ciegas'
    )
    afirmar(
      contar(`FROM auth.users WHERE email = '${email}'`) === 1,
      'la cuenta del estado parcial tampoco se borró a ciegas'
    )
  }

  // ---------------------------------------------------------------
  // 5. Compensación fallida: error explícito.
  // ---------------------------------------------------------------
  {
    const dni = `${PREFIJO_DNI}000005`
    const email = `reconciliacion.${dni}@${DOMINIO}`
    inyectarRechazoDePerfil()
    modo = 'fallar-borrado-auth'
    const r = await crearUsuario({
      email,
      apellido: 'RechazoConfirmado',
      dni,
      rol_id: rolDocente,
    })
    modo = 'normal'
    retirarInyecciones()

    afirmar(r.estado === 500, `una compensación fallida devuelve 500 (devolvió ${r.estado})`)
    afirmar(
      /revertirla por completo/i.test(r.cuerpo?.error ?? ''),
      'y lo dice explícitamente en lugar de aparentar un fallo limpio'
    )
    afirmar(
      contar(`FROM auth.users WHERE email = '${email}'`) === 1,
      'la cuenta quedó, que es justamente lo que el mensaje advierte'
    )
    sql(`DELETE FROM auth.users WHERE email = '${email}';`)
  }

  // ---------------------------------------------------------------
  // 6. Reintento con el mismo email: no duplica la identidad.
  // ---------------------------------------------------------------
  {
    const dni = `${PREFIJO_DNI}000002`
    const email = `reconciliacion.${dni}@${DOMINIO}`
    const r = await crearUsuario({
      email,
      apellido: 'RespuestaPerdida',
      dni,
      rol_id: rolEstudiante,
      legajo_nro: 'LEG-RECON-0002',
    })

    afirmar(
      r.estado === 409 || r.estado === 400,
      `el reintento se rechaza sin crear nada nuevo (devolvió ${r.estado})`
    )
    afirmar(
      contar(`FROM public.perfiles WHERE dni = '${dni}'`) === 1,
      'sigue habiendo un solo perfil con ese DNI'
    )
    afirmar(
      contar(`FROM auth.users WHERE email = '${email}'`) === 1,
      'y una sola cuenta con ese email'
    )
    afirmar(
      sql(`SELECT user_id FROM public.perfiles WHERE dni = '${dni}';`) === userIdPerdido,
      'el perfil conserva el mismo user_id: la identidad no se duplicó'
    )
  }

  // ---------------------------------------------------------------
  // 4. Ausencia confirmada por transporte desconocido: se compensa.
  // ---------------------------------------------------------------
  {
    const dni = `${PREFIJO_DNI}000004`
    const email = `reconciliacion.${dni}@${DOMINIO}`
    // El disparador rechaza la escritura y, además, el proxy pierde la
    // respuesta: la ruta no sabe qué pasó, reconcilia y encuentra la ausencia.
    inyectarRechazoDePerfil()
    modo = 'perder-respuesta-perfiles'
    const r = await crearUsuario({
      email,
      apellido: 'RechazoConfirmado',
      dni,
      rol_id: rolDocente,
    })
    modo = 'normal'
    retirarInyecciones()

    afirmar(
      contar(`FROM public.perfiles WHERE dni = '${dni}'`) === 0,
      'la reconciliación confirmó que no había ninguna fila'
    )
    afirmar(
      contar(`FROM auth.users WHERE email = '${email}'`) === 0,
      'y por eso sí se compensó la cuenta de Auth'
    )
    afirmar(r.estado >= 400, `y el alta se informa como fallida (estado ${r.estado})`)
  }
}

// ================================================================
// Arranque, ejecución y cierre
// ================================================================
let salidaFinal = 0

try {
  await new Promise((resolver, rechazar) => {
    proxy.once('error', rechazar)
    proxy.listen(PUERTO_PROXY, '127.0.0.1', resolver)
  })
  console.log(`Intermediario escuchando en 127.0.0.1:${PUERTO_PROXY}`)

  servidor = spawn('npx', ['next', 'dev', '--port', String(PUERTO_APP)], {
    env: entornoDelServidor(),
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let registro = ''
  servidor.stdout.on('data', (t) => {
    registro += t
  })
  servidor.stderr.on('data', (t) => {
    registro += t
  })

  if (!(await esperarAlServidor())) {
    console.error(registro.slice(-2000))
    throw new Error('el servidor de la aplicación no llegó a atender peticiones')
  }
  console.log(`Aplicación escuchando en ${APP}`)

  cookie = await cookieDeDirectora()
  await principal()
} catch (error) {
  fallos += 1
  console.error(`FALLO  ${error instanceof Error ? error.message : String(error)}`)
} finally {
  limpiar()
  await detener(servidor)
  await new Promise((resolver) => proxy.close(resolver))

  // El puerto tiene que quedar libre: si no, la próxima corrida mediría otra cosa.
  let libre = true
  try {
    await fetch(`${APP}/login`, { signal: AbortSignal.timeout(2000) })
    libre = false
  } catch {
    libre = true
  }
  afirmar(libre, `el puerto ${PUERTO_APP} quedó libre al terminar`)
}

if (fallos > 0) {
  console.error(`\n${fallos} afirmación(es) incumplida(s).`)
  salidaFinal = 1
}
if (salidaFinal === 0) console.log('\nTodas las afirmaciones se cumplieron.')
process.exitCode = salidaFinal
