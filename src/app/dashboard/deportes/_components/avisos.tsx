import Link from 'next/link'
import { WarningCircle } from '@phosphor-icons/react'
import { ErrorDeportes } from '@/services/deportes.client'

/**
 * Avisos compartidos por las pantallas de administración de deportes y grupos
 * (EPT-61).
 */

export type AvisoError = {
  texto: string
  /** Sin sesión no hay nada que releer: refrescar llevaría al login y borraría el aviso. */
  sesionVencida: boolean
}

const MENSAJE_SESION_VENCIDA = 'Tu sesión venció. Iniciá sesión nuevamente para continuar.'

/**
 * Traduce lo que falló en un aviso para la persona. Los mensajes del servidor ya
 * llegan en español y sin detalle técnico; cualquier otro fallo usa el respaldo.
 */
export function avisoDeError(problema: unknown, respaldo: string): AvisoError {
  if (problema instanceof ErrorDeportes) {
    return problema.estado === 401
      ? { texto: MENSAJE_SESION_VENCIDA, sesionVencida: true }
      : { texto: problema.message, sesionVencida: false }
  }
  return { texto: respaldo, sesionVencida: false }
}

/** Campo del formulario al que apunta un rechazo del servidor, si lo declara. */
export function campoDeError(problema: unknown): string | undefined {
  return problema instanceof ErrorDeportes ? problema.campo : undefined
}

/**
 * Tras un rechazo se vuelve a leer el estado real —otra pestaña u otra persona
 * pudo cambiarlo—, salvo sin sesión: ahí el aviso ofrece el enlace para volver a
 * entrar y refrescar lo borraría.
 */
export function debeReleer(problema: unknown): boolean {
  return !(problema instanceof ErrorDeportes && problema.estado === 401)
}

export function AlertaError({ aviso }: { aviso: AvisoError | null }) {
  if (!aviso) return null
  return (
    <div
      role="alert"
      className="bg-red-50 border border-red-200 rounded-xl p-3 flex gap-2 items-start text-sm text-red-800"
    >
      <WarningCircle size={18} weight="fill" className="text-red-500 shrink-0 mt-0.5" aria-hidden="true" />
      <div>
        <p>{aviso.texto}</p>
        {aviso.sesionVencida && (
          <Link
            href="/login?redirect=%2Fdashboard%2Fdeportes"
            className="inline-block mt-2 font-semibold underline underline-offset-2"
          >
            Iniciar sesión
          </Link>
        )}
      </div>
    </div>
  )
}
