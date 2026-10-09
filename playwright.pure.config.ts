import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: /\/(?:tarifas-lib|asistencias-lib|reportes-lib|paginacion|paginacion-paralela|inscripciones-legadas-lib|accesos-qr-cripto|credenciales-qr-cripto|semantica-estatica|accesos-qr-servicio|redireccion-login)\.spec\.ts$/,
  retries: 0,
  workers: 2,
  reporter: 'list',
})
