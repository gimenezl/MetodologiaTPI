'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { decodificarPixeles, leerCuadro } from '@/lib/accesos-qr/decodificar'

/**
 * Cámara del escáner de accesos (EPT-65). Solo navegador.
 *
 * Reglas que cumple:
 *  - La cámara se inicia SOLO por un gesto (`iniciar` la llama un clic).
 *  - Contexto seguro obligatorio (HTTPS o localhost): sin él, no se intenta.
 *  - El permiso pendiente tiene tiempo máximo: si el aviso del navegador no se
 *    responde, el estado pasa a `tiempo` y, si más tarde se concediera, la pista
 *    se suelta enseguida.
 *  - TODAS las pistas se detienen al obtener un resultado, al ocultarse la
 *    pestaña, al cambiar de modo (`detener`), al fallar y al desmontar.
 *  - Los cuadros se decodifican en el dispositivo y se descartan: no se suben,
 *    no se guardan y no se loguean.
 */

export type EstadoCamara =
  | 'inactiva'
  | 'solicitando'
  | 'activa'
  | 'denegada'
  | 'sin-camara'
  | 'insegura'
  | 'tiempo'
  | 'error'

/** Espera máxima de la respuesta al aviso de permiso del navegador. */
export const TIEMPO_PERMISO_MS = 20_000
const INTERVALO_DE_CUADROS_MS = 120

function estadoPorError(error: unknown): EstadoCamara {
  const nombre = (error as { name?: string } | null)?.name ?? ''
  if (nombre === 'NotAllowedError' || nombre === 'SecurityError' || nombre === 'PermissionDeniedError') {
    return 'denegada'
  }
  if (nombre === 'NotFoundError' || nombre === 'OverconstrainedError' || nombre === 'DevicesNotFoundError') {
    return 'sin-camara'
  }
  return 'error'
}

export function useCamaraQr({ alLeer }: { alLeer: (texto: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const flujoRef = useRef<MediaStream | null>(null)
  const temporizadorRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Cada inicio o parada invalida los bucles y promesas anteriores.
  const generacionRef = useRef(0)
  const alLeerRef = useRef(alLeer)
  const [estado, setEstado] = useState<EstadoCamara>('inactiva')

  useEffect(() => {
    alLeerRef.current = alLeer
  }, [alLeer])

  const liberar = useCallback(() => {
    if (temporizadorRef.current) clearTimeout(temporizadorRef.current)
    temporizadorRef.current = null
    flujoRef.current?.getTracks().forEach((pista) => pista.stop())
    flujoRef.current = null
    const video = videoRef.current
    if (video) {
      video.pause()
      video.srcObject = null
    }
  }, [])

  const detener = useCallback(() => {
    generacionRef.current += 1
    liberar()
    setEstado('inactiva')
  }, [liberar])

  const iniciar = useCallback(async () => {
    generacionRef.current += 1
    const generacion = generacionRef.current
    liberar()

    if (!window.isSecureContext) {
      setEstado('insegura')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setEstado('sin-camara')
      return
    }

    setEstado('solicitando')

    // Una excepción síncrona del navegador se trata igual que un rechazo: nunca deja la pantalla esperando.
    const pedido = (async () =>
      navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      }))()
    let vencido = false
    let reloj: ReturnType<typeof setTimeout> | undefined
    const limite = new Promise<'tiempo'>((resolver) => {
      reloj = setTimeout(() => {
        vencido = true
        resolver('tiempo')
      }, TIEMPO_PERMISO_MS)
    })

    let flujo: MediaStream
    try {
      const ganador = await Promise.race([pedido, limite])
      if (ganador === 'tiempo') {
        // Si el permiso se concede después, la pista no queda abierta.
        pedido.then((tardio) => tardio.getTracks().forEach((pista) => pista.stop())).catch(() => undefined)
        if (generacion === generacionRef.current) setEstado('tiempo')
        return
      }
      flujo = ganador
    } catch (error) {
      if (generacion === generacionRef.current) setEstado(estadoPorError(error))
      return
    } finally {
      if (reloj && !vencido) clearTimeout(reloj)
    }

    // Cambió de modo, se detuvo o se desmontó mientras esperaba: no se usa.
    if (generacion !== generacionRef.current) {
      flujo.getTracks().forEach((pista) => pista.stop())
      return
    }

    flujoRef.current = flujo
    const video = videoRef.current
    if (!video) {
      liberar()
      setEstado('error')
      return
    }

    let relojDeReproduccion: ReturnType<typeof setTimeout> | undefined
    try {
      video.srcObject = flujo
      // Un video que no arranca (modo de bajo consumo, cámara tomada por otra app) no debe dejar la
      // pantalla esperando para siempre.
      await Promise.race([
        video.play(),
        new Promise<never>((_, rechazar) => {
          relojDeReproduccion = setTimeout(() => rechazar(new Error('reproducción sin respuesta')), TIEMPO_PERMISO_MS)
        }),
      ])
    } catch {
      if (generacion === generacionRef.current) {
        liberar()
        setEstado('error')
      }
      return
    } finally {
      if (relojDeReproduccion) clearTimeout(relojDeReproduccion)
    }
    if (generacion !== generacionRef.current) return
    setEstado('activa')

    const cuadro = async () => {
      if (generacion !== generacionRef.current) return
      const imagen = leerCuadro(video)
      if (imagen) {
        const texto = await decodificarPixeles(imagen)
        if (generacion !== generacionRef.current) return
        if (texto) {
          // Resultado: se sueltan TODAS las pistas antes de seguir.
          generacionRef.current += 1
          liberar()
          setEstado('inactiva')
          alLeerRef.current(texto)
          return
        }
      }
      temporizadorRef.current = setTimeout(cuadro, INTERVALO_DE_CUADROS_MS)
    }
    temporizadorRef.current = setTimeout(cuadro, INTERVALO_DE_CUADROS_MS)
  }, [liberar])

  // Ocultar la pestaña o salir de la página detiene la cámara.
  useEffect(() => {
    const alCambiarVisibilidad = () => {
      if (document.hidden) detener()
    }
    document.addEventListener('visibilitychange', alCambiarVisibilidad)
    window.addEventListener('pagehide', detener)
    return () => {
      document.removeEventListener('visibilitychange', alCambiarVisibilidad)
      window.removeEventListener('pagehide', detener)
    }
  }, [detener])

  // Desmontar libera todo.
  useEffect(() => {
    return () => {
      generacionRef.current += 1
      liberar()
    }
  }, [liberar])

  return { videoRef, estado, iniciar, detener }
}
