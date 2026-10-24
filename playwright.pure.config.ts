import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: /\/(?:recibos-pdf|tarifas-lib|asistencias-lib|reportes-lib|reportes-economicos-lib|paginacion|paginacion-paralela|inscripciones-legadas-lib|accesos-qr-cripto|credenciales-qr-cripto|semantica-estatica|accesos-qr-servicio|redireccion-login|comprobantes-lib|comprobantes-servicio)\.spec\.ts$/,
  retries: 0,
  workers: 2,
  reporter: 'list',
})
