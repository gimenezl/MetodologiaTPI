import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { AppState } from 'react-native'

import {
  consultarCuotas,
  consultarDetalleCuota,
  separarPorPestana,
} from '@/servicios/cuotas'
import type { ClienteEPT } from '@/servicios/supabase'

import type { AlmacenamientoSeguro } from '@/servicios/almacenamiento-seguro'
import type { PagoRegistrado } from '@/servicios/pagos'

import { PagoContenedor } from '../pagos/PagoContenedor'
import { DetalleCuotaVista, type ResultadoDetalle } from './DetalleCuotaVista'
import { CuotasVista, type AlumnoSelector, type PestanaCuotas, type ResultadoListado } from './CuotasVista'

/** Contexto de navegación de la pantalla; el padre puede elevarlo para sobrevivir a una revalidación de sesión. */
export interface ContextoCuotas {
  elegido: string | null
  pestana: PestanaCuotas
  abierta: { alumnoId: string; facturaId: string } | null
  /** Pantalla «Pagar ítems» abierta para un hijo (solo padre). Un cambio de hijo la descarta. */
  pago?: { alumnoId: string; registrado?: PagoRegistrado } | null
}

export const CONTEXTO_CUOTAS_VACIO: ContextoCuotas = { elegido: null, pestana: 'pendientes', abierta: null, pago: null }

export interface PagosHabilitados {
  /** Cuenta autenticada: acota la recuperación de un intento de pago. */
  usuarioId: string
  almacenamiento: AlmacenamientoSeguro
}

export interface CuotasContenedorProps {
  cliente: ClienteEPT
  /** Alumnos que el actor puede consultar. RLS vuelve a decidirlo en cada lectura. */
  alumnos: AlumnoSelector[]
  /** Solo el padre ve el selector de hijos. */
  mostrarSelector: boolean
  /** Si se informa, el contexto es controlado desde afuera (se conserva entre revalidaciones). */
  contexto?: ContextoCuotas
  onContexto?: (contexto: ContextoCuotas) => void
  /** Solo se informa para el PADRE: habilita «Pagar ítems». El servidor autoriza igualmente cada operación. */
  pagos?: PagosHabilitados
}

type Listado = { alumnoId: string; recarga: number; resultado: Exclude<ResultadoListado, { tipo: 'cargando' }> }
type Detalle = { alumnoId: string; facturaId: string; recarga: number; resultado: Exclude<ResultadoDetalle, { tipo: 'cargando' }> }

/**
 * Coordina la consulta de cuotas. Cada respuesta queda atada a (alumno, recarga): al cambiar de hijo,
 * volver o reanudar, una respuesta tardía nunca se muestra bajo otro contexto. Las lecturas en vuelo
 * se cancelan al cambiar el contexto o al desmontar (cierre de sesión o cambio de usuario).
 */
export function CuotasContenedor({ cliente, alumnos, mostrarSelector, contexto, onContexto, pagos }: CuotasContenedorProps): ReactElement {
  const [interno, setInterno] = useState<ContextoCuotas>(CONTEXTO_CUOTAS_VACIO)
  const actual = contexto ?? interno
  const { elegido, pestana, abierta, pago } = actual
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
  // La pantalla de pago solo existe para el hijo con el que se abrió y para una cuenta habilitada para pagar.
  const pagoAbierto = pagos && pago && pago.alumnoId === alumnoId ? alumnoId : null

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

  if (pagos && pagoAbierto) {
    return (
      <PagoContenedor
        // Otra cuenta u otro hijo remontan la pantalla: ni la selección ni un resultado se heredan.
        key={`${pagos.usuarioId}:${pagoAbierto}`}
        cliente={cliente}
        usuarioId={pagos.usuarioId}
        alumnoId={pagoAbierto}
        alumnos={alumnos}
        almacenamiento={pagos.almacenamiento}
        // El resultado vive en el contexto de la pantalla: una revalidación de la sesión remonta el
        // contenedor y no debe devolver al padre a la selección después de haber registrado.
        registradoInicial={pago?.registrado}
        onRegistrado={registrado => cambiar({ pago: { alumnoId: pagoAbierto, registrado } })}
        onVolver={huboCambios => {
          cambiar({ pago: null })
          if (huboCambios) setRecarga(n => n + 1)
        }}
      />
    )
  }

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
      permitirPago={Boolean(pagos)}
      onPagar={() => { if (alumnoId) cambiar({ pago: { alumnoId } }) }}
      onSeleccionarAlumno={id => {
        cambiar({ abierta: null, pago: null, elegido: id })
      }}
      onCambiarPestana={setPestana}
      onAbrirDetalle={facturaId => { if (alumnoId) setAbierta({ alumnoId, facturaId }) }}
      onReintentar={() => setRecarga(n => n + 1)}
    />
  )
}
