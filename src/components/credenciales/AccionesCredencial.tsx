'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowsClockwise, Prohibit, QrCode } from '@phosphor-icons/react'
import { Button } from '@/components/ui/Button'
import { Dialogo } from '@/components/ui/Dialogo'
import {
  emitirCredencialRemota,
  reponerCredencialRemota,
  revocarCredencialRemota,
  type ResultadoRemotoCredencial,
} from '@/services/credenciales-qr.client'
import type { TarjetaCredencial } from '@/lib/credenciales-qr/tipos'

/**
 * Acciones de Dirección sobre la credencial de un alumno (EPT-64).
 *
 * Esta botonera NO es una frontera de seguridad: la ruta solo se monta para
 * Dirección, pero cada operación vuelve a exigir el rol en el servidor y en
 * PostgreSQL. Emitir es siempre un clic explícito: la ausencia de credencial
 * jamás dispara una emisión.
 *
 * Reponer y revocar viajan con el identificador de la credencial que Dirección
 * VE. Si otra operación ya la cambió, el servidor responde 409 y esta pieza
 * pide actualizar la pantalla en lugar de reemplazar por error la credencial nueva.
 */

type Accion = 'reponer' | 'revocar'

const CONFIGURACION: Record<
  Accion,
  { titulo: string; descripcion: string; confirmar: string; exito: string }
> = {
  reponer: {
    titulo: 'Reponer credencial',
    descripcion:
      'La credencial actual se revoca y se emite una nueva en el mismo paso. La anterior deja de valer para siempre; su historial se conserva.',
    confirmar: 'Reponer credencial',
    exito: 'Credencial repuesta. La anterior quedó revocada.',
  },
  revocar: {
    titulo: 'Revocar credencial',
    descripcion:
      'La credencial deja de valer para siempre y no se puede restaurar. Después podés emitir una nueva. Su historial se conserva.',
    confirmar: 'Revocar credencial',
    exito: 'Credencial revocada.',
  },
}

export function AccionesCredencial({ tarjeta }: { tarjeta: TarjetaCredencial }) {
  const router = useRouter()
  const [pendiente, iniciarTransicion] = useTransition()
  const [enviando, setEnviando] = useState(false)
  const [accion, setAccion] = useState<Accion | null>(null)
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [desactualizada, setDesactualizada] = useState(false)
  const areaMotivo = useRef<HTMLTextAreaElement>(null)
  // Safari no da foco a un botón al hacer clic: `document.activeElement` sería <body> al
  // abrir el diálogo. Se recuerda el disparador para devolverle el foco al cerrar.
  const disparador = useRef<HTMLElement | null>(null)
  // Espejo síncrono de `enviando`: el diálogo guarda `onCerrar` en un efecto y, si Escape llega
  // entre el render y ese efecto, vería un valor viejo. La referencia nunca está desactualizada.
  const enviandoRef = useRef(false)

  function marcarEnvio(valor: boolean) {
    enviandoRef.current = valor
    setEnviando(valor)
  }

  const alumnoId = tarjeta.alumno.id
  const credencialId = tarjeta.credencial && tarjeta.estado !== 'REVOCADA' ? tarjeta.credencial.id : null
  const ocupado = enviando || pendiente
  // Espejo de la regla de la base (P5627): con el alumno inactivo no se emite ni se repone.
  // Revocar sigue disponible. La base decide; esto solo evita ofrecer lo que falla.
  const emisible = tarjeta.alumno.estado === 'ACTIVO'

  function refrescar(texto: string) {
    setAviso(texto)
    iniciarTransicion(() => router.refresh())
  }

  function tratarFallo(resultado: Extract<ResultadoRemotoCredencial, { ok: false }>) {
    setError(resultado.mensaje)
    if (resultado.codigo === 'CREDENCIAL_NO_VIGENTE' || resultado.codigo === 'CREDENCIAL_YA_ACTIVA') {
      setDesactualizada(true)
    }
  }

  async function emitir() {
    marcarEnvio(true)
    setError(null)
    setAviso(null)
    const resultado = await emitirCredencialRemota(alumnoId)
    marcarEnvio(false)
    if (!resultado.ok) return tratarFallo(resultado)
    refrescar('Credencial emitida.')
  }

  function abrir(siguiente: Accion, evento: React.MouseEvent<HTMLButtonElement>) {
    disparador.current = evento.currentTarget
    setAccion(siguiente)
    setMotivo('')
    setError(null)
    setAviso(null)
  }

  /** Cierra sin operar y devuelve el foco al botón que abrió el diálogo. */
  function cerrarSinOperar() {
    if (enviandoRef.current) return
    setAccion(null)
    const origen = disparador.current
    setTimeout(() => origen?.focus(), 0)
  }

  async function confirmar(evento: React.FormEvent) {
    evento.preventDefault()
    if (!accion || !credencialId) return
    const texto = motivo.trim()
    if (texto.length < 3 || texto.length > 200) {
      setError('El motivo debe tener entre 3 y 200 caracteres.')
      areaMotivo.current?.focus()
      return
    }
    marcarEnvio(true)
    setError(null)
    const resultado =
      accion === 'reponer'
        ? await reponerCredencialRemota(credencialId, texto)
        : await revocarCredencialRemota(credencialId, texto)
    marcarEnvio(false)
    if (!resultado.ok) {
      tratarFallo(resultado)
      return
    }
    const exito = CONFIGURACION[accion].exito
    setAccion(null)
    refrescar(exito)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
        {credencialId ? (
          <>
            {emisible && (
              <Button type="button" variant="outline" className="min-h-11" onClick={(evento) => abrir('reponer', evento)} disabled={ocupado}>
                <ArrowsClockwise size={18} weight="bold" aria-hidden="true" />
                Reponer credencial
              </Button>
            )}
            <Button type="button" variant="peligro" className="min-h-11" onClick={(evento) => abrir('revocar', evento)} disabled={ocupado}>
              <Prohibit size={18} weight="bold" aria-hidden="true" />
              Revocar credencial
            </Button>
          </>
        ) : (
          emisible && (
            <Button type="button" variant="primary" className="min-h-11" onClick={emitir} loading={ocupado}>
              <QrCode size={18} weight="bold" aria-hidden="true" />
              {tarjeta.estado === 'REVOCADA' ? 'Emitir credencial nueva' : 'Emitir credencial'}
            </Button>
          )
        )}
      </div>

      {!emisible && (
        <p data-testid="credencial-no-emisible" className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm text-amber-900">
          {credencialId
            ? 'El alumno está inactivo: no se puede reponer su credencial. Reactivá al alumno primero; mientras tanto solo podés revocar la vigente.'
            : 'El alumno está inactivo: no se puede emitir su credencial. Reactivá al alumno primero.'}
        </p>
      )}

      <div aria-live="polite" className="min-h-5 text-center text-sm">
        {aviso && !accion && (
          <p role="status" className="text-green-800">
            {aviso}
          </p>
        )}
        {error && !accion && (
          <div role="alert" className="space-y-2 text-red-700">
            <p>{error}</p>
            {desactualizada && (
              <Button type="button" size="sm" variant="outline" onClick={() => { setDesactualizada(false); setError(null); refrescar('Pantalla actualizada.') }}>
                Actualizar pantalla
              </Button>
            )}
          </div>
        )}
      </div>

      {accion && (
        <Dialogo
          tituloId="titulo-accion-credencial"
          titulo={CONFIGURACION[accion].titulo}
          descripcion={CONFIGURACION[accion].descripcion}
          selectorFocoInicial="#motivo-credencial"
          onCerrar={cerrarSinOperar}
        >
          <form onSubmit={confirmar} noValidate className="space-y-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="motivo-credencial" className="text-sm font-semibold text-neutral-700">
                Motivo <span className="text-red-600">*</span>
              </label>
              <textarea
                id="motivo-credencial"
                ref={areaMotivo}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                rows={3}
                maxLength={200}
                required
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'motivo-credencial-error motivo-credencial-ayuda' : 'motivo-credencial-ayuda'}
                className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
              />
              <p id="motivo-credencial-ayuda" className="text-xs text-neutral-600">
                Entre 3 y 200 caracteres. Queda registrado en el historial. Ejemplo: «Extravío de la tarjeta».
              </p>
              {error && (
                <p id="motivo-credencial-error" role="alert" className="text-sm text-red-700">
                  {error}
                </p>
              )}
            </div>
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button type="button" variant="secondary" className="min-h-11" onClick={cerrarSinOperar} disabled={ocupado}>
                Cancelar
              </Button>
              <Button type="submit" variant={accion === 'revocar' ? 'peligro' : 'primary'} className="min-h-11" loading={ocupado}>
                {CONFIGURACION[accion].confirmar}
              </Button>
            </div>
          </form>
        </Dialogo>
      )}
    </div>
  )
}
