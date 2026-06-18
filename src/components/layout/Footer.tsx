import Link from 'next/link'
import { WhatsappLogo, InstagramLogo, FacebookLogo, MapPin, Phone, Envelope } from '@phosphor-icons/react/dist/ssr'

export function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="bg-brand-900 text-white">
      {/* Franja de colores institucionales */}
      <div className="h-1.5 bg-gradient-to-r from-accent-500 via-brand-500 via-green-500 to-accent-500" />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10">
          {/* Brand */}
          <div className="lg:col-span-1">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center p-1 shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo-emblema.png" alt="Educar para Transformar" className="w-full h-full object-contain" />
              </div>
              <div>
                <p className="font-bold text-white leading-tight text-sm">Educar para</p>
                <p className="font-bold text-brand-300 leading-tight text-sm">Transformar</p>
              </div>
            </div>
            <p className="text-neutral-300 text-sm leading-relaxed max-w-[260px]">
              Centro educativo de excelencia. Formando ciudadanos críticos, comprometidos y preparados para el futuro.
            </p>
            <div className="flex items-center gap-3 mt-6">
              <a
                href="https://wa.me/5491112345678"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="WhatsApp"
                className="w-9 h-9 rounded-lg bg-brand-800 hover:bg-green-600 flex items-center justify-center transition-colors duration-200"
              >
                <WhatsappLogo size={18} weight="fill" />
              </a>
              <a
                href="https://instagram.com"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Instagram"
                className="w-9 h-9 rounded-lg bg-brand-800 hover:bg-pink-600 flex items-center justify-center transition-colors duration-200"
              >
                <InstagramLogo size={18} weight="fill" />
              </a>
              <a
                href="https://facebook.com"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Facebook"
                className="w-9 h-9 rounded-lg bg-brand-800 hover:bg-blue-600 flex items-center justify-center transition-colors duration-200"
              >
                <FacebookLogo size={18} weight="fill" />
              </a>
            </div>
          </div>

          {/* Links */}
          <div>
            <h3 className="font-semibold text-white mb-4 text-sm tracking-wide uppercase">Institución</h3>
            <ul className="space-y-2.5">
              {[
                ['Quiénes Somos', '/quienes-somos'],
                ['Niveles Educativos', '/niveles'],
                ['Bienestar Estudiantil', '/bienestar'],
                ['Galería', '/galeria'],
                ['Trabajá con Nosotros', '/empleo'],
              ].map(([label, href]) => (
                <li key={href}>
                  <Link
                    href={href}
                    className="text-neutral-300 hover:text-white text-sm transition-colors duration-150"
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Niveles */}
          <div>
            <h3 className="font-semibold text-white mb-4 text-sm tracking-wide uppercase">Niveles</h3>
            <ul className="space-y-2.5">
              {['Inicial', 'Primario', 'Secundario', 'Jornada Extendida', 'Actividades Deportivas'].map((item) => (
                <li key={item}>
                  <Link
                    href="/niveles"
                    className="text-neutral-300 hover:text-white text-sm transition-colors duration-150"
                  >
                    {item}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contacto */}
          <div>
            <h3 className="font-semibold text-white mb-4 text-sm tracking-wide uppercase">Contacto</h3>
            <ul className="space-y-3">
              <li className="flex items-start gap-2.5 text-neutral-300 text-sm">
                <MapPin size={16} className="mt-0.5 shrink-0 text-accent-400" weight="fill" />
                <span>Resistencia, Chaco, Argentina</span>
              </li>
              <li className="flex items-center gap-2.5 text-neutral-300 text-sm">
                <Phone size={16} className="shrink-0 text-accent-400" weight="fill" />
                <a href="tel:+5491112345678" className="hover:text-white transition-colors">
                  +54 9 362 412-3456
                </a>
              </li>
              <li className="flex items-center gap-2.5 text-neutral-300 text-sm">
                <Envelope size={16} className="shrink-0 text-accent-400" weight="fill" />
                <a href="mailto:info@educarparatransformar.edu.ar" className="hover:text-white transition-colors">
                  info@educarparatransformar.edu.ar
                </a>
              </li>
            </ul>
            <div className="mt-6">
              <Link
                href="/inscripcion"
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-accent-500 hover:bg-accent-600 text-white text-sm font-semibold rounded-lg transition-colors duration-150"
              >
                Pre-inscripción 2027
              </Link>
            </div>
          </div>
        </div>

        <div className="border-t border-white/10 mt-12 pt-8 flex flex-col sm:flex-row justify-between items-center gap-4">
          <p className="text-neutral-400 text-xs">
            {year} Educar para Transformar. Todos los derechos reservados.
          </p>
          <p className="text-neutral-400 text-xs">
            Desarrollado por el equipo LAMA — UTN FRRE
          </p>
        </div>
      </div>
    </footer>
  )
}
