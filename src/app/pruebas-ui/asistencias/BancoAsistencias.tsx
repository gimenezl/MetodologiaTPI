'use client'

import { VistaAsistenciaPropia } from '@/app/dashboard/asistencias/_components/VistaAsistenciaPropia'
import { VistaGestionAsistencias } from '@/app/dashboard/asistencias/_components/VistaGestionAsistencias'

/**
 * Banco de pruebas de la pantalla de asistencias (EPT-66 D). Renderiza las vistas
 * reales por rol; los datos los simula la prueba interceptando `/api/asistencias`
 * (personal) y las lecturas de Supabase (alumno y padre). Todo es sintético.
 */
export function BancoAsistencias({ vista }: { vista: string }) {
  if (vista === 'director') return <VistaGestionAsistencias rol="DIRECTOR" />
  if (vista === 'padre') return <VistaAsistenciaPropia rol="PADRE" />
  if (vista === 'estudiante') return <VistaAsistenciaPropia rol="ESTUDIANTE" />
  return <VistaGestionAsistencias rol="DOCENTE" />
}
