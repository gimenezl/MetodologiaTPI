import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { dniAlumnoSchema, legajoAlumnoSchema } from '@/lib/validations'
import { createServerSupabaseClient } from '@/services/supabase.server'
import { createAdminClient } from '@/services/supabase.admin'

export const dynamic = 'force-dynamic'

/**
 * Alta de una cuenta de acceso con su perfil.
 *
 * Orden de operaciones, deliberado:
 *
 *   1. Autorizar.
 *   2. Validar el cuerpo completo.
 *   3. Rechazar los vínculos parentales, que esta historia no soporta.
 *   4. Comprobar que el DNI y el legajo estén libres.
 *   5. Crear la cuenta en Auth.
 *   6. Persistir el perfil en una única sentencia.
 *   7. Si esa sentencia parece fallar, reconciliar antes de compensar.
 *
 * Los pasos 3 y 4 existen para que ningún rechazo previsible ocurra después de
 * haber creado la cuenta de Auth. El paso 6 es una sola escritura en
 * PostgreSQL: el trigger de la migración 008 crea la fila de `alumnos` dentro
 * de esa misma sentencia, así que perfil y legajo académico se confirman o se
 * descartan juntos. No hay ninguna segunda escritura que pueda dejar el
 * conjunto a medias.
 *
 * ## Sobre la atomicidad
 *
 * Acá no hay ni puede haber una transacción distribuida: Auth y PostgreSQL son
 * dos sistemas y no comparten confirmación. Lo que sí hay es una estrategia de
 * reconciliación explícita, y conviene decir exactamente cuál es.
 *
 * Un error devuelto por el cliente de PostgREST significa una de dos cosas muy
 * distintas: que PostgreSQL rechazó la escritura, o que no sabemos qué pasó
 * porque la respuesta no llegó. La versión anterior las trataba igual y
 * compensaba en los dos casos. Si el INSERT se había confirmado y sólo se
 * perdió la respuesta, esa compensación borraba la cuenta de Auth y dejaba el
 * perfil y su legajo académico huérfanos: exactamente el estado que la
 * compensación existe para evitar.
 *
 * Antes de borrar nada se pregunta a PostgreSQL qué pasó de verdad, buscando
 * por `user_id`, que es el único identificador que ya conocemos:
 *
 * - **Persistencia confirmada** (existe el perfil y, si corresponde, su fila de
 *   `alumnos`): el alta se da por buena. No se compensa.
 * - **Ausencia confirmada** (no existe ninguna fila): se compensa Auth y se
 *   verifica el borrado.
 * - **Estado parcial o contradictorio**, o una reconciliación que tampoco
 *   responde: no se borra nada a ciegas. Se registra con un identificador de
 *   correlación y se devuelve un error operativo que pide intervención.
 *
 * El identificador de correlación es aleatorio y no lleva datos personales:
 * sirve para encontrar el episodio en el registro del servidor.
 */

const VINCULOS_NO_SOPORTADOS =
  'Los vínculos entre padres o tutores e hijos todavía no están disponibles. ' +
  'Creá la cuenta sin vincular y registrá la relación cuando la funcionalidad esté publicada.'

const crearUsuarioSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres'),
  nombre: z.string().min(2, 'Nombre inválido').max(100),
  apellido: z.string().min(2, 'Apellido inválido').max(100),
  dni: dniAlumnoSchema,
  rol_id: z.number().int().positive('Rol inválido'),
  telefono: z.string().max(20).optional().or(z.literal('')),
  direccion: z.string().max(255).optional().or(z.literal('')),
  legajo_nro: legajoAlumnoSchema.optional().or(z.literal('')),
  // Vínculos familiares: se aceptan en el contrato solo para poder rechazarlos
  // con un mensaje propio en lugar de un error genérico de campo desconocido.
  hijos_ids: z.array(z.string().uuid()).optional(),
  tutor_id: z.string().uuid().optional().or(z.literal('')),
})

/**
 * Un error del cliente de PostgREST que corresponde a un rechazo de PostgreSQL.
 *
 * Los SQLSTATE tienen cinco caracteres alfanuméricos. Cuando el error trae uno,
 * la base habló: rechazó la escritura y no persistió nada. Cuando no lo trae
 * —una falla de red, un intermediario que corta, una respuesta ilegible— no
 * sabemos si la escritura ocurrió, y esa diferencia decide si se puede
 * compensar.
 */
function esRechazoDePostgreSQL(error: { code?: string }) {
  return typeof error.code === 'string' && /^[0-9A-Z]{5}$/u.test(error.code)
}

/** Qué encontró la reconciliación en PostgreSQL. */
type EstadoDelAlta =
  /** El perfil existe y su legajo académico es el esperado. */
  | { clase: 'persistido' }
  /** No hay ninguna fila: la escritura no ocurrió. */
  | { clase: 'ausente' }
  /** El perfil existe pero su legajo académico no coincide. */
  | { clase: 'parcial'; detalle: string }
  /** La reconciliación tampoco pudo responder. */
  | { clase: 'desconocido'; detalle: string }

/**
 * Pregunta a PostgreSQL qué pasó realmente con el alta.
 *
 * Busca por `user_id`, que es el único identificador que ya se conoce con
 * certeza. Es una lectura: no modifica nada y se puede repetir.
 */
async function reconciliarAlta(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  esperaLegajoAcademico: boolean
): Promise<EstadoDelAlta> {
  const { data, error } = await admin
    .from('perfiles')
    .select('id, rol_id')
    .eq('user_id', userId)

  if (error) {
    return { clase: 'desconocido', detalle: error.message }
  }

  const filas = data ?? []
  if (filas.length === 0) return { clase: 'ausente' }
  if (filas.length > 1) {
    return { clase: 'parcial', detalle: `${filas.length} perfiles para el mismo user_id` }
  }

  if (!esperaLegajoAcademico) return { clase: 'persistido' }

  // Un ESTUDIANTE tiene que tener su fila de `alumnos`, que el disparador de la
  // migración 008 crea junto con el perfil. Si falta, el conjunto quedó a
  // medias y no corresponde borrar nada sin mirarlo.
  const { data: academico, error: errorAcademico } = await admin
    .from('alumnos')
    .select('perfil_id')
    .eq('perfil_id', filas[0].id)

  if (errorAcademico) {
    return { clase: 'desconocido', detalle: errorAcademico.message }
  }
  if ((academico ?? []).length !== 1) {
    return {
      clase: 'parcial',
      detalle: `el perfil existe pero tiene ${(academico ?? []).length} legajos académicos`,
    }
  }
  return { clase: 'persistido' }
}

export async function POST(request: Request) {
  // 1. Verificar que quien llama esté autenticado y sea DIRECTOR
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  const { data: perfil } = await supabase
    .from('perfiles')
    .select('rol:roles(nombre)')
    .eq('user_id', user.id)
    .single()

  const rolNombre = (perfil as { rol: { nombre: string } | null } | null)?.rol?.nombre
  if (rolNombre !== 'DIRECTOR') {
    return NextResponse.json({ error: 'Solo el director puede crear usuarios' }, { status: 403 })
  }

  // 2. Validar el cuerpo
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
  }

  const parsed = crearUsuarioSchema.safeParse(body)
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'Datos inválidos'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
  const {
    email, password, nombre, apellido, dni, rol_id,
    telefono, direccion, legajo_nro, hijos_ids, tutor_id,
  } = parsed.data

  // 3. Rechazar los vínculos parentales ANTES de escribir nada.
  //
  // `padres_hijos` no existe en el esquema versionado. La versión anterior de
  // esta ruta intentaba insertar ahí después de haber creado la cuenta de Auth
  // y el perfil; la inserción fallaba, el borrado compensatorio del perfil
  // chocaba con la clave foránea `ON DELETE RESTRICT` de `alumnos`, su error se
  // ignoraba y quedaban filas huérfanas reservando el DNI y el legajo.
  //
  // Se rechaza en vez de ignorarse: un director que eligió un tutor tiene que
  // enterarse de que ese vínculo no se guardó, no creerlo registrado. El
  // vínculo parental pertenece a EPT-13.
  const pidioVinculo = Boolean(tutor_id) || (hijos_ids?.length ?? 0) > 0
  if (pidioVinculo) {
    return NextResponse.json({ error: VINCULOS_NO_SOPORTADOS }, { status: 400 })
  }

  const admin = createAdminClient()
  const legajoNormalizado = legajo_nro || null

  // 4. Comprobar que la identidad esté libre antes de crear la cuenta.
  //
  // No reemplaza a las restricciones únicas, que siguen siendo la autoridad
  // ante dos altas simultáneas; evita el caso habitual de crear y borrar una
  // cuenta de Auth por un duplicado que se podía detectar antes.
  // Se consultan por separado en lugar de con un filtro `or`. El filtro `or` de
  // PostgREST se arma concatenando texto, y el legajo es una cadena libre: uno
  // que contenga una coma o un paréntesis —«LEG,2027» es un legajo válido según
  // el contrato— rompería la expresión y el alta terminaría en un 500 que
  // culpa al sistema de un dato correcto. `eq` codifica el valor por su cuenta.
  const [porDni, porLegajo] = await Promise.all([
    admin.from('perfiles').select('id').eq('dni', dni).limit(1),
    legajoNormalizado
      ? admin.from('perfiles').select('id').eq('legajo_nro', legajoNormalizado).limit(1)
      : Promise.resolve({ data: [] as { id: string }[], error: null }),
  ])

  const errorConsulta = porDni.error ?? porLegajo.error
  if (errorConsulta) {
    console.error('[usuarios] no se pudo verificar la identidad', {
      code: errorConsulta.code,
      message: errorConsulta.message,
    })
    return NextResponse.json(
      { error: 'No pudimos verificar los datos. Volvé a intentarlo en unos minutos.' },
      { status: 500 }
    )
  }

  if ((porDni.data ?? []).length > 0) {
    return NextResponse.json(
      { error: 'Ya existe una persona registrada con ese DNI.' },
      { status: 409 }
    )
  }
  if ((porLegajo.data ?? []).length > 0) {
    return NextResponse.json(
      { error: 'Ya existe un legajo con ese número.' },
      { status: 409 }
    )
  }

  // 5. Crear el usuario de autenticación (con email ya confirmado)
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (createErr || !created?.user) {
    const m = createErr?.message ?? ''
    const friendly = m.toLowerCase().includes('already') || m.toLowerCase().includes('registered')
      ? 'Ya existe un usuario con ese email.'
      : (m || 'No se pudo crear el usuario')
    return NextResponse.json({ error: friendly }, { status: 400 })
  }

  // Se resuelve antes del INSERT: la reconciliación necesita saber si este rol
  // debe tener legajo académico, y preguntarlo después complicaría el análisis.
  const { data: rolPedido } = await admin
    .from('roles')
    .select('nombre')
    .eq('id', rol_id)
    .maybeSingle()
  const esEstudiante = (rolPedido as { nombre: string } | null)?.nombre === 'ESTUDIANTE'

  // 6. Persistir el perfil. Única escritura en PostgreSQL de esta ruta.
  const { error: perfilErr } = await admin.from('perfiles').insert({
    user_id: created.user.id,
    nombre,
    apellido,
    dni,
    rol_id,
    telefono: telefono || null,
    direccion: direccion || null,
    legajo_nro: legajoNormalizado,
  })

  if (perfilErr) {
    // 7. Reconciliar antes de compensar.
    const correlacion = randomUUID()
    const rechazoConfirmado = esRechazoDePostgreSQL(perfilErr)

    const estado = await reconciliarAlta(admin, created.user.id, esEstudiante)

    console.error('[usuarios] el alta devolvió un error; se reconcilió el estado', {
      correlacion,
      user_id: created.user.id,
      clasificacion: rechazoConfirmado
        ? 'rechazo confirmado de PostgreSQL'
        : 'resultado de transporte desconocido',
      sqlstate: perfilErr.code ?? null,
      estado: estado.clase,
    })

    // 7a. La escritura sí se había confirmado: la respuesta se perdió en el
    // camino. Borrar Auth acá dejaría el perfil y su legajo huérfanos.
    if (estado.clase === 'persistido') {
      return NextResponse.json({ ok: true, user_id: created.user.id, reconciliado: true })
    }

    // 7b. No se sabe qué pasó, o quedó a medias. No se borra a ciegas.
    if (estado.clase !== 'ausente') {
      return NextResponse.json(
        {
          error:
            'El alta quedó en un estado que no pudimos confirmar y no la revertimos ' +
            'automáticamente para no perder datos. Avisale al equipo técnico con esta ' +
            `referencia: ${correlacion}.`,
        },
        { status: 500 }
      )
    }

    // 7c. Ausencia confirmada: se compensa y se verifica el borrado.
    const { error: errorCompensacion } = await admin.auth.admin.deleteUser(created.user.id)

    if (errorCompensacion) {
      console.error('[usuarios] la compensación de Auth falló tras un alta incompleta', {
        correlacion,
        user_id: created.user.id,
        perfil: perfilErr.message,
        compensacion: errorCompensacion.message,
      })
      return NextResponse.json(
        {
          error:
            'No se pudo completar el alta y tampoco revertirla por completo. ' +
            'Avisale al equipo técnico antes de reintentar con el mismo email. ' +
            `Referencia: ${correlacion}.`,
        },
        { status: 500 }
      )
    }

    const m = perfilErr.message ?? ''
    const friendly = m.includes('perfiles_dni')
      ? 'Ya existe una persona registrada con ese DNI.'
      : m.includes('legajo')
        ? 'Ya existe un legajo con ese número.'
        : 'No se pudo crear el perfil'
    return NextResponse.json({ error: friendly }, { status: 400 })
  }

  return NextResponse.json({ ok: true, user_id: created.user.id })
}
