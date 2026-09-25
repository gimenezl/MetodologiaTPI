import { expect, test, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { exigirMensajeSinDetalleTecnico, exigirPantallaSinDetalleTecnico } from './_sin-detalle-tecnico'

/**
 * Profesores con sesiones reales creadas por `tests/auth.setup.ts` (EPT-58).
 *
 * Sin mocks: cada acción atraviesa cookies SSR, `auth.getUser()`, la
 * autorización del servidor, las RPC de la migración A y PostgreSQL. Los
 * docentes del fixture son sintéticos y no tienen cuenta; el DOCENTE de la
 * sesión es el de `auth.setup.ts`. Solo contra la base local descartable.
 */

test.skip(
  process.env.EPT_SUPABASE_LOCAL !== '1',
  'Requiere EPT_SUPABASE_LOCAL=1 y un reset de la base local.'
)

const CONTENEDOR = process.env.EPT_SUPABASE_DB_CONTAINER ?? 'supabase_db_educar-para-transformar'
const CAPTURAR = process.env.EPT_CAPTURAS === '1'
const ESCRITORIO = { width: 1280, height: 900 }
const MOVIL = { width: 375, height: 812 }

const ID = {
  incompleta: 'f5900000-0000-4000-8000-000000000001',
  conMateria: 'f5900000-0000-4000-8000-000000000002',
  conGrupo: 'f5900000-0000-4000-8000-000000000003',
  reactivable: 'f5900000-0000-4000-8000-000000000004',
  ciclo: 'f5900000-0000-4000-8000-000000000005',
  ajeno: 'f5900000-0000-4000-8000-000000000006',
  inexistente: 'f5900000-0000-4000-8000-0000000000ff',
  curso: 'f5900000-0000-4000-8000-0000000000c1',
  cursoAuxiliar: 'f5900000-0000-4000-8000-0000000000c2',
  grupo: 'f5900000-0000-4000-8000-0000000000d1',
  cursoDocente: 'f5900000-0000-4000-8000-0000000000c3',
  grupoDocente: 'f5900000-0000-4000-8000-0000000000d2',
}
const FICHAS = [ID.incompleta, ID.conMateria, ID.conGrupo, ID.reactivable, ID.ciclo, ID.ajeno]
const lista = (valores: string[]) => valores.map((v) => `'${v}'`).join(', ')
const DNI_DOCENTE_SESION = '99900004'

function sql(sentencia: string) {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTENEDOR, 'psql', '-X', '-q', '-A', '-t', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    { input: sentencia, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim()
}

async function capturar(page: Page, nombre: string) {
  if (!CAPTURAR) return
  const ancho = (page.viewportSize()?.width ?? 1280) < 640 ? 'movil-375' : 'escritorio-1280'
  await page.screenshot({
    path: path.join('docs/evidence/EPT-58/etapa-2', `real-${ancho}-${nombre}.png`),
    fullPage: true,
  })
}

/** Retira todo lo que crean estas pruebas. El historial es de solo agregado: solo esta limpieza local deshabilita su guarda, dentro de la transacción. */
function limpiar() {
  sql(`
    BEGIN;
    ALTER TABLE public.profesores_estados_historial DISABLE TRIGGER impedir_modificar_historial_profesor;
    DELETE FROM public.profesores_estados_historial WHERE profesor_id IN (${lista(FICHAS)});
    ALTER TABLE public.profesores_estados_historial ENABLE TRIGGER impedir_modificar_historial_profesor;
    DELETE FROM public.materias_cursos_horarios_historial
      WHERE franja_id IN (SELECT f.id FROM public.materias_cursos_horarios f
        JOIN public.materias_cursos mc ON mc.id = f.asignacion_id
        WHERE mc.curso_id IN (${lista([ID.curso, ID.cursoAuxiliar, ID.cursoDocente])}));
    DELETE FROM public.materias_cursos_horarios
      WHERE asignacion_id IN (SELECT id FROM public.materias_cursos
        WHERE curso_id IN (${lista([ID.curso, ID.cursoAuxiliar, ID.cursoDocente])}));
    DELETE FROM public.grupos_deportivos_horarios WHERE grupo_id IN (${lista([ID.grupo, ID.grupoDocente])});
    DELETE FROM public.grupos_deportivos WHERE id IN (${lista([ID.grupo, ID.grupoDocente])});
    DELETE FROM public.materias_cursos
      WHERE curso_id IN (${lista([ID.curso, ID.cursoAuxiliar, ID.cursoDocente])});
    DELETE FROM public.profesores WHERE perfil_id IN (${lista(FICHAS)});
    DELETE FROM public.perfiles WHERE id IN (${lista(FICHAS)});
    DELETE FROM public.cursos WHERE id IN (${lista([ID.curso, ID.cursoAuxiliar, ID.cursoDocente])});
    DELETE FROM public.actividades WHERE tipo = 'CURRICULAR' AND nombre LIKE 'Materia E2E EPT58%';
    COMMIT;
  `)
}

function perfilesDocentes(filas: [string, string, string, string | null][]) {
  return filas
    .map(
      ([id, apellido, dni, legajo]) =>
        `('${id}'::uuid, '${apellido}', '${dni}', ${legajo ? `'${legajo}'` : 'NULL'})`
    )
    .join(',\n')
}

async function nombreEnMenu(page: Page) {
  const menu = page.getByRole('navigation', { name: 'Menú del dashboard' })
  await expect(menu).toBeVisible()
  return menu
}

// ================================================================
// DIRECTOR
// ================================================================
test.describe('DIRECTOR autenticado — profesores', () => {
  test.beforeAll(() => {
    if (test.info().project.name !== 'chromium-directora') return
    limpiar()
    sql(`
      BEGIN;
      INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
      SELECT v.id, NULL, r.id, 'Prueba', v.apellido, v.dni, v.legajo
      FROM (VALUES ${perfilesDocentes([
        [ID.incompleta, 'Ficha Incompleta', '95900001', null],
        [ID.conMateria, 'Con Materia', '95900002', 'LEG-E2E-EPT58-2'],
        [ID.conGrupo, 'Con Grupo', '95900003', 'LEG-E2E-EPT58-3'],
        [ID.reactivable, 'Reactivable', '95900004', 'LEG-E2E-EPT58-4'],
        [ID.ciclo, 'Ciclo', '95900005', 'LEG-E2E-EPT58-5'],
      ])}) AS v(id, apellido, dni, legajo)
      JOIN public.roles r ON r.nombre = 'DOCENTE';
      UPDATE public.profesores SET especialidad = 'Lengua'
        WHERE perfil_id IN ('${ID.conMateria}', '${ID.conGrupo}', '${ID.ciclo}');
      UPDATE public.profesores SET estado = 'INACTIVO' WHERE perfil_id = '${ID.reactivable}';
      INSERT INTO public.cursos (id, nivel_id, denominacion, division, activo) VALUES
        ('${ID.curso}', (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 'Curso E2E EPT58', 'A', TRUE),
        ('${ID.cursoAuxiliar}', (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 'Curso E2E EPT58', 'B', TRUE);
      INSERT INTO public.actividades (nombre, tipo, activo) VALUES ('Materia E2E EPT58', 'CURRICULAR', TRUE);
      INSERT INTO public.materias_cursos (materia_id, curso_id, profesor_id, activo)
      VALUES ((SELECT id FROM public.actividades WHERE nombre = 'Materia E2E EPT58'), '${ID.curso}', '${ID.conMateria}', TRUE);
      INSERT INTO public.grupos_deportivos (id, deporte_id, nivel_id, nombre, cupo, profesor_id)
      VALUES ('${ID.grupo}', 'e0000000-0000-4000-8000-000000000101',
              (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 'Grupo E2E EPT58', 10, '${ID.conGrupo}');
      COMMIT;
    `)
  })

  test.afterAll(() => {
    if (test.info().project.name !== 'chromium-directora') return
    limpiar()
  })

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(ESCRITORIO)
  })

  test('ve Profesores en el menú y lista las fichas con la incompleta anunciada', async ({ page }) => {
    await page.goto('/dashboard/profesores')
    const menu = await nombreEnMenu(page)
    await expect(menu.getByRole('link', { name: 'Profesores' })).toBeVisible()
    await expect(menu.getByRole('link', { name: 'Mis asignaciones' })).toHaveCount(0)

    const fichas = page.getByRole('list', { name: 'Fichas de profesores' })
    const incompleta = fichas.locator('> li').filter({ hasText: 'Ficha Incompleta, Prueba' })
    await expect(incompleta).toContainText('Ficha incompleta')
    await expect(incompleta).toContainText('Legajo sin cargar')
    await expect(fichas.locator('> li').filter({ hasText: 'Con Materia, Prueba' })).toContainText(
      'A cargo de 1 materia y 0 grupos deportivos'
    )
    await expect(page.getByRole('button', { name: /eliminar|borrar/i })).toHaveCount(0)
    await exigirPantallaSinDetalleTecnico(page, 'listado real')
    await capturar(page, 'listado')

    await page.setViewportSize(MOVIL)
    await page.reload()
    await expect(fichas).toBeVisible()
    const scroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    )
    expect(scroll).toBe(false)
    await capturar(page, 'listado')
  })

  test('completa la ficha con la especialidad normalizada, rechaza el legajo duplicado y persiste', async ({
    page,
  }) => {
    await page.goto('/dashboard/profesores')
    await page.getByRole('button', { name: 'Editar la ficha de Ficha Incompleta, Prueba' }).click()
    const dialogo = page.getByRole('dialog', { name: 'Ficha de Ficha Incompleta, Prueba' })
    await expect(dialogo.getByLabel('Número de legajo')).toBeFocused()

    // Legajo de otro docente: lo rechaza el índice único de PostgreSQL.
    await dialogo.getByLabel('Número de legajo').fill('leg-e2e-ept58-2')
    await dialogo.getByLabel('Especialidad').fill('Historia')
    await dialogo.getByRole('button', { name: 'Guardar ficha' }).click()
    await expect(dialogo.getByText('Ya existe un legajo con ese número.')).toBeVisible()
    await expect(dialogo.getByLabel('Número de legajo')).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByRole('alert').filter({ hasText: 'Ya existe un legajo con ese número.' })).toHaveCount(1)

    await dialogo.getByLabel('Número de legajo').fill('LEG-E2E-EPT58-1')
    await dialogo.getByLabel('Especialidad').fill('   Ciencias    Sociales  ')
    await dialogo.getByRole('button', { name: 'Guardar ficha' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Ficha de Ficha Incompleta, Prueba guardada.' })).toBeVisible()

    await page.reload()
    const ficha = page
      .getByRole('list', { name: 'Fichas de profesores' })
      .locator('> li')
      .filter({ hasText: 'Ficha Incompleta, Prueba' })
    await expect(ficha).toContainText('Legajo LEG-E2E-EPT58-1 · Ciencias Sociales')
    await expect(ficha).not.toContainText('Ficha incompleta')
    expect(sql(`SELECT especialidad FROM public.profesores WHERE perfil_id = '${ID.incompleta}'`)).toBe(
      'Ciencias Sociales'
    )
  })

  test('rechaza inactivar con una materia activa, informa cuál y no deja cambios', async ({ page }) => {
    await page.goto('/dashboard/profesores')
    await page.getByRole('button', { name: 'Inactivar a Con Materia, Prueba' }).click()
    const dialogo = page.getByRole('dialog', { name: 'Inactivar a Con Materia, Prueba' })
    await dialogo.getByLabel('Motivo (opcional)').fill('No debería guardarse')
    await dialogo.getByRole('button', { name: 'Confirmar inactivación' }).click()

    await expect(dialogo.getByRole('list', { name: 'Relaciones que impiden inactivar' })).toContainText(
      'Materia Materia E2E EPT58 en Curso E2E EPT58 A'
    )
    await expect(page.getByRole('alert').filter({ hasText: 'No se puede inactivar al profesor' })).toHaveCount(1)
    await exigirPantallaSinDetalleTecnico(page, 'inactivación bloqueada por materia')
    await capturar(page, 'inactivacion-bloqueada')
    expect(
      sql(`SELECT estado || '|' || (SELECT count(*) FROM public.profesores_estados_historial
             WHERE profesor_id = '${ID.conMateria}') FROM public.profesores WHERE perfil_id = '${ID.conMateria}'`)
    ).toBe('ACTIVO|0')
  })

  test('rechaza inactivar con un grupo deportivo activo', async ({ page }) => {
    await page.goto('/dashboard/profesores')
    await page.getByRole('button', { name: 'Inactivar a Con Grupo, Prueba' }).click()
    const dialogo = page.getByRole('dialog', { name: 'Inactivar a Con Grupo, Prueba' })
    await dialogo.getByRole('button', { name: 'Confirmar inactivación' }).click()
    await expect(dialogo.getByRole('list', { name: 'Relaciones que impiden inactivar' })).toContainText(
      'Grupo Grupo E2E EPT58 de Fútbol'
    )
    expect(sql(`SELECT estado FROM public.profesores WHERE perfil_id = '${ID.conGrupo}'`)).toBe('ACTIVO')
  })

  test('inactiva con motivo, impide asignarlo, registra el historial y reactiva', async ({ page }) => {
    await page.goto('/dashboard/profesores')
    await page.getByRole('button', { name: 'Inactivar a Ciclo, Prueba' }).click()
    const dialogo = page.getByRole('dialog', { name: 'Inactivar a Ciclo, Prueba' })
    await dialogo.getByLabel('Motivo (opcional)').fill('  Licencia por estudio  ')
    await dialogo.getByRole('button', { name: 'Confirmar inactivación' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Ciclo, Prueba quedó inactivo.' })).toBeVisible()

    // Un docente INACTIVO no recibe asignaciones nuevas: lo rechaza la base y
    // la API de materias lo explica en español.
    const materia = sql(`SELECT id FROM public.actividades WHERE nombre = 'Materia E2E EPT58'`)
    const asignacion = await page.request.post('/api/asignaciones-materias', {
      data: { materia_id: Number(materia), curso_id: ID.cursoAuxiliar, profesor_id: ID.ciclo },
    })
    expect(asignacion.status()).toBe(409)
    const rechazo = await asignacion.json()
    expect(rechazo.error).toContain('El profesor está inactivo')
    exigirMensajeSinDetalleTecnico('asignación a docente inactivo', rechazo.error)

    await page.reload()
    await page.getByRole('button', { name: 'Ver el detalle de Ciclo, Prueba' }).click()
    const historial = page.getByRole('list', { name: 'Cambios de estado de Ciclo, Prueba' })
    await expect(historial).toContainText('Activo → Inactivo')
    await expect(historial).toContainText('Motivo: Licencia por estudio')
    await expect(historial).toContainText(
      `Por ${sql(`SELECT nombre || ' ' || apellido FROM public.perfiles WHERE dni = '99900001'`)}`
    )
    await capturar(page, 'historial')

    await page.getByRole('button', { name: 'Reactivar a Ciclo, Prueba' }).click()
    await page
      .getByRole('dialog', { name: 'Reactivar a Ciclo, Prueba' })
      .getByRole('button', { name: 'Confirmar reactivación' })
      .click()
    await expect(page.getByRole('status').filter({ hasText: 'Ciclo, Prueba quedó activo nuevamente.' })).toBeVisible()
    await expect(historial.locator('> li')).toHaveCount(2)

    await page.reload()
    const ficha = page.getByRole('list', { name: 'Fichas de profesores' }).locator('> li').filter({ hasText: 'Ciclo, Prueba' })
    await expect(ficha.getByText('Activo', { exact: true })).toBeVisible()
    expect(
      sql(`SELECT string_agg(estado_anterior || '>' || estado_nuevo || ':' || coalesce(motivo, '-'), ',' ORDER BY id)
           FROM public.profesores_estados_historial WHERE profesor_id = '${ID.ciclo}'`)
    ).toBe('ACTIVO>INACTIVO:Licencia por estudio,INACTIVO>ACTIVO:-')
  })

  test('rechaza reactivar una ficha incompleta sin cambiar nada', async ({ page }) => {
    await page.goto('/dashboard/profesores')
    await page.getByRole('button', { name: 'Reactivar a Reactivable, Prueba' }).click()
    const dialogo = page.getByRole('dialog', { name: 'Reactivar a Reactivable, Prueba' })
    await dialogo.getByRole('button', { name: 'Confirmar reactivación' }).click()
    await expect(
      dialogo.getByRole('alert').filter({ hasText: 'Para reactivar, completá primero el legajo y la especialidad de la ficha.' })
    ).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Reactivar a Reactivable, Prueba' })).toBeFocused()
    expect(sql(`SELECT estado FROM public.profesores WHERE perfil_id = '${ID.reactivable}'`)).toBe('INACTIVO')
  })

  test('la API autoriza, valida, traduce errores y no ofrece borrado', async ({ page }) => {
    const listado = await page.request.get('/api/profesores')
    expect(listado.status()).toBe(200)
    const cuerpoListado = await listado.text()
    expect(cuerpoListado).toContain(ID.conMateria)
    expect(cuerpoListado).not.toMatch(/"email"|"correo"/u)

    const detalle = await page.request.get(`/api/profesores/${ID.conMateria}`)
    expect(detalle.status()).toBe(200)
    const { detalle: datos } = await detalle.json()
    expect(datos.ficha).toMatchObject({ dni: '95900002', legajo_nro: 'LEG-E2E-EPT58-2' })
    expect(datos.ficha).not.toHaveProperty('email')
    expect(datos.asignaciones).toEqual(
      expect.arrayContaining([expect.objectContaining({ tipo: 'MATERIA', vigente: true, actividad_nombre: 'Materia E2E EPT58' })])
    )

    const casos: [string, unknown, number][] = [
      [ID.conMateria, { accion: 'actualizar_ficha', legajo_nro: 'LEG-E2E-EPT58-2', especialidad: 'X' }, 400],
      [ID.conMateria, { accion: 'actualizar_ficha', legajo_nro: ' LEG', especialidad: 'Lengua' }, 400],
      [ID.conMateria, { accion: 'cambiar_estado', estado: 'SUSPENDIDO' }, 400],
      [ID.conMateria, { accion: 'cambiar_estado', estado: 'INACTIVO', extra: true }, 400],
      [ID.conMateria, { accion: 'borrar' }, 400],
      ['no-es-un-uuid', { accion: 'cambiar_estado', estado: 'INACTIVO' }, 400],
      [ID.inexistente, { accion: 'cambiar_estado', estado: 'INACTIVO' }, 404],
      [ID.conMateria, { accion: 'cambiar_estado', estado: 'INACTIVO' }, 409],
    ]
    for (const [id, cuerpo, estado] of casos) {
      const respuesta = await page.request.patch(`/api/profesores/${id}`, { data: cuerpo })
      expect(respuesta.status(), JSON.stringify(cuerpo)).toBe(estado)
      exigirMensajeSinDetalleTecnico(`PATCH ${JSON.stringify(cuerpo)}`, (await respuesta.json()).error)
    }

    expect((await page.request.delete(`/api/profesores/${ID.conMateria}`)).status()).toBe(405)
    expect((await page.request.post('/api/profesores', { data: {} })).status()).toBe(405)
    expect((await page.request.get('/api/mis-asignaciones')).status()).toBe(403)
    await page.goto('/dashboard/mis-asignaciones')
    await expect(page.getByRole('heading', { name: 'Acceso restringido' })).toBeVisible()
    expect(sql(`SELECT count(*) FROM public.profesores WHERE perfil_id = '${ID.conMateria}'`)).toBe('1')
  })
})

// ================================================================
// DOCENTE
// ================================================================
test.describe('DOCENTE autenticado — profesores', () => {
  test.beforeAll(() => {
    if (test.info().project.name !== 'chromium-docente') return
    limpiar()
    sql(`
      BEGIN;
      INSERT INTO public.perfiles (id, user_id, rol_id, nombre, apellido, dni, legajo_nro)
      SELECT '${ID.ajeno}', NULL, r.id, 'Prueba', 'Docente Ajeno', '95900006', 'LEG-E2E-EPT58-6'
      FROM public.roles r WHERE r.nombre = 'DOCENTE';
      INSERT INTO public.cursos (id, nivel_id, denominacion, division, activo)
      VALUES ('${ID.cursoDocente}', (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 'Curso E2E EPT58 Docente', 'C', TRUE);
      INSERT INTO public.actividades (nombre, tipo, activo) VALUES
        ('Materia E2E EPT58 Vigente', 'CURRICULAR', TRUE),
        ('Materia E2E EPT58 Historica', 'CURRICULAR', TRUE),
        ('Materia E2E EPT58 Ajena', 'CURRICULAR', TRUE);
      INSERT INTO public.materias_cursos (materia_id, curso_id, profesor_id, activo)
      SELECT a.id, '${ID.cursoDocente}', v.profesor, TRUE
      FROM (VALUES
        ('Materia E2E EPT58 Vigente', (SELECT id FROM public.perfiles WHERE dni = '${DNI_DOCENTE_SESION}')),
        ('Materia E2E EPT58 Historica', (SELECT id FROM public.perfiles WHERE dni = '${DNI_DOCENTE_SESION}')),
        ('Materia E2E EPT58 Ajena', '${ID.ajeno}'::uuid)
      ) AS v(nombre, profesor)
      JOIN public.actividades a ON a.nombre = v.nombre AND a.tipo = 'CURRICULAR';
      UPDATE public.materias_cursos SET activo = FALSE
        WHERE curso_id = '${ID.cursoDocente}'
          AND materia_id = (SELECT id FROM public.actividades WHERE nombre = 'Materia E2E EPT58 Historica');
      INSERT INTO public.horarios (dia_semana, hora_inicio, hora_fin) VALUES (1, '08:00', '09:00'), (4, '16:00', '17:00')
        ON CONFLICT (dia_semana, hora_inicio, hora_fin) DO NOTHING;
      INSERT INTO public.materias_cursos_horarios (asignacion_id, horario_id)
      SELECT mc.id, h.id FROM public.materias_cursos mc
      JOIN public.actividades a ON a.id = mc.materia_id AND a.nombre = 'Materia E2E EPT58 Vigente'
      JOIN public.horarios h ON h.dia_semana = 1 AND h.hora_inicio = '08:00' AND h.hora_fin = '09:00'
      WHERE mc.curso_id = '${ID.cursoDocente}';
      INSERT INTO public.grupos_deportivos (id, deporte_id, nivel_id, nombre, cupo, profesor_id)
      VALUES ('${ID.grupoDocente}', 'e0000000-0000-4000-8000-000000000102',
              (SELECT id FROM public.niveles WHERE nombre = 'PRIMARIO'), 'Grupo E2E EPT58 Docente', 10,
              (SELECT id FROM public.perfiles WHERE dni = '${DNI_DOCENTE_SESION}'));
      INSERT INTO public.grupos_deportivos_horarios (grupo_id, horario_id)
      SELECT '${ID.grupoDocente}', h.id FROM public.horarios h
      WHERE h.dia_semana = 4 AND h.hora_inicio = '16:00' AND h.hora_fin = '17:00';
      COMMIT;
    `)
  })

  test.afterAll(() => {
    if (test.info().project.name !== 'chromium-docente') return
    limpiar()
  })

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(ESCRITORIO)
  })

  test('ve solo su ficha, sus materias, cursos, niveles, grupos y horarios', async ({ page }) => {
    await page.goto('/dashboard/mis-asignaciones')
    const menu = await nombreEnMenu(page)
    await expect(menu.getByRole('link', { name: 'Mis asignaciones' })).toBeVisible()
    await expect(menu.getByRole('link', { name: 'Profesores' })).toHaveCount(0)

    // `usuarios-auth` renombra a este docente y no lo restaura: el nombre se lee de la base.
    const nombrePropio = sql(`SELECT apellido || ', ' || nombre FROM public.perfiles WHERE dni = '${DNI_DOCENTE_SESION}'`)
    await expect(page.getByRole('region', { name: 'Mi ficha de profesor' })).toContainText(nombrePropio)
    const vigentes = page.getByRole('list', { name: 'Materias y grupos que tengo a cargo' })
    await expect(vigentes).toContainText('Materia E2E EPT58 Vigente · Curso E2E EPT58 Docente C')
    await expect(vigentes).toContainText('Nivel Primario')
    await expect(vigentes).toContainText('Lunes · 08:00 a 09:00')
    await expect(vigentes).toContainText('Grupo E2E EPT58 Docente · Natación')
    await expect(vigentes).not.toContainText('Historica')
    const historicas = page.getByRole('list', { name: 'Materias y grupos inactivos a mi nombre' })
    await expect(historicas).toContainText('Materia E2E EPT58 Historica')
    await expect(page.getByRole('region', { name: 'Horario semanal' })).toContainText('Jueves')

    const texto = await page.locator('main').innerText()
    expect(texto).not.toContain('Materia E2E EPT58 Ajena')
    expect(texto).not.toContain('Docente Ajeno')
    await exigirPantallaSinDetalleTecnico(page, 'mis asignaciones real')
    await capturar(page, 'mis-asignaciones')

    await page.setViewportSize(MOVIL)
    await page.reload()
    await expect(vigentes).toBeVisible()
    const scroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    )
    expect(scroll).toBe(false)
    await capturar(page, 'mis-asignaciones')
  })

  test('no puede consultar ni modificar fichas, ni la propia por la ruta de la dirección', async ({ page }) => {
    const propio = sql(`SELECT id FROM public.perfiles WHERE dni = '${DNI_DOCENTE_SESION}'`)
    const propias = await page.request.get('/api/mis-asignaciones')
    expect(propias.status()).toBe(200)
    const datos = await propias.json()
    expect(datos.ficha.perfil_id).toBe(propio)
    expect(JSON.stringify(datos)).not.toContain('Ajena')

    for (const url of ['/api/profesores', `/api/profesores/${ID.ajeno}`, `/api/profesores/${propio}`]) {
      const respuesta = await page.request.get(url)
      expect(respuesta.status(), url).toBe(403)
      exigirMensajeSinDetalleTecnico(url, (await respuesta.json()).error)
    }
    const escritura = await page.request.patch(`/api/profesores/${propio}`, {
      data: { accion: 'actualizar_ficha', legajo_nro: 'LEG-HACK', especialidad: 'Hackeo' },
    })
    expect(escritura.status()).toBe(403)

    await page.goto('/dashboard/profesores')
    await expect(page.getByRole('heading', { name: 'Acceso restringido' })).toBeVisible()
    expect(sql(`SELECT coalesce(especialidad, '-') FROM public.profesores WHERE perfil_id = '${propio}'`)).not.toBe('Hackeo')
  })

  test('con la ficha INACTIVO sigue iniciando sesión y consulta lo suyo', async ({ browser }) => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const clave = process.env.SUPABASE_SERVICE_ROLE_KEY!
    const admin = createClient(url, clave, { auth: { autoRefreshToken: false, persistSession: false } })
    const correo = 'docente.inactivo.ept58@ept.local'
    const contrasena = 'prueba-ept-58-inactivo'

    const { data: existentes } = await admin.auth.admin.listUsers()
    for (const usuario of existentes?.users ?? []) {
      if (usuario.email === correo) {
        sql(`BEGIN;
          DELETE FROM public.profesores WHERE perfil_id IN (SELECT id FROM public.perfiles WHERE user_id = '${usuario.id}');
          DELETE FROM public.perfiles WHERE user_id = '${usuario.id}';
          COMMIT;`)
        await admin.auth.admin.deleteUser(usuario.id)
      }
    }
    const { data: alta, error } = await admin.auth.admin.createUser({
      email: correo,
      password: contrasena,
      email_confirm: true,
    })
    if (error || !alta?.user) throw new Error(`No se pudo crear el docente inactivo: ${error?.message}`)
    const usuarioId = alta.user.id

    try {
      sql(`BEGIN;
        INSERT INTO public.perfiles (user_id, rol_id, nombre, apellido, dni, legajo_nro)
        SELECT '${usuarioId}', r.id, 'Prueba', 'Docente Inactivo', '95900007', 'LEG-E2E-EPT58-7'
        FROM public.roles r WHERE r.nombre = 'DOCENTE';
        UPDATE public.profesores SET estado = 'INACTIVO'
          WHERE perfil_id = (SELECT id FROM public.perfiles WHERE user_id = '${usuarioId}');
        COMMIT;`)

      // Contexto nuevo sin la sesión del proyecto.
      const contexto = await browser.newContext({ storageState: undefined, baseURL: 'http://localhost:3000' })
      const page = await contexto.newPage()
      await page.setViewportSize(ESCRITORIO)
      await page.goto('/login')
      await page.getByLabel('Email institucional').fill(correo)
      await page.getByLabel('Contraseña').fill(contrasena)
      await page.getByRole('button', { name: /ingresar|iniciar/i }).click()
      await page.waitForURL(/\/dashboard/, { timeout: 20000 })

      await page.goto('/dashboard/mis-asignaciones')
      await expect(page.getByText('Tu ficha está inactiva.')).toBeVisible()
      const menu = page.getByRole('navigation', { name: 'Menú del dashboard' })
      await expect(menu.getByRole('link', { name: 'Mis asignaciones' })).toBeVisible()
      await expect(menu.getByRole('link', { name: 'Profesores' })).toHaveCount(0)
      const propias = await page.request.get('/api/mis-asignaciones')
      expect(propias.status()).toBe(200)
      expect((await propias.json()).ficha.estado).toBe('INACTIVO')
      expect((await page.request.get('/api/profesores')).status()).toBe(403)
      await expect(page.getByRole('region', { name: 'Mi ficha de profesor' })).toContainText('Inactivo')
      await capturar(page, 'docente-inactivo')
      await contexto.close()
    } finally {
      sql(`BEGIN;
        DELETE FROM public.profesores WHERE perfil_id IN (SELECT id FROM public.perfiles WHERE user_id = '${usuarioId}');
        DELETE FROM public.perfiles WHERE user_id = '${usuarioId}';
        COMMIT;`)
      await admin.auth.admin.deleteUser(usuarioId)
    }
  })
})

// ================================================================
// Otros actores: ni menú, ni pantalla, ni API
// ================================================================
for (const actor of ['ESTUDIANTE', 'PADRE', 'PERSONAL', 'SIN PERFIL']) {
  test.describe(`${actor} autenticado — profesores`, () => {
    test('no ve los accesos, recibe acceso restringido y 403 en la API', async ({ page }) => {
      await page.setViewportSize(ESCRITORIO)
      await page.goto('/dashboard')
      const menu = page.getByRole('navigation', { name: 'Menú del dashboard' })
      await expect(menu.getByRole('link', { name: 'Profesores' })).toHaveCount(0)
      await expect(menu.getByRole('link', { name: 'Mis asignaciones' })).toHaveCount(0)

      for (const ruta of ['/dashboard/profesores', '/dashboard/mis-asignaciones']) {
        await page.goto(ruta)
        await expect(page.getByRole('heading', { name: 'Acceso restringido' })).toBeVisible()
      }
      if (actor === 'ESTUDIANTE') await capturar(page, 'acceso-restringido')

      for (const [metodo, url] of [
        ['GET', '/api/profesores'],
        ['GET', `/api/profesores/${ID.conMateria}`],
        ['PATCH', `/api/profesores/${ID.conMateria}`],
        ['GET', '/api/mis-asignaciones'],
      ] as const) {
        const respuesta =
          metodo === 'GET'
            ? await page.request.get(url)
            : await page.request.patch(url, { data: { accion: 'cambiar_estado', estado: 'INACTIVO' } })
        expect(respuesta.status(), `${metodo} ${url}`).toBe(403)
        exigirMensajeSinDetalleTecnico(`${metodo} ${url}`, (await respuesta.json()).error)
      }
    })
  })
}
