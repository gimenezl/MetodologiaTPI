import type { Metadata } from 'next'
import Link from 'next/link'
import { requerirDirector } from '@/services/autorizacion'
import { listarAsignaciones } from '@/services/materias.service'
import { listarFranjasAcademicas, listarHistorialFranjas } from '@/services/horarios-academicos.service'
import { GestionHorariosAcademicos } from './_components/GestionHorariosAcademicos'

export const metadata: Metadata = { title: 'Horarios académicos | Panel' }
export const dynamic = 'force-dynamic'

export default async function HorariosAcademicosPage() {
  const permiso = await requerirDirector('Solo la dirección puede consultar horarios académicos.')
  if (!permiso.autorizado) {
    return <div className="mx-auto max-w-xl p-6" role="alert">
      <h1 className="text-2xl font-bold">Acceso restringido</h1>
      <p className="mt-2 text-neutral-600">{permiso.mensaje}</p>
      <Link href="/dashboard" className="mt-4 inline-block underline">Volver al panel</Link>
    </div>
  }
  const [asignaciones, franjas, historial] = await Promise.all([
    listarAsignaciones(), listarFranjasAcademicas(), listarHistorialFranjas(),
  ])
  if (!asignaciones.ok || !franjas.ok || !historial.ok) {
    return <div className="mx-auto max-w-3xl p-6" role="alert">
      <h1 className="text-2xl font-bold">Horarios académicos</h1>
      <p className="mt-3 text-red-700">No pudimos cargar las franjas y su historial. Reintentá más tarde.</p>
      <Link href="/dashboard/horarios-academicos" className="mt-4 inline-block underline">Reintentar</Link>
    </div>
  }
  return <GestionHorariosAcademicos asignaciones={asignaciones.datos} franjas={franjas.datos} historial={historial.datos} />
}
