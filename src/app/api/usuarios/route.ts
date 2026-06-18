import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabaseClient } from '@/services/supabase.server'
import { createAdminClient } from '@/services/supabase.admin'

export const dynamic = 'force-dynamic'

const crearUsuarioSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres'),
  nombre: z.string().min(2, 'Nombre inválido').max(100),
  apellido: z.string().min(2, 'Apellido inválido').max(100),
  dni: z.string().regex(/^\d{7,8}$/, 'DNI inválido'),
  rol_id: z.number().int().positive('Rol inválido'),
  telefono: z.string().max(20).optional().or(z.literal('')),
  direccion: z.string().max(255).optional().or(z.literal('')),
  legajo_nro: z.string().max(50).optional().or(z.literal('')),
  // Vínculos familiares
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
  const { email, password, nombre, apellido, dni, rol_id, telefono, direccion, legajo_nro, hijos_ids, tutor_id } = parsed.data

  const admin = createAdminClient()

  // 3. Determinar el nombre del rol elegido para validar los vínculos familiares
  const { data: rolRow } = await admin.from('roles').select('nombre').eq('id', rol_id).single()
  const rolElegido = (rolRow as { nombre: string } | null)?.nombre

  if (rolElegido === 'PADRE' && (!hijos_ids || hijos_ids.length === 0)) {
    return NextResponse.json(
      { error: 'Una cuenta de padre/tutor debe tener al menos un hijo asignado.' },
      { status: 400 }
    )
  }

  // 4. Crear el usuario de autenticación (con email ya confirmado)
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

  // 5. Crear el perfil asociado con su rol
  const { data: nuevoPerfil, error: perfilErr } = await admin.from('perfiles').insert({
    user_id: created.user.id,
    nombre,
    apellido,
    dni,
    rol_id,
    telefono: telefono || null,
    direccion: direccion || null,
    legajo_nro: legajo_nro || null,
  }).select('id').single()

  if (perfilErr || !nuevoPerfil) {
    // Rollback: si falla el perfil, eliminamos el usuario de auth para no dejar huérfanos
    await admin.auth.admin.deleteUser(created.user.id)
    const m = perfilErr?.message ?? ''
    const friendly = m.includes('perfiles_dni')
      ? 'Ya existe una persona registrada con ese DNI.'
      : (m || 'No se pudo crear el perfil')
    return NextResponse.json({ error: friendly }, { status: 400 })
  }

  // 6. Crear los vínculos familiares
  const nuevoPerfilId = (nuevoPerfil as { id: string }).id

  if (rolElegido === 'PADRE' && hijos_ids && hijos_ids.length > 0) {
    const vinculos = hijos_ids.map((hijoId) => ({ padre_id: nuevoPerfilId, hijo_id: hijoId }))
    const { error: vinculoErr } = await admin.from('padres_hijos').insert(vinculos)
    if (vinculoErr) {
      // Rollback completo
      await admin.from('perfiles').delete().eq('id', nuevoPerfilId)
      await admin.auth.admin.deleteUser(created.user.id)
      return NextResponse.json({ error: 'No se pudieron asignar los hijos al padre/tutor.' }, { status: 400 })
    }
  }

  if (rolElegido === 'ESTUDIANTE' && tutor_id) {
    const { error: vinculoErr } = await admin.from('padres_hijos').insert({ padre_id: tutor_id, hijo_id: nuevoPerfilId })
    if (vinculoErr) {
      await admin.from('perfiles').delete().eq('id', nuevoPerfilId)
      await admin.auth.admin.deleteUser(created.user.id)
      return NextResponse.json({ error: 'No se pudo asignar el tutor al alumno.' }, { status: 400 })
    }
  }

  return NextResponse.json({ ok: true, user_id: created.user.id })
}
