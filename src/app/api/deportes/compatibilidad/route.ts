import { NextResponse } from 'next/server'
import { alumnoIdSchema } from '@/lib/validations'
import { requerirSesionConRol } from '@/services/autorizacion'
import {
  consultarCompatibilidadAlumno,
  consultarCompatibilidadPropia,
} from '@/services/deportes.service'

export const dynamic = 'force-dynamic'

/**
 * Consulta de compatibilidad horaria antes de confirmar una inscripción
 * (EPT-12). Devuelve, para cada grupo activo del nivel del alumno, si tiene
 * horario y el primer conflicto con sus actividades activas.
 *
 * - ESTUDIANTE: siempre sobre sí mismo. Enviar `alumno_id` se rechaza con 403:
 *   la identidad del alumno la deriva la base de `auth.uid()`.
 * - DIRECTOR: sobre el alumno indicado en `alumno_id`, para anticipar un alta
 *   administrativa.
 * - Cualquier otro rol o una cuenta sin perfil: 403.
 *
 * La respuesta es informativa: el alta vuelve a evaluar la misma función con
 * el alumno y los grupos bloqueados.
 */
export async function GET(request: Request) {
  const sesion = await requerirSesionConRol()
  if (!sesion.autorizado) {
    return NextResponse.json({ error: sesion.mensaje }, { status: sesion.estado })
  }

  const alumnoId = new URL(request.url).searchParams.get('alumno_id')

  if (sesion.rol === 'ESTUDIANTE') {
    if (alumnoId !== null) {
      return NextResponse.json(
        { error: 'Solo podés consultar tu propia compatibilidad horaria.' },
        { status: 403 }
      )
    }
    const resultado = await consultarCompatibilidadPropia()
    if (!resultado.ok) {
      return NextResponse.json({ error: resultado.mensaje }, { status: resultado.estado })
    }
    return NextResponse.json({ ok: true, grupos: Object.values(resultado.datos) })
  }

  if (sesion.rol === 'DIRECTOR') {
    const parsed = alumnoIdSchema.safeParse(alumnoId)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Seleccioná un alumno', campo: 'alumno_id' },
        { status: 422 }
      )
    }
    const resultado = await consultarCompatibilidadAlumno(parsed.data)
    if (!resultado.ok) {
      return NextResponse.json(
        { error: resultado.mensaje, campo: resultado.campo },
        { status: resultado.estado }
      )
    }
    return NextResponse.json({ ok: true, grupos: Object.values(resultado.datos) })
  }

  return NextResponse.json(
    { error: 'No tenés permisos para consultar la compatibilidad horaria.' },
    { status: 403 }
  )
}
