/* eslint-disable @typescript-eslint/no-explicit-any */
import { test as setup, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Test identities for the authenticated EPT-8 flows.
 *
 * Runs only against the disposable local Supabase stack — `playwright.config.ts`
 * includes this project solely when `EPT_SUPABASE_LOCAL=1`. It uses the local
 * service-role key from `.env.local`, which is gitignored, and it never touches
 * a remote project.
 *
 * Everything it creates is synthetic: fake e-mails on a reserved domain, fake
 * DNIs in a T9-prefixed range, and a known set of courses. It deletes and
 * recreates them on every run so the suite is deterministic.
 */

export const DIRECTORA = {
  email: 'directora.prueba@ept.local',
  password: 'prueba-ept-8-directora',
  rol: 'DIRECTOR',
  dni: 'T90001001',
  nombre: 'Ana',
  apellido: 'Directora',
  archivoSesion: 'tests/.auth/directora.json',
}

export const ESTUDIANTE = {
  email: 'estudiante.prueba@ept.local',
  password: 'prueba-ept-8-estudiante',
  rol: 'ESTUDIANTE',
  dni: 'T90001002',
  nombre: 'Beto',
  apellido: 'Estudiante',
  archivoSesion: 'tests/.auth/estudiante.json',
}

const IDENTIDADES = [DIRECTORA, ESTUDIANTE]

/** Deterministic starting courses, so assertions do not depend on run order. */
export const CURSOS_SEMILLA = [
  { denominacion: '1er Grado', division: 'A', nivel: 'PRIMARIO', activo: true },
  { denominacion: '1er Grado', division: 'B', nivel: 'PRIMARIO', activo: false },
  { denominacion: 'Sala de 5', division: 'A', nivel: 'INICIAL', activo: true },
]

function clienteAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      'Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY. ' +
        'Levantá el stack local con `supabase start` y generá .env.local.'
    )
  }
  if (!/localhost|127\.0\.0\.1/.test(url)) {
    throw new Error(
      `Se esperaba una base local y se encontró ${url}. Este setup nunca debe correr contra un proyecto remoto.`
    )
  }
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

setup('crear identidades y datos de prueba', async () => {
  const admin = clienteAdmin() as any

  // 1. Borrar los usuarios de prueba anteriores, si quedaron de otra corrida.
  const { data: existentes } = await admin.auth.admin.listUsers()
  for (const usuario of existentes?.users ?? []) {
    if (IDENTIDADES.some((i) => i.email === usuario.email)) {
      await admin.from('perfiles').delete().eq('user_id', usuario.id)
      await admin.auth.admin.deleteUser(usuario.id)
    }
  }

  // 2. Crear cada identidad con su perfil y su rol.
  for (const identidad of IDENTIDADES) {
    const { data: creado, error: errorAlta } = await admin.auth.admin.createUser({
      email: identidad.email,
      password: identidad.password,
      email_confirm: true,
    })
    if (errorAlta || !creado?.user) {
      throw new Error(`No se pudo crear ${identidad.email}: ${errorAlta?.message}`)
    }

    const { data: rol } = await admin
      .from('roles')
      .select('id')
      .eq('nombre', identidad.rol)
      .single()
    if (!rol) throw new Error(`No existe el rol ${identidad.rol}`)

    const { error: errorPerfil } = await admin.from('perfiles').insert({
      user_id: creado.user.id,
      rol_id: rol.id,
      nombre: identidad.nombre,
      apellido: identidad.apellido,
      dni: identidad.dni,
    })
    if (errorPerfil) {
      throw new Error(`No se pudo crear el perfil de ${identidad.email}: ${errorPerfil.message}`)
    }
  }

  // 3. Dejar los cursos en un estado conocido.
  await admin.from('cursos').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  const { data: niveles } = await admin.from('niveles').select('id, nombre')
  const porNombre = new Map<string, number>(
    (niveles ?? []).map((n: any) => [String(n.nombre).trim().toUpperCase(), n.id as number])
  )
  for (const curso of CURSOS_SEMILLA) {
    const nivelId = porNombre.get(curso.nivel)
    if (!nivelId) throw new Error(`No existe el nivel ${curso.nivel}`)
    const { error } = await admin.from('cursos').insert({
      nivel_id: nivelId,
      denominacion: curso.denominacion,
      division: curso.division,
      activo: curso.activo,
    })
    if (error) throw new Error(`No se pudo sembrar ${curso.denominacion} ${curso.division}: ${error.message}`)
  }
})

for (const identidad of IDENTIDADES) {
  setup(`iniciar sesión como ${identidad.rol}`, async ({ page }) => {
    // Se inicia sesión por el formulario real, no por atajo, para que las
    // cookies queden escritas exactamente como en producción.
    await page.goto('/login')
    await page.getByLabel('Email institucional').fill(identidad.email)
    await page.getByLabel('Contraseña').fill(identidad.password)
    await page.getByRole('button', { name: /ingresar|iniciar/i }).click()

    await page.waitForURL(/\/dashboard/, { timeout: 20000 })

    fs.mkdirSync(path.dirname(identidad.archivoSesion), { recursive: true })
    await page.context().storageState({ path: identidad.archivoSesion })

    expect(fs.existsSync(identidad.archivoSesion)).toBe(true)
  })
}
