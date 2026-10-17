import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { AppState } from 'react-native'

import {
  consultarFacturasPeriodo,
  consultarRegistroComprobantes,
  ErrorConsultaFamilia,
  formatearEntradaFecha,
  rangoDelAnio,
  validarRango,
  type CriterioComprobantes,
  type ErroresRango,
  type FacturaPeriodo,
  type RegistroComprobante,
} from '@/servicios/consultas-familia'
import type { ClienteEPT } from '@/servicios/supabase'

import type { AlumnoSelector } from '../cuotas/CuotasVista'
import { PeriodoVista, type ResultadoLista } from './PeriodoVista'

/** Consulta ya aplicada: lo que se pidió, no lo que se está escribiendo. */
export interface ConsultaAplicada {
  alumnoId: string
  desde: string
  hasta: string
  criterio: CriterioComprobantes
  /** Se incrementa en cada «Consultar»: separa dos consultas con los mismos parámetros. */
  intento: number
}

/** Contexto de la pantalla; el padre puede elevarlo para sobrevivir a una revalidación de sesión. */
export interface ContextoPeriodo {
  elegido: string | null
  /** Texto de los campos (`DD/MM/AAAA`). */
  desde: string
  hasta: string
  criterio: CriterioComprobantes
  aplicada: ConsultaAplicada | null
}

export function contextoPeriodoVacio(hoy: Date = new Date()): ContextoPeriodo {
  const { desde, hasta } = rangoDelAnio(hoy)
  return { elegido: null, desde, hasta, criterio: 'PERIODO_FACTURA', aplicada: null }
}

export interface PeriodoContenedorProps {
  cliente: ClienteEPT
  /** Alumnos que el actor puede consultar. El servidor vuelve a decidirlo en cada lectura. */
  alumnos: AlumnoSelector[]
  /** Solo el padre ve el selector de hijos. */
  mostrarSelector: boolean
  contexto?: ContextoPeriodo
  onContexto?: (contexto: ContextoPeriodo) => void
}

type RespuestaFacturas = { clave: string; resultado: Exclude<ResultadoLista<FacturaPeriodo>, { tipo: 'cargando' }> }
type RespuestaRegistro = { clave: string; resultado: Exclude<ResultadoLista<RegistroComprobante>, { tipo: 'cargando' }> }

function causaDe(causa: unknown): 'red' | 'permiso' | 'rango' | 'respuesta' {
  return causa instanceof ErrorConsultaFamilia ? causa.causa : 'red'
}

/**
 * Coordina la consulta por período. Cada respuesta queda atada a (hijo, rango, criterio, intento, recarga):
 * una respuesta tardía —aunque su petición ya se hubiera cancelado— nunca se muestra bajo otro contexto.
 * Las facturas no dependen del criterio de los comprobantes: cambiarlo solo vuelve a pedir los comprobantes.
 */
export function PeriodoContenedor({
  cliente,
  alumnos,
  mostrarSelector,
  contexto,
  onContexto,
}: PeriodoContenedorProps): ReactElement {
  const [interno, setInterno] = useState<ContextoPeriodo>(() => contextoPeriodoVacio())
  const actual = contexto ?? interno
  const cambiar = (parcial: Partial<ContextoPeriodo>) => {
    const siguiente = { ...actual, ...parcial }
    if (onContexto) onContexto(siguiente)
    else setInterno(siguiente)
  }
  const [errores, setErrores] = useState<ErroresRango>({})
  const [recarga, setRecarga] = useState(0)
  const [facturas, setFacturas] = useState<RespuestaFacturas | null>(null)
  const [registro, setRegistro] = useState<RespuestaRegistro | null>(null)

  // El alumno vigente es siempre uno de los autorizados; un vínculo revocado lo reemplaza.
  const alumnoId = useMemo(() => {
    if (alumnos.length === 0) return null
    return alumnos.find(a => a.id === actual.elegido)?.id ?? alumnos[0]?.id ?? null
  }, [alumnos, actual.elegido])

  // La consulta aplicada vale solo para el hijo vigente: si cambió (selección o vínculo revocado), se descarta.
  const consulta = actual.aplicada && actual.aplicada.alumnoId === alumnoId ? actual.aplicada : null

  useEffect(() => {
    const suscripcion = AppState.addEventListener('change', siguiente => {
      if (siguiente === 'active') setRecarga(n => n + 1)
    })
    return () => suscripcion.remove()
  }, [])

  const claveFacturas = consulta ? `${consulta.alumnoId}|${consulta.desde}|${consulta.hasta}|${consulta.intento}|${recarga}` : null
  const claveRegistro = consulta && claveFacturas ? `${claveFacturas}|${consulta.criterio}` : null
  const desdeConsulta = consulta?.desde
  const hastaConsulta = consulta?.hasta
  const alumnoConsulta = consulta?.alumnoId
  const criterioConsulta = consulta?.criterio

  useEffect(() => {
    if (!claveFacturas || !alumnoConsulta || !desdeConsulta || !hastaConsulta) return
    const control = new AbortController()
    let vigente = true
    void consultarFacturasPeriodo(cliente, alumnoConsulta, { desde: desdeConsulta, hasta: hastaConsulta }, control.signal)
      .then(filas => {
        if (vigente) setFacturas({ clave: claveFacturas, resultado: { tipo: 'ok', filas } })
      })
      .catch(causa => {
        if (vigente) setFacturas({ clave: claveFacturas, resultado: { tipo: 'error', causa: causaDe(causa) } })
      })
    return () => {
      vigente = false
      control.abort()
    }
  }, [cliente, claveFacturas, alumnoConsulta, desdeConsulta, hastaConsulta])

  useEffect(() => {
    if (!claveRegistro || !alumnoConsulta || !desdeConsulta || !hastaConsulta || !criterioConsulta) return
    const control = new AbortController()
    let vigente = true
    void consultarRegistroComprobantes(cliente, alumnoConsulta, criterioConsulta, { desde: desdeConsulta, hasta: hastaConsulta }, control.signal)
      .then(filas => {
        if (vigente) setRegistro({ clave: claveRegistro, resultado: { tipo: 'ok', filas } })
      })
      .catch(causa => {
        if (vigente) setRegistro({ clave: claveRegistro, resultado: { tipo: 'error', causa: causaDe(causa) } })
      })
    return () => {
      vigente = false
      control.abort()
    }
  }, [cliente, claveRegistro, alumnoConsulta, desdeConsulta, hastaConsulta, criterioConsulta])

  const resultadoFacturas: ResultadoLista<FacturaPeriodo> =
    facturas && claveFacturas && facturas.clave === claveFacturas ? facturas.resultado : { tipo: 'cargando' }
  const resultadoRegistro: ResultadoLista<RegistroComprobante> =
    registro && claveRegistro && registro.clave === claveRegistro ? registro.resultado : { tipo: 'cargando' }

  const consultar = () => {
    if (!alumnoId) return
    const validado = validarRango(actual.desde, actual.hasta)
    if (!validado.ok) {
      setErrores(validado.errores)
      // Un rango inválido no deja visibles resultados de otro rango.
      cambiar({ aplicada: null })
      return
    }
    setErrores({})
    cambiar({
      aplicada: {
        alumnoId,
        desde: validado.rango.desde,
        hasta: validado.rango.hasta,
        criterio: actual.criterio,
        intento: (actual.aplicada?.intento ?? 0) + 1,
      },
    })
  }

  return (
    <PeriodoVista
      alumnos={alumnos}
      alumnoId={alumnoId}
      mostrarSelector={mostrarSelector}
      desde={actual.desde}
      hasta={actual.hasta}
      criterio={actual.criterio}
      errores={errores}
      consultado={consulta !== null}
      rangoConsultado={consulta ? { desde: consulta.desde, hasta: consulta.hasta } : null}
      facturas={resultadoFacturas}
      registro={resultadoRegistro}
      onSeleccionarAlumno={id => {
        setErrores({})
        // Otro hijo descarta la consulta del anterior: la persona la vuelve a pedir con el rango que ve.
        cambiar({ elegido: id, aplicada: null })
      }}
      onCambiarDesde={texto => { setErrores(e => ({ ...e, desde: undefined, rango: undefined })); cambiar({ desde: formatearEntradaFecha(texto) }) }}
      onCambiarHasta={texto => { setErrores(e => ({ ...e, hasta: undefined, rango: undefined })); cambiar({ hasta: formatearEntradaFecha(texto) }) }}
      onCambiarCriterio={criterio => cambiar({ criterio, aplicada: actual.aplicada ? { ...actual.aplicada, criterio } : null })}
      onConsultar={consultar}
      onReintentar={() => setRecarga(n => n + 1)}
    />
  )
}
