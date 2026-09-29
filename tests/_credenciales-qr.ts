import { execFileSync } from 'node:child_process'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { decodeQR } from '@paulmillr/qr/decode.js'

/**
 * Herramientas de las pruebas autenticadas de la credencial QR (EPT-64).
 *
 * Todo apunta al stack local descartable. La siembra y la limpieza usan
 * `docker exec psql` como propietario, igual que `auth.setup.ts`; no
 * representan ninguna operación disponible en la aplicación. Ninguna clave se
 * lee ni se imprime acá: los QR se comprueban decodificando la imagen que la
 * propia aplicación entrega, sin conocer el secreto de firma.
 */

const CONTENEDOR = process.env.EPT_SUPABASE_DB_CONTAINER ?? 'supabase_db_educar-para-transformar'

export function sql(consulta: string): string {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTENEDOR, 'psql', '-X', '-q', '-t', '-A', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    { input: consulta, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim()
}

/** Identificador del alumno (= perfil) con ese DNI sintético. */
export function idAlumnoPorDni(dni: string): string {
  const id = sql(`SELECT perfil_id FROM public.alumnos a JOIN public.perfiles p ON p.id = a.perfil_id WHERE p.dni = '${dni}';`)
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error(`No se encontró al alumno con DNI ${dni}.`)
  return id
}

export function idPerfilPorDni(dni: string): string {
  const id = sql(`SELECT id FROM public.perfiles WHERE dni = '${dni}';`)
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error(`No se encontró el perfil con DNI ${dni}.`)
  return id
}

/**
 * Borra TODAS las credenciales de esos alumnos. Solo para dejar el escenario
 * determinista: la tabla es de solo agregado y la aplicación no puede hacerlo;
 * esta limpieza desactiva la guarda dentro de su propia transacción local.
 */
export function limpiarCredenciales(alumnoIds: readonly string[]): void {
  if (alumnoIds.length === 0) return
  const lista = alumnoIds.map((id) => `'${id}'`).join(', ')
  sql(`
    BEGIN;
    ALTER TABLE public.credenciales_qr DISABLE TRIGGER proteger_credencial_qr_antes_de_escribir;
    DELETE FROM public.credenciales_qr WHERE alumno_id IN (${lista});
    ALTER TABLE public.credenciales_qr ENABLE TRIGGER proteger_credencial_qr_antes_de_escribir;
    COMMIT;
  `)
}

export function kidConfigurado(): string {
  return process.env.QR_CREDENCIAL_KID_ACTIVA ?? 'k1'
}

/** Siembra una credencial ACTIVA como propietario (sin pasar por la API) y devuelve su id. */
export function sembrarActiva(alumnoId: string, actorDni = '99900001'): string {
  const existente = sql(
    `SELECT id FROM public.credenciales_qr WHERE alumno_id = '${alumnoId}' AND estado = 'ACTIVA';`
  )
  if (existente) return existente
  return sql(`
    INSERT INTO public.credenciales_qr (alumno_id, clave_kid, emitida_por)
    VALUES ('${alumnoId}', '${kidConfigurado()}', (SELECT id FROM public.perfiles WHERE dni = '${actorDni}'))
    RETURNING id;
  `).split('\n')[0]
}

export function contarCredenciales(alumnoId: string, estado?: 'ACTIVA' | 'REVOCADA'): number {
  return Number(
    sql(
      `SELECT count(*) FROM public.credenciales_qr WHERE alumno_id = '${alumnoId}'${estado ? ` AND estado = '${estado}'` : ''};`
    )
  )
}

export function estadoAlumno(alumnoId: string): 'ACTIVO' | 'INACTIVO' {
  return sql(`SELECT estado FROM public.alumnos WHERE perfil_id = '${alumnoId}';`) as 'ACTIVO' | 'INACTIVO'
}

export function ponerAcceso(perfilId: string, estado: 'HABILITADO' | 'BLOQUEADO'): void {
  sql(`UPDATE public.perfiles SET estado_acceso = '${estado}' WHERE id = '${perfilId}';`)
}

/**
 * Decodifica un QR entregado por la aplicación como URI de datos SVG. Rasteriza
 * el propio SVG (una ruta de segmentos `M x y h n v1 h-n z`) y lo pasa por el
 * decodificador de la librería: es la prueba de que la imagen es legible.
 */
export function decodificarQrDesdeUri(uri: string): string {
  const prefijo = 'data:image/svg+xml;base64,'
  if (!uri.startsWith(prefijo)) throw new Error('La imagen del QR no es un SVG en base64.')
  const svg = Buffer.from(uri.slice(prefijo.length), 'base64').toString('utf8')
  const lado = Number(/viewBox="0 0 (\d+) \d+"/.exec(svg)?.[1])
  if (!Number.isInteger(lado)) throw new Error('El SVG del QR no tiene viewBox.')
  const escala = 8
  const ancho = lado * escala
  const pixeles = new Uint8ClampedArray(ancho * ancho * 4).fill(255)
  for (const m of svg.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    const [x0, y0, largo] = [Number(m[1]), Number(m[2]), Number(m[3])]
    for (let y = y0 * escala; y < (y0 + 1) * escala; y += 1) {
      for (let x = x0 * escala; x < (x0 + largo) * escala; x += 1) {
        const i = (y * ancho + x) * 4
        pixeles[i] = pixeles[i + 1] = pixeles[i + 2] = 0
      }
    }
  }
  return decodeQR({ width: ancho, height: ancho, data: pixeles })
}

/** Forma del payload: versión, kid, identificador (22) y firma (43), en base64url. */
export const FORMA_PAYLOAD = /^EPT1\.[a-z0-9]{1,16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/

export function urlSupabase(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url || !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url)) {
    throw new Error('Las pruebas de la credencial QR solo corren contra una API local.')
  }
  return url
}

/**
 * Cliente de PostgREST con una sesión REAL (inicio de sesión con contraseña) para
 * probar RLS y permisos de función sin pasar por la aplicación. No cierra la
 * sesión al terminar: `signOut` revocaría las demás sesiones del mismo usuario.
 */
export async function clienteAutenticado(email: string, password: string): Promise<SupabaseClient> {
  const cliente = createClient(urlSupabase(), process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await cliente.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`No se pudo iniciar sesión como ${email}: ${error.message}`)
  return cliente
}

export function clienteAnonimo(): SupabaseClient {
  return createClient(urlSupabase(), process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export const COLUMNAS_PUBLICAS = 'id, alumno_id, estado, clave_kid, emitida_en, revocada_en'

/**
 * Identidades sintéticas que siembra `tests/auth.setup.ts`. Se repiten acá a
 * propósito: importar `auth.setup.ts` registraría de nuevo su prueba de siembra.
 */
export const IDENT = {
  DIRECTORA: { email: 'directora.prueba@ept.local', password: 'prueba-ept-8-directora', dni: '99900001', nombre: 'Ana', apellido: 'Directora' },
  ESTUDIANTE: { email: 'estudiante.prueba@ept.local', password: 'prueba-ept-8-estudiante', dni: '99900002', nombre: 'Beto', apellido: 'Estudiante', legajo: 'LEG-PRUEBA-0002' },
  AJENO: { email: 'estudiante.ajeno.prueba@ept.local', password: 'prueba-ept-9-ajeno', dni: '99900003', nombre: 'Celeste', apellido: 'Ajena', legajo: 'LEG-PRUEBA-0003' },
  DOCENTE: { email: 'docente.prueba@ept.local', password: 'prueba-ept-9-docente', dni: '99900004' },
  PADRE: { email: 'padre.prueba@ept.local', password: 'prueba-ept-9-padre', dni: '99900005' },
  PERSONAL: { email: 'personal.prueba@ept.local', password: 'prueba-ept-9-personal', dni: '99900006' },
  INACTIVO: { email: 'estudiante.inactivo.prueba@ept.local', password: 'prueba-ept-10-inactivo', dni: '99900008', nombre: 'Ines', apellido: 'Inactiva' },
  PADRE_SEGUNDO: { email: 'padre.segundo.prueba@ept.local', password: 'prueba-ept-13-padre-segundo', dni: '99900010' },
  HIJO_APTO: { email: 'hijo.apto.prueba@ept.local', password: 'prueba-ept-13-hijo-apto', dni: '99900011', nombre: 'Lara', apellido: 'Vinculada', legajo: 'LEG-PRUEBA-0011' },
  HIJO_CONCURRENTE: { email: 'hijo.concurrente.prueba@ept.local', password: 'prueba-ept-13-concurrencia', dni: '99900012', nombre: 'Nicolás', apellido: 'Vinculado', legajo: 'LEG-PRUEBA-0012' },
  SIN_PERFIL: { email: 'sin.perfil.prueba@ept.local', password: 'prueba-ept-9-sin-perfil' },
  DIRECTOR_BLOQUEADO: { email: 'director.bloqueado.prueba@ept.local', password: 'prueba-ept-59-director-bloqueado', dni: '99959001' },
  DOCENTE_BLOQUEADO: { email: 'docente.bloqueado.prueba@ept.local', password: 'prueba-ept-59-docente-bloqueado', dni: '99959002' },
  ESTUDIANTE_BLOQUEADO: { email: 'estudiante.bloqueado.prueba@ept.local', password: 'prueba-ept-59-estudiante-bloqueado', dni: '99959003' },
  PADRE_BLOQUEADO: { email: 'padre.bloqueado.prueba@ept.local', password: 'prueba-ept-59-padre-bloqueado', dni: '99959004' },
  PERSONAL_BLOQUEADO: { email: 'personal.bloqueado.prueba@ept.local', password: 'prueba-ept-59-personal-bloqueado', dni: '99959005' },
} as const
