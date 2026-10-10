// EPT-96 · Prototipo navegable (móvil). Estado en memoria, ruteo por hash, guardas por rol.
// Todo es simulado: sin red, sin persistencia, sin autenticación real. Las guardas ilustran el contrato; NO son RLS.
import { crearBase, CUENTAS, ARCHIVOS_EJEMPLO, REFERENCIA } from './datos.mjs'
import { formatoArs, formatoFecha, formatoNumero, parsearFecha, parsearImporte } from './dinero.mjs'
import {
  buscarFactura, buscarPago, canalDe, guardarComprobante, puedeOperar, puedeVerHijo, puedeVerOriginal, registrarPago, totalPago, totalSeleccion, validarComprobante,
} from './reglas.mjs'
import * as P from './pantallas.mjs'
import { boton, h } from './vista.mjs'

const RANGO_PERIODO = { desde: '2026-09-01', hasta: REFERENCIA }
const RANGO_DEUDA = { desde: '2026-09-01', hasta: '2026-10-31' }
const rangoUi = r => ({ ...r, desdeTexto: formatoFecha(r.desde), hastaTexto: formatoFecha(r.hasta), errorDesde: '', errorHasta: '' })

const nuevaSim = () => ({ resultadoEnvio: 'normal', cargaRetenida: false, fallarCarga: 0, sesionExpirada: false })
const nuevaUi = () => ({
  seleccion: [], borrador: null, errorSeleccion: '', revision: null, ultimoEnvio: null, contadorEnvio: 0,
  cuotas: { hijo: null, estado: 'ok', ficha: 0 }, periodo: rangoUi(RANGO_PERIODO), deuda: rangoUi(RANGO_DEUDA),
  loginCorreo: '', loginErrorCampo: '', loginErrorGeneral: false, avisoIngreso: '', enviando: false, rutaAnterior: null, rutaHijo: null, hijoContexto: null,
})
const estado = { db: crearBase(), cuenta: null, sim: nuevaSim(), ui: nuevaUi() }

const raiz = document.getElementById('app')
const anuncios = document.getElementById('anuncios')
const anunciar = texto => { anuncios.textContent = ''; setTimeout(() => { anuncios.textContent = texto }, 30) }
const esperar = ms => new Promise(resolver => setTimeout(resolver, ms))
const ID = /^[a-z0-9-]{1,40}$/u

// ---------- ruteo ----------
function analizar(hash) {
  const partes = hash.replace(/^#\/?/u, '').split('/').filter(Boolean)
  if (partes.length === 0) return { nombre: 'ingreso' }
  if (partes.length === 1 && ['ingreso', 'recuperar', 'bloqueada', 'sesion-expirada', 'canal-web', 'hijos', 'sin-permiso'].includes(partes[0])) return { nombre: partes[0] }
  if (partes[0] !== 'h' || !partes[1] || !ID.test(partes[1])) return { nombre: 'desconocida' }
  const [, hijo, seccion, a, b] = partes
  const base = { hijo }
  if (partes.length === 3 && ['pagar', 'comprobantes', 'periodo', 'deuda', 'inscripciones'].includes(seccion)) return { ...base, nombre: seccion }
  if (seccion === 'cuotas' && partes.length === 3) return { ...base, nombre: 'cuotas', pestana: 'pendientes' }
  if (seccion === 'cuotas' && partes.length === 4 && a === 'pagadas') return { ...base, nombre: 'cuotas', pestana: 'pagadas' }
  if (seccion === 'factura' && partes.length === 4 && ID.test(a)) return { ...base, nombre: 'factura', id: a }
  if (seccion === 'archivo' && partes.length === 4 && ID.test(a)) return { ...base, nombre: 'archivo', pagoId: a }
  if (seccion === 'pago' && ID.test(a ?? '')) {
    if (partes.length === 4) return { ...base, nombre: 'pago', pagoId: a }
    if (partes.length === 5 && ['comprobante', 'enviado', 'incierto'].includes(b)) return { ...base, nombre: `pago-${b}`, pagoId: a }
  }
  return { nombre: 'desconocida' }
}

const inicio = () => {
  const { cuenta } = estado
  if (!cuenta) return '#/ingreso'
  if (canalDe(cuenta.rol) === 'web') return '#/canal-web'
  return cuenta.rol === 'PADRE' ? '#/hijos' : `#/h/${cuenta.hijo}/cuotas`
}

// Devuelve { ruta, params } o { redirigir }. Ninguna pantalla económica se resuelve sin sesión, vínculo y rol.
function resolver(hash) {
  const r = analizar(hash)
  const { cuenta, db, sim } = estado
  if (['ingreso', 'recuperar', 'bloqueada', 'sesion-expirada'].includes(r.nombre)) {
    if (cuenta) cerrarSesion() // llegar a una pantalla de acceso cierra la sesión vigente: nunca conviven con otra cuenta
    return { ruta: r }
  }
  if (!cuenta) {
    estado.ui.avisoIngreso = 'Iniciá sesión para continuar.'
    return { redirigir: '#/ingreso' }
  }
  if (sim.sesionExpirada) { cerrarSesion(); return { redirigir: '#/sesion-expirada' } }
  if (r.nombre === 'desconocida') return { redirigir: inicio() }
  if (canalDe(cuenta.rol) === 'web') return r.nombre === 'canal-web' ? { ruta: r } : { redirigir: '#/canal-web' }
  if (r.nombre === 'canal-web') return { redirigir: inicio() }
  if (r.nombre === 'sin-permiso') return { ruta: r }
  if (r.nombre === 'hijos') return cuenta.rol === 'PADRE' ? { ruta: r } : { redirigir: '#/sin-permiso' }
  const denegado = { redirigir: '#/sin-permiso' }
  if (!puedeVerHijo(cuenta, r.hijo)) return denegado
  const operativas = ['pagar', 'pago', 'pago-comprobante', 'pago-enviado', 'pago-incierto', 'archivo']
  if (operativas.includes(r.nombre) && !puedeOperar(cuenta, r.hijo)) return denegado
  if (r.nombre === 'factura') { const f = buscarFactura(db, r.id); return f && f.hijo === r.hijo ? { ruta: r } : denegado }
  if (r.pagoId) {
    const pago = buscarPago(db, r.pagoId)
    if (!pago || pago.hijo !== r.hijo) return denegado
    if (r.nombre === 'archivo') return puedeVerOriginal(cuenta, pago) && pago.comprobantes.length > 0 ? { ruta: r, pago } : denegado
    if (pago.cargador !== cuenta.correo) return denegado
    const lista = { redirigir: `#/h/${r.hijo}/comprobantes` }
    const { ultimoEnvio, revision } = estado.ui
    // Solo un pago pendiente de verificación admite registro, comprobante o confirmación.
    if (pago.estado !== 'pendiente') return lista
    if (r.nombre === 'pago-enviado' && (pago.operacion === null || pago.comprobantes.length === 0)) return { redirigir: `#/h/${r.hijo}/pago/${pago.id}` }
    if (r.nombre === 'pago-incierto' && ultimoEnvio?.pagoId !== pago.id) return lista
    // Con un envío incierto sin releer, el formulario no se reabre: primero se revisa el estado (evita duplicar).
    if (r.nombre === 'pago-comprobante' && ultimoEnvio?.pagoId === pago.id && revision === null) return { redirigir: `#/h/${r.hijo}/pago/${pago.id}/incierto` }
    return { ruta: r, pago }
  }
  return { ruta: r }
}

// ---------- contexto: se limpia lo incompatible al cambiar de hijo o salir de un flujo ----------
function ajustarContexto(r) {
  const { ui } = estado
  if (r.hijo !== ui.hijoContexto) {
    ui.seleccion = []; ui.borrador = null; ui.errorSeleccion = ''; ui.revision = null; ui.ultimoEnvio = null
    ui.periodo = rangoUi(RANGO_PERIODO); ui.deuda = rangoUi(RANGO_DEUDA)
    ui.hijoContexto = r.hijo ?? null
  }
  // El borrador sobrevive solo entre el formulario y la pantalla de resultado incierto; todo lo demás lo descarta.
  if (!['pago-comprobante', 'pago-incierto'].includes(r.nombre)) ui.borrador = null
  if (!['pago-comprobante', 'pago-incierto', 'pago-enviado'].includes(r.nombre)) { ui.revision = null; ui.ultimoEnvio = null }
  if (r.nombre !== 'pagar') { ui.seleccion = []; ui.errorSeleccion = '' }
  // Los filtros sin aplicar no sobreviven a la salida de su pantalla (solo queda el rango aplicado).
  if (r.nombre !== 'periodo') ui.periodo = rangoUi(ui.periodo)
  if (r.nombre !== 'deuda') ui.deuda = rangoUi(ui.deuda)
  if (r.nombre === 'pago-comprobante' && (!ui.borrador || ui.borrador.pagoId !== r.pagoId)) {
    const pago = buscarPago(estado.db, r.pagoId)
    ui.borrador = { pagoId: r.pagoId, archivos: [], fecha: formatoFecha(REFERENCIA), importe: formatoNumero(totalPago(estado.db, pago)), operacion: '', errores: {} }
  }
}

// ---------- solicitudes simuladas ----------
class SesionExpirada extends Error {}
async function solicitar() {
  await esperar(40)
  if (estado.sim.sesionExpirada) throw new SesionExpirada()
}
function cerrarSesion() {
  estado.cuenta = null
  estado.ui = nuevaUi()
  estado.sim.sesionExpirada = false
}
async function conSesion(fn) {
  try { return await fn() } catch (error) {
    if (!(error instanceof SesionExpirada)) throw error
    cerrarSesion(); ir('#/sesion-expirada'); return undefined
  }
}

// ---------- acciones ----------
function ir(hash) { if (location.hash === hash) render({ navegacion: true }); else location.hash = hash }

async function cargarCuotas(hijo) {
  const { ui, sim } = estado
  const ficha = ui.cuotas.ficha + 1
  ui.cuotas = { hijo, estado: 'cargando', ficha }
  render()
  await conSesion(async () => {
    await solicitar()
    if (ui.cuotas.ficha !== ficha) return
    if (sim.fallarCarga > 0) { sim.fallarCarga -= 1; ui.cuotas.estado = 'error' }
    else if (sim.cargaRetenida) return
    else ui.cuotas.estado = 'ok'
    render({ foco: ui.cuotas.estado === 'error' && ui.rutaAnterior === 'cuotas' ? 'reintentar' : null })
    if (ui.cuotas.estado === 'ok') anunciar('Cuotas cargadas.')
  })
}

const actualizarTotal = () => {
  const { db, ui } = estado
  const total = totalSeleccion(db, ui.hijoContexto, ui.seleccion)
  const centavos = total.total ?? 0
  const t = document.getElementById('total-seleccion'), c = document.getElementById('cantidad-seleccion')
  if (t) t.textContent = formatoArs(centavos)
  if (c) c.textContent = `${ui.seleccion.length} ${ui.seleccion.length === 1 ? 'ítem seleccionado' : 'ítems seleccionados'} · calculado por el sistema`
}

const ctx = {
  estado,
  get hijoActual() { return estado.ui.hijoContexto },
  inicio, ir, anunciar, cargarCuotas,
  salir() { estado.ui = nuevaUi(); estado.ui.avisoIngreso = 'Cerraste la sesión.'; estado.cuenta = null; estado.sim.sesionExpirada = false; ir('#/ingreso') },
  entrar(correo) {
    const { ui } = estado
    estado.cuenta = null // un intento de ingreso nunca conserva la sesión anterior
    const texto = String(correo).trim()
    ui.loginCorreo = texto; ui.loginErrorCampo = ''; ui.loginErrorGeneral = false; ui.avisoIngreso = ''
    if (!texto) ui.loginErrorCampo = 'Ingresá tu correo electrónico.'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(texto)) ui.loginErrorCampo = 'Ingresá un correo con formato válido, por ejemplo nombre@correo.com.'
    else {
      const cuenta = CUENTAS.find(c => c.correo === texto.toLowerCase())
      if (!cuenta) ui.loginErrorGeneral = true // mismo mensaje para cualquier credencial inválida
      else if (cuenta.bloqueada) { estado.ui = nuevaUi(); ir('#/bloqueada'); return }
      else { estado.cuenta = cuenta; estado.sim.sesionExpirada = false; estado.ui = nuevaUi(); ir(inicio()); return }
    }
    render({ foco: ui.loginErrorCampo ? 'correo' : 'alerta-ingreso' })
  },
  alternarItem(id) {
    const { ui } = estado
    ui.seleccion = ui.seleccion.includes(id) ? ui.seleccion.filter(i => i !== id) : [...ui.seleccion, id]
    ui.errorSeleccion = ''
    actualizarTotal()
  },
  async registrarPago(hijo) {
    const { db, cuenta, ui } = estado
    if (!db.banco.configurado && !db.banco.simulado) { anunciar('Registrar pago está bloqueado: los datos bancarios no están configurados.'); return }
    await conSesion(async () => {
      await solicitar()
      const r = registrarPago(db, cuenta, hijo, ui.seleccion)
      if (r.error) { ui.errorSeleccion = r.error; render({ foco: 'alerta-seleccion' }); return }
      ui.seleccion = []
      ir(`#/h/${hijo}/pago/${r.pago.id}`)
    })
  },
  cancelarSeleccion(hijo) { estado.ui.seleccion = []; ir(`#/h/${hijo}/cuotas`) },
  cancelarBorrador(hijo) { estado.ui.borrador = null; ir(`#/h/${hijo}/comprobantes`) },
  agregarArchivo(id) {
    const { borrador } = estado.ui
    const ejemplo = ARCHIVOS_EJEMPLO.find(a => a.id === id)
    if (!ejemplo || borrador.archivos.some(a => a.id === id)) { anunciar('Ese archivo ya está agregado.'); return }
    borrador.archivos.push({ ...ejemplo }); borrador.errores = {}
    render({ foco: 'h-archivos' }); anunciar(`Archivo agregado: ${ejemplo.nombre}.`)
  },
  quitarArchivo(indice) {
    const { borrador } = estado.ui
    const [quitado] = borrador.archivos.splice(indice, 1)
    render({ foco: 'h-archivos' }); anunciar(`Archivo quitado: ${quitado.nombre}.`)
  },
  async enviarComprobante(pagoId) {
    const { db, ui } = estado
    const b = ui.borrador, pago = buscarPago(db, pagoId)
    if (!b || b.pagoId !== pagoId || ui.enviando) return
    const errores = validarComprobante(db, pago, b)
    if (Object.keys(errores).length) {
      b.errores = errores; render({ foco: errores.fecha ? 'fecha' : errores.importe ? 'importe' : errores.operacion ? 'operacion' : 'h-archivos' })
      anunciar('Revisá los datos marcados para continuar.'); return
    }
    b.errores = {}
    await ejecutarEnvio(pagoId, estado.sim.resultadoEnvio)
  },
  async reintentarEnvio(pagoId) { if (estado.ui.borrador?.pagoId === pagoId) await ejecutarEnvio(pagoId, 'normal') },
  async revisarEstado(pagoId) {
    const { db, ui } = estado
    await conSesion(async () => {
      await solicitar() // relectura del estado en el servidor simulado antes de ofrecer reintento
      const pago = buscarPago(db, pagoId)
      ui.revision = pago.comprobantes.some(c => c.envio === ui.ultimoEnvio.envioId) ? 'recibido' : 'no-recibido'
      if (ui.revision === 'recibido') ui.borrador = null
      render({ foco: 'h1' }); anunciar(ui.revision === 'recibido' ? 'El comprobante figura como recibido.' : 'El comprobante no figura como recibido.')
    })
  },
  aplicarRango(clave) {
    const f = estado.ui[clave]
    const desde = parsearFecha(f.desdeTexto), hasta = parsearFecha(f.hastaTexto)
    f.errorDesde = desde ? '' : 'Ingresá una fecha válida con el formato dd/mm/aaaa.'
    f.errorHasta = hasta ? '' : 'Ingresá una fecha válida con el formato dd/mm/aaaa.'
    if (desde && hasta && desde > hasta) f.errorHasta = 'La fecha final no puede ser anterior a la inicial.'
    if (!f.errorDesde && !f.errorHasta) { f.desde = desde; f.hasta = hasta; anunciar('Rango aplicado.') }
    render({ foco: f.errorDesde ? `${clave}-desde` : f.errorHasta ? `${clave}-hasta` : `${clave}-aplicar` })
  },
}

async function ejecutarEnvio(pagoId, modo) {
  const { db, cuenta, ui, sim } = estado
  const b = ui.borrador
  if (!b || b.pagoId !== pagoId) return
  if (ui.enviando) return // un envío en curso: un segundo clic no puede duplicar el comprobante
  ui.enviando = true
  try { await conSesion(async () => {
    await solicitar()
    // Se canceló, se salió del formulario o se cerró la sesión mientras se enviaba: no se guarda nada.
    if (ui.borrador !== b || estado.ui !== ui || estado.cuenta !== cuenta) return
    sim.resultadoEnvio = 'normal' // el escenario aplica a un único envío
    ui.contadorEnvio += 1
    const envioId = `e${ui.contadorEnvio}`
    const pago = buscarPago(db, pagoId)
    ui.ultimoEnvio = { envioId, pagoId, archivos: b.archivos.map(a => ({ nombre: a.nombre })), importe: pago.importeInformado ?? parsearImporte(b.importe), operacion: pago.operacion ?? b.operacion.trim() }
    ui.revision = null
    if (modo === 'incierto-no-guardo') { ir(`#/h/${pago.hijo}/pago/${pagoId}/incierto`); return }
    const antes = pago.comprobantes.length
    const r = guardarComprobante(db, cuenta, pagoId, b)
    if (r.errores) { b.errores = r.errores; render({ foco: 'h1' }); return }
    pago.comprobantes.slice(antes).forEach(c => { c.envio = envioId })
    if (modo === 'incierto-guardo') { ir(`#/h/${pago.hijo}/pago/${pagoId}/incierto`); return }
    ui.borrador = null
    ui.ultimoEnvio = null // un envío exitoso no deja un resultado incierto pendiente
    ui.revision = null
    ir(`#/h/${pago.hijo}/pago/${pagoId}/enviado`)
  }) } finally { ui.enviando = false }
}

// ---------- render ----------
const TITULOS = {
  ingreso: 'Ingreso', recuperar: 'Recuperar contraseña', bloqueada: 'Cuenta bloqueada', 'sesion-expirada': 'Sesión expirada', 'canal-web': 'Canal web', hijos: 'Mis hijos',
  'sin-permiso': 'Sin acceso', cuotas: 'Cuotas', factura: 'Detalle de factura', pagar: 'Pagar ítems', pago: 'Pago registrado', 'pago-comprobante': 'Cargar comprobante',
  'pago-enviado': 'Comprobante enviado', 'pago-incierto': 'Resultado incierto', comprobantes: 'Pagos y comprobantes', archivo: 'Vista simulada del comprobante',
  periodo: 'Facturas por período', deuda: 'Deuda por ítem', inscripciones: 'Inscripciones',
}

let profundidad = 0
export function render({ navegacion = false, foco = null } = {}) {
  const destino = resolver(location.hash)
  if (destino.redirigir) {
    if (++profundidad > 5) { profundidad = 0; raiz.replaceChildren(h('p', {}, 'No fue posible resolver la pantalla.')); return }
    history.replaceState(null, '', destino.redirigir)
    render({ navegacion: true, foco }); profundidad = 0; return
  }
  profundidad = 0
  const { ruta: r, pago } = destino
  const anterior = estado.ui.rutaAnterior
  ajustarContexto(r)
  const entra = navegacion || anterior !== r.nombre || estado.ui.rutaHijo !== r.hijo
  if (r.nombre === 'cuotas' && (entra && (anterior !== 'cuotas' || estado.ui.cuotas.hijo !== r.hijo))) { estado.ui.rutaAnterior = r.nombre; estado.ui.rutaHijo = r.hijo; cargarCuotas(r.hijo); return }
  estado.ui.rutaAnterior = r.nombre; estado.ui.rutaHijo = r.hijo
  const p = { hijo: r.hijo, pestana: r.pestana, id: r.id, pago }
  const mapa = {
    ingreso: () => P.ingreso(ctx), 'sesion-expirada': () => P.ingreso(ctx, { variante: 'expirada' }), recuperar: () => P.recuperar(ctx), bloqueada: () => P.bloqueada(ctx),
    'canal-web': () => P.canalWeb(ctx), hijos: () => P.selector(ctx), 'sin-permiso': () => P.sinPermiso(ctx), cuotas: () => P.cuotas(ctx, p), factura: () => P.factura(ctx, p),
    pagar: () => P.pagar(ctx, p), pago: () => P.pagoRegistrado(ctx, p), 'pago-comprobante': () => P.comprobante(ctx, p), 'pago-enviado': () => P.comprobanteEnviado(ctx, p),
    'pago-incierto': () => P.comprobanteIncierto(ctx, p), comprobantes: () => P.comprobantes(ctx, p), archivo: () => P.archivo(ctx, p), periodo: () => P.periodo(ctx, p),
    deuda: () => P.deuda(ctx, p), inscripciones: () => P.inscripciones(ctx, p),
  }
  raiz.replaceChildren(mapa[r.nombre]())
  document.title = `${TITULOS[r.nombre]} · Prototipo EPT-96`
  raiz.dataset.pantalla = r.nombre
  const objetivo = foco === 'h1' || (foco === null && entra) ? raiz.querySelector('h1') : foco ? (document.getElementById(foco) ?? raiz.querySelector('[role="alert"]') ?? raiz.querySelector('h1')) : null
  if (objetivo && !objetivo.hasAttribute('tabindex') && !['A', 'BUTTON', 'INPUT', 'SELECT'].includes(objetivo.tagName)) objetivo.setAttribute('tabindex', '-1')
  objetivo?.focus()
  if (entra) anunciar(`${TITULOS[r.nombre]}.`)
}

// ---------- panel de simulación ----------
function construirPanel() {
  const panel = document.getElementById('simulacion')
  const bancoInput = h('input', { type: 'checkbox', id: 'sim-banco', onchange: e => { estado.db.banco.simulado = e.target.checked; anunciar(e.target.checked ? 'Escenario simulado de datos bancarios habilitado.' : 'Escenario simulado deshabilitado.'); render() } })
  const envio = h('select', { id: 'sim-envio', onchange: e => { estado.sim.resultadoEnvio = e.target.value } },
    h('option', { value: 'normal' }, 'Normal'), h('option', { value: 'incierto-guardo' }, 'Incierto: el sistema sí lo guardó'), h('option', { value: 'incierto-no-guardo' }, 'Incierto: el sistema no lo guardó'))
  const retener = h('input', { type: 'checkbox', id: 'sim-carga', onchange: e => {
    estado.sim.cargaRetenida = e.target.checked
    if (!e.target.checked && estado.ui.cuotas.estado === 'cargando') cargarCuotas(estado.ui.cuotas.hijo)
  } })
  const sincronizar = () => { bancoInput.checked = Boolean(estado.db.banco.simulado); envio.value = estado.sim.resultadoEnvio; retener.checked = estado.sim.cargaRetenida }
  panel.replaceChildren(
    h('summary', {}, 'Panel de simulación (no forma parte de la aplicación)'),
    h('p', { class: 'ayuda' }, 'Controles para recorrer escenarios. Los filtros y las guardas del prototipo ilustran el contrato: no equivalen a autorización productiva ni a RLS.'),
    h('div', { class: 'sim-fila' }, bancoInput, h('label', { for: 'sim-banco' }, 'Habilitar escenario simulado de registro de pago (datos bancarios de ejemplo, sin CBU ni alias)')),
    h('div', { class: 'field' }, h('label', { for: 'sim-envio' }, 'Resultado del próximo envío de comprobante'), envio),
    h('div', { class: 'sim-fila' }, retener, h('label', { for: 'sim-carga' }, 'Retener la carga de cuotas (mostrar el estado de carga)')),
    boton('Hacer fallar la próxima carga de cuotas', { clase: 'sec2', id: 'sim-fallar', alClick: () => { estado.sim.fallarCarga = 1; anunciar('La próxima carga de cuotas fallará una vez.') } }),
    boton('Simular sesión expirada', { clase: 'sec2', id: 'sim-expirar', alClick: () => { estado.sim.sesionExpirada = true; render({ navegacion: true }) } }),
    boton('Reiniciar prototipo', { clase: 'sec2', id: 'sim-reiniciar', alClick: () => {
      estado.db = crearBase(); estado.cuenta = null; estado.sim = nuevaSim(); estado.ui = nuevaUi(); sincronizar()
      anunciar('Prototipo reiniciado.'); ir('#/ingreso')
    } }))
  sincronizar()
}

construirPanel()
window.addEventListener('hashchange', () => render({ navegacion: true }))
render({ navegacion: true })
