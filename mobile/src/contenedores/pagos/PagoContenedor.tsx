import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'

import { EstadoPantalla } from '@/catalogo'
import type { AlmacenamientoSeguro } from '@/servicios/almacenamiento-seguro'
import {
  descartarIntentoPendiente,
  guardarIntentoPendiente,
  leerIntentoPendiente,
} from '@/servicios/intento-pago'
import {
  cargarItemsPagables,
  consultarDatosBancarios,
  consultarIntentoPago,
  cotizarPago,
  generarClaveIntento,
  registrarPago,
  seleccionCanonica,
  type CodigoRechazo,
  type DatosBancarios,
  type GrupoFactura,
  type PagoRegistrado,
  type ResultadoCotizacion,
} from '@/servicios/pagos'
import type { ClienteEPT } from '@/servicios/supabase'

import {
  PagoResultadoVista,
  PagoSeleccionVista,
  type CargaItems,
  type EstadoBanco,
  type EstadoCotizacion,
} from './PagoVistas'

export interface AlumnoPago {
  id: string
  etiqueta: string
}

export interface PagoContenedorProps {
  cliente: ClienteEPT
  /** Cuenta autenticada: acota la recuperación de un intento y nunca se mezcla con otra. */
  usuarioId: string
  /** Hijo del contexto. El padre de esta pantalla remonta el contenedor al cambiar de hijo o de cuenta. */
  alumnoId: string
  alumnos: AlumnoPago[]
  almacenamiento: AlmacenamientoSeguro
  /** Vuelve a las cuotas. `huboCambios` indica que el listado debe recargarse. */
  onVolver: (huboCambios: boolean) => void
  /** Solo para pruebas: generador de la clave del intento. */
  generarClave?: () => string
}

interface Intento {
  alumnoId: string
  clave: string
  itemIds: string[]
  totalCentavos: number
}

type Fase =
  | { tipo: 'seleccion' }
  | { tipo: 'enviando'; intento: Intento }
  | { tipo: 'registrado'; pago: PagoRegistrado }
  | { tipo: 'rechazado'; codigo: CodigoRechazo }
  | { tipo: 'incierto'; intento: Intento; verificando: boolean; fallo: boolean }
  | { tipo: 'no_registrado'; intento: Intento }

type Cotizado = { clave: string; recarga: number; resultado: ResultadoCotizacion }

/**
 * Coordina la selección y el registro del pago. Reglas:
 *  - el total es siempre el del servidor y está atado a la selección exacta que lo originó;
 *  - un solo envío en vuelo: el doble toque no duplica;
 *  - un desenlace incierto no permite otro envío hasta consultar el intento (misma clave: idempotente);
 *  - volver o cancelar antes de confirmar no escribe nada; después de confirmar, no libera nada;
 *  - una respuesta atrasada nunca se aplica a otro hijo ni a otra cuenta.
 */
export function PagoContenedor({
  cliente,
  usuarioId,
  alumnoId,
  alumnos,
  almacenamiento,
  onVolver,
  generarClave = generarClaveIntento,
}: PagoContenedorProps): ReactElement {
  const etiquetaAlumno = alumnos.find(a => a.id === alumnoId)?.etiqueta ?? 'Estudiante'
  const contexto = `${usuarioId}:${alumnoId}`
  const contextoRef = useRef(contexto)
  useEffect(() => {
    contextoRef.current = contexto
  }, [contexto])
  const enviandoRef = useRef(false)
  const huboRegistroRef = useRef(false)

  const [fase, setFase] = useState<Fase>({ tipo: 'seleccion' })
  const [seleccion, setSeleccion] = useState<string[]>([])
  const [recarga, setRecarga] = useState(0)
  const [recargaBanco, setRecargaBanco] = useState(0)
  const [recargaCotizacion, setRecargaCotizacion] = useState(0)
  const [items, setItems] = useState<{ contexto: string; recarga: number; grupos: GrupoFactura[] | null } | null>(null)
  const [banco, setBanco] = useState<{ contexto: string; recarga: number; datos: DatosBancarios | null } | null>(null)
  const [cotizado, setCotizado] = useState<Cotizado | null>(null)
  const [lectura, setLectura] = useState<'cargando' | 'listo'>('cargando')

  // Recuperación: un intento previo sin resolver de ESTA cuenta (nunca de otra).
  useEffect(() => {
    let vigente = true
    void leerIntentoPendiente(almacenamiento, usuarioId, alumnoId).then(intento => {
      if (!vigente) return
      if (intento) {
        setFase({
          tipo: 'incierto',
          intento: { alumnoId: intento.alumnoId, clave: intento.claveIntento, itemIds: intento.itemIds, totalCentavos: intento.totalCentavos },
          verificando: false,
          fallo: false,
        })
      }
      setLectura('listo')
    })
    return () => {
      vigente = false
    }
  }, [almacenamiento, usuarioId, alumnoId])

  useEffect(() => {
    const control = new AbortController()
    let vigente = true
    void cargarItemsPagables(cliente, alumnoId, control.signal)
      .then(grupos => {
        if (vigente) setItems({ contexto, recarga, grupos })
      })
      .catch(() => {
        if (vigente) setItems({ contexto, recarga, grupos: null })
      })
    return () => {
      vigente = false
      control.abort()
    }
  }, [cliente, alumnoId, contexto, recarga])

  useEffect(() => {
    const control = new AbortController()
    let vigente = true
    void consultarDatosBancarios(cliente, control.signal)
      .then(datos => {
        if (vigente) setBanco({ contexto, recarga: recargaBanco, datos })
      })
      .catch(() => {
        if (vigente) setBanco({ contexto, recarga: recargaBanco, datos: null })
      })
    return () => {
      vigente = false
      control.abort()
    }
  }, [cliente, contexto, recargaBanco])

  const carga = useMemo<CargaItems>(
    () =>
      items && items.contexto === contexto && items.recarga === recarga
        ? items.grupos
          ? { tipo: 'ok', grupos: items.grupos }
          : { tipo: 'error' }
        : { tipo: 'cargando' },
    [items, contexto, recarga],
  )

  // Solo cuentan los ítems que siguen siendo seleccionables en la lectura vigente.
  const idsVigentes = useMemo(() => {
    if (carga.tipo !== 'ok') return []
    const permitidos = new Set(carga.grupos.flatMap(g => g.items.filter(i => i.motivo === null).map(i => i.itemId)))
    return seleccionCanonica(seleccion.filter(id => permitidos.has(id)))
  }, [carga, seleccion])
  const claveSeleccion = idsVigentes.join(',')

  useEffect(() => {
    if (idsVigentes.length === 0 || fase.tipo !== 'seleccion') return
    const control = new AbortController()
    let vigente = true
    void cotizarPago(cliente, idsVigentes, control.signal).then(resultado => {
      if (vigente) setCotizado({ clave: claveSeleccion, recarga: recargaCotizacion, resultado })
    })
    return () => {
      vigente = false
      control.abort()
    }
    // `idsVigentes` se resume en `claveSeleccion`: una selección idéntica no recotiza.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cliente, claveSeleccion, recargaCotizacion, fase.tipo])

  const estadoCotizacion: EstadoCotizacion = (() => {
    if (idsVigentes.length === 0) return { tipo: 'sin_seleccion' }
    if (!cotizado || cotizado.clave !== claveSeleccion || cotizado.recarga !== recargaCotizacion) return { tipo: 'cargando' }
    const r = cotizado.resultado
    if (r.tipo === 'ok') return { tipo: 'ok', totalCentavos: r.cotizacion.totalCentavos }
    if (r.tipo === 'rechazada') return { tipo: 'rechazada', codigo: r.codigo }
    return { tipo: 'error' }
  })()

  const estadoBanco: EstadoBanco =
    banco && banco.contexto === contexto && banco.recarga === recargaBanco
      ? banco.datos
        ? { tipo: 'ok', datos: banco.datos }
        : { tipo: 'error' }
      : { tipo: 'cargando' }

  const alternar = useCallback(
    (itemId: string) => {
      if (fase.tipo !== 'seleccion') return
      setSeleccion(actual => (actual.includes(itemId) ? actual.filter(id => id !== itemId) : [...actual, itemId]))
    },
    [fase.tipo],
  )

  const enviar = useCallback(
    async (intento: Intento) => {
      if (enviandoRef.current) return
      enviandoRef.current = true
      const dueno = contextoRef.current
      setFase({ tipo: 'enviando', intento })
      try {
        const resultado = await registrarPago(cliente, intento.clave, intento.itemIds, intento.totalCentavos)
        if (resultado.tipo === 'registrado' || resultado.tipo === 'rechazado') {
          await descartarIntentoPendiente(almacenamiento, usuarioId, intento.alumnoId, intento.clave)
        }
        // Una respuesta de otro contexto no se muestra: la recuperación persiste en el almacenamiento seguro.
        if (contextoRef.current !== dueno) return
        if (resultado.tipo === 'registrado') {
          huboRegistroRef.current = true
          setFase({ tipo: 'registrado', pago: resultado.pago })
        } else if (resultado.tipo === 'rechazado') {
          setFase({ tipo: 'rechazado', codigo: resultado.codigo })
        } else {
          setFase({ tipo: 'incierto', intento, verificando: false, fallo: false })
        }
      } finally {
        enviandoRef.current = false
      }
    },
    [almacenamiento, cliente, usuarioId],
  )

  const registrar = useCallback(async () => {
    if (enviandoRef.current || fase.tipo !== 'seleccion') return
    if (estadoCotizacion.tipo !== 'ok' || idsVigentes.length === 0) return
    const intento: Intento = {
      alumnoId,
      clave: generarClave(),
      itemIds: idsVigentes,
      totalCentavos: estadoCotizacion.totalCentavos,
    }
    enviandoRef.current = true // bloquea el doble toque antes de que React publique el estado
    try {
      await guardarIntentoPendiente(almacenamiento, {
        usuarioId,
        alumnoId,
        claveIntento: intento.clave,
        itemIds: intento.itemIds,
        totalCentavos: intento.totalCentavos,
        creadoEn: new Date().toISOString(),
      })
    } catch {
      // Sin almacenamiento la recuperación solo vive en memoria; el envío sigue siendo idempotente.
    }
    enviandoRef.current = false
    await enviar(intento)
  }, [alumnoId, almacenamiento, enviar, estadoCotizacion, fase.tipo, generarClave, idsVigentes, usuarioId])

  const verificar = useCallback(async () => {
    if (fase.tipo !== 'incierto' || fase.verificando) return
    const { intento } = fase
    const dueno = contextoRef.current
    setFase({ tipo: 'incierto', intento, verificando: true, fallo: false })
    const resultado = await consultarIntentoPago(cliente, intento.clave)
    if (contextoRef.current !== dueno) return
    if (resultado.tipo === 'registrado') {
      await descartarIntentoPendiente(almacenamiento, usuarioId, intento.alumnoId, intento.clave)
      huboRegistroRef.current = true
      setFase({ tipo: 'registrado', pago: resultado.pago })
    } else if (resultado.tipo === 'no_registrado') {
      setFase({ tipo: 'no_registrado', intento })
    } else {
      setFase({ tipo: 'incierto', intento, verificando: false, fallo: true })
    }
  }, [almacenamiento, cliente, fase, usuarioId])

  const volverASeleccion = useCallback(() => {
    setSeleccion([])
    setCotizado(null)
    setFase({ tipo: 'seleccion' })
    setRecarga(n => n + 1)
    setRecargaCotizacion(n => n + 1)
  }, [])

  if (lectura === 'cargando') return <EstadoPantalla tipo="cargando" mensaje="Comprobando pagos pendientes…" />

  if (fase.tipo === 'seleccion' || fase.tipo === 'enviando') {
    return (
      <>
        <PagoSeleccionVista
          etiquetaAlumno={etiquetaAlumno}
          carga={carga}
          seleccion={new Set(idsVigentes)}
          cotizacion={estadoCotizacion}
          banco={estadoBanco}
          registrando={fase.tipo === 'enviando'}
          onToggle={alternar}
          onRegistrar={() => void registrar()}
          onVolver={() => onVolver(huboRegistroRef.current)}
          onReintentarCarga={() => setRecarga(n => n + 1)}
          onReintentarCotizacion={() => setRecargaCotizacion(n => n + 1)}
          onReintentarBanco={() => setRecargaBanco(n => n + 1)}
        />
      </>
    )
  }

  return (
    <PagoResultadoVista
      etiquetaAlumno={etiquetaAlumno}
      resultado={
        fase.tipo === 'registrado'
          ? { tipo: 'registrado', pago: fase.pago }
          : fase.tipo === 'rechazado'
            ? { tipo: 'rechazado', codigo: fase.codigo }
            : fase.tipo === 'no_registrado'
              ? { tipo: 'no_registrado' }
              : { tipo: 'incierto', verificando: fase.verificando, fallo: fase.fallo }
      }
      onVolverACuotas={() => onVolver(huboRegistroRef.current)}
      onVolverASeleccion={volverASeleccion}
      onVerificar={() => void verificar()}
      onReintentarMismoIntento={() => {
        if (fase.tipo === 'no_registrado') void enviar(fase.intento)
      }}
    />
  )
}
