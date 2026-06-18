'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ChatCenteredText, Trash, CheckCircle, Clock } from '@phosphor-icons/react'
import { obtenerOpiniones, eliminarOpinion, aprobarOpinion } from '@/services/noticias.service'
import { formatFecha } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Badge, Skeleton } from '@/components/ui/Badge'
import { useAuth } from '@/context/AuthContext'

type Opinion = {
  id: number
  nombre_usuario: string
  comentario: string
  fecha: string
  aprobado: boolean
}

export default function TestimoniosPage() {
  const { rol } = useAuth()
  const [opiniones, setOpiniones] = useState<Opinion[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [approvingId, setApprovingId] = useState<number | null>(null)

  const cargar = async () => {
    setLoading(true)
    try {
      const data = await obtenerOpiniones()
      setOpiniones((data ?? []) as Opinion[])
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al cargar testimonios'
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (rol && rol !== 'DIRECTOR') return
    cargar()
  }, [rol])

  const aprobar = async (id: number) => {
    setApprovingId(id)
    try {
      await aprobarOpinion(id)
      setOpiniones((prev) => prev.map((o) => (o.id === id ? { ...o, aprobado: true } : o)))
      toast.success('Testimonio aprobado y publicado')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo aprobar'
      toast.error(message)
    } finally {
      setApprovingId(null)
    }
  }

  const eliminar = async (id: number) => {
    setDeletingId(id)
    try {
      await eliminarOpinion(id)
      setOpiniones((prev) => prev.filter((o) => o.id !== id))
      toast.success('Testimonio eliminado')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo eliminar'
      toast.error(message)
    } finally {
      setDeletingId(null)
    }
  }

  const pendientes = opiniones.filter((o) => !o.aprobado)
  const aprobados = opiniones.filter((o) => o.aprobado)

  const renderFila = (op: Opinion) => (
    <tr key={op.id} className="hover:bg-neutral-50 transition-colors">
      <td className="px-5 py-3 text-neutral-800 font-medium whitespace-nowrap">{op.nombre_usuario}</td>
      <td className="px-5 py-3 text-neutral-600">{op.comentario}</td>
      <td className="px-5 py-3 text-xs text-neutral-400 whitespace-nowrap">{formatFecha(op.fecha)}</td>
      <td className="px-5 py-3">
        {op.aprobado
          ? <Badge variant="success" dot>Publicado</Badge>
          : <Badge variant="warning" dot>Pendiente</Badge>}
      </td>
      <td className="px-5 py-3">
        <div className="flex items-center justify-end gap-2">
          {!op.aprobado && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={approvingId === op.id}
              onClick={() => aprobar(op.id)}
            >
              <CheckCircle size={14} weight="fill" />
              Aprobar
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            loading={deletingId === op.id}
            onClick={() => eliminar(op.id)}
          >
            <Trash size={14} />
            Eliminar
          </Button>
        </div>
      </td>
    </tr>
  )

  if (rol && rol !== 'DIRECTOR') {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-6 text-sm text-yellow-800">
          Acceso restringido. Solo directores pueden moderar testimonios.
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-neutral-900 tracking-tight">Testimonios</h1>
        <p className="text-neutral-500 text-sm mt-0.5">
          Los testimonios nuevos quedan pendientes y solo se publican en la web cuando los aprobás.
        </p>
      </div>

      {/* Pendientes de aprobación */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Clock size={18} weight="fill" className="text-yellow-500" />
          <h2 className="font-bold text-neutral-900 text-sm">
            Pendientes de aprobación {!loading && `(${pendientes.length})`}
          </h2>
        </div>
        <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="Testimonios pendientes">
              <thead>
                <tr className="bg-neutral-50 border-b border-neutral-100">
                  {['Autor', 'Comentario', 'Fecha', 'Estado', 'Acciones'].map((col) => (
                    <th key={col} className={`px-5 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider ${col === 'Acciones' ? 'text-right' : 'text-left'}`}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {loading
                  ? Array.from({ length: 2 }).map((_, i) => (
                      <tr key={i}>
                        {Array.from({ length: 5 }).map((_, j) => (
                          <td key={j} className="px-5 py-3"><Skeleton className="h-4 w-full" /></td>
                        ))}
                      </tr>
                    ))
                  : pendientes.length === 0
                    ? (
                      <tr>
                        <td colSpan={5} className="px-5 py-10 text-center">
                          <CheckCircle size={32} className="text-green-300 mx-auto mb-2" weight="fill" />
                          <p className="text-neutral-400 text-sm">No hay testimonios pendientes</p>
                        </td>
                      </tr>
                    )
                    : pendientes.map(renderFila)
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Publicados */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <CheckCircle size={18} weight="fill" className="text-green-500" />
          <h2 className="font-bold text-neutral-900 text-sm">
            Publicados {!loading && `(${aprobados.length})`}
          </h2>
        </div>
        <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="Testimonios publicados">
              <thead>
                <tr className="bg-neutral-50 border-b border-neutral-100">
                  {['Autor', 'Comentario', 'Fecha', 'Estado', 'Acciones'].map((col) => (
                    <th key={col} className={`px-5 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider ${col === 'Acciones' ? 'text-right' : 'text-left'}`}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {loading
                  ? Array.from({ length: 3 }).map((_, i) => (
                      <tr key={i}>
                        {Array.from({ length: 5 }).map((_, j) => (
                          <td key={j} className="px-5 py-3"><Skeleton className="h-4 w-full" /></td>
                        ))}
                      </tr>
                    ))
                  : aprobados.length === 0
                    ? (
                      <tr>
                        <td colSpan={5} className="px-5 py-10 text-center">
                          <ChatCenteredText size={32} className="text-neutral-300 mx-auto mb-2" />
                          <p className="text-neutral-400 text-sm">No hay testimonios publicados</p>
                        </td>
                      </tr>
                    )
                    : aprobados.map(renderFila)
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
