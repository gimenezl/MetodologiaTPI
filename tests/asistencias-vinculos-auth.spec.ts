import { expect, request as crearContexto, test, type APIResponse, type Page } from '@playwright/test'
import {
  ALUMNOS,
  DNI,
  NOMBRE_GRUPO,
  borrarAsistencias,
  etiquetaDe,
  filasDe,
  prepararEscenario,
  limpiarEscenario,
  restaurarAcademico,
  revocarAcademico,
  revocarDeportivo,
  sembrarAsistencia,
  sql,
  sqlAlumnosVinculados,
  type ClaveAlumno,
} from './_asistencias-vinculos'

/**
 * Asistencias por vínculo vigente, con sesiones reales (EPT-66, unidad D).
 *
 * No hay mocks: cada petición atraviesa cookies SSR, `auth.getUser()`, el
 * control de rol del servidor, la RPC `registrar_asistencia`, la RLS de
 * `asistencias` y los bloqueos de PostgreSQL. Cada actor corre en su propio
 * proyecto de Playwright, con la identidad que realmente debe ser rechazada o
 * aceptada. El escenario (cuatro alumnos sin cuenta y su estructura) lo crea
 * `tests/_asistencias-vinculos.ts` con las RPC reales de la Dirección.
 *
 * El conjunto de alumnos que ve el docente se compara contra un oráculo SQL
 * escrito aparte del código bajo prueba (la misma regla del contrato).
 *
 * El archivo se omite salvo que el operador habilite la base local descartable.
 */

test.skip(
  process.env.EPT_SUPABASE_LOCAL !== '1',
  'Requiere EPT_SUPABASE_LOCAL=1 y un reset de la base local.'
)

const MENSAJE_NO_DISPONIBLE = 'El alumno ya no está a tu cargo o no está disponible. Actualizamos la lista.'
const FECHA_DOCENTE = '2031-11-10'
const FECHA_DIRECTOR = '2031-11-20'
const FECHA_LECTURA = '2031-11-12'

/** Alumnos con vínculo vigente con el docente de prueba, según el oráculo SQL del contrato. */
function alumnosConVinculo(): string[] {
  const doc = sql(`SELECT id FROM public.perfiles WHERE dni = '${DNI.docente}'`)
  return sql(`SELECT alumno_id FROM (${sqlAlumnosVinculados(doc)}) v ORDER BY 1`)
    .split('\n')
    .filter(Boolean)
}

function todosLosEstudiantes(): string[] {
  return sql(`
    SELECT p.id FROM public.perfiles p JOIN public.roles r ON r.id = p.rol_id
    WHERE r.nombre = 'ESTUDIANTE' ORDER BY 1
  `)
    .split('\n')
    .filter(Boolean)
}

type Panel = {
  estudiantes: { id: string; nombre: string; apellido: string; legajo_nro: string | null }[]
  asistencias: { id: string; fecha: string; estado: string; estudiante_id: string }[]
  historial: { estudiante_id: string; fecha: string; estado: string }[]
}

async function panelDe(request: import('@playwright/test').APIRequestContext, fecha: string) {
  const respuesta = await request.get(`/api/asistencias?fecha=${fecha}`)
  expect(respuesta.status()).toBe(200)
  return (await respuesta.json()) as Panel
}

function registrarPorApi(
  request: import('@playwright/test').APIRequestContext,
  clave: ClaveAlumno,
  fecha: string,
  estado = 'PRESENTE'
) {
  return request.post('/api/asistencias', {
    data: { estudiante_id: ALUMNOS[clave].id, fecha, estado },
  })
}

async function opcionesDelSelector(page: Page): Promise<string[]> {
  const selector = page.getByLabel('Alumno', { exact: true })
  await expect.poll(() => selector.locator('option').count()).toBeGreaterThan(1)
  return (
    await selector.locator('option').evaluateAll((opciones) =>
      opciones.filter((o) => (o as HTMLOptionElement).value !== '').map((o) => o.textContent?.trim() ?? '')
    )
  ).sort()
}

async function cuerpoDe(respuesta: APIResponse) {
  return (await respuesta.json()) as { error?: string; codigo?: string; campo?: string; asistencia?: { resultado: string } }
}

// ================================================================
// DOCENTE: vínculo académico y deportivo vigentes
// ================================================================
test.describe('DOCENTE autenticado — asistencias por vínculo vigente (EPT-66 D)', () => {
  test.describe.configure({ mode: 'serial', retries: 0 })

  test.beforeAll(() => {
    prepararEscenario()
  })
  test.afterAll(() => {
    limpiarEscenario()
  })
  test.afterEach(() => {
    for (const fecha of [FECHA_DOCENTE, FECHA_LECTURA]) borrarAsistencias(fecha)
  })

  test('el panel devuelve exactamente a los alumnos con vínculo vigente (oráculo SQL) y ninguno ajeno', async ({ request }) => {
    const panel = await panelDe(request, FECHA_DOCENTE)
    const ids = panel.estudiantes.map((e) => e.id).sort()
    expect(ids).toEqual(alumnosConVinculo())
    for (const clave of ['a1', 'a2', 'a3'] as const) expect(ids).toContain(ALUMNOS[clave].id)
    expect(ids).not.toContain(ALUMNOS.a4.id)
    // Solo cuatro datos por alumno: ni DNI ni domicilio ni teléfono.
    for (const estudiante of panel.estudiantes) {
      expect(Object.keys(estudiante).sort()).toEqual(['apellido', 'id', 'legajo_nro', 'nombre'])
    }
  })

  test('las lecturas solo incluyen asistencias de alumnos vinculados', async ({ request }) => {
    sembrarAsistencia('a1', FECHA_LECTURA, 'PRESENTE', null)
    sembrarAsistencia('a4', FECHA_LECTURA, 'AUSENTE', null)
    const panel = await panelDe(request, FECHA_LECTURA)
    const delDia = panel.asistencias.map((a) => a.estudiante_id)
    expect(delDia).toContain(ALUMNOS.a1.id)
    expect(delDia).not.toContain(ALUMNOS.a4.id)
    expect(panel.historial.map((h) => h.estudiante_id)).not.toContain(ALUMNOS.a4.id)
  })

  test('registra con el registrante derivado de la sesión (nunca del cuerpo)', async ({ request }) => {
    const respuesta = await registrarPorApi(request, 'a1', FECHA_DOCENTE, 'PRESENTE')
    expect(respuesta.status()).toBe(201)
    expect((await cuerpoDe(respuesta)).asistencia?.resultado).toBe('CREADA')
    expect(filasDe('a1', FECHA_DOCENTE)).toEqual([{ estado: 'PRESENTE', registrante: DNI.docente }])
  })

  test('rechaza un cuerpo que intenta fijar el registrante (400) y no deja filas', async ({ request }) => {
    const suplantada = await request.post('/api/asistencias', {
      data: {
        estudiante_id: ALUMNOS.a1.id,
        fecha: FECHA_DOCENTE,
        estado: 'PRESENTE',
        docente_id: sql(`SELECT id FROM public.perfiles WHERE dni = '${DNI.directora}'`),
      },
    })
    expect(suplantada.status()).toBe(400)
    expect(filasDe('a1', FECHA_DOCENTE)).toEqual([])

    for (const cuerpo of [
      { estudiante_id: 'no-es-uuid', fecha: FECHA_DOCENTE, estado: 'PRESENTE' },
      { estudiante_id: ALUMNOS.a1.id, fecha: '2031-02-31', estado: 'PRESENTE' },
      { estudiante_id: ALUMNOS.a1.id, fecha: FECHA_DOCENTE, estado: 'TARDE' },
    ]) {
      expect((await request.post('/api/asistencias', { data: cuerpo })).status()).toBe(400)
    }
    expect((await request.get('/api/asistencias')).status()).toBe(400)
    expect((await request.get('/api/asistencias?fecha=ayer')).status()).toBe(400)
  })

  test('un alumno sin vínculo (o inexistente) recibe la misma respuesta 404 y no persiste nada', async ({ request }) => {
    const sinVinculo = await registrarPorApi(request, 'a4', FECHA_DOCENTE)
    expect(sinVinculo.status()).toBe(404)
    const cuerpoSinVinculo = await cuerpoDe(sinVinculo)
    expect(cuerpoSinVinculo.codigo).toBe('ALUMNO_NO_DISPONIBLE')
    expect(cuerpoSinVinculo.error).toBe(MENSAJE_NO_DISPONIBLE)
    expect(filasDe('a4', FECHA_DOCENTE)).toEqual([])

    const inexistente = await request.post('/api/asistencias', {
      data: { estudiante_id: '00000000-0000-4000-8000-000000000066', fecha: FECHA_DOCENTE, estado: 'PRESENTE' },
    })
    expect(inexistente.status()).toBe(404)
    expect(await cuerpoDe(inexistente)).toEqual(cuerpoSinVinculo)
  })

  test('corregir una asistencia ya cargada es coherente y conserva al registrante original', async ({ request }) => {
    sembrarAsistencia('a2', FECHA_DOCENTE, 'AUSENTE', DNI.directora)
    const sinCambios = await registrarPorApi(request, 'a2', FECHA_DOCENTE, 'AUSENTE')
    expect(sinCambios.status()).toBe(200)
    expect((await cuerpoDe(sinCambios)).asistencia?.resultado).toBe('SIN_CAMBIOS')

    const corregida = await registrarPorApi(request, 'a2', FECHA_DOCENTE, 'JUSTIFICADO')
    expect(corregida.status()).toBe(200)
    expect((await cuerpoDe(corregida)).asistencia?.resultado).toBe('ACTUALIZADA')
    // El registrante original (Dirección) no se reemplaza por el docente que corrige.
    expect(filasDe('a2', FECHA_DOCENTE)).toEqual([{ estado: 'JUSTIFICADO', registrante: DNI.directora }])
  })

  test('sin sesión la API responde 401 y los métodos de borrado no existen (405)', async ({ request }) => {
    const anonimo = await crearContexto.newContext({
      baseURL: process.env.EPT_BASE_URL ?? 'http://localhost:3000',
      storageState: { cookies: [], origins: [] },
    })
    try {
      expect((await anonimo.get(`/api/asistencias?fecha=${FECHA_DOCENTE}`)).status()).toBe(401)
      expect((await registrarPorApi(anonimo, 'a1', FECHA_DOCENTE)).status()).toBe(401)
    } finally {
      await anonimo.dispose()
    }
    const borrado = await request.delete('/api/asistencias')
    expect(borrado.status()).toBe(405)
    expect(borrado.headers()['allow']).toContain('POST')
    expect((await request.put('/api/asistencias', { data: {} })).status()).toBe(405)
  })

  test.describe('revocaciones (el escenario se reconstruye antes de cada caso)', () => {
    test.beforeEach(() => {
      prepararEscenario()
    })

    test('revocado solo el académico, el vínculo deportivo mantiene el acceso; sin ninguno se pierde', async ({ request }) => {
      revocarAcademico()
      const panel = await panelDe(request, FECHA_DOCENTE)
      const ids = panel.estudiantes.map((e) => e.id)
      expect(ids).not.toContain(ALUMNOS.a1.id) // solo académico → perdido
      expect(ids).toContain(ALUMNOS.a2.id) // también deportivo → conservado
      expect(ids).toContain(ALUMNOS.a3.id)

      expect((await registrarPorApi(request, 'a1', FECHA_DOCENTE)).status()).toBe(404)
      expect((await registrarPorApi(request, 'a2', FECHA_DOCENTE)).status()).toBe(201)

      revocarDeportivo('a2')
      expect((await registrarPorApi(request, 'a2', FECHA_DOCENTE, 'AUSENTE')).status()).toBe(404)
      expect((await panelDe(request, FECHA_DOCENTE)).estudiantes.map((e) => e.id)).not.toContain(ALUMNOS.a2.id)
      // La asistencia que sí se registró con vínculo vigente ya no es visible para el docente.
      expect((await panelDe(request, FECHA_DOCENTE)).asistencias.map((a) => a.estudiante_id)).not.toContain(ALUMNOS.a2.id)
      expect(filasDe('a2', FECHA_DOCENTE)).toEqual([{ estado: 'PRESENTE', registrante: DNI.docente }])
    })

    test('registro y corrección por la pantalla: éxito solo tras la confirmación del servidor', async ({ page }) => {
      await page.goto('/dashboard/asistencias')
      await page.getByLabel('Filtrar por fecha').fill(FECHA_DOCENTE)
      expect(await opcionesDelSelector(page)).toEqual(
        expect.arrayContaining([etiquetaDe('a1'), etiquetaDe('a2'), etiquetaDe('a3')])
      )
      expect(await opcionesDelSelector(page)).not.toContain(etiquetaDe('a4'))

      await page.getByLabel('Alumno', { exact: true }).selectOption({ label: etiquetaDe('a2') })
      await page.getByLabel('Estado', { exact: true }).selectOption('AUSENTE')
      await page.getByRole('button', { name: 'Registrar' }).click()
      await expect(page.getByText('Asistencia registrada')).toBeVisible()

      const tabla = page.getByRole('table', { name: 'Tabla de asistencias' })
      const fila = tabla.getByRole('row').filter({ hasText: ALUMNOS.a2.apellido })
      await expect(fila).toBeVisible()
      expect(filasDe('a2', FECHA_DOCENTE)).toEqual([{ estado: 'AUSENTE', registrante: DNI.docente }])

      await fila.getByRole('button', { name: `Marcar ${ALUMNOS.a2.nombre} como presente` }).click()
      await expect(page.getByText('Asistencia actualizada')).toBeVisible()
      await expect.poll(() => filasDe('a2', FECHA_DOCENTE)[0]?.estado).toBe('PRESENTE')
      expect(filasDe('a2', FECHA_DOCENTE)[0]?.registrante).toBe(DNI.docente)
    })

    test('página abierta: tras la revocación el rechazo es explícito y la lista queda correcta', async ({ page }) => {
      await page.goto('/dashboard/asistencias')
      await page.getByLabel('Filtrar por fecha').fill(FECHA_DOCENTE)
      expect(await opcionesDelSelector(page)).toContain(etiquetaDe('a1'))
      await page.getByLabel('Alumno', { exact: true }).selectOption({ label: etiquetaDe('a1') })

      // Dirección revoca el único vínculo de a1 mientras esta página sigue abierta.
      revocarAcademico()

      await page.getByRole('button', { name: 'Registrar' }).click()
      await expect(page.getByRole('alert').filter({ hasText: MENSAJE_NO_DISPONIBLE })).toBeVisible()
      await expect(page.getByText('Asistencia registrada')).toHaveCount(0)
      expect(filasDe('a1', FECHA_DOCENTE)).toEqual([])

      // La lista ya no ofrece al alumno revocado; el vínculo alternativo (a2, a3) sigue.
      await expect.poll(() => opcionesDelSelector(page)).not.toContain(etiquetaDe('a1'))
      expect(await opcionesDelSelector(page)).toEqual(expect.arrayContaining([etiquetaDe('a2'), etiquetaDe('a3')]))
      await expect(page.getByLabel('Alumno', { exact: true })).toHaveValue('')
    })

    test('página abierta: al volver a la pestaña se refleja la revocación sin ninguna acción', async ({ page }) => {
      sembrarAsistencia('a1', FECHA_DOCENTE, 'PRESENTE', DNI.docente)
      await page.goto('/dashboard/asistencias')
      await page.getByLabel('Filtrar por fecha').fill(FECHA_DOCENTE)
      const tabla = page.getByRole('table', { name: 'Tabla de asistencias' })
      await expect(tabla.getByRole('row').filter({ hasText: ALUMNOS.a1.apellido })).toBeVisible()

      revocarAcademico()
      await page.evaluate(() => window.dispatchEvent(new Event('focus')))

      await expect(tabla.getByRole('row').filter({ hasText: ALUMNOS.a1.apellido })).toHaveCount(0)
      expect(await opcionesDelSelector(page)).not.toContain(etiquetaDe('a1'))
      // El dato no se tocó: sigue en la base, solo dejó de ser visible para este docente.
      expect(filasDe('a1', FECHA_DOCENTE)).toEqual([{ estado: 'PRESENTE', registrante: DNI.docente }])
    })

    test('página abierta: corregir el estado de un alumno ya revocado muestra el rechazo y no cambia el dato', async ({ page }) => {
      sembrarAsistencia('a1', FECHA_DOCENTE, 'PRESENTE', DNI.docente)
      await page.goto('/dashboard/asistencias')
      await page.getByLabel('Filtrar por fecha').fill(FECHA_DOCENTE)
      const tabla = page.getByRole('table', { name: 'Tabla de asistencias' })
      const fila = tabla.getByRole('row').filter({ hasText: ALUMNOS.a1.apellido })
      await expect(fila).toBeVisible()

      revocarAcademico()
      await fila.getByRole('button', { name: `Marcar ${ALUMNOS.a1.nombre} como ausente` }).click()

      await expect(page.getByRole('alert').filter({ hasText: MENSAJE_NO_DISPONIBLE })).toBeVisible()
      await expect(page.getByText('Asistencia actualizada')).toHaveCount(0)
      expect(filasDe('a1', FECHA_DOCENTE)).toEqual([{ estado: 'PRESENTE', registrante: DNI.docente }])
      await expect(tabla.getByRole('row').filter({ hasText: ALUMNOS.a1.apellido })).toHaveCount(0)
      restaurarAcademico()
    })
  })

  test('el grupo deportivo del escenario sigue existiendo y a su nombre (sanidad del escenario)', async () => {
    // Las revocaciones se reconstruyen por caso: acá el escenario está completo.
    prepararEscenario()
    expect(sql(`SELECT count(*) FROM public.grupos_deportivos WHERE nombre = '${NOMBRE_GRUPO}' AND activo`)).toBe('1')
    expect(alumnosConVinculo()).toEqual(expect.arrayContaining([ALUMNOS.a1.id, ALUMNOS.a2.id, ALUMNOS.a3.id]))
  })
})

// ================================================================
// DIRECTOR: acceso global preservado
// ================================================================
test.describe('DIRECTOR autenticado — asistencias globales (EPT-66 D)', () => {
  test.describe.configure({ mode: 'serial', retries: 0 })

  test.beforeAll(() => {
    prepararEscenario()
  })
  test.afterAll(() => {
    limpiarEscenario()
  })
  test.afterEach(() => {
    borrarAsistencias(FECHA_DIRECTOR)
  })

  test('el panel incluye a todos los estudiantes, también a quien no tiene docente a cargo', async ({ request }) => {
    const panel = await panelDe(request, FECHA_DIRECTOR)
    expect(panel.estudiantes.map((e) => e.id).sort()).toEqual(todosLosEstudiantes())
    expect(panel.estudiantes.map((e) => e.id)).toContain(ALUMNOS.a4.id)
  })

  test('registra a un alumno sin vínculo con ningún docente y queda a su nombre', async ({ request }) => {
    const respuesta = await registrarPorApi(request, 'a4', FECHA_DIRECTOR, 'JUSTIFICADO')
    expect(respuesta.status()).toBe(201)
    expect(filasDe('a4', FECHA_DIRECTOR)).toEqual([{ estado: 'JUSTIFICADO', registrante: DNI.directora }])
  })

  test('tampoco puede fijar otro registrante desde el cuerpo (400)', async ({ request }) => {
    const respuesta = await request.post('/api/asistencias', {
      data: {
        estudiante_id: ALUMNOS.a4.id,
        fecha: FECHA_DIRECTOR,
        estado: 'PRESENTE',
        docente_id: sql(`SELECT id FROM public.perfiles WHERE dni = '${DNI.docente}'`),
      },
    })
    expect(respuesta.status()).toBe(400)
    expect(filasDe('a4', FECHA_DIRECTOR)).toEqual([])
  })

  test('la pantalla ofrece a todos los alumnos y registra', async ({ page }) => {
    await page.goto('/dashboard/asistencias')
    await page.getByLabel('Filtrar por fecha').fill(FECHA_DIRECTOR)
    expect(await opcionesDelSelector(page)).toEqual(expect.arrayContaining([etiquetaDe('a1'), etiquetaDe('a4')]))
    await page.getByLabel('Alumno', { exact: true }).selectOption({ label: etiquetaDe('a4') })
    await page.getByRole('button', { name: 'Registrar' }).click()
    await expect(page.getByText('Asistencia registrada')).toBeVisible()
    expect(filasDe('a4', FECHA_DIRECTOR)).toEqual([{ estado: 'PRESENTE', registrante: DNI.directora }])
  })
})

// ================================================================
// Estudiante y padre: solo lectura de lo propio; sin acceso a la gestión
// ================================================================
for (const actor of [
  { rol: 'ESTUDIANTE', titulo: 'Mi asistencia' },
  { rol: 'PADRE', titulo: 'Asistencia de mis hijos' },
] as const) {
  test.describe(`${actor.rol} autenticado — asistencias de solo lectura (EPT-66 D)`, () => {
    test('la API de gestión responde 403 a lectura y escritura', async ({ request }) => {
      const lectura = await request.get(`/api/asistencias?fecha=${FECHA_LECTURA}`)
      expect(lectura.status()).toBe(403)
      expect((await cuerpoDe(lectura)).codigo).toBe('SIN_PERMISO')
      const escritura = await request.post('/api/asistencias', {
        data: { estudiante_id: ALUMNOS.a1.id, fecha: FECHA_LECTURA, estado: 'PRESENTE' },
      })
      expect(escritura.status()).toBe(403)
    })

    test('la pantalla no ofrece ningún control de registro ni de corrección', async ({ page }) => {
      await page.goto('/dashboard/asistencias')
      await expect(page.getByRole('heading', { name: actor.titulo })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Registrar' })).toHaveCount(0)
      await expect(page.getByLabel('Alumno', { exact: true })).toHaveCount(0)
      await expect(page.getByRole('button', { name: /^Marcar / })).toHaveCount(0)
    })
  })
}

// ================================================================
// PERSONAL y sin perfil: sin acceso
// ================================================================
for (const actor of ['PERSONAL', 'SIN PERFIL'] as const) {
  test.describe(`${actor} autenticado — asistencias sin acceso (EPT-66 D)`, () => {
    test('lectura y escritura responden 403', async ({ request }) => {
      expect((await request.get(`/api/asistencias?fecha=${FECHA_LECTURA}`)).status()).toBe(403)
      expect((await registrarPorApi(request, 'a1', FECHA_LECTURA)).status()).toBe(403)
    })
  })
}

// ================================================================
// Sesiones emitidas antes del bloqueo: la base, el servidor y la API lo niegan
// ================================================================
for (const rol of ['DIRECTOR', 'DOCENTE', 'ESTUDIANTE', 'PADRE', 'PERSONAL'] as const) {
  test.describe(`${rol} BLOQUEADO autenticado — asistencias (EPT-66 D)`, () => {
    test('el JWT previo al bloqueo no sirve: 403 ACCESO_BLOQUEADO en lectura y escritura', async ({ request }) => {
      const lectura = await request.get(`/api/asistencias?fecha=${FECHA_LECTURA}`)
      expect(lectura.status()).toBe(403)
      expect((await cuerpoDe(lectura)).codigo).toBe('ACCESO_BLOQUEADO')
      const escritura = await registrarPorApi(request, 'a1', FECHA_LECTURA)
      expect(escritura.status()).toBe(403)
      expect((await cuerpoDe(escritura)).codigo).toBe('ACCESO_BLOQUEADO')
    })
  })
}
