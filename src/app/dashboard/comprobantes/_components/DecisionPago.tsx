'use client'

import { useRef, useState } from 'react'
import { verificacionPagoSchema, type DecisionPago as Decision, type VerificacionPago } from '@/lib/comprobantes-verificacion'

const BOTON = 'min-h-11 rounded-xl border border-neutral-300 px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:opacity-50'

/** Una decisión por pago. El estado incierto solo permite consultar, no enviar. */
export function DecisionPago({ pagoId, habilitado, estadoInicial, motivoInicial }: {
  pagoId: string; habilitado: boolean; estadoInicial: VerificacionPago['estado']; motivoInicial: string | null
}) {
  const [estado, setEstado] = useState(estadoInicial)
  const [motivoFinal, setMotivoFinal] = useState(motivoInicial)
  const [decision, setDecision] = useState<Decision['decision'] | null>(null)
  const [motivo, setMotivo] = useState('')
  const [fase, setFase] = useState<'listo' | 'procesando' | 'incierto'>('listo')
  const [mensaje, setMensaje] = useState('')
  const vuelo = useRef(false)
  const aviso = useRef<HTMLParagraphElement>(null)
  const accionPrincipal = useRef<HTMLButtonElement>(null)
  const url = `/api/comprobantes/pagos/${pagoId}/verificacion`

  const aplicar = (valor: unknown) => {
    const parsed = verificacionPagoSchema.safeParse(valor)
    if (!parsed.success || parsed.data.pago_id !== pagoId) throw new Error('respuesta inválida')
    setEstado(parsed.data.estado)
    setMotivoFinal(parsed.data.motivo_rechazo)
    setDecision(null)
    setFase('listo')
    setMensaje(parsed.data.estado === 'PENDIENTE_VERIFICACION'
      ? 'El pago continúa pendiente. Puedes revisar y confirmar nuevamente.'
      : `Resultado confirmado: ${parsed.data.estado === 'APROBADO' ? 'aprobado' : 'rechazado'}. Las familias lo verán al actualizar.`)
  }

  async function consultar() {
    if (vuelo.current) return
    vuelo.current = true
    setFase('procesando')
    try {
      const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(30_000) })
      if (!r.ok) throw new Error('consulta no disponible')
      aplicar((await r.json()).resultado)
    } catch {
      setFase('incierto')
      setMensaje('No pudimos consultar el resultado. No vuelvas a decidir hasta confirmar el estado.')
    } finally {
      vuelo.current = false
      aviso.current?.focus()
    }
  }

  async function confirmar() {
    if (vuelo.current || fase !== 'listo' || !decision) return
    vuelo.current = true
    setFase('procesando')
    try {
      const r = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(decision === 'APROBADO' ? { decision } : { decision, motivo }),
        signal: AbortSignal.timeout(30_000),
      })
      const cuerpo = await r.json()
      if (r.ok) aplicar(cuerpo.resultado)
      else if (cuerpo.codigo === 'CONFLICTO') {
        // Nunca ofrece la decisión opuesta sobre un estado finalizado.
        const actual = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(30_000) })
        if (!actual.ok) throw new Error('estado incierto')
        aplicar((await actual.json()).resultado)
      } else if (r.status >= 500) throw new Error('estado incierto')
      else { setFase('listo'); setMensaje(cuerpo.error ?? 'No se pudo verificar el pago.') }
    } catch {
      setFase('incierto')
      setMensaje('Resultado incierto: la decisión puede haberse confirmado. Consulta el estado antes de repetir.')
    } finally {
      vuelo.current = false
      aviso.current?.focus()
    }
  }

  return <section aria-label="Decisión sobre el pago" className="border-t border-neutral-200 pt-4 space-y-3" aria-busy={fase === 'procesando'}>
    {estado === 'PENDIENTE_VERIFICACION' && <p className="text-sm font-semibold text-neutral-800">Pendiente de verificación</p>}
    {estado !== 'PENDIENTE_VERIFICACION' ? <div className="text-sm font-semibold text-neutral-800">
      Pago {estado === 'APROBADO' ? 'aprobado' : 'rechazado'}.
      {motivoFinal && <p className="mt-1 font-normal whitespace-pre-wrap break-words">Motivo: {motivoFinal}</p>}
    </div> : fase === 'incierto' ? <button className={BOTON} onClick={consultar}>Consultar resultado</button>
      : !habilitado ? <p className="text-sm text-neutral-600">La verificación requiere comprobantes y una selección de ítems coherente.</p>
        : <>
          {!decision ? <div className="flex flex-wrap gap-3">
            <button ref={accionPrincipal} disabled={fase === 'procesando'} className={`${BOTON} bg-primary-700 text-white`} onClick={() => setDecision('APROBADO')}>Aprobar pago</button>
            <button disabled={fase === 'procesando'} className={BOTON} onClick={() => setDecision('RECHAZADO')}>Rechazar pago</button>
          </div> : <form onSubmit={e => { e.preventDefault(); void confirmar() }} className="space-y-3">
            <p className="text-sm font-semibold text-neutral-900">{decision === 'APROBADO'
              ? '¿Confirmas la aprobación de este pago? Se pagarán los ítems completos seleccionados, aunque el importe informado sea diferente.'
              : '¿Confirmas el rechazo de este pago? Se liberarán los ítems y el número de operación, sin reducir la deuda.'}</p>
            {decision === 'RECHAZADO' && <div>
              <label className="block text-sm font-semibold" htmlFor={`motivo-${pagoId}`}>Motivo del rechazo</label>
              <textarea autoFocus id={`motivo-${pagoId}`} required value={motivo} disabled={fase === 'procesando'}
                onChange={e => setMotivo(e.target.value)} className="mt-1 w-full rounded-xl border border-neutral-300 p-3 focus-visible:outline-2 focus-visible:outline-primary-500" />
            </div>}
            <div className="flex flex-wrap gap-3">
              <button autoFocus={decision === 'APROBADO'} className={`${BOTON} bg-primary-700 text-white`} disabled={fase === 'procesando' || (decision === 'RECHAZADO' && !motivo.trim())}>
                {fase === 'procesando' ? 'Procesando decisión…' : decision === 'APROBADO' ? 'Confirmar aprobación' : 'Confirmar rechazo'}
              </button>
              <button type="button" className={BOTON} disabled={fase === 'procesando'} onClick={() => {
                setDecision(null)
                requestAnimationFrame(() => accionPrincipal.current?.focus())
              }}>Cancelar</button>
            </div>
          </form>}
        </>}
    <p ref={aviso} tabIndex={-1} role="status" className="text-sm text-neutral-800 whitespace-pre-wrap break-words">{fase === 'procesando' ? 'Consultando o registrando el resultado…' : mensaje}</p>
  </section>
}
