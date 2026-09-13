import { expect, test } from '@playwright/test'
import { exigirContraste, medirContraste } from './_contraste'

/**
 * Contraste WCAG 2.1 AA sobre el banco visual del legajo academico.
 *
 * Corre en los tres perfiles —escritorio, Pixel 5 e iPhone 13— porque el
 * listado cambia de forma: en escritorio es una tabla y en movil son tarjetas,
 * y el DNI y el legajo de la tarjeta son justamente uno de los textos que la
 * revision encontro por debajo del minimo.
 */

const BANCO = '/pruebas-ui/alumnos'

/**
 * Textos esenciales del listado que la auditoría tiene que haber medido.
 *
 * Sin esta exigencia, una pantalla que dejara de renderizar su contenido
 * pasaría la auditoría por no tener nada que medir. La línea de DNI y legajo
 * de la tarjeta móvil es justamente uno de los textos que estaban por debajo
 * del mínimo, así que se nombra explícitamente.
 */
const ESENCIALES_LISTADO = [
  'h1',
  '[aria-label="Tabla de alumnos"] td, [aria-label="Alumnos por apellido"] li p',
]

/** Textos esenciales del formulario de alta. */
const ESENCIALES_FORMULARIO = [
  'label[for="nuevo-alumno-dni"]',
  'label[for="nuevo-alumno-estado"]',
  '#nuevo-alumno-dni-ayuda',
]

test.describe('Contraste WCAG AA del legajo académico', () => {
  test('el listado con estudiantes activos e inactivos', async ({ page }) => {
    await page.goto(BANCO)
    await expect(page.getByRole('heading', { name: 'Alumnos' })).toBeVisible()
    await exigirContraste(page, 'listado', { esenciales: ESENCIALES_LISTADO })
  })

  test('el formulario de alta, en sus dos estados', async ({ page }) => {
    await page.goto(BANCO)
    await page.getByRole('button', { name: 'Nuevo alumno' }).click()
    await expect(page.getByRole('heading', { name: 'Nuevo legajo académico' })).toBeVisible()

    await page.locator('#nuevo-alumno-estado').selectOption('ACTIVO')
    await exigirContraste(page, 'formulario en estado ACTIVO', {
      esenciales: ESENCIALES_FORMULARIO,
    })

    await page.locator('#nuevo-alumno-estado').selectOption('INACTIVO')
    await exigirContraste(page, 'formulario en estado INACTIVO', {
      esenciales: ESENCIALES_FORMULARIO,
    })
  })

  test('el formulario con errores de validación visibles', async ({ page }) => {
    await page.goto(BANCO)
    await page.getByRole('button', { name: 'Nuevo alumno' }).click()
    await page.locator('#nuevo-alumno-dni').fill('12')
    await page.getByRole('button', { name: 'Crear legajo' }).click()
    await expect(page.locator('#nuevo-alumno-dni-error')).toBeVisible()
    await exigirContraste(page, 'formulario con errores', {
      esenciales: ['#nuevo-alumno-dni-error'],
    })
  })

  test('el diálogo de cambio de curso', async ({ page }) => {
    await page.goto(BANCO)
    await page
      .getByRole('button', { name: 'Cambiar el curso del alumno Arrieta, Camila' })
      .click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await exigirContraste(page, 'diálogo de cambio de curso', {
      esenciales: ['[role="dialog"] h2', 'label[for="cambiar-curso-destino"]'],
    })
  })

  test('el listado vacío y el listado sin cursos activos', async ({ page }) => {
    await page.goto(`${BANCO}?vacio=1`)
    await expect(page.getByText('No hay alumnos registrados')).toBeVisible()
    // Esta pantalla tiene poco texto a propósito, así que el mínimo general no
    // aplica. A cambio se nombra exactamente lo que tiene que haberse medido.
    await exigirContraste(page, 'listado vacío', {
      minimoMedidos: 5,
      esenciales: ['h1', 'p.text-neutral-400'],
    })

    await page.goto(`${BANCO}?sin-cursos=1`)
    await page.getByRole('button', { name: 'Nuevo alumno' }).click()
    await exigirContraste(page, 'sin cursos activos')
  })

  test('los mensajes de error y de éxito', async ({ page }) => {
    await page.goto(`${BANCO}?estado=error`)
    await expect(
      page.getByText('No pudimos guardar el cambio. Revisá los datos y volvé a intentarlo.')
    ).toBeVisible()
    await exigirContraste(page, 'mensaje de error')

    await page.goto(`${BANCO}?estado=exito`)
    await expect(page.getByText('Legajo académico actualizado correctamente.')).toBeVisible()
    await exigirContraste(page, 'mensaje de éxito')
  })

  test('el estado de carga', async ({ page }) => {
    await page.goto(`${BANCO}?estado=carga`)
    // El esqueleto de carga es casi todo forma. Su único texto es el aviso
    // para lectores de pantalla, y es el que tiene que medirse: `sr-only` lo
    // saca de la vista sin ocultarlo, así que sigue siendo texto renderizado.
    await exigirContraste(page, 'estado de carga', {
      minimoMedidos: 1,
      esenciales: ['p.sr-only'],
    })
  })
})

test.describe('La auditoría de contraste falla cerrada', () => {
  /**
   * Una auditoría que omite lo que no entiende puede terminar con cero
   * hallazgos sin haber medido nada, y ese silencio se lee como éxito. Estas
   * tres pruebas comprueban que no pasa: el instrumento tiene que fallar
   * cuando no puede medir, no callarse.
   */

  test('un color de texto que no se puede interpretar produce fallo', async ({ page }) => {
    await page.goto(BANCO)
    await expect(page.getByRole('heading', { name: 'Alumnos' })).toBeVisible()

    // El navegador normaliza cualquier color inválido escrito en CSS, así que
    // no alcanza con inyectarlo por estilo. Lo que se simula es la entrada real
    // del lector: la cadena que devuelve `getComputedStyle`. Es el contrato que
    // está a prueba —«si no se puede interpretar, hay que fallar»— y este es el
    // nivel exacto donde comprobarlo.
    await page.evaluate(() => {
      const titulo = document.querySelector('h1')
      const original = window.getComputedStyle.bind(window)
      // Se devuelve una copia plana con las propiedades que el lector consulta,
      // en vez de un proxy: WebKit no admite envolver `CSSStyleDeclaration`.
      window.getComputedStyle = ((elemento: Element, pseudo?: string | null) => {
        const estilos = original(elemento, pseudo ?? undefined)
        if (elemento !== titulo) return estilos
        return {
          color: 'un-color-que-no-existe',
          backgroundColor: estilos.backgroundColor,
          backgroundImage: estilos.backgroundImage,
          fontSize: estilos.fontSize,
          fontWeight: estilos.fontWeight,
          visibility: estilos.visibility,
          display: estilos.display,
          opacity: estilos.opacity,
        } as unknown as CSSStyleDeclaration
      }) as typeof window.getComputedStyle
    })

    // El elemento sigue teniendo texto visible, así que no se puede omitir.
    const medicion = await medirContraste(page, [])
    expect(
      medicion.ilegibles.length,
      'un color no interpretable tiene que quedar registrado, no omitirse'
    ).toBeGreaterThan(0)

    await expect(
      exigirContraste(page, 'color inyectado sin resolver')
    ).rejects.toThrow(/no se pudo interpretar/)
  })

  test('exigir un texto esencial ausente produce fallo', async ({ page }) => {
    await page.goto(BANCO)
    await expect(page.getByRole('heading', { name: 'Alumnos' })).toBeVisible()

    await expect(
      exigirContraste(page, 'esencial inexistente', {
        esenciales: ['#no-existe-este-texto-esencial'],
      })
    ).rejects.toThrow(/no se midieron/)
  })

  test('una pantalla sin texto medible produce fallo, no éxito silencioso', async ({
    page,
  }) => {
    await page.goto(BANCO)
    await expect(page.getByRole('heading', { name: 'Alumnos' })).toBeVisible()

    // Se vacía el cuerpo: cero hallazgos, pero también cero mediciones.
    await page.evaluate(() => {
      document.body.replaceChildren()
    })

    await expect(
      exigirContraste(page, 'pantalla vacía')
    ).rejects.toThrow(/sólo se midieron/)
  })
})
