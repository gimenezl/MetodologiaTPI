'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialogo } from '@/components/ui/Dialogo'
import { mensajeParaMostrar } from '@/lib/errores'
import { MOTIVO_CAMBIO_MAXIMO, MOTIVO_CAMBIO_MINIMO } from '@/lib/validations'
import { cambiarAcceso, ErrorDeUsuarios, type CambioDeAcceso } from '@/services/usuarios-admin.client'
import { CampoMotivo, motivoValido } from './CampoMotivo'

const TITULO_ID = 'titulo-cambio-acceso'
const MENSAJE_FALLO = 'No pudimos cambiar el acceso. Volvé a intentarlo en unos minutos.'

/**
 * Confirmación de «Bloquear acceso» o «Reactivar acceso» (EPT-59).
 *
 * El orden entre la base y la cuenta de ingreso lo decide el servidor. Un
 * bloqueo cuya cuenta no se pudo sincronizar vuelve con
 * `auth_sincronizado: false`: la base ya niega todo y la pantalla ofrece
 * reintentar la sincronización.
 */
export function DialogoAcceso({
  perfilId,
  estadoActual,
  nombre,
  onCerrar,
  onCambiado,
  onObsoleto,
}: {
  perfilId: string
  estadoActual: 'HABILITADO' | 'BLOQUEADO'
  nombre: string
  onCerrar: () => void
  onCambiado: (cambio: CambioDeAcceso) => void
  onObsoleto: (mensaje: string) => void
}) {
  const bloquear = estadoActual === 'HABILITADO'
  const [motivo, setMotivo] = useState('')
  const [errorMotivo, setErrorMotivo] = useState<string | null>(null)
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function confirmar(evento: React.FormEvent) {
    evento.preventDefault()
    if (enviando) return
    setErrorGeneral(null)
    if (!motivoValido(motivo)) {
      setErrorMotivo(
        `Escribí un motivo de entre ${MOTIVO_CAMBIO_MINIMO} y ${MOTIVO_CAMBIO_MAXIMO} caracteres.`
      )
      return
    }
    setErrorMotivo(null)
    setEnviando(true)
    try {
      const cambio = await cambiarAcceso(
        perfilId,
        estadoActual,
        bloquear ? 'BLOQUEADO' : 'HABILITADO',
        motivo
      )
      onCambiado(cambio)
    } catch (error) {
      const mensaje = mensajeParaMostrar(error, MENSAJE_FALLO)
      if (error instanceof ErrorDeUsuarios && error.codigo === 'VALOR_OBSOLETO') {
        onObsoleto(mensaje)
        return
      }
      if (error instanceof ErrorDeUsuarios && error.codigo === 'MOTIVO_INVALIDO') setErrorMotivo(mensaje)
      else setErrorGeneral(mensaje)
      setEnviando(false)
    }
  }

  return (
    <Dialogo
      tituloId={TITULO_ID}
      titulo={bloquear ? 'Bloquear acceso' : 'Reactivar acceso'}
      selectorFocoInicial={`#${TITULO_ID}`}
      tituloEnfocable
      onCerrar={() => {
        if (!enviando) onCerrar()
      }}
    >
      <form onSubmit={confirmar} noValidate className="space-y-4">
        <p className="text-sm text-neutral-700 leading-relaxed">
          {bloquear ? (
            <>
              <strong className="font-semibold text-neutral-900">{nombre}</strong> dejará de ver los
              datos del panel de inmediato y no podrá volver a ingresar hasta que Dirección reactive
              su acceso. Sus datos, su rol y su historial se conservan.
            </>
          ) : (
            <>
              <strong className="font-semibold text-neutral-900">{nombre}</strong> podrá volver a
              ingresar con su cuenta y ver lo que corresponde a su rol.
            </>
          )}
        </p>
        <CampoMotivo
          id="motivo-cambio-acceso"
          valor={motivo}
          onCambio={setMotivo}
          error={errorMotivo}
          disabled={enviando}
        />
        <div role="alert" aria-live="assertive" className="empty:hidden">
          {errorGeneral && (
            <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {errorGeneral}
            </p>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onCerrar} disabled={enviando}>
            Cancelar
          </Button>
          <Button type="submit" loading={enviando} variant={bloquear ? 'peligro' : 'primary'}>
            {bloquear ? 'Confirmar bloqueo' : 'Confirmar reactivación'}
          </Button>
        </div>
      </form>
    </Dialogo>
  )
}
