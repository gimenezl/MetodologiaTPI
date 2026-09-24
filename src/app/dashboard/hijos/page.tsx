import type { Metadata } from 'next'
import { requerirRol } from '@/services/autorizacion'
import { listarHijos, listarCursosDisponibles, type Hijo, type CursoDisponible } from '@/services/hijos.service'
import { InscripcionHijos } from './_components/InscripcionHijos'

export const metadata: Metadata = { title: 'Mis hijos | Panel' }
export const dynamic = 'force-dynamic'

export default async function HijosPage() {
  const permiso = await requerirRol('PADRE', 'Solo un padre puede consultar esta sección.')
  if (!permiso.autorizado) {
    return <section role="alert"><h1>Acceso restringido</h1><p>{permiso.mensaje}</p></section>
  }
  let hijos: Hijo[]
  let cursos: CursoDisponible[]
  try {
    ;[hijos, cursos] = await Promise.all([listarHijos(), listarCursosDisponibles()])
  } catch {
    return <section role="alert"><h1>No pudimos cargar tus hijos</h1><p>Volvé a intentar más tarde.</p></section>
  }
  return <InscripcionHijos iniciales={hijos} cursos={cursos} />
}
