import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

test.skip(process.env.EPT_SUPABASE_LOCAL !== '1', 'Requiere sesiones y base local descartable.')

test.describe('DIRECTOR autenticado — horarios académicos', () => {
  test('configura varias franjas, conserva historial y rechaza duplicados desde el navegador', async ({ page }) => {
    const nombre = `Materia EPT57 ${Date.now()}`
    const materia = await page.request.post('/api/materias', { data: { nombre } })
    expect(materia.status()).toBe(201)
    const materiaId = (await materia.json()).materia.id as number

    await page.goto('/dashboard/materias')
    await page.getByRole('button', { name: `Asignar la materia ${nombre} a un curso` }).click()
    const cursoId = await page.locator('#asignar-curso option').filter({ hasText: 'Sala de 5 A' }).first().getAttribute('value')
    expect(cursoId).toBeTruthy()
    await page.keyboard.press('Escape')
    const asignacion = await page.request.post('/api/asignaciones-materias', {
      data: { materia_id: materiaId, curso_id: cursoId },
    })
    expect(asignacion.status()).toBe(201)

    await page.goto('/dashboard/horarios-academicos')
    await expect(page.getByRole('heading', { name: 'Horarios académicos' })).toBeVisible()
    const opcion = await page.locator('#asignacion option').filter({ hasText: nombre }).first().getAttribute('value')
    expect(opcion).toBeTruthy()
    await page.getByLabel('Materia y curso').selectOption(opcion!)
    await page.getByLabel('Día').selectOption('7')
    await page.getByLabel('Hora de inicio').fill('21:00')
    await page.getByLabel('Hora de fin').fill('22:00')
    await page.getByRole('button', { name: 'Agregar franja' }).click()
    await expect(page.getByRole('status')).toContainText('Franja agregada')
    await expect(page.getByText('domingo de 21:00 a 22:00')).toBeVisible()

    const asignacionId = (await asignacion.json()).asignacion.id as string
    const repetida = await page.request.post('/api/horarios-academicos', {
      data: { asignacion_id: asignacionId, dia_semana: 7, hora_inicio: '21:00', hora_fin: '22:00' },
    })
    expect(repetida.status()).toBe(409)
    expect((await repetida.text()).toLowerCase()).not.toContain('sqlstate')

    await page.getByRole('button', { name: 'Desactivar' }).click()
    await expect(page.getByRole('status')).toContainText('Franja desactivada')
    await expect(page.getByText('Inactiva · Conservada en el historial')).toBeVisible()
    await page.getByRole('button', { name: 'Reactivar' }).click()
    await expect(page.getByRole('status')).toContainText('Franja reactivada')
    await expect(page.getByRole('button', { name: 'Desactivar' })).toBeVisible()
    await expect(page.getByText('1 activas')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Historial de cambios' })).toBeVisible()

    if (process.env.EPT_CAPTURAS === '1') {
      const carpeta = path.join('docs', 'evidence', 'EPT-57')
      fs.mkdirSync(carpeta, { recursive: true })
      await page.evaluate(() => scrollTo(0, 0))
      await page.screenshot({ path: path.join(carpeta, 'real-directora-escritorio.png'), fullPage: true })
      await page.setViewportSize({ width: 390, height: 844 })
      await page.evaluate(() => scrollTo(0, 0))
      await page.screenshot({ path: path.join(carpeta, 'real-directora-movil.png'), fullPage: true })
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false)
    }
  })

  test('reasigna una franja histórica desde una asignación inactiva a un destino activo', async ({ page }) => {
    const sello = Date.now()
    const origenMateria = await page.request.post('/api/materias', { data: { nombre: `Origen EPT57 ${sello}` } })
    const destinoMateria = await page.request.post('/api/materias', { data: { nombre: `Destino EPT57 ${sello}` } })
    expect(origenMateria.status()).toBe(201)
    expect(destinoMateria.status()).toBe(201)
    await page.goto('/dashboard/materias')
    await page.getByRole('button', { name: `Asignar la materia Origen EPT57 ${sello} a un curso` }).click()
    const cursoId = await page.locator('#asignar-curso option').filter({ hasText: 'Sala de 5 A' }).first().getAttribute('value')
    expect(cursoId).toBeTruthy()
    await page.keyboard.press('Escape')
    const origen = await page.request.post('/api/asignaciones-materias', {
      data: { materia_id: (await origenMateria.json()).materia.id, curso_id: cursoId },
    })
    const destino = await page.request.post('/api/asignaciones-materias', {
      data: { materia_id: (await destinoMateria.json()).materia.id, curso_id: cursoId },
    })
    expect(origen.status()).toBe(201)
    expect(destino.status()).toBe(201)
    const origenId = (await origen.json()).asignacion.id as string
    const destinoId = (await destino.json()).asignacion.id as string
    const creada = await page.request.post('/api/horarios-academicos', {
      data: { asignacion_id: origenId, dia_semana: 7, hora_inicio: '22:00', hora_fin: '23:00' },
    })
    expect(creada.status(), await creada.text()).toBe(201)
    const franjaId = (await creada.json()).franja.id as string
    expect((await page.request.patch(`/api/horarios-academicos/${franjaId}`, {
      data: { activo: false },
    })).status()).toBe(200)
    expect((await page.request.patch(`/api/asignaciones-materias/${origenId}`, {
      data: { accion: 'cambiar_estado', activo: false },
    })).status()).toBe(200)

    await page.goto('/dashboard/horarios-academicos')
    await page.getByLabel('Materia y curso').selectOption(origenId)
    await expect(page.getByText('Inactiva · Conservada en el historial')).toBeVisible()
    await page.getByRole('button', { name: 'Editar o reasignar' }).click()
    await page.getByLabel('Asignación de destino').selectOption(destinoId)
    await expect(page.getByRole('button', { name: 'Guardar cambios' })).toBeEnabled()
    const respuesta = page.waitForResponse((item) => item.url().endsWith('/api/horarios-academicos') && item.request().method() === 'POST')
    await page.getByRole('button', { name: 'Guardar cambios' }).click()
    const guardada = await respuesta
    expect(guardada.status()).toBe(200)
    expect((await guardada.json()).franja.asignacion_id).toBe(destinoId)
    await expect(page.getByRole('status')).toContainText('Franja actualizada')
    await page.getByLabel('Materia y curso').selectOption(destinoId)
    await expect(page.getByText('domingo de 22:00 a 23:00')).toBeVisible()
    await expect(page.getByText('Activa', { exact: true })).toBeVisible()
    await expect(page.getByText('Reasignada')).toBeVisible()
  })
})

test.describe('DOCENTE autenticado — horarios académicos', () => {
  test('no consulta la relación administrativa ni puede configurar franjas', async ({ page }) => {
    await page.goto('/dashboard/horarios-academicos')
    await expect(page.getByRole('heading', { name: 'Horarios académicos' })).toHaveCount(0)
    const respuesta = await page.request.post('/api/horarios-academicos', {
      data: { asignacion_id: '00000000-0000-4000-8000-000000000000', dia_semana: 1,
        hora_inicio: '10:00', hora_fin: '11:00' },
    })
    expect(respuesta.status()).toBe(403)
  })
})
