import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { AppState } from 'react-native'

import { consultarInscripciones, ErrorConsultaFamilia } from '@/servicios/consultas-familia'
import type { ClienteEPT } from '@/servicios/supabase'

import type { AlumnoSelector } from '../cuotas/CuotasVista'
import { InscripcionesVista, type ResultadoInscripciones } from './InscripcionesVista'

/** Contexto de la pantalla; el padre puede elevarlo para sobrevivir a una revalidación de sesión. */
export interface ContextoInscripciones {
  elegido: string | null
}

export const CONTEXTO_INSCRIPCIONES_VACIO: ContextoInscripciones = { elegido: null }

export interface InscripcionesContenedorProps {
  cliente: ClienteEPT
  /** Alumnos que el actor puede consultar. El servidor vuelve a decidirlo en cada lectura. */
  alumnos: AlumnoSelector[]
  /** Solo el padre ve el selector de hijos. */
  mostrarSelector: boolean
  contexto?: ContextoInscripciones
  onContexto?: (contexto: ContextoInscripciones) => void
}

type Respuesta = { clave: string; resultado: Exclude<ResultadoInscripciones, { tipo: 'cargando' }> }

/**
 * Coordina la consulta de inscripciones. Cada respuesta queda atada a (alumno, intento): al cambiar de hijo
 * o reanudar la aplicación, una respuesta tardía nunca se muestra bajo otro contexto, aunque su petición
 * ya hubiera sido cancelada. La cancelación es una optimización; la clave de la respuesta es la garantía.
 */
export function InscripcionesContenedor({
  cliente,
  alumnos,
  mostrarSelector,
  contexto,
  onContexto,
}: InscripcionesContenedorProps): ReactElement {
  const [interno, setInterno] = useState<ContextoInscripciones>(CONTEXTO_INSCRIPCIONES_VACIO)
  const actual = contexto ?? interno
  const [recarga, setRecarga] = useState(0)
  const [respuesta, setRespuesta] = useState<Respuesta | null>(null)

  // El alumno vigente es siempre uno de los autorizados; un vínculo revocado lo reemplaza.
  const alumnoId = useMemo(() => {
    if (alumnos.length === 0) return null
    return alumnos.find(a => a.id === actual.elegido)?.id ?? alumnos[0]?.id ?? null
  }, [alumnos, actual.elegido])

  useEffect(() => {
    const suscripcion = AppState.addEventListener('change', siguiente => {
      if (siguiente === 'active') setRecarga(n => n + 1)
    })
    return () => suscripcion.remove()
  }, [])

  useEffect(() => {
    if (!alumnoId) return
    const clave = `${alumnoId}|${recarga}`
    const control = new AbortController()
    let vigente = true
    void consultarInscripciones(cliente, alumnoId, control.signal)
      .then(inscripciones => {
        if (vigente) setRespuesta({ clave, resultado: { tipo: 'ok', inscripciones } })
      })
      .catch(causa => {
        if (vigente) setRespuesta({ clave, resultado: { tipo: 'error', causa: causa instanceof ErrorConsultaFamilia ? causa.causa : 'red' } })
      })
    return () => {
      vigente = false
      control.abort()
    }
  }, [cliente, alumnoId, recarga])

  const resultado: ResultadoInscripciones =
    respuesta && alumnoId && respuesta.clave === `${alumnoId}|${recarga}` ? respuesta.resultado : { tipo: 'cargando' }

  return (
    <InscripcionesVista
      alumnos={alumnos}
      alumnoId={alumnoId}
      mostrarSelector={mostrarSelector}
      resultado={resultado}
      onSeleccionarAlumno={id => {
        const siguiente = { elegido: id }
        if (onContexto) onContexto(siguiente)
        else setInterno(siguiente)
      }}
      onReintentar={() => setRecarga(n => n + 1)}
    />
  )
}
