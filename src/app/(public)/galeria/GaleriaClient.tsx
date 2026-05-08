'use client'

import { useState } from 'react'
import { X, Images } from '@phosphor-icons/react'

interface Imagen {
  id: number
  url: string
  descripcion: string | null
  categoria: string | null
}

export function GaleriaClient({ imagenes }: { imagenes: Imagen[] }) {
  const [modalImg, setModalImg] = useState<Imagen | null>(null)

  return (
    <>
      {/* Header */}
      <section className="pt-24 pb-12 bg-neutral-50 border-b border-neutral-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-brand-600 font-semibold text-sm uppercase tracking-widest mb-3">Imágenes</p>
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6">
            <h1 className="text-4xl md:text-5xl font-extrabold text-neutral-900 tracking-tight">
              Galería fotográfica
            </h1>
          </div>
        </div>
      </section>

      {/* Grid masonry-like */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {imagenes.length === 0 ? (
          <div className="py-24 text-center">
            <Images size={48} className="text-neutral-300 mx-auto mb-4" />
            <p className="text-neutral-500">No hay imágenes en la galería</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {imagenes.map((img, i) => (
              <button
                key={img.id}
                onClick={() => setModalImg(img)}
                className="block w-full group rounded-xl overflow-hidden relative aspect-[4/3]"
                aria-label={`Ver imagen: ${img.descripcion ?? 'Sin descripción'}`}
              >
                <img
                  src={img.url}
                  alt={img.descripcion ?? 'Imagen de galería'}
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  loading={i < 4 ? 'eager' : 'lazy'}
                />
                <div className="absolute inset-0 bg-brand-900/0 group-hover:bg-brand-900/40 transition-colors duration-300 flex items-end p-3">
                  <p className="text-white text-xs font-semibold opacity-0 group-hover:opacity-100 transition-opacity duration-300 text-left">
                    {img.descripcion}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Modal lightbox */}
      {modalImg && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setModalImg(null)}
          role="dialog"
          aria-label="Ver imagen ampliada"
          aria-modal="true"
        >
          <button
            className="absolute top-4 right-4 w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white transition-colors z-10"
            onClick={() => setModalImg(null)}
            aria-label="Cerrar imagen"
          >
            <X size={20} />
          </button>
          <div
            className="relative max-w-4xl w-full max-h-[85vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={modalImg.url}
              alt={modalImg.descripcion ?? 'Imagen ampliada'}
              className="w-full h-full object-contain rounded-2xl"
            />
            {modalImg.descripcion && (
              <p className="mt-4 text-center text-white/70 text-sm">{modalImg.descripcion}</p>
            )}
          </div>
        </div>
      )}
    </>
  )
}
