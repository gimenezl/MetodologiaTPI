import { isAuthApiError } from '@supabase/supabase-js'
import {
  esErrorDeConsulta,
  traducirErrorDeEscrituraDePerfil,
  traducirErrorDeUsuarios,
} from '@/lib/errores'
import type { ActualizarDatosPersonalesData, EstadoAcceso } from '@/lib/validations'
import { createAdminClient } from '@/services/supabase.admin'
import { createServerSupabaseClient } from '@/services/supabase.server'
import { fallo, type Fallo, type Resultado } from '@/services/usuarios.respuestas'
import { vinculoDisponible } from '@/services/vinculo-cuenta.service'

/**
 * Usuarios, roles y acceso para la dirección (EPT-59).
 *
 * Solo servidor. Cada decisión la toma PostgreSQL: las RPC corren con el
 * cliente de la sesión, vuelven a exigir un Director habilitado y aplican las
 * reglas (valor esperado, último Director, ESTUDIANTE, PADRE, DOCENTE). Esta
 * capa solo traduce resultados y errores a un contrato estable en español.
 *
 * `service_role` se usa para una única cosa: sincronizar el baneo de la cuenta
 * Auth con el estado de acceso de la base. El baneo es la segunda barrera; la
 * primera es la base, que deja a un perfil BLOQUEADO sin datos aunque presente
 * un JWT emitido antes del bloqueo (verificado: PostgREST acepta ese JWT).
 */

/** Duración del baneo en Auth: cien años, el «para siempre» de GoTrue. */
const BANEO_PERMANENTE = '876000h'

/** Filas por página del listado. La base acepta hasta 100. */
export const USUARIOS_POR_PAGINA = 50

type ClienteDeSesion = Awaited<ReturnType<typeof createServerSupabaseClient>>
type ClienteAdministrativo = ReturnType<typeof createAdminClient>

/** Registra un error de la base sin su mensaje: solo la operación y el SQLSTATE. */
function registrar(operacion: string, error: unknown) {
  console.error(`[usuarios] ${operacion} falló`, {
    code: esErrorDeConsulta(error) ? error.code : 'sin-codigo',
  })
}

function falloDeRpc(operacion: string, error: unknown): Fallo {
  const traducido = traducirErrorDeUsuarios(error)
  if (traducido.codigo === 'ERROR_INESPERADO' || traducido.codigo === 'SERVICIO_NO_DISPONIBLE') {
    registrar(operacion, error)
  }
  return fallo(traducido.codigo)
}

function primeraFila<T>(data: unknown): T | null {
  return Array.isArray(data) && data.length > 0 ? (data[0] as T) : null
}

// ================================================================
// Lecturas
// ================================================================

export type UsuarioResumen = {
  id: string
  nombre: string
  apellido: string
  dni: string
  legajo_nro: string | null
  rol: string | null
  estado_acceso: EstadoAcceso
  tiene_cuenta: boolean
  cuenta_existente: boolean
  correo_confirmado: boolean
  bloqueo_auth: boolean
  es_director_efectivo: boolean
  correo_enmascarado: string | null
}

export type PaginaDeUsuarios = {
  usuarios: UsuarioResumen[]
  total: number
  pagina: number
  por_pagina: number
}

export async function listarUsuarios(
  busqueda: string | undefined,
  pagina: number
): Promise<Resultado<PaginaDeUsuarios>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('listar_usuarios', {
    p_busqueda: busqueda?.trim() ? busqueda : null,
    p_limite: USUARIOS_POR_PAGINA,
    p_desplazamiento: (pagina - 1) * USUARIOS_POR_PAGINA,
  })
  if (error) return falloDeRpc('listar_usuarios', error)

  const filas = (Array.isArray(data) ? data : []) as (UsuarioResumen & { total: number | string })[]
  const total = filas.length > 0 ? Number(filas[0].total) : 0
  return {
    ok: true,
    datos: {
      usuarios: filas.map((fila) => {
        const copia: Partial<typeof fila> = { ...fila }
        delete copia.total
        return copia as UsuarioResumen
      }),
      total,
      pagina,
      por_pagina: USUARIOS_POR_PAGINA,
    },
  }
}

export type DetalleDeUsuario = UsuarioResumen & {
  telefono: string | null
  direccion: string | null
  fecha_nacimiento: string | null
  fecha_creacion: string | null
  ultimo_ingreso: string | null
  vinculo_pendiente_operacion: string | null
  vinculo_pendiente_vence_en: string | null
  puede_vincular: boolean
  /** Si el servidor tiene habilitado el vínculo presencial (D5). */
  vinculo_disponible: boolean
}

export async function consultarUsuario(perfilId: string): Promise<Resultado<DetalleDeUsuario>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('consultar_usuario', { p_perfil_id: perfilId })
  if (error) return falloDeRpc('consultar_usuario', error)
  const fila = primeraFila<Omit<DetalleDeUsuario, 'vinculo_disponible'>>(data)
  if (!fila) return fallo('PERFIL_INEXISTENTE')
  return { ok: true, datos: { ...fila, vinculo_disponible: vinculoDisponible() } }
}

export type EntradaDeHistorial = {
  id: number
  tipo: 'ROL' | 'ACCESO' | 'VINCULO'
  valor_anterior: string | null
  valor_nuevo: string
  motivo: string
  fecha: string
  actor_perfil_id: string
  actor_nombre: string
  actor_apellido: string
  operacion_id: string | null
}

export async function listarHistorial(
  perfilId: string
): Promise<Resultado<{ historial: EntradaDeHistorial[] }>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('listar_historial_usuario', { p_perfil_id: perfilId })
  if (error) return falloDeRpc('listar_historial_usuario', error)
  return { ok: true, datos: { historial: (Array.isArray(data) ? data : []) as EntradaDeHistorial[] } }
}

// ================================================================
// Datos personales
// ================================================================

const COLUMNAS_DE_DATOS_PERSONALES =
  'id, nombre, apellido, dni, legajo_nro, telefono, direccion, fecha_nacimiento'

/**
 * Actualiza los datos personales con la sesión de la dirección.
 *
 * Es el mismo UPDATE que hace Legajos (`actualizarPerfil`), pero en el
 * servidor: pasa por RLS, por los GRANT de columna de EPT-9 y por sus
 * restricciones. `rol_id`, `user_id` y `estado_acceso` no forman parte del
 * contrato y ningún rol de aplicación puede actualizarlos.
 */
export async function actualizarDatosPersonales(
  perfilId: string,
  datos: ActualizarDatosPersonalesData
): Promise<Resultado<{ perfil: Record<string, unknown> }>> {
  const supabase = await createServerSupabaseClient()

  const cambios: Record<string, unknown> = {
    nombre: datos.nombre,
    apellido: datos.apellido,
    dni: datos.dni,
  }
  for (const campo of ['fecha_nacimiento', 'telefono', 'direccion', 'legajo_nro'] as const) {
    const valor = datos[campo]
    if (valor === undefined) continue
    cambios[campo] = valor === '' ? null : valor
  }

  const { data, error } = await supabase
    .from('perfiles')
    .update(cambios)
    .eq('id', perfilId)
    .select(COLUMNAS_DE_DATOS_PERSONALES)
    .maybeSingle()

  if (error) {
    const traducido = traducirErrorDeEscrituraDePerfil(error)
    if (traducido.codigo === 'ERROR_INESPERADO' || traducido.codigo === 'SERVICIO_NO_DISPONIBLE') {
      registrar('actualizar datos personales', error)
    }
    // Una restricción CHECK o un dato rechazado por la base es un 422.
    const estado = traducido.codigo === 'DATOS_INVALIDOS' ? 422 : undefined
    return fallo(traducido.codigo, {
      mensaje: traducido.message,
      campo: traducido.campo ?? undefined,
      estado,
    })
  }

  // Cero filas: el perfil no existe o RLS no dejó modificarlo.
  if (!data) return fallo('SIN_CAMBIOS')
  return { ok: true, datos: { perfil: data as Record<string, unknown> } }
}

// ================================================================
// Rol
// ================================================================

export type CambioDeRol = { perfil_id: string; rol: string; historial_id: number }

export async function cambiarRol(
  perfilId: string,
  rolEsperado: string | null,
  rolNuevo: string,
  motivo: string
): Promise<Resultado<CambioDeRol>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('cambiar_rol_perfil', {
    p_perfil_id: perfilId,
    p_rol_esperado: rolEsperado,
    p_rol_nuevo: rolNuevo,
    p_motivo: motivo,
  })
  if (error) return falloDeRpc('cambiar_rol_perfil', error)
  const fila = primeraFila<CambioDeRol>(data)
  if (!fila) return fallo('ERROR_INESPERADO')
  return { ok: true, datos: fila }
}

// ================================================================
// Acceso y sincronización con Auth
// ================================================================

type ResultadoDeAuth = 'aplicado' | 'sin_cuenta' | 'fallo'

/**
 * Banea o levanta el baneo de una cuenta Auth.
 *
 * `sin_cuenta` significa que GoTrue respondió que la cuenta no existe: no hay
 * nadie que pueda iniciar sesión, así que no hay nada que sincronizar. La
 * respuesta de GoTrue (que incluye la cuenta completa) nunca sale de acá.
 */
async function aplicarBaneo(
  admin: ClienteAdministrativo,
  userId: string,
  bloquear: boolean
): Promise<ResultadoDeAuth> {
  try {
    const { error } = await admin.auth.admin.updateUserById(userId, {
      ban_duration: bloquear ? BANEO_PERMANENTE : 'none',
    })
    if (!error) return 'aplicado'
    if (isAuthApiError(error) && error.status === 404) return 'sin_cuenta'
    console.error('[usuarios] Auth rechazó el cambio de baneo', {
      estado: error.status ?? null,
      codigoAuth: isAuthApiError(error) ? (error.code ?? null) : null,
    })
    return 'fallo'
  } catch (error) {
    console.error('[usuarios] no hubo respuesta de Auth al cambiar el baneo', {
      clase: error instanceof Error ? error.name : typeof error,
    })
    return 'fallo'
  }
}

function clienteAdministrativo(): ClienteAdministrativo | null {
  try {
    return createAdminClient()
  } catch {
    console.error('[usuarios] falta la configuración del cliente administrativo')
    return null
  }
}

type EstadoDeAccesoDe = { estado_acceso: EstadoAcceso; user_id: string | null }

async function leerEstadoAcceso(
  supabase: ClienteDeSesion,
  perfilId: string
): Promise<Resultado<EstadoDeAccesoDe>> {
  const { data, error } = await supabase.rpc('estado_acceso_de', { p_perfil_id: perfilId })
  if (error) return falloDeRpc('estado_acceso_de', error)
  const fila = primeraFila<EstadoDeAccesoDe>(data)
  if (!fila) return fallo('PERFIL_INEXISTENTE')
  return { ok: true, datos: fila }
}

export type CambioDeAcceso = {
  perfil_id: string
  estado_acceso: EstadoAcceso
  historial_id: number
  tiene_cuenta: boolean
  /** `false`: la base ya cambió, pero Auth quedó pendiente (reintentar con sincronizar). */
  auth_sincronizado: boolean
}

type FilaDeCambioDeAcceso = {
  perfil_id: string
  estado_acceso: EstadoAcceso
  user_id: string | null
  historial_id: number
}

async function rpcCambiarAcceso(
  supabase: ClienteDeSesion,
  perfilId: string,
  esperado: EstadoAcceso,
  nuevo: EstadoAcceso,
  motivo: string
): Promise<Resultado<FilaDeCambioDeAcceso>> {
  const { data, error } = await supabase.rpc('cambiar_acceso_perfil', {
    p_perfil_id: perfilId,
    p_estado_esperado: esperado,
    p_estado_nuevo: nuevo,
    p_motivo: motivo,
  })
  if (error) return falloDeRpc('cambiar_acceso_perfil', error)
  const fila = primeraFila<FilaDeCambioDeAcceso>(data)
  if (!fila) return fallo('ERROR_INESPERADO')
  return { ok: true, datos: fila }
}

/**
 * Deja el baneo de Auth igual al estado que la base tiene AHORA.
 *
 * Auditoría EPT-59 (hallazgo 2): el baneo se escribe en GoTrue fuera del
 * candado de la base. Un baneo demorado de un bloqueo anterior podía llegar
 * después de una reactivación y dejar baneado a un Director habilitado —hasta
 * cero Directores efectivos—. Por eso, después de cada escritura en Auth se
 * vuelve a leer la base y, si cambió en el medio, se aplica el estado nuevo.
 * Converge a la base; si no se estabiliza en tres vueltas, se informa como no
 * sincronizado para que la pantalla ofrezca reintentar.
 *
 * Ronda 2 de la auditoría (A2): la relectura usa el cliente administrativo, no
 * la sesión de quien opera —si a esa persona la bloquearon mientras tanto, su
 * sesión ya no puede leer y la convergencia se abandonaba—. Y un intento que
 * devuelve error o se corta por tiempo no corta la convergencia: GoTrue pudo
 * haberlo aplicado igual, así que se relee y se vuelve a escribir el estado
 * de la base.
 */
async function converger(
  admin: ClienteAdministrativo,
  perfilId: string,
  userId: string,
  deseado: EstadoAcceso
): Promise<boolean> {
  const escribir = async (estado: EstadoAcceso) =>
    (await aplicarBaneo(admin, userId, estado === 'BLOQUEADO')) === 'fallo' ? null : estado

  let aplicado = await escribir(deseado)
  for (let vuelta = 0; vuelta < 3; vuelta += 1) {
    const { data, error } = await admin
      .from('perfiles')
      .select('estado_acceso')
      .eq('id', perfilId)
      .maybeSingle()
    if (error || !data) {
      console.error('[usuarios] no se pudo releer el estado de acceso para alinear Auth')
      return false
    }
    const actual = data.estado_acceso as EstadoAcceso
    if (actual === aplicado) return true
    aplicado = await escribir(actual)
  }
  console.error('[usuarios] Auth no quedó alineado con la base después de tres vueltas')
  return false
}

/**
 * Bloquea o reactiva el acceso de una persona.
 *
 * El orden es el que mantiene cerrada la puerta en todo momento:
 *
 * - BLOQUEAR: primero la base (la barrera primaria, inmediata), después el
 *   baneo en Auth. Si el baneo falla, la persona ya no ve datos protegidos; la
 *   respuesta es 200 con `auth_sincronizado: false` y la pantalla ofrece
 *   reintentar con `…/acceso/sincronizar`.
 * - REACTIVAR: primero se confirma que la base todavía dice lo que la pantalla
 *   espera (si no, 409 sin tocar Auth); después se levanta el baneo (si falla,
 *   503 sin tocar la base); por último la base. Si la base rechaza, se vuelve a
 *   banear, salvo que otra operación la haya reactivado mientras tanto.
 *
 * Con Auth reactivado y la base todavía bloqueada, la persona puede iniciar
 * sesión pero la base le sigue negando todo: nunca hay un instante con acceso
 * a datos antes de que la base lo permita.
 */
export async function cambiarAcceso(
  perfilId: string,
  esperado: EstadoAcceso,
  nuevo: EstadoAcceso,
  motivo: string
): Promise<Resultado<CambioDeAcceso>> {
  const supabase = await createServerSupabaseClient()

  if (nuevo === 'BLOQUEADO') {
    const cambio = await rpcCambiarAcceso(supabase, perfilId, esperado, nuevo, motivo)
    if (!cambio.ok) return cambio
    const { user_id: userId, ...fila } = cambio.datos

    let sincronizado = true
    if (userId) {
      const admin = clienteAdministrativo()
      sincronizado = admin !== null && (await converger(admin, perfilId, userId, 'BLOQUEADO'))
    }
    return {
      ok: true,
      datos: { ...fila, tiene_cuenta: userId !== null, auth_sincronizado: sincronizado },
    }
  }

  // REACTIVAR
  const actual = await leerEstadoAcceso(supabase, perfilId)
  if (!actual.ok) return actual
  if (actual.datos.estado_acceso !== esperado) return fallo('VALOR_OBSOLETO')

  const userId = actual.datos.user_id
  let admin: ClienteAdministrativo | null = null
  if (userId) {
    admin = clienteAdministrativo()
    if (!admin || (await aplicarBaneo(admin, userId, false)) === 'fallo') {
      return fallo('AUTH_PENDIENTE')
    }
  }

  const cambio = await rpcCambiarAcceso(supabase, perfilId, esperado, nuevo, motivo)
  if (!cambio.ok) {
    if (userId && admin) {
      // Volver a banear solo si la base sigue bloqueada (o no se pudo leer):
      // si otra operación reactivó mientras tanto, banear dejaría afuera a una
      // persona habilitada. Ante la duda, se banea: la base es la barrera.
      const despues = await leerEstadoAcceso(supabase, perfilId)
      if (!despues.ok || despues.datos.estado_acceso === 'BLOQUEADO') {
        const rebaneo = await aplicarBaneo(admin, userId, true)
        if (rebaneo === 'fallo') {
          console.error('[usuarios] la reactivación falló y no se pudo volver a banear la cuenta')
        }
      }
    }
    return cambio
  }

  const { user_id: cuentaFinal, ...fila } = cambio.datos
  // Un baneo demorado de un bloqueo anterior pudo llegar después del desbaneo.
  const sincronizado =
    cuentaFinal && admin ? await converger(admin, perfilId, cuentaFinal, 'HABILITADO') : true
  return {
    ok: true,
    datos: { ...fila, tiene_cuenta: cuentaFinal !== null, auth_sincronizado: sincronizado },
  }
}

export type Sincronizacion = {
  perfil_id: string
  estado_acceso: EstadoAcceso
  tiene_cuenta: boolean
  auth_sincronizado: boolean
}

/**
 * Hace que Auth coincida con la base: BLOQUEADO → baneo; HABILITADO → sin
 * baneo. Idempotente: se puede repetir cuantas veces haga falta.
 */
export async function sincronizarAcceso(perfilId: string): Promise<Resultado<Sincronizacion>> {
  const supabase = await createServerSupabaseClient()
  const actual = await leerEstadoAcceso(supabase, perfilId)
  if (!actual.ok) return actual

  const { estado_acceso: estado, user_id: userId } = actual.datos
  let sincronizado = true
  if (userId) {
    const admin = clienteAdministrativo()
    sincronizado = admin !== null && (await converger(admin, perfilId, userId, estado))
  }
  return {
    ok: true,
    datos: {
      perfil_id: perfilId,
      estado_acceso: estado,
      tiene_cuenta: userId !== null,
      auth_sincronizado: sincronizado,
    },
  }
}
