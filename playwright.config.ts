import { defineConfig, devices, type Project } from '@playwright/test'
import { loadEnvConfig } from '@next/env'

// Next.js lee `.env.local` para el servidor de desarrollo, pero el proceso de
// Playwright no. Se cargan acá con el mismo mecanismo que usa Next, para que
// tanto la configuración de abajo como `tests/auth.setup.ts` vean las mismas
// variables. Sin esto, el setup autenticado no encuentra la base local.
loadEnvConfig(process.cwd())

// Los bancos de pruebas de interfaz (`/pruebas-ui/cursos`, `/pruebas-ui/niveles`
// y `/pruebas-ui/alumnos`) solo se habilitan para
// esta corrida. Las credenciales de Supabase se completan con valores de relleno
// únicamente cuando el entorno no trae unas propias, para que la suite arranque
// sin configuración previa y sin pisar la configuración real de nadie.
const entornoServidor: Record<string, string> = {
  EPT_UI_HARNESS: '1',
  NEXT_PUBLIC_SUPABASE_URL:
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder-pruebas.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder-anon-key-solo-para-pruebas',
}

/**
 * Las pruebas autenticadas necesitan el stack local descartable de Supabase y
 * usuarios sembrados, así que solo se incluyen con `EPT_SUPABASE_LOCAL=1`.
 * Sin esa variable la suite corre igual, con la cobertura que no depende de una
 * base de datos, y no falla por infraestructura ausente.
 *
 *     supabase start && supabase db reset
 *     EPT_SUPABASE_LOCAL=1 npm run test:e2e
 */
const conBaseLocal = process.env.EPT_SUPABASE_LOCAL === '1'

const PRUEBAS_AUTENTICADAS =
  /(?:cursos|niveles|alumnos|usuarios|materias|comedor|deportes|horarios|horarios-academicos|hijos|profesores|gestion-estudiantes)-auth\.spec\.ts/
const PRUEBAS_SETUP = /auth\.setup\.ts/

// `niveles-responsive` existe únicamente para los perfiles móviles.
const PRUEBAS_SOLO_MOVIL = /niveles-responsive\.spec\.ts/

// `alumnos-ui`, `materias-ui`, `comedor-ui`, `deportes-ui`, `horarios-ui` y `profesores-ui` corren en los tres perfiles:
// escritorio, Pixel 5 e iPhone 13. Sus aserciones se adaptan al ancho de la
// ventana, de modo que un mismo archivo demuestra la presentación de escritorio
// y la móvil.
const PRUEBAS_MULTIPERFIL =
  /(?:alumnos-(?:ui|contraste)|materias-ui|comedor-ui|deportes-ui|horarios-ui|hijos-ui|profesores-ui)\.spec\.ts/

const proyectoBase: Project = {
  name: 'chromium',
  use: { ...devices['Desktop Chrome'] },
  // Estas pruebas asumen que NO hay sesión: se excluyen las autenticadas.
  testIgnore: [PRUEBAS_AUTENTICADAS, PRUEBAS_SETUP, PRUEBAS_SOLO_MOVIL],
}

const proyectosResponsive: Project[] = [
  {
    name: 'pixel-5-chromium',
    use: { ...devices['Pixel 5'] },
    testMatch: [PRUEBAS_SOLO_MOVIL, PRUEBAS_MULTIPERFIL],
  },
  {
    name: 'iphone-13-webkit',
    use: { ...devices['iPhone 13'] },
    testMatch: [PRUEBAS_SOLO_MOVIL, PRUEBAS_MULTIPERFIL],
  },
]

/**
 * Un proyecto por actor. El `grep` enruta cada bloque `describe` al perfil con
 * la sesión correcta, de modo que las pruebas de denegación corren con la
 * identidad que realmente debe ser rechazada y no con una simulación.
 */
const proyectosAutenticados: Project[] = [
  {
    name: 'setup',
    use: { ...devices['Desktop Chrome'] },
    testMatch: PRUEBAS_SETUP,
  },
  {
    name: 'chromium-directora',
    use: { ...devices['Desktop Chrome'], storageState: 'tests/.auth/directora.json' },
    testMatch: PRUEBAS_AUTENTICADAS,
    grep: /DIRECTOR autenticado/,
    dependencies: ['setup'],
  },
  {
    name: 'chromium-estudiante',
    use: { ...devices['Desktop Chrome'], storageState: 'tests/.auth/estudiante.json' },
    testMatch: PRUEBAS_AUTENTICADAS,
    grep: /ESTUDIANTE autenticado/,
    dependencies: ['setup'],
  },
  {
    name: 'chromium-estudiante-inactivo',
    use: {
      ...devices['Desktop Chrome'],
      storageState: 'tests/.auth/estudiante-inactivo.json',
    },
    testMatch: PRUEBAS_AUTENTICADAS,
    grep: /ESTUDIANTE INACTIVO autenticado/,
    dependencies: ['setup'],
  },
  {
    name: 'chromium-estudiante-ajeno',
    use: {
      ...devices['Desktop Chrome'],
      storageState: 'tests/.auth/estudiante-ajeno.json',
    },
    testMatch: PRUEBAS_AUTENTICADAS,
    grep: /ESTUDIANTE AJENO autenticado/,
    dependencies: ['setup'],
  },
  {
    name: 'chromium-docente',
    use: { ...devices['Desktop Chrome'], storageState: 'tests/.auth/docente.json' },
    testMatch: PRUEBAS_AUTENTICADAS,
    grep: /DOCENTE autenticado/,
    dependencies: ['setup'],
  },
  {
    name: 'chromium-padre',
    use: { ...devices['Desktop Chrome'], storageState: 'tests/.auth/padre.json' },
    testMatch: PRUEBAS_AUTENTICADAS,
    grep: /PADRE autenticado/,
    dependencies: ['setup'],
  },
  {
    name: 'chromium-padre-segundo',
    use: { ...devices['Desktop Chrome'], storageState: 'tests/.auth/padre-segundo.json' },
    testMatch: PRUEBAS_AUTENTICADAS,
    grep: /PADRE SEGUNDO autenticado/,
    dependencies: ['setup'],
  },
  {
    name: 'chromium-personal',
    use: { ...devices['Desktop Chrome'], storageState: 'tests/.auth/personal.json' },
    testMatch: PRUEBAS_AUTENTICADAS,
    grep: /PERSONAL autenticado/,
    dependencies: ['setup'],
  },
  {
    name: 'chromium-sin-perfil',
    use: { ...devices['Desktop Chrome'], storageState: 'tests/.auth/sin-perfil.json' },
    testMatch: PRUEBAS_AUTENTICADAS,
    grep: /SIN PERFIL autenticado/,
    dependencies: ['setup'],
  },
]

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: 1,
  // Las suites autenticadas comparten el catálogo local descartable. Un único
  // worker evita que las altas reales de Niveles alteren mientras tanto las
  // aserciones históricas de Cursos; sin base local se conserva el paralelismo.
  workers: conBaseLocal ? 1 : undefined,
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    env: entornoServidor,
  },
  projects: conBaseLocal
    ? [...proyectosAutenticados, proyectoBase, ...proyectosResponsive]
    : [proyectoBase, ...proyectosResponsive],
})
