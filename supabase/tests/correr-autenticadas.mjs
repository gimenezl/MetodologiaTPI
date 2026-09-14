/**
 * Corre la suite autenticada de Playwright contra el stack local descartable.
 *
 * Existe para que las credenciales locales nunca vivan en un archivo del
 * árbol de trabajo. Se leen de `supabase status -o env`, que reporta la
 * instancia que está corriendo, y se inyectan en el proceso hijo. Nada se
 * escribe en disco.
 *
 * Antes de inyectar nada comprueba que la instancia sea de bucle local. Si
 * `API_URL` apuntara a un proyecto remoto, aborta: esta suite crea y borra
 * usuarios y filas, y no debe hacerlo jamás fuera de una base descartable.
 *
 *     node supabase/tests/correr-autenticadas.mjs [argumentos de playwright]
 */

import { execFileSync, spawnSync } from 'node:child_process'

const ANFITRIONES_LOCALES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

function leerEntornoLocal() {
  const salida = execFileSync('npx', ['supabase', 'status', '-o', 'env'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })

  const valores = {}
  for (const linea of salida.split(/\r?\n/u)) {
    const coincidencia = /^([A-Z0-9_]+)="?(.*?)"?$/u.exec(linea.trim())
    if (coincidencia) valores[coincidencia[1]] = coincidencia[2]
  }
  return valores
}

const local = leerEntornoLocal()

if (!local.API_URL || !local.SERVICE_ROLE_KEY) {
  console.error(
    'FALLO  no se pudo leer la instancia local de Supabase. ¿Está levantada? (supabase start)'
  )
  process.exit(1)
}

const anfitrion = new URL(local.API_URL).hostname
if (!ANFITRIONES_LOCALES.has(anfitrion)) {
  console.error(
    `FALLO  la instancia de Supabase apunta a «${anfitrion}», que no es de bucle local. ` +
      'Esta suite crea y borra datos: se niega a correr fuera de una base descartable.'
  )
  process.exit(1)
}

console.log(`Instancia local verificada: ${local.API_URL}`)

const resultado = spawnSync('npx', ['playwright', 'test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    EPT_SUPABASE_LOCAL: '1',
    NEXT_PUBLIC_SUPABASE_URL: local.API_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: local.ANON_KEY,
    // Sólo el setup local lo usa, para sembrar identidades de prueba. Nunca
    // llega al navegador ni reemplaza a RLS en ninguna ruta de la aplicación.
    SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY,
  },
})

process.exit(resultado.status ?? 1)
