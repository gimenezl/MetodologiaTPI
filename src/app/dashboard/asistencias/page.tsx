'use client'

import { useAuth } from '@/context/AuthContext'
import { VistaAsistenciaPropia } from './_components/VistaAsistenciaPropia'
import { VistaGestionAsistencias } from './_components/VistaGestionAsistencias'

/**
 * Asistencias. Dirección y docentes gestionan (el docente solo a sus alumnos
 * con vínculo vigente); el alumno y el padre consultan su historial de solo
 * lectura. El rol decide la vista, pero la autorización real está en el
 * servidor y en la base de datos.
 */
export default function AsistenciasPage() {
  const { rol } = useAuth()
  if (rol === 'DIRECTOR' || rol === 'DOCENTE') return <VistaGestionAsistencias rol={rol} />
  return <VistaAsistenciaPropia rol={rol} />
}
