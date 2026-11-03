import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'

import { PantallaConVolver } from '@/catalogo'

import {
  MENSAJE_DESCARTE,
  MENSAJE_PREPARACION,
  normalizarImporteTransferencia,
  validarFechaTransferencia,
  validarNumeroOperacion,
} from '@/compartido/comprobantes-contrato'
import type { AlmacenamientoSeguro } from '@/servicios/almacenamiento-seguro'
import {
  descartarCargaPendiente,
  guardarCargaPendiente,
  leerCargaPendiente,
} from '@/servicios/carga-pendiente'
import {
  consultarCarga,
  finalizarCarga,
  generarClaveCarga,
  listarPagosPendientes,
  prepararCarga,
  type CargaComprobante,
  type PagoPendienteDelPadre,
  type SubirArchivo,
} from '@/servicios/comprobantes'
import type { ArchivoElegido, ResultadoSeleccion, SelectorArchivos } from '@/servicios/selector-archivos'
import type { ClienteEPT } from '@/servicios/supabase'
import type { TransporteHttp } from '@/servicios/transporte-http'

import {
  EnviandoComprobanteVista,
  FormularioComprobanteVista,
  ListaPagosVista,
  ResultadoComprobanteVista,
  type CargaPagos,
  type ErroresCampos,
  type EtapaEnvio,
} from './ComprobanteVistas'

export type FaseComprobante = 'edicion' | 'enviando' | 'confirmado' | 'rechazado' | 'incierto'

/**
 * Estado completo del flujo. Es serializable y vive en el contexto de la pantalla: una revalidación de la
 * sesión remonta el contenedor y NO debe devolver al padre a un formulario vacío ni perder el resultado de
 * un envío en vuelo (misma garantía que EPT-108).
 */
export interface EstadoComprobante {
  /** `null`: se está eligiendo el pago. */
  pagoId: string | null
  archivo: ArchivoElegido | null
  fecha: string
  importe: string
  numero: string
  /** Clave del intento en curso; se conserva ante un desenlace incierto para reintentar de forma idempotente. */
  claveCarga: string | null
  fase: FaseComprobante
  etapa: EtapaEnvio | null
  progreso: number
  carga: CargaComprobante | null
  mensaje: string | null
  /** Aviso de la última selección de archivo; vive acá para no perderse si la pantalla se remonta. */
  aviso: { tipo: 'advertencia' | 'error'; mensaje: string } | null
}

export const COMPROBANTE_VACIO: EstadoComprobante = {
  pagoId: null,
  archivo: null,
  fecha: '',
  importe: '',
  numero: '',
  claveCarga: null,
  fase: 'edicion',
  etapa: null,
  progreso: 0,
  carga: null,
  mensaje: null,
  aviso: null,
}

export interface ComprobanteContenedorProps {
  cliente: ClienteEPT
  /** Cuenta autenticada: acota la lectura y la recuperación; nunca se mezcla con otra. */
  usuarioId: string
  /** Hijo del contexto; el padre de esta pantalla remonta el contenedor al cambiar de hijo o de cuenta. */
  alumnoId: string
  etiquetaAlumno: string
  almacenamiento: AlmacenamientoSeguro
  transporte: TransporteHttp
  selector: SelectorArchivos
  subir: SubirArchivo
  /** Si se informa, el estado es controlado desde afuera (se conserva entre revalidaciones). */
  estado?: EstadoComprobante
  onEstado?: (estado: EstadoComprobante) => void
  /** Vuelve a las cuotas. `huboCambios` indica que el listado debe recargarse. */
  onVolver: (huboCambios: boolean) => void
  /** Solo para pruebas. */
  generarClave?: () => string
}

/** Teclado numérico: deja solo dígitos y arma `DD/MM/AAAA` mientras se escribe (máximo 8 dígitos). */
export function mascaraFecha(texto: string): string {
  const d = texto.replace(/\D/gu, '').slice(0, 8)
  if (d.length <= 2) return d
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`
}

/** `DD/MM/AAAA` (o ya `AAAA-MM-DD`) → `AAAA-MM-DD` validado. */
function fechaIso(texto: string): { ok: true; valor: string } | { ok: false; mensaje: string } {
  const t = texto.trim()
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/u.exec(t)
  const iso = m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : t
  const r = validarFechaTransferencia(iso)
  return r.ok
    ? { ok: true, valor: r.valor }
    : { ok: false, mensaje: 'La fecha no es válida. Usá el formato DD/MM/AAAA.' }
}

const MENSAJE_SIN_SESION = 'Tu sesión venció. Volvé a iniciar sesión e intentá nuevamente.'
const MENSAJE_SUBIDA = 'No pudimos subir el archivo. Revisá tu conexión e intentá nuevamente.'

/**
 * Coordina la carga de un comprobante. Reglas:
 *  - el archivo y los datos se validan con el mismo contrato que el servidor, pero la autoridad es el servidor;
 *  - un solo envío en vuelo: el doble toque no duplica;
 *  - un desenlace incierto no permite otro envío hasta consultar la carga (misma clave: idempotente);
 *  - jamás se borra ni se reemplaza un archivo ya confirmado;
 *  - una respuesta atrasada nunca se aplica a otro hijo ni a otra cuenta.
 */
export function ComprobanteContenedor(props: ComprobanteContenedorProps): ReactElement {
  const {
    cliente, usuarioId, alumnoId, etiquetaAlumno, almacenamiento, transporte, selector, subir, onVolver,
    generarClave = generarClaveCarga,
  } = props

  const [interno, setInterno] = useState<EstadoComprobante>(COMPROBANTE_VACIO)
  const estado = props.estado ?? interno
  const estadoRef = useRef(estado)
  const onEstadoRef = useRef(props.onEstado)
  useEffect(() => {
    estadoRef.current = estado
  }, [estado])
  useEffect(() => {
    onEstadoRef.current = props.onEstado
  }, [props.onEstado])

  /** Aplica un cambio parcial. Seguro tras un remontaje: usa el último estado conocido. */
  const publicar = useCallback((parcial: Partial<EstadoComprobante>) => {
    const siguiente = { ...estadoRef.current, ...parcial }
    estadoRef.current = siguiente
    if (onEstadoRef.current) onEstadoRef.current(siguiente)
    else setInterno(siguiente)
  }, [])

  const contexto = `${usuarioId}:${alumnoId}`
  const contextoRef = useRef(contexto)
  useEffect(() => {
    contextoRef.current = contexto
  }, [contexto])
  const enviandoRef = useRef(false)
  // Un remontaje (revalidación de sesión) no debe perder que ya se confirmó un comprobante.
  const huboConfirmacionRef = useRef(estado.fase === 'confirmado')
  /**
   * Token del intento vigente. Se invalida al volver atrás o al cambiar de cuenta/hijo: una operación en
   * vuelo termina su trabajo (servidor, almacenamiento) pero ya no escribe en la pantalla.
   */
  const intentoRef = useRef(0)
  useEffect(() => {
    intentoRef.current += 1
  }, [contexto])
  const publicarSi = useCallback(
    (token: number, parcial: Partial<EstadoComprobante>) => {
      if (intentoRef.current === token) publicar(parcial)
    },
    [publicar],
  )
  const reiniciar = useCallback(() => {
    intentoRef.current += 1
    publicar({ ...COMPROBANTE_VACIO })
  }, [publicar])

  const [errores, setErrores] = useState<ErroresCampos>({})
  const avisoSeleccion = estado.aviso
  const setAvisoSeleccion = useCallback((aviso: EstadoComprobante['aviso']) => publicar({ aviso }), [publicar])
  const [recarga, setRecarga] = useState(0)
  const [pagos, setPagos] = useState<
    { contexto: string; recarga: number; datos: PagoPendienteDelPadre[] | null } | null
  >(null)

  useEffect(() => {
    const control = new AbortController()
    let vigente = true
    void listarPagosPendientes(cliente, usuarioId, alumnoId, control.signal)
      .then(datos => {
        if (vigente) setPagos({ contexto, recarga, datos })
      })
      .catch(() => {
        if (vigente) setPagos({ contexto, recarga, datos: null })
      })
    return () => {
      vigente = false
      control.abort()
    }
  }, [cliente, usuarioId, alumnoId, contexto, recarga])

  const cargaPagos: CargaPagos = useMemo(() => {
    if (!pagos || pagos.contexto !== contexto || pagos.recarga !== recarga) return { tipo: 'cargando' }
    return pagos.datos ? { tipo: 'ok', pagos: pagos.datos } : { tipo: 'error' }
  }, [pagos, contexto, recarga])

  const pagoElegido =
    estado.pagoId && cargaPagos.tipo === 'ok' ? (cargaPagos.pagos.find(p => p.pagoId === estado.pagoId) ?? null) : null

  // ---- Selección del archivo -----------------------------------------------------------------------
  const elegir = useCallback(
    async (accion: () => Promise<ResultadoSeleccion>) => {
      if (enviandoRef.current) return
      const dueno = contextoRef.current
      setAvisoSeleccion(null)
      const r = await accion()
      if (contextoRef.current !== dueno) return
      switch (r.tipo) {
        case 'elegido':
          setErrores(e => ({ ...e, archivo: undefined }))
          // Un archivo distinto es otro contenido: la clave del intento anterior ya no le corresponde.
          publicar({ archivo: r.archivo, claveCarga: null, fase: 'edicion', mensaje: null })
          break
        case 'cancelado':
          break
        case 'permiso_denegado':
          setAvisoSeleccion({
            tipo: 'advertencia',
            mensaje: r.puedePreguntar
              ? 'Necesitamos permiso para usar la cámara. Podés elegir una imagen o un archivo en su lugar.'
              : 'El permiso de la cámara está denegado. Habilitalo en los Ajustes del teléfono o elegí una imagen o un archivo.',
          })
          break
        case 'sin_camara':
          setAvisoSeleccion({
            tipo: 'advertencia',
            mensaje: 'Este dispositivo no tiene una cámara disponible. Elegí una imagen o un archivo.',
          })
          break
        case 'invalido':
          setAvisoSeleccion({ tipo: 'error', mensaje: r.mensaje })
          break
        default:
          setAvisoSeleccion({ tipo: 'error', mensaje: 'No pudimos leer el archivo. Probá con otro.' })
      }
    },
    [publicar, setAvisoSeleccion],
  )

  // ---- Envío -----------------------------------------------------------------------------------------
  const resolverCarga = useCallback(
    async (carga: CargaComprobante, token: number): Promise<void> => {
      const publicar = (parcial: Partial<EstadoComprobante>) => publicarSi(token, parcial)
      const actual = estadoRef.current
      const archivo = actual.archivo
      const olvidar = () => descartarCargaPendiente(almacenamiento, usuarioId, carga.pagoId, carga.claveCarga)

      if (carga.estado === 'CONFIRMADA') {
        await olvidar()
        huboConfirmacionRef.current = true
        publicar({ fase: 'confirmado', etapa: null, carga, mensaje: null, progreso: 1 })
        return
      }
      if (carga.estado === 'DESCARTADA' || carga.estado === 'EXPIRADA') {
        await olvidar()
        const motivo = carga.motivoDescarte ?? 'ABANDONADA'
        publicar({
          fase: 'rechazado',
          etapa: null,
          claveCarga: null,
          mensaje: MENSAJE_DESCARTE[motivo] ?? 'La carga fue descartada.',
        })
        return
      }
      if (!archivo) {
        // Recuperada sin archivo local: no se puede volver a subir; se vuelve a elegir.
        publicar({
          fase: 'edicion',
          etapa: null,
          mensaje: 'Volvé a elegir el archivo para completar el envío.',
        })
        return
      }

      // Una subida por intento y, si el servidor aún no lo ve, una segunda (el objeto no se reemplaza).
      for (let intento = 0; intento < 2; intento += 1) {
        publicar({ etapa: 'subiendo', progreso: 0 })
        let ultimo = -1
        const subida = await subir({
          bucket: carga.bucketTemporal,
          ruta: carga.rutaTemporal,
          archivo: { uri: archivo.uri, tipoMime: archivo.tipo, tamanoBytes: archivo.tamanoBytes },
          onProgreso: fraccion => {
            const paso = Math.floor(fraccion * 20)
            if (paso !== ultimo) {
              ultimo = paso
              publicar({ progreso: fraccion })
            }
          },
        })
        if (subida.tipo === 'rechazada' && (subida.estado === 401 || subida.estado === 403)) {
          publicar({ fase: 'rechazado', etapa: null, mensaje: MENSAJE_SIN_SESION })
          return
        }
        // Otro rechazo (p. ej. «ya existe» por un intento anterior que sí subió el objeto, que no se
        // reemplaza): no se declara fallo desde acá; el servidor es quien sabe si el objeto está.
        publicar({ etapa: 'verificando', progreso: 1 })
        const fin = await finalizarCarga(transporte, carga.cargaId)
        if (fin.tipo === 'confirmada') {
          await olvidar()
          huboConfirmacionRef.current = true
          publicar({ fase: 'confirmado', etapa: null, carga: fin.carga, mensaje: null, progreso: 1 })
          return
        }
        if (fin.tipo === 'rechazada') {
          await olvidar()
          publicar({ fase: 'rechazado', etapa: null, claveCarga: null, mensaje: fin.mensaje })
          return
        }
        if (fin.tipo === 'incierto') {
          publicar({ fase: 'incierto', etapa: null })
          return
        }
        // 'no_subido': reintenta la subida una vez.
      }
      publicar({ fase: 'rechazado', etapa: null, mensaje: MENSAJE_SUBIDA })
    },
    [almacenamiento, publicarSi, subir, transporte, usuarioId],
  )

  const enviar = useCallback(async () => {
    if (enviandoRef.current) return
    const actual = estadoRef.current
    const pago = pagoElegido
    if (!pago || !actual.archivo) return

    // Validación de campos con el contrato compartido.
    const nuevos: ErroresCampos = {}
    let datos: { fecha: string; importe: string; numero: string } | null = null
    if (!pago.datosTransferencia) {
      const f = fechaIso(actual.fecha)
      const i = normalizarImporteTransferencia(actual.importe)
      const n = validarNumeroOperacion(actual.numero)
      if (!f.ok) nuevos.fecha = f.mensaje
      if (!i.ok) nuevos.importe = i.mensaje
      if (!n.ok) nuevos.numero = n.mensaje
      if (f.ok && i.ok && n.ok) datos = { fecha: f.valor, importe: i.valor, numero: n.valor }
    }
    setErrores(nuevos)
    if (Object.keys(nuevos).length > 0) return

    enviandoRef.current = true // bloquea el doble toque antes de que React publique el estado
    const clave = actual.claveCarga ?? generarClave()
    const token = intentoRef.current
    const publicar = (parcial: Partial<EstadoComprobante>) => publicarSi(token, parcial)
    try {
      publicar({ fase: 'enviando', etapa: 'preparando', progreso: 0, claveCarga: clave, mensaje: null })
      try {
        await guardarCargaPendiente(almacenamiento, {
          usuarioId,
          pagoId: pago.pagoId,
          claveCarga: clave,
          cargaId: null,
          creadaEn: new Date().toISOString(),
        })
      } catch {
        // Sin almacenamiento la recuperación solo vive en memoria; el envío sigue siendo idempotente.
      }

      const prep = await prepararCarga(cliente, {
        claveCarga: clave,
        pagoId: pago.pagoId,
        tipoMime: actual.archivo.tipo,
        tamanoBytes: actual.archivo.tamanoBytes,
        datos,
      })
      if (prep.tipo === 'rechazada') {
        await descartarCargaPendiente(almacenamiento, usuarioId, pago.pagoId, clave)
        publicar({
          fase: 'rechazado',
          etapa: null,
          // Una clave ya usada con otros datos no se reutiliza.
          claveCarga: null,
          mensaje: MENSAJE_PREPARACION[prep.codigo],
        })
        return
      }
      let carga: CargaComprobante | null = prep.tipo === 'preparada' ? prep.carga : null
      if (prep.tipo === 'incierto') {
        const c = await consultarCarga(cliente, clave)
        if (c.tipo === 'registrada') carga = c.carga
        else {
          publicar({ fase: 'incierto', etapa: null })
          return
        }
      }
      if (!carga) return
      try {
        await guardarCargaPendiente(almacenamiento, {
          usuarioId,
          pagoId: pago.pagoId,
          claveCarga: clave,
          cargaId: carga.cargaId,
          creadaEn: new Date().toISOString(),
        })
      } catch {
        // idem
      }
      await resolverCarga(carga, token)
    } finally {
      enviandoRef.current = false
    }
  }, [almacenamiento, cliente, generarClave, pagoElegido, publicarSi, resolverCarga, usuarioId])

  const verificar = useCallback(async () => {
    if (enviandoRef.current || estadoRef.current.fase !== 'incierto') return
    const clave = estadoRef.current.claveCarga
    if (!clave) return
    enviandoRef.current = true
    const dueno = contextoRef.current
    const token = intentoRef.current
    const publicar = (parcial: Partial<EstadoComprobante>) => publicarSi(token, parcial)
    try {
      publicar({ fase: 'incierto', mensaje: 'verificando' })
      const c = await consultarCarga(cliente, clave)
      if (contextoRef.current !== dueno) return
      if (c.tipo === 'registrada') {
        // Si hay que terminar la subida, la pantalla vuelve a mostrar el progreso y bloquea el formulario.
        publicar({ fase: 'enviando', etapa: 'preparando', progreso: 0, mensaje: null })
        await resolverCarga(c.carga, token)
      } else if (c.tipo === 'no_registrada') {
        // El servidor no la conoce: nada quedó registrado. Se puede reenviar con la misma clave.
        publicar({
          fase: 'edicion',
          etapa: null,
          mensaje: 'El envío anterior no llegó a registrarse. Podés volver a enviarlo.',
        })
      } else {
        publicar({ fase: 'incierto', mensaje: 'fallo' })
      }
    } finally {
      enviandoRef.current = false
    }
  }, [cliente, publicarSi, resolverCarga])

  // Recuperación de una carga incierta de una sesión anterior de ESTA cuenta.
  useEffect(() => {
    const pagoId = estado.pagoId
    if (!pagoId || estado.fase !== 'edicion' || estado.claveCarga) return
    let vigente = true
    void leerCargaPendiente(almacenamiento, usuarioId, pagoId).then(pendiente => {
      if (!vigente || !pendiente) return
      publicar({ claveCarga: pendiente.claveCarga, fase: 'incierto', etapa: null, mensaje: null })
    })
    return () => {
      vigente = false
    }
    // Solo al elegir el pago.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [almacenamiento, usuarioId, estado.pagoId])

  /**
   * Un dato distinto es otro contenido: la clave del intento anterior ya no le corresponde (el servidor
   * respondería «clave usada con otros datos»). El intento previo queda para vencer solo.
   */
  const editarCampo = useCallback(
    (parcial: Partial<Pick<EstadoComprobante, 'fecha' | 'importe' | 'numero'>>) => {
      const actual = estadoRef.current
      if (actual.claveCarga && actual.fase === 'edicion' && actual.pagoId) {
        void descartarCargaPendiente(almacenamiento, usuarioId, actual.pagoId, actual.claveCarga)
        publicar({ ...parcial, claveCarga: null })
        return
      }
      publicar(parcial)
    },
    [almacenamiento, publicar, usuarioId],
  )

  const volverACuotas = useCallback(() => {
    onVolver(huboConfirmacionRef.current)
  }, [onVolver])

  // ---- Presentación ----------------------------------------------------------------------------------
  const enviando = estado.fase === 'enviando'

  // Flecha y gesto de «volver»: del formulario al listado de pagos y, desde ahí o desde un resultado, a las
  // cuotas. Durante un envío en vuelo no hacen nada (el botón «Volver» del formulario también está bloqueado).
  const atras = () => (estado.pagoId && estado.fase === 'edicion' ? reiniciar() : volverACuotas())
  const conVolver = (pantalla: ReactElement): ReactElement => (
    <PantallaConVolver onVolver={atras} deshabilitado={enviando}>
      {pantalla}
    </PantallaConVolver>
  )

  if (!estado.pagoId) {
    return conVolver(
      <ListaPagosVista
        etiquetaAlumno={etiquetaAlumno}
        carga={cargaPagos}
        onElegir={pagoId => {
          setErrores({})
          setAvisoSeleccion(null)
          publicar({ ...COMPROBANTE_VACIO, pagoId })
        }}
        onVolver={volverACuotas}
        onReintentar={() => setRecarga(n => n + 1)}
      />
    )
  }

  if (estado.fase === 'confirmado' && estado.carga) {
    return conVolver(
      <ResultadoComprobanteVista
        resultado={{ tipo: 'confirmado', carga: estado.carga }}
        onAdjuntarOtro={() => {
          setRecarga(n => n + 1)
          // El pago conserva su identidad; archivo y clave son nuevos (los datos ya están informados).
          publicar({ ...COMPROBANTE_VACIO, pagoId: estado.pagoId })
        }}
        onVerificar={() => undefined}
        onReintentar={() => undefined}
        onVolverACuotas={volverACuotas}
      />
    )
  }

  if (estado.fase === 'rechazado') {
    return conVolver(
      <ResultadoComprobanteVista
        resultado={{ tipo: 'rechazado', mensaje: estado.mensaje ?? 'No se pudo registrar el comprobante.' }}
        onAdjuntarOtro={() => undefined}
        onVerificar={() => undefined}
        onReintentar={() => publicar({ fase: 'edicion', etapa: null, mensaje: null })}
        onVolverACuotas={volverACuotas}
      />
    )
  }

  if (estado.fase === 'incierto') {
    return conVolver(
      <ResultadoComprobanteVista
        resultado={{
          tipo: 'incierto',
          verificando: estado.mensaje === 'verificando',
          fallo: estado.mensaje === 'fallo',
        }}
        onAdjuntarOtro={() => undefined}
        onVerificar={() => void verificar()}
        onReintentar={() => undefined}
        onVolverACuotas={volverACuotas}
      />
    )
  }

  // Mientras se envía, una pantalla de carga reemplaza al formulario (el estado vive en el contexto).
  if (enviando && estado.etapa) {
    return conVolver(<EnviandoComprobanteVista etapa={estado.etapa} progreso={estado.progreso} />)
  }

  if (cargaPagos.tipo !== 'ok' || !pagoElegido) {
    return conVolver(
      <ListaPagosVista
        etiquetaAlumno={etiquetaAlumno}
        carga={cargaPagos.tipo === 'ok' ? { tipo: 'ok', pagos: [] } : cargaPagos}
        onElegir={() => undefined}
        onVolver={reiniciar}
        onReintentar={() => setRecarga(n => n + 1)}
      />
    )
  }

  return conVolver(
    <FormularioComprobanteVista
      etiquetaAlumno={etiquetaAlumno}
      pago={pagoElegido}
      fecha={estado.fecha}
      importe={estado.importe}
      numero={estado.numero}
      errores={errores}
      archivo={estado.archivo}
      avisoSeleccion={avisoSeleccion}
      enviando={enviando}
      etapa={enviando ? estado.etapa : null}
      progreso={estado.progreso}
      mensaje={estado.fase === 'edicion' ? estado.mensaje : null}
      onCambiarFecha={v => editarCampo({ fecha: mascaraFecha(v) })}
      onCambiarImporte={v => editarCampo({ importe: v })}
      onCambiarNumero={v => editarCampo({ numero: v })}
      onTomarFoto={() => void elegir(() => selector.tomarFoto())}
      onElegirImagen={() => void elegir(() => selector.elegirImagen())}
      onElegirArchivo={() => void elegir(() => selector.elegirArchivo())}
      onQuitarArchivo={() => publicar({ archivo: null, claveCarga: null, mensaje: null })}
      onEnviar={() => void enviar()}
      onVolver={reiniciar}
    />
  )
}
