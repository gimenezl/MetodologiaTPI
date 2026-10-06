/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  expect,
  request as crearContexto,
  test,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from '@playwright/test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { capturarSinHerramientas } from './_captura'
import { exigirMensajeSinDetalleTecnico, exigirPantallaSinDetalleTecnico } from './_sin-detalle-tecnico'

/**
 * Administración de tarifas con sesiones reales (EPT-103).
 *
 * No hay mocks en las rutas de API: cada petición atraviesa cookies SSR,
 * `auth.getUser()`, el control de rol del servidor, las RPC y PostgreSQL. Los
 * rechazos por importe, vigencia, superposición y conflicto de edición los
 * produce la base, no una comprobación previa de la aplicación. La pantalla se
 * prueba contra la base real; solo la falla de red y el doble envío interceptan
 * la petición del navegador para provocar esa condición.
 *
 * `psql` sobre el contenedor local se usa solo para PREPARAR y LIMPIAR datos y
 * para RELEER lo persistido; nunca participa de una operación que se esté
 * verificando. Todo lo que crean estas pruebas cuelga de deportes y de un nivel
 * con el prefijo «E2E Tarifas», o de fechas desde 2090 sobre referencias reales,
 * y se retira antes y después.
 *
 * El archivo se omite salvo que el operador habilite la base local descartable.
 */

test.skip(
  process.env.EPT_SUPABASE_LOCAL !== '1',
  'Requiere EPT_SUPABASE_LOCAL=1 y un reset de la base local.'
)

const SESION = {
  directora: 'tests/.auth/directora.json',
  directoraCierre: 'tests/.auth/directora-cierre.json',
  estudiante: 'tests/.auth/estudiante.json',
  docente: 'tests/.auth/docente.json',
  padre: 'tests/.auth/padre.json',
  personal: 'tests/.auth/personal.json',
  sinPerfil: 'tests/.auth/sin-perfil.json',
}

const BASE_URL = process.env.EPT_BASE_URL ?? 'http://localhost:3000'
const CAPTURAR = process.env.EPT_CAPTURAS === '1'
const CONTENEDOR = process.env.EPT_SUPABASE_DB_CONTAINER ?? 'supabase_db_educar-para-transformar'

const DEP_A = 'e1030000-0000-4000-8000-000000000001'
const DEP_B = 'e1030000-0000-4000-8000-000000000002'
const NOMBRE_DEP_A = 'E2E Tarifas A'
const NOMBRE_DEP_B = 'E2E Tarifas B'
const NIVEL_E2E = 'E2E TARIFAS NIVEL'
const CURSO = 'e1030000-0000-4000-8000-000000000011'
const ALUMNO = 'e1030000-0000-4000-8000-000000000021'
const MATRICULA = 'e1030000-0000-4000-8000-000000000031'
const FACTURA = 'e1030000-0000-4000-8000-000000000041'
const ITEM = 'e1030000-0000-4000-8000-000000000051'
const INEXISTENTE = '00000000-0000-4000-8000-000000000000'

const MENSAJE = {
  soloDireccion: 'Solo Dirección puede administrar las tarifas.',
  bloqueo: 'Tu acceso está bloqueado. Comunicate con Dirección.',
  sinSesion: 'Necesitás iniciar sesión para continuar.',
  decimales: 'El importe admite como máximo dos decimales.',
  negativo: 'El importe no puede ser negativo.',
  superposicion:
    'Esas fechas se superponen con otra versión de la tarifa para la misma referencia. Ajustá el inicio o el fin: cada día debe tener una sola tarifa.',
  conflicto:
    'Otra persona modificó esta tarifa mientras la editabas. No se guardó nada: recargá los datos y revisá los valores actuales antes de volver a intentarlo.',
}

const contextosActivos: APIRequestContext[] = []

test.afterEach(async () => {
  await Promise.all(contextosActivos.splice(0).map((contexto) => contexto.dispose()))
})

// ----------------------------------------------------------------
// Preparación, lectura y limpieza (solo base local)
// ----------------------------------------------------------------

function sql(sentencia: string) {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTENEDOR, 'psql', '-X', '-q', '-A', '-t', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    { input: sentencia, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim()
}

/** Retira todo lo que crean estas pruebas. Solo corre contra la base local descartable. */
function limpiar() {
  sql(`
    BEGIN;
    DELETE FROM public.items_factura WHERE factura_id = '${FACTURA}';
    DELETE FROM public.facturas WHERE alumno_id = '${ALUMNO}';
    DELETE FROM public.tarifas
      WHERE deporte_id IN ('${DEP_A}', '${DEP_B}')
         OR nivel_id IN (SELECT id FROM public.niveles WHERE nombre = '${NIVEL_E2E}')
         OR desde >= '2090-01-01';
    DELETE FROM public.deportes WHERE id IN ('${DEP_A}', '${DEP_B}');
    DELETE FROM public.matriculas WHERE alumno_id = '${ALUMNO}';
    DELETE FROM public.alumnos WHERE perfil_id = '${ALUMNO}';
    DELETE FROM public.perfiles WHERE id = '${ALUMNO}';
    DELETE FROM public.cursos WHERE id = '${CURSO}';
    DELETE FROM public.niveles WHERE nombre = '${NIVEL_E2E}';
    COMMIT;
  `)
}

function preparar() {
  limpiar()
  sql(`
    BEGIN;
    INSERT INTO public.deportes (id, nombre)
    VALUES ('${DEP_A}', '${NOMBRE_DEP_A}'), ('${DEP_B}', '${NOMBRE_DEP_B}');
    INSERT INTO public.niveles (nombre, activo, orden) VALUES ('${NIVEL_E2E}', TRUE, 9301);
    INSERT INTO public.cursos (id, nivel_id, denominacion, division, activo)
    VALUES ('${CURSO}', (SELECT id FROM public.niveles WHERE nombre = '${NIVEL_E2E}'), 'Curso E2E tarifas', 'A', TRUE);
    INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
    VALUES ('${ALUMNO}', NULL, (SELECT id FROM public.roles WHERE nombre = 'ESTUDIANTE'),
            'Prueba', 'E2E Tarifas', '95103001', 'LEG-E2E-EPT103');
    INSERT INTO public.matriculas (id, alumno_id, curso_id) VALUES ('${MATRICULA}', '${ALUMNO}', '${CURSO}');
    UPDATE public.alumnos SET estado = 'ACTIVO' WHERE perfil_id = '${ALUMNO}';
    COMMIT;
  `)
}

/** Versiones persistidas de una referencia, como texto exacto: `importe|desde|hasta`. */
function versiones(filtro: string) {
  return sql(
    `SELECT COALESCE(string_agg(importe::text || '|' || desde::text || '|' || COALESCE(hasta::text, ''), E'\\n' ORDER BY desde), '')
     FROM public.tarifas WHERE ${filtro};`
  )
}

function contar(filtro: string) {
  return Number(sql(`SELECT count(*) FROM public.tarifas WHERE ${filtro};`))
}

function idServicio(codigo: string) {
  return sql(`SELECT id FROM public.servicios_escolares WHERE codigo = '${codigo}';`)
}

function idNivel(nombre: string) {
  return Number(sql(`SELECT id FROM public.niveles WHERE nombre = '${nombre}';`))
}

function idTarifa(filtro: string) {
  return sql(`SELECT id FROM public.tarifas WHERE ${filtro} ORDER BY desde LIMIT 1;`)
}

function sumarDias(iso: string, dias: number) {
  const [a, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10)
}

/** Hoy en Argentina, como lo calcula el servidor. */
const HOY = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10)

type EjecutarPeticion = Parameters<APIRequestContext['fetch']>

/** Espera a que el setup autenticado deje disponible la sesión real. */
async function pedirConSesion(
  archivoSesion: string,
  url: EjecutarPeticion[0],
  opciones?: EjecutarPeticion[1]
): Promise<APIResponse> {
  const limite = Date.now() + 20_000
  let ultimoEstado: number | null = null
  do {
    if (fs.existsSync(archivoSesion)) {
      const contexto = await crearContexto.newContext({ baseURL: BASE_URL, storageState: archivoSesion })
      const respuesta = await contexto.fetch(url, opciones)
      ultimoEstado = respuesta.status()
      if (ultimoEstado !== 401) {
        contextosActivos.push(contexto)
        return respuesta
      }
      await contexto.dispose()
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  } while (Date.now() < limite)
  throw new Error(`La sesión ${archivoSesion} no quedó disponible (último estado ${ultimoEstado}).`)
}

async function esperar(respuesta: APIResponse, estado: number, mensaje?: string) {
  expect(respuesta.status(), await respuesta.text()).toBe(estado)
  const cuerpo = await respuesta.json()
  if (mensaje) expect(cuerpo.error).toBe(mensaje)
  if (cuerpo.error) exigirMensajeSinDetalleTecnico('respuesta de la API', String(cuerpo.error))
  return cuerpo
}

// ----------------------------------------------------------------
// Operaciones por la API real, con la sesión de la dirección
// ----------------------------------------------------------------

const directora = (url: string, opciones?: EjecutarPeticion[1]) =>
  pedirConSesion(SESION.directora, url, opciones)

type Alta = { concepto: string; referencia_id: string; importe: string; desde: string; hasta?: string | null }

const alta = (datos: Alta) => directora('/api/tarifas', { method: 'POST', data: datos })
const cambio = (datos: Alta) => directora('/api/tarifas/cambio', { method: 'POST', data: datos })
const edicion = (id: string, data: unknown) => directora(`/api/tarifas/${id}`, { method: 'PATCH', data })

const altaDeporte = (deporte: string, importe: string, desde: string, hasta: string | null = null) =>
  alta({ concepto: 'DEPORTE', referencia_id: deporte, importe, desde, hasta })

async function capturar(page: Page, nombre: string, opciones: { paginaCompleta?: boolean } = {}) {
  if (!CAPTURAR) return
  const perfil = (page.viewportSize()?.width ?? 1280) < 640 ? 'movil' : 'escritorio'
  await capturarSinHerramientas(page, path.join('docs/evidence/EPT-103', `real-${perfil}-${nombre}.png`), opciones)
}

const aplicacion = (page: Page) => page.getByRole('main')

const sinScrollHorizontal = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)

async function abrirTarifas(page: Page) {
  await page.goto('/dashboard/tarifas')
  await expect(aplicacion(page).getByRole('heading', { level: 1, name: 'Tarifas' })).toBeVisible()
}

function tarjeta(page: Page, nombre: string) {
  return aplicacion(page)
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { level: 3, name: nombre, exact: true }) })
}

// ================================================================
// DIRECTOR: la API real, con la base real
// ================================================================
test.describe.serial('DIRECTOR autenticado — administración de tarifas (API)', () => {
  test.beforeAll(() => {
    preparar()
  })

  test.afterAll(() => {
    limpiar()
  })

  test('el alta persiste con importe exacto, conserva el cero y responde el importe como texto', async () => {
    const cuerpo = await esperar(await altaDeporte(DEP_A, '1234,5', '2095-01-01', '2095-06-30'), 201)
    expect(cuerpo.ok).toBe(true)
    expect(cuerpo.tarifa).toMatchObject({ importe: '1234.50', desde: '2095-01-01', hasta: '2095-06-30' })
    expect(typeof cuerpo.tarifa.importe).toBe('string')
    expect(versiones(`deporte_id = '${DEP_A}'`)).toBe('1234.50|2095-01-01|2095-06-30')

    // Cero: se acepta y se conserva, no se reemplaza por un mínimo.
    await esperar(await altaDeporte(DEP_B, '0', '2095-01-01'), 201)
    expect(versiones(`deporte_id = '${DEP_B}'`)).toBe('0.00|2095-01-01|')
  })

  test('cada importe inválido se rechaza con su mensaje y no persiste nada', async () => {
    const antes = contar(`deporte_id = '${DEP_A}'`)
    const casos: Array<[string, string]> = [
      ['10.005', MENSAJE.decimales],
      ['10,001', MENSAJE.decimales],
      ['-5', MENSAJE.negativo],
      ['-0', MENSAJE.negativo],
      ['NaN', 'El importe tiene un formato no soportado. Usá solo dígitos y una coma o un punto para los decimales, por ejemplo 1234,50.'],
      ['Infinity', 'El importe tiene un formato no soportado. Usá solo dígitos y una coma o un punto para los decimales, por ejemplo 1234,50.'],
      ['1e3', 'El importe tiene un formato no soportado. Usá solo dígitos y una coma o un punto para los decimales, por ejemplo 1234,50.'],
      ['1.234,50', 'No uses separadores de miles ni más de una coma o punto. Escribí el importe así: 1234,50.'],
      ['10000000000', 'El importe supera el máximo permitido (9999999999,99).'],
      ['', 'Ingresá el importe de la tarifa.'],
    ]
    for (const [importe, mensaje] of casos) {
      const cuerpo = await esperar(await altaDeporte(DEP_A, importe, '2096-01-01', '2096-01-31'), 400, mensaje)
      expect(cuerpo.campo, importe).toBe('importe')
    }
    expect(contar(`deporte_id = '${DEP_A}'`)).toBe(antes)
    // Ninguno quedó almacenado como 10.01 por redondeo.
    expect(contar(`deporte_id = '${DEP_A}' AND importe = 10.01`)).toBe(0)
  })

  test('el valor límite se guarda exacto y un dígito más se rechaza', async () => {
    const cuerpo = await esperar(await altaDeporte(DEP_A, '9999999999,99', '2096-02-01', '2096-02-28'), 201)
    expect(cuerpo.tarifa.importe).toBe('9999999999.99')
    expect(versiones(`deporte_id = '${DEP_A}' AND desde = '2096-02-01'`)).toBe('9999999999.99|2096-02-01|2096-02-28')
    await esperar(await altaDeporte(DEP_A, '10000000000', '2096-03-01'), 400)
  })

  test('las fechas se validan: reales, finitas y en orden', async () => {
    const antes = contar(`deporte_id = '${DEP_A}'`)
    for (const [desde, hasta, campo] of [
      ['2096-02-30', null, 'desde'],
      ['infinity', null, 'desde'],
      ['-infinity', null, 'desde'],
      ['', null, 'desde'],
      ['2096-05-01', 'infinity', 'hasta'],
      ['2096-05-02', '2096-05-01', 'hasta'],
    ] as const) {
      const cuerpo = await esperar(await altaDeporte(DEP_A, '100', desde, hasta), 400)
      expect(cuerpo.campo, `${desde} ${hasta}`).toBe(campo)
    }
    expect(contar(`deporte_id = '${DEP_A}'`)).toBe(antes)
  })

  test('concepto y referencia deben corresponderse; no hay catálogos paralelos ni cargos adicionales', async () => {
    const comedor = idServicio('COMEDOR')
    const norte = idServicio('TR-NORTE')
    const nivelReal = idNivel('PRIMARIO')
    const antes = contar('TRUE')

    expect((await esperar(await alta({ concepto: 'CUOTA', referencia_id: DEP_A, importe: '1', desde: '2096-06-01' }), 400)).campo).toBe('referencia_id')
    expect((await esperar(await alta({ concepto: 'DEPORTE', referencia_id: String(nivelReal), importe: '1', desde: '2096-06-01' }), 400)).campo).toBe('referencia_id')
    expect((await esperar(await alta({ concepto: 'MATRICULA', referencia_id: DEP_A, importe: '1', desde: '2096-06-01' }), 400)).campo).toBe('concepto')
    // Un servicio de otro tipo que el concepto lo rechaza la base (P6801).
    const cruzado = await esperar(await alta({ concepto: 'TRANSPORTE', referencia_id: comedor, importe: '1', desde: '2096-06-01' }), 400)
    expect(cruzado.campo).toBe('referencia_id')
    await esperar(await alta({ concepto: 'COMEDOR', referencia_id: norte, importe: '1', desde: '2096-06-01' }), 400)
    // Referencia con forma válida pero inexistente: 404 (clave foránea).
    const fantasma = await esperar(await altaDeporte(INEXISTENTE, '1', '2096-06-01'), 404)
    expect(fantasma.campo).toBe('referencia_id')
    await esperar(await alta({ concepto: 'CUOTA', referencia_id: '999999', importe: '1', desde: '2096-06-01' }), 404)
    expect(contar('TRUE')).toBe(antes)
  })

  test('cada tipo de referencia real acepta su tarifa: los tres niveles, los cuatro recorridos y el comedor', async () => {
    // Solo los tres niveles del catálogo real, no el nivel propio de esta suite.
    const niveles = sql(
      "SELECT id FROM public.niveles WHERE nombre IN ('INICIAL', 'PRIMARIO', 'SECUNDARIO') ORDER BY id;"
    ).split('\n')
    expect(niveles).toHaveLength(3)
    for (const nivel of niveles) {
      const cuerpo = await esperar(await alta({ concepto: 'CUOTA', referencia_id: nivel, importe: '30000', desde: '2090-01-01' }), 201)
      expect(cuerpo.tarifa.hasta).toBeNull()
    }
    for (const codigo of ['TR-NORTE', 'TR-SUR', 'TR-ESTE', 'TR-OESTE']) {
      await esperar(await alta({ concepto: 'TRANSPORTE', referencia_id: idServicio(codigo), importe: '12000', desde: '2090-01-01' }), 201)
    }
    await esperar(await alta({ concepto: 'COMEDOR', referencia_id: idServicio('COMEDOR'), importe: '8000', desde: '2090-01-01' }), 201)
    expect(contar("desde = '2090-01-01' AND concepto = 'TRANSPORTE'")).toBe(4)
    expect(contar("desde = '2090-01-01' AND concepto = 'CUOTA'")).toBe(niveles.length)
    expect(contar("desde = '2090-01-01' AND concepto = 'COMEDOR'")).toBe(1)
    // La misma referencia el mismo día: superposición, 409 con código estable.
    const repetido = await esperar(
      await alta({ concepto: 'TRANSPORTE', referencia_id: idServicio('TR-NORTE'), importe: '1', desde: '2090-01-01' }),
      409,
      MENSAJE.superposicion
    )
    expect(repetido.codigo).toBe('SUPERPOSICION')
  })

  test('las vigencias son cerradas: un día compartido se rechaza y D-1/D se acepta', async () => {
    await esperar(await altaDeporte(DEP_A, '100', '2097-04-01', '2097-04-30'), 201)
    const solapada = await esperar(
      await altaDeporte(DEP_A, '110', '2097-04-30', '2097-05-31'),
      409,
      MENSAJE.superposicion
    )
    expect(solapada.codigo).toBe('SUPERPOSICION')
    expect(solapada.campo).toBe('desde')
    await esperar(await altaDeporte(DEP_A, '110', '2097-05-01', '2097-05-31'), 201)
    // El último día de la anterior y el primero de la siguiente son días distintos.
    expect(versiones(`deporte_id = '${DEP_A}' AND desde >= '2097-01-01' AND desde < '2098-01-01'`)).toBe(
      '100.00|2097-04-01|2097-04-30\n110.00|2097-05-01|2097-05-31'
    )
    // Una vigencia de un solo día.
    await esperar(await altaDeporte(DEP_A, '120', '2097-06-15', '2097-06-15'), 201)
    await esperar(await altaDeporte(DEP_A, '120', '2097-06-15', '2097-06-15'), 409)
  })

  test('el cambio de precio cierra la anterior en D-1 y abre la nueva en una sola operación', async () => {
    await esperar(await altaDeporte(DEP_A, '100', '2098-01-01'), 201)
    const cuerpo = await esperar(await cambio({ concepto: 'DEPORTE', referencia_id: DEP_A, importe: '150,5', desde: '2098-07-01' }), 200)
    expect(cuerpo.anterior).toMatchObject({ importe: '100.00', desde: '2098-01-01', hasta: '2098-06-30' })
    expect(cuerpo.nueva).toMatchObject({ importe: '150.50', desde: '2098-07-01', hasta: null })
    expect(versiones(`deporte_id = '${DEP_A}' AND desde >= '2098-01-01'`)).toBe(
      '100.00|2098-01-01|2098-06-30\n150.50|2098-07-01|'
    )

    // Repetirlo se rechaza y no persiste nada (ni el cierre ni una fila).
    const antes = versiones(`deporte_id = '${DEP_A}'`)
    await esperar(await cambio({ concepto: 'DEPORTE', referencia_id: DEP_A, importe: '200', desde: '2098-07-01' }), 409, MENSAJE.superposicion)
    expect(versiones(`deporte_id = '${DEP_A}'`)).toBe(antes)

    // Un cambio inválido tampoco deja rastro.
    await esperar(await cambio({ concepto: 'DEPORTE', referencia_id: DEP_A, importe: '200,005', desde: '2098-09-01' }), 400, MENSAJE.decimales)
    expect(versiones(`deporte_id = '${DEP_A}'`)).toBe(antes)
  })

  test('la edición exige los valores previos: el conflicto no sobrescribe en silencio', async () => {
    const id = idTarifa(`deporte_id = '${DEP_A}' AND desde = '2098-07-01'`)
    const previo = { importe: '150.50', desde: '2098-07-01', hasta: null }

    const ok = await esperar(
      await edicion(id, { importe: '175', desde: '2098-07-01', hasta: '', previo }),
      200
    )
    expect(ok.tarifa).toMatchObject({ id, importe: '175.00', desde: '2098-07-01', hasta: null })
    expect(versiones(`deporte_id = '${DEP_A}' AND desde = '2098-07-01'`)).toBe('175.00|2098-07-01|')

    // Otra persona editó con el valor que vio antes: conflicto, valor intacto.
    const conflicto = await esperar(
      await edicion(id, { importe: '999', desde: '2098-07-01', hasta: '', previo }),
      409,
      MENSAJE.conflicto
    )
    expect(conflicto.codigo).toBe('CONFLICTO_EDICION')
    expect(versiones(`deporte_id = '${DEP_A}' AND desde = '2098-07-01'`)).toBe('175.00|2098-07-01|')

    // Superposición al editar la vigencia.
    const inicial = idTarifa(`deporte_id = '${DEP_A}' AND desde = '2098-01-01'`)
    await esperar(
      await edicion(inicial, {
        importe: '100', desde: '2098-01-01', hasta: '2098-07-01',
        previo: { importe: '100.00', desde: '2098-01-01', hasta: '2098-06-30' },
      }),
      409,
      MENSAJE.superposicion
    )
    expect(versiones(`deporte_id = '${DEP_A}' AND desde = '2098-01-01'`)).toBe('100.00|2098-01-01|2098-06-30')

    // Importe inválido y tarifa inexistente.
    await esperar(await edicion(id, { importe: '1.005', desde: '2098-07-01', hasta: '', previo: { importe: '175.00', desde: '2098-07-01', hasta: null } }), 400, MENSAJE.decimales)
    const inexistente = await esperar(
      await edicion(INEXISTENTE, { importe: '1', desde: '2098-07-01', hasta: '', previo: { importe: '1.00', desde: '2098-07-01', hasta: null } }),
      404
    )
    expect(inexistente.codigo).toBe('TARIFA_INEXISTENTE')
  })

  test('el cuerpo no puede traer identidad, concepto ni referencia al editar; los métodos fuera del contrato reciben 405', async () => {
    const antes = contar('TRUE')
    for (const intruso of ['actor_id', 'user_id', 'rol', 'perfil_id', 'user_metadata']) {
      await esperar(
        await directora('/api/tarifas', {
          method: 'POST',
          data: { concepto: 'DEPORTE', referencia_id: DEP_A, importe: '1', desde: '2099-01-01', [intruso]: 'DIRECTOR' },
        }),
        400,
        'La petición contiene campos no permitidos'
      )
    }
    const id = idTarifa(`deporte_id = '${DEP_A}' AND desde = '2098-07-01'`)
    for (const intruso of ['concepto', 'referencia_id', 'nivel_id', 'deporte_id']) {
      await esperar(
        await edicion(id, {
          importe: '1', desde: '2098-07-01', hasta: '',
          previo: { importe: '175.00', desde: '2098-07-01', hasta: null },
          [intruso]: 'CUOTA',
        }),
        400,
        'La petición contiene campos no permitidos'
      )
    }
    expect(contar('TRUE')).toBe(antes)

    const mal = await directora('/api/tarifas', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      data: Buffer.from('{esto no es json'),
    })
    await esperar(mal, 400, 'Cuerpo inválido')
    await esperar(await edicion('no-es-un-uuid', { importe: '1' }), 400, 'Identificador de tarifa inválido')

    for (const [ruta, permitido, metodos] of [
      ['/api/tarifas', 'POST, OPTIONS', ['GET', 'PUT', 'DELETE', 'PATCH']],
      ['/api/tarifas/cambio', 'POST, OPTIONS', ['GET', 'PUT', 'DELETE', 'PATCH']],
      [`/api/tarifas/${id}`, 'PATCH, OPTIONS', ['GET', 'PUT', 'DELETE', 'POST']],
    ] as const) {
      for (const metodo of metodos) {
        const respuesta = await directora(ruta, { method: metodo })
        expect(respuesta.status(), `${metodo} ${ruta}`).toBe(405)
        expect(respuesta.headers()['allow'], `${metodo} ${ruta}`).toBe(permitido)
      }
    }
    // No existe borrado físico por ninguna vía.
    expect(contar('TRUE')).toBe(antes)
  })

  test('cambiar o editar una tarifa ya facturada no toca la factura, el ítem ni su estado', async () => {
    await esperar(await alta({ concepto: 'CUOTA', referencia_id: String(idNivel(NIVEL_E2E)), importe: '5000', desde: '2099-01-01' }), 201)
    const tarifa = idTarifa(`nivel_id = (SELECT id FROM public.niveles WHERE nombre = '${NIVEL_E2E}')`)
    sql(`
      BEGIN;
      INSERT INTO public.facturas (id, alumno_id, periodo, vencimiento, total)
      VALUES ('${FACTURA}', '${ALUMNO}', '2099-03-01', '2099-03-10', 5000.00);
      INSERT INTO public.items_factura (id, factura_id, alumno_id, tipo, tarifa_id, matricula_id, importe)
      VALUES ('${ITEM}', '${FACTURA}', '${ALUMNO}', 'CUOTA', '${tarifa}', '${MATRICULA}', 5000.00);
      COMMIT;
    `)
    const huella = () =>
      sql(`SELECT md5(
             (SELECT to_jsonb(f)::text FROM public.facturas f WHERE f.id = '${FACTURA}')
             || (SELECT to_jsonb(i)::text FROM public.items_factura i WHERE i.id = '${ITEM}'));`)
    const antes = huella()

    await esperar(
      await edicion(tarifa, { importe: '7500,25', desde: '2099-01-01', hasta: '', previo: { importe: '5000.00', desde: '2099-01-01', hasta: null } }),
      200
    )
    const sucesion = await esperar(
      await cambio({ concepto: 'CUOTA', referencia_id: String(idNivel(NIVEL_E2E)), importe: '9000', desde: '2099-06-01' }),
      200
    )
    expect(sucesion.anterior.hasta).toBe('2099-05-31')

    // La tarifa cambió; lo facturado, no.
    expect(versiones(`id = '${tarifa}'`)).toBe('7500.25|2099-01-01|2099-05-31')
    expect(huella()).toBe(antes)
    expect(sql(`SELECT importe::text || '|' || estado_pago FROM public.items_factura WHERE id = '${ITEM}';`)).toBe('5000.00|PENDIENTE')
    expect(sql(`SELECT total::text FROM public.facturas WHERE id = '${FACTURA}';`)).toBe('5000.00')
  })

  test('dos altas solapadas simultáneas confirman exactamente una y dos ediciones sobre el mismo valor, una sola', async () => {
    const [a, b] = await Promise.all([
      altaDeporte(DEP_B, '300', '2093-01-01', '2093-06-30'),
      altaDeporte(DEP_B, '400', '2093-06-30', '2093-12-31'),
    ])
    expect([a.status(), b.status()].sort()).toEqual([201, 409])
    expect(contar(`deporte_id = '${DEP_B}' AND desde >= '2093-01-01' AND desde < '2094-01-01'`)).toBe(1)

    const id = idTarifa(`deporte_id = '${DEP_B}' AND desde >= '2093-01-01' AND desde < '2094-01-01'`)
    const previo = sql(`SELECT importe::text || '|' || desde::text || '|' || COALESCE(hasta::text, '') FROM public.tarifas WHERE id = '${id}';`).split('|')
    const datosPrevios = { importe: previo[0], desde: previo[1], hasta: previo[2] || null }
    const [c, d] = await Promise.all([
      edicion(id, { importe: '111', desde: previo[1], hasta: previo[2], previo: datosPrevios }),
      edicion(id, { importe: '222', desde: previo[1], hasta: previo[2], previo: datosPrevios }),
    ])
    expect([c.status(), d.status()].sort()).toEqual([200, 409])
    const ganador = c.status() === 200 ? '111.00' : '222.00'
    expect(sql(`SELECT importe::text FROM public.tarifas WHERE id = '${id}';`)).toBe(ganador)
  })
})

// ================================================================
// DIRECTOR: la pantalla real, con la base real
// ================================================================
test.describe.serial('DIRECTOR autenticado — administración de tarifas (pantalla)', () => {
  test.beforeAll(() => {
    preparar()
  })

  test.afterAll(() => {
    limpiar()
  })

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
  })

  test('la navegación muestra «Tarifas» y la pantalla lista catálogos reales con sus cuatro secciones', async ({ page }) => {
    await page.goto('/dashboard')
    const menu = page.getByRole('navigation', { name: 'Menú del dashboard' })
    await menu.getByRole('link', { name: 'Tarifas' }).click()
    await expect(page).toHaveURL(/\/dashboard\/tarifas$/u)
    for (const titulo of ['Cuota por nivel educativo', 'Deportes', 'Transporte', 'Comedor']) {
      await expect(aplicacion(page).getByRole('heading', { level: 2, name: titulo })).toBeVisible()
    }
    // Los cuatro recorridos y los tres niveles son los del catálogo existente.
    await expect(aplicacion(page).getByRole('heading', { level: 3, name: /^Recorrido .* \(ficticio\)$/u })).toHaveCount(4)
    await expect(aplicacion(page).getByRole('heading', { level: 3, name: 'PRIMARIO', exact: true })).toBeVisible()
    await expect(tarjeta(page, NOMBRE_DEP_A)).toContainText('Todavía no se cargó ninguna tarifa.')
    await exigirPantallaSinDetalleTecnico(page, 'pantalla de tarifas')
    await capturar(page, 'listado-vacio')
  })

  test('crea una tarifa con el teclado, la ve vigente tras recargar y la base guarda el valor exacto', async ({ page }) => {
    await abrirTarifas(page)
    const nueva = tarjeta(page, NOMBRE_DEP_B).getByRole('button', { name: `Nueva tarifa de ${NOMBRE_DEP_B}` })
    await nueva.focus()
    await page.keyboard.press('Enter')
    const dialogo = page.getByRole('dialog', { name: `Nueva tarifa · ${NOMBRE_DEP_B}` })
    await expect(dialogo.getByLabel('Importe (ARS)')).toBeFocused()

    await dialogo.getByLabel('Importe (ARS)').fill('15000,505')
    await dialogo.getByLabel('Vigente desde').fill(HOY)
    await page.keyboard.press('Enter')
    await expect(dialogo.getByLabel('Importe (ARS)')).toHaveAccessibleDescription(MENSAJE.decimales)

    await dialogo.getByLabel('Importe (ARS)').fill('15000,50')
    await page.keyboard.press('Enter')
    await expect(dialogo).toContainText('$ 15.000,50')
    await capturar(page, 'revision', { paginaCompleta: false })
    await dialogo.getByRole('button', { name: 'Confirmar y guardar' }).click()
    await expect(dialogo).toHaveCount(0)
    await expect(nueva).toBeFocused()
    await expect(
      aplicacion(page).getByRole('status').filter({ hasText: `Guardaste la tarifa de ${NOMBRE_DEP_B}: $ 15.000,50.` })
    ).toBeVisible()
    // Lo que la pantalla muestra es lo que la base devolvió al releer.
    await expect(tarjeta(page, NOMBRE_DEP_B)).toContainText('Vigente hoy')
    await expect(tarjeta(page, NOMBRE_DEP_B)).toContainText('$ 15.000,50')
    await capturar(page, 'tarifa-creada')

    expect(versiones(`deporte_id = '${DEP_B}'`)).toBe(`15000.50|${HOY}|`)
    await page.reload()
    await expect(tarjeta(page, NOMBRE_DEP_B)).toContainText('$ 15.000,50')
  })

  test('cambia el precio: anticipa el cierre D-1, conserva el historial y persiste', async ({ page }) => {
    const cambioDesde = sumarDias(HOY, 10)
    await abrirTarifas(page)
    await tarjeta(page, NOMBRE_DEP_B).getByRole('button', { name: `Cambiar precio de ${NOMBRE_DEP_B}` }).click()
    const dialogo = page.getByRole('dialog', { name: `Cambiar precio · ${NOMBRE_DEP_B}` })
    await dialogo.getByLabel('Nuevo importe (ARS)').fill('18000')
    await dialogo.getByLabel('Rige desde').fill(cambioDesde)
    await dialogo.getByRole('button', { name: 'Revisar' }).click()
    await expect(dialogo).toContainText('$ 15.000,50')
    await expect(dialogo).toContainText('pasará a terminar el')
    await capturar(page, 'cambio-revision', { paginaCompleta: false })
    await dialogo.getByRole('button', { name: 'Confirmar y guardar' }).click()
    await expect(dialogo).toHaveCount(0)
    await expect(aplicacion(page).getByRole('status').filter({ hasText: 'Registraste el nuevo precio' })).toBeVisible()

    const tarjetaB = tarjeta(page, NOMBRE_DEP_B)
    await expect(tarjetaB).toContainText('$ 15.000,50') // vigente hoy: la nueva rige más adelante
    await tarjetaB.getByText(/^Historial \(2 versiones\)/).click()
    await expect(tarjetaB.locator('details li').nth(0)).toContainText('Futura')
    await expect(tarjetaB.locator('details li').nth(1)).toContainText('Vigente')
    await capturar(page, 'historial')
    expect(versiones(`deporte_id = '${DEP_B}'`)).toBe(
      `15000.50|${HOY}|${sumarDias(cambioDesde, -1)}\n18000.00|${cambioDesde}|`
    )
  })

  test('edita una versión conservando concepto y referencia, y avisa que lo facturado no cambia', async ({ page }) => {
    const futura = sumarDias(HOY, 10)
    await abrirTarifas(page)
    const tarjetaB = tarjeta(page, NOMBRE_DEP_B)
    await tarjetaB.getByText(/^Historial/).click()
    await tarjetaB.getByRole('button', { name: new RegExp(`^Editar la tarifa de ${NOMBRE_DEP_B}: Desde el`, 'u') }).click()
    const dialogo = page.getByRole('dialog', { name: `Editar tarifa · ${NOMBRE_DEP_B}` })
    await expect(dialogo.getByLabel('Importe (ARS)')).toHaveValue('18000,00')
    await expect(dialogo).toContainText('Las facturas ya emitidas conservan el importe con el que se emitieron')
    await dialogo.getByLabel('Importe (ARS)').fill('19000,75')
    await dialogo.getByRole('button', { name: 'Revisar' }).click()
    await dialogo.getByRole('button', { name: 'Confirmar y guardar' }).click()
    await expect(dialogo).toHaveCount(0)
    await expect(
      aplicacion(page).getByRole('status').filter({ hasText: `Actualizaste la tarifa de ${NOMBRE_DEP_B}: $ 19.000,75.` })
    ).toBeVisible()
    expect(versiones(`deporte_id = '${DEP_B}' AND desde = '${futura}'`)).toBe(`19000.75|${futura}|`)
    expect(contar(`deporte_id = '${DEP_B}'`)).toBe(2)
  })

  test('una superposición la rechaza la base y la pantalla la señala en la fecha de inicio', async ({ page }) => {
    await abrirTarifas(page)
    await tarjeta(page, NOMBRE_DEP_B).getByRole('button', { name: `Nueva tarifa de ${NOMBRE_DEP_B}` }).click()
    const dialogo = page.getByRole('dialog')
    await dialogo.getByLabel('Importe (ARS)').fill('100')
    await dialogo.getByLabel('Vigente desde').fill(sumarDias(HOY, 20))
    await dialogo.getByRole('button', { name: 'Revisar' }).click()
    await dialogo.getByRole('button', { name: 'Confirmar y guardar' }).click()
    await expect(dialogo.getByLabel('Vigente desde')).toHaveAccessibleDescription(MENSAJE.superposicion)
    await expect(aplicacion(page).getByRole('status').filter({ hasText: 'Guardaste' })).toHaveCount(0)
    await exigirPantallaSinDetalleTecnico(page, 'superposición')
    await capturar(page, 'superposicion', { paginaCompleta: false })
    expect(contar(`deporte_id = '${DEP_B}'`)).toBe(2)
  })

  test('una pantalla desactualizada recibe el conflicto real de la base y se reconcilia', async ({ page }) => {
    const futura = sumarDias(HOY, 10)
    await abrirTarifas(page)
    const tarjetaB = tarjeta(page, NOMBRE_DEP_B)
    await tarjetaB.getByText(/^Historial/).click()
    await tarjetaB.getByRole('button', { name: new RegExp(`^Editar la tarifa de ${NOMBRE_DEP_B}: Desde el`, 'u') }).click()
    const dialogo = page.getByRole('dialog')
    await dialogo.getByLabel('Importe (ARS)').fill('1')

    // Mientras tanto, otra persona edita la misma versión por la API.
    const id = idTarifa(`deporte_id = '${DEP_B}' AND desde = '${futura}'`)
    await esperar(
      await edicion(id, {
        importe: '21000', desde: futura, hasta: '',
        previo: { importe: '19000.75', desde: futura, hasta: null },
      }),
      200
    )

    await dialogo.getByRole('button', { name: 'Revisar' }).click()
    await dialogo.getByRole('button', { name: 'Confirmar y guardar' }).click()
    await expect(dialogo.getByRole('alert')).toContainText('Otra persona modificó esta tarifa')
    await expect(aplicacion(page).getByRole('status').filter({ hasText: 'Actualizaste' })).toHaveCount(0)
    await exigirPantallaSinDetalleTecnico(page, 'conflicto de edición real')
    await capturar(page, 'conflicto', { paginaCompleta: false })
    expect(versiones(`id = '${id}'`)).toBe(`21000.00|${futura}|`)

    await dialogo.getByRole('button', { name: 'Recargar datos' }).click()
    await expect(dialogo).toHaveCount(0)
    await expect(aplicacion(page).getByRole('status').filter({ hasText: 'Volvimos a leer las tarifas.' })).toBeVisible()
    await expect(tarjetaB.locator('details li').nth(0)).toContainText('$ 21.000,00')
  })

  test('una falla de red no se confunde con un guardado y el reintento explícito crea una sola fila', async ({ page }) => {
    await abrirTarifas(page)
    await page.route('**/api/tarifas', (ruta) => ruta.abort('failed'))
    await tarjeta(page, NOMBRE_DEP_A).getByRole('button', { name: `Nueva tarifa de ${NOMBRE_DEP_A}` }).click()
    const dialogo = page.getByRole('dialog')
    await dialogo.getByLabel('Importe (ARS)').fill('4000')
    await dialogo.getByLabel('Vigente desde').fill('2092-01-01')
    await dialogo.getByLabel('Vigente hasta (opcional)').fill('2092-12-31')
    await dialogo.getByRole('button', { name: 'Revisar' }).click()
    await dialogo.getByRole('button', { name: 'Confirmar y guardar' }).click()
    await expect(dialogo.getByRole('alert')).toContainText('No pudimos comunicarnos con el servidor')
    await expect(aplicacion(page).getByRole('status').filter({ hasText: 'Guardaste' })).toHaveCount(0)
    expect(contar(`deporte_id = '${DEP_A}' AND desde = '2092-01-01'`)).toBe(0)
    await capturar(page, 'falla-de-red', { paginaCompleta: false })

    await page.unroute('**/api/tarifas')
    await dialogo.getByRole('button', { name: 'Reintentar guardado' }).click()
    await expect(dialogo).toHaveCount(0)
    expect(versiones(`deporte_id = '${DEP_A}' AND desde = '2092-01-01'`)).toBe('4000.00|2092-01-01|2092-12-31')
  })

  test('el doble envío real llega una sola vez y deja una sola fila', async ({ page }) => {
    await abrirTarifas(page)
    let peticiones = 0
    page.on('request', (peticion) => {
      if (peticion.method() === 'POST' && peticion.url().endsWith('/api/tarifas')) peticiones += 1
    })
    await page.route('**/api/tarifas', async (ruta) => {
      await new Promise((resolver) => setTimeout(resolver, 900))
      await ruta.continue()
    })
    await tarjeta(page, NOMBRE_DEP_A).getByRole('button', { name: `Nueva tarifa de ${NOMBRE_DEP_A}` }).click()
    const dialogo = page.getByRole('dialog')
    await dialogo.getByLabel('Importe (ARS)').fill('4500')
    await dialogo.getByLabel('Vigente desde').fill('2091-01-01')
    await dialogo.getByLabel('Vigente hasta (opcional)').fill('2091-12-31')
    await dialogo.getByRole('button', { name: 'Revisar' }).click()
    await dialogo.getByRole('button', { name: 'Confirmar y guardar' }).click()
    const guardando = dialogo.getByRole('button', { name: 'Guardando…' })
    await expect(guardando).toBeDisabled()
    await guardando.click({ force: true }).catch(() => undefined)
    await page.keyboard.press('Enter')
    await expect(dialogo).toHaveCount(0)
    expect(peticiones).toBe(1)
    expect(contar(`deporte_id = '${DEP_A}' AND desde = '2091-01-01'`)).toBe(1)
  })

  test('a 375 px la administración es usable, sin desplazamiento horizontal', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await abrirTarifas(page)
    expect(await sinScrollHorizontal(page)).toBe(true)
    await capturar(page, 'listado')
    await tarjeta(page, NOMBRE_DEP_A).getByRole('button', { name: `Cambiar precio de ${NOMBRE_DEP_A}` }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    expect(await sinScrollHorizontal(page)).toBe(true)
    await capturar(page, 'dialogo', { paginaCompleta: false })
    await page.keyboard.press('Escape')
  })
})

// ================================================================
// Actores sin poderes de administración
// ================================================================
for (const actor of [
  { etiqueta: 'ESTUDIANTE', sesion: SESION.estudiante },
  { etiqueta: 'DOCENTE', sesion: SESION.docente },
  { etiqueta: 'PADRE', sesion: SESION.padre },
  { etiqueta: 'PERSONAL', sesion: SESION.personal },
  { etiqueta: 'SIN PERFIL', sesion: SESION.sinPerfil },
]) {
  test.describe(`${actor.etiqueta} autenticado — administración de tarifas`, () => {
    test('no accede a la pantalla, aunque abra la URL directa, y el menú no la ofrece', async ({ page }) => {
      await page.goto('/dashboard/tarifas')
      await expect(page.getByRole('heading', { name: 'Acceso restringido' })).toBeVisible()
      await expect(page.getByRole('heading', { level: 1, name: 'Tarifas' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: /Nueva tarifa|Cambiar precio|Editar la tarifa/ })).toHaveCount(0)
      await expect(
        page.getByRole('navigation', { name: 'Menú del dashboard' }).getByRole('link', { name: 'Tarifas' })
      ).toHaveCount(0)
    })

    test('recibe 403 en cada operación, también con un cuerpo que simula ser Dirección', async () => {
      const valido = { concepto: 'DEPORTE', referencia_id: DEP_A, importe: '1', desde: '2089-01-01' }
      const falsificado = {
        ...valido,
        user_metadata: { rol: 'DIRECTOR' },
        app_metadata: { role: 'DIRECTOR' },
        rol: 'DIRECTOR',
      }
      const operaciones: Array<[string, string, unknown]> = [
        ['POST', '/api/tarifas', valido],
        ['POST', '/api/tarifas', falsificado],
        ['POST', '/api/tarifas/cambio', valido],
        ['PATCH', `/api/tarifas/${INEXISTENTE}`, {
          importe: '1', desde: '2089-01-01', hasta: '', previo: { importe: '1.00', desde: '2089-01-01', hasta: null },
        }],
      ]
      for (const [metodo, ruta, data] of operaciones) {
        await esperar(await pedirConSesion(actor.sesion, ruta, { method: metodo, data }), 403, MENSAJE.soloDireccion)
      }
    })
  })
}

// ================================================================
// Rol cambiado después del JWT
// ================================================================
test.describe('DIRECTOR autenticado — rol vigente en la base', () => {
  test('con la sesión ya emitida, perder el rol DIRECTOR corta la escritura y recuperarlo la restituye', async () => {
    const perfil = sql("SELECT id FROM public.perfiles WHERE dni = '99900007';")
    test.skip(perfil === '', 'La identidad de cierre no existe en esta base.')
    const datos = { concepto: 'DEPORTE', referencia_id: INEXISTENTE, importe: '1', desde: '2089-01-01' }
    try {
      sql(`UPDATE public.perfiles SET rol_id = (SELECT id FROM public.roles WHERE nombre = 'PERSONAL') WHERE id = '${perfil}';`)
      await esperar(
        await pedirConSesion(SESION.directoraCierre, '/api/tarifas', { method: 'POST', data: datos }),
        403,
        MENSAJE.soloDireccion
      )
    } finally {
      sql(`UPDATE public.perfiles SET rol_id = (SELECT id FROM public.roles WHERE nombre = 'DIRECTOR') WHERE id = '${perfil}';`)
    }
    // Restituido el rol, el mismo JWT llega hasta la base (404: la referencia ficticia no existe).
    await esperar(
      await pedirConSesion(SESION.directoraCierre, '/api/tarifas', { method: 'POST', data: datos }),
      404
    )
  })
})

// ================================================================
// Director bloqueado (EPT-59): el JWT sigue vivo, la base lo niega
// ================================================================
test.describe('DIRECTOR BLOQUEADO autenticado — administración de tarifas', () => {
  test('la pantalla lleva a «Acceso bloqueado»', async ({ page }) => {
    await page.goto('/dashboard/tarifas')
    await expect(page).toHaveURL(/\/acceso-bloqueado$/u)
    await expect(page.getByRole('heading', { level: 1, name: 'Acceso bloqueado' })).toBeVisible()
  })

  test('la API niega cada operación con el mensaje de acceso bloqueado', async ({ request }) => {
    const valido = { concepto: 'DEPORTE', referencia_id: DEP_A, importe: '1', desde: '2089-01-01' }
    const respuestas = await Promise.all([
      request.post('/api/tarifas', { data: valido }),
      request.post('/api/tarifas/cambio', { data: valido }),
      request.patch(`/api/tarifas/${INEXISTENTE}`, {
        data: { importe: '1', desde: '2089-01-01', hasta: '', previo: { importe: '1.00', desde: '2089-01-01', hasta: null } },
      }),
    ])
    for (const respuesta of respuestas) await esperar(respuesta, 403, MENSAJE.bloqueo)
  })
})

// ================================================================
// Sin sesión
// ================================================================
test.describe('DIRECTOR autenticado — sin sesión propia', () => {
  test('un contexto sin cookies recibe 401 en cada operación', async () => {
    // Sin `storageState` explícito, el contexto heredaría la sesión del proyecto.
    const anonimo = await crearContexto.newContext({
      baseURL: BASE_URL,
      storageState: { cookies: [], origins: [] },
    })
    contextosActivos.push(anonimo)
    const valido = { concepto: 'DEPORTE', referencia_id: DEP_A, importe: '1', desde: '2089-01-01' }
    for (const respuesta of await Promise.all([
      anonimo.post('/api/tarifas', { data: valido }),
      anonimo.post('/api/tarifas/cambio', { data: valido }),
      anonimo.patch(`/api/tarifas/${INEXISTENTE}`, {
        data: { importe: '1', desde: '2089-01-01', hasta: '', previo: { importe: '1.00', desde: '2089-01-01', hasta: null } },
      }),
    ])) {
      await esperar(respuesta, 401, MENSAJE.sinSesion)
    }
  })

  test('sin sesión, la pantalla pide iniciar sesión', async ({ browser }) => {
    const contexto = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const pagina = await contexto.newPage()
    await pagina.goto('/dashboard/tarifas')
    await expect(pagina).toHaveURL(/\/login/u)
    await contexto.close()
  })
})
