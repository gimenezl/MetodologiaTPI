import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { CATALOGO_DE_ERRORES, type CodigoDeError } from '@/lib/errores'
import { dniAlumnoSchema, legajoAlumnoSchema } from '@/lib/validations'
import { requerirDirector } from '@/services/autorizacion'
import {
  registrarCuentaConPerfil,
  type DiagnosticoDelAlta,
  type SolicitudDeAlta,
} from '@/services/cuentas.service'
import { createAdminClient } from '@/services/supabase.admin'

export const dynamic = 'force-dynamic'

/**
 * Alta de una cuenta de acceso con su perfil.
 *
 * Orden de operaciones, deliberado:
 *
 *   1. Autorizar en el servidor: sesión válida y rol DIRECTOR.
 *   2. Validar el cuerpo completo.
 *   3. Rechazar los vínculos parentales, que esta historia no soporta.
 *   4. Resolver el rol pedido.
 *   5. Registrar cuenta y perfil con `registrarCuentaConPerfil`.
 *
 * El paso 5 es una sola escritura: la migración 010 crea el perfil —y, para un
 * ESTUDIANTE, su legajo académico— dentro de la misma transacción de PostgreSQL
 * en la que GoTrue crea la cuenta. No hay compensación ni borrado en ningún
 * camino; cómo se resuelven los resultados ambiguos está explicado en
 * `src/services/cuentas.service.ts`.
 *
 * Toda respuesta de error sale del catálogo de `src/lib/errores.ts`: mensaje en
 * español, código de dominio y, cuando hace falta investigar, una referencia
 * aleatoria que permite encontrar el episodio en el registro del servidor. El
 * detalle técnico se queda en ese registro.
 */

/** UUID versión 4, que es el formato que GoTrue exige para el `id` de una cuenta. */
const PATRON_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

/** Mensaje para cualquier dato que el esquema no describa con un mensaje propio. */
const MENSAJE_DATO_INVALIDO = 'Revisá los datos ingresados.'

const crearUsuarioSchema = z.object({
  /**
   * Clave de idempotencia del envío. El formulario la genera una vez y la
   * conserva mientras reintenta; es también el `id` de la cuenta. Si falta, se
   * genera una acá y el envío no es reintentable.
   */
  operacion_id: z
    .string()
    .regex(PATRON_UUID_V4, 'El envío no tiene un identificador válido. Recargá la página.')
    .optional(),
  email: z.string().email('Email inválido').max(255, 'El email es demasiado largo'),
  password: z
    .string()
    .min(6, 'La contraseña debe tener al menos 6 caracteres')
    .max(72, 'La contraseña no puede superar los 72 caracteres'),
  nombre: z.string().min(2, 'Nombre inválido').max(100, 'Nombre inválido'),
  apellido: z.string().min(2, 'Apellido inválido').max(100, 'Apellido inválido'),
  dni: dniAlumnoSchema,
  rol_id: z.number('Rol inválido').int('Rol inválido').positive('Rol inválido'),
  telefono: z.string().max(20, 'Teléfono inválido').optional().or(z.literal('')),
  direccion: z.string().max(255, 'Dirección inválida').optional().or(z.literal('')),
  legajo_nro: legajoAlumnoSchema.optional().or(z.literal('')),
  // Vínculos familiares: se aceptan en el contrato solo para poder rechazarlos
  // con un mensaje propio en lugar de un error genérico de campo desconocido.
  hijos_ids: z.array(z.string().uuid('Vínculo inválido')).optional(),
  tutor_id: z.string().uuid('Vínculo inválido').optional().or(z.literal('')),
})

function responderError(
  codigo: CodigoDeError,
  extra: { mensaje?: string; referencia?: string; campo?: string } = {}
) {
  const entrada = CATALOGO_DE_ERRORES[codigo]
  return NextResponse.json(
    {
      error: extra.mensaje ?? entrada.mensaje,
      codigo,
      ...(extra.referencia ? { referencia: extra.referencia } : {}),
      ...(extra.campo ? { campo: extra.campo } : {}),
    },
    { status: entrada.estado }
  )
}

/** Resultados que merecen una referencia: alguien puede tener que investigarlos. */
const CODIGOS_CON_REFERENCIA = new Set<CodigoDeError>([
  'ALTA_RECHAZADA',
  'ALTA_SIN_CONFIRMAR',
  'ESTADO_INCONSISTENTE',
  'SERVICIO_NO_DISPONIBLE',
])

export async function POST(request: Request) {
  // 1. Autorizar. La identidad sale de la sesión, nunca del cuerpo.
  const autorizacion = await requerirDirector('Solo el director puede crear usuarios.')
  if (!autorizacion.autorizado) {
    if (autorizacion.estado === 401) return responderError('NO_AUTENTICADO')
    if (autorizacion.estado === 403) {
      return responderError('SIN_PERMISO', { mensaje: autorizacion.mensaje })
    }
    return responderError('SERVICIO_NO_DISPONIBLE')
  }

  // 2. Validar el cuerpo.
  let cuerpo: unknown
  try {
    cuerpo = await request.json()
  } catch {
    return responderError('CUERPO_INVALIDO')
  }

  // Los mensajes por defecto de Zod están en inglés. Todo campo del esquema
  // declara el suyo; cualquier caso no previsto recibe este respaldo.
  const analisis = crearUsuarioSchema.safeParse(cuerpo, { error: () => MENSAJE_DATO_INVALIDO })
  if (!analisis.success) {
    const problema = analisis.error.issues[0]
    const campo = typeof problema?.path[0] === 'string' ? problema.path[0] : undefined
    return responderError('DATOS_INVALIDOS', {
      mensaje: problema?.message || MENSAJE_DATO_INVALIDO,
      campo,
    })
  }
  const datos = analisis.data

  // 3. Rechazar los vínculos parentales ANTES de escribir nada.
  //
  // La reconciliación 011 incorporó `padres_hijos`, pero todavía no existe una
  // operación que cree cuenta, perfil y vínculo en una única confirmación. Un
  // director que eligió un tutor tiene que enterarse de que ese vínculo no se
  // guardaría, no creerlo registrado. Esa operación pertenece a EPT-13.
  if (datos.tutor_id || (datos.hijos_ids?.length ?? 0) > 0) {
    return responderError('VINCULO_NO_DISPONIBLE')
  }

  const referencia = randomUUID()

  let admin: ReturnType<typeof createAdminClient>
  try {
    admin = createAdminClient()
  } catch {
    console.error('[usuarios] falta la configuración del cliente administrativo', { referencia })
    return responderError('SERVICIO_NO_DISPONIBLE', { referencia })
  }

  // 4. Resolver el rol. Un rol inexistente se explica acá, antes de intentar
  // nada, y no como un rechazo genérico de la base.
  const rol = await admin.from('roles').select('nombre').eq('id', datos.rol_id).maybeSingle()
  if (rol.error) {
    console.error('[usuarios] no se pudo resolver el rol pedido', {
      referencia,
      code: rol.error.code,
      message: rol.error.message,
    })
    return responderError('SERVICIO_NO_DISPONIBLE', { referencia })
  }
  if (!rol.data) {
    return responderError('ROL_INEXISTENTE', { campo: 'rol_id' })
  }

  // 5. Registrar cuenta y perfil.
  const solicitud: SolicitudDeAlta = {
    operacionId: datos.operacion_id?.toLowerCase() ?? randomUUID(),
    email: datos.email,
    password: datos.password,
    perfil: {
      nombre: datos.nombre,
      apellido: datos.apellido,
      dni: datos.dni,
      rol_id: datos.rol_id,
      telefono: datos.telefono || null,
      direccion: datos.direccion || null,
      legajo_nro: datos.legajo_nro || null,
    },
    esEstudiante: (rol.data as { nombre: string }).nombre === 'ESTUDIANTE',
  }

  const diagnostico: DiagnosticoDelAlta = { intentos: [] }
  let resultado: Awaited<ReturnType<typeof registrarCuentaConPerfil>>
  try {
    resultado = await registrarCuentaConPerfil(admin, solicitud, diagnostico)
  } catch (error) {
    // Una excepción después de haber intentado escribir no prueba nada: el alta
    // pudo haber confirmado. Se informa como no confirmada y no se toca nada.
    console.error('[usuarios] excepción no controlada durante el alta', {
      referencia,
      operacion: solicitud.operacionId,
      diagnostico,
      excepcion: error instanceof Error ? error.name : typeof error,
    })
    return responderError('ALTA_SIN_CONFIRMAR', { referencia })
  }

  if (resultado.tipo === 'confirmada') {
    if (resultado.reconciliada || diagnostico.intentos.length > 1) {
      console.warn('[usuarios] el alta se confirmó después de un resultado ambiguo', {
        referencia,
        operacion: solicitud.operacionId,
        diagnostico,
      })
    } else if (diagnostico.intentos.some((intento) => intento.reconciliacion === 'desconocido')) {
      console.warn('[usuarios] el alta se confirmó, pero no se pudo verificar el perfil', {
        referencia,
        operacion: solicitud.operacionId,
        diagnostico,
      })
    }
    return NextResponse.json({
      ok: true,
      user_id: resultado.userId,
      reconciliada: resultado.reconciliada,
    })
  }

  if (CODIGOS_CON_REFERENCIA.has(resultado.codigo)) {
    console.error('[usuarios] el alta no se pudo completar', {
      referencia,
      operacion: solicitud.operacionId,
      codigo: resultado.codigo,
      diagnostico,
    })
    return responderError(resultado.codigo, { referencia })
  }

  return responderError(resultado.codigo, {
    campo:
      resultado.codigo === 'DNI_DUPLICADO'
        ? 'dni'
        : resultado.codigo === 'LEGAJO_DUPLICADO'
          ? 'legajo_nro'
          : resultado.codigo === 'EMAIL_DUPLICADO'
            ? 'email'
            : resultado.codigo === 'CONTRASENA_RECHAZADA'
              ? 'password'
              : undefined,
  })
}
