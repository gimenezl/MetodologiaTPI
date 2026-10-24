import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { AppState } from 'react-native'

import {
  ErrorConsultaFamilia,
  formatearEntradaFecha,
  validarRango,
  type CausaConsulta,
  type ErroresRango,
  type RangoValidado,
} from '@/servicios/consultas-familia'
import {
  consultarDeudaItems,
  type GrupoDeuda,
  type ItemDeuda,
  type TotalesDeuda,
} from '@/servicios/deuda-items'
import type { ClienteEPT } from '@/servicios/supabase'

import type { AlumnoSelector } from '../cuotas/CuotasVista'
import { DeudaVista, type DatosDeuda, type EstadoDeuda } from './DeudaVista'

/** Consulta ya aplicada: lo que se pidió, no lo que se está escribiendo. `rango = null` es todo el historial. */
export interface ConsultaDeudaAplicada {
  alumnoId: string
  rango: RangoValidado | null
  /** Se incrementa en cada «Aplicar filtro»: separa dos consultas con los mismos parámetros. */
  intento: number
}

export interface ContextoDeuda {
  elegido: string | null
  /** Texto de los campos (`DD/MM/AAAA`). Ambos vacíos = todo el historial. */
  desde: string
  hasta: string
  aplicada: ConsultaDeudaAplicada | null
}

export const CONTEXTO_DEUDA_VACIO: ContextoDeuda = { elegido: null, desde: '', hasta: '', aplicada: null }

export interface DeudaContenedorProps {
  cliente: ClienteEPT
  /** Alumnos que el actor puede consultar. El servidor vuelve a decidirlo en cada lectura. */
  alumnos: AlumnoSelector[]
  /** Solo el padre ve el selector de hijos. */
  mostrarSelector: boolean
  contexto?: ContextoDeuda
  onContexto?: (contexto: ContextoDeuda) => void
}

interface Acumulado {
  filas: ItemDeuda[]
  grupos: GrupoDeuda[]
  totales: TotalesDeuda
  total: number
  pagina: number
  huella: string
  fechaCorte: string
}

type Resultado =
  | { clave: string; tipo: 'ok'; acumulado: Acumulado; actualizado: boolean }
  | { clave: string; tipo: 'error'; causa: CausaConsulta }

function causaDe(causa: unknown): CausaConsulta {
  return causa instanceof ErrorConsultaFamilia ? causa.causa : 'red'
}

/**
 * Coordina el historial de deuda por ítem. Cada respuesta queda atada a (hijo, rango, intento, recarga): una
 * respuesta tardía —aunque su petición ya se hubiera cancelado— nunca se muestra bajo otro contexto. Las páginas
 * siguientes llevan la huella de la primera: si el servidor avisa que el contenido cambió, se descarta lo
 * acumulado y se vuelve a la primera página en lugar de mezclar versiones.
 */
export function DeudaContenedor({ cliente, alumnos, mostrarSelector, contexto, onContexto }: DeudaContenedorProps): ReactElement {
  const [interno, setInterno] = useState<ContextoDeuda>(CONTEXTO_DEUDA_VACIO)
  const actual = contexto ?? interno
  const cambiar = (parcial: Partial<ContextoDeuda>) => {
    const siguiente = { ...actual, ...parcial }
    if (onContexto) onContexto(siguiente)
    else setInterno(siguiente)
  }
  const [errores, setErrores] = useState<ErroresRango>({})
  const [recarga, setRecarga] = useState(0)
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const [cargandoMas, setCargandoMas] = useState<string | null>(null)
  // Ambos están atados a la clave del contexto: un cambio de hijo, filtro o recarga los invalida solos.
  const [falloMas, setFalloMas] = useState<string | null>(null)

  // El alumno vigente es siempre uno de los autorizados; un vínculo revocado lo reemplaza.
  const alumnoId = useMemo(() => {
    if (alumnos.length === 0) return null
    return alumnos.find(a => a.id === actual.elegido)?.id ?? alumnos[0]?.id ?? null
  }, [alumnos, actual.elegido])

  // La consulta aplicada vale solo para el hijo vigente. Sin ella se muestra todo el historial.
  const aplicada = actual.aplicada && actual.aplicada.alumnoId === alumnoId ? actual.aplicada : null
  const rango = aplicada?.rango ?? null
  const desdeConsulta = rango?.desde
  const hastaConsulta = rango?.hasta
  const intento = aplicada?.intento ?? 0
  const clave = alumnoId ? `${alumnoId}|${desdeConsulta ?? '-'}|${hastaConsulta ?? '-'}|${intento}|${recarga}` : null
  const claveVigente = useRef<string | null>(null)
  const controlMas = useRef<AbortController | null>(null)
  useEffect(() => {
    claveVigente.current = clave
  }, [clave])

  useEffect(() => {
    const suscripcion = AppState.addEventListener('change', siguiente => {
      if (siguiente === 'active') setRecarga(n => n + 1)
    })
    return () => suscripcion.remove()
  }, [])

  // Primera página: se pide al entrar, al cambiar de hijo, al aplicar un filtro y al reanudar la app.
  useEffect(() => {
    if (!clave || !alumnoId) return
    const rangoPedido = desdeConsulta && hastaConsulta ? { desde: desdeConsulta, hasta: hastaConsulta } : null
    const control = new AbortController()
    let vigente = true
    void consultarDeudaItems(cliente, alumnoId, rangoPedido, 1, null, control.signal)
      .then(respuesta => {
        if (!vigente) return
        if (respuesta.tipo !== 'pagina') throw new ErrorConsultaFamilia('respuesta', 'Respuesta inválida: huella en la primera página.')
        setResultado({
          clave,
          tipo: 'ok',
          actualizado: false,
          acumulado: {
            filas: respuesta.filas, grupos: respuesta.grupos, totales: respuesta.totales, total: respuesta.total,
            pagina: respuesta.pagina, huella: respuesta.huella, fechaCorte: respuesta.fechaCorte,
          },
        })
      })
      .catch(causa => {
        if (vigente) setResultado({ clave, tipo: 'error', causa: causaDe(causa) })
      })
    return () => {
      vigente = false
      control.abort()
    }
  }, [cliente, clave, alumnoId, desdeConsulta, hastaConsulta])

  // Un cambio de contexto cancela la carga de la página siguiente que estuviera en vuelo.
  useEffect(() => () => controlMas.current?.abort(), [clave])

  const vigenteResultado = resultado && clave && resultado.clave === clave ? resultado : null

  const cargarMas = useCallback(() => {
    if (!clave || !alumnoId || !vigenteResultado || vigenteResultado.tipo !== 'ok') return
    const { acumulado } = vigenteResultado
    if (acumulado.filas.length >= acumulado.total || cargandoMas === clave) return
    const siguiente = acumulado.pagina + 1
    const rangoPedido = desdeConsulta && hastaConsulta ? { desde: desdeConsulta, hasta: hastaConsulta } : null
    controlMas.current?.abort()
    const control = new AbortController()
    controlMas.current = control
    setCargandoMas(clave)
    setFalloMas(null)
    void consultarDeudaItems(cliente, alumnoId, rangoPedido, siguiente, acumulado.huella, control.signal)
      .then(respuesta => {
        // Una respuesta tardía de otro contexto (o de una petición reemplazada) nunca se mezcla.
        if (control.signal.aborted || claveVigente.current !== clave) return
        setCargandoMas(null)
        if (respuesta.tipo === 'actualizado') {
          // El contenido cambió: la clave nueva descarta lo acumulado y vuelve a la primera página.
          setRecarga(n => n + 1)
          return
        }
        const vistos = new Set(acumulado.filas.map(f => f.itemId))
        if (respuesta.filas.some(f => vistos.has(f.itemId)) || respuesta.total !== acumulado.total) {
          throw new ErrorConsultaFamilia('respuesta', 'La deuda cambió durante la consulta.')
        }
        setResultado({
          clave,
          tipo: 'ok',
          actualizado: false,
          acumulado: { ...acumulado, filas: [...acumulado.filas, ...respuesta.filas], pagina: respuesta.pagina },
        })
      })
      .catch(causa => {
        if (control.signal.aborted || claveVigente.current !== clave) return
        setCargandoMas(null)
        setFalloMas(clave)
      })
  }, [cliente, clave, alumnoId, vigenteResultado, cargandoMas, desdeConsulta, hastaConsulta])

  const aplicarFiltro = () => {
    if (!alumnoId) return
    if (actual.desde === '' && actual.hasta === '') {
      setErrores({})
      cambiar({ aplicada: { alumnoId, rango: null, intento: (actual.aplicada?.intento ?? 0) + 1 } })
      return
    }
    const validado = validarRango(actual.desde, actual.hasta)
    if (!validado.ok) {
      setErrores(validado.errores)
      return
    }
    setErrores({})
    cambiar({ aplicada: { alumnoId, rango: validado.rango, intento: (actual.aplicada?.intento ?? 0) + 1 } })
  }

  let estado: EstadoDeuda
  if (!vigenteResultado) estado = { tipo: 'cargando' }
  else if (vigenteResultado.tipo === 'error') estado = { tipo: 'error', causa: vigenteResultado.causa }
  else {
    const datos: DatosDeuda = {
      ...vigenteResultado.acumulado,
      cargandoMas: cargandoMas === clave,
      falloMas: falloMas === clave,
    }
    estado = { tipo: 'ok', datos }
  }

  return (
    <DeudaVista
      alumnos={alumnos}
      alumnoId={alumnoId}
      mostrarSelector={mostrarSelector}
      desde={actual.desde}
      hasta={actual.hasta}
      errores={errores}
      rangoAplicado={rango}
      estado={estado}
      onSeleccionarAlumno={id => {
        setErrores({})
        // Otro hijo descarta el filtro del anterior: nada se hereda entre estudiantes.
        cambiar({ elegido: id, aplicada: null, desde: '', hasta: '' })
      }}
      onCambiarDesde={texto => { setErrores(e => ({ ...e, desde: undefined, rango: undefined })); cambiar({ desde: formatearEntradaFecha(texto) }) }}
      onCambiarHasta={texto => { setErrores(e => ({ ...e, hasta: undefined, rango: undefined })); cambiar({ hasta: formatearEntradaFecha(texto) }) }}
      onAplicarFiltro={aplicarFiltro}
      onVerTodo={() => {
        setErrores({})
        cambiar({ desde: '', hasta: '', aplicada: alumnoId ? { alumnoId, rango: null, intento: (actual.aplicada?.intento ?? 0) + 1 } : null })
      }}
      onCargarMas={cargarMas}
      onReintentar={() => setRecarga(n => n + 1)}
    />
  )
}
