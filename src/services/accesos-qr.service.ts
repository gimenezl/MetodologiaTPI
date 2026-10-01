import {
  cargarClavesQr,
  ErrorClaveNoDisponible,
  ErrorConfiguracionQr,
} from '@/lib/credenciales-qr/claves'
import { verificarPayload } from '@/lib/credenciales-qr/payload'
import {
  codigoDesdeSqlstate,
  esResultadoEscaneo,
  MENSAJES_RESULTADO,
  type CodigoAcceso,
} from '@/lib/accesos-qr/errores'
import type { FiltrosAuditoria } from '@/lib/accesos-qr/esquemas'
import {
  formatearMomentoBA,
  hoyBA,
  type FilaAcceso,
  type RespuestaEscaneo,
  type Sentido,
  type ServicioEscaneable,
} from '@/lib/accesos-qr/tipos'
import { createAdminClient } from '@/services/supabase.admin'
import { createServerSupabaseClient } from '@/services/supabase.server'

/**
 * Registro de accesos con QR (EPT-65, RF21). Solo servidor.
 *
 * FRONTERA DE SEGURIDAD. La operación que registra un acceso en PostgreSQL solo
 * la ejecuta `service_role`. Por eso este módulo usa DOS clientes con papeles
 * distintos y nunca los mezcla:
 *
 *   - El cliente de SESIÓN (`createServerSupabaseClient`, JWT del usuario) lee el
 *     catálogo de servicios, la auditoría y anula (operaciones de Dirección que
 *     la base resuelve con `auth.uid()`).
 *   - El cliente ADMINISTRATIVO (`createAdminClient`, clave `service_role`, sin
 *     sesión ni cookies) ejecuta el límite de intentos y el registro. NO hereda el
 *     token del usuario: se crea nuevo en cada operación con la clave de servidor.
 *
 * El actor del registro (`p_actor_user_id`) sale de la sesión verificada por la
 * ruta, nunca del cuerpo de la petición, y PostgreSQL lo revalida en cada
 * ejecución (rol DIRECTOR o PERSONAL y acceso HABILITADO).
 *
 * El orden es la garantía: la firma HMAC se verifica ANTES de tocar la base, y
 * solo un payload con firma válida llega a `registrar_acceso_servicio`. La clave
 * vive solo en la configuración del servidor, falla cerrado y no se registra.
 *
 * Nunca se loguea el payload, la firma, la clave, el identificador de la
 * credencial ni el mensaje de PostgreSQL (que puede contener valores): solo el
 * contexto y el código.
 */

export type Resultado<T> =
  | { ok: true; datos: T }
  | { ok: false; codigo: CodigoAcceso; reintentarEnSegundos?: number }

type ErrorPostgres = { code?: string | null; message?: string | null; name?: string | null }

function registrar(contexto: string, error: ErrorPostgres | null | undefined) {
  console.error(`[accesos-qr] ${contexto}`, { code: error?.code ?? null })
}

function fallo(codigo: CodigoAcceso, reintentarEnSegundos?: number): Extract<Resultado<never>, { ok: false }> {
  return { ok: false, codigo, ...(reintentarEnSegundos ? { reintentarEnSegundos } : {}) }
}

/**
 * `AbortSignal.timeout` aborta la petición; PostgREST-js la devuelve como un
 * error SIN `code` cuyo mensaje empieza por el nombre de la excepción.
 */
function esTiempoAgotado(error: ErrorPostgres): boolean {
  const texto = `${error.name ?? ''} ${error.message ?? ''}`
  return /TimeoutError|AbortError|aborted|timed out/i.test(texto)
}

/** SQLSTATE si la base respondió; si no hubo respuesta, tiempo agotado o no disponible. */
function clasificarError(error: ErrorPostgres): CodigoAcceso {
  if (error.code) return codigoDesdeSqlstate(error.code)
  return esTiempoAgotado(error) ? 'TIEMPO_AGOTADO' : 'SERVICIO_NO_DISPONIBLE'
}

function esFalloDeConfiguracion(error: unknown): boolean {
  return error instanceof ErrorConfiguracionQr || error instanceof ErrorClaveNoDisponible
}

/** Cliente administrativo: la falta de `SUPABASE_SERVICE_ROLE_KEY` falla cerrado. */
function clienteAdministrativo() {
  try {
    return createAdminClient()
  } catch {
    console.error('[accesos-qr] cliente administrativo no disponible')
    return null
  }
}

// ---------------------------------------------------------------------------
// Límite de intentos por cuenta operadora
// ---------------------------------------------------------------------------

/**
 * Consume un cupo de solicitudes del operador. ANTES de verificar la firma y sin
 * recibir ni guardar el payload. La base lo cuenta de forma atómica.
 */
export async function consumirCupo(
  userId: string
): Promise<Resultado<{ permitido: boolean; reintentarEnSegundos: number }>> {
  const admin = clienteAdministrativo()
  if (!admin) return fallo('SERVICIO_NO_DISPONIBLE')

  const { data, error } = await admin.rpc('consumir_cupo_escaneo', { p_actor_user_id: userId })
  if (error) {
    registrar('cupo de escaneo', error)
    return fallo(clasificarError(error))
  }
  const fila = (data as { permitido?: boolean; reintentar_en_segundos?: number }[] | null)?.[0]
  if (typeof fila?.permitido !== 'boolean') return fallo('ERROR_INTERNO')
  return {
    ok: true,
    datos: { permitido: fila.permitido, reintentarEnSegundos: fila.reintentar_en_segundos ?? 0 },
  }
}

/** Suma un intento inválido. Un fallo acá no cambia la respuesta: se registra y se sigue. */
async function contarInvalido(userId: string): Promise<void> {
  const admin = clienteAdministrativo()
  if (!admin) return
  const { error } = await admin.rpc('registrar_escaneo_invalido', { p_actor_user_id: userId })
  if (error) registrar('contador de inválidos', error)
}

// ---------------------------------------------------------------------------
// Registro de un acceso
// ---------------------------------------------------------------------------

export type DatosEscaneo = {
  /** Usuario de la sesión VERIFICADA. Nunca proviene del cuerpo de la petición. */
  userId: string
  payload: string
  intentoId: string
  servicioId: string
  sentido?: Sentido
}

type FilaRegistro = {
  codigo_resultado?: string
  alumno_nombre?: string | null
  alumno_apellido?: string | null
  alumno_legajo?: string | null
  sellado_en?: string | null
}

/**
 * Verifica la firma y, SOLO con una firma válida, registra el acceso.
 *
 * Un fallo de configuración o de la base se propaga como error: jamás se
 * convierte en una aprobación ni en un «no reconocido» silencioso.
 */
export async function registrarEscaneo(datos: DatosEscaneo): Promise<Resultado<RespuestaEscaneo>> {
  let claves
  try {
    claves = cargarClavesQr()
  } catch (error) {
    if (esFalloDeConfiguracion(error)) {
      // Sin la clave no hay verificación posible: falla cerrado y sin revelar la causa.
      console.error('[accesos-qr] configuración de la clave no disponible')
      return fallo('SERVICIO_NO_DISPONIBLE')
    }
    throw error
  }

  // 1. Formato, versión, kid y firma HMAC. Puro: no toca la base.
  const firma = verificarPayload(datos.payload, claves)
  if (!firma.ok) {
    await contarInvalido(datos.userId)
    return { ok: true, datos: { codigo: 'NO_RECONOCIDO', mensaje: MENSAJES_RESULTADO.NO_RECONOCIDO } }
  }

  // 2. Solo con firma válida: la operación privilegiada, con el cliente administrativo.
  const admin = clienteAdministrativo()
  if (!admin) return fallo('SERVICIO_NO_DISPONIBLE')

  const { data, error } = await admin.rpc('registrar_acceso_servicio', {
    p_actor_user_id: datos.userId,
    p_intento_id: datos.intentoId,
    p_credencial_id: firma.id,
    // El kid del QR debe ser el de la credencial: la base lo compara (una clave
    // retenida tras una rotación no puede falsificar otra credencial).
    p_clave_kid: firma.kid,
    p_servicio_id: datos.servicioId,
    ...(datos.sentido ? { p_sentido: datos.sentido } : {}),
  })
  if (error) {
    registrar('registro de acceso', error)
    return fallo(clasificarError(error))
  }

  const fila = (data as FilaRegistro[] | null)?.[0]
  const codigo = fila?.codigo_resultado
  if (codigo === 'INTENTO_REUTILIZADO') return fallo('INTENTO_REUTILIZADO')
  // Un valor desconocido NUNCA se interpreta como aprobación.
  if (!esResultadoEscaneo(codigo)) {
    console.error('[accesos-qr] respuesta de la base fuera del conjunto previsto')
    return fallo('ERROR_INTERNO')
  }

  if (codigo === 'REGISTRADO') {
    if (!fila?.alumno_nombre || !fila.alumno_apellido) return fallo('ERROR_INTERNO')
    return {
      ok: true,
      datos: {
        codigo,
        mensaje: MENSAJES_RESULTADO.REGISTRADO,
        alumno: {
          nombre: fila.alumno_nombre,
          apellido: fila.alumno_apellido,
          legajo: fila.alumno_legajo ?? null,
        },
        ...(fila.sellado_en ? { registrado_en: fila.sellado_en } : {}),
      },
    }
  }

  return { ok: true, datos: { codigo, mensaje: MENSAJES_RESULTADO[codigo] } }
}

// ---------------------------------------------------------------------------
// Catálogo, auditoría y anulación (sesión del usuario; la base resuelve el rol)
// ---------------------------------------------------------------------------

/** Servicios y recorridos ACTIVOS que el operador puede declarar. */
export async function listarServiciosEscaneables(): Promise<Resultado<ServicioEscaneable[]>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('servicios_escolares')
    .select('id, tipo, codigo, nombre')
    .eq('activo', true)
    .order('tipo', { ascending: true })
    .order('nombre', { ascending: true })
  if (error) {
    registrar('catálogo de servicios', error)
    return fallo('ERROR_INTERNO')
  }
  return { ok: true, datos: (data ?? []) as ServicioEscaneable[] }
}

export const TAMANO_PAGINA_AUDITORIA = 25

type FilaCruda = {
  total: number | string
  id: string
  registrado_en: string
  dia_servicio: string
  resultado: 'REGISTRADO' | 'DENEGADO'
  motivo_denegacion: string | null
  servicio_nombre: string
  servicio_tipo: 'COMEDOR' | 'TRANSPORTE'
  sentido: Sentido | null
  alumno_nombre: string | null
  alumno_apellido: string | null
  alumno_legajo: string | null
  operador_nombre: string
  anulado: boolean
  anulado_motivo: string | null
  anonimizado: boolean
}

/** Auditoría de Dirección: la función de lectura revalida el rol y recorta los campos. */
export async function listarAccesos(
  filtros: FiltrosAuditoria
): Promise<Resultado<{ filas: FilaAcceso[]; total: number; pagina: number; dia: string }>> {
  const pagina = filtros.pagina ?? 1
  const dia = filtros.dia ?? hoyBA()
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('listar_accesos_servicios', {
    p_dia: dia,
    p_resultado: filtros.resultado ?? null,
    p_servicio_id: filtros.servicio ?? null,
    p_limite: TAMANO_PAGINA_AUDITORIA,
    p_desplazamiento: (pagina - 1) * TAMANO_PAGINA_AUDITORIA,
  })
  if (error) {
    registrar('auditoría', error)
    return fallo(clasificarError(error))
  }
  const filas = ((data ?? []) as FilaCruda[]).map((fila): FilaAcceso => ({
    id: fila.id,
    registrado_en: fila.registrado_en,
    hora: formatearMomentoBA(fila.registrado_en).hora,
    dia_servicio: fila.dia_servicio,
    resultado: fila.resultado,
    motivo_denegacion: fila.motivo_denegacion,
    servicio_nombre: fila.servicio_nombre,
    servicio_tipo: fila.servicio_tipo,
    sentido: fila.sentido,
    alumno_nombre: fila.alumno_nombre,
    alumno_apellido: fila.alumno_apellido,
    alumno_legajo: fila.alumno_legajo,
    operador_nombre: fila.operador_nombre,
    anulado: fila.anulado,
    anulado_motivo: fila.anulado_motivo,
    anonimizado: fila.anonimizado,
  }))
  const total = Number((data as FilaCruda[] | null)?.[0]?.total ?? 0)
  return { ok: true, datos: { filas, total, pagina, dia } }
}

/** Anula un acceso REGISTRADO. La base exige Dirección habilitada con `auth.uid()`. */
export async function anularAcceso(accesoId: string, motivo: string): Promise<Resultado<{ accesoId: string }>> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('anular_acceso_servicio', {
    p_acceso_id: accesoId,
    p_motivo: motivo,
  })
  if (error) {
    registrar('anulación', error)
    return fallo(clasificarError(error))
  }
  const fila = data as { acceso_id?: string } | null
  if (typeof fila?.acceso_id !== 'string') return fallo('ERROR_INTERNO')
  return { ok: true, datos: { accesoId: fila.acceso_id } }
}
