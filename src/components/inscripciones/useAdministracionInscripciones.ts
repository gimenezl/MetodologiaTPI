'use client'

import { useCallback, useEffect, useRef, useState, useTransition, type RefObject } from 'react'
import { useRouter } from 'next/navigation'
import type { DominioInscripcion } from '@/lib/validations'
import {
  cancelarInscripcionAdministrativaRemota,
  confirmarInscripcionRemota,
  type ResultadoRemotoInscripciones,
} from '@/services/inscripciones-administracion.client'
import { fechaHora, nombrePersona } from './formato'

/** Aviso que la pantalla anuncia a la persona después de una operación. */
export type Aviso = {
  tipo: 'exito' | 'info' | 'error'
  texto: string
  /** La sesión venció: se ofrece volver a iniciar sesión. */
  iniciarSesion?: boolean
}

export type OperacionEnCurso = { id: string; operacion: 'confirmar' | 'cancelar' }

/** Lo mínimo que hace falta saber de una fila para operarla y explicarla. */
export type ObjetivoOperacion = {
  id: string
  alumno: string
  /** «Comedor escolar», «Fútbol · Primario turno mañana». Vacío para matrículas. */
  descripcion: string
}

const NOMBRE_DEL_OBJETO: Record<DominioInscripcion, string> = {
  matriculas: 'la matrícula',
  deportes: 'la inscripción',
  comedor: 'la inscripción',
  transporte: 'la inscripción',
}

/**
 * Traduce un fallo del servidor en el aviso que ve la persona.
 *
 * 401 invita a iniciar sesión; 403 (incluida la cuenta bloqueada), 404 y 409
 * (rechazo por concurrencia o por estado) traen su mensaje de dominio; un fallo
 * de red o un 500 se explican sin detalle técnico y con la opción de reintentar.
 */
export function avisoDeFallo(
  fallo: Extract<ResultadoRemotoInscripciones<unknown>, { ok: false }>,
  accion: string
): Aviso {
  if (fallo.estado === 401) {
    return {
      tipo: 'error',
      texto: 'Tu sesión venció. Iniciá sesión nuevamente para continuar.',
      iniciarSesion: true,
    }
  }
  return { tipo: 'error', texto: `${accion} ${fallo.mensaje}` }
}

/** Estados en los que lo que se ve en pantalla quedó viejo y conviene volver a leer. */
function convieneReleer(estado: number) {
  return estado === 404 || estado === 409
}

/**
 * Operaciones administrativas sobre una inscripción o una matrícula (EPT-62).
 *
 * - Un cerrojo con `ref` impide el doble envío aun dentro del mismo cuadro de
 *   renderizado; el estado `enCurso` es solo para la presentación.
 * - Cada operación viaja por la API del servidor; este hook nunca escribe en la
 *   base. Tras un éxito, o tras un rechazo por estado viejo, vuelve a leer con
 *   `router.refresh()` para que la pantalla muestre lo que quedó persistido.
 * - `confirmar` deja su aviso en la pantalla. `cancelar` devuelve el aviso de
 *   error para que lo muestre el diálogo abierto y, si tuvo éxito, deja el aviso
 *   de éxito en la pantalla y devuelve `null`.
 */
export function useAdministracionInscripciones(dominio: DominioInscripcion) {
  const router = useRouter()
  const [refrescando, iniciarRefresco] = useTransition()
  const [enCurso, setEnCurso] = useState<OperacionEnCurso | null>(null)
  const [aviso, setAviso] = useState<Aviso | null>(null)
  const [foco, setFoco] = useState<string | null>(null)
  const tomado = useRef(false)

  const limpiarFoco = useCallback(() => setFoco(null), [])

  const releer = useCallback(() => {
    iniciarRefresco(() => router.refresh())
  }, [router])

  const confirmar = useCallback(
    async (objetivo: ObjetivoOperacion) => {
      if (tomado.current) return
      tomado.current = true
      setEnCurso({ id: objetivo.id, operacion: 'confirmar' })
      setAviso(null)
      try {
        const resultado = await confirmarInscripcionRemota(dominio, objetivo.id)
        const objeto = NOMBRE_DEL_OBJETO[dominio]

        if (!resultado.ok) {
          setAviso(avisoDeFallo(resultado, `No pudimos confirmar ${objeto} de ${objetivo.alumno}.`))
          if (convieneReleer(resultado.estado)) {
            setFoco(objetivo.id)
            releer()
          }
          return
        }

        const { ya_confirmada, confirmada_por_nombre, confirmada_en } = resultado.datos
        if (ya_confirmada) {
          const por = nombrePersona(confirmada_por_nombre, null)
          setAviso({
            tipo: 'info',
            texto:
              `Ya estaba confirmada${por ? ` por ${por}` : ''} el ${fechaHora(confirmada_en)}. ` +
              `${objeto.charAt(0).toLocaleUpperCase('es-AR')}${objeto.slice(1)} de ${objetivo.alumno} no se modificó.`,
          })
        } else {
          setAviso({ tipo: 'exito', texto: `Confirmaste ${objeto} de ${objetivo.alumno}.` })
        }
        setFoco(objetivo.id)
        releer()
      } finally {
        tomado.current = false
        setEnCurso(null)
      }
    },
    [dominio, releer]
  )

  const cancelar = useCallback(
    async (objetivo: ObjetivoOperacion): Promise<Aviso | null> => {
      if (tomado.current) return null
      tomado.current = true
      setEnCurso({ id: objetivo.id, operacion: 'cancelar' })
      setAviso(null)
      try {
        const resultado = await cancelarInscripcionAdministrativaRemota(dominio, objetivo.id)
        if (!resultado.ok) {
          if (convieneReleer(resultado.estado)) releer()
          return avisoDeFallo(resultado, `No pudimos cancelar la inscripción de ${objetivo.alumno}.`)
        }
        setAviso({
          tipo: 'exito',
          texto:
            `Cancelaste la inscripción de ${objetivo.alumno}` +
            `${objetivo.descripcion ? ` en ${objetivo.descripcion}` : ''}. ` +
            'Se conserva en el historial y el alumno podrá volver a inscribirse.',
        })
        setFoco(objetivo.id)
        releer()
        return null
      } finally {
        tomado.current = false
        setEnCurso(null)
      }
    },
    [dominio, releer]
  )

  return {
    aviso,
    enCurso,
    /** `true` mientras una operación está en vuelo o la pantalla se está releyendo. */
    ocupado: enCurso !== null || refrescando,
    refrescando,
    /** Fila a la que hay que devolver el foco cuando termine de releerse. */
    foco,
    limpiarFoco,
    confirmar,
    cancelar,
  }
}

/**
 * Devuelve el foco a la fila operada cuando termina de releerse.
 *
 * Al confirmar, el botón desaparece del DOM y el foco caería al `<body>`: la
 * persona perdería su lugar. Se busca el elemento marcado con
 * `data-foco-inscripcion="<id>"` (el visible, porque tabla y tarjetas conviven en
 * el DOM) y, si la fila ya no está a la vista —se canceló y el filtro muestra
 * solo las activas—, el foco queda en la región de la lista.
 */
export function useDevolverFoco(
  region: RefObject<HTMLElement | null>,
  estado: { refrescando: boolean; foco: string | null; limpiarFoco: () => void }
) {
  const { refrescando, foco, limpiarFoco } = estado
  const estabaRefrescando = useRef(false)

  useEffect(() => {
    if (refrescando) {
      estabaRefrescando.current = true
      return
    }
    if (!estabaRefrescando.current || foco === null) return
    estabaRefrescando.current = false
    const visible = Array.from(
      document.querySelectorAll<HTMLElement>('[data-foco-inscripcion]')
    ).find((elemento) => elemento.dataset.focoInscripcion === foco && elemento.offsetParent !== null)
    ;(visible ?? region.current)?.focus()
    limpiarFoco()
  }, [refrescando, foco, limpiarFoco, region])
}
