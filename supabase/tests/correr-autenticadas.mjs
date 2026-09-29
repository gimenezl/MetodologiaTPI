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

/**
 * `EPT_SUPABASE_WORKDIR` apunta a un directorio con su propio `supabase/config.toml`
 * (otro `project_id` y otros puertos): permite correr la suite contra un stack
 * local AISLADO sin tocar el compartido que usen otros checkouts. Sin la
 * variable, el comportamiento es el de siempre.
 */
const DIRECTORIO_SUPABASE = process.env.EPT_SUPABASE_WORKDIR

function leerEntornoLocal() {
  const argumentos = ['supabase', 'status', '-o', 'env']
  if (DIRECTORIO_SUPABASE) argumentos.push('--workdir', DIRECTORIO_SUPABASE)
  const salida = execFileSync('npx', argumentos, {
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

// Mailpit (EPT-59, vínculo de cuentas D5) también tiene que ser de bucle local:
// la suite envía códigos reales y los lee desde su API.
const mailpit = local.MAILPIT_URL || local.INBUCKET_URL || 'http://127.0.0.1:54324'
if (!ANFITRIONES_LOCALES.has(new URL(mailpit).hostname)) {
  console.error(
    `FALLO  Mailpit apunta a «${new URL(mailpit).hostname}», que no es de bucle local. ` +
      'La suite envía correos de prueba: se niega a correr fuera del stack local.'
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
    // Vínculo presencial de cuentas (EPT-59, D5), solo para esta corrida: el
    // servidor de Next envía el código por el SMTP local de Mailpit y
    // las pruebas lo leen desde su API. Nunca se usa un servidor de correo real.
    EPT_VINCULO_CUENTAS: 'habilitado',
    EPT_SMTP_HOST: '127.0.0.1',
    EPT_SMTP_PORT: process.env.EPT_TEST_SMTP_PORT ?? '54325',
    EPT_SMTP_SECURE: 'false',
    EPT_SMTP_REMITENTE: 'no-responder@ept.local',
    EPT_MAILPIT_URL: mailpit,
  },
})

process.exit(resultado.status ?? 1)
