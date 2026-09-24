'use client'

import { useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle, Plus, WarningCircle } from '@phosphor-icons/react'
import { Button } from '@/components/ui/Button'
import { Dialogo } from '@/components/ui/Dialogo'
import { Input, Select } from '@/components/ui/Input'
import {
  DIAS_SEMANA,
  describirFranja,
  describirFranjaBreve,
  esHoraValida,
  nombreDiaTitulo,
  normalizarHora,
  ordenarFranjas,
  primeraSuperpuesta,
} from '@/lib/horarios'
import {
  agregarHorarioGrupoRemoto,
  darDeBajaHorarioGrupoRemoto,
  ErrorDeportes,
} from '@/services/deportes.client'
import type { FranjaHoraria, GrupoDeportivo } from '@/services/deportes.service'

type CampoFranja = 'dia_semana' | 'hora_inicio' | 'hora_fin'
type ErroresFranja = Partial<Record<CampoFranja, string>>

const FRANJA_VACIA = { dia_semana: '', hora_inicio: '', hora_fin: '' }

/**
 * Configuración mínima de las franjas de un grupo por la dirección (EPT-38,
 * EPT-40).
 *
 * Permite asignar franjas y darlas de baja (baja lógica: la franja queda en el
 * historial y puede volver a asignarse). No edita el grupo, no lo inactiva y no
 * borra nada: la administración integral de grupos es EPT-61.
 *
 * Antes de enviar, anticipa con `primeraSuperpuesta` —la misma fórmula que la
 * base— si la franja choca con otra del grupo. Es una ayuda, no la regla: la
 * base vuelve a validar con el grupo bloqueado y además comprueba que la
 * franja no genere conflictos a los alumnos ya inscriptos.
 */
export function HorariosGrupo({
  grupo,
  franjas,
  onCerrar,
}: {
  grupo: GrupoDeportivo
  franjas: FranjaHoraria[]
  onCerrar: () => void
}) {
  const router = useRouter()
  const [formulario, setFormulario] = useState(FRANJA_VACIA)
  const [errores, setErrores] = useState<ErroresFranja>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [exito, setExito] = useState<string | null>(null)
  const [enviando, setEnviando] = useState<string | null>(null)
  const regionResultado = useRef<HTMLDivElement>(null)

  const ordenadas = ordenarFranjas(franjas)
  const ocupado = enviando !== null
  const idTitulo = `horarios-${grupo.grupo_id}`

  function actualizar(campo: CampoFranja, valor: string) {
    setFormulario((anterior) => ({ ...anterior, [campo]: valor }))
    setErrores((anteriores) => ({ ...anteriores, [campo]: undefined }))
  }

  function validar(): ErroresFranja {
    const encontrados: ErroresFranja = {}
    if (!formulario.dia_semana) encontrados.dia_semana = 'Seleccioná un día de la semana'
    if (!esHoraValida(formulario.hora_inicio))
      encontrados.hora_inicio = 'Ingresá una hora de inicio válida, por ejemplo 14:30'
    if (!esHoraValida(formulario.hora_fin))
      encontrados.hora_fin = 'Ingresá una hora de fin válida, por ejemplo 15:30'
    if (
      !encontrados.hora_inicio &&
      !encontrados.hora_fin &&
      normalizarHora(formulario.hora_inicio) >= normalizarHora(formulario.hora_fin)
    ) {
      encontrados.hora_fin = 'La hora de inicio debe ser anterior a la hora de fin'
    }
    if (Object.keys(encontrados).length === 0) {
      const nueva = {
        dia_semana: Number(formulario.dia_semana),
        hora_inicio: formulario.hora_inicio,
        hora_fin: formulario.hora_fin,
      }
      const choque = primeraSuperpuesta(nueva, franjas)
      if (choque) {
        encontrados.hora_inicio = `La franja se superpone con otra franja del grupo: ${describirFranja(choque)}.`
      }
    }
    return encontrados
  }

  function mensajeDeError(problema: unknown, respaldo: string) {
    if (problema instanceof ErrorDeportes) {
      return problema.estado === 401
        ? 'Tu sesión venció. Iniciá sesión nuevamente para continuar.'
        : problema.message
    }
    return respaldo
  }

  async function agregar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (ocupado) return
    setExito(null)
    setErrorGeneral(null)

    const encontrados = validar()
    setErrores(encontrados)
    if (Object.keys(encontrados).length > 0) return

    const dia = Number(formulario.dia_semana)
    setEnviando('agregar')
    try {
      await agregarHorarioGrupoRemoto(grupo.grupo_id, {
        dia_semana: dia,
        hora_inicio: formulario.hora_inicio,
        hora_fin: formulario.hora_fin,
      })
      setExito(
        `Asignaste la franja del ${describirFranja({
          dia_semana: dia,
          hora_inicio: formulario.hora_inicio,
          hora_fin: formulario.hora_fin,
        })}.`
      )
      setFormulario(FRANJA_VACIA)
      router.refresh()
    } catch (problema) {
      const mensaje = mensajeDeError(problema, 'No pudimos asignar la franja. Volvé a intentarlo.')
      const campo = problema instanceof ErrorDeportes ? problema.campo : undefined
      if (campo === 'dia_semana' || campo === 'hora_inicio' || campo === 'hora_fin') {
        setErrores({ [campo]: mensaje })
      } else {
        setErrorGeneral(mensaje)
      }
    } finally {
      setEnviando(null)
    }
  }

  async function darDeBaja(franja: FranjaHoraria) {
    if (ocupado) return
    setExito(null)
    setErrorGeneral(null)
    setEnviando(franja.id)
    try {
      await darDeBajaHorarioGrupoRemoto(grupo.grupo_id, franja.id)
      setExito(
        `Diste de baja la franja del ${describirFranja(franja)}. Queda en el historial y podés volver a asignarla.`
      )
      router.refresh()
    } catch (problema) {
      setErrorGeneral(mensajeDeError(problema, 'No pudimos dar de baja la franja. Volvé a intentarlo.'))
      router.refresh()
    } finally {
      setEnviando(null)
      regionResultado.current?.focus()
    }
  }

  return (
    <Dialogo
      tituloId={idTitulo}
      titulo={`Horarios de ${grupo.deporte_nombre} · ${grupo.grupo_nombre}`}
      descripcion="Cada franja es semanal. Un grupo sin franjas no admite inscripciones nuevas. Una franja que termina justo cuando empieza otra no se superpone."
      selectorFocoInicial="#franja-dia"
      onCerrar={() => {
        if (!ocupado) onCerrar()
      }}
    >
      <div className="space-y-5">
        {/*
          Cada aviso ya es una región viva (role="status" o role="alert"); el
          contenedor no agrega otra para no anunciarlo dos veces. Recibe el
          foco tras una baja: el botón pulsado desaparece al refrescar.
        */}
        <div
          ref={regionResultado}
          tabIndex={-1}
          aria-label="Resultado de la última operación sobre las franjas"
          className="space-y-2 outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded-xl"
        >
          {errorGeneral && (
            <div
              role="alert"
              className="bg-red-50 border border-red-200 rounded-xl p-3 flex gap-2 items-start text-sm text-red-800"
            >
              <WarningCircle size={18} weight="fill" className="text-red-500 shrink-0 mt-0.5" aria-hidden="true" />
              <p>{errorGeneral}</p>
            </div>
          )}
          {exito && (
            <div
              role="status"
              className="bg-green-50 border border-green-200 rounded-xl p-3 flex gap-2 items-start text-sm text-green-800"
            >
              <CheckCircle size={18} weight="fill" className="text-green-600 shrink-0 mt-0.5" aria-hidden="true" />
              <p>{exito}</p>
            </div>
          )}
        </div>

        <section aria-labelledby={`${idTitulo}-vigentes`} className="space-y-2">
          <h3 id={`${idTitulo}-vigentes`} className="text-sm font-bold text-neutral-900">
            Franjas vigentes
          </h3>
          {ordenadas.length === 0 ? (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3">
              Este grupo todavía no tiene horarios. Hasta que le asignes al menos una franja, no
              admite inscripciones.
            </p>
          ) : (
            <ul className="space-y-2">
              {ordenadas.map((franja) => (
                <li
                  key={franja.id}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-xl border border-neutral-200 p-3"
                >
                  <span className="text-sm font-semibold text-neutral-900">
                    {describirFranjaBreve(franja)}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="self-start sm:self-auto"
                    disabled={ocupado}
                    aria-busy={enviando === franja.id}
                    onClick={() => darDeBaja(franja)}
                    aria-label={`Dar de baja la franja del ${describirFranja(franja)}`}
                  >
                    {enviando === franja.id ? 'Dando de baja…' : 'Dar de baja'}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <form onSubmit={agregar} noValidate className="space-y-4 border-t border-neutral-200 pt-4">
          <h3 className="text-sm font-bold text-neutral-900">Asignar una franja</h3>
          <Select
            id="franja-dia"
            label="Día"
            placeholder="Seleccioná un día"
            options={DIAS_SEMANA.map((dia) => ({ value: dia.valor, label: nombreDiaTitulo(dia.valor) }))}
            value={formulario.dia_semana}
            onChange={(evento) => actualizar('dia_semana', evento.target.value)}
            error={errores.dia_semana}
            required
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              id="franja-inicio"
              label="Hora de inicio"
              type="time"
              value={formulario.hora_inicio}
              onChange={(evento) => actualizar('hora_inicio', evento.target.value)}
              error={errores.hora_inicio}
              required
            />
            <Input
              id="franja-fin"
              label="Hora de fin"
              type="time"
              value={formulario.hora_fin}
              onChange={(evento) => actualizar('hora_fin', evento.target.value)}
              error={errores.hora_fin}
              helperText="La franja termina a esta hora: otra puede empezar justo ahí."
              required
            />
          </div>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <Button type="button" variant="outline" onClick={onCerrar} disabled={ocupado}>
              Cerrar
            </Button>
            <Button type="submit" disabled={ocupado} aria-busy={enviando === 'agregar'}>
              <Plus size={16} weight="bold" aria-hidden="true" />
              {enviando === 'agregar' ? 'Asignando…' : 'Asignar franja'}
            </Button>
          </div>
        </form>
      </div>
    </Dialogo>
  )
}
