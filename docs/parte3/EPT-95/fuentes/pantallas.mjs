// EPT-95 · Definición de las pantallas móviles estáticas (datos ficticios, sin red ni scripts).
// Un único conjunto de datos alimenta todas las pantallas: los importes se calculan en centavos.
const NB = String.fromCharCode(160)
const esc = s => String(s).replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
const fmt = c => `${String(Math.floor(c / 100)).replace(/\B(?=(\d{3})+(?!\d))/gu, '.')},${String(c % 100).padStart(2, '0')}`
const ars = c => `<span class="mono">ARS${NB}${fmt(c)}</span>`
export const arsTexto = c => `ARS ${fmt(c)}`
const fecha = iso => iso.split('-').reverse().join('/')
export const REFERENCIA = '2026-10-09'

// ---------- datos ficticios compartidos ----------
const TARIFA = { cuota: 4875035, deporte: 1248020, transporte: 1892545, comedor: 2234060 }
const NOMBRE_ITEM = { cuota: 'Cuota', deporte: 'Deporte · Fútbol', transporte: 'Transporte', comedor: 'Comedor' }
const factura = (id, periodo, vence, items) => {
  const importe = items.reduce((a, [k]) => a + TARIFA[k], 0)
  const saldo = items.reduce((a, [k, e]) => a + (e === 'pagado' ? 0 : TARIFA[k]), 0)
  const estado = saldo === 0 ? 'pagada' : vence < REFERENCIA ? 'vencida' : saldo < importe ? 'parcial' : 'pendiente'
  return { id, periodo, vence, items, importe, saldo, pagado: importe - saldo, estado }
}
const todos = e => ['cuota', 'deporte', 'transporte', 'comedor'].map(k => [k, e])
export const datos = {
  padre: 'Laura Ejemplo', otroPadre: 'Diego Ejemplo',
  mateo: {
    nombre: 'Mateo Ejemplo',
    facturas: [
      factura('sep', 'Septiembre 2026', '2026-09-10', [['cuota', 'pagado'], ['deporte', 'pagado'], ['transporte', 'verif'], ['comedor', 'pendiente']]),
      factura('oct', 'Octubre 2026', '2026-10-10', [['cuota', 'pagado'], ['deporte', 'pagado'], ['transporte', 'pendiente'], ['comedor', 'pendiente']]),
      factura('ago', 'Agosto 2026', '2026-08-10', todos('pagado')),
    ],
  },
  sofia: {
    nombre: 'Sofía Ejemplo',
    facturas: [
      factura('oct', 'Octubre 2026', '2026-10-10', [['cuota', 'pendiente'], ['comedor', 'pendiente']]),
          ],
  },
}
const sum = (...c) => c.reduce((a, b) => a + b, 0)
const F = { sep: datos.mateo.facturas[0], oct: datos.mateo.facturas[1], ago: datos.mateo.facturas[2], sofiaOct: datos.sofia.facturas[0] }
export const cifras = {
  deudaMateo: F.sep.saldo + F.oct.saldo,
  deudaSofia: F.sofiaOct.saldo,
  seleccion: sum(TARIFA.comedor, TARIFA.transporte, TARIFA.comedor), // sept comedor + oct transporte + oct comedor
  aprobadosPeriodo: 2 * (TARIFA.cuota + TARIFA.deporte),
  verificacionPeriodo: TARIFA.transporte,
}

// ---------- piezas ----------
const PATHS = {
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
  camara: '<path d="M3 8h4l2-3h6l2 3h4v12H3z"/><circle cx="12" cy="13" r="4"/>',
  archivo: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/>',
  equis: '<path d="M6 6l12 12M18 6L6 18"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  tilde: '<path d="M6 12.5l4 4 8-9" stroke="#fff"/>',
}
const icon = (n, s = 18) => `<svg aria-hidden="true" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${PATHS[n]}</svg>`
const ESTADO = { pendiente: ['Pendiente', 'reloj', 'b-pendiente'], parcial: ['Pago parcial', 'parcial', 'b-parcial'], pagada: ['Pagada', 'check', 'b-pagada'], vencida: ['Vencida', 'alerta', 'b-vencida'] }
const ITEM = { pagado: ['Pagado', 'check', 'b-pagada'], pendiente: ['Pendiente', 'reloj', 'b-pendiente'], verif: ['En verificación', 'ojo', 'b-verif'] }
const badge = ([t, i, c]) => `<span class="badge ${c}">${icon(i, 16)}${esc(t)}</span>`
const mk = (ctx, texto) => { if (ctx.tema !== 'wire') return ''; ctx.marks.push(texto); return `<span class="mk" aria-hidden="true">${ctx.marks.length}</span>` }
const chip = (txt, extra = '') => { const [nombre, accion] = txt.split(' · '); return `<div class="ctx">${icon('usuario')}<span class="ctx-t"><span>${esc(nombre)}</span>${accion ? `<span class="${accion === 'Cambiar hijo' ? 'ctx-a' : 'ctx-n'}">${esc(accion).replace(/ARS [\d.,]+/u, m => `<span class="mono">${m.replace(' ', NB)}</span>`)}</span>` : ''}${extra}</span></div>` }
const campo = (label, valor, { vacio = false, error = '', ayuda = '', extra = '', foco = false } = {}) =>
  `<div class="field"><label>${esc(label)}</label><div class="input${vacio ? ' vacio' : ''}${error ? ' err' : ''}${foco ? ' foco' : ''}"><span>${valor}</span>${extra}</div>${error ? `<div class="err-txt">${icon('alerta', 18)}<span>${esc(error)}</span></div>` : ''}${ayuda ? `<div class="ayuda">${esc(ayuda)}</div>` : ''}</div>`
const alerta = (tipo, icono, html) => `<div class="alert ${tipo}">${icon(icono, 20)}<div>${html}</div></div>`
const fila = (a, b) => `<div class="row"><span class="muted">${a}</span><span>${b}</span></div>`
const boton = (t, cls = '', extra = '') => `<div class="btn ${cls}">${esc(t)}${extra}</div>`
const pestanas = (on, extra = '') => `<div class="tabs"><div class="tab${on === 0 ? ' on' : ''}">Pendientes${extra}</div><div class="tab${on === 1 ? ' on' : ''}">Pagadas</div></div>`

function cuotaCard(f, ctx, marca = '') {
  return `<div class="card cuota s-${f.estado}"><div class="row"><h3>${esc(f.periodo)}${marca}</h3>${badge(ESTADO[f.estado])}</div>
    ${fila('Vencimiento', `<span class="mono">${fecha(f.vence)}</span>`)}${fila('Importe', ars(f.importe))}${fila('<strong>Saldo</strong>', `<strong>${ars(f.saldo)}</strong>`)}</div>`
}
function itemFila(k, estado, { sel = false, check = false } = {}) {
  const box = check ? `<span class="chk ${sel ? 'on' : estado === 'pendiente' ? '' : 'off'}">${sel ? icon('tilde', 20) : ''}</span>` : ''
  return `<div class="item">${box}<div class="cuerpo"><span>${esc(NOMBRE_ITEM[k])}</span>${badge(ITEM[estado])}</div>${ars(TARIFA[k])}</div>`
}
const NAV = [['cuotas', 'Cuotas', 'cuotas'], ['periodo', 'Período', 'facturas'], ['deuda', 'Deuda', 'deuda'], ['inscripciones', 'Inscripciones', 'inscr']]
const navBar = on => `<nav class="nav" aria-label="Secciones">${NAV.map(([k, t, i]) => `<div class="${k === on ? 'on' : ''}">${icon(i, 22)}<span>${t}</span></div>`).join('')}</nav>`

function shell(ctx, { titulo, sub = 'Familias y estudiantes', body, nav = null, bottom = '' }) {
  const logo = ctx.tema === 'wire' ? '<div class="logo-ph" aria-hidden="true">Logo</div>' : '<img src="../imagenes/logo-emblema.png" alt="Logo institucional de Educar para Transformar">'
  const notas = ctx.tema === 'wire' && ctx.marks.length
    ? `<div class="notas"><h3>Notas del wireframe</h3>${ctx.marks.map((t, i) => `<div><span class="mk">${i + 1}</span><span>${esc(t)}</span></div>`).join('')}</div>` : ''
  return `<div class="app"><div class="safe-top"></div><header class="topbar">${logo}<div><div class="t">${esc(titulo)}</div><div class="s">${esc(sub)}</div></div></header>
<main class="contenido">${body}${notas}</main>${bottom}<div class="pie-ficticio">Diseño estático con datos ficticios. No es la aplicación implementada.</div>${nav ? navBar(nav) : ''}</div>`
}

// ---------- construcción de pantallas ----------
const login = ctx => shell(ctx, { titulo: 'Educar para Transformar', sub: 'Centro educativo', body: `
  <div class="stack"><h2>Ingresá a tu cuenta${mk(ctx, 'Inicio de sesión para PADRE y ESTUDIANTE con correo y contraseña.')}</h2><p class="muted">Para padres, madres y estudiantes.</p></div>
  ${campo('Correo electrónico', 'nombre@correo.com', { vacio: true })}
  ${campo('Contraseña', 'Tu contraseña', { vacio: true, extra: '<span class="link">Mostrar</span>' })}
  <div class="link">¿Olvidaste tu contraseña?${mk(ctx, 'Recuperación de contraseña (RF2).')}</div>
  ${boton('Ingresar')}
  ${alerta('info', 'info', `<strong>¿Sos parte de Dirección, docente o personal?</strong><br>Usá la versión web del sistema.${mk(ctx, 'DIRECTOR, DOCENTE y PERSONAL no ingresan a la app: se los dirige a la web.')}`)}` })

const selector = ctx => shell(ctx, { titulo: 'Mis hijos', body: `
  <div class="stack"><h2>¿De quién querés ver las cuotas?${mk(ctx, 'Solo PADRE. Lista únicamente hijos vinculados; el ESTUDIANTE entra directo a su información.')}</h2></div>
  ${[['mateo', 'vencida', cifras.deudaMateo], ['sofia', 'pendiente', cifras.deudaSofia]].map(([h, e, s]) => `<div class="card"><div class="row"><h3>${esc(datos[h].nombre)}</h3>${badge(ESTADO[e])}</div>
    ${fila('Saldo total adeudado', ars(s))}<div class="link">Ver cuotas${icon('chevron')}</div></div>`).join('')}
  <p class="ayuda">Solo ves a los hijos vinculados a tu cuenta.</p>
  <div class="link">Cerrar sesión${mk(ctx, 'El cierre elimina la sesión del dispositivo y vuelve al inicio.')}</div>` })

const cuotas = (ctx, { hijo = 'mateo', tab = 0, propio = false } = {}) => {
  const fs = datos[hijo].facturas
  const lista = tab === 0 ? fs.filter(f => f.saldo > 0) : fs.filter(f => f.saldo === 0)
  const orden = { vencida: 0, parcial: 1, pendiente: 2, pagada: 3 }
  lista.sort((a, b) => orden[a.estado] - orden[b.estado])
  const saldo = fs.reduce((a, f) => a + f.saldo, 0)
  return shell(ctx, { titulo: propio ? 'Mis cuotas' : 'Cuotas', sub: propio ? 'Estudiante' : 'Familias y estudiantes', nav: 'cuotas', body: `
  ${chip(propio ? `${datos[hijo].nombre} · Información propia` : `${datos[hijo].nombre} · Cambiar hijo`, propio ? '' : mk(ctx, 'Contexto del hijo siempre visible; permite volver al selector.'))}
  ${pestanas(tab, mk(ctx, 'Pestañas Pendientes y Pagadas (HU6).'))}
  <div class="card"><div class="row"><span>Saldo total adeudado</span>${ars(saldo)}</div><span class="ayuda">Datos al ${fecha(REFERENCIA)}</span></div>
  ${lista.map((f, i) => cuotaCard(f, ctx, i === 0 ? mk(ctx, 'Cada cuota: período, vencimiento, importe, saldo y estado. Vencida resaltada y prevalece sobre Pago parcial pasado el día 10.') : '')).join('')}` })
}

const detalleItems = (f, opts) => f.items.map(([k, e]) => itemFila(k, e, opts)).join('')
const factura_ = (ctx, { f = F.sep, estudiante = false } = {}) => shell(ctx, { titulo: 'Detalle de factura', nav: 'cuotas', body: `
  ${chip(estudiante ? `${datos.mateo.nombre} · Información propia` : datos.mateo.nombre)}
  <div class="card cuota s-${f.estado}"><div class="row"><h2>${esc(f.periodo)}</h2>${badge(ESTADO[f.estado])}</div>${fila('Vencimiento', `<span class="mono">${fecha(f.vence)}</span>`)}</div>
  <div class="card"><span class="sec">Ítems${mk(ctx, 'Cuota, deporte, transporte y comedor, cada uno con su estado: pendiente, en verificación o pagado.')}</span>${detalleItems(f, {})}</div>
  <div class="card">${fila('Importe total', ars(f.importe))}${fila('Pagado (aprobado)', ars(f.pagado))}${fila('<strong>Saldo</strong>', `<strong>${ars(f.saldo)}</strong>`)}
    <span class="ayuda">El saldo baja recién cuando Dirección aprueba el pago. Un pago en verificación no está confirmado.</span></div>
  ${estudiante ? alerta('info', 'candado', `<strong>Solo consulta.</strong> El pago y la carga de comprobantes los realiza tu padre o madre vinculado.${mk(ctx, 'ESTUDIANTE no ve acciones de pago ni de carga.')}`)
    : `${boton('Seleccionar ítems para pagar', '', mk(ctx, 'Acción solo para PADRE.'))}`}` })

const seleccion = (ctx, { error = false, ninguno = false } = {}) => {
  const selSep = ninguno ? [] : ['comedor'], selOct = ninguno ? [] : ['transporte', 'comedor']
  const grupo = (f, sel) => `<div class="card"><div class="row"><h3>${esc(f.periodo)}</h3>${badge(ESTADO[f.estado])}</div>${f.items.map(([k, e]) => itemFila(k, e, { check: true, sel: e === 'pendiente' && sel.includes(k) })).join('')}</div>`
  const total = ninguno ? 0 : cifras.seleccion
  return shell(ctx, { titulo: 'Pagar ítems', nav: 'cuotas', body: `
  ${chip(datos.mateo.nombre)}
  <div class="stack"><h2>Elegí los ítems a pagar${mk(ctx, 'Ítems completos, de una o varias facturas del mismo hijo. No hay pagos fraccionados.')}</h2><p class="muted">Los ítems pagados o en verificación no se pueden seleccionar.</p></div>
  ${error ? alerta('error', 'alerta', '<strong>Seleccioná al menos un ítem</strong> para continuar.') : ''}
  ${grupo(F.sep, selSep)}${grupo(F.oct, selOct)}
  <div class="total"><span>Total a transferir${mk(ctx, 'El total lo calcula siempre el sistema; la app no envía importes.')}</span>${ars(total)}<span class="small">${ninguno ? '0 ítems seleccionados' : '3 ítems seleccionados'} · calculado por el sistema</span></div>
  <div class="card"><span class="sec">Datos para la transferencia</span>
    <div class="alert info">${icon('info', 20)}<div><strong>Datos bancarios: no configurados.</strong> Se mostrarán los datos fijos de la institución.${mk(ctx, 'Datos bancarios fijos y no editables desde la app; no se muestran CBU, alias ni titular.')}</div></div>
    <span class="ayuda">No se acepta pago en efectivo.</span></div>
  ${boton('Registrar pago', ninguno ? 'off' : '')}` })
}

const pagoRegistrado = ctx => shell(ctx, { titulo: 'Pago registrado', nav: 'cuotas', body: `
  ${chip(datos.mateo.nombre)}
  ${alerta('info', 'ojo', `<strong>Pago registrado: pendiente de verificación.</strong><br>Los 3 ítems quedan en verificación y el saldo no cambia hasta que Dirección apruebe el pago.${mk(ctx, 'Confirmación sin afirmar pago aprobado.')}`)}
  <div class="card">${fila('Total a transferir', ars(cifras.seleccion))}${fila('Ítems', '3')}${fila('Estado', badge(ITEM.verif).replace('En verificación', 'Pendiente de verificación'))}</div>
  <p class="muted">Ahora podés cargar el comprobante de la transferencia.</p>
  ${boton('Cargar comprobante')}${boton('Volver a cuotas', 'sec2')}` })

const archivoFila = (nombre, peso, { error = '' } = {}) => `<div class="archivo" style="${error ? 'border-color:var(--danger-text);background:var(--danger-bg)' : ''}">${icon('archivo', 24)}<div class="cuerpo"><div>${esc(nombre)}</div><div class="ayuda">${esc(peso)}</div>${error ? `<div class="err-txt">${icon('alerta', 18)}<span>${esc(error)}</span></div>` : ''}</div>${icon('equis', 22)}</div>`
const formulario = (ctx, { teclado = false, errores = false } = {}) => `
  <div class="card"><span class="sec">Archivos${mk(ctx, 'JPG, PNG o PDF, hasta 5 MB por archivo; varios comprobantes por pago.')}</span>
    <div class="btn sec2">${icon('camara', 22)}Tomar foto</div><div class="btn sec2">${icon('archivo', 22)}Elegir imagen o PDF</div>
    <span class="ayuda">JPG, PNG o PDF · máximo 5 MB por archivo · podés adjuntar varios.</span>
    ${errores ? archivoFila('foto-recibo.heic', '2,1 MB', { error: 'Tipo no permitido. Usá un archivo JPG, PNG o PDF.' }) + archivoFila('resumen-banco.pdf', '7,4 MB', { error: 'Supera el máximo de 5 MB por archivo.' }) : archivoFila('transferencia-1.jpg', '1,2 MB')}</div>
  <div class="card"><span class="sec">Datos de la transferencia${mk(ctx, 'Fecha, importe informado y número de operación. El importe informado es dato de conciliación.')}</span>
    ${campo('Fecha de transferencia', '09/10/2026')}
    ${campo('Importe informado (ARS)', `<span class="mono">${fmt(cifras.seleccion)}</span>`, { ayuda: 'Es un dato de conciliación; Dirección decide al verificar.', foco: teclado })}
    ${campo('Número de operación', errores ? '00012345' : 'Ej.: 00098765 (ficticio)', errores ? { error: 'Ese número de operación ya está registrado en otro pago. Revisalo.' } : { vacio: true })}</div>`
const comprobante = (ctx, { errores = false, teclado = false } = {}) => shell(ctx, {
  titulo: 'Cargar comprobante', nav: teclado ? null : 'cuotas',
  body: `${chip(`${datos.mateo.nombre} · Pago por ${arsTexto(cifras.seleccion)}`)}
  <div class="stack"><h2>Adjuntá tu comprobante</h2><p class="muted">Queda pendiente de verificación. Adjuntarlo no aprueba el pago.</p></div>
  ${formulario(ctx, { teclado, errores })}
  ${teclado ? '' : boton('Enviar comprobante', errores ? 'off' : '')}`,
  bottom: teclado ? `<div class="contenido" style="padding-top:8px;padding-bottom:8px;background:var(--neutral-50);border-top:1px solid var(--neutral-300);flex:none">${boton('Enviar comprobante')}</div><div class="teclado">Teclado numérico del sistema (ilustración): el botón queda visible por encima del teclado.</div>` : '' })

const comprobanteConfirmado = ctx => shell(ctx, { titulo: 'Comprobante enviado', nav: 'cuotas', body: `
  ${chip(`${datos.mateo.nombre} · Pago por ${arsTexto(cifras.seleccion)}`)}
  ${alerta('info', 'check', `<strong>Recibimos tu comprobante.</strong><br>Queda pendiente de verificación. Esto no confirma el pago: Dirección lo revisará.${mk(ctx, 'El mensaje no afirma pago aprobado.')}`)}
  <div class="card"><span class="sec">Resumen</span>${fila('Archivo', 'transferencia-1.jpg')}${fila('Fecha de transferencia', '<span class="mono">09/10/2026</span>')}${fila('Importe informado', ars(cifras.seleccion))}${fila('N.º de operación', '<span class="mono">00012346</span>')}${fila('Estado', badge(ITEM.verif).replace('En verificación', 'Pendiente de verificación'))}</div>
  ${boton('Cargar otro comprobante', 'sec2')}${boton('Ver pagos del período')}` })

const comprobanteIncierto = ctx => shell(ctx, { titulo: 'Cargar comprobante', nav: 'cuotas', body: `
  ${chip(`${datos.mateo.nombre} · Pago por ${arsTexto(cifras.seleccion)}`)}
  ${alerta('warn', 'alerta', `<strong>No pudimos confirmar si se guardó tu comprobante.</strong><br>Antes de reintentar, revisá el estado para no duplicarlo.${mk(ctx, 'Resultado incierto: releer el estado antes de ofrecer reintento.')}`)}
  <div class="card"><span class="sec">Último envío</span>${fila('Archivo', 'transferencia-1.jpg')}${fila('Importe informado', ars(cifras.seleccion))}${fila('N.º de operación', '<span class="mono">00012346</span>')}</div>
  ${boton('Revisar estado')}<p class="ayuda">Si el comprobante figura como recibido, no hace falta enviarlo de nuevo.</p>` })

// Registro de pagos usado por período y comprobantes.
const PAGOS = [
  { fecha: '2026-09-05', texto: 'Septiembre 2026 · cuota y deporte', importe: TARIFA.cuota + TARIFA.deporte, estado: 'ok' },
  { fecha: '2026-10-03', texto: 'Octubre 2026 · cuota y deporte', importe: TARIFA.cuota + TARIFA.deporte, estado: 'ok' },
  { fecha: '2026-10-07', texto: 'Septiembre 2026 · transporte', importe: TARIFA.transporte, estado: 'verif' },
]
const estadoPago = e => e === 'ok' ? '<span class="badge b-pagada">' + icon('check', 16) + 'Aprobado</span>' : badge(ITEM.verif).replace('En verificación', 'Pendiente de verificación')
const pagoCard = (p, { archivo = '' } = {}) => `<div class="card"><div class="row"><h3>Transferencia del <span class="mono">${fecha(p.fecha)}</span></h3></div><span>${esc(p.texto)}</span>${fila('Importe informado', ars(p.importe))}<div>${estadoPago(p.estado)}</div>${archivo}</div>`
const periodo = (ctx, { estudiante = false } = {}) => shell(ctx, { titulo: 'Facturas por período', nav: 'periodo', body: `
  ${chip(estudiante ? `${datos.mateo.nombre} · Información propia` : datos.mateo.nombre)}
  <div class="card"><span class="sec">Rango de fechas${mk(ctx, 'Extremos inclusive, hora de Argentina; los pagos se ubican por fecha de transferencia.')}</span>
    ${campo('Desde', '01/09/2026')}${campo('Hasta', '09/10/2026')}${boton('Aplicar')}</div>
  <div class="stack"><span class="sec">Pagos informados</span><p class="ayuda">Ubicados por fecha de transferencia. Pendiente de verificación no es pago confirmado.</p></div>
  ${PAGOS.map(p => pagoCard(p, { archivo: estudiante ? `<span class="ayuda">${icon('candado', 16)} El archivo no está disponible para estudiantes.</span>` : `<span class="ayuda">${icon('archivo', 16)} Comprobante cargado por vos.</span>` })).join('')}
  <div class="card"><span class="sec">Facturas sin pagos${mk(ctx, 'Facturas sin ningún pago se ubican por su vencimiento (día 10).')}</span><span class="muted">Ninguna factura sin pagos vence en este período.</span></div>
  <div class="card">${fila('Aprobados', ars(cifras.aprobadosPeriodo))}${fila('Pendiente de verificación', ars(cifras.verificacionPeriodo))}</div>` })

const deuda = (ctx, { estudiante = false } = {}) => {
  const grupos = [['transporte', 'Transporte'], ['comedor', 'Comedor'], ['cuota', 'Cuota'], ['deporte', 'Deporte · Fútbol']]
  const filas = k => [F.sep, F.oct].map(f => { const [, e] = f.items.find(([n]) => n === k); return { f, e, imp: TARIFA[k], pag: e === 'pagado' ? TARIFA[k] : 0, sal: e === 'pagado' ? 0 : TARIFA[k] } })
  return shell(ctx, { titulo: 'Deuda por ítem', nav: 'deuda', body: `
  ${chip(estudiante ? `${datos.mateo.nombre} · Información propia` : datos.mateo.nombre)}
  <div class="card"><span class="sec">Período${mk(ctx, 'Filtro por rango de fechas; la deuda coincide con el reporte de la web.')}</span>${campo('Desde', '01/09/2026')}${campo('Hasta', '31/10/2026')}</div>
  <div class="total"><span>Total adeudado</span>${ars(cifras.deudaMateo)}<span class="small">Suma de los saldos por ítem</span></div>
  ${grupos.map(([k, nombre], i) => { const rs = filas(k); const saldo = rs.reduce((a, r) => a + r.sal, 0)
    return `<div class="card"><div class="row"><h3>${nombre}${i === 0 ? mk(ctx, 'Agrupado por ítem; cada fila con período, importe, pagado y saldo.') : ''}</h3><span>Saldo ${ars(saldo)}</span></div>
      ${rs.map(r => `<div class="item col"><div class="row"><strong>${esc(r.f.periodo)}</strong>${badge(r.e === 'pagado' ? ITEM.pagado : r.e === 'verif' ? ITEM.verif : ITEM.pendiente)}</div>
        ${fila('Importe', ars(r.imp))}${fila('Pagado', ars(r.pag))}${fila('<strong>Saldo</strong>', `<strong>${ars(r.sal)}</strong>`)}</div>`).join('')}</div>` }).join('')}
  <p class="ayuda">Un ítem en verificación conserva su saldo hasta la aprobación de Dirección.</p>` })
}

const inscripciones = (ctx, { estudiante = false } = {}) => shell(ctx, { titulo: 'Inscripciones', nav: 'inscripciones', body: `
  ${chip(estudiante ? `${datos.mateo.nombre} · Información propia` : datos.mateo.nombre)}
  <div class="card"><span class="sec">Deporte${mk(ctx, 'Solo consulta: deporte, grupo, horario y profesor; recorrido de transporte y comedor.')}</span><h3>Fútbol</h3>
    ${fila('Grupo', 'Grupo A (ejemplo)')}${fila('Horario', 'Martes y jueves, 17:00 a 18:30')}${fila('Profesor', 'A. Ejemplo')}</div>
  <div class="card"><span class="sec">Transporte</span><h3>Recorrido Norte (ejemplo)</h3></div>
  <div class="card"><span class="sec">Comedor</span><h3>Inscripto</h3></div>
  <p class="ayuda">Solo consulta.</p>` })

const comprobantesRegistro = (ctx, { quien }) => shell(ctx, { titulo: 'Comprobantes', nav: 'cuotas', body: `
  ${chip(quien === 'estudiante' ? `${datos.mateo.nombre} · Información propia` : `${datos.mateo.nombre} · Consulta como ${datos.otroPadre}, padre vinculado`)}
  ${quien === 'estudiante'
    ? alerta('info', 'candado', `<strong>Solo consulta.</strong> Ves el registro de los comprobantes, no el archivo. La carga la realiza tu padre o madre vinculado.${mk(ctx, 'ESTUDIANTE: sin carga ni archivo original.')}`)
    : alerta('info', 'candado', `<strong>Archivo no disponible.</strong> Este comprobante lo cargó otra persona vinculada. Ves el registro, no el archivo.${mk(ctx, 'Otro padre vinculado: ve el registro, no el original.')}`)}
  ${[PAGOS[2]].map(p => pagoCard(p, { archivo: `<span class="ayuda">${icon('candado', 16)} Archivo restringido a quien lo cargó y a Dirección.</span>` })).join('')}` })

const loginCampos = ({ correo = 'nombre@correo.com', vacio = true, errorCorreo = '', errorClave = '' } = {}) => `
    ${campo('Correo electrónico', correo, { vacio, error: errorCorreo })}
    ${campo('Contraseña', 'Tu contraseña', { vacio: true, error: errorClave, extra: '<span class="link">Mostrar</span>' })}
    <div class="link">¿Olvidaste tu contraseña?</div>${boton('Ingresar')}`
const loginError = (ctx, { tipo }) => {
  const base = { titulo: 'Educar para Transformar', sub: 'Centro educativo' }
  if (tipo === 'validacion') return shell(ctx, { ...base, body: `<h2>Ingresá a tu cuenta</h2>${loginCampos({ correo: 'laura.ejemplo', vacio: false, errorCorreo: 'Ingresá un correo con formato válido, por ejemplo nombre@correo.com.', errorClave: 'Ingresá tu contraseña.' })}` })
  if (tipo === 'credenciales') return shell(ctx, { ...base, body: `<h2>Ingresá a tu cuenta</h2>
    ${alerta('error', 'alerta', '<strong>No pudimos iniciar sesión.</strong><br>Revisá tus datos e intentá de nuevo.')}${loginCampos({ correo: 'laura.ejemplo@correo.com', vacio: false })}` })
  if (tipo === 'bloqueada') return shell(ctx, { ...base, body: `${alerta('error', 'candado', '<strong>Tu cuenta está bloqueada.</strong><br>No podés ver información económica. Comunicate con la institución para recuperar el acceso.')}${boton('Volver al inicio', 'sec2')}` })
  if (tipo === 'expirada') return shell(ctx, { ...base, body: `${alerta('warn', 'reloj', '<strong>Tu sesión expiró.</strong><br>Por seguridad, ingresá nuevamente para continuar.')}${loginCampos()}` })
  return shell(ctx, { ...base, body: `${alerta('info', 'info', '<strong>Esta aplicación es para padres, madres y estudiantes.</strong><br>Si sos parte de Dirección, docente o personal, ingresá desde la versión web del sistema.')}
    <div class="card"><span class="sec">Roles con acceso web</span><span>Dirección</span><span>Docentes</span><span>Personal</span></div>${boton('Volver al inicio', 'sec2')}` })
}
const estadosGuia = ctx => shell(ctx, { titulo: 'Estados de cuota', nav: 'cuotas', body: `
  <p class="muted">Cuatro casos independientes (no son cuatro facturas del mismo período). Cada estado combina texto, ícono y trazo.</p>
  ${[['pendiente', 'Con saldo y sin ítems aprobados, antes del día 10.'], ['parcial', 'Con ítems aprobados y saldo, antes del día 10.'], ['pagada', 'Sin saldo.'], ['vencida', 'Con saldo después del día 10, aunque haya ítems aprobados.']]
    .map(([e, regla]) => `<div class="card cuota s-${e}"><div class="row"><h3>Ejemplo independiente</h3>${badge(ESTADO[e])}</div><span>${esc(regla)}</span></div>`).join('')}` })
const cuotasEstado = (ctx, tipo) => {
  const comun = { titulo: 'Cuotas', nav: 'cuotas' }
  if (tipo === 'carga') return shell(ctx, { ...comun, body: `${chip(`${datos.mateo.nombre} · Cambiar hijo`)}${pestanas(0)}
    ${[1, 2].map(() => `<div class="card" aria-hidden="true"><div class="skel" style="width:55%"></div><div class="skel" style="width:80%"></div><div class="skel" style="width:40%"></div></div>`).join('')}
    <p class="muted" role="status">Cargando cuotas…</p>` })
  if (tipo === 'vacio') return shell(ctx, { ...comun, body: `${chip(`${datos.sofia.nombre} · Cambiar hijo`)}${pestanas(1)}
    <div class="card estado-vacio">${icon('cuotas', 40)}<h3>Todavía no hay cuotas pagadas</h3><span class="muted">Cuando Dirección apruebe un pago, la cuota aparecerá acá.</span></div>` })
  return shell(ctx, { ...comun, body: `${chip(`${datos.mateo.nombre} · Cambiar hijo`)}
    ${alerta('error', 'alerta', '<strong>No pudimos cargar las cuotas.</strong><br>Revisá tu conexión e intentá nuevamente.')}${boton('Reintentar')}` })
}

// ---------- registro ----------
const R = ['PADRE'], RE = ['ESTUDIANTE'], RB = ['PADRE', 'ESTUDIANTE']
const q = (...a) => a.map(x => `EPT-95/${x}`)
const priv = 'EPT-98/privacidad', mov = 'EPT-98/contrato-movil'
const BASE = [
  ['login', '01-login', 'Inicio de sesión', RB, ['Normal'], [...q('login'), mov], login],
  ['selector-hijo', '02-selector-hijo', 'Selector de hijo', R, ['Normal'], [...q('selector-hijo'), priv], selector],
  ['cuotas', '03-cuotas', 'Cuotas pendientes', RB, ['Pago parcial', 'Vencida'], [...q('cuotas'), mov], c => cuotas(c)],
  ['factura', '04-factura', 'Detalle de factura', RB, ['Vencida', 'En verificación'], [...q('factura-items'), mov], c => factura_(c)],
  ['transferencia', '05-seleccion-y-pago', 'Selección y pago por transferencia', R, ['Selección', 'En verificación', 'Datos bancarios no configurados'], [...q('seleccion-transferencia'), mov], c => seleccion(c)],
  ['comprobantes', '06-comprobantes', 'Carga de comprobantes', R, ['Carga'], [...q('comprobantes'), priv], c => comprobante(c)],
  ['periodo', '07-periodo', 'Facturas por período', RB, ['Consulta', 'Pendiente de verificación'], [...q('periodo'), mov], c => periodo(c)],
  ['deuda-item', '08-deuda-item', 'Deuda por ítem', RB, ['Consulta', 'En verificación'], [...q('deuda-item'), mov], c => deuda(c)],
  ['inscripciones', '09-inscripciones', 'Inscripciones', RB, ['Consulta'], [...q('inscripciones'), mov], c => inscripciones(c)],
]
const VAR = [
  ['login-validacion', 'Inicio de sesión · validación de campos', RB, ['Validación'], [...q('login'), mov], c => loginError(c, { tipo: 'validacion' })],
  ['login-credenciales-invalidas', 'Inicio de sesión · credenciales inválidas', RB, ['Error'], [...q('login'), priv], c => loginError(c, { tipo: 'credenciales' })],
  ['login-cuenta-bloqueada', 'Cuenta bloqueada', RB, ['Cuenta bloqueada'], [...q('roles-y-estados'), priv], c => loginError(c, { tipo: 'bloqueada' })],
  ['login-sesion-expirada', 'Sesión expirada', RB, ['Sesión expirada'], [...q('roles-y-estados'), priv], c => loginError(c, { tipo: 'expirada' })],
  ['login-canal-web', 'Roles de canal web', ['DIRECTOR', 'DOCENTE', 'PERSONAL'], ['Canal web'], [...q('login', 'roles-y-estados'), priv], c => loginError(c, { tipo: 'web' })],
  ['selector-sin-vinculos', 'Selector · sin hijos vinculados', R, ['Sin vínculo', 'Vacío'], [...q('selector-hijo'), priv], c => shell(c, { titulo: 'Mis hijos', body: `${alerta('info', 'info', '<strong>Todavía no tenés estudiantes asociados.</strong><br>Comunicate con Dirección para vincularlos a tu cuenta.')}<div class="link">Cerrar sesión</div>` })],
  ['cuotas-estudiante', 'Cuotas · estudiante (información propia)', RE, ['Consulta propia', 'Pago parcial', 'Vencida'], [...q('cuotas', 'roles-y-estados'), priv], c => cuotas(c, { propio: true })],
  ['cuotas-pagadas', 'Cuotas · pestaña Pagadas', RB, ['Pagada'], [...q('cuotas'), mov], c => cuotas(c, { tab: 1 })],
  ['cuotas-pendiente', 'Cuotas · hijo con cuota Pendiente', R, ['Pendiente'], [...q('cuotas'), mov], c => cuotas(c, { hijo: 'sofia' })],
  ['cuotas-carga', 'Cuotas · carga', RB, ['Carga'], [...q('cuotas')], c => cuotasEstado(c, 'carga')],
  ['cuotas-vacio', 'Cuotas · estado vacío (pestaña Pagadas)', RB, ['Vacío'], [...q('cuotas')], c => cuotasEstado(c, 'vacio')],
  ['cuotas-error-conexion', 'Cuotas · error de conexión', RB, ['Error'], [...q('cuotas')], c => cuotasEstado(c, 'error')],
  ['estados-de-cuota', 'Guía de los cuatro estados de cuota', RB, ['Pendiente', 'Pago parcial', 'Pagada', 'Vencida'], [...q('cuotas', 'roles-y-estados')], estadosGuia],
  ['factura-estudiante', 'Detalle de factura · estudiante', RE, ['Consulta propia', 'Vencida', 'En verificación'], [...q('factura-items', 'roles-y-estados'), priv], c => factura_(c, { estudiante: true })],
  ['seleccion-validacion', 'Selección · validación sin ítems', R, ['Validación', 'Selección'], [...q('seleccion-transferencia')], c => seleccion(c, { error: true, ninguno: true })],
  ['pago-registrado', 'Pago registrado · pendiente de verificación', R, ['Confirmación', 'En verificación'], [...q('seleccion-transferencia'), mov], pagoRegistrado],
  ['comprobante-validacion', 'Comprobante · errores de validación', R, ['Validación', 'Error'], [...q('comprobantes'), priv], c => comprobante(c, { errores: true })],
  ['comprobante-confirmacion', 'Comprobante · confirmación', R, ['Confirmación', 'En verificación'], [...q('comprobantes'), priv], comprobanteConfirmado],
  ['comprobante-error-incierto', 'Comprobante · resultado incierto', R, ['Error incierto'], [...q('comprobantes'), mov], comprobanteIncierto],
  ['comprobantes-otro-padre', 'Comprobantes · otro padre vinculado', ['PADRE_VINCULADO_NO_CARGADOR'], ['Original no autorizado', 'Pendiente de verificación'], [...q('comprobantes', 'roles-y-estados'), priv], c => comprobantesRegistro(c, { quien: 'padre' })],
  ['comprobantes-estudiante', 'Comprobantes · estudiante', RE, ['Consulta propia', 'Original no autorizado'], [...q('comprobantes', 'roles-y-estados'), priv], c => comprobantesRegistro(c, { quien: 'estudiante' })],
  ['periodo-estudiante', 'Facturas por período · estudiante', RE, ['Consulta propia', 'Pendiente de verificación'], [...q('periodo', 'roles-y-estados'), priv], c => periodo(c, { estudiante: true })],
  ['deuda-estudiante', 'Deuda por ítem · estudiante', RE, ['Consulta propia', 'En verificación'], [...q('deuda-item', 'roles-y-estados'), priv], c => deuda(c, { estudiante: true })],
  ['inscripciones-estudiante', 'Inscripciones · estudiante', RE, ['Consulta propia'], [...q('inscripciones', 'roles-y-estados'), priv], c => inscripciones(c, { estudiante: true })],
  ['comprobante-teclado', 'Comprobante · formulario con teclado abierto', R, ['Teclado', 'Carga'], [...q('comprobantes'), mov], c => comprobante(c, { teclado: true })],
  ['cuotas-texto-200', 'Cuotas · texto ampliado al 200 %', RB, ['Texto 200%', 'Vencida'], [...q('cuotas'), mov], c => cuotas(c), { escala: 2 }],
]
const pad = n => String(n).padStart(2, '0')
export const pantallas = [
  ...BASE.map(([area, slug, titulo, roles, estados, requisitos, fn], i) => ({ id: `W${pad(i + 1)}`, tipo: 'wireframe', dir: 'wireframes', archivo: `W${pad(i + 1)}-${slug.replace(/^\d+-/u, '')}`, area, titulo: `Wireframe · ${titulo}`, roles, estados, requisitos, fn, tema: 'wire' })),
  ...BASE.map(([area, slug, titulo, roles, estados, requisitos, fn], i) => ({ id: `M${pad(i + 1)}`, tipo: 'mockup', dir: 'mockups', archivo: `M${pad(i + 1)}-${slug.replace(/^\d+-/u, '')}`, area, titulo: `Mockup · ${titulo}`, roles, estados, requisitos, fn, tema: 'mock' })),
  ...VAR.map(([slug, titulo, roles, estados, requisitos, fn, opciones = {}], i) => ({ id: `V${pad(i + 1)}`, tipo: 'variante', dir: 'variantes', archivo: `V${pad(i + 1)}-${slug}`, area: 'variantes', titulo, roles, estados, requisitos, fn, tema: 'mock', ...opciones })),
]

export function htmlDe(p) {
  const ctx = { tema: p.tema, marks: [] }
  const cuerpo = p.fn(ctx)
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.id)} · ${esc(p.titulo)}</title>
<link rel="stylesheet" href="../estilos.css">
${p.escala ? `<style>:root { --escala: ${p.escala}; }</style>\n` : ''}</head>
<body class="tema-${p.tema}">
${cuerpo}
</body>
</html>
`
}
