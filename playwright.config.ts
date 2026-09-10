import { defineConfig, devices, type Project } from '@playwright/test'
import { loadEnvConfig } from '@next/env'

// Next.js lee `.env.local` para el servidor de desarrollo, pero el proceso de
// Playwright no. Se cargan acá con el mismo mecanismo que usa Next, para que
// tanto la configuración de abajo como `tests/auth.setup.ts` vean las mismas
// variables. Sin esto, el setup autenticado no encuentra la base local.
loadEnvConfig(process.cwd())

// El banco de pruebas de interfaz (`/pruebas-ui/cursos`) solo se habilita para
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

const PRUEBAS_AUTENTICADAS = /cursos-auth\.spec\.ts/
const PRUEBAS_SETUP = /auth\.setup\.ts/

const proyectoBase: Project = {
  name: 'chromium',
  use: { ...devices['Desktop Chrome'] },
  // Estas pruebas asumen que NO hay sesión: se excluyen las autenticadas.
  testIgnore: [PRUEBAS_AUTENTICADAS, PRUEBAS_SETUP],
}

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
]

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: 1,
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
  projects: conBaseLocal ? [...proyectosAutenticados, proyectoBase] : [proyectoBase],
})
