'use client'

import { useMemo, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { DIAS_SEMANA, describirFranja, esHoraValida, normalizarHora, primeraSuperpuesta } from '@/lib/horarios'
import type { AsignacionMateria } from '@/services/materias.service'
import type { CambioFranja, FranjaAcademica } from '@/services/horarios-academicos.service'

type Formulario = { asignacion_id: string; dia_semana: string; hora_inicio: string; hora_fin: string; franja_id?: string }

export function GestionHorariosAcademicos({ asignaciones, franjas, historial }: {
  asignaciones: AsignacionMateria[]
  franjas: FranjaAcademica[]
  historial: CambioFranja[]
}) {
  const router = useRouter()
  const [seleccion, setSeleccion] = useState(asignaciones[0]?.id ?? '')
  const destinoPredeterminado = (origen: string) =>
    asignaciones.find((item) => item.id === origen && item.activo)?.id ??
    asignaciones.find((item) => item.activo)?.id ?? ''
  const [formulario, setFormulario] = useState<Formulario>({ asignacion_id: destinoPredeterminado(seleccion), dia_semana: '1', hora_inicio: '', hora_fin: '' })
  const [enviando, setEnviando] = useState(false)
  const [mensaje, setMensaje] = useState<{ tipo: 'error' | 'exito'; texto: string } | null>(null)
  const asignacion = asignaciones.find((item) => item.id === seleccion)
  const destinoActivo = asignaciones.some((item) => item.id === formulario.asignacion_id && item.activo)
  const visibles = useMemo(() => franjas.filter((item) => item.asignacion_id === seleccion)
    .sort((a, b) => a.dia_semana - b.dia_semana || a.hora_inicio.localeCompare(b.hora_inicio)), [franjas, seleccion])
  const cambiosVisibles = historial.filter((c) => c.asignacion_anterior === seleccion || c.asignacion_nueva === seleccion)
  const etiqueta = (item: AsignacionMateria) => `${item.materia_nombre} · ${item.curso_denominacion} ${item.curso_division} · ${item.nivel_nombre}`

  function elegirAsignacion(id: string) {
    setSeleccion(id)
    setFormulario({ asignacion_id: destinoPredeterminado(id), dia_semana: '1', hora_inicio: '', hora_fin: '' })
    setMensaje(null)
  }

  async function guardar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (enviando) return
    setMensaje(null)
    const destino = asignaciones.find((item) => item.id === formulario.asignacion_id)
    if (!destino?.activo) {
      setMensaje({ tipo: 'error', texto: 'La asignación de destino debe estar activa para configurar horarios.' })
      return
    }
    const dia = Number(formulario.dia_semana)
    if (dia < 1 || dia > 7 || !esHoraValida(formulario.hora_inicio) ||
      !esHoraValida(formulario.hora_fin) ||
      normalizarHora(formulario.hora_inicio) >= normalizarHora(formulario.hora_fin)) {
      setMensaje({ tipo: 'error', texto: 'Revisá el día y las horas: el inicio debe ser anterior al fin.' })
      return
    }
    const otras = franjas.filter((item) => item.activo && item.id !== formulario.franja_id &&
      asignaciones.find((asig) => asig.id === item.asignacion_id)?.curso_id === destino?.curso_id)
    const choque = primeraSuperpuesta({ dia_semana: dia, hora_inicio: formulario.hora_inicio, hora_fin: formulario.hora_fin }, otras)
    if (choque) {
      const actividad = asignaciones.find((item) => item.id === choque.asignacion_id)?.materia_nombre ?? 'otra materia'
      setMensaje({ tipo: 'error', texto: `La franja se superpone con ${actividad}: ${describirFranja(choque)}.` })
      return
    }
    setEnviando(true)
    try {
      const respuesta = await fetch('/api/horarios-academicos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asignacion_id: formulario.asignacion_id, dia_semana: dia,
          hora_inicio: formulario.hora_inicio, hora_fin: formulario.hora_fin,
          franja_id: formulario.franja_id }),
      })
      const datos = await respuesta.json().catch(() => ({}))
      if (!respuesta.ok) throw new Error(typeof datos.error === 'string' ? datos.error : 'No pudimos guardar la franja.')
      setMensaje({ tipo: 'exito', texto: formulario.franja_id ? 'Franja actualizada.' : 'Franja agregada.' })
      setFormulario({ asignacion_id: destinoPredeterminado(seleccion), dia_semana: '1', hora_inicio: '', hora_fin: '' })
      router.refresh()
    } catch (error) {
      setMensaje({ tipo: 'error', texto: error instanceof Error ? error.message : 'No pudimos comunicarnos con el servidor.' })
      router.refresh()
    } finally { setEnviando(false) }
  }

  async function cambiarEstado(franja: FranjaAcademica) {
    if (enviando) return
    setEnviando(true)
    setMensaje(null)
    try {
      const respuesta = await fetch(`/api/horarios-academicos/${franja.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activo: !franja.activo }),
      })
      const datos = await respuesta.json().catch(() => ({}))
      if (!respuesta.ok) throw new Error(typeof datos.error === 'string' ? datos.error : 'No pudimos cambiar el estado.')
      setMensaje({ tipo: 'exito', texto: franja.activo ? 'Franja desactivada; su historial se conservó.' : 'Franja reactivada.' })
      router.refresh()
    } catch (error) {
      setMensaje({ tipo: 'error', texto: error instanceof Error ? error.message : 'No pudimos comunicarnos con el servidor.' })
      router.refresh()
    } finally { setEnviando(false) }
  }

  return <main className="mx-auto max-w-5xl space-y-7 px-4 py-6 sm:px-6">
    <header className="border-b border-neutral-200 pb-5">
      <p className="text-xs font-bold uppercase tracking-widest text-brand-700">Dirección · Gestión académica</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-neutral-950">Horarios académicos</h1>
      <p className="mt-2 max-w-2xl text-sm text-neutral-600">Configurá varias franjas semanales por materia y curso. Las franjas contiguas se admiten; los conflictos con otras materias o deportes se rechazan sin cambios parciales.</p>
    </header>
    {mensaje && <div role={mensaje.tipo === 'error' ? 'alert' : 'status'} tabIndex={-1}
      className={`rounded-lg border p-3 text-sm ${mensaje.tipo === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-green-200 bg-green-50 text-green-900'}`}>{mensaje.texto}</div>}
    <section className="space-y-3" aria-labelledby="asignacion-titulo">
      <h2 id="asignacion-titulo" className="text-lg font-semibold">Asignación</h2>
      {asignaciones.length === 0 ? <p className="rounded-lg border p-5 text-neutral-600">Todavía no hay materias asignadas a cursos. Primero creá una asignación en Materias.</p> : <>
        <label htmlFor="asignacion" className="block text-sm font-medium">Materia y curso</label>
        <select id="asignacion" value={seleccion} onChange={(e) => elegirAsignacion(e.target.value)}
          className="w-full rounded-lg border border-neutral-300 bg-white p-2.5 text-sm focus-visible:outline-2 focus-visible:outline-brand-600">
          {asignaciones.map((item) => <option key={item.id} value={item.id}>{etiqueta(item)}{item.activo ? '' : ' · Inactiva'}</option>)}
        </select>
      </>}
    </section>
    {asignacion && <>
      <section className="space-y-3" aria-labelledby="franjas-titulo">
        <div className="flex flex-wrap items-end justify-between gap-2"><h2 id="franjas-titulo" className="text-lg font-semibold">Franjas de {asignacion.materia_nombre}</h2><span className="text-sm text-neutral-500">{visibles.filter((f) => f.activo).length} activas</span></div>
        {visibles.length === 0 ? <p className="rounded-lg border border-dashed p-5 text-sm text-neutral-600">Esta asignación todavía no tiene horarios. Podés agregar la primera franja debajo.</p> :
          <ul className="divide-y rounded-xl border border-neutral-200 bg-white">{visibles.map((franja) => <li key={franja.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div><p className="font-medium text-neutral-900">{describirFranja(franja)}</p><p className="text-xs text-neutral-500">{franja.activo ? 'Activa' : 'Inactiva · Conservada en el historial'}</p></div>
            <div className="flex flex-wrap gap-2"><button type="button" disabled={enviando} onClick={() => { setFormulario({ asignacion_id: destinoPredeterminado(seleccion), dia_semana: String(franja.dia_semana), hora_inicio: franja.hora_inicio.slice(0, 5), hora_fin: franja.hora_fin.slice(0, 5), franja_id: franja.id }); document.getElementById('formulario-franja')?.scrollIntoView({ behavior: 'smooth' }) }} className="rounded-lg border px-3 py-2 text-sm hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-brand-600 disabled:opacity-50">Editar o reasignar</button>
              <button type="button" disabled={enviando} onClick={() => cambiarEstado(franja)} className="rounded-lg border px-3 py-2 text-sm hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-brand-600 disabled:opacity-50">{franja.activo ? 'Desactivar' : 'Reactivar'}</button></div>
          </li>)}</ul>}
      </section>
      <section id="formulario-franja" className="border-t border-neutral-200 pt-6" aria-labelledby="formulario-titulo">
        <h2 id="formulario-titulo" className="text-lg font-semibold">{formulario.franja_id ? 'Editar franja' : 'Agregar franja'}</h2>
        <form onSubmit={guardar} className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><label htmlFor="destino-asignacion" className="mb-1 block text-sm font-medium">Asignación de destino</label><select id="destino-asignacion" value={formulario.asignacion_id} onChange={(e) => setFormulario({ ...formulario, asignacion_id: e.target.value })} required className="w-full rounded-lg border border-neutral-300 p-2.5 text-sm">{asignaciones.filter((item) => item.activo).map((item) => <option key={item.id} value={item.id}>{etiqueta(item)}</option>)}</select></div>
          <div><label htmlFor="dia" className="mb-1 block text-sm font-medium">Día</label><select id="dia" value={formulario.dia_semana} onChange={(e) => setFormulario({ ...formulario, dia_semana: e.target.value })} className="w-full rounded-lg border border-neutral-300 p-2.5 text-sm">{DIAS_SEMANA.map((dia) => <option key={dia.valor} value={dia.valor}>{dia.nombre}</option>)}</select></div>
          <div className="hidden sm:block" />
          <div><label htmlFor="inicio" className="mb-1 block text-sm font-medium">Hora de inicio</label><input id="inicio" type="time" required value={formulario.hora_inicio} onChange={(e) => setFormulario({ ...formulario, hora_inicio: e.target.value })} className="w-full rounded-lg border border-neutral-300 p-2.5 text-sm" /></div>
          <div><label htmlFor="fin" className="mb-1 block text-sm font-medium">Hora de fin</label><input id="fin" type="time" required value={formulario.hora_fin} onChange={(e) => setFormulario({ ...formulario, hora_fin: e.target.value })} className="w-full rounded-lg border border-neutral-300 p-2.5 text-sm" /></div>
          <div className="flex flex-wrap gap-2 sm:col-span-2"><button type="submit" disabled={enviando || !destinoActivo} className="rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 disabled:opacity-50">{enviando ? 'Guardando…' : formulario.franja_id ? 'Guardar cambios' : 'Agregar franja'}</button>{formulario.franja_id && <button type="button" onClick={() => setFormulario({ asignacion_id: destinoPredeterminado(seleccion), dia_semana: '1', hora_inicio: '', hora_fin: '' })} className="rounded-lg border px-4 py-2.5 text-sm">Cancelar edición</button>}</div>
        </form>
      </section>
      <section className="border-t border-neutral-200 pt-6" aria-labelledby="historial-titulo"><h2 id="historial-titulo" className="text-lg font-semibold">Historial de cambios</h2><p className="mt-1 text-sm text-neutral-600">Las bajas, reactivaciones y reasignaciones quedan registradas sin eliminar franjas.</p>{cambiosVisibles.length === 0 ? <p className="mt-3 text-sm text-neutral-500">Todavía no hay cambios de estado registrados.</p> : <ul className="mt-3 divide-y border-t text-sm">{cambiosVisibles.map((c) => <li key={c.id} className="py-3"><time dateTime={c.cambiado_en}>{new Date(c.cambiado_en).toLocaleString('es-AR')}</time> · {c.activo_anterior ? 'Activa' : 'Inactiva'} → {c.activo_nuevo ? 'Activa' : 'Inactiva'}{c.asignacion_anterior !== c.asignacion_nueva ? ' · Reasignada' : ''}</li>)}</ul>}</section>
    </>}
  </main>
}
