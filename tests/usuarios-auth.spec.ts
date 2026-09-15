import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { capturarSinHerramientas } from './_captura'
import { exigirMensajeSinDetalleTecnico, exigirPantallaSinDetalleTecnico } from './_sin-detalle-tecnico'
import { exigirSinControlesAnidados } from './_semantica'
import {
  expect,
  request as crearContexto,
  test,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from '@playwright/test'

/**
 * Alta de cuentas de acceso (`POST /api/usuarios`) y panel de Usuarios.
 *
 * Estas pruebas atraviesan la ruta real, Auth real y PostgreSQL real. Cuando una
 * afirmación dice que no quedó una fila, es porque se consultó la base.
 *
 * Desde la cuarta revisión el alta es atómica: la migración 010 crea el perfil
 * dentro de la misma transacción en la que GoTrue crea la cuenta. Un rechazo de
 * PostgreSQL ya no «borra la cuenta después»: la cuenta nunca llega a existir.
 * Las situaciones de transporte ambiguo —respuesta perdida, escritura en vuelo,
 * caída del servidor— se prueban con un intermediario real en
 * `supabase/tests/usuarios_reconciliacion.mjs`.
 *
 * Los datos son sintéticos. Los DNI usan el rango 97.xxx.xxx y los correos un
 * dominio reservado; ninguno corresponde a una persona real.
 */

test.skip(
  process.env.EPT_SUPABASE_LOCAL !== '1',
  'Requiere EPT_SUPABASE_LOCAL=1 y un reset de la base local.'
)

const PREFIJO_DNI = '97'
const DOMINIO = 'ept.local'
const BASE_URL = 'http://localhost:3000'

const CONTENEDOR =
  process.env.EPT_SUPABASE_DB_CONTAINER ?? 'supabase_db_educar-para-transformar'

const MENSAJE_VINCULO =
  'Los vínculos entre padres o tutores e hijos todavía no están disponibles.'

/** Marca que hace fallar la escritura del perfil dentro de la transacción de alta. */
const APELLIDO_QUE_FALLA = 'FalloForzadoDePrueba'

const PATRON_REFERENCIA = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u

/** Ejecuta SQL en la base local descartable y devuelve la salida. */
function sql(sentencia: string) {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTENEDOR, 'psql', '-X', '-q', '-A', '-t', '-U', 'postgres',
     '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    { input: sentencia, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim()
}

function contar(consulta: string) {
  return Number(sql(`SELECT pg_catalog.count(*) ${consulta};`))
}

function instalarFalloDePersistencia() {
  sql(`
    CREATE OR REPLACE FUNCTION public.rechazar_apellido_de_prueba()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $fn$
    BEGIN
        IF NEW.apellido = '${APELLIDO_QUE_FALLA}' THEN
            RAISE EXCEPTION 'Fallo inyectado por la suite de pruebas de EPT-9.';
        END IF;
        RETURN NEW;
    END;
    $fn$;

    DROP TRIGGER IF EXISTS trg_rechazar_apellido_de_prueba ON public.perfiles;
    CREATE TRIGGER trg_rechazar_apellido_de_prueba
        BEFORE INSERT ON public.perfiles
        FOR EACH ROW EXECUTE FUNCTION public.rechazar_apellido_de_prueba();
  `)
}

function retirarFalloDePersistencia() {
  sql(`
    DROP TRIGGER IF EXISTS trg_rechazar_apellido_de_prueba ON public.perfiles;
    DROP FUNCTION IF EXISTS public.rechazar_apellido_de_prueba();
  `)
}

function rolId(nombre: string) {
  return Number(sql(`SELECT id FROM public.roles WHERE nombre = '${nombre}';`))
}

/**
 * Opción del selector de rol con ese nombre exacto.
 *
 * La pantalla dibuja el formulario antes de terminar la carga, así que las
 * opciones se esperan con una aserción que reintenta: una lectura instantánea
 * puede encontrar solo «Seleccionar rol...».
 */
function opcionDeRol(page: Page, nombre: string) {
  return page.getByLabel(/^Rol/).locator('option', { hasText: new RegExp(`^${nombre}$`, 'u') })
}

type MensajeDeConsola = { tipo: string; texto: string }

/** Registra los mensajes de consola del navegador. Se llama antes de navegar. */
function registrarConsola(page: Page) {
  const mensajes: MensajeDeConsola[] = []
  page.on('console', (mensaje) => mensajes.push({ tipo: mensaje.type(), texto: mensaje.text() }))
  return mensajes
}

/** Deja la base como estaba: borra todo lo que creó esta suite. */
function limpiar() {
  retirarFalloDePersistencia()
  sql(`
    BEGIN;
    DELETE FROM public.matriculas
      WHERE alumno_id IN (SELECT id FROM public.perfiles WHERE dni LIKE '${PREFIJO_DNI}%');
    DELETE FROM public.alumnos
      WHERE perfil_id IN (SELECT id FROM public.perfiles WHERE dni LIKE '${PREFIJO_DNI}%');
    DELETE FROM public.perfiles WHERE dni LIKE '${PREFIJO_DNI}%';
    COMMIT;

    DELETE FROM auth.users WHERE email LIKE 'alta.prueba.%@${DOMINIO}';
  `)
}

// La limpieza pertenece al proyecto de la directora, que es el que crea datos.
// Si corriera también en el proyecto de otro actor, podría borrar a mitad de
// camino las filas en las que se apoyan las pruebas de la directora.
test.beforeAll(() => {
  if (process.env.EPT_SUPABASE_LOCAL !== '1') return
  if (test.info().project.name !== 'chromium-directora') return
  limpiar()
})

test.afterAll(() => {
  if (process.env.EPT_SUPABASE_LOCAL !== '1') return
  if (test.info().project.name !== 'chromium-directora') return
  limpiar()
})

type Alta = {
  operacion_id?: string
  email: string
  password: string
  nombre: string
  apellido: string
  dni: string
  rol_id: number
  legajo_nro?: string
  tutor_id?: string
  hijos_ids?: string[]
}

function datosDeAlta(datos: Partial<Alta> & { dni: string }): Alta {
  return {
    operacion_id: randomUUID(),
    email: `alta.prueba.${datos.dni}@${DOMINIO}`,
    password: 'prueba-ept-9-alta-segura',
    nombre: 'Alta',
    apellido: 'DePrueba',
    rol_id: rolId('ESTUDIANTE'),
    ...datos,
  }
}

function crear(peticion: APIRequestContext, datos: Partial<Alta> & { dni: string }) {
  return peticion.post('/api/usuarios', { data: datosDeAlta(datos) })
}

/**
 * Alta de referencia sobre la que se prueban los duplicados.
 *
 * Tiene una operación fija, así que pedirla otra vez es idempotente: cada
 * prueba que la necesita la asegura por su cuenta. Playwright reinicia el
 * worker después de un fallo y vuelve a correr `beforeAll`, que limpia la base;
 * una prueba que dependiera de lo que dejó otra fallaría en cascada.
 */
const ALTA_BASE = {
  operacion_id: '97100001-0000-4000-8000-000000000001',
  email: `alta.prueba.${PREFIJO_DNI}100001@${DOMINIO}`,
  password: 'prueba-ept-9-alta-segura',
  nombre: 'Lucía',
  apellido: 'SinTutor',
  dni: `${PREFIJO_DNI}100001`,
  legajo_nro: 'LEG-ALTA-0001',
}

async function asegurarAltaBase(peticion: APIRequestContext) {
  const respuesta = await peticion.post('/api/usuarios', {
    data: { ...ALTA_BASE, rol_id: rolId('ESTUDIANTE') },
  })
  expect(respuesta.status(), await respuesta.text()).toBe(200)
  return (await respuesta.json()) as { ok: true; user_id: string; reconciliada: boolean }
}

/** Lee una respuesta de error y exige que su mensaje sea de dominio. */
async function errorDeDominio(respuesta: APIResponse, contexto: string) {
  const cuerpo = await respuesta.json()
  expect(typeof cuerpo.error, `${contexto}: trae un mensaje`).toBe('string')
  expect(typeof cuerpo.codigo, `${contexto}: trae un código de dominio`).toBe('string')
  exigirMensajeSinDetalleTecnico(contexto, cuerpo.error)
  return cuerpo as { error: string; codigo: string; referencia?: string; campo?: string }
}

// ================================================================
// La ruta de alta
// ================================================================
test.describe('DIRECTOR autenticado: el alta de cuentas es atómica y no deja estados a medias', () => {
  test('crea un estudiante sin tutor y persiste perfil, legajo académico y cuenta', async ({
    request,
  }) => {
    const dni = ALTA_BASE.dni

    const alta = await asegurarAltaBase(request)
    expect(alta.user_id).toBe(ALTA_BASE.operacion_id)

    expect(contar(`FROM public.perfiles WHERE dni = '${dni}'`)).toBe(1)
    expect(
      contar(
        `FROM public.alumnos a JOIN public.perfiles p ON p.id = a.perfil_id
         WHERE p.dni = '${dni}'`
      )
    ).toBe(1)
    expect(contar(`FROM auth.users WHERE email = 'alta.prueba.${dni}@${DOMINIO}'`)).toBe(1)

    // Un estudiante recién dado de alta queda INACTIVO y sin matrícula.
    expect(
      sql(
        `SELECT a.estado FROM public.alumnos a
         JOIN public.perfiles p ON p.id = a.perfil_id WHERE p.dni = '${dni}';`
      )
    ).toBe('INACTIVO')

    // Los datos personales viajaron por app_metadata y no quedaron en la cuenta.
    expect(contar(`FROM auth.users WHERE raw_app_meta_data ? 'ept_alta'`)).toBe(0)
  })

  test('el tutor no es obligatorio: el alta funciona sin mencionarlo', async ({ request }) => {
    const dni = `${PREFIJO_DNI}100002`
    const respuesta = await crear(request, { dni, apellido: 'SinMencion' })
    expect(respuesta.status(), await respuesta.text()).toBe(200)
    expect(contar(`FROM public.perfiles WHERE dni = '${dni}'`)).toBe(1)
  })

  test('pedir un vínculo parental se rechaza con un mensaje claro y no escribe nada', async ({
    request,
  }) => {
    const dni = `${PREFIJO_DNI}100003`
    await asegurarAltaBase(request)
    const tutor = sql(`SELECT id FROM public.perfiles WHERE dni = '${ALTA_BASE.dni}';`)
    expect(tutor).toMatch(/^[0-9a-f-]{36}$/u)

    const respuesta = await crear(request, { dni, tutor_id: tutor })

    expect(respuesta.status()).toBe(400)
    const cuerpo = await errorDeDominio(respuesta, 'vínculo parental')
    expect(cuerpo.codigo).toBe('VINCULO_NO_DISPONIBLE')
    expect(cuerpo.error).toContain(MENSAJE_VINCULO)
    expect(contar(`FROM public.perfiles WHERE dni = '${dni}'`)).toBe(0)
    expect(contar(`FROM auth.users WHERE email = 'alta.prueba.${dni}@${DOMINIO}'`)).toBe(0)
  })

  test('el alta sin tutor no modifica los vínculos familiares', async ({ request }) => {
    const dni = `${PREFIJO_DNI}100004`
    const relacionesAntes = contar('FROM public.padres_hijos')
    const respuesta = await crear(request, { dni, apellido: 'SinPadresHijos' })
    expect(respuesta.status(), await respuesta.text()).toBe(200)
    expect(contar('FROM public.padres_hijos')).toBe(relacionesAntes)
  })

  test('una petición inválida no crea cuenta, ni perfil, ni legajo académico', async ({
    request,
  }) => {
    const dni = `${PREFIJO_DNI}100005`
    const respuesta = await request.post('/api/usuarios', {
      data: { ...datosDeAlta({ dni }), apellido: 'Invalida', dni: '123' },
    })

    expect(respuesta.status()).toBe(400)
    const cuerpo = await errorDeDominio(respuesta, 'DNI inválido')
    expect(cuerpo.codigo).toBe('DATOS_INVALIDOS')
    expect(cuerpo.campo).toBe('dni')
    expect(contar(`FROM auth.users WHERE email = 'alta.prueba.${dni}@${DOMINIO}'`)).toBe(0)
    expect(contar(`FROM public.perfiles WHERE dni IN ('123', '${dni}')`)).toBe(0)
  })

  test('los datos de tipo equivocado reciben mensajes en español, nunca los de Zod', async ({
    request,
  }) => {
    const dni = `${PREFIJO_DNI}100013`
    const casos: [string, Record<string, unknown>, string][] = [
      ['rol como texto', { rol_id: 'cuatro' }, 'Rol inválido'],
      ['vínculo con formato inválido', { hijos_ids: ['no-es-un-uuid'] }, 'Vínculo inválido'],
      ['operación con formato inválido', { operacion_id: 'abc' }, 'El envío no tiene un identificador válido. Recargá la página.'],
      ['email ausente', { email: undefined }, 'Revisá los datos ingresados.'],
    ]
    for (const [contexto, cambio, mensaje] of casos) {
      const respuesta = await request.post('/api/usuarios', { data: { ...datosDeAlta({ dni }), ...cambio } })
      expect(respuesta.status(), contexto).toBe(400)
      const cuerpo = await errorDeDominio(respuesta, contexto)
      expect(cuerpo.codigo, contexto).toBe('DATOS_INVALIDOS')
      expect(cuerpo.error, contexto).toBe(mensaje)
    }
    expect(contar(`FROM public.perfiles WHERE dni = '${dni}'`)).toBe(0)
  })

  test('un cuerpo que no es JSON se rechaza con un mensaje de dominio', async ({ request }) => {
    // Como Buffer: con `content-type: application/json`, Playwright serializa
    // una cadena como JSON y el cuerpo llegaría bien formado.
    const respuesta = await request.post('/api/usuarios', {
      headers: { 'content-type': 'application/json' },
      data: Buffer.from('{esto no es json', 'utf8'),
    })
    expect(respuesta.status()).toBe(400)
    expect((await errorDeDominio(respuesta, 'cuerpo inválido')).codigo).toBe('CUERPO_INVALIDO')
  })

  test('un rol inexistente se explica antes de intentar nada', async ({ request }) => {
    const dni = `${PREFIJO_DNI}100014`
    const respuesta = await crear(request, { dni, rol_id: 999999 })
    expect(respuesta.status()).toBe(422)
    expect((await errorDeDominio(respuesta, 'rol inexistente')).codigo).toBe('ROL_INEXISTENTE')
    expect(contar(`FROM auth.users WHERE email = 'alta.prueba.${dni}@${DOMINIO}'`)).toBe(0)
  })

  test('si PostgreSQL rechaza el perfil, la cuenta tampoco llega a existir', async ({
    request,
  }) => {
    const dni = `${PREFIJO_DNI}100006`
    const email = `alta.prueba.${dni}@${DOMINIO}`
    const legajo = 'LEG-ALTA-0006'
    const datos = datosDeAlta({ dni, apellido: APELLIDO_QUE_FALLA, legajo_nro: legajo })

    instalarFalloDePersistencia()
    try {
      const respuesta = await request.post('/api/usuarios', { data: datos })

      expect(respuesta.status()).toBe(422)
      const cuerpo = await errorDeDominio(respuesta, 'rechazo de PostgreSQL')
      expect(cuerpo.codigo).toBe('ALTA_RECHAZADA')
      expect(cuerpo.referencia).toMatch(PATRON_REFERENCIA)

      // No hay nada que compensar: la transacción revirtió cuenta y perfil juntos.
      expect(contar(`FROM auth.users WHERE email = '${email}'`)).toBe(0)
      expect(contar(`FROM auth.users WHERE id = '${datos.operacion_id}'`)).toBe(0)
      expect(contar(`FROM public.perfiles WHERE dni = '${dni}'`)).toBe(0)
      expect(contar(`FROM public.perfiles WHERE legajo_nro = '${legajo}'`)).toBe(0)
      expect(
        contar(
          `FROM public.alumnos a LEFT JOIN public.perfiles p ON p.id = a.perfil_id
           WHERE p.id IS NULL`
        )
      ).toBe(0)
    } finally {
      retirarFalloDePersistencia()
    }

    // La misma operación, con el rechazo retirado, se completa: nada quedó bloqueado.
    const reintento = await request.post('/api/usuarios', {
      data: { ...datos, apellido: 'Reintento' },
    })
    expect(reintento.status(), await reintento.text()).toBe(200)
    expect(contar(`FROM public.perfiles WHERE dni = '${dni}'`)).toBe(1)
    expect(contar(`FROM auth.users WHERE email = '${email}'`)).toBe(1)
  })

  test('un DNI ya usado se rechaza antes de crear la cuenta de Auth', async ({ request }) => {
    await asegurarAltaBase(request)
    const dniOcupado = ALTA_BASE.dni
    const email = `alta.prueba.${PREFIJO_DNI}100007@${DOMINIO}`

    const respuesta = await request.post('/api/usuarios', {
      data: { ...datosDeAlta({ dni: dniOcupado }), email, apellido: 'DniRepetido' },
    })

    expect(respuesta.status()).toBe(409)
    const cuerpo = await errorDeDominio(respuesta, 'DNI duplicado')
    expect(cuerpo.codigo).toBe('DNI_DUPLICADO')
    expect(cuerpo.error).toContain('DNI')
    expect(contar(`FROM auth.users WHERE email = '${email}'`)).toBe(0)
  })

  test('un legajo existente que solo cambia en mayúsculas también es un duplicado', async ({
    request,
  }) => {
    await asegurarAltaBase(request)
    const dni = `${PREFIJO_DNI}100015`
    const respuesta = await crear(request, { dni, legajo_nro: ALTA_BASE.legajo_nro.toLowerCase() })
    expect(respuesta.status()).toBe(409)
    expect((await errorDeDominio(respuesta, 'legajo duplicado')).codigo).toBe('LEGAJO_DUPLICADO')
    expect(contar(`FROM auth.users WHERE email = 'alta.prueba.${dni}@${DOMINIO}'`)).toBe(0)
  })

  test('un email ya registrado se informa como duplicado sin crear otro perfil', async ({
    request,
  }) => {
    await asegurarAltaBase(request)
    const dni = `${PREFIJO_DNI}100016`
    const respuesta = await crear(request, { dni, email: ALTA_BASE.email })
    expect(respuesta.status()).toBe(409)
    expect((await errorDeDominio(respuesta, 'email duplicado')).codigo).toBe('EMAIL_DUPLICADO')
    expect(contar(`FROM public.perfiles WHERE dni = '${dni}'`)).toBe(0)
  })

  test('un legajo con coma es un legajo válido y no rompe la comprobación previa', async ({
    request,
  }) => {
    const dni = `${PREFIJO_DNI}100008`
    const respuesta = await crear(request, { dni, apellido: 'ConComa', legajo_nro: 'LEG,2027,008' })
    expect(respuesta.status(), await respuesta.text()).toBe(200)
    expect(contar(`FROM public.perfiles WHERE legajo_nro = 'LEG,2027,008'`)).toBe(1)
  })

  test('los roles ajenos a esta historia conservan su comportamiento', async ({ request }) => {
    for (const [rol, sufijo] of [
      ['DOCENTE', '100010'],
      ['PADRE', '100011'],
      ['PERSONAL', '100012'],
    ] as const) {
      const dni = `${PREFIJO_DNI}${sufijo}`
      const respuesta = await crear(request, { dni, apellido: `Rol${rol}`, rol_id: rolId(rol) })
      expect(respuesta.status(), `${rol}: ${await respuesta.text()}`).toBe(200)
      expect(contar(`FROM public.perfiles WHERE dni = '${dni}'`)).toBe(1)
      expect(
        contar(
          `FROM public.alumnos a JOIN public.perfiles p ON p.id = a.perfil_id
           WHERE p.dni = '${dni}'`
        )
      ).toBe(0)
    }
  })

  test('repetir la misma operación confirma el alta existente sin duplicarla', async ({
    request,
  }) => {
    const datos = datosDeAlta({ dni: `${PREFIJO_DNI}100017`, apellido: 'Repetida' })
    const primera = await request.post('/api/usuarios', { data: datos })
    expect(primera.status(), await primera.text()).toBe(200)
    expect((await primera.json()).reconciliada).toBe(false)

    const segunda = await request.post('/api/usuarios', { data: datos })
    expect(segunda.status(), await segunda.text()).toBe(200)
    const cuerpo = await segunda.json()
    expect(cuerpo.reconciliada).toBe(true)
    expect(cuerpo.user_id).toBe(datos.operacion_id)

    expect(contar(`FROM auth.users WHERE email = '${datos.email}'`)).toBe(1)
    expect(contar(`FROM public.perfiles WHERE dni = '${datos.dni}'`)).toBe(1)
  })

  test('la misma operación con otra identidad se rechaza y no toca la existente', async ({
    request,
  }) => {
    const datos = datosDeAlta({ dni: `${PREFIJO_DNI}100018`, apellido: 'Original' })
    expect((await request.post('/api/usuarios', { data: datos })).status()).toBe(200)

    const otra = {
      ...datos,
      dni: `${PREFIJO_DNI}100019`,
      email: `alta.prueba.${PREFIJO_DNI}100019@${DOMINIO}`,
      apellido: 'Impostora',
    }
    const respuesta = await request.post('/api/usuarios', { data: otra })
    expect(respuesta.status()).toBe(409)
    expect((await errorDeDominio(respuesta, 'operación reutilizada')).codigo).toBe('OPERACION_REUTILIZADA')

    expect(sql(`SELECT apellido FROM public.perfiles WHERE user_id = '${datos.operacion_id}';`)).toBe('Original')
    expect(contar(`FROM public.perfiles WHERE dni = '${otra.dni}'`)).toBe(0)
    expect(contar(`FROM auth.users WHERE email = '${otra.email}'`)).toBe(0)
  })

  test('sin sesión la ruta responde 401 con un mensaje de dominio', async () => {
    // El estado de sesión vacío es explícito: dentro del proyecto de la
    // directora, un contexto nuevo hereda su `storageState` si no se le indica otro.
    const anonimo = await crearContexto.newContext({
      baseURL: BASE_URL,
      storageState: { cookies: [], origins: [] },
    })
    try {
      const respuesta = await anonimo.post('/api/usuarios', {
        data: datosDeAlta({ dni: `${PREFIJO_DNI}100020` }),
      })
      expect(respuesta.status()).toBe(401)
      expect((await errorDeDominio(respuesta, 'sin sesión')).codigo).toBe('NO_AUTENTICADO')
    } finally {
      await anonimo.dispose()
    }
  })
})

test.describe('DOCENTE autenticado: el alta de cuentas', () => {
  test('recibe 403 con un mensaje de dominio y no crea nada', async ({ request }) => {
    const dni = `${PREFIJO_DNI}100021`
    const respuesta = await request.post('/api/usuarios', { data: datosDeAlta({ dni }) })
    expect(respuesta.status()).toBe(403)
    expect((await errorDeDominio(respuesta, 'docente')).codigo).toBe('SIN_PERMISO')
    expect(contar(`FROM auth.users WHERE email = 'alta.prueba.${dni}@${DOMINIO}'`)).toBe(0)
  })
})

// ================================================================
// El panel real
// ================================================================
async function completarFormulario(page: Page, dni: string, apellido: string) {
  await page.getByLabel(/^Nombre/).fill('Valentina')
  await page.getByLabel(/^Apellido/).fill(apellido)
  await page.getByLabel(/^DNI/).fill(dni)
  await page.getByLabel(/^Rol/).selectOption({ label: 'ESTUDIANTE' })
  await page.getByLabel(/^Email/).fill(`alta.prueba.${dni}@${DOMINIO}`)
  await page.getByLabel(/^Contraseña/).fill('prueba-ept-9-panel-seguro')
}

const AVISO_ALTA = 'No se completó el alta'

test.describe('DIRECTOR autenticado: el panel de usuarios carga, da de alta y explica los fallos', () => {
  test('la tabla de vínculos existe en el esquema reproducible', () => {
    expect(
      contar(
        `FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'padres_hijos'`
      )
    ).toBe(1)
  })

  test('carga roles, perfiles y vínculos familiares', async ({ page }) => {
    const peticiones: { metodo: string; url: string; estado: number }[] = []
    page.on('response', (respuesta) => {
      if (!respuesta.url().includes('padres_hijos')) return
      peticiones.push({
        metodo: respuesta.request().method(),
        url: respuesta.url(),
        estado: respuesta.status(),
      })
    })

    await page.goto('/dashboard/usuarios')
    await expect(page.getByRole('heading', { name: 'Gestión de usuarios' })).toBeVisible()

    for (const nombre of ['ESTUDIANTE', 'DOCENTE', 'DIRECTOR']) {
      await expect(opcionDeRol(page, nombre)).toHaveCount(1)
    }

    const listado = page.getByLabel('Usuarios registrados')
    await expect(listado).toContainText('Directora')
    await expect(
      page.getByRole('alert').filter({ hasText: 'No pudimos cargar la gestión de usuarios' })
    ).toHaveCount(0)

    expect(peticiones.length).toBeGreaterThan(0)
    for (const peticion of peticiones) {
      expect(peticion.metodo, `no debe escribir en padres_hijos: ${peticion.url}`).toBe('GET')
      expect(peticion.estado, 'la lectura autenticada debe prosperar').toBe(200)
    }

    await exigirSinControlesAnidados(page, 'panel de usuarios')
    await exigirPantallaSinDetalleTecnico(page, 'panel de usuarios cargado')
  })

  test('crea un ESTUDIANTE sin tutor desde el formulario y persiste tras recargar', async ({
    page,
  }) => {
    const dni = `${PREFIJO_DNI}200001`
    const email = `alta.prueba.${dni}@${DOMINIO}`

    await page.goto('/dashboard/usuarios')
    await expect(page.getByRole('heading', { name: 'Nuevo usuario' })).toBeVisible()
    await completarFormulario(page, dni, 'DesdeElPanel')
    await page.getByLabel(/^Legajo/).fill('LEG-PANEL-0001')
    await expect(page.getByText(/vínculos entre padres o tutores/i)).toBeVisible()

    await page.getByRole('button', { name: 'Crear usuario' }).click()

    const listado = page.getByLabel('Usuarios registrados')
    await expect(listado).toContainText('DesdeElPanel', { timeout: 15_000 })
    await page.reload()
    await expect(page.getByLabel('Usuarios registrados')).toContainText('DesdeElPanel', {
      timeout: 15_000,
    })

    expect(contar(`FROM public.perfiles WHERE dni = '${dni}'`)).toBe(1)
    expect(contar(`FROM auth.users WHERE email = '${email}'`)).toBe(1)
    expect(
      contar(
        `FROM public.alumnos a JOIN public.perfiles p ON p.id = a.perfil_id
         WHERE p.dni = '${dni}'`
      )
    ).toBe(1)
    expect(
      contar(
        `FROM auth.users u LEFT JOIN public.perfiles p ON p.user_id = u.id
         WHERE u.email LIKE 'alta.prueba.%@${DOMINIO}' AND p.id IS NULL`
      )
    ).toBe(0)
  })

  test('un DNI duplicado se explica en el campo y en un aviso persistente', async ({
    page,
    request,
  }) => {
    await asegurarAltaBase(request)
    await page.goto('/dashboard/usuarios')
    await completarFormulario(page, ALTA_BASE.dni, 'DuplicadoPanel')
    // El email es nuevo: el rechazo tiene que venir del DNI.
    await page.getByLabel(/^Email/).fill(`alta.prueba.${PREFIJO_DNI}200002@${DOMINIO}`)
    await page.getByRole('button', { name: 'Crear usuario' }).click()

    const aviso = page.getByRole('alert').filter({ hasText: AVISO_ALTA })
    await expect(aviso).toContainText('Ya existe una persona registrada con ese DNI.')
    await expect(page.locator('#dni-error')).toHaveText('Ya existe una persona registrada con ese DNI.')
    await expect(page.getByLabel(/^DNI/).first()).toHaveAttribute('aria-invalid', 'true')
    await exigirPantallaSinDetalleTecnico(page, 'DNI duplicado en el formulario')
    expect(contar(`FROM auth.users WHERE email = 'alta.prueba.${PREFIJO_DNI}200002@${DOMINIO}'`)).toBe(0)
  })

  test('si la respuesta del alta se pierde, la pantalla lo dice y el reintento no duplica', async ({
    page,
  }) => {
    const dni = `${PREFIJO_DNI}200003`
    const email = `alta.prueba.${dni}@${DOMINIO}`

    // La primera petición llega al servidor y confirma; lo que se pierde es la
    // respuesta. Es el caso que antes terminaba en una cuenta borrada.
    let perdidas = 0
    await page.route('**/api/usuarios', async (ruta) => {
      if (perdidas > 0) return ruta.fallback()
      perdidas += 1
      await ruta.fetch()
      await ruta.abort('connectionreset')
    })

    await page.goto('/dashboard/usuarios')
    await completarFormulario(page, dni, 'RespuestaPerdida')
    await page.getByRole('button', { name: 'Crear usuario' }).click()

    const aviso = page.getByRole('alert').filter({ hasText: AVISO_ALTA })
    await expect(aviso).toContainText('No pudimos confirmar si la cuenta se creó.')
    await expect(aviso).toContainText('No se borró ningún dato.')
    await exigirPantallaSinDetalleTecnico(page, 'respuesta perdida')

    // La cuenta existe y está completa: nada se borró.
    expect(contar(`FROM auth.users WHERE email = '${email}'`)).toBe(1)
    expect(contar(`FROM public.perfiles WHERE dni = '${dni}'`)).toBe(1)
    // Y el listado se volvió a cargar para que la directora pueda comprobarlo.
    await expect(page.getByLabel('Usuarios registrados')).toContainText('RespuestaPerdida', { timeout: 15_000 })

    // Reintentar desde el mismo formulario reutiliza la operación: confirma, no duplica.
    await page.getByRole('button', { name: 'Crear usuario' }).click()
    await expect(page.getByText(`Usuario creado: ${email}`)).toBeVisible({ timeout: 15_000 })
    expect(contar(`FROM auth.users WHERE email = '${email}'`)).toBe(1)
    expect(contar(`FROM public.perfiles WHERE dni = '${dni}'`)).toBe(1)
  })

  test('una respuesta sin código de dominio nunca se muestra tal cual', async ({ page }) => {
    const respuestas = [
      { status: 502, contentType: 'text/html', body: '<html><body>502 Bad Gateway nginx</body></html>' },
      {
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'duplicate key value violates unique constraint "perfiles_dni_key"' }),
      },
      {
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Database error creating new user', code: 'unexpected_failure' }),
      },
    ]
    for (const [indice, respuesta] of respuestas.entries()) {
      await page.unrouteAll({ behavior: 'ignoreErrors' })
      await page.route('**/api/usuarios', (ruta) => ruta.fulfill(respuesta))
      await page.goto('/dashboard/usuarios')
      await completarFormulario(page, `${PREFIJO_DNI}20001${indice}`, 'Intermediario')
      await page.getByRole('button', { name: 'Crear usuario' }).click()

      const aviso = page.getByRole('alert').filter({ hasText: AVISO_ALTA })
      await expect(aviso).toContainText('No pudimos confirmar si la cuenta se creó.')
      await exigirPantallaSinDetalleTecnico(page, `respuesta sin código ${respuesta.status} ${indice}`)
    }
  })

  test('una conexión cortada al crear no muestra el error del navegador', async ({ page }) => {
    await page.route('**/api/usuarios', (ruta) => ruta.abort('connectionfailed'))
    await page.goto('/dashboard/usuarios')
    await completarFormulario(page, `${PREFIJO_DNI}200020`, 'Cortada')
    await page.getByRole('button', { name: 'Crear usuario' }).click()
    await expect(page.getByRole('alert').filter({ hasText: AVISO_ALTA })).toContainText(
      'No pudimos confirmar si la cuenta se creó.'
    )
    await exigirPantallaSinDetalleTecnico(page, 'conexión cortada al crear')
  })

  test('el DIRECTOR edita los campos permitidos y el cambio persiste', async ({ page }) => {
    // La reconciliación otorga UPDATE solo sobre los campos editables y la
    // política RLS exige DIRECTOR. La interfaz debe confirmar la escritura real.
    const nombreNuevo = 'CambioPermitido'
    await page.goto('/dashboard/usuarios')
    const fila = page.getByLabel('Usuarios registrados').getByRole('row').filter({ hasText: '99900004' })
    await fila.getByRole('button', { name: 'Editar' }).click()
    await page.getByLabel('Nombre', { exact: true }).last().fill(nombreNuevo)
    const respuestaGuardado = page.waitForResponse(
      (respuesta) =>
        respuesta.request().method() === 'PATCH' &&
        respuesta.url().includes('/rest/v1/perfiles?')
    )
    await page.getByRole('button', { name: 'Guardar cambios' }).click()
    const respuesta = await respuestaGuardado

    expect(respuesta.request().postDataJSON()).toMatchObject({ nombre: nombreNuevo })
    expect(respuesta.status(), await respuesta.text()).toBe(200)
    await expect(page.getByText('Usuario actualizado')).toBeVisible()
    await expect(page.getByText('Editar usuario')).toHaveCount(0)
    expect(sql(`SELECT nombre FROM public.perfiles WHERE dni = '99900004';`)).toBe(nombreNuevo)
  })

  for (const caso of [
    {
      nombre: 'un DNI duplicado',
      respuesta: {
        status: 409,
        body: {
          code: '23505',
          details: 'Key (dni)=(99900001) already exists.',
          hint: null,
          message: 'duplicate key value violates unique constraint "perfiles_dni_key"',
        },
      },
      mensaje: 'Ya existe una persona registrada con ese DNI.',
    },
    {
      nombre: 'un permiso denegado',
      respuesta: {
        status: 403,
        body: { code: '42501', details: null, hint: null, message: 'permission denied for table perfiles' },
      },
      mensaje: 'No tenés permiso para realizar esta operación.',
    },
    {
      nombre: 'una restricción sin nombre conocido',
      respuesta: {
        status: 409,
        body: { code: '23505', details: null, hint: null, message: 'duplicate key value violates unique constraint "otra_restriccion"' },
      },
      mensaje: 'Alguno de los datos ya está registrado para otra persona.',
    },
    {
      nombre: 'un tiempo agotado de PostgreSQL',
      respuesta: {
        status: 500,
        body: { code: '57014', details: null, hint: null, message: 'canceling statement due to statement timeout' },
      },
      mensaje: 'No pudimos completar la operación. Volvé a intentarlo en unos minutos.',
    },
  ]) {
    test(`al editar, ${caso.nombre} se muestra como mensaje de dominio`, async ({ page }) => {
      await page.route('**/rest/v1/perfiles?*', async (ruta) => {
        if (ruta.request().method() !== 'PATCH') return ruta.fallback()
        await ruta.fulfill({
          status: caso.respuesta.status,
          contentType: 'application/json',
          body: JSON.stringify(caso.respuesta.body),
        })
      })
      await page.goto('/dashboard/usuarios')
      const fila = page.getByLabel('Usuarios registrados').getByRole('row').filter({ hasText: '99900004' })
      await fila.getByRole('button', { name: 'Editar' }).click()
      await page.getByRole('button', { name: 'Guardar cambios' }).click()
      await expect(page.getByText(caso.mensaje)).toBeVisible()
      await exigirPantallaSinDetalleTecnico(page, `edición con ${caso.nombre}`)
    })
  }

  test('al editar, una conexión cortada se informa sin el error del navegador', async ({ page }) => {
    await page.route('**/rest/v1/perfiles?*', async (ruta) => {
      if (ruta.request().method() !== 'PATCH') return ruta.fallback()
      await ruta.abort('connectionfailed')
    })
    await page.goto('/dashboard/usuarios')
    const fila = page.getByLabel('Usuarios registrados').getByRole('row').filter({ hasText: '99900004' })
    await fila.getByRole('button', { name: 'Editar' }).click()
    await page.getByRole('button', { name: 'Guardar cambios' }).click()
    await expect(
      page.getByText('El servicio no está disponible en este momento. Volvé a intentarlo en unos minutos.')
    ).toBeVisible()
    await exigirPantallaSinDetalleTecnico(page, 'edición con conexión cortada')
  })

  test('un error de carga de roles no se oculta y no muestra detalle técnico', async ({ page }) => {
    // Se interviene `roles`, que solo pide esta página. Intervenir `perfiles`
    // no serviría: el contexto de sesión lee esa misma tabla y el panel
    // redirigiría a login antes de renderizar.
    await page.route('**/rest/v1/roles*', (ruta) =>
      ruta.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ code: '57014', details: null, hint: null, message: 'canceling statement due to statement timeout' }),
      })
    )
    await page.goto('/dashboard/usuarios')
    const aviso = page.getByRole('alert').filter({ hasText: 'No pudimos cargar la gestión de usuarios' })
    await expect(aviso).toContainText('No pudimos cargar los usuarios. Intentá nuevamente.')
    await expect(aviso.getByRole('button', { name: 'Reintentar' })).toBeVisible()
    await exigirPantallaSinDetalleTecnico(page, 'error de carga de roles')
  })

  test('el reintento vuelve a cargar cuando el fallo se resuelve', async ({ page }) => {
    let falla = true
    await page.route('**/rest/v1/roles*', async (ruta) => {
      if (!falla) return ruta.fallback()
      await ruta.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ code: '08006', message: 'connection failure' }),
      })
    })

    await page.goto('/dashboard/usuarios')
    const aviso = page.getByRole('alert').filter({ hasText: 'No pudimos cargar la gestión de usuarios' })
    await expect(aviso).toBeVisible()

    falla = false
    await aviso.getByRole('button', { name: 'Reintentar' }).click()
    await expect(aviso).toBeHidden()
    await expect(page.getByLabel(/^Rol/).locator('option')).not.toHaveCount(1)
  })
})

// ================================================================
// El clasificador de la ausencia conocida
// ================================================================
test.describe('DIRECTOR autenticado: solo la ausencia exacta de public.padres_hijos se tolera', () => {
  /**
   * Cada caso intercepta la lectura de `padres_hijos`, que es la única que llega
   * a `esAusenciaDeLaTablaDeVinculos`, y atraviesa el servicio y la pantalla
   * reales. Un clasificador demasiado permisivo convertiría cualquier tabla
   * ausente —o una caché de esquema desactualizada— en una lista vacía silenciosa.
   */

  const AVISO = 'No pudimos cargar la gestión de usuarios'
  const MENSAJE_ESTABLE = 'No pudimos cargar los usuarios. Intentá nuevamente.'

  async function interceptarVinculos(
    page: Page,
    respuesta: { status: number; cuerpo: unknown; tipo?: string } | 'cortar'
  ) {
    await page.route('**/rest/v1/padres_hijos*', async (ruta) => {
      if (respuesta === 'cortar') return ruta.abort('connectionfailed')
      await ruta.fulfill({
        status: respuesta.status,
        contentType: respuesta.tipo ?? 'application/json',
        body: typeof respuesta.cuerpo === 'string' ? respuesta.cuerpo : JSON.stringify(respuesta.cuerpo),
      })
    })
  }

  async function esperarPantallaSana(page: Page) {
    await expect(page.getByRole('heading', { name: 'Gestión de usuarios' })).toBeVisible()
    await expect(opcionDeRol(page, 'ESTUDIANTE')).toHaveCount(1)
    await expect(page.getByLabel('Usuarios registrados')).toContainText('Directora')
    await expect(page.getByRole('alert').filter({ hasText: AVISO })).toHaveCount(0)
  }

  async function esperarEstadoDeError(page: Page, espera = 5_000) {
    const aviso = page.getByRole('alert').filter({ hasText: AVISO })
    await expect(aviso).toBeVisible({ timeout: espera })
    await expect(aviso).toContainText(MENSAJE_ESTABLE)
    await expect(aviso.getByRole('button', { name: 'Reintentar' })).toBeVisible()
    await exigirPantallaSinDetalleTecnico(page, 'estado de error de carga')
  }

  const REGISTRO_DE_CARGA = '[usuarios] no se pudo cargar la pantalla'

  /**
   * Un fallo de carga manejado se registra como aviso y nunca como error.
   *
   * En desarrollo, Next trata cada `console.error` del navegador como un
   * defecto del código y abre su diálogo de error encima de la pantalla. La
   * falla ya se muestra con un reintento: no es un defecto. El mensaje llega
   * antes de que la pantalla muestre el aviso, así que al verlo ya se registró.
   */
  function exigirFalloRegistradoComoAviso(consola: MensajeDeConsola[]) {
    const registros = consola.filter((mensaje) => mensaje.texto.startsWith(REGISTRO_DE_CARGA))
    expect(registros.length, 'el fallo de carga no quedó registrado').toBeGreaterThan(0)
    expect(registros.filter((mensaje) => mensaje.tipo !== 'warning')).toEqual([])
  }

  const ausenciaPostgrest = (tabla: string) =>
    `Could not find the table '${tabla}' in the schema cache`

  const POSITIVOS = [
    {
      nombre: 'PGRST205 de public.padres_hijos',
      respuesta: { status: 404, cuerpo: { code: 'PGRST205', details: null, hint: null, message: ausenciaPostgrest('public.padres_hijos') } },
    },
    {
      nombre: '42P01 de public.padres_hijos',
      respuesta: { status: 404, cuerpo: { code: '42P01', details: null, hint: null, message: 'relation "public.padres_hijos" does not exist' } },
    },
  ]

  const NEGATIVOS = [
    ['padres_hijos_backup', { status: 404, cuerpo: { code: 'PGRST205', details: null, hint: null, message: ausenciaPostgrest('public.padres_hijos_backup') } }],
    ['padres_hijos_old', { status: 404, cuerpo: { code: 'PGRST205', details: null, hint: null, message: ausenciaPostgrest('public.padres_hijos_old') } }],
    ['otra_padres_hijos', { status: 404, cuerpo: { code: 'PGRST205', details: null, hint: null, message: ausenciaPostgrest('public.otra_padres_hijos') } }],
    ['roles', { status: 404, cuerpo: { code: 'PGRST205', details: null, hint: null, message: ausenciaPostgrest('public.roles') } }],
    ['matriculas', { status: 404, cuerpo: { code: 'PGRST205', details: null, hint: null, message: ausenciaPostgrest('public.matriculas') } }],
    ['el mismo mensaje con otro código', { status: 404, cuerpo: { code: 'PGRST204', details: null, hint: null, message: ausenciaPostgrest('public.padres_hijos') } }],
    ['el mismo código sin el esquema exacto', { status: 404, cuerpo: { code: 'PGRST205', details: null, hint: null, message: ausenciaPostgrest('padres_hijos') } }],
    ['el mismo código con texto agregado al mensaje', { status: 404, cuerpo: { code: 'PGRST205', details: null, hint: null, message: `${ausenciaPostgrest('public.padres_hijos')}. Perhaps you meant 'public.padres'` } }],
    ['42P01 sin el esquema exacto', { status: 404, cuerpo: { code: '42P01', details: null, hint: null, message: 'relation "padres_hijos" does not exist' } }],
    ['un permiso denegado sobre padres_hijos', { status: 403, cuerpo: { code: '42501', details: null, hint: null, message: 'permission denied for table padres_hijos' } }],
    ['el código y el mensaje exactos con un estado HTTP que no es 404', { status: 500, cuerpo: { code: 'PGRST205', details: null, hint: null, message: ausenciaPostgrest('public.padres_hijos') } }],
    ['un error sin código', { status: 500, cuerpo: { message: 'algo salió mal', details: null, hint: null } }],
    ['un cuerpo que no es un error de PostgREST', { status: 404, cuerpo: '<html>404</html>', tipo: 'text/html' }],
    ['un tiempo agotado de PostgreSQL', { status: 500, cuerpo: { code: '57014', details: null, hint: null, message: 'canceling statement due to statement timeout' } }],
  ] as const

  for (const positivo of POSITIVOS) {
    test(`tolera ${positivo.nombre} y la pantalla carga`, async ({ page }) => {
      const consola = registrarConsola(page)
      await interceptarVinculos(page, positivo.respuesta)
      await page.goto('/dashboard/usuarios')
      await esperarPantallaSana(page)
      expect(consola.filter((mensaje) => mensaje.texto.startsWith(REGISTRO_DE_CARGA))).toEqual([])
    })
  }

  for (const [nombre, respuesta] of NEGATIVOS) {
    test(`no tolera ${nombre}: muestra el estado de error sin detalle técnico`, async ({ page }) => {
      const consola = registrarConsola(page)
      await interceptarVinculos(page, respuesta)
      await page.goto('/dashboard/usuarios')
      await esperarEstadoDeError(page)
      exigirFalloRegistradoComoAviso(consola)

      if (nombre === 'roles' && process.env.EPT_CAPTURAS === '1') {
        await capturarSinHerramientas(page, 'docs/evidence/EPT-9/real-escritorio-usuarios-error-de-carga.png')
      }
    })
  }

  test('no tolera una conexión cortada y no deja la pantalla esperando', async ({ page }) => {
    // Con la conexión cortada, la promesa del cliente de Supabase no se resuelve
    // ni se rechaza. El límite de carga es lo que la convierte en un fallo visible.
    test.setTimeout(60_000)
    await interceptarVinculos(page, 'cortar')
    await page.goto('/dashboard/usuarios')
    await esperarEstadoDeError(page, 30_000)
  })
})
