import { expect, request as crearContexto, test, type APIRequestContext } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { exigirPantallaSinDetalleTecnico } from './_sin-detalle-tecnico'

/**
 * Lectura de comprobantes por Dirección y frontera de acceso (EPT-109), con
 * sesiones reales y la base real. La carga completa (preparar, subir, validar,
 * confirmar, concurrencia y conciliación) la prueban
 * `supabase/tests/comprobantes_carga.mjs` y `comprobantes_concurrencia.mjs`:
 * acá se prueba lo que ve y puede hacer cada ROL en la aplicación web.
 *
 * `psql` y la clave de servicio se usan solo para PREPARAR y LIMPIAR datos
 * sintéticos; nunca participan de la operación que se verifica. El archivo se
 * omite salvo que el operador habilite la base local descartable.
 */

test.skip(
  process.env.EPT_SUPABASE_LOCAL !== '1',
  'Requiere EPT_SUPABASE_LOCAL=1 y un reset de la base local.'
)

const SESION = {
  directora: 'tests/.auth/directora.json',
  estudiante: 'tests/.auth/estudiante.json',
  docente: 'tests/.auth/docente.json',
  padre: 'tests/.auth/padre.json',
  personal: 'tests/.auth/personal.json',
}

const BASE_URL = process.env.EPT_BASE_URL ?? 'http://localhost:3000'
const CONTENEDOR = process.env.EPT_SUPABASE_DB_CONTAINER ?? 'supabase_db_educar-para-transformar'
const URL_SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const CLAVE_SERVICIO = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

const ID = (n: number) => `e1090000-0000-4000-8000-${String(n).padStart(12, '0')}`
const PADRE = ID(1)
const ALUMNO = ID(2)
const PAGO_CON = ID(11)
const PAGO_SIN = ID(12)
const COMPROBANTE = ID(21)
const RUTA = `${PAGO_CON}/${COMPROBANTE}.png`
const INEXISTENTE = '00000000-0000-4000-8000-000000000000'

// PNG de 1×1: archivo sintético válido, sin datos personales.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

function sql(sentencia: string) {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTENEDOR, 'psql', '-X', '-q', '-A', '-t', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    { input: sentencia, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim()
}

function limpiar() {
  sql(`
    BEGIN;
    DELETE FROM public.comprobantes_pago WHERE pago_id IN ('${PAGO_CON}', '${PAGO_SIN}');
    DELETE FROM public.pagos WHERE id IN ('${PAGO_CON}', '${PAGO_SIN}');
    DELETE FROM public.alumnos WHERE perfil_id = '${ALUMNO}';
    DELETE FROM public.perfiles WHERE id IN ('${PADRE}', '${ALUMNO}');
    COMMIT;
  `)
}

async function objeto(metodo: 'POST' | 'DELETE', cuerpo?: Buffer) {
  const destino = `${URL_SUPABASE}/storage/v1/object/comprobantes-pago/${RUTA}`
  return fetch(destino, {
    method: metodo,
    headers: {
      apikey: CLAVE_SERVICIO,
      authorization: `Bearer ${CLAVE_SERVICIO}`,
      ...(cuerpo ? { 'content-type': 'image/png', 'x-upsert': 'true' } : {}),
    },
    body: cuerpo ? new Uint8Array(cuerpo) : undefined,
  })
}

function preparar() {
  limpiar()
  sql(`
    BEGIN;
    INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni)
    VALUES ('${PADRE}', NULL, (SELECT id FROM public.roles WHERE nombre = 'PADRE'),
            'Prueba', 'E2E Comprobantes Padre', '95109001');
    INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
    VALUES ('${ALUMNO}', NULL, (SELECT id FROM public.roles WHERE nombre = 'ESTUDIANTE'),
            'Prueba', 'E2E Comprobantes Alumno', '95109002', 'LEG-E2E-EPT109');
    INSERT INTO public.pagos (id, padre_id, alumno_id, total_calculado, fecha_transferencia,
                              importe_informado, numero_operacion) VALUES
      ('${PAGO_CON}', '${PADRE}', '${ALUMNO}', 50000, '2026-10-14', 49000.50, 'E2E-OP-109'),
      ('${PAGO_SIN}', '${PADRE}', '${ALUMNO}', 25000, NULL, NULL, NULL);
    INSERT INTO public.comprobantes_pago (id, pago_id, subido_por, ruta_archivo, tipo_mime, tamano_bytes)
    VALUES ('${COMPROBANTE}', '${PAGO_CON}', '${PADRE}', '${RUTA}', 'image/png', ${PNG.length});
    COMMIT;
  `)
}

const contextos: APIRequestContext[] = []
test.afterEach(async () => {
  await Promise.all(contextos.splice(0).map((c) => c.dispose()))
})

async function conSesion(archivo: string) {
  expect(fs.existsSync(archivo), `falta la sesión ${archivo}`).toBe(true)
  const contexto = await crearContexto.newContext({ baseURL: BASE_URL, storageState: archivo })
  contextos.push(contexto)
  return contexto
}

// ================================================================
// DIRECTOR
// ================================================================
test.describe.serial('DIRECTOR autenticado — comprobantes pendientes', () => {
  test.beforeAll(async () => {
    preparar()
    const r = await objeto('POST', PNG)
    expect(r.status, 'no se pudo sembrar el objeto sintético').toBe(200)
  })

  test.afterAll(async () => {
    await objeto('DELETE')
    limpiar()
  })

  test('la pantalla lista el pago pendiente con sus datos, sin acciones de aprobación', async ({ page }) => {
    await page.goto('/dashboard/comprobantes')
    await expect(page.getByRole('main').getByRole('heading', { level: 1, name: 'Comprobantes' })).toBeVisible()
    const tarjeta = page.getByTestId(`pago-${PAGO_CON}`)
    await expect(tarjeta).toBeVisible()
    await expect(tarjeta).toContainText('E2E Comprobantes Alumno')
    await expect(tarjeta).toContainText('Pendiente de verificación')
    await expect(tarjeta).toContainText('E2E-OP-109')
    await expect(tarjeta).toContainText('14/10/2026')
    // El importe informado difiere del total calculado: se muestra, no se bloquea.
    await expect(tarjeta).toContainText('$ 50.000,00')
    await expect(tarjeta).toContainText('$ 49.000,50')
    await expect(tarjeta).toContainText('Distinto del total calculado')
    await expect(tarjeta.getByRole('link', { name: /Ver comprobante 1/u })).toBeVisible()

    const sinArchivo = page.getByTestId(`pago-${PAGO_SIN}`)
    await expect(sinArchivo).toContainText('Todavía no se cargó ningún comprobante.')

    // Esta unidad solo lee: la aprobación y el rechazo no existen.
    await expect(page.getByRole('button', { name: /aprobar|rechazar/iu })).toHaveCount(0)
    await expect(page.getByRole('link', { name: /aprobar|rechazar/iu })).toHaveCount(0)
    const alcance = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
    )
    expect(alcance).toBe(true)
    await exigirPantallaSinDetalleTecnico(page, 'comprobantes de Dirección')
  })

  test('el enlace entrega el archivo original por una URL firmada de corta duración', async () => {
    const contexto = await conSesion(SESION.directora)
    const respuesta = await contexto.get(`/api/comprobantes/${COMPROBANTE}/archivo`, { maxRedirects: 0 })
    expect(respuesta.status()).toBe(302)
    expect(respuesta.headers()['cache-control']).toBe('no-store')
    const ubicacion = respuesta.headers().location ?? ''
    expect(ubicacion).toContain('/storage/v1/object/sign/comprobantes-pago/')
    const bytes = Buffer.from(await (await fetch(ubicacion)).arrayBuffer())
    expect(bytes.equals(PNG)).toBe(true)
  })

  test('un identificador inexistente o mal formado responde 404 sin pistas', async () => {
    const contexto = await conSesion(SESION.directora)
    for (const id of [INEXISTENTE, 'no-es-un-uuid']) {
      const r = await contexto.get(`/api/comprobantes/${id}/archivo`, { maxRedirects: 0 })
      expect(r.status()).toBe(404)
      expect(await r.text()).not.toMatch(/ruta|storage|supabase|P\d{4}/iu)
    }
  })

  test('la finalización no acepta una sesión por cookie: exige Bearer', async () => {
    const contexto = await conSesion(SESION.directora)
    const r = await contexto.post(`/api/comprobantes/cargas/${ID(99)}/finalizacion`)
    expect(r.status()).toBe(401)
  })

  test('la conciliación exige su secreto', async () => {
    const contexto = await conSesion(SESION.directora)
    const r = await contexto.post('/api/comprobantes/conciliacion')
    expect(r.status()).toBe(401)
  })
})

test.describe('DIRECTOR autenticado — sin sesión propia', () => {
  test('un contexto sin cookies: el archivo responde 401 y la pantalla pide iniciar sesión', async ({ browser }) => {
    const anonimo = await crearContexto.newContext({
      baseURL: BASE_URL,
      storageState: { cookies: [], origins: [] },
    })
    contextos.push(anonimo)
    const r = await anonimo.get(`/api/comprobantes/${COMPROBANTE}/archivo`, { maxRedirects: 0 })
    expect(r.status()).toBe(401)

    const contexto = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const pagina = await contexto.newPage()
    await pagina.goto('/dashboard/comprobantes')
    await expect(pagina).toHaveURL(/\/login/u)
    await contexto.close()
  })
})

// ================================================================
// Roles sin acceso al original ni al listado
// ================================================================
for (const [rol, archivo] of [
  ['PADRE', SESION.padre],
  ['ESTUDIANTE', SESION.estudiante],
  ['DOCENTE', SESION.docente],
  ['PERSONAL', SESION.personal],
] as const) {
  test.describe(`${rol} autenticado — comprobantes`, () => {
    test.beforeAll(async () => {
      preparar()
      await objeto('POST', PNG)
    })
    test.afterAll(async () => {
      await objeto('DELETE')
      limpiar()
    })

    test('la pantalla de Dirección es «Acceso restringido» y no muestra ningún dato', async ({ page }) => {
      await page.goto('/dashboard/comprobantes')
      await expect(page.getByRole('heading', { level: 1, name: 'Acceso restringido' })).toBeVisible()
      await expect(page.getByText('E2E-OP-109')).toHaveCount(0)
      await expect(page.getByText('E2E Comprobantes Alumno')).toHaveCount(0)
    })

    test('el original de un comprobante ajeno responde 404, sin ruta ni URL', async () => {
      const contexto = await conSesion(archivo)
      const r = await contexto.get(`/api/comprobantes/${COMPROBANTE}/archivo`, { maxRedirects: 0 })
      expect(r.status()).toBe(404)
      expect(r.headers().location).toBeUndefined()
      expect(await r.text()).not.toContain(RUTA)
    })
  })
}

test.describe('DIRECTOR BLOQUEADO autenticado — comprobantes', () => {
  test('la pantalla lleva a «Acceso bloqueado»', async ({ page }) => {
    await page.goto('/dashboard/comprobantes')
    await expect(page).toHaveURL(/\/acceso-bloqueado$/u)
  })

  test('el original responde 403 por bloqueo', async ({ request }) => {
    const r = await request.get(`/api/comprobantes/${COMPROBANTE}/archivo`, { maxRedirects: 0 })
    expect(r.status()).toBe(403)
  })
})
