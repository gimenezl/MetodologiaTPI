import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { exigirPantallaSinDetalleTecnico } from './_sin-detalle-tecnico'

/**
 * Consulta de correos programados para Dirección (EPT-118), con sesiones reales y la
 * base real. Los envíos SMTP, los PDF y la clasificación de fallos los prueban
 * `supabase/tests/recordatorio-api.mjs` y `aviso-deuda-api.mjs`: acá se prueba lo que
 * ve y puede hacer cada ROL en la pantalla.
 *
 * `psql` se usa solo para PREPARAR y LIMPIAR filas sintéticas; nunca participa de la
 * operación que se verifica. El archivo se omite salvo que el operador habilite la
 * base local descartable.
 */

test.skip(
  process.env.EPT_SUPABASE_LOCAL !== '1',
  'Requiere EPT_SUPABASE_LOCAL=1 y un reset de la base local.'
)

const CONTENEDOR = process.env.EPT_SUPABASE_DB_CONTAINER ?? 'supabase_db_educar-para-transformar'
const ID = (n: number) => `e1180000-0000-4000-8000-${String(n).padStart(12, '0')}`
const PADRE = ID(1)
const TOKEN_INTERNO = ID(99)
const MARCA = 'E2E EPT118'

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
    DELETE FROM public.envios_correo_intentos WHERE envio_id IN (SELECT id FROM public.envios_correo WHERE padre_id = '${PADRE}');
    DELETE FROM public.envios_correo_facturas WHERE envio_id IN (SELECT id FROM public.envios_correo WHERE padre_id = '${PADRE}');
    DELETE FROM public.envios_correo WHERE padre_id = '${PADRE}';
    DELETE FROM public.perfiles WHERE id = '${PADRE}';
    COMMIT;
  `)
}

/** Fechas lejanas (2099) para que las filas sintéticas encabecen el orden descendente. */
function preparar() {
  limpiar()
  sql(`
    BEGIN;
    INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni)
    VALUES ('${PADRE}', NULL, (SELECT id FROM public.roles WHERE nombre = 'PADRE'), 'Prueba', '${MARCA} Padre', '95118001');
    INSERT INTO public.envios_correo (padre_id, tipo, fecha_programada, estado, intentos, periodo, ultimo_intento_fecha,
                                      ultimo_error, frontera_smtp_en, reserva_token, reserva_hasta)
    VALUES
      ('${PADRE}', 'RECORDATORIO_MENSUAL', '2099-12-31', 'INCIERTO', 1, '2100-01-01', '2099-12-31',
       'Fallo SMTP (Error CONN) destino ficticio@ept118.test', now(), '${TOKEN_INTERNO}', now() + interval '1 hour'),
      ('${PADRE}', 'AVISO_DEUDA', '2099-12-20', 'FALLIDO', 3, NULL, '2099-12-22',
       'Fallo SMTP (Error EENVELOPE RCPT TO 550)', NULL, NULL, NULL);
    COMMIT;
  `)
  // Cincuenta y dos filas más del mismo tipo: obligan a una segunda página (límite de 50).
  sql(`
    INSERT INTO public.envios_correo (padre_id, tipo, fecha_programada, estado, intentos, ultimo_intento_fecha)
    SELECT '${PADRE}', 'AVISO_DEUDA', DATE '2098-01-01' + g, 'PENDIENTE', 0, NULL FROM generate_series(1, 52) g;
  `)
}

test.describe.serial('DIRECTOR autenticado — correos programados', () => {
  test.beforeAll(preparar)
  test.afterAll(limpiar)

  test('lista ambos tipos y estados, con la advertencia de INCIERTO visible como texto', async ({ page }) => {
    await page.goto('/dashboard/envios-correo')
    await expect(page.getByRole('main').getByRole('heading', { level: 1, name: 'Correos programados' })).toBeVisible()
    await expect(page.getByRole('note')).toContainText('No se reintenta')
    const incierto = page.locator('tr[data-estado="INCIERTO"]', { hasText: MARCA })
    await expect(incierto).toHaveCount(1)
    await expect(incierto).toContainText('Recordatorio mensual')
    await expect(incierto).toContainText('31/12/2099')
    await expect(incierto).toContainText('01/01/2100')
    await expect(incierto).toContainText('Pudo haber sido aceptado. Sin reintento automático.')
    await expect(incierto).toContainText('Incierto')
    // El motivo sale saneado: el correo guardado por error no se muestra.
    await expect(incierto).toContainText('[correo oculto]')
    await expect(incierto).not.toContainText('ept118.test')
    const fallido = page.locator('tr[data-estado="FALLIDO"]', { hasText: MARCA })
    await expect(fallido).toContainText('Aviso de deuda')
    await expect(fallido).toContainText('22/12/2099')
    await expect(fallido).toContainText('RCPT TO 550')
    await exigirPantallaSinDetalleTecnico(page, 'correos programados de Dirección')
  })

  test('no expone tokens internos, valores económicos ni acciones de escritura', async ({ page }) => {
    await page.goto('/dashboard/envios-correo')
    const html = await page.content()
    expect(html).not.toContain(TOKEN_INTERNO)
    expect(html).not.toMatch(/reserva_token|reserva_hasta|frontera_smtp|total_adeudado/iu)
    const main = page.getByRole('main')
    await expect(main.getByRole('button')).toHaveCount(0)
    await expect(main.locator('form')).toHaveCount(0)
    await expect(main.getByRole('link', { name: /reenviar|reabrir|resolver|borrar|eliminar|aprobar|cambiar/iu })).toHaveCount(0)
  })

  test('filtra por estado y por tipo; un valor desconocido se ignora', async ({ page }) => {
    await page.goto('/dashboard/envios-correo?estado=INCIERTO')
    await expect(page.locator('tr[data-estado="INCIERTO"]', { hasText: MARCA })).toHaveCount(1)
    await expect(page.locator('tr[data-estado="FALLIDO"]')).toHaveCount(0)
    await page.goto('/dashboard/envios-correo?tipo=RECORDATORIO_MENSUAL&estado=INCIERTO')
    await expect(page.locator('tr[data-tipo="AVISO_DEUDA"]')).toHaveCount(0)
    await page.goto('/dashboard/envios-correo?estado=DROP&tipo=x')
    await expect(page.getByRole('main').getByRole('heading', { level: 1, name: 'Correos programados' })).toBeVisible()
    await expect(page.locator('tr[data-estado="INCIERTO"]', { hasText: MARCA })).toHaveCount(1)
  })

  test('pagina con un límite acotado y orden estable; más allá del final muestra el estado vacío', async ({ page }) => {
    await page.goto('/dashboard/envios-correo?tipo=AVISO_DEUDA')
    await expect(page.locator('tbody tr')).toHaveCount(50)
    const primera = await page.locator('tbody tr').first().textContent()
    expect(primera).toContain('20/12/2099') // la fecha programada más reciente encabeza el orden
    await page.getByRole('link', { name: 'Siguiente' }).click()
    await expect(page).toHaveURL(/pagina=2/u)
    expect(await page.locator('tbody tr').count()).toBeGreaterThanOrEqual(1)
    await expect(page.getByRole('link', { name: 'Anterior' })).toBeVisible()
    await page.goto('/dashboard/envios-correo?pagina=9999')
    await expect(page.getByRole('status')).toContainText('No hay más correos programados')
  })

  test('el menú de Dirección enlaza a la pantalla', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page.getByRole('link', { name: 'Correos programados' }).first()).toBeVisible()
  })

  // EPT-121: el estado de error y su reintento no tenían cobertura automatizada (matriz de EPT-118). Se provoca una
  // falla REAL de lectura —se retira el SELECT del rol `authenticated`— sin tocar el producto, y se restaura siempre.
  test('una lectura fallida muestra un error sin detalle técnico y «Reintentar» recupera la lista', async ({ page }) => {
    const privilegio = () => sql(`SELECT has_table_privilege('authenticated', 'public.envios_correo', 'SELECT');`) === 't'
    expect(privilegio(), 'precondición: el rol authenticated debe poder leer la tabla').toBe(true)
    await page.goto('/dashboard/envios-correo')
    await expect(page.locator('tr[data-estado="INCIERTO"]', { hasText: MARCA })).toHaveCount(1) // la lista existe antes de la falla
    sql('REVOKE SELECT ON public.envios_correo FROM authenticated;')
    try {
      await page.goto('/dashboard/envios-correo')
      const principal = page.getByRole('main')
      await expect(principal.getByRole('heading', { level: 1, name: 'Correos programados' })).toBeVisible()
      await expect(principal.getByText('No pudimos cargar los correos programados', { exact: true })).toBeVisible()
      await expect(principal.getByText('Volvé a intentarlo en unos minutos.')).toBeVisible()
      await expect(principal.getByRole('link', { name: 'Reintentar' })).toBeVisible()
      // Una lectura fallida no se disfraza de lista vacía ni deja filas viejas.
      await expect(principal.locator('tbody tr')).toHaveCount(0)
      await expect(page.getByText('No hay más correos programados')).toHaveCount(0)
      await exigirPantallaSinDetalleTecnico(page, 'error de lectura de correos programados')
    } finally {
      sql('GRANT SELECT ON public.envios_correo TO authenticated;')
    }
    expect(privilegio(), 'el privilegio se restauró').toBe(true)
    await page.getByRole('link', { name: 'Reintentar' }).click()
    await expect(page.locator('tr[data-estado="INCIERTO"]', { hasText: MARCA })).toHaveCount(1)
  })
})

test.describe('DIRECTOR autenticado — sin sesión propia (correos programados)', () => {
  test('un contexto sin cookies es llevado a iniciar sesión', async ({ browser }) => {
    const contexto = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const pagina = await contexto.newPage()
    await pagina.goto('/dashboard/envios-correo')
    await expect(pagina).toHaveURL(/\/login/u)
    await contexto.close()
  })
})

for (const rol of ['PADRE', 'ESTUDIANTE', 'DOCENTE', 'PERSONAL'] as const) {
  test.describe(`${rol} autenticado — correos programados`, () => {
    test.beforeAll(preparar)
    test.afterAll(limpiar)

    test('la pantalla de Dirección es «Acceso restringido» y no muestra ningún dato', async ({ page }) => {
      await page.goto('/dashboard/envios-correo')
      await expect(page.getByRole('heading', { level: 1, name: 'Acceso restringido' })).toBeVisible()
      await expect(page.getByText(MARCA)).toHaveCount(0)
      await expect(page.getByText('Aviso de deuda')).toHaveCount(0)
      await expect(page.getByRole('link', { name: 'Correos programados' })).toHaveCount(0)
    })
  })
}

test.describe('DIRECTOR BLOQUEADO autenticado — correos programados', () => {
  test('la pantalla lleva a «Acceso bloqueado»', async ({ page }) => {
    await page.goto('/dashboard/envios-correo')
    await expect(page).toHaveURL(/\/acceso-bloqueado$/u)
  })
})
