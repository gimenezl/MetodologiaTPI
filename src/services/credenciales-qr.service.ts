import { cargarClavesQr, ErrorClaveNoDisponible, ErrorConfiguracionQr } from '@/lib/credenciales-qr/claves'
import { codigoDesdeSqlstate, type CodigoCredencial } from '@/lib/credenciales-qr/errores'
import { generarUriQr } from '@/lib/credenciales-qr/imagen'
import { construirPayload } from '@/lib/credenciales-qr/payload'
import {
  verificarCredencial,
  type EstadoConsultado,
  type ResultadoDeVerificacion,
} from '@/lib/credenciales-qr/verificacion'
import { leerTodasLasFilas } from '@/lib/paginacion'
import type {
  AlumnoTarjeta,
  EntradaHistorial,
  EstadoAlumnoQr,
  EstadoTarjeta,
  FilaPanel,
  TarjetaCredencial,
} from '@/lib/credenciales-qr/tipos'
import { createServerSupabaseClient } from '@/services/supabase.server'

export type {
  AlumnoTarjeta,
  CredencialResumen,
  EntradaHistorial,
  EstadoAlumnoQr,
  EstadoTarjeta,
  FilaPanel,
  TarjetaCredencial,
} from '@/lib/credenciales-qr/tipos'

/**
 * Credencial digital QR del alumno (EPT-64, RF20). Solo servidor.
 *
 * Nunca usa `service_role`. Todas las lecturas y escrituras van con la sesión
 * verificada del usuario: las filas las decide RLS y las operaciones privilegiadas
 * (`emitir`, `reponer`, `revocar`, `historial`, `validez`) revalidan
 * `auth.uid()` y el rol DIRECTOR dentro de PostgreSQL. La aplicación jamás
 * recibe del cliente el alumno «autorizado»: solo un identificador que la base
 * confirma o rechaza.
 *
 * El QR NUNCA se lee de la base: la base no lo guarda. Se reconstruye acá, con
 * la clave de servidor, a partir del identificador y del `kid` de cada credencial.
 * Si la configuración de la clave falta o es inválida, no se emite, no se
 * muestra ni se verifica nada (falla cerrado) y el error no revela la causa.
 */

export type Resultado<T> = { ok: true; datos: T } | { ok: false; codigo: CodigoCredencial }

type FilaCredencial = {
  id: string
  alumno_id: string
  estado: 'ACTIVA' | 'REVOCADA'
  clave_kid: string
  emitida_en: string
  revocada_en: string | null
}

// Columnas EXPLÍCITAS: los datos internos (quién emitió, quién revocó, el motivo)
// no tienen privilegio de lectura por la tabla y un `select *` falla.
const COLUMNAS_CREDENCIAL = 'id, alumno_id, estado, clave_kid, emitida_en, revocada_en'
const COLUMNAS_ALUMNO_TARJETA = 'id, nombre, apellido, legajo_nro, estado'

type ErrorPostgres = { code?: string | null; message?: string | null }

function registrar(contexto: string, error: ErrorPostgres | null | undefined) {
  // Solo el código: el mensaje de PostgreSQL puede contener valores. Nunca el payload.
  console.error(`[credenciales-qr] ${contexto}`, { code: error?.code ?? null })
}

function fallo(codigo: CodigoCredencial): { ok: false; codigo: CodigoCredencial } {
  return { ok: false, codigo }
}

function esFalloDeConfiguracion(error: unknown): boolean {
  return error instanceof ErrorConfiguracionQr || error instanceof ErrorClaveNoDisponible
}

/** Estado de la tarjeta a partir del alumno y sus credenciales (la más reciente primero). */
export function derivarEstado(
  alumno: AlumnoTarjeta,
  credenciales: readonly FilaCredencial[],
  acceso: 'HABILITADO' | 'BLOQUEADO' | null
): { estado: EstadoTarjeta; credencial: FilaCredencial | null } {
  const activa = credenciales.find((c) => c.estado === 'ACTIVA') ?? null
  if (activa) {
    if (alumno.estado === 'INACTIVO') return { estado: 'ALUMNO_INACTIVO', credencial: activa }
    if (acceso === 'BLOQUEADO') return { estado: 'ACCESO_BLOQUEADO', credencial: activa }
    return { estado: 'VIGENTE', credencial: activa }
  }
  const revocada = credenciales.find((c) => c.estado === 'REVOCADA') ?? null
  if (revocada) return { estado: 'REVOCADA', credencial: revocada }
  return { estado: 'SIN_CREDENCIAL', credencial: null }
}

/**
 * Tarjeta de un alumno para quien la consulta. RLS decide si el alumno y sus
 * credenciales son visibles: un alumno ajeno, un padre no vinculado o un rol sin
 * derecho reciben el mismo `ALUMNO_NO_ENCONTRADO`, sin distinguir si existe.
 *
 * `consultarAcceso` solo lo pide Dirección: informa si el perfil del alumno está
 * bloqueado, dato que ni el alumno ni sus padres pueden ver.
 */
export async function obtenerTarjeta(
  alumnoId: string,
  { consultarAcceso }: { consultarAcceso: boolean }
): Promise<Resultado<TarjetaCredencial>> {
  const supabase = await createServerSupabaseClient()

  const [alumno, credenciales] = await Promise.all([
    supabase.from('alumnos_academicos').select(COLUMNAS_ALUMNO_TARJETA).eq('id', alumnoId).maybeSingle(),
    supabase
      .from('credenciales_qr')
      .select(COLUMNAS_CREDENCIAL)
      .eq('alumno_id', alumnoId)
      .order('emitida_en', { ascending: false })
      .order('id', { ascending: true }),
  ])

  if (alumno.error) {
    registrar('lectura del alumno', alumno.error)
    return fallo('ERROR_INTERNO')
  }
  if (credenciales.error) {
    registrar('lectura de credenciales', credenciales.error)
    return fallo('ERROR_INTERNO')
  }
  if (!alumno.data) return fallo('ALUMNO_NO_ENCONTRADO')

  const datosAlumno = alumno.data as unknown as AlumnoTarjeta
  const filas = (credenciales.data ?? []) as unknown as FilaCredencial[]

  let acceso: 'HABILITADO' | 'BLOQUEADO' | null = null
  const vigente = filas.find((c) => c.estado === 'ACTIVA')
  if (consultarAcceso && vigente) {
    const validez = await supabase.rpc('consultar_validez_credencial_qr', { p_credencial_id: vigente.id })
    if (validez.error) {
      registrar('consulta del acceso del alumno', validez.error)
      return fallo(codigoDesdeSqlstate(validez.error.code))
    }
    const fila = (validez.data as { acceso_alumno?: string }[] | null)?.[0]
    acceso = fila?.acceso_alumno === 'BLOQUEADO' ? 'BLOQUEADO' : 'HABILITADO'
  }

  const { estado, credencial } = derivarEstado(datosAlumno, filas, acceso)

  let qr: string | null = null
  if (estado === 'VIGENTE' && credencial) {
    try {
      const claves = cargarClavesQr()
      qr = generarUriQr(construirPayload(credencial.id, credencial.clave_kid, claves))
    } catch (error) {
      if (esFalloDeConfiguracion(error)) {
        // Falla cerrado y sin revelar la causa: ni el nombre de la variable ni el kid.
        console.error('[credenciales-qr] configuración de la clave no disponible')
        return fallo('SERVICIO_NO_DISPONIBLE')
      }
      throw error
    }
  }

  return {
    ok: true,
    datos: {
      alumno: datosAlumno,
      estado,
      credencial: credencial
        ? { id: credencial.id, emitida_en: credencial.emitida_en, revocada_en: credencial.revocada_en }
        : null,
      qr,
    },
  }
}

/**
 * Tarjeta del estudiante autenticado. No recibe identificador: la vista
 * `alumnos_academicos` solo devuelve al estudiante su propia fila (RLS), de modo
 * que no hay parámetro que manipular. `datos: null` significa «sin legajo».
 */
export async function obtenerTarjetaPropia(): Promise<Resultado<TarjetaCredencial | null>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.from('alumnos_academicos').select('id').limit(1)
  if (error) {
    registrar('lectura del alumno propio', error)
    return fallo('ERROR_INTERNO')
  }
  const propio = (data as { id: string }[] | null)?.[0]
  if (!propio) return { ok: true, datos: null }

  const tarjeta = await obtenerTarjeta(propio.id, { consultarAcceso: false })
  return tarjeta.ok ? tarjeta : fallo(tarjeta.codigo)
}

/**
 * Tarjetas de los hijos actualmente vinculados al padre autenticado. Los hijos
 * los decide RLS (`padres_hijos` vigente): un hijo desvinculado desaparece en la
 * siguiente lectura.
 */
export async function obtenerTarjetasDeHijos(): Promise<Resultado<TarjetaCredencial[]>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('alumnos_academicos')
    .select('id')
    .order('apellido', { ascending: true })
    .order('nombre', { ascending: true })
    .order('id', { ascending: true })
  if (error) {
    registrar('lectura de los hijos', error)
    return fallo('ERROR_INTERNO')
  }

  const ids = ((data ?? []) as { id: string }[]).map((fila) => fila.id)
  const tarjetas = await Promise.all(ids.map((id) => obtenerTarjeta(id, { consultarAcceso: false })))
  const fallida = tarjetas.find((tarjeta) => !tarjeta.ok)
  if (fallida && !fallida.ok) return fallo(fallida.codigo)
  return { ok: true, datos: tarjetas.flatMap((tarjeta) => (tarjeta.ok ? [tarjeta.datos] : [])) }
}

/** Listado completo para Dirección (paginado por debajo del límite de PostgREST). */
export async function listarPanelDireccion(): Promise<Resultado<FilaPanel[]>> {
  const supabase = await createServerSupabaseClient()

  const [alumnos, credenciales] = await Promise.all([
    leerTodasLasFilas<{
      id: string
      nombre: string
      apellido: string
      legajo_nro: string | null
      estado: EstadoAlumnoQr
      curso_denominacion: string | null
      curso_division: string | null
    }>((desde, hasta) =>
      supabase
        .from('alumnos_academicos')
        .select('id, nombre, apellido, legajo_nro, estado, curso_denominacion, curso_division')
        .order('apellido', { ascending: true })
        .order('nombre', { ascending: true })
        .order('id', { ascending: true })
        .range(desde, hasta)
    ),
    leerTodasLasFilas<FilaCredencial>((desde, hasta) =>
      supabase
        .from('credenciales_qr')
        .select(COLUMNAS_CREDENCIAL)
        .order('emitida_en', { ascending: false })
        .order('id', { ascending: true })
        .range(desde, hasta)
    ),
  ])

  if (!alumnos.ok) {
    registrar('listado de alumnos', alumnos.error)
    return fallo('ERROR_INTERNO')
  }
  if (!credenciales.ok) {
    registrar('listado de credenciales', credenciales.error)
    return fallo('ERROR_INTERNO')
  }

  const porAlumno = new Map<string, FilaCredencial[]>()
  for (const fila of credenciales.datos) {
    const lista = porAlumno.get(fila.alumno_id) ?? []
    lista.push(fila)
    porAlumno.set(fila.alumno_id, lista)
  }

  const filas: FilaPanel[] = alumnos.datos.map((alumno) => {
    const propias = porAlumno.get(alumno.id) ?? []
    const activa = propias.find((c) => c.estado === 'ACTIVA')
    return {
      id: alumno.id,
      nombre: alumno.nombre,
      apellido: alumno.apellido,
      legajo_nro: alumno.legajo_nro,
      estado: alumno.estado,
      curso:
        alumno.curso_denominacion && alumno.curso_division
          ? `${alumno.curso_denominacion} ${alumno.curso_division}`
          : null,
      credencial: activa ? 'VIGENTE' : propias.length > 0 ? 'REVOCADA' : 'SIN_CREDENCIAL',
      emitida_en: activa?.emitida_en ?? null,
    }
  })

  return { ok: true, datos: filas }
}

export async function obtenerHistorial(alumnoId: string): Promise<Resultado<EntradaHistorial[]>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('historial_credenciales_qr', { p_alumno_id: alumnoId })
  if (error) {
    registrar('historial', error)
    return fallo(codigoDesdeSqlstate(error.code))
  }
  return { ok: true, datos: (data ?? []) as EntradaHistorial[] }
}

type FilaEmitida = { id: string; alumno_id: string; estado: 'ACTIVA' | 'REVOCADA' }

/**
 * Emite la credencial de un alumno. La clave activa se carga ANTES de tocar la
 * base: sin configuración válida no se emite nada.
 */
export async function emitirCredencial(alumnoId: string): Promise<Resultado<{ credencialId: string }>> {
  let kid: string
  try {
    kid = cargarClavesQr().kidActivo
  } catch (error) {
    if (esFalloDeConfiguracion(error)) {
      console.error('[credenciales-qr] configuración de la clave no disponible')
      return fallo('SERVICIO_NO_DISPONIBLE')
    }
    throw error
  }

  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('emitir_credencial_qr', { p_alumno_id: alumnoId, p_clave_kid: kid })
  if (error) {
    registrar('emisión', error)
    return fallo(codigoDesdeSqlstate(error.code))
  }
  return { ok: true, datos: { credencialId: (data as FilaEmitida).id } }
}

/** Repone: revoca la credencial indicada y emite otra, atómicamente. */
export async function reponerCredencial(
  credencialId: string,
  motivo: string
): Promise<Resultado<{ credencialId: string }>> {
  let kid: string
  try {
    kid = cargarClavesQr().kidActivo
  } catch (error) {
    if (esFalloDeConfiguracion(error)) {
      console.error('[credenciales-qr] configuración de la clave no disponible')
      return fallo('SERVICIO_NO_DISPONIBLE')
    }
    throw error
  }

  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('reponer_credencial_qr', {
    p_credencial_id: credencialId,
    p_clave_kid: kid,
    p_motivo: motivo,
  })
  if (error) {
    registrar('reposición', error)
    return fallo(codigoDesdeSqlstate(error.code))
  }
  return { ok: true, datos: { credencialId: (data as FilaEmitida).id } }
}

export async function revocarCredencial(
  credencialId: string,
  motivo: string
): Promise<Resultado<{ credencialId: string }>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('revocar_credencial_qr', {
    p_credencial_id: credencialId,
    p_motivo: motivo,
  })
  if (error) {
    registrar('revocación', error)
    return fallo(codigoDesdeSqlstate(error.code))
  }
  return { ok: true, datos: { credencialId: (data as FilaEmitida).id } }
}

/**
 * Verifica el texto de un QR: PRIMERO formato y firma (sin tocar la base), y
 * solo con una firma válida consulta el estado. Es la interfaz mínima para
 * EPT-65; hoy solo la invoca la ruta de Dirección y NO registra accesos.
 *
 * Un fallo de configuración o de la base se propaga como error: jamás se
 * convierte en «válida» ni en «no reconocida».
 */
export async function verificarQr(
  payload: unknown
): Promise<Resultado<ResultadoDeVerificacion>> {
  let claves
  try {
    claves = cargarClavesQr()
  } catch (error) {
    if (esFalloDeConfiguracion(error)) {
      console.error('[credenciales-qr] configuración de la clave no disponible')
      return fallo('SERVICIO_NO_DISPONIBLE')
    }
    throw error
  }

  const supabase = await createServerSupabaseClient()
  let errorDeBase: ErrorPostgres | null = null

  const consultar = async (credencialId: string): Promise<EstadoConsultado | null> => {
    const { data, error } = await supabase.rpc('consultar_validez_credencial_qr', {
      p_credencial_id: credencialId,
    })
    if (error) {
      errorDeBase = error
      throw new Error('consulta de validez fallida')
    }
    const fila = (data as
      | { estado_credencial: EstadoConsultado['estadoCredencial']; estado_alumno: EstadoConsultado['estadoAlumno']; acceso_alumno: EstadoConsultado['accesoAlumno'] }[]
      | null)?.[0]
    return fila
      ? {
          estadoCredencial: fila.estado_credencial,
          estadoAlumno: fila.estado_alumno,
          accesoAlumno: fila.acceso_alumno,
        }
      : null
  }

  try {
    return { ok: true, datos: await verificarCredencial(payload, claves, consultar) }
  } catch {
    const error = errorDeBase as ErrorPostgres | null
    registrar('verificación', error)
    return fallo(error ? codigoDesdeSqlstate(error.code) : 'ERROR_INTERNO')
  }
}
