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
 *   7. Si esa sentencia falla, compensar Auth y comprobar el resultado.
 *
 * Los pasos 3 y 4 existen para que ningún rechazo previsible ocurra después de
 * haber creado la cuenta de Auth. El paso 6 es una sola escritura en
 * PostgreSQL: el trigger de la migración 008 crea la fila de `alumnos` dentro
 * de esa misma sentencia, así que perfil y legajo académico se confirman o se
 * descartan juntos. No hay ninguna segunda escritura que pueda dejar el
 * conjunto a medias.
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
    // 7. Compensación explícita y comprobada. Si el borrado de la cuenta de
    // Auth también falla, no se puede informar un fallo limpio: quedaría una
    // cuenta sin perfil y hay que decirlo.
    const { error: errorCompensacion } = await admin.auth.admin.deleteUser(created.user.id)

    if (errorCompensacion) {
      console.error('[usuarios] la compensación de Auth falló tras un alta incompleta', {
        user_id: created.user.id,
        perfil: perfilErr.message,
        compensacion: errorCompensacion.message,
      })
      return NextResponse.json(
        {
          error:
            'No se pudo completar el alta y tampoco revertirla por completo. ' +
            'Avisale al equipo técnico antes de reintentar con el mismo email.',
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
