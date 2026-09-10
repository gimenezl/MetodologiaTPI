import { defineConfig, devices } from '@playwright/test'

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
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
