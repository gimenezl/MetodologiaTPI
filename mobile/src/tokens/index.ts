// Tokens institucionales. Valores idénticos a docs/parte3/EPT-99/tokens.md, que a su vez
// los toma de docs/parte3/EPT-95/fuentes/estilos.css. No se agregan colores nuevos.
export const color = {
  primario50: '#EAF3FF',
  primario100: '#D0E3FF',
  primario200: '#A5C9FF',
  primario500: '#005DCA',
  primario600: '#00459A',
  primario700: '#002F6D',
  neutro50: '#FAFBFF',
  neutro100: '#F3F4F9',
  neutro200: '#E5E7ED',
  neutro300: '#C7C8D0',
  neutro500: '#6B6D74',
  neutro600: '#4D4E53',
  neutro700: '#35363B',
  neutro800: '#1C1D20',
  superficie: '#FFFFFF',
  exito: '#008935',
  exitoTexto: '#00581F',
  exitoFondo: '#E1FAE3',
  advertencia: '#D4A800',
  advertenciaTexto: '#5F4A00',
  advertenciaFondo: '#FFF1CC',
  peligro: '#D81327',
  peligroTexto: '#9E141E',
  peligroFondo: '#FFEDEB',
} as const

export const espacio = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20 } as const
export const radio = { sm: 4, md: 8, lg: 16, pastilla: 999 } as const
export const borde = { fino: 1, insignia: 1.5, control: 2, enfasis: 2.5, estado: 6 } as const
export const tactil = { minimo: 48, casilla: 32, barraInferior: 56 } as const

export type FamiliaTexto = 'texto' | 'mono'
export type PesoTexto = '400' | '500' | '600' | '700'

export interface EstiloTexto {
  familia: FamiliaTexto
  peso: PesoTexto
  tamano: number
  /** Interlineado absoluto (tamaño × factor de `estilos.css`). */
  interlineado?: number
}

export const texto = {
  titulo: { familia: 'texto', peso: '600', tamano: 20, interlineado: 24 },
  tituloEncabezado: { familia: 'texto', peso: '600', tamano: 24, interlineado: 27.6 },
  subtitulo: { familia: 'texto', peso: '600', tamano: 16, interlineado: 22.4 },
  cuerpo: { familia: 'texto', peso: '400', tamano: 16, interlineado: 22.4 },
  etiquetaCampo: { familia: 'texto', peso: '600', tamano: 16, interlineado: 22.4 },
  boton: { familia: 'texto', peso: '600', tamano: 16 },
  seccion: { familia: 'texto', peso: '600', tamano: 14, interlineado: 19.6 },
  insignia: { familia: 'texto', peso: '600', tamano: 14, interlineado: 19.6 },
  aviso: { familia: 'texto', peso: '500', tamano: 15, interlineado: 21 },
  avisoCuerpo: { familia: 'texto', peso: '400', tamano: 15, interlineado: 21 },
  avisoTitulo: { familia: 'texto', peso: '700', tamano: 15, interlineado: 21 },
  pie: { familia: 'texto', peso: '600', tamano: 12 },
  importe: { familia: 'mono', peso: '500', tamano: 16 },
  importeTotal: { familia: 'mono', peso: '600', tamano: 28 },
} as const satisfies Record<string, EstiloTexto>

export type NombreTexto = keyof typeof texto

/** Nombres con los que `useFonts` registra cada archivo de assets/fonts. */
export const nombresDeFuente = {
  'texto-400': 'Outfit_400Regular',
  'texto-500': 'Outfit_500Medium',
  'texto-600': 'Outfit_600SemiBold',
  'texto-700': 'Outfit_700Bold',
  'mono-500': 'GeistMono_500Medium',
  'mono-600': 'GeistMono_600SemiBold',
} as const

/** Único lugar que traduce familia + peso al nombre nativo: en nativo no hay `fontWeight` sobre una familia cargada. */
export function fuente(familia: FamiliaTexto, peso: PesoTexto): string {
  const clave = `${familia}-${peso}`
  const nombre = (nombresDeFuente as Record<string, string | undefined>)[clave]
  if (!nombre) throw new Error(`Combinación de fuente no registrada: ${clave}`)
  return nombre
}

export function estiloDeTexto(nombre: NombreTexto) {
  const t: EstiloTexto = texto[nombre]
  return {
    fontFamily: fuente(t.familia, t.peso),
    fontSize: t.tamano,
    ...(t.interlineado === undefined ? {} : { lineHeight: t.interlineado }),
  }
}
