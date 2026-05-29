'use client'

import {
  WhatsappLogo, InstagramLogo, FacebookLogo, MapPin,
  Envelope, Clock, Phone
} from '@phosphor-icons/react'
import { Button } from '@/components/ui/Button'

const infoContacto = [
  { icon: MapPin, label: 'Dirección', valor: 'Resistencia, Chaco, Argentina' },
  { icon: Clock, label: 'Horario', valor: 'Lun a Vie · 7:30 a 17:30 hs' },
  { icon: Envelope, label: 'Email', valor: 'info@educarparatransformar.edu.ar' },
  { icon: Phone, label: 'Teléfono', valor: '+54 362 4000000' },
]

export default function ContactoPage() {
  return (
    <>
      <section className="pt-24 pb-16 bg-brand-900 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: "url('/bienestar-hero.png')", backgroundSize: 'cover', backgroundPosition: 'center 70%' }} aria-hidden="true" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="max-w-xl">
            <p className="text-accent-400 font-semibold text-sm uppercase tracking-widest mb-4">Contacto</p>
            <h1 className="text-5xl font-extrabold text-white tracking-tight text-balance">Hablemos, estamos para ayudarte</h1>
            <p className="mt-4 text-white/80 leading-relaxed">¿Tenés dudas sobre la inscripción, los niveles o el programa? Escribinos o llamanos.</p>
          </div>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid lg:grid-cols-2 gap-16">
          <div className="space-y-10">
            <div>
              <h2 className="text-2xl font-extrabold text-neutral-900 tracking-tight mb-6">Información de contacto</h2>
              <div className="space-y-4">
                {infoContacto.map((item) => {
                  const Icon = item.icon
                  return (
                    <div key={item.label} className="flex items-start gap-4">
                      <div className="w-10 h-10 bg-brand-50 rounded-xl flex items-center justify-center shrink-0">
                        <Icon size={20} weight="fill" className="text-brand-500" />
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">{item.label}</p>
                        <p className="text-neutral-800 font-medium mt-0.5">{item.valor}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="flex gap-3 flex-wrap">
              {[
                { icon: WhatsappLogo, label: 'WhatsApp', href: 'https://wa.me/5436240000000?text=Hola,%20quiero%20información', color: 'bg-green-500 hover:bg-green-600' },
                { icon: InstagramLogo, label: 'Instagram', href: 'https://instagram.com/educarparatransformar', color: 'bg-pink-500 hover:bg-pink-600' },
                { icon: FacebookLogo, label: 'Facebook', href: 'https://facebook.com/educarparatransformar', color: 'bg-blue-600 hover:bg-blue-700' },
              ].map((red) => {
                const Icon = red.icon
                return (
                  <a key={red.label} href={red.href} target="_blank" rel="noopener noreferrer"
                    className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-white text-sm font-semibold transition-colors duration-200 ${red.color}`}>
                    <Icon size={20} weight="fill" />{red.label}
                  </a>
                )
              })}
            </div>

            <div className="rounded-2xl overflow-hidden aspect-[16/9] bg-neutral-100 border border-neutral-200 relative"
              style={{ backgroundImage: "url('/mision-colegio.png')", backgroundSize: 'cover', backgroundPosition: 'center' }}>
              <div className="absolute inset-0 bg-brand-900/20 flex items-center justify-center">
                <div className="bg-white/90 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                  <MapPin size={24} weight="fill" className="text-brand-500 mx-auto mb-1" />
                  <p className="text-sm font-semibold text-neutral-800">Resistencia, Chaco</p>
                  <a href="https://maps.google.com/?q=Resistencia,Chaco,Argentina" target="_blank" rel="noopener noreferrer"
                    className="text-xs text-brand-600 hover:underline">Ver en Google Maps</a>
                </div>
              </div>
            </div>
          </div>

            <div className="bg-white border border-neutral-200 rounded-2xl p-8 space-y-4">
            <h2 className="text-2xl font-extrabold text-neutral-900 tracking-tight">Canales de contacto</h2>
            <p className="text-neutral-500 text-sm">Elegí el canal que te resulte mas comodo.</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <a
                href="https://wa.me/5436240000000?text=Hola,%20quiero%20información%20sobre%20inscripciones"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 p-3 rounded-xl border border-neutral-200 hover:border-green-300 hover:bg-green-50 transition-colors"
              >
                <div className="w-10 h-10 bg-green-500 rounded-xl flex items-center justify-center shrink-0">
                  <WhatsappLogo size={20} weight="fill" className="text-white" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-neutral-800">WhatsApp</p>
                  <p className="text-xs text-neutral-500">Respuesta rapida</p>
                </div>
              </a>
              <a
                href="mailto:info@educarparatransformar.edu.ar"
                className="flex items-center gap-3 p-3 rounded-xl border border-neutral-200 hover:border-brand-300 hover:bg-brand-50 transition-colors"
              >
                <div className="w-10 h-10 bg-brand-500 rounded-xl flex items-center justify-center shrink-0">
                  <Envelope size={20} weight="fill" className="text-white" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-neutral-800">Email</p>
                  <p className="text-xs text-neutral-500">Escribinos cuando quieras</p>
                </div>
              </a>
              <a
                href="tel:+543624000000"
                className="flex items-center gap-3 p-3 rounded-xl border border-neutral-200 hover:border-brand-300 hover:bg-brand-50 transition-colors"
              >
                <div className="w-10 h-10 bg-brand-500 rounded-xl flex items-center justify-center shrink-0">
                  <Phone size={20} weight="fill" className="text-white" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-neutral-800">Telefono</p>
                  <p className="text-xs text-neutral-500">Lun a Vie 7:30 a 17:30</p>
                </div>
              </a>
              <a
                href="https://maps.google.com/?q=Resistencia,Chaco,Argentina"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 p-3 rounded-xl border border-neutral-200 hover:border-brand-300 hover:bg-brand-50 transition-colors"
              >
                <div className="w-10 h-10 bg-brand-500 rounded-xl flex items-center justify-center shrink-0">
                  <MapPin size={20} weight="fill" className="text-white" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-neutral-800">Ubicacion</p>
                  <p className="text-xs text-neutral-500">Ver en Google Maps</p>
                </div>
              </a>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
