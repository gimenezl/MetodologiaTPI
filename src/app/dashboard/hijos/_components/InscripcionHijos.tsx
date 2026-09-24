'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CursoDisponible, Hijo } from '@/services/hijos.service'

export function InscripcionHijos({ iniciales, cursos }: { iniciales: Hijo[]; cursos: CursoDisponible[] }) {
  const [hijos, setHijos] = useState(iniciales)
  const [seleccionado, setSeleccionado] = useState<string | null>(null)
  const [cursoId, setCursoId] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [mensaje, setMensaje] = useState('')
  const [error, setError] = useState('')
  const dialogo = useRef<HTMLDialogElement>(null)
  const disparador = useRef<HTMLButtonElement>(null)
  const router = useRouter()
  const hijo = hijos.find((item) => item.id === seleccionado)
  const curso = cursos.find((item) => item.id === cursoId)

  function abrirConfirmacion(disparadorActual: HTMLButtonElement) {
    if (!hijo || !curso) return
    disparador.current = disparadorActual
    dialogo.current?.showModal()
  }

  function cerrarConfirmacion() {
    dialogo.current?.close()
    disparador.current?.focus()
  }

  async function confirmar() {
    if (!hijo || !curso || enviando) return
    setEnviando(true)
    setError('')
    setMensaje('Enviando la solicitud de matrícula…')
    try {
      const respuesta = await fetch(`/api/hijos/${hijo.id}/matricula`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ curso_id: curso.id }),
      })
      const datos = await respuesta.json()
      if (!respuesta.ok) {
        setError(datos.error ?? 'No pudimos completar la matrícula. Volvé a intentarlo.')
        setMensaje('')
        cerrarConfirmacion()
        return
      }
      const actualizada = await fetch(`/api/hijos/${hijo.id}`, { cache: 'no-store' })
      if (!actualizada.ok) throw new Error('No se pudo actualizar el estado')
      const cuerpo = await actualizada.json()
      setHijos((previos) => previos.map((item) => item.id === hijo.id ? cuerpo.hijo : item))
      setSeleccionado(null)
      setCursoId('')
      setMensaje('La matrícula se confirmó y el alumno quedó activo.')
      cerrarConfirmacion()
      router.refresh()
    } catch {
      setError('No pudimos verificar el resultado. Actualizá la página antes de volver a intentar.')
      setMensaje('')
      cerrarConfirmacion()
    } finally {
      setEnviando(false)
    }
  }

  return <div className="max-w-5xl mx-auto space-y-8 text-neutral-900">
    <header className="border-b border-neutral-200 pb-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-brand-700">Familias · Cursado</p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight">Mis hijos</h1>
      <p className="mt-2 text-sm text-neutral-600">Consultá su situación académica y matriculá a quienes estén en condiciones.</p>
    </header>

    {hijos.length === 0 ? <section className="rounded-2xl border border-neutral-200 bg-white p-8">
      <h2 className="font-semibold">Todavía no tenés hijos vinculados</h2>
      <p className="mt-2 text-sm text-neutral-600">Si falta un vínculo familiar, contactá a la administración.</p>
    </section> : <div className="grid gap-4 md:grid-cols-2">
      {hijos.map((item) => {
        const apto = item.estado === 'INACTIVO' && !item.matricula_id && !!item.legajo_nro
        return <article key={item.id} className="min-w-0 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h2 className="text-lg font-semibold">{item.nombre} {item.apellido}</h2>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${item.estado === 'ACTIVO' ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'}`}>{item.estado === 'ACTIVO' ? 'Activo' : 'Inactivo'}</span>
          </div>
          <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-neutral-500">Legajo</dt><dd className="font-medium">{item.legajo_nro ?? 'Pendiente'}</dd></div>
            <div><dt className="text-neutral-500">Nivel</dt><dd className="font-medium">{item.nivel_nombre ?? 'Sin nivel asignado'}</dd></div>
            <div className="sm:col-span-2"><dt className="text-neutral-500">Curso y matrícula actual</dt><dd className="font-medium">{item.curso_denominacion ? `${item.curso_denominacion} · División ${item.curso_division}` : 'Sin matrícula vigente'}</dd></div>
          </dl>
          <div className="mt-5 border-t border-neutral-100 pt-4 text-sm">
            <h3 className="font-semibold">Materias y docentes</h3>
            {item.materias.length ? <ul className="mt-2 space-y-1 text-neutral-700">
              {item.materias.map((asignacion) => <li key={asignacion.materia}>{asignacion.materia} · {asignacion.docente ?? 'Docente pendiente'}</li>)}
            </ul> : <p className="mt-2 text-neutral-500">Sin materias asignadas al curso vigente.</p>}
            <h3 className="mt-4 font-semibold">Deportes activos</h3>
            {item.deportes.length ? <ul className="mt-2 space-y-1 text-neutral-700">
              {item.deportes.map((inscripcion) => <li key={`${inscripcion.deporte}-${inscripcion.grupo}`}>{inscripcion.deporte} · {inscripcion.grupo}</li>)}
            </ul> : <p className="mt-2 text-neutral-500">Sin inscripciones deportivas activas.</p>}
          </div>
          {apto ? <button type="button" onClick={() => { setSeleccionado(item.id); setCursoId(''); setError(''); setMensaje('') }} className="mt-5 min-h-11 rounded-xl bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700">Seleccionar para matricular</button> : <p className="mt-5 text-sm text-neutral-600">{item.estado === 'ACTIVO' || item.matricula_id ? 'Ya tiene una situación académica activa. Los cambios de curso los gestiona la administración.' : 'Necesita un número de legajo antes de matricularse.'}</p>}
        </article>
      })}
    </div>}

    {hijo && <section className="rounded-2xl border border-brand-200 bg-white p-5 sm:p-7" aria-labelledby="titulo-matricula">
      <h2 id="titulo-matricula" className="text-lg font-semibold">Matricular a {hijo.nombre} {hijo.apellido}</h2>
      {cursos.length === 0 ? <p role="status" className="mt-3 text-sm text-neutral-600">No hay cursos activos disponibles en este momento.</p> : <div className="mt-5 space-y-4">
        <div><label htmlFor="curso-hijo" className="block text-sm font-medium">Curso activo</label>
          <select id="curso-hijo" value={cursoId} onChange={(e) => setCursoId(e.target.value)} className="mt-2 min-h-11 w-full max-w-md rounded-xl border border-neutral-300 bg-white px-3 text-sm focus-visible:outline-2 focus-visible:outline-brand-700">
            <option value="">Elegí un curso</option>
            {cursos.map((opcion) => <option key={opcion.id} value={opcion.id}>{opcion.nivel?.nombre ?? 'Nivel sin nombre'} · {opcion.denominacion} · División {opcion.division}</option>)}
          </select>
        </div>
        <p className="text-sm text-neutral-600">Después de confirmar, solo la administración académica podrá cambiar el curso.</p>
        <button type="button" disabled={!cursoId} onClick={(event) => abrirConfirmacion(event.currentTarget)} className="min-h-11 rounded-xl bg-brand-700 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-neutral-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700">Revisar matrícula</button>
      </div>}
    </section>}

    <div role="status" aria-label="Estado de la matrícula" aria-live="polite" className="text-sm text-green-800">{mensaje}</div>
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}

    <dialog ref={dialogo} onClose={() => disparador.current?.focus()} className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-neutral-200 bg-white p-6 text-neutral-900 shadow-xl backdrop:bg-neutral-950/60">
      <h2 className="text-lg font-semibold">Confirmar matrícula</h2>
      <p className="mt-3 text-sm">Alumno: <strong>{hijo?.nombre} {hijo?.apellido}</strong></p>
      <p className="mt-1 text-sm">Curso: <strong>{curso?.nivel?.nombre} · {curso?.denominacion} · División {curso?.division}</strong></p>
      <p className="mt-4 text-sm text-neutral-600">Esta acción activará el legajo. Después no podrás cambiar el curso; solicitá cualquier cambio a la administración.</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <button type="button" disabled={enviando} onClick={cerrarConfirmacion} className="min-h-11 rounded-xl border border-neutral-300 px-4 text-sm font-semibold disabled:opacity-60">Cancelar</button>
        <button type="button" disabled={enviando} onClick={confirmar} className="min-h-11 rounded-xl bg-brand-700 px-4 text-sm font-semibold text-white disabled:opacity-60">{enviando ? 'Confirmando…' : 'Confirmar matrícula'}</button>
      </div>
    </dialog>
  </div>
}
