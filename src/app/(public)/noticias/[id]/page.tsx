/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { ArrowLeft, CalendarBlank } from '@phosphor-icons/react/dist/ssr'
import { obtenerNoticiaPorId, obtenerNoticias } from '@/services/noticias.service'

interface Props {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  try {
    const noticia = await obtenerNoticiaPorId(Number(id)) as any
    return {
      title: noticia.titulo,
      description: noticia.contenido.slice(0, 150),
    }
  } catch {
    return { title: 'Noticia no encontrada' }
  }
}

export default async function NoticiaDetallePage({ params }: Props) {
  const { id } = await params
  let noticia: any
  let relacionadas: any[] = []

  try {
    noticia = await obtenerNoticiaPorId(Number(id))
    const todas = await obtenerNoticias(4) as any[]
    relacionadas = todas.filter((n: any) => n.id !== Number(id)).slice(0, 3)
  } catch {
    notFound()
  }

  if (!noticia) notFound()

  return (
    <div className="pt-16">
      {/* Hero imagen */}
      <div
        className="h-[50vh] min-h-[300px] w-full relative"
        style={{
          backgroundImage: `url(${noticia.imagen_url ?? (noticia.id <= 2 ? `/noticia-${noticia.id}.png` : '/noticia-fallback.png')})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <div className="absolute inset-0 bg-brand-900/60" />
        <div className="absolute bottom-8 left-0 right-0 max-w-3xl mx-auto px-4">
          <div className="flex items-center gap-2 text-white/70 text-sm mb-3">
            <CalendarBlank size={14} />
            {format(new Date(noticia.fecha_publicacion), "d 'de' MMMM 'de' yyyy", { locale: es })}
          </div>
          <h1 className="text-3xl md:text-4xl font-extrabold text-white tracking-tight leading-tight">
            {noticia.titulo}
          </h1>
        </div>
      </div>

      {/* Contenido */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <Link
          href="/noticias"
          className="inline-flex items-center gap-2 text-sm text-neutral-500 hover:text-brand-600 mb-8 transition-colors"
        >
          <ArrowLeft size={16} /> Volver a noticias
        </Link>

        <div className="prose prose-neutral max-w-none text-neutral-700 leading-relaxed text-[1.0625rem]">
          {noticia.contenido.split('\n').map((parrafo: string, i: number) => (
            <p key={i} className="mb-4">{parrafo}</p>
          ))}
        </div>

        {/* Relacionadas */}
        {relacionadas.length > 0 && (
          <div className="mt-16 pt-10 border-t border-neutral-200">
            <h2 className="text-lg font-bold text-neutral-900 mb-6">Otras noticias</h2>
            <div className="grid sm:grid-cols-3 gap-4">
              {relacionadas.map((n: any) => (
                <Link key={n.id} href={`/noticias/${n.id}`} className="group block">
                  <div
                    className="h-32 rounded-xl mb-3"
                    style={{
                      backgroundImage: `url(${n.imagen_url ?? (n.id <= 2 ? `/noticia-${n.id}.png` : '/noticia-fallback.png')})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }}
                  />
                  <p className="text-sm font-semibold text-neutral-800 leading-snug group-hover:text-brand-600 transition-colors line-clamp-2">
                    {n.titulo}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
