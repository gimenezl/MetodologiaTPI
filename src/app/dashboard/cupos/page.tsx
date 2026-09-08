'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { obtenerActividadesConCupos } from '@/services/actividades.service'
import { useAuth } from '@/context/AuthContext'
import { VistaEstudiante } from './_components/VistaEstudiante'
import { VistaPadre } from './_components/VistaPadre'
import { VistaGestionCupos } from './_components/VistaGestionCupos'
import type { ActividadConCupo } from './_components/types'

export default function CuposPage() {
  const { rol, perfil } = useAuth()
  const [actividades, setActividades] = useState<ActividadConCupo[]>([])
  const [cargando, setCargando] = useState(true)

  const cargarActividades = useCallback(async () => {
    setCargando(true)
    try {
      const datos = await obtenerActividadesConCupos()
      setActividades(datos as ActividadConCupo[])
    } catch {
      toast.error('Error al cargar actividades')
    } finally {
      setCargando(false)
    }
  }, [])

  const quitarActividad = useCallback((actividadId: number) => {
    setActividades((anteriores) => anteriores.filter((actividad) => actividad.id !== actividadId))
  }, [])

  useEffect(() => {
    // La carga inicial comparte la misma operación usada por el botón Actualizar.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    cargarActividades()
  }, [cargarActividades])

  if (rol === 'ESTUDIANTE') {
    return (
      <VistaEstudiante
        actividades={actividades}
        cargando={cargando}
        recargarActividades={cargarActividades}
        perfilId={perfil?.id}
      />
    )
  }

  if (rol === 'PADRE') {
    return (
      <VistaPadre
        actividades={actividades}
        cargando={cargando}
        recargarActividades={cargarActividades}
      />
    )
  }

  return (
    <VistaGestionCupos
      actividades={actividades}
      cargando={cargando}
      recargarActividades={cargarActividades}
      quitarActividad={quitarActividad}
      rol={rol}
    />
  )
}
