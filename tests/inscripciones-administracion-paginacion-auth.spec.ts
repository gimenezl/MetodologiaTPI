import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Completitud de las lecturas administrativas más allá del límite de 1000 filas
 * de PostgREST (EPT-62, RF16).
 *
 * Un `select` sin paginar se recorta en silencio al `max_rows` de la API (1000
 * en `supabase/config.toml`). Esta suite siembra, en la base local descartable,
 * más filas que ese tope en cada dominio y comprueba con una sesión real de
 * Dirección que:
 *
 *   1. los tres listados (comedor, transporte y deportes) muestran TODAS las filas;
 *   2. la ficha de un alumno encuentra sus matrículas aunque queden fuera de la
 *      primera página del listado global, porque el filtro por `alumno_id` lo
 *      aplica el servidor antes de paginar.
 *
 * `psql` sobre el contenedor local se usa solo para SEMBRAR, contar y limpiar;
 * nunca participa de lo que se prueba. Las inscripciones se generan con el
 * mismo camino de escritura de la aplicación (alta y baja lógica, con sus
 * triggers), no con inserciones que salten las reglas.
 */

test.skip(
  process.env.EPT_SUPABASE_LOCAL !== '1',
  'Requiere EPT_SUPABASE_LOCAL=1 y un reset de la base local.'
)

const CONTENEDOR = process.env.EPT_SUPABASE_DB_CONTAINER ?? 'supabase_db_educar-para-transformar'
const PREFIJO = 'E2E Pag62'
const DNI_RELLENO = '96300001'
const DNI_OBJETIVO = '96300002'
const DNI_DOCENTE = '99900004'
const LEGAJO_RELLENO = 'LEG-PAG62-0001'
const LEGAJO_OBJETIVO = 'LEG-PAG62-0002'
/** Más que el tope de 1000 filas de la API, en cada dominio. */
const FILAS = 1100
const SERVICIO_COMEDOR = 'e0000000-0000-4000-8000-000000000010'
const SERVICIO_TRANSPORTE = 'e0000000-0000-4000-8000-000000000020'
/** Segundo recorrido sembrado por EPT-60 (TR-SUR): otro servicio del MISMO tipo. */
const SERVICIO_TRANSPORTE_2 = 'e0000000-0000-4000-8000-000000000021'
/** Segundo servicio de tipo COMEDOR, propio de esta suite (se retira al terminar). */
const SERVICIO_COMEDOR_2 = 'e0000000-0000-4000-8000-0000000062c2'
const CODIGO_COMEDOR_2 = 'COMEDOR-PAG62'
/** Ciclos por servicio: dos servicios por tipo suman más que el tope de 1000 filas. */
const CICLOS_POR_SERVICIO = 600
const SESION_DIRECTORA = 'tests/.auth/directora.json'
const CAPTURAR = process.env.EPT_CAPTURAS === '1'

function sql(sentencia: string) {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTENEDOR, 'psql', '-X', '-q', '-A', '-t', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    { input: sentencia, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }
  ).trim()
}

const perfil = (dni: string) => `(SELECT id FROM public.perfiles WHERE dni = '${dni}')`

/** Retira todo lo que siembra esta suite, en una sola transacción. */
function limpiar() {
  sql(`
    BEGIN;
    ALTER TABLE public.confirmaciones_inscripcion
      DISABLE TRIGGER proteger_confirmacion_inscripcion_antes_de_escribir;
    DELETE FROM public.confirmaciones_inscripcion
      WHERE inscripcion_servicio_id IN (SELECT id FROM public.inscripciones_servicios
                                        WHERE alumno_id IN (${perfil(DNI_RELLENO)}, ${perfil(DNI_OBJETIVO)}))
         OR inscripcion_deportiva_id IN (SELECT id FROM public.inscripciones_deportivas
                                         WHERE alumno_id IN (${perfil(DNI_RELLENO)}, ${perfil(DNI_OBJETIVO)}))
         OR matricula_id IN (SELECT id FROM public.matriculas
                             WHERE alumno_id IN (${perfil(DNI_RELLENO)}, ${perfil(DNI_OBJETIVO)}));
    ALTER TABLE public.confirmaciones_inscripcion
      ENABLE TRIGGER proteger_confirmacion_inscripcion_antes_de_escribir;
    DELETE FROM public.inscripciones_servicios
      WHERE alumno_id IN (${perfil(DNI_RELLENO)}, ${perfil(DNI_OBJETIVO)});
    DELETE FROM public.inscripciones_deportivas
      WHERE alumno_id IN (${perfil(DNI_RELLENO)}, ${perfil(DNI_OBJETIVO)});
    DELETE FROM public.servicios_escolares WHERE codigo = '${CODIGO_COMEDOR_2}';
    DELETE FROM public.matriculas
      WHERE alumno_id IN (${perfil(DNI_RELLENO)}, ${perfil(DNI_OBJETIVO)});
    DELETE FROM public.alumnos
      WHERE perfil_id IN (${perfil(DNI_RELLENO)}, ${perfil(DNI_OBJETIVO)});
    DELETE FROM public.perfiles WHERE dni IN ('${DNI_RELLENO}', '${DNI_OBJETIVO}');
    DELETE FROM public.grupos_deportivos_horarios
      WHERE grupo_id IN (SELECT g.id FROM public.grupos_deportivos g
                         JOIN public.deportes d ON d.id = g.deporte_id
                         WHERE d.nombre ILIKE '${PREFIJO}%');
    DELETE FROM public.grupos_deportivos
      WHERE deporte_id IN (SELECT id FROM public.deportes WHERE nombre ILIKE '${PREFIJO}%');
    DELETE FROM public.deportes WHERE nombre ILIKE '${PREFIJO}%';
    COMMIT;
  `)
}

/** Dos alumnos ACTIVOS de nivel INICIAL con una matrícula vigente cada uno. */
function sembrarAlumnos() {
  sql(`
    BEGIN;
    INSERT INTO public.perfiles (rol_id, nombre, apellido, dni, legajo_nro)
    SELECT r.id, v.nombre, v.apellido, v.dni, v.legajo
    FROM public.roles r
    CROSS JOIN (VALUES
      ('Relleno', 'Paginación', '${DNI_RELLENO}', '${LEGAJO_RELLENO}'),
      ('Objetivo', 'Paginación', '${DNI_OBJETIVO}', '${LEGAJO_OBJETIVO}')
    ) AS v(nombre, apellido, dni, legajo)
    WHERE r.nombre = 'ESTUDIANTE';

    INSERT INTO public.matriculas (alumno_id, curso_id)
    SELECT p.id, (SELECT c.id FROM public.cursos c
                  JOIN public.niveles n ON n.id = c.nivel_id
                  WHERE n.nombre = 'INICIAL' AND c.activo ORDER BY c.id LIMIT 1)
    FROM public.perfiles p WHERE p.dni IN ('${DNI_RELLENO}', '${DNI_OBJETIVO}');

    UPDATE public.alumnos SET estado = 'ACTIVO'
    WHERE perfil_id IN (${perfil(DNI_RELLENO)}, ${perfil(DNI_OBJETIVO)});
    COMMIT;
  `)
}

/**
 * Matrículas cerradas: el alumno de relleno acumula `FILAS` recientes y el
 * objetivo tiene UNA muy antigua. En el orden del listado global (más recientes
 * primero) la del objetivo queda después de la fila 1000.
 */
function sembrarMatriculasCerradas() {
  sql(`
    BEGIN;
    INSERT INTO public.matriculas (alumno_id, curso_id, fecha_inicio, fecha_cierre, motivo_cierre)
    SELECT ${perfil(DNI_RELLENO)},
           (SELECT curso_id FROM public.matriculas WHERE alumno_id = ${perfil(DNI_RELLENO)} AND fecha_cierre IS NULL),
           now() - (g * interval '2 minutes') - interval '10 minutes',
           now() - (g * interval '2 minutes') - interval '9 minutes',
           'CAMBIO_DE_CURSO'
    FROM generate_series(1, ${FILAS}) AS g;

    INSERT INTO public.matriculas (alumno_id, curso_id, fecha_inicio, fecha_cierre, motivo_cierre)
    SELECT ${perfil(DNI_OBJETIVO)},
           (SELECT curso_id FROM public.matriculas WHERE alumno_id = ${perfil(DNI_OBJETIVO)} AND fecha_cierre IS NULL),
           timestamptz '2001-03-05 10:00:00+00', timestamptz '2001-12-20 10:00:00+00', 'CAMBIO_DE_CURSO';
    COMMIT;
  `)
}

/** Altas y bajas lógicas reales (con sus triggers): `FILAS` ciclos cancelados. */
function sembrarCiclos(servicioId: string, cantidad: number) {
  sql(`
    DO $$
    DECLARE
      v_alumno UUID := ${perfil(DNI_RELLENO)};
      v_id UUID;
    BEGIN
      FOR i IN 1..${cantidad} LOOP
        INSERT INTO public.inscripciones_servicios (alumno_id, servicio_id)
        VALUES (v_alumno, '${servicioId}') RETURNING id INTO v_id;
        UPDATE public.inscripciones_servicios SET estado = 'CANCELADA' WHERE id = v_id;
      END LOOP;
    END $$;
  `)
}

/** Deporte, grupo y franja propios, con el rol de Dirección por la API real. */
async function crearGrupoDeportivo(page: Page): Promise<string> {
  const deporte = await page.request.post('/api/deportes', { data: { nombre: `${PREFIJO} Deporte` } })
  expect(deporte.status(), await deporte.text()).toBe(201)
  const deporteId = (await deporte.json()).deporte.id as string
  const nivel = sql(`SELECT id FROM public.niveles WHERE nombre = 'INICIAL';`)
  const docente = sql(`SELECT id FROM public.perfiles WHERE dni = '${DNI_DOCENTE}';`)
  const grupo = await page.request.post('/api/deportes/grupos', {
    data: { deporte_id: deporteId, nivel_id: Number(nivel), nombre: `${PREFIJO} Grupo`, cupo: 5, profesor_id: docente },
  })
  expect(grupo.status(), await grupo.text()).toBe(201)
  const grupoId = (await grupo.json()).grupo.id as string
  const franja = await page.request.post(`/api/deportes/grupos/${grupoId}/horarios`, {
    data: { dia_semana: 7, hora_inicio: '18:00', hora_fin: '19:00' },
  })
  expect(franja.status(), await franja.text()).toBe(201)
  return grupoId
}

function sembrarCiclosDeportivos(grupoId: string) {
  sql(`
    DO $$
    DECLARE
      v_alumno UUID := ${perfil(DNI_RELLENO)};
      v_id UUID;
    BEGIN
      FOR i IN 1..${FILAS} LOOP
        INSERT INTO public.inscripciones_deportivas (alumno_id, grupo_id)
        VALUES (v_alumno, '${grupoId}') RETURNING id INTO v_id;
        UPDATE public.inscripciones_deportivas SET estado = 'CANCELADA' WHERE id = v_id;
      END LOOP;
    END $$;
  `)
}

function total(consulta: string): number {
  return Number(sql(consulta))
}

/**
 * Filas de un TIPO de servicio: el mismo conjunto que lista la pantalla (todas las
 * inscripciones de todos los servicios de ese tipo), no las de un `servicio_id`.
 */
const totalPorTipo = (tipo: 'COMEDOR' | 'TRANSPORTE') =>
  total(`
    SELECT count(*) FROM public.inscripciones_servicios i
    JOIN public.servicios_escolares s ON s.id = i.servicio_id
    WHERE s.tipo = '${tipo}';
  `)
const serviciosConFilas = (tipo: 'COMEDOR' | 'TRANSPORTE') =>
  total(`
    SELECT count(DISTINCT i.servicio_id) FROM public.inscripciones_servicios i
    JOIN public.servicios_escolares s ON s.id = i.servicio_id
    WHERE s.tipo = '${tipo}';
  `)
const filasDeUnServicio = (servicioId: string) =>
  total(`SELECT count(*) FROM public.inscripciones_servicios WHERE servicio_id = '${servicioId}';`)
const TOTAL_COMEDOR = () => totalPorTipo('COMEDOR')
const TOTAL_TRANSPORTE = () => totalPorTipo('TRANSPORTE')
const TOTAL_DEPORTES = () => total(`SELECT count(*) FROM public.inscripciones_deportivas;`)

/**
 * Cantidad de filas que muestra la lista con el filtro «Todas». Comedor declara
 * «Se muestran X de N registros»; transporte y deportes, «N inscripciones».
 */
async function totalMostrado(page: Page): Promise<number> {
  await page.getByRole('button', { name: 'Todas', exact: true }).first().click()
  const resumen = page.getByRole('status').filter({ hasText: /\d+ inscripci|Se muestran \d+ de \d+/ }).first()
  await expect(resumen).toBeVisible()
  const texto = (await resumen.textContent()) ?? ''

  const comedor = /Se muestran (\d+) de (\d+)/.exec(texto)
  if (comedor) {
    expect(Number(comedor[1]), 'con el filtro «Todas» se muestran todas las filas').toBe(Number(comedor[2]))
    return Number(comedor[2])
  }
  const generico = /(\d+) inscripci/.exec(texto)
  expect(generico, `resumen sin cifras: «${texto}»`).not.toBeNull()
  return Number((generico as RegExpExecArray)[1])
}

test.describe.configure({ mode: 'serial' })

test.describe('DIRECTOR autenticado — más de 1000 filas por dominio', () => {
  test.use({ storageState: SESION_DIRECTORA })

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(420_000)
    limpiar()
    sembrarAlumnos()
    sembrarMatriculasCerradas()
    sql(`
      INSERT INTO public.servicios_escolares (id, tipo, codigo, nombre)
      VALUES ('${SERVICIO_COMEDOR_2}', 'COMEDOR', '${CODIGO_COMEDOR_2}', '${PREFIJO} Comedor 2');
    `)
    // Dos servicios por tipo: la lista de un tipo abarca ambos, y el conteo de la
    // prueba también.
    sembrarCiclos(SERVICIO_COMEDOR, CICLOS_POR_SERVICIO)
    sembrarCiclos(SERVICIO_COMEDOR_2, CICLOS_POR_SERVICIO)
    sembrarCiclos(SERVICIO_TRANSPORTE, CICLOS_POR_SERVICIO)
    sembrarCiclos(SERVICIO_TRANSPORTE_2, CICLOS_POR_SERVICIO)

    const contexto = await browser.newContext({ storageState: SESION_DIRECTORA, baseURL: 'http://localhost:3000' })
    const pagina = await contexto.newPage()
    const grupoId = await crearGrupoDeportivo(pagina)
    sembrarCiclosDeportivos(grupoId)
    await contexto.close()
  })

  test.afterAll(() => {
    limpiar()
  })

  test('el fixture supera el límite y deja la matrícula del objetivo fuera de la primera página', () => {
    expect(TOTAL_COMEDOR()).toBeGreaterThan(1000)
    expect(TOTAL_TRANSPORTE()).toBeGreaterThan(1000)
    // Cada tipo tiene filas en más de un servicio, y el conteo por tipo difiere del
    // de un solo `servicio_id`: comparar contra uno solo daría un número menor.
    expect(serviciosConFilas('COMEDOR')).toBeGreaterThanOrEqual(2)
    expect(serviciosConFilas('TRANSPORTE')).toBeGreaterThanOrEqual(2)
    expect(TOTAL_COMEDOR()).toBeGreaterThan(filasDeUnServicio(SERVICIO_COMEDOR))
    expect(TOTAL_TRANSPORTE()).toBeGreaterThan(filasDeUnServicio(SERVICIO_TRANSPORTE))
    expect(TOTAL_DEPORTES()).toBeGreaterThan(1000)
    expect(total(`SELECT count(*) FROM public.matriculas;`)).toBeGreaterThan(1000)

    // Posición de la matrícula antigua del objetivo en el orden del listado global.
    const posicion = total(`
      SELECT posicion FROM (
        SELECT id, alumno_id, row_number() OVER (ORDER BY fecha_inicio DESC, id ASC) AS posicion
        FROM public.matriculas
      ) t WHERE alumno_id = ${perfil(DNI_OBJETIVO)} AND posicion > 1000 LIMIT 1;
    `)
    expect(posicion, 'la matrícula del objetivo debe quedar después de la fila 1000').toBeGreaterThan(1000)
  })

  test('comedor lista todas las inscripciones, también las posteriores a la fila 1000', async ({ page }) => {
    await page.goto('/dashboard/comedor')
    expect(await totalMostrado(page)).toBe(TOTAL_COMEDOR())
  })

  test('transporte lista todas las inscripciones, también las posteriores a la fila 1000', async ({ page }) => {
    await page.goto('/dashboard/transporte')
    expect(await totalMostrado(page)).toBe(TOTAL_TRANSPORTE())
  })

  test('deportes lista todas las inscripciones, también las posteriores a la fila 1000', async ({ page }) => {
    await page.goto('/dashboard/deportes')
    expect(await totalMostrado(page)).toBe(TOTAL_DEPORTES())
  })

  test('la ficha encuentra las matrículas del alumno aunque estén fuera de la primera página', async ({ page }) => {
    const objetivo = sql(`SELECT id FROM public.perfiles WHERE dni = '${DNI_OBJETIVO}';`)
    await page.goto(`/dashboard/alumnos/${objetivo}`)

    const seccion = page.getByRole('region', { name: /Confirmación de la matrícula/ })
    await expect(seccion).toBeVisible()
    // Vigente + la cerrada de 2001, que el listado global habría dejado fuera.
    await expect(seccion.getByRole('listitem').filter({ hasText: 'Desde' })).toHaveCount(2)
    await expect(seccion.getByText('05/03/2001', { exact: false })).toBeVisible()
    await expect(seccion.getByText('Cerrada', { exact: true })).toBeVisible()
    if (CAPTURAR) {
      const carpeta = path.join('docs', 'evidence', 'EPT-62', 'capturas')
      fs.mkdirSync(carpeta, { recursive: true })
      await page.screenshot({ path: path.join(carpeta, 'e2e-escritorio-ficha-matricula-fuera-de-primera-pagina.png'), fullPage: true })
    }
  })

  test('la ficha del alumno de relleno muestra todas sus matrículas (más de 1000)', async ({ page }) => {
    const relleno = sql(`SELECT id FROM public.perfiles WHERE dni = '${DNI_RELLENO}';`)
    await page.goto(`/dashboard/alumnos/${relleno}`)
    const seccion = page.getByRole('region', { name: /Confirmación de la matrícula/ })
    await expect(seccion).toBeVisible()
    await expect(seccion.getByRole('listitem').filter({ hasText: 'Desde' })).toHaveCount(FILAS + 1)
  })

  test('la ficha filtra por alumno en el servidor y no descarga el listado global', () => {
    const fuente = fs.readFileSync(path.join('src', 'app', 'dashboard', 'alumnos', '[id]', 'page.tsx'), 'utf8')
    expect(fuente).toContain('listarMatriculasAdministracion(id)')
    expect(fuente).not.toMatch(/matriculas\.datos\.filter\(/)

    const servicio = fs.readFileSync(path.join('src', 'services', 'inscripciones-administracion.service.ts'), 'utf8')
    expect(servicio).toMatch(/\.eq\('alumno_id', alumnoId\)/)
    expect(servicio).toContain('.range(desde, hasta)')
  })
})
