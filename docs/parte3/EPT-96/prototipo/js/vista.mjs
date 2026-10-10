// EPT-96 · Piezas de interfaz. Todo el DOM se construye con createElement/textContent:
// nunca se interpreta texto como HTML, de modo que un dato ficticio no puede inyectar marcado.
import { formatoArs } from './dinero.mjs'

const BOOLEANAS = new Set(['disabled', 'checked', 'hidden', 'required', 'open', 'readOnly', 'selected'])
const PROPIEDADES = new Set(['value', 'checked', 'disabled', 'open', 'selected', 'readOnly'])

export function h(etiqueta, props = {}, ...hijos) {
  const el = document.createElement(etiqueta)
  for (const [clave, valor] of Object.entries(props)) {
    if (valor === undefined || valor === null || valor === false) continue
    if (clave === 'class') el.className = valor
    else if (clave.startsWith('on')) el.addEventListener(clave.slice(2).toLowerCase(), valor)
    else if (PROPIEDADES.has(clave)) el[clave] = valor
    else if (BOOLEANAS.has(clave)) el.setAttribute(clave, '')
    else el.setAttribute(clave, valor === true ? '' : String(valor))
  }
  for (const hijo of hijos.flat(Infinity)) {
    if (hijo === null || hijo === undefined || hijo === false) continue
    el.append(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)))
  }
  return el
}

const SVG = 'http://www.w3.org/2000/svg'
const TRAZOS = {
  reloj: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  parcial: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.5"/>',
  alerta: '<path d="M12 3L2.5 20h19z"/><path d="M12 10v5M12 17.5v.5"/>',
  ojo: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  candado: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  usuario: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
  cuotas: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/>',
  facturas: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  deuda: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
  inscr: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  archivo: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/>',
  equis: '<path d="M6 6l12 12M18 6L6 18"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  tilde: '<path d="M6 12.5l4 4 8-9"/>',
}
// Los trazos son constantes de este módulo; se interpretan con DOMParser como SVG, no como HTML.
export function icono(nombre, tam = 18) {
  const svg = document.createElementNS(SVG, 'svg')
  for (const [k, v] of Object.entries({ 'aria-hidden': 'true', width: tam, height: tam, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': '2.2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', focusable: 'false' })) svg.setAttribute(k, String(v))
  const doc = new DOMParser().parseFromString(`<svg xmlns="${SVG}">${TRAZOS[nombre]}</svg>`, 'image/svg+xml')
  for (const nodo of doc.documentElement.childNodes) svg.append(document.importNode(nodo, true))
  return svg
}

export const ESTADO_FACTURA = {
  pendiente: ['Pendiente', 'reloj', 'b-pendiente'],
  parcial: ['Pago parcial', 'parcial', 'b-parcial'],
  pagada: ['Pagada', 'check', 'b-pagada'],
  vencida: ['Vencida', 'alerta', 'b-vencida'],
}
export const ESTADO_ITEM = {
  pagado: ['Pagado', 'check', 'b-pagada'],
  pendiente: ['Pendiente', 'reloj', 'b-pendiente'],
  verificacion: ['En verificación', 'ojo', 'b-verif'],
}
export const ESTADO_PAGO = {
  aprobado: ['Aprobado', 'check', 'b-pagada'],
  pendiente: ['Pendiente de verificación', 'ojo', 'b-verif'],
  rechazado: ['Rechazado', 'alerta', 'b-vencida'],
}

// Texto + ícono + trazo: el estado nunca depende solo del color.
export const insignia = ([texto, ic, clase]) => h('span', { class: `badge ${clase}` }, icono(ic, 16), texto)
export const importe = centavos => h('span', { class: 'mono' }, formatoArs(centavos))
export const fila = (etiqueta, valor, fuerte = false) =>
  h('div', { class: 'row' }, h('span', { class: 'muted' }, fuerte ? h('strong', {}, etiqueta) : etiqueta), fuerte ? h('strong', {}, valor) : h('span', {}, valor))

export function alerta(tipo, ic, ...contenido) {
  return h('div', { class: `alert ${tipo}` }, icono(ic, 20), h('div', {}, ...contenido))
}

// Campo con etiqueta persistente y error asociado (aria-describedby + aria-invalid).
export function campo({ id, etiqueta, valor = '', error = '', ayuda = '', deshabilitado = false, placeholder = '', modo = 'text', alCambiar = null, requerido = false }) {
  const describe = [error ? `${id}-error` : null, ayuda ? `${id}-ayuda` : null].filter(Boolean).join(' ')
  const entrada = h('input', {
    id, name: id, type: 'text', inputmode: modo, autocomplete: 'off', value: valor, placeholder, disabled: deshabilitado,
    class: `entrada${error ? ' err' : ''}`, 'aria-invalid': error ? 'true' : null, 'aria-describedby': describe || null, 'aria-required': requerido ? 'true' : null,
    oninput: alCambiar,
  })
  return h('div', { class: 'field' },
    h('label', { for: id }, etiqueta),
    entrada,
    error ? h('div', { class: 'err-txt', id: `${id}-error` }, icono('alerta', 18), h('span', {}, error)) : null,
    ayuda ? h('div', { class: 'ayuda', id: `${id}-ayuda` }, ayuda) : null)
}

export const boton = (texto, { clase = '', alClick = null, tipo = 'button', descrito = null, inactivo = false, id = null } = {}) =>
  h('button', { type: tipo, class: `btn ${clase}${inactivo ? ' off' : ''}`.trim(), onclick: alClick, 'aria-disabled': inactivo ? 'true' : null, 'aria-describedby': descrito, id }, texto)
export const enlace = (texto, href, { clase = 'link', actual = false } = {}) =>
  h('a', { href, class: clase, 'aria-current': actual ? 'page' : null }, texto)
export const enlaceBoton = (texto, href, clase = '') => h('a', { href, class: `btn ${clase}`.trim() }, texto)
