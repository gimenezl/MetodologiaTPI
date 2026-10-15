import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { AppState } from 'react-native'

import {
  consultarCuotas,
  consultarDetalleCuota,
  separarPorPestana,
} from '@/servicios/cuotas'
import type { ClienteEPT } from '@/servicios/supabase'

import { DetalleCuotaVista, type ResultadoDetalle } from './DetalleCuotaVista'
import { CuotasVista, type AlumnoSelector, type PestanaCuotas, type ResultadoListado } from './CuotasVista'

/** Contexto de navegación de la pantalla; el padre puede elevarlo para sobrevivir a una revalidación de sesión. */
export interface ContextoCuotas {
  elegido: string | null
  pestana: PestanaCuotas
  abierta: { alumnoId: string; facturaId: string } | null
}

export const CONTEXTO_CUOTAS_VACIO: ContextoCuotas = { elegido: null, pestana: 'pendientes', abierta: null }

export interface CuotasContenedorProps {
  cliente: ClienteEPT
  /** Alumnos que el actor puede consultar. RLS vuelve a decidirlo en cada lectura. */
  alumnos: AlumnoSelector[]
  /** Solo el padre ve el selector de hijos. */
  mostrarSelector: boolean
  /** Si se informa, el contexto es controlado desde afuera (se conserva entre revalidaciones). */
  contexto?: ContextoCuotas
  onContexto?: (contexto: ContextoCuotas) => void
}

type Listado = { alumnoId: string; recarga: number; resultado: Exclude<ResultadoListado, { tipo: 'cargando' }> }
type Detalle = { alumnoId: string; facturaId: string; recarga: number; resultado: Exclude<ResultadoDetalle, { tipo: 'cargando' }> }

/**
 * Coordina la consulta de cuotas. Cada respuesta queda atada a (alumno, recarga): al cambiar de hijo,
 * volver o reanudar, una respuesta tardía nunca se muestra bajo otro contexto. Las lecturas en vuelo
 * se cancelan al cambiar el contexto o al desmontar (cierre de sesión o cambio de usuario).
 */
export function CuotasContenedor({ cliente, alumnos, mostrarSelector, contexto, onContexto }: CuotasContenedorProps): ReactElement {
  const [interno, setInterno] = useState<ContextoCuotas>(CONTEXTO_CUOTAS_VACIO)
  const actual = contexto ?? interno
  const { elegido, pestana, abierta } = actual
  const cambiar = (parcial: Partial<ContextoCuotas>) => {
    const siguiente = { ...actual, ...parcial }
    if (onContexto) onContexto(siguiente)
    else setInterno(siguiente)
  }
  const setAbierta = (valor: ContextoCuotas['abierta']) => cambiar({ abierta: valor })
  const setPestana = (valor: PestanaCuotas) => cambiar({ pestana: valor })
  const [recarga, setRecarga] = useState(0)
  const [listado, setListado] = useState<Listado | null>(null)
  const [detalle, setDetalle] = useState<Detalle | null>(null)

  // El alumno vigente es siempre uno de los autorizados; un vínculo revocado lo reemplaza.
  const alumnoId = useMemo(() => {
    if (alumnos.length === 0) return null
    return alumnos.find(a => a.id === elegido)?.id ?? alumnos[0]?.id ?? null
  }, [alumnos, elegido])

  // Un cambio de alumno efectivo (selección o vínculo revocado) deja sin efecto el detalle abierto.
  const facturaAbierta = abierta && abierta.alumnoId === alumnoId ? abierta.facturaId : null

  useEffect(() => {
    const suscripcion = AppState.addEventListener('change', siguiente => {
      if (siguiente === 'active') setRecarga(n => n + 1)
    })
    return () => suscripcion.remove()
  }, [])

  useEffect(() => {
    if (!alumnoId) return
    const control = new AbortController()
    let vigente = true
    void consultarCuotas(cliente, alumnoId, control.signal)
      .then(cuotas => {
        if (!vigente) return
        const { pendientes, pagadas } = separarPorPestana(cuotas)
        setListado({
          alumnoId,
          recarga,
          resultado: { tipo: 'ok', pendientes, pagadas, fechaCorte: cuotas[0]?.fechaCorte ?? null },
        })
      })
      .catch(() => {
        if (vigente) setListado({ alumnoId, recarga, resultado: { tipo: 'error' } })
      })
    return () => {
      vigente = false
      control.abort()
    }
  }, [cliente, alumnoId, recarga])

  useEffect(() => {
    if (!alumnoId || !facturaAbierta) return
    const control = new AbortController()
    let vigente = true
    void consultarDetalleCuota(cliente, alumnoId, facturaAbierta, control.signal)
      .then(resultado => {
        if (!vigente) return
        setDetalle({
          alumnoId,
          facturaId: facturaAbierta,
          recarga,
          resultado: resultado ? { tipo: 'ok', detalle: resultado } : { tipo: 'no_encontrada' },
        })
      })
      .catch(() => {
        if (vigente) setDetalle({ alumnoId, facturaId: facturaAbierta, recarga, resultado: { tipo: 'error' } })
      })
    return () => {
      vigente = false
      control.abort()
    }
  }, [cliente, alumnoId, facturaAbierta, recarga])

  const resultadoListado: ResultadoListado =
    listado && listado.alumnoId === alumnoId && listado.recarga === recarga ? listado.resultado : { tipo: 'cargando' }

  if (facturaAbierta && alumnoId) {
    const resultadoDetalle: ResultadoDetalle =
      detalle && detalle.alumnoId === alumnoId && detalle.facturaId === facturaAbierta && detalle.recarga === recarga
        ? detalle.resultado
        : { tipo: 'cargando' }
    return (
      <DetalleCuotaVista
        resultado={resultadoDetalle}
        onVolver={() => setAbierta(null)}
        onReintentar={() => setRecarga(n => n + 1)}
      />
    )
  }

  return (
    <CuotasVista
      alumnos={alumnos}
      alumnoId={alumnoId}
      mostrarSelector={mostrarSelector}
      pestana={pestana}
      resultado={resultadoListado}
      onSeleccionarAlumno={id => {
        cambiar({ abierta: null, elegido: id })
      }}
      onCambiarPestana={setPestana}
      onAbrirDetalle={facturaId => { if (alumnoId) setAbierta({ alumnoId, facturaId }) }}
      onReintentar={() => setRecarga(n => n + 1)}
    />
  )
}
