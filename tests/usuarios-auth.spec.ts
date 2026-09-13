import { execFileSync } from 'node:child_process'
import { expect, test, type APIRequestContext } from '@playwright/test'

/**
 * Alta de cuentas de acceso: `POST /api/usuarios`.
 *
 * La revisión encontró acá el defecto más grave del candidato anterior. La
 * ruta escribía en `padres_hijos`, una tabla que no existe en el esquema
 * versionado; la escritura fallaba, el borrado compensatorio del perfil chocaba
 * con la clave foránea `ON DELETE RESTRICT` de `alumnos`, ese error se
 * descartaba en silencio y sólo se borraba la cuenta de Auth. Resultado: un
 * perfil y un legajo huérfanos que reservaban para siempre un DNI y un número
 * de legajo, sin cuenta que los reclamara, y un director convencido de haber
 * registrado un vínculo que nunca existió.
 *
 * Estas pruebas atraviesan la ruta real, Auth real y PostgreSQL real. Nada está
 * simulado: cuando una afirmación dice que no quedó una fila, es porque se
 * consultó la base.
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

const CONTENEDOR =
  process.env.EPT_SUPABASE_DB_CONTAINER ?? 'supabase_db_educar-para-transformar'

const MENSAJE_VINCULO =
  'Los vínculos entre padres o tutores e hijos todavía no están disponibles.'

/**
 * Marca que fuerza el fallo de la escritura del perfil.
 *
 * Para demostrar la compensación hace falta que el paso 6 falle después de que
 * el paso 5 ya creó la cuenta de Auth. Simular ese fallo en el código de la
 * aplicación probaría el simulacro, no la ruta; por eso se inyecta en la
 * frontera real, con un disparador en PostgreSQL que rechaza un apellido
 * concreto. La ruta no sabe nada de esto: recibe un error de inserción como
 * recibiría cualquier otro.
 */
const APELLIDO_QUE_FALLA = 'FalloForzadoDePrueba'

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

test.beforeAll(() => {
  if (process.env.EPT_SUPABASE_LOCAL !== '1') return
  limpiar()
})

test.afterAll(() => {
  if (process.env.EPT_SUPABASE_LOCAL !== '1') return
  limpiar()
})

type Alta = {
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

function crear(peticion: APIRequestContext, datos: Partial<Alta> & { dni: string }) {
  return peticion.post('/api/usuarios', {
    data: {
      email: `alta.prueba.${datos.dni}@${DOMINIO}`,
      password: 'prueba-ept-9-alta-segura',
      nombre: 'Alta',
      apellido: 'DePrueba',
      rol_id: rolId('ESTUDIANTE'),
      ...datos,
    },
  })
}

test.describe('DIRECTOR autenticado: el alta de cuentas no deja estados a medias', () => {
  test('crea un estudiante sin tutor y persiste perfil, legajo académico y cuenta', async ({
    request,
  }) => {
    const dni = `${PREFIJO_DNI}100001`

    const respuesta = await crear(request, {
      dni,
      nombre: 'Lucía',
      apellido: 'SinTutor',
      legajo_nro: 'LEG-ALTA-0001',
    })

    expect(respuesta.status(), await respuesta.text()).toBe(200)

    // Las tres piezas quedaron, y quedaron juntas.
    expect(contar(`FROM public.perfiles WHERE dni = '${dni}'`)).toBe(1)
    expect(
      contar(
        `FROM public.alumnos a JOIN public.perfiles p ON p.id = a.perfil_id
         WHERE p.dni = '${dni}'`
      )
    ).toBe(1)
    expect(
      contar(`FROM auth.users WHERE email = 'alta.prueba.${dni}@${DOMINIO}'`)
    ).toBe(1)

    // Un estudiante recién dado de alta queda INACTIVO y sin matrícula: el alta
    // de la cuenta no inventa una situación académica.
    expect(
      sql(
        `SELECT a.estado FROM public.alumnos a
         JOIN public.perfiles p ON p.id = a.perfil_id WHERE p.dni = '${dni}';`
      )
    ).toBe('INACTIVO')
  })

  test('el tutor no es obligatorio: el alta funciona sin mencionarlo', async ({
    request,
  }) => {
    const dni = `${PREFIJO_DNI}100002`

    // El cuerpo no lleva `tutor_id` ni `hijos_ids` en absoluto.
    const respuesta = await crear(request, { dni, apellido: 'SinMencion' })

    expect(respuesta.status(), await respuesta.text()).toBe(200)
    expect(contar(`FROM public.perfiles WHERE dni = '${dni}'`)).toBe(1)
  })

  test('pedir un vínculo parental se rechaza con un mensaje claro y no escribe nada', async ({
    request,
  }) => {
    const dni = `${PREFIJO_DNI}100003`
    const tutor = sql(
      `SELECT id FROM public.perfiles WHERE dni = '${PREFIJO_DNI}100001';`
    )

    const respuesta = await crear(request, { dni, tutor_id: tutor })

    // Se rechaza en lugar de ignorarse: un director que eligió un tutor tiene
    // que enterarse de que ese vínculo no se guardó.
    expect(respuesta.status()).toBe(400)
    expect((await respuesta.json()).error).toContain(MENSAJE_VINCULO)

    // Y no quedó ni cuenta ni perfil.
    expect(contar(`FROM public.perfiles WHERE dni = '${dni}'`)).toBe(0)
    expect(
      contar(`FROM auth.users WHERE email = 'alta.prueba.${dni}@${DOMINIO}'`)
    ).toBe(0)
  })

  test('ni el alta ni el esquema tocan padres_hijos', async ({ request }) => {
    const dni = `${PREFIJO_DNI}100004`

    // La tabla no existe. El alta tiene que funcionar igual: EPT-9 no depende
    // de ella ni la consulta.
    expect(
      contar(
        `FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'padres_hijos'`
      )
    ).toBe(0)

    const respuesta = await crear(request, { dni, apellido: 'SinPadresHijos' })
    expect(respuesta.status(), await respuesta.text()).toBe(200)

    // Y sigue sin existir después: nada la creó por la puerta de atrás.
    expect(
      contar(
        `FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'padres_hijos'`
      )
    ).toBe(0)
  })

  test('una petición inválida no crea cuenta, ni perfil, ni legajo académico', async ({
    request,
  }) => {
    const dni = `${PREFIJO_DNI}100005`

    // DNI de tres dígitos: el contrato lo rechaza antes de tocar Auth.
    const respuesta = await request.post('/api/usuarios', {
      data: {
        email: `alta.prueba.${dni}@${DOMINIO}`,
        password: 'prueba-ept-9-alta-segura',
        nombre: 'Alta',
        apellido: 'Invalida',
        dni: '123',
        rol_id: rolId('ESTUDIANTE'),
      },
    })

    expect(respuesta.status()).toBe(400)
    expect(
      contar(`FROM auth.users WHERE email = 'alta.prueba.${dni}@${DOMINIO}'`)
    ).toBe(0)
    expect(contar(`FROM public.perfiles WHERE dni = '123'`)).toBe(0)
    expect(contar(`FROM public.perfiles WHERE dni LIKE '${PREFIJO_DNI}10000_'`)).toBe(3)
  })

  test('si la persistencia falla después de crear la cuenta, la cuenta se borra', async ({
    request,
  }) => {
    const dni = `${PREFIJO_DNI}100006`
    const email = `alta.prueba.${dni}@${DOMINIO}`
    const legajo = 'LEG-ALTA-0006'

    instalarFalloDePersistencia()
    try {
      const respuesta = await crear(request, {
        dni,
        apellido: APELLIDO_QUE_FALLA,
        legajo_nro: legajo,
      })

      // El alta no prospera, y lo dice.
      expect(respuesta.status()).toBe(400)

      // La cuenta de Auth no sobrevive al fallo.
      expect(contar(`FROM auth.users WHERE email = '${email}'`)).toBe(0)

      // Y no queda nada reservando la identidad: ni DNI, ni legajo, ni un
      // perfil huérfano, ni una fila de `alumnos` colgada. Este es exactamente
      // el estado que el candidato anterior dejaba atrás.
      expect(contar(`FROM public.perfiles WHERE dni = '${dni}'`)).toBe(0)
      expect(contar(`FROM public.perfiles WHERE legajo_nro = '${legajo}'`)).toBe(0)
      expect(
        contar(
          `FROM public.alumnos a
           LEFT JOIN public.perfiles p ON p.id = a.perfil_id
           WHERE p.id IS NULL`
        )
      ).toBe(0)
    } finally {
      retirarFalloDePersistencia()
    }

    // Reintentar con exactamente los mismos datos funciona: el fallo anterior
    // no dejó nada bloqueado.
    const reintento = await crear(request, { dni, apellido: 'Reintento', legajo_nro: legajo })
    expect(reintento.status(), await reintento.text()).toBe(200)
    expect(contar(`FROM public.perfiles WHERE dni = '${dni}'`)).toBe(1)
    expect(contar(`FROM public.perfiles WHERE legajo_nro = '${legajo}'`)).toBe(1)
    expect(contar(`FROM auth.users WHERE email = '${email}'`)).toBe(1)
  })

  test('un DNI ya usado se rechaza antes de crear la cuenta de Auth', async ({
    request,
  }) => {
    const dniOcupado = `${PREFIJO_DNI}100001`
    const email = `alta.prueba.${PREFIJO_DNI}100007@${DOMINIO}`

    const respuesta = await request.post('/api/usuarios', {
      data: {
        email,
        password: 'prueba-ept-9-alta-segura',
        nombre: 'Alta',
        apellido: 'DniRepetido',
        dni: dniOcupado,
        rol_id: rolId('ESTUDIANTE'),
      },
    })

    expect(respuesta.status()).toBe(409)
    expect((await respuesta.json()).error).toContain('DNI')

    // La comprobación previa evita el ciclo de crear y borrar una cuenta.
    expect(contar(`FROM auth.users WHERE email = '${email}'`)).toBe(0)
  })

  test('un legajo con coma es un legajo válido y no rompe la comprobación previa', async ({
    request,
  }) => {
    const dni = `${PREFIJO_DNI}100008`

    // La versión anterior armaba el filtro concatenando texto, así que una coma
    // rompía la expresión y el alta terminaba en un 500 que culpaba al sistema
    // de un dato correcto.
    const respuesta = await crear(request, {
      dni,
      apellido: 'ConComa',
      legajo_nro: 'LEG,2027,008',
    })

    expect(respuesta.status(), await respuesta.text()).toBe(200)
    expect(contar(`FROM public.perfiles WHERE legajo_nro = 'LEG,2027,008'`)).toBe(1)
  })

  test('los roles ajenos a esta historia conservan su comportamiento', async ({
    request,
  }) => {
    for (const [rol, sufijo] of [
      ['DOCENTE', '100010'],
      ['PADRE', '100011'],
      ['PERSONAL', '100012'],
    ] as const) {
      const dni = `${PREFIJO_DNI}${sufijo}`
      const respuesta = await crear(request, {
        dni,
        apellido: `Rol${rol}`,
        rol_id: rolId(rol),
      })

      expect(respuesta.status(), `${rol}: ${await respuesta.text()}`).toBe(200)
      expect(contar(`FROM public.perfiles WHERE dni = '${dni}'`)).toBe(1)

      // Sólo un ESTUDIANTE tiene legajo académico. Ningún otro rol lo gana por
      // el hecho de haberse dado de alta desde la misma ruta.
      expect(
        contar(
          `FROM public.alumnos a JOIN public.perfiles p ON p.id = a.perfil_id
           WHERE p.dni = '${dni}'`
        )
      ).toBe(0)
    }
  })
})

// ================================================================
// El panel real, no solo la ruta
// ================================================================
test.describe('DIRECTOR autenticado: el panel de usuarios carga y da de alta', () => {
  /**
   * La revisión encontró que la ruta funcionaba y la pantalla no.
   *
   * `obtenerRelacionesFamiliares` consulta `padres_hijos`, que no existe en el
   * esquema versionado. PostgREST responde 404 con `PGRST205`, no con el
   * `42P01` de PostgreSQL, así que el servicio no degradaba: lanzaba. Y como la
   * página cargaba roles, perfiles y vínculos con un solo `Promise.all`, ese
   * error tumbaba las tres cosas. Sin roles, el desplegable quedaba vacío y la
   * directora no podía crear a nadie.
   *
   * Estas pruebas manejan la pantalla, no la API.
   */

  test('la tabla de vínculos no existe en el esquema reproducible', () => {
    expect(
      contar(
        `FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'padres_hijos'`
      )
    ).toBe(0)
  })

  test('carga roles y perfiles pese a la ausencia de padres_hijos', async ({ page }) => {
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

    // Los roles llegaron: el desplegable tiene opciones reales.
    const rol = page.getByLabel(/^Rol/)
    await expect(rol).toBeVisible()
    const opciones = await rol.locator('option').allTextContents()
    expect(opciones).toContain('ESTUDIANTE')
    expect(opciones).toContain('DOCENTE')
    expect(opciones).toContain('DIRECTOR')

    // Los perfiles también: el listado muestra las identidades sembradas.
    const listado = page.getByLabel('Usuarios registrados')
    await expect(listado).toBeVisible()
    await expect(listado).toContainText('Directora')

    // Y no hay estado de error.
    await expect(
      page.getByRole('alert').filter({ hasText: 'No pudimos cargar la gestión de usuarios' })
    ).toHaveCount(0)

    // Sobre `padres_hijos` solo hubo lecturas, y ninguna prosperó.
    expect(peticiones.length).toBeGreaterThan(0)
    for (const peticion of peticiones) {
      expect(peticion.metodo, `no debe escribir en padres_hijos: ${peticion.url}`).toBe('GET')
      expect(peticion.estado, 'la lectura no debe prosperar').toBe(404)
    }
  })

  test('crea un ESTUDIANTE sin tutor desde el formulario y persiste tras recargar', async ({
    page,
  }) => {
    const dni = `${PREFIJO_DNI}200001`
    const email = `alta.prueba.${dni}@${DOMINIO}`

    await page.goto('/dashboard/usuarios')
    await expect(page.getByRole('heading', { name: 'Nuevo usuario' })).toBeVisible()

    await page.getByLabel(/^Nombre/).fill('Valentina')
    await page.getByLabel(/^Apellido/).fill('DesdeElPanel')
    await page.getByLabel(/^DNI/).fill(dni)
    await page.getByLabel(/^Rol/).selectOption({ label: 'ESTUDIANTE' })
    await page.getByLabel(/^Email/).fill(email)
    await page.getByLabel(/^Contraseña/).fill('prueba-ept-9-panel-seguro')
    await page.getByLabel(/^Legajo/).fill('LEG-PANEL-0001')

    // El formulario no pide tutor: avisa que el vínculo no está disponible.
    await expect(page.getByText(/vínculos entre padres o tutores/i)).toBeVisible()

    await page.getByRole('button', { name: 'Crear usuario' }).click()

    // La fila aparece en el listado sin recargar.
    const listado = page.getByLabel('Usuarios registrados')
    await expect(listado).toContainText('DesdeElPanel', { timeout: 15_000 })

    // Y persiste: se recarga la página y sigue ahí.
    await page.reload()
    await expect(page.getByLabel('Usuarios registrados')).toContainText('DesdeElPanel', {
      timeout: 15_000,
    })

    // La base confirma las tres piezas, y ninguna quedó huérfana.
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
        `FROM public.alumnos a LEFT JOIN public.perfiles p ON p.id = a.perfil_id
         WHERE p.id IS NULL`
      )
    ).toBe(0)
    expect(
      contar(
        `FROM auth.users u LEFT JOIN public.perfiles p ON p.user_id = u.id
         WHERE u.email LIKE 'alta.prueba.%@${DOMINIO}' AND p.id IS NULL`
      )
    ).toBe(0)
  })

  test('un PGRST205 de otra tabla no se tolera: muestra el estado de error', async ({
    page,
  }) => {
    // Mismo código, otra tabla. Tolerarlo en general convertiría cualquier
    // tabla ausente en una lista vacía silenciosa.
    await page.route('**/rest/v1/roles*', (ruta) =>
      ruta.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'PGRST205',
          details: null,
          hint: null,
          message: "Could not find the table 'public.roles' in the schema cache",
        }),
      })
    )

    await page.goto('/dashboard/usuarios')

    const aviso = page.getByRole('alert').filter({
      hasText: 'No pudimos cargar la gestión de usuarios',
    })
    await expect(aviso).toBeVisible()
    await expect(aviso).toContainText('roles')
    await expect(aviso.getByRole('button', { name: 'Reintentar' })).toBeVisible()
  })

  test('un error de red o de servidor tampoco se oculta', async ({ page }) => {
    // Se interviene `roles`, que solo pide esta pagina. Intervenir `perfiles`
    // no serviria: el contexto de sesion lee esa misma tabla, asi que el
    // layout redirige a login antes de que la pagina llegue a renderizar, y la
    // prueba no estaria midiendo lo que dice medir.
    await page.route('**/rest/v1/roles*', (ruta) =>
      ruta.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          code: '57014',
          details: null,
          hint: null,
          message: 'canceling statement due to statement timeout',
        }),
      })
    )

    await page.goto('/dashboard/usuarios')

    await expect(
      page.getByRole('alert').filter({ hasText: 'No pudimos cargar la gestión de usuarios' })
    ).toBeVisible()
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
    const aviso = page.getByRole('alert').filter({
      hasText: 'No pudimos cargar la gestión de usuarios',
    })
    await expect(aviso).toBeVisible()

    falla = false
    await aviso.getByRole('button', { name: 'Reintentar' }).click()

    await expect(aviso).toBeHidden()
    await expect(page.getByLabel(/^Rol/).locator('option')).not.toHaveCount(1)
  })
})
