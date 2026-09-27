'use client'

import { useState } from 'react'
import { Info } from '@phosphor-icons/react'
import { Button } from '@/components/ui/Button'
import { Dialogo } from '@/components/ui/Dialogo'
import { Select } from '@/components/ui/Input'
import { mensajeParaMostrar } from '@/lib/errores'
import { ROLES } from '@/lib/utils'
import { MOTIVO_CAMBIO_MAXIMO, MOTIVO_CAMBIO_MINIMO } from '@/lib/validations'
import { cambiarRol, ErrorDeUsuarios, type CambioDeRol } from '@/services/usuarios-admin.client'
import { CampoMotivo, motivoValido } from './CampoMotivo'

const TITULO_ID = 'titulo-cambio-rol'
const MENSAJE_FALLO = 'No pudimos cambiar el rol. Volvé a intentarlo en unos minutos.'

/**
 * Diálogo «Cambiar rol» (EPT-59).
 *
 * Envía como `rol_esperado` el rol que la pantalla mostraba: si otra persona
 * lo cambió mientras tanto, la base responde 409 sin tocar nada y quien llama
 * recarga el detalle. ESTUDIANTE no se ofrece: depende del legajo académico y
 * la base rechaza esa transición en cualquier sentido.
 */
export function DialogoCambioRol({
  perfilId,
  rolActual,
  puedeSerDirector,
  onCerrar,
  onCambiado,
  onObsoleto,
}: {
  perfilId: string
  rolActual: string | null
  /** DIRECTOR solo se ofrece a quien ya tiene una cuenta confirmada. */
  puedeSerDirector: boolean
  onCerrar: () => void
  onCambiado: (cambio: CambioDeRol) => void
  onObsoleto: (mensaje: string) => void
}) {
  const [rolNuevo, setRolNuevo] = useState('')
  const [motivo, setMotivo] = useState('')
  const [errorRol, setErrorRol] = useState<string | null>(null)
  const [errorMotivo, setErrorMotivo] = useState<string | null>(null)
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const opciones = ROLES.filter(
    (rol) => rol !== rolActual && rol !== 'ESTUDIANTE' && (rol !== 'DIRECTOR' || puedeSerDirector)
  ).map((rol) => ({
    value: rol,
    label: rol,
  }))

  async function confirmar(evento: React.FormEvent) {
    evento.preventDefault()
    if (enviando) return
    const sinRol = !rolNuevo
    const motivoMal = !motivoValido(motivo)
    setErrorRol(sinRol ? 'Elegí el rol nuevo.' : null)
    setErrorMotivo(
      motivoMal
        ? `Escribí un motivo de entre ${MOTIVO_CAMBIO_MINIMO} y ${MOTIVO_CAMBIO_MAXIMO} caracteres.`
        : null
    )
    setErrorGeneral(null)
    if (sinRol || motivoMal) return

    setEnviando(true)
    try {
      const cambio = await cambiarRol(perfilId, rolActual, rolNuevo, motivo)
      onCambiado(cambio)
    } catch (error) {
      const mensaje = mensajeParaMostrar(error, MENSAJE_FALLO)
      if (error instanceof ErrorDeUsuarios && error.codigo === 'VALOR_OBSOLETO') {
        onObsoleto(mensaje)
        return
      }
      if (error instanceof ErrorDeUsuarios && error.codigo === 'MOTIVO_INVALIDO') {
        setErrorMotivo(mensaje)
      } else {
        setErrorGeneral(mensaje)
      }
      setEnviando(false)
    }
  }

  return (
    <Dialogo
      tituloId={TITULO_ID}
      titulo="Cambiar rol"
      selectorFocoInicial={`#${TITULO_ID}`}
      tituloEnfocable
      onCerrar={() => {
        if (!enviando) onCerrar()
      }}
    >
      <form onSubmit={confirmar} noValidate className="space-y-4">
        <p className="text-sm text-neutral-700">
          Rol actual: <strong className="font-semibold text-neutral-900">{rolActual ?? 'Sin rol'}</strong>
        </p>
        <Select
          id="rol-nuevo"
          label="Rol nuevo"
          required
          placeholder="Seleccionar rol"
          options={opciones}
          value={rolNuevo}
          onChange={(evento) => setRolNuevo(evento.target.value)}
          error={errorRol ?? undefined}
          disabled={enviando}
        />
        <div className="rounded-xl border border-brand-200 bg-brand-50 p-3 flex gap-2 items-start">
          <Info size={18} weight="fill" className="text-brand-700 shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-sm text-brand-900">
            El rol ESTUDIANTE no se asigna ni se quita desde acá: depende del legajo académico y se
            gestiona desde Alumnos.
            {!puedeSerDirector && rolActual !== 'DIRECTOR' &&
              ' El rol DIRECTOR solo se asigna a una persona con cuenta confirmada.'}
          </p>
        </div>
        <CampoMotivo
          id="motivo-cambio-rol"
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
          <Button type="submit" loading={enviando}>
            Confirmar cambio de rol
          </Button>
        </div>
      </form>
    </Dialogo>
  )
}
