// EPT-96 · Pantallas. Cada función recibe `ctx` (estado + acciones) y devuelve un nodo; no escribe en la base.
import { ARCHIVOS_EJEMPLO, CONCEPTOS, CUENTAS, HIJOS, REFERENCIA } from './datos.mjs'
import { formatoArs, formatoFecha, parsearImporte } from './dinero.mjs'
import {
  buscarFactura, buscarItem, deudaPorItem, deudaTotal, estadoFactura, facturasPorPestana, facturasDe, facturasSinPagosEnRango,
  formatoTamano, importeFactura, pagosDe, pagosEnRango, puedeOperar, puedeVerOriginal, saldoFactura, totalPago, totalSeleccion, totalesPeriodo, validarArchivo,
} from './reglas.mjs'
import { alerta, boton, campo, enlaceBoton, ESTADO_FACTURA, ESTADO_ITEM, ESTADO_PAGO, fila, h, icono, importe, insignia } from './vista.mjs'

const ruta = (hijo, resto = '') => `#/h/${hijo}/${resto}`.replace(/\/$/u, '')
const nombreItem = i => CONCEPTOS[i.concepto]

// ---------- marco común ----------
function marco(ctx, { titulo, sub = 'Familias y estudiantes', nav = null, cuerpo }) {
  const { cuenta } = ctx.estado
  const navegacion = nav
    ? h('nav', { class: 'nav', 'aria-label': 'Secciones' }, ...[['cuotas', 'Cuotas', 'cuotas'], ['periodo', 'Período', 'facturas'], ['deuda', 'Deuda', 'deuda'], ['inscripciones', 'Inscripciones', 'inscr']]
      .map(([clave, texto, ic]) => h('a', { href: ruta(ctx.hijoActual, clave), class: clave === nav ? 'on' : '', 'aria-current': clave === nav ? 'page' : null }, icono(ic, 22), h('span', {}, texto))))
    : null
  return h('div', { class: 'pantalla' },
    h('header', { class: 'topbar' },
      h('img', { src: '/activos/logo-emblema.png', alt: 'Logo institucional de Educar para Transformar', width: 44, height: 44 }),
      h('div', {}, h('div', { class: 't', role: 'presentation' }, titulo), h('div', { class: 's' }, sub))),
    h('main', { class: 'contenido', id: 'principal' },
      cuerpo,
      cuenta ? h('div', { class: 'sesion' }, h('span', { class: 'muted' }, `Sesión simulada: ${cuenta.nombre} (${cuenta.rol})`),
        boton('Cerrar sesión', { clase: 'sec2', alClick: () => ctx.salir() })) : null),
    navegacion)
}
const titulo = texto => h('h1', { tabindex: '-1', class: 'h1' }, texto)

function contexto(ctx, hijo) {
  const { cuenta } = ctx.estado
  const propio = cuenta.rol === 'ESTUDIANTE'
  return h('div', { class: 'ctx' }, icono('usuario'),
    h('span', { class: 'ctx-t' }, h('span', { class: 'ctx-n' }, HIJOS[hijo].nombre),
      propio ? h('span', { class: 'ctx-info' }, 'Información propia') : h('a', { href: '#/hijos', class: 'ctx-a' }, 'Cambiar hijo')))
}
const volver = (texto, href) => h('a', { class: 'link volver', href }, icono('chevron', 18), texto)

// ---------- acceso ----------
function formularioIngreso(ctx) {
  const { ui } = ctx.estado
  const enviar = evento => { evento.preventDefault(); ctx.entrar(document.getElementById('correo').value) }
  return h('form', { class: 'stack', novalidate: '', onsubmit: enviar },
    campo({ id: 'correo', etiqueta: 'Correo electrónico', valor: ui.loginCorreo, placeholder: 'nombre@correo.com', modo: 'email', error: ui.loginErrorCampo, requerido: true }),
    campo({ id: 'clave', etiqueta: 'Contraseña', deshabilitado: true, placeholder: 'No se solicita en el prototipo',
      ayuda: 'El prototipo no recibe contraseñas: ingresá solo un correo de ejemplo.' }),
    h('a', { class: 'link', href: '#/recuperar' }, '¿Olvidaste tu contraseña?'),
    boton('Ingresar', { tipo: 'submit' }))
}
function cuentasEjemplo(ctx) {
  return h('section', { class: 'card', 'aria-labelledby': 'h-cuentas' },
    h('h2', { id: 'h-cuentas', class: 'sec' }, 'Cuentas de ejemplo'),
    h('p', { class: 'ayuda' }, 'Datos ficticios. Elegí una cuenta para recorrer el prototipo.'),
    ...CUENTAS.map(c => boton(`${c.nombre} · ${c.detalle}`, { clase: 'sec2 cuenta', alClick: () => ctx.entrar(c.correo) })))
}
export function ingreso(ctx, { variante = null } = {}) {
  const { ui } = ctx.estado
  const aviso = variante === 'expirada'
    ? alerta('warn', 'reloj', h('strong', {}, 'Tu sesión expiró.'), h('br'), 'Por seguridad, ingresá nuevamente para continuar.')
    : ui.avisoIngreso ? alerta('info', 'info', ui.avisoIngreso) : null
  return marco(ctx, { titulo: 'Educar para Transformar', sub: 'Centro educativo', cuerpo: h('div', { class: 'stack' },
    titulo('Ingresá a tu cuenta'),
    h('p', { class: 'muted' }, 'Para padres, madres y estudiantes.'),
    aviso,
    ui.loginErrorGeneral ? h('div', { role: 'alert' }, alerta('error', 'alerta', h('strong', {}, 'No pudimos iniciar sesión.'), h('br'), 'Revisá tus datos e intentá de nuevo.')) : null,
    formularioIngreso(ctx),
    alerta('info', 'info', h('strong', {}, '¿Sos parte de Dirección, docente o personal?'), h('br'), 'Usá la versión web del sistema.'),
    cuentasEjemplo(ctx)) })
}
export const recuperar = ctx => marco(ctx, { titulo: 'Educar para Transformar', sub: 'Centro educativo', cuerpo: h('div', { class: 'stack' },
  titulo('Recuperar contraseña'),
  alerta('info', 'info', 'En la aplicación real se enviará un enlace al correo registrado. En el prototipo esta pantalla es ilustrativa y no envía nada.'),
  enlaceBoton('Volver al ingreso', '#/ingreso', 'sec2')) })
export const bloqueada = ctx => marco(ctx, { titulo: 'Educar para Transformar', sub: 'Centro educativo', cuerpo: h('div', { class: 'stack' },
  titulo('Tu cuenta está bloqueada'),
  h('div', { role: 'alert' }, alerta('error', 'candado', h('strong', {}, 'No podés ver información económica.'), h('br'), 'Comunicate con la institución para recuperar el acceso.')),
  enlaceBoton('Volver al inicio', '#/ingreso', 'sec2')) })
export const canalWeb = ctx => marco(ctx, { titulo: 'Educar para Transformar', sub: 'Centro educativo', cuerpo: h('div', { class: 'stack' },
  titulo('Esta aplicación es para padres, madres y estudiantes'),
  alerta('info', 'info', h('strong', {}, 'Ingresá desde la versión web del sistema.'), h('br'), `Tu rol (${ctx.estado.cuenta.rol}) trabaja en el canal web. La aplicación móvil no muestra información económica para este rol.`),
  h('div', { class: 'card' }, h('span', { class: 'sec' }, 'Roles con acceso web'), h('span', {}, 'Dirección'), h('span', {}, 'Docentes'), h('span', {}, 'Personal'))) })
export const sinPermiso = ctx => marco(ctx, { titulo: 'Sin acceso', cuerpo: h('div', { class: 'stack' },
  titulo('Esta sección no está disponible para tu cuenta'),
  h('div', { role: 'alert' }, alerta('warn', 'candado', 'No tenés permiso para ver esta pantalla ni sus datos.')),
  enlaceBoton('Ir al inicio', ctx.inicio(), 'sec2')) })

// ---------- selector de hijo ----------
export function selector(ctx) {
  const hijos = ctx.estado.cuenta.hijos
  if (hijos.length === 0) {
    return marco(ctx, { titulo: 'Mis hijos', cuerpo: h('div', { class: 'stack' }, titulo('Todavía no tenés estudiantes asociados'),
      alerta('info', 'info', 'Comunicate con Dirección para vincularlos a tu cuenta.')) })
  }
  const { db } = ctx.estado
  return marco(ctx, { titulo: 'Mis hijos', cuerpo: h('div', { class: 'stack' },
    titulo('¿De quién querés ver las cuotas?'),
    ...hijos.map(id => {
      const peor = ['vencida', 'parcial', 'pendiente', 'pagada'].find(e => facturasDe(db, id).some(f => estadoFactura(f) === e))
      return h('a', { class: 'card tarjeta-enlace', href: ruta(id, 'cuotas') },
        h('div', { class: 'row' }, h('h2', { class: 'h3' }, HIJOS[id].nombre), peor ? insignia(ESTADO_FACTURA[peor]) : null),
        fila('Saldo total adeudado', importe(deudaTotal(db, id))),
        h('span', { class: 'link' }, 'Ver cuotas', icono('chevron')))
    }),
    h('p', { class: 'ayuda' }, 'Solo ves a los hijos vinculados a tu cuenta.')) })
}

// ---------- cuotas ----------
function tarjetaCuota(ctx, f) {
  const estado = estadoFactura(f)
  return h('a', { class: `card cuota s-${estado} tarjeta-enlace`, href: ruta(f.hijo, `factura/${f.id}`) },
    h('div', { class: 'row' }, h('h2', { class: 'h3' }, f.periodo), insignia(ESTADO_FACTURA[estado])),
    fila('Vencimiento', h('span', { class: 'mono' }, formatoFecha(f.vence))),
    fila('Importe', importe(importeFactura(f))),
    fila('Saldo', importe(saldoFactura(f)), true))
}
export function cuotas(ctx, { hijo, pestana }) {
  const { db, ui, cuenta } = ctx.estado
  const operar = puedeOperar(cuenta, hijo)
  const pestanas = h('nav', { class: 'tabs', 'aria-label': 'Pestañas de cuotas' },
    h('a', { class: `tab${pestana === 'pendientes' ? ' on' : ''}`, href: ruta(hijo, 'cuotas'), 'aria-current': pestana === 'pendientes' ? 'page' : null }, 'Pendientes'),
    h('a', { class: `tab${pestana === 'pagadas' ? ' on' : ''}`, href: ruta(hijo, 'cuotas/pagadas'), 'aria-current': pestana === 'pagadas' ? 'page' : null }, 'Pagadas'))
  let cuerpoLista
  if (ui.cuotas.estado === 'cargando') {
    cuerpoLista = [h('div', { class: 'card', 'aria-hidden': 'true' }, h('div', { class: 'skel w55' }), h('div', { class: 'skel w80' }), h('div', { class: 'skel w40' })),
      h('p', { class: 'muted', role: 'status' }, 'Cargando cuotas…')]
  } else if (ui.cuotas.estado === 'error') {
    cuerpoLista = [h('div', { role: 'alert' }, alerta('error', 'alerta', h('strong', {}, 'No pudimos cargar las cuotas.'), h('br'), 'Revisá tu conexión e intentá nuevamente.')),
      boton('Reintentar', { id: 'reintentar', alClick: () => ctx.cargarCuotas(hijo) })]
  } else {
    const lista = facturasPorPestana(db, hijo, pestana)
    cuerpoLista = [
      h('div', { class: 'card' }, h('div', { class: 'row' }, h('span', {}, 'Saldo total adeudado'), importe(deudaTotal(db, hijo))),
        h('span', { class: 'ayuda' }, `Datos al ${formatoFecha(REFERENCIA)}`)),
      lista.length === 0
        ? h('div', { class: 'card estado-vacio' }, icono('cuotas', 40), h('h2', { class: 'h3' }, pestana === 'pagadas' ? 'Todavía no hay cuotas pagadas' : 'No hay cuotas pendientes'),
          h('span', { class: 'muted' }, pestana === 'pagadas' ? 'Cuando Dirección apruebe un pago, la cuota aparecerá acá.' : 'No tenés saldos por pagar.'))
        : lista.map(f => tarjetaCuota(ctx, f)),
      operar && lista.some(f => f.items.some(i => i.estado === 'pendiente')) ? enlaceBoton('Pagar ítems', ruta(hijo, 'pagar')) : null,
      enlaceBoton('Pagos y comprobantes', ruta(hijo, 'comprobantes'), 'sec2'),
    ]
  }
  return marco(ctx, { titulo: cuenta.rol === 'ESTUDIANTE' ? 'Mis cuotas' : 'Cuotas', sub: cuenta.rol === 'ESTUDIANTE' ? 'Estudiante' : 'Familias y estudiantes', nav: 'cuotas',
    cuerpo: h('div', { class: 'stack' }, contexto(ctx, hijo), titulo('Cuotas'), pestanas, ...cuerpoLista) })
}

// ---------- detalle de factura ----------
export function factura(ctx, { hijo, id }) {
  const { db, cuenta } = ctx.estado
  const f = buscarFactura(db, id)
  const estado = estadoFactura(f)
  const operar = puedeOperar(cuenta, hijo)
  const hayPendientes = f.items.some(i => i.estado === 'pendiente')
  return marco(ctx, { titulo: 'Detalle de factura', nav: 'cuotas', cuerpo: h('div', { class: 'stack' },
    contexto(ctx, hijo),
    h('div', { class: `card cuota s-${estado}` }, h('div', { class: 'row' }, titulo(f.periodo), insignia(ESTADO_FACTURA[estado])),
      fila('Vencimiento', h('span', { class: 'mono' }, formatoFecha(f.vence)))),
    h('section', { class: 'card', 'aria-labelledby': 'h-items' }, h('h2', { id: 'h-items', class: 'sec' }, 'Ítems'),
      ...f.items.map(i => h('div', { class: 'item' }, h('div', { class: 'cuerpo' }, h('span', {}, nombreItem(i)), insignia(ESTADO_ITEM[i.estado])), importe(i.importe)))),
    h('div', { class: 'card' }, fila('Importe total', importe(importeFactura(f))), fila('Pagado (aprobado)', importe(importeFactura(f) - saldoFactura(f))),
      fila('Saldo', importe(saldoFactura(f)), true),
      h('span', { class: 'ayuda' }, 'El saldo baja recién cuando Dirección aprueba el pago. Un pago en verificación no está confirmado.')),
    operar
      ? (hayPendientes ? enlaceBoton('Seleccionar ítems para pagar', ruta(hijo, 'pagar')) : h('p', { class: 'ayuda' }, 'Esta factura no tiene ítems disponibles para pagar.'))
      : alerta('info', 'candado', h('strong', {}, 'Solo consulta.'), ' El pago y la carga de comprobantes los realiza tu padre o madre vinculado.'),
    volver('Volver a cuotas', ruta(hijo, 'cuotas'))) })
}

// ---------- selección y pago ----------
export function pagar(ctx, { hijo }) {
  const { db, ui } = ctx.estado
  const total = totalSeleccion(db, hijo, ui.seleccion)
  const bloqueado = !db.banco.configurado && !db.banco.simulado
  const grupos = facturasDe(db, hijo).filter(f => saldoFactura(f) > 0)
  const items = f => f.items.map(i => {
    const marcable = i.estado === 'pendiente'
    const id = `sel-${i.id}`
    return h('label', { class: `item seleccion${marcable ? '' : ' fija'}`, for: id },
      h('input', { type: 'checkbox', id, checked: ui.seleccion.includes(i.id), disabled: !marcable, onchange: () => ctx.alternarItem(i.id), 'data-item': i.id }),
      h('span', { class: 'cuerpo' }, h('span', {}, nombreItem(i)), insignia(ESTADO_ITEM[i.estado])),
      importe(i.importe))
  })
  const resumen = h('div', { class: 'total', 'aria-live': 'polite' }, h('span', {}, 'Total a transferir'),
    h('span', { class: 'mono grande', id: 'total-seleccion' }, formatoArs(total.total ?? 0)),
    h('span', { class: 'small', id: 'cantidad-seleccion' }, `${ui.seleccion.length} ${ui.seleccion.length === 1 ? 'ítem seleccionado' : 'ítems seleccionados'} · calculado por el sistema`))
  return marco(ctx, { titulo: 'Pagar ítems', nav: 'cuotas', cuerpo: h('div', { class: 'stack' },
    contexto(ctx, hijo),
    titulo('Elegí los ítems a pagar'),
    h('p', { class: 'muted' }, 'Ítems completos, de una o varias facturas del mismo hijo. Los pagados o en verificación no se pueden seleccionar.'),
    ui.errorSeleccion ? h('div', { role: 'alert' }, alerta('error', 'alerta', h('strong', {}, ui.errorSeleccion))) : null,
    ...grupos.map(f => h('section', { class: 'card', 'aria-label': f.periodo }, h('div', { class: 'row' }, h('h2', { class: 'h3' }, f.periodo), insignia(ESTADO_FACTURA[estadoFactura(f)])), ...items(f))),
    resumen,
    h('section', { class: 'card', 'aria-labelledby': 'h-banco' }, h('h2', { id: 'h-banco', class: 'sec' }, 'Datos para la transferencia'),
      bloqueado
        ? alerta('info', 'info', h('strong', {}, 'Datos bancarios: no configurados.'), ' Mientras la institución no los configure, registrar un pago está bloqueado.')
        : alerta('warn', 'info', h('strong', {}, 'Escenario simulado.'), ' Datos bancarios de ejemplo: no hay CBU, alias ni titular. No se realiza ninguna transferencia real.'),
      h('span', { class: 'ayuda' }, 'No se acepta pago en efectivo.')),
    bloqueado ? h('p', { class: 'ayuda', id: 'ayuda-bloqueo' }, 'Para recorrer la confirmación, habilitá el escenario simulado en el panel de simulación.') : null,
    boton('Registrar pago', { inactivo: bloqueado, descrito: bloqueado ? 'ayuda-bloqueo' : null, id: 'registrar-pago', alClick: () => ctx.registrarPago(hijo) }),
    boton('Cancelar', { clase: 'sec2', alClick: () => ctx.cancelarSeleccion(hijo) }),
    volver('Volver a cuotas', ruta(hijo, 'cuotas'))) })
}

export function pagoRegistrado(ctx, { hijo, pago }) {
  const { db } = ctx.estado
  return marco(ctx, { titulo: 'Pago registrado', nav: 'cuotas', cuerpo: h('div', { class: 'stack' },
    contexto(ctx, hijo),
    titulo('Pago registrado'),
    h('div', { role: 'status' }, alerta('info', 'ojo', h('strong', {}, 'Pago registrado: pendiente de verificación.'), h('br'),
      `Los ${pago.items.length} ítems quedan en verificación y el saldo no cambia hasta que Dirección apruebe el pago.`)),
    h('div', { class: 'card' }, fila('Total a transferir', importe(totalPago(db, pago))), fila('Ítems', String(pago.items.length)), fila('Estado', insignia(ESTADO_PAGO.pendiente)),
      ...pago.items.map(id => { const i = buscarItem(db, id); return h('span', { class: 'ayuda' }, `${db.facturas.find(f => f.items.includes(i)).periodo} · ${nombreItem(i)}`) })),
    db.banco.simulado ? h('p', { class: 'ayuda' }, 'Escenario simulado: no hubo transferencia real ni escritura en ningún sistema.') : null,
    h('p', { class: 'muted' }, 'Ahora podés cargar el comprobante de la transferencia.'),
    enlaceBoton('Cargar comprobante', ruta(hijo, `pago/${pago.id}/comprobante`)),
    enlaceBoton('Volver a cuotas', ruta(hijo, 'cuotas'), 'sec2')) })
}

// ---------- comprobante ----------
export function comprobante(ctx, { hijo, pago }) {
  const { db, ui } = ctx.estado
  const b = ui.borrador
  const total = totalPago(db, pago)
  const yaInformado = pago.operacion !== null
  const e = b.errores
  const aviso = h('div', { class: 'ayuda', id: 'aviso-importe', 'aria-live': 'polite' }, '')
  const evaluar = () => {
    const valor = parsearImporte(b.importe)
    aviso.textContent = valor !== null && valor !== total
      ? `El importe informado difiere del total calculado (${formatoArs(total)}). Se acepta como dato de conciliación; Dirección decide al verificar.` : ''
  }
  const sincronizar = clave => evento => { b[clave] = evento.target.value; evaluar() }
  const archivos = h('section', { class: 'card', 'aria-labelledby': 'h-archivos' },
    h('h2', { id: 'h-archivos', class: 'sec', tabindex: '-1' }, 'Archivos'),
    h('p', { class: 'ayuda' }, 'JPG, PNG o PDF · máximo 5 MB por archivo · podés adjuntar varios. En el prototipo se eligen ejemplos inocuos: no se lee ni se envía ningún archivo real.'),
    h('div', { class: 'stack', role: 'group', 'aria-label': 'Archivos de ejemplo' },
      ...ARCHIVOS_EJEMPLO.map(a => boton(`Agregar ejemplo: ${a.nombre} · ${formatoTamano(a.bytes)}`, { clase: 'sec2', alClick: () => ctx.agregarArchivo(a.id) }))),
    e.archivos ? h('div', { class: 'err-txt', id: 'error-archivos' }, icono('alerta', 18), h('span', {}, e.archivos)) : null,
    h('ul', { class: 'lista-archivos', 'aria-label': 'Archivos agregados' }, ...b.archivos.map((a, indice) => {
      const error = validarArchivo(a)
      return h('li', { class: `archivo${error ? ' con-error' : ''}` }, icono('archivo', 24),
        h('div', { class: 'cuerpo' }, h('div', {}, a.nombre), h('div', { class: 'ayuda' }, formatoTamano(a.bytes)),
          error ? h('div', { class: 'err-txt' }, icono('alerta', 18), h('span', {}, error)) : null),
        h('button', { type: 'button', class: 'icono-boton', 'aria-label': `Quitar ${a.nombre}`, onclick: () => ctx.quitarArchivo(indice) }, icono('equis', 22)))
    })))
  const datos = yaInformado
    ? h('section', { class: 'card' }, h('h2', { class: 'sec' }, 'Datos de la transferencia'),
      h('p', { class: 'ayuda' }, 'Ya informaste estos datos para este pago. El nuevo archivo se suma al mismo pago.'),
      fila('Fecha de transferencia', h('span', { class: 'mono' }, formatoFecha(pago.fecha))), fila('Importe informado', importe(pago.importeInformado)),
      fila('N.º de operación', h('span', { class: 'mono' }, pago.operacion)))
    : h('section', { class: 'card', 'aria-labelledby': 'h-datos' }, h('h2', { id: 'h-datos', class: 'sec' }, 'Datos de la transferencia'),
      campo({ id: 'fecha', etiqueta: 'Fecha de transferencia', valor: b.fecha, error: e.fecha, ayuda: 'Formato dd/mm/aaaa.', modo: 'numeric', alCambiar: sincronizar('fecha'), requerido: true }),
      campo({ id: 'importe', etiqueta: 'Importe informado (ARS)', valor: b.importe, error: e.importe, ayuda: 'Es un dato de conciliación; Dirección decide al verificar.', modo: 'decimal', alCambiar: sincronizar('importe'), requerido: true }),
      aviso,
      campo({ id: 'operacion', etiqueta: 'Número de operación', valor: b.operacion, error: e.operacion, placeholder: 'Ej.: 00098765 (ficticio)', alCambiar: sincronizar('operacion'), requerido: true }))
  evaluar()
  return marco(ctx, { titulo: 'Cargar comprobante', nav: 'cuotas', cuerpo: h('div', { class: 'stack' },
    h('div', { class: 'ctx' }, icono('usuario'), h('span', { class: 'ctx-t' }, h('span', { class: 'ctx-n' }, HIJOS[hijo].nombre), h('span', { class: 'ctx-info' }, `Pago por ${formatoArs(total)}`))),
    titulo('Adjuntá tu comprobante'),
    h('p', { class: 'muted' }, 'Queda pendiente de verificación. Adjuntarlo no aprueba el pago.'),
    Object.keys(e).length ? h('div', { role: 'alert' }, alerta('error', 'alerta', h('strong', {}, 'Revisá los datos marcados para continuar.'))) : null,
    archivos, datos,
    boton('Enviar comprobante', { tipo: 'button', id: 'enviar-comprobante', alClick: () => ctx.enviarComprobante(pago.id) }),
    boton('Cancelar', { clase: 'sec2', alClick: () => ctx.cancelarBorrador(hijo) })) })
}

export function comprobanteEnviado(ctx, { hijo, pago }) {
  const { db } = ctx.estado
  return marco(ctx, { titulo: 'Comprobante enviado', nav: 'cuotas', cuerpo: h('div', { class: 'stack' },
    contexto(ctx, hijo),
    titulo('Comprobante enviado'),
    h('div', { role: 'status' }, alerta('info', 'check', h('strong', {}, 'Recibimos tu comprobante.'), h('br'), 'Queda pendiente de verificación. Esto no confirma el pago: Dirección lo revisará.')),
    h('section', { class: 'card', 'aria-labelledby': 'h-resumen' }, h('h2', { id: 'h-resumen', class: 'sec' }, 'Resumen'),
      fila('Archivos', pago.comprobantes.map(c => c.nombre).join(', ')), fila('Fecha de transferencia', h('span', { class: 'mono' }, formatoFecha(pago.fecha))),
      fila('Importe informado', importe(pago.importeInformado)), fila('N.º de operación', h('span', { class: 'mono' }, pago.operacion)),
      fila('Total calculado de los ítems', importe(totalPago(db, pago))), fila('Estado', insignia(ESTADO_PAGO[pago.estado]))),
    pago.importeInformado !== totalPago(db, pago)
      ? alerta('warn', 'info', 'El importe informado difiere del total calculado. Queda como dato de conciliación y Dirección decide al verificar.') : null,
    enlaceBoton('Cargar otro comprobante', ruta(hijo, `pago/${pago.id}/comprobante`), 'sec2'),
    enlaceBoton('Ver pagos del período', ruta(hijo, 'periodo')),
    enlaceBoton('Volver a cuotas', ruta(hijo, 'cuotas'), 'sec2')) })
}

export function comprobanteIncierto(ctx, { hijo, pago }) {
  const { ui } = ctx.estado
  const r = ui.revision
  return marco(ctx, { titulo: 'Cargar comprobante', nav: 'cuotas', cuerpo: h('div', { class: 'stack' },
    contexto(ctx, hijo),
    titulo('No pudimos confirmar el envío'),
    h('div', { role: 'alert' }, alerta('warn', 'alerta', h('strong', {}, 'No pudimos confirmar si se guardó tu comprobante.'), h('br'),
      'Antes de reintentar, revisá el estado para no duplicarlo.')),
    h('section', { class: 'card', 'aria-labelledby': 'h-ultimo' }, h('h2', { id: 'h-ultimo', class: 'sec' }, 'Último envío'),
      fila('Archivos', ui.ultimoEnvio.archivos.map(a => a.nombre).join(', ')), fila('Importe informado', importe(ui.ultimoEnvio.importe)),
      fila('N.º de operación', h('span', { class: 'mono' }, ui.ultimoEnvio.operacion))),
    r === null ? boton('Revisar estado', { alClick: () => ctx.revisarEstado(pago.id) }) : null,
    r === 'recibido' ? h('div', { role: 'status' }, alerta('info', 'check', h('strong', {}, 'El comprobante figura como recibido.'), h('br'), 'No hace falta enviarlo de nuevo.')) : null,
    r === 'no-recibido' ? h('div', { role: 'status' }, alerta('warn', 'info', h('strong', {}, 'El comprobante no figura como recibido.'), h('br'), 'Podés reintentar el envío una sola vez.')) : null,
    r === 'no-recibido' ? boton('Reintentar envío', { id: 'reintentar-envio', alClick: () => ctx.reintentarEnvio(pago.id) }) : null,
    r === 'recibido' ? enlaceBoton('Ver pagos y comprobantes', ruta(hijo, 'comprobantes')) : null,
    h('p', { class: 'ayuda' }, 'Si el comprobante figura como recibido, no hace falta enviarlo de nuevo.')) })
}

// ---------- registro de pagos y comprobantes ----------
function tarjetaPago(ctx, hijo, p) {
  const { db, cuenta } = ctx.estado
  const conArchivo = puedeVerOriginal(cuenta, p)
  const conceptos = p.items.map(id => { const i = buscarItem(db, id); return `${db.facturas.find(f => f.items.includes(i)).periodo} · ${nombreItem(i)}` })
  return h('article', { class: 'card pago', 'aria-label': `Pago ${p.id}` },
    h('div', { class: 'row' }, h('h2', { class: 'h3' }, p.fecha ? ['Transferencia del ', h('span', { class: 'mono' }, formatoFecha(p.fecha))] : 'Pago registrado sin comprobante'), insignia(ESTADO_PAGO[p.estado])),
    h('ul', { class: 'lista-simple' }, ...conceptos.map(c => h('li', {}, c))),
    fila('Total de los ítems', importe(totalPago(db, p))),
    p.importeInformado !== null ? fila('Importe informado', importe(p.importeInformado)) : null,
    p.operacion ? fila('N.º de operación', h('span', { class: 'mono' }, p.operacion)) : null,
    h('span', { class: 'ayuda' }, `${p.comprobantes.length} ${p.comprobantes.length === 1 ? 'comprobante registrado' : 'comprobantes registrados'}`),
    p.comprobantes.length === 0 && cuenta.rol === 'PADRE' && puedeVerOriginal(cuenta, p) && p.estado === 'pendiente'
      ? enlaceBoton('Cargar comprobante', ruta(hijo, `pago/${p.id}/comprobante`)) : null,
    p.comprobantes.length > 0
      ? (conArchivo ? [h('span', { class: 'ayuda' }, [icono('archivo', 16), ' Comprobante cargado por vos.']), enlaceBoton('Ver archivo (simulado)', ruta(hijo, `archivo/${p.id}`), 'sec2')]
        : h('span', { class: 'ayuda restringido' }, [icono('candado', 16), cuenta.rol === 'ESTUDIANTE' ? ' El archivo no está disponible para estudiantes.' : ' Archivo restringido a quien lo cargó y a Dirección.']))
      : null)
}
export function comprobantes(ctx, { hijo }) {
  const { db, cuenta } = ctx.estado
  const lista = pagosDe(db, hijo).slice().sort((a, b) => (b.fecha ?? '9999').localeCompare(a.fecha ?? '9999'))
  const estudiante = cuenta.rol === 'ESTUDIANTE'
  const otro = cuenta.rol === 'PADRE' && lista.some(p => p.comprobantes.length > 0 && !puedeVerOriginal(cuenta, p))
  return marco(ctx, { titulo: 'Comprobantes', nav: 'cuotas', cuerpo: h('div', { class: 'stack' },
    contexto(ctx, hijo),
    titulo('Pagos y comprobantes'),
    estudiante ? alerta('info', 'candado', h('strong', {}, 'Solo consulta.'), ' Ves el registro de los comprobantes, no el archivo. La carga la realiza tu padre o madre vinculado.')
      : otro ? alerta('info', 'candado', h('strong', {}, 'Archivo no disponible.'), ' Algunos comprobantes los cargó otra persona vinculada. Ves el registro, no el archivo.') : null,
    lista.length === 0 ? h('div', { class: 'card estado-vacio' }, icono('facturas', 40), h('h2', { class: 'h3' }, 'Todavía no hay pagos registrados')) : lista.map(p => tarjetaPago(ctx, hijo, p)),
    volver('Volver a cuotas', ruta(hijo, 'cuotas'))) })
}

export function archivo(ctx, { hijo, pago }) {
  return marco(ctx, { titulo: 'Comprobante', nav: 'cuotas', cuerpo: h('div', { class: 'stack' },
    contexto(ctx, hijo),
    titulo('Vista simulada del comprobante'),
    alerta('info', 'info', 'No hay un archivo real: el prototipo no guarda, envía ni muestra binarios.'),
    h('section', { class: 'card', 'aria-label': 'Archivos del pago' }, ...pago.comprobantes.map(c => h('div', { class: 'archivo' }, icono('archivo', 24),
      h('div', { class: 'cuerpo' }, h('div', {}, c.nombre), h('div', { class: 'ayuda' }, formatoTamano(c.bytes)))))),
    volver('Volver a pagos y comprobantes', ruta(hijo, 'comprobantes'))) })
}

// ---------- período, deuda, inscripciones ----------
function filtroFechas(ctx, clave) {
  const f = ctx.estado.ui[clave]
  return h('form', { class: 'card', novalidate: '', 'aria-label': 'Rango de fechas', onsubmit: e => { e.preventDefault(); ctx.aplicarRango(clave) } },
    h('h2', { class: 'sec' }, 'Rango de fechas'),
    campo({ id: `${clave}-desde`, etiqueta: 'Desde', valor: f.desdeTexto, error: f.errorDesde, ayuda: 'Formato dd/mm/aaaa; el extremo se incluye.', modo: 'numeric', alCambiar: e => { f.desdeTexto = e.target.value } }),
    campo({ id: `${clave}-hasta`, etiqueta: 'Hasta', valor: f.hastaTexto, error: f.errorHasta, ayuda: 'Formato dd/mm/aaaa; el extremo se incluye.', modo: 'numeric', alCambiar: e => { f.hastaTexto = e.target.value } }),
    boton('Aplicar', { tipo: 'submit', id: `${clave}-aplicar` }))
}
export function periodo(ctx, { hijo }) {
  const { db, ui, cuenta } = ctx.estado
  const { desde, hasta } = ui.periodo
  const pagos = pagosEnRango(db, hijo, desde, hasta), sinPagos = facturasSinPagosEnRango(db, hijo, desde, hasta), t = totalesPeriodo(db, hijo, desde, hasta)
  const estudiante = cuenta.rol === 'ESTUDIANTE'
  return marco(ctx, { titulo: 'Facturas por período', nav: 'periodo', cuerpo: h('div', { class: 'stack' },
    contexto(ctx, hijo), titulo('Facturas por período'),
    filtroFechas(ctx, 'periodo'),
    h('section', { class: 'stack', 'aria-labelledby': 'h-pagos' }, h('h2', { id: 'h-pagos', class: 'sec' }, 'Pagos informados'),
      h('p', { class: 'ayuda' }, 'Ubicados por fecha de transferencia. Pendiente de verificación no es pago confirmado.'),
      pagos.length === 0 ? h('p', { class: 'muted' }, 'No hay pagos informados en este rango.') : pagos.map(p => tarjetaPago(ctx, hijo, p))),
    h('section', { class: 'card', 'aria-labelledby': 'h-sinpagos' }, h('h2', { id: 'h-sinpagos', class: 'sec' }, 'Facturas sin pagos'),
      h('span', { class: 'ayuda' }, 'Se ubican por su fecha de vencimiento (día 10).'),
      sinPagos.length === 0 ? h('span', { class: 'muted' }, 'Ninguna factura sin pagos vence en este período.')
        : sinPagos.map(f => h('a', { class: 'item col enlace-fila', href: ruta(hijo, `factura/${f.id}`) }, h('div', { class: 'row' }, h('strong', {}, f.periodo), insignia(ESTADO_FACTURA[estadoFactura(f)])),
          fila('Vencimiento', h('span', { class: 'mono' }, formatoFecha(f.vence))), fila('Saldo', importe(saldoFactura(f)), true)))),
    h('div', { class: 'card' }, fila('Aprobados', importe(t.aprobados)), fila('Pendiente de verificación', importe(t.verificacion))),
    estudiante ? h('p', { class: 'ayuda' }, 'Ves el registro de los comprobantes, no el archivo.') : null) })
}
export function deuda(ctx, { hijo }) {
  const { db, ui } = ctx.estado
  const { desde, hasta } = ui.deuda
  const { grupos, total } = deudaPorItem(db, hijo, desde, hasta)
  return marco(ctx, { titulo: 'Deuda por ítem', nav: 'deuda', cuerpo: h('div', { class: 'stack' },
    contexto(ctx, hijo), titulo('Deuda por ítem'),
    filtroFechas(ctx, 'deuda'),
    h('div', { class: 'total' }, h('span', {}, 'Total adeudado'), h('span', { class: 'mono grande', id: 'total-deuda' }, formatoArs(total)), h('span', { class: 'small' }, 'Suma de los saldos por ítem')),
    grupos.length === 0 ? h('p', { class: 'muted' }, 'No hay facturas con vencimiento en este rango.') : null,
    ...grupos.map(g => h('section', { class: 'card', 'aria-label': CONCEPTOS[g.concepto] },
      h('div', { class: 'row' }, h('h2', { class: 'h3' }, CONCEPTOS[g.concepto]), h('span', {}, 'Saldo ', importe(g.saldo))),
      ...g.filas.map(r => h('div', { class: 'item col' }, h('div', { class: 'row' }, h('strong', {}, r.factura.periodo), insignia(ESTADO_ITEM[r.item.estado])),
        fila('Importe', importe(r.importe)), fila('Pagado', importe(r.pagado)), fila('Saldo', importe(r.saldo), true))))),
    h('p', { class: 'ayuda' }, 'Un ítem en verificación conserva su saldo hasta la aprobación de Dirección. El rango se aplica al vencimiento de la factura.')) })
}
export function inscripciones(ctx, { hijo }) {
  const i = ctx.estado.db.inscripciones[hijo]
  const sin = 'Sin inscripción'
  return marco(ctx, { titulo: 'Inscripciones', nav: 'inscripciones', cuerpo: h('div', { class: 'stack' },
    contexto(ctx, hijo), titulo('Inscripciones'),
    h('section', { class: 'card', 'aria-labelledby': 'h-dep' }, h('h2', { id: 'h-dep', class: 'sec' }, 'Deporte'),
      i.deporte ? [h('span', { class: 'h3' }, i.deporte), fila('Horario', i.horario), fila('Profesor', i.profesor)] : h('span', {}, sin)),
    h('section', { class: 'card', 'aria-labelledby': 'h-tra' }, h('h2', { id: 'h-tra', class: 'sec' }, 'Transporte'), h('span', { class: 'h3' }, i.transporte ?? sin)),
    h('section', { class: 'card', 'aria-labelledby': 'h-com' }, h('h2', { id: 'h-com', class: 'sec' }, 'Comedor'), h('span', { class: 'h3' }, i.comedor)),
    h('p', { class: 'ayuda' }, 'Solo consulta.')) })
}
