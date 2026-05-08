'use client'

import { useState } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { Newspaper, ArrowRight, MagnifyingGlass } from '@phosphor-icons/react'

interface Noticia {
  id: number
  titulo: string
  contenido: string
  imagen_url: string | null
  fecha_publicacion: string
}

interface NoticiasClientProps {
  noticias: Noticia[]
  currentPage: number
  totalPages: number
}

export function NoticiasClient({ noticias, currentPage, totalPages }: NoticiasClientProps) {
  const [busqueda, setBusqueda] = useState('')

  const filtradas = noticias.filter(
    (n) =>
      n.titulo.toLowerCase().includes(busqueda.toLowerCase()) ||
      n.contenido.toLowerCase().includes(busqueda.toLowerCase())
  )

  const [destacada, ...resto] = filtradas

  return (
    <>
      {/* Header */}
      <section className="pt-24 pb-12 bg-neutral-50 border-b border-neutral-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6">
            <div>
              <p className="text-brand-600 font-semibold text-sm uppercase tracking-widest mb-3">Novedades</p>
              <h1 className="text-4xl md:text-5xl font-extrabold text-neutral-900 tracking-tight">
                Noticias institucionales
              </h1>
            </div>
            {/* Buscador */}
            <div className="relative max-w-xs w-full">
              <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input
                type="search"
                placeholder="Buscar noticias..."
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                className="w-full pl-9 h-10 pr-3 rounded-lg border border-neutral-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 bg-white"
                aria-label="Buscar noticias"
              />
            </div>
          </div>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {filtradas.length === 0 ? (
          <div className="py-24 text-center">
            <Newspaper size={48} className="text-neutral-300 mx-auto mb-4" />
            <p className="text-neutral-500">
              {busqueda ? `No se encontraron noticias para "${busqueda}"` : 'No hay noticias publicadas aún'}
            </p>
          </div>
        ) : (
          <>
            {/* Noticia destacada */}
            {destacada && (
              <article className="mb-12">
                <div className="grid lg:grid-cols-2 gap-8 bg-white rounded-3xl border border-neutral-200 overflow-hidden hover:shadow-sm transition-all duration-200 group">
                  <div
                    className="min-h-[280px] lg:min-h-[380px]"
                    style={{
                      backgroundImage: `url(${destacada.imagen_url ?? (destacada.id <= 2 ? `/noticia-${destacada.id}.png` : '/noticia-fallback.png')})`,

                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }}
                    role="img"
                    aria-label={destacada.titulo}
                  />
                  <div className="p-8 flex flex-col justify-center">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-accent-50 text-accent-600 border border-accent-200 rounded-full text-xs font-bold mb-4 w-fit">
                      Destacado
                    </span>
                    <time className="text-xs text-neutral-400 font-medium mb-3">
                      {format(new Date(destacada.fecha_publicacion), "d 'de' MMMM yyyy", { locale: es })}
                    </time>
                    <h2 className="text-2xl font-extrabold text-neutral-900 tracking-tight mb-3 leading-tight">
                      {destacada.titulo}
                    </h2>
                    <p className="text-neutral-600 leading-relaxed line-clamp-3 mb-6">
                      {destacada.contenido}
                    </p>
                    <Link
                      href={`/noticias/${destacada.id}`}
                      className="inline-flex items-center gap-2 text-brand-600 font-semibold text-sm group-hover:gap-3 transition-all duration-200"
                    >
                      Leer artículo completo <ArrowRight size={16} />
                    </Link>
                  </div>
                </div>
              </article>
            )}

            {/* Resto de noticias */}
            {resto.length > 0 && (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {resto.map((noticia) => (
                  <article
                    key={noticia.id}
                    className="group bg-white rounded-2xl border border-neutral-200 overflow-hidden hover:border-brand-300 hover:shadow-sm transition-all duration-200"
                  >
                    <Link href={`/noticias/${noticia.id}`}>
                      <div
                        className="h-48 transition-transform duration-500 group-hover:scale-105"
                        style={{
                          backgroundImage: `url(${noticia.imagen_url ?? (noticia.id <= 2 ? `/noticia-${noticia.id}.png` : '/noticia-fallback.png')})`,

                          backgroundSize: 'cover',
                          backgroundPosition: 'center',
                        }}
                        role="img"
                        aria-label={noticia.titulo}
                      />
                      <div className="p-5">
                        <time className="text-xs text-neutral-400 font-medium">
                          {format(new Date(noticia.fecha_publicacion), "d 'de' MMMM yyyy", { locale: es })}
                        </time>
                        <h3 className="font-bold text-neutral-900 mt-2 mb-2 leading-snug line-clamp-2">
                          {noticia.titulo}
                        </h3>
                        <p className="text-neutral-600 text-sm leading-relaxed line-clamp-3">
                          {noticia.contenido}
                        </p>
                        <div className="flex items-center gap-1.5 mt-4 text-xs font-semibold text-brand-600 group-hover:gap-2 transition-all duration-200">
                          Leer más <ArrowRight size={13} />
                        </div>
                      </div>
                    </Link>
                  </article>
                ))}
              </div>
            )}

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 mt-12">
                <Link
                  href={`/noticias?page=${currentPage - 1}`}
                  className={`px-4 h-10 inline-flex items-center rounded-full border text-sm font-semibold transition-all
                    ${currentPage === 1 ? 'pointer-events-none opacity-50 border-neutral-200 text-neutral-400' : 'border-brand-200 text-brand-700 hover:bg-brand-50'}`}
                  aria-disabled={currentPage === 1}
                >
                  Anterior
                </Link>
                <span className="text-sm text-neutral-500">
                  Página {currentPage} de {totalPages}
                </span>
                <Link
                  href={`/noticias?page=${currentPage + 1}`}
                  className={`px-4 h-10 inline-flex items-center rounded-full border text-sm font-semibold transition-all
                    ${currentPage === totalPages ? 'pointer-events-none opacity-50 border-neutral-200 text-neutral-400' : 'border-brand-200 text-brand-700 hover:bg-brand-50'}`}
                  aria-disabled={currentPage === totalPages}
                >
                  Siguiente
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}
