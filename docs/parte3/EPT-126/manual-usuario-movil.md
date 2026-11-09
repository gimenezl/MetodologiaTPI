# Manual de usuario de la aplicación móvil — Educar para Transformar

Guía para **padres, madres y tutores** (rol «Familia») y para **estudiantes** que usan la aplicación móvil de la institución. Describe lo que la aplicación hace hoy: cada pantalla, botón y mensaje de este manual se verificó contra el código de la carpeta `mobile/` (ver la [evidencia](../../evidence/EPT-126.md)).

> **Importante.** La aplicación sirve para **consultar** cuotas, deuda e inscripciones, **registrar un pago por transferencia** y **adjuntar el comprobante**. No cobra ni acredita nada por sí misma: la institución verifica cada pago y recién entonces baja el saldo.

## 1. Qué podés hacer según tu perfil

| Función | Familia (padre, madre o tutor) | Estudiante |
|---|---|---|
| Iniciar sesión y recuperar la contraseña | Sí | Sí |
| Ver los datos de los hijos vinculados / los propios | Sí («Hijos vinculados») | Sí («Mi información») |
| Consultar cuotas y su detalle | Sí, de cada hijo | Sí, las propias |
| Elegir ítems y registrar un pago | **Sí** | No |
| Adjuntar comprobantes de transferencia | **Sí** | No |
| Consultar facturas y pagos por período, y descargar recibos | Sí, de cada hijo | Sí, los propios |
| Consultar la deuda por ítem | Sí, de cada hijo | Sí, la propia |
| Consultar inscripciones (deportes, transporte, comedor) | Sí, de cada hijo | Sí, las propias |
| Cambiar la contraseña desde «Mi cuenta» | Sí | Sí |

Los perfiles de **Dirección, Docencia y Personal** no tienen funciones en la aplicación móvil: al ingresar ven el aviso «Esta cuenta usa el sistema web» y el botón «Abrir sistema institucional», que abre el sitio web de la institución.

Qué **no** hace la aplicación: aceptar pago en efectivo (la pantalla de pago lo aclara), pagar con tarjeta o pasarela, agregar, modificar o cancelar inscripciones, ni funcionar sin conexión.

## 2. Antes de empezar

- Usá **la misma cuenta** que ya tenés en el sistema institucional (correo y contraseña). La aplicación no crea cuentas.
- Necesitás conexión a internet. Si falta, la aplicación avisa y ofrece reintentar; no muestra datos que no pudo validar.
- Para adjuntar un comprobante con foto, la aplicación puede pedir permiso para usar la cámara. Es opcional: también podés elegir una imagen de la galería o un archivo.
- Si ves «Aplicación no configurada / Falta configuración pública», la instalación no está completa: avisá a la institución.

## 3. Iniciar sesión

1. Abrí la aplicación. Si hay una sesión guardada, aparece «Comprobando la sesión…» y entrás directo.
2. En **Iniciar sesión** completá **Correo electrónico** y **Contraseña**. El ícono para mostrar u ocultar la contraseña te deja revisar lo que escribís.
3. Tocá **Ingresar** (o el botón de enviar del teclado).

Mensajes posibles:

| Mensaje | Qué significa |
|---|---|
| «Ingresá tu correo electrónico.» / «Ingresá un correo electrónico válido.» / «Ingresá tu contraseña.» | Falta un dato o el correo no tiene formato válido. |
| «No se pudo iniciar sesión. Revisá el correo y la contraseña.» | Credenciales incorrectas. Por seguridad no se aclara cuál de los dos datos falló. |
| «Conexión no disponible» + **Reintentar** | No se pudo verificar el acceso. Revisá la conexión y tocá Reintentar. |
| «Acceso bloqueado» | La cuenta no está habilitada. Contactá a la institución. Tocá «Volver al inicio de sesión». |
| «Perfil no disponible» | La cuenta no tiene un perfil habilitado. Contactá a la institución. |
| «Acceso no disponible» | El rol de la cuenta no es compatible con esta aplicación. Contactá a la institución. |

Tras ingresar, el título pasa a **«Tu cuenta móvil»**. El botón **Cerrar sesión** está siempre al pie.

## 4. Navegación

Debajo del título hay una **tira de secciones** que se desliza de izquierda a derecha (en pantallas angostas no entran todas). En este orden:

1. **Hijos vinculados** (Familia) o **Mi información** (Estudiante)
2. **Cuotas**
3. **Mi cuenta**
4. **Deuda por ítem**
5. **Por período**
6. **Inscripciones**

La sección activa se muestra en azul. Dentro de cada sección:

- Si sos familia, aparece el selector **«Estudiante»** con un botón por hijo; el hijo elegido queda resaltado y toda la pantalla trabaja sobre él. Cambiar de hijo cierra el detalle, el pago o el comprobante que tuvieras abierto, para no mezclar datos.
- Las secciones que no son la principal muestran una flecha para **volver a la sección principal**. Las pantallas internas de Cuotas (detalle, pago, comprobantes) traen su propio «Volver a las cuotas».
- Al volver la aplicación al primer plano, las cuotas se vuelven a consultar para mostrarte datos actualizados.

## 5. Recuperar o cambiar la contraseña

### 5.1 Si olvidaste la contraseña

1. En **Iniciar sesión**, tocá **¿Olvidaste tu contraseña?** (abre «Recuperar contraseña»).
2. Escribí tu correo y tocá **Enviar enlace**.
3. Verás «Revisá tu correo»: *si el correo corresponde a una cuenta, te enviamos un enlace*. La aplicación responde igual exista o no la cuenta, para no revelar quién está registrado. Revisá también la carpeta de correo no deseado.
4. **Abrí el enlace desde este mismo teléfono.** Si pediste más de uno, usá el último. El enlace vuelve a la aplicación.
5. En **«Elegí una contraseña nueva»** completá **Nueva contraseña** y **Repetí la nueva contraseña** y tocá **Guardar contraseña**. Con **Cancelar** salís sin cambiar nada.
6. Al terminar aparece «Contraseña actualizada»: tocá **Ir a iniciar sesión** e ingresá con la nueva contraseña.

Detalles útiles:

- Después de pedir un enlace hay una espera de **60 segundos** para pedir otro («Podés pedir otro enlace en N s.»); el botón pasa a **Reenviar enlace**. Si se envían demasiados correos, la aplicación pide esperar unos minutos.
- Si el enlace venció, ya se usó, está incompleto o no corresponde a una recuperación, la pantalla «No pudimos usar el enlace» ofrece **Pedir un enlace nuevo** o **Volver al inicio de sesión**.
- Si ya había una sesión iniciada en el teléfono, aparece «Hay una sesión iniciada»: **Cerrar esa sesión y continuar** la reemplaza; **Cancelar** no cambia nada.
- Si la contraseña no cumple los requisitos, el mensaje indica qué falta (más caracteres, combinar letras, números o símbolos, o no ser una contraseña filtrada en otros sitios). «Las contraseñas no coinciden.» aparece si los dos campos difieren.

### 5.2 Si ya ingresaste y querés cambiarla

1. Entrá a **Mi cuenta** → tarjeta **Seguridad** → **Cambiar contraseña**.
2. Completá la nueva contraseña y su repetición, y tocá **Guardar contraseña**.
3. Por seguridad, la aplicación puede pedir un **código de verificación** que te llega por correo: ingresalo y volvé a guardar. **Reenviar código** pide otro.
4. «Contraseña actualizada» confirma el cambio; **Volver a Mi cuenta** regresa. Tus datos y vínculos no cambian.

Si la sesión venció o cambió mientras completabas el formulario, aparece «Tu sesión cambió»: no se modificó ninguna contraseña y hay que volver a iniciar sesión.

## 6. Hijos vinculados / Mi información

- **Familia:** «Hijos vinculados» lista una tarjeta por hijo con nombre, **Legajo**, **Estado**, **Curso** y **Nivel**. Si no hay vínculos, ves «Todavía no hay estudiantes vinculados»: los vínculos los registra la institución.
- **Estudiante:** «Mi información académica» muestra tus propios datos (estudiante, legajo, estado, curso y nivel).

## 7. Cuotas

Entrá a **Cuotas**. Si sos familia, elegí primero el hijo en el selector «Estudiante».

### 7.1 Lista de cuotas

Dos pestañas: **Pendientes (n)** y **Pagadas (n)**. Cada tarjeta «Cuota de *mes año*» muestra:

- el **estado** (insignia con texto y símbolo, no solo color): *Pendiente*, *Pago parcial*, *Pagada* o *Vencida*;
- **Vencimiento**, **Importe** y **Saldo**;
- si está vencida, el aviso «Vencida el… Regularizá el saldo pendiente.» con borde rojo;
- si hay ítems con pago en verificación: «…un pago en verificación. El saldo baja recién cuando la institución lo aprueba.»;
- si los importes no coinciden entre sí, el aviso «Revisá esta cuota con la institución» (se muestra el saldo tal como figura, sin ajustes).

Al pie figura «Estados calculados al *fecha* (hora de Argentina)». Si no hay datos: «No hay cuotas pendientes» / «Todavía no hay cuotas pagadas». Si falla la consulta: «No pudimos cargar las cuotas» con **Reintentar**.

### 7.2 Detalle de una cuota

Tocá **Ver detalle** en una tarjeta. Verás el **Importe total**, lo **Pagado con pagos aprobados** y el **Saldo**, y la lista de **Conceptos** (Cuota, Deportes, Transporte, Comedor), cada uno con su importe y estado (*Pagado*, *En verificación* o *Pendiente*; «Sin cargo» si el importe es cero). **Volver a las cuotas** regresa a la lista.

En la lista de cuotas (no en el detalle), solo la **Familia** ve además los botones **Pagar ítems** (si hay cuotas pendientes) y **Comprobantes de mis pagos**, descritos a continuación. El estudiante consulta, pero no paga ni adjunta.

## 8. Pagar ítems (solo Familia)

El pago es **por transferencia bancaria**. La aplicación no mueve dinero: registra qué ítems vas a pagar y calcula el total.

1. En **Cuotas**, con el hijo elegido, tocá **Pagar ítems**.
2. En «Elegí los ítems a pagar» aparece una tarjeta por cuota con sus ítems. Tocá cada ítem para seleccionarlo. Cada ítem se paga **completo**. Los ítems **pagados**, **en verificación**, **sin cargo** o con importes inconsistentes **no se pueden seleccionar** (un texto lo explica: «Ya está pagado.», «Tiene un pago en verificación.», etc.). Un pago solo incluye ítems **de un mismo estudiante**.
3. El recuadro **Total a transferir** lo **calcula el servidor** y se actualiza al seleccionar («N ítems seleccionados · calculado por el sistema»). Hasta elegir al menos un ítem figura «Seleccioná al menos un ítem para continuar».
4. En **Datos para la transferencia** figuran Banco, Titular, CUIT, Tipo de cuenta, CBU y Alias. Podés mantener el dedo sobre un dato para copiarlo. Si ves el aviso «Datos de prueba», son datos ficticios de un entorno de prueba: no transfieras. **No se acepta pago en efectivo.**
5. Hacé la transferencia desde tu banco por el **Total a transferir** y, de vuelta en la aplicación, tocá **Registrar pago**. El botón está inactivo hasta que el total esté calculado.

### Resultados

| Pantalla | Qué significa | Qué hacer |
|---|---|---|
| **Pago registrado** — «Pago registrado: pendiente de verificación.» | El pago quedó anotado. Los ítems pasan a *En verificación* y **el saldo no cambia** hasta que la institución apruebe. Se muestra el **Código del pago** (8 caracteres), el total, los ítems y los datos bancarios. | Tocá **Adjuntar comprobante** (sección 9) o **Volver a las cuotas**. |
| «Este pago ya estaba registrado: no se duplicó.» | Repetiste el envío; el sistema evita duplicados. | Nada. |
| **No se registró el pago** — «No registramos nada.» | La selección ya no es válida (por ejemplo, un ítem ya pagado, o «El total cambió desde que lo viste»). | **Volver a la selección** y confirmá de nuevo. |
| **No pudimos confirmar el pago** — «Todavía no sabemos si se registró.» | Se cortó la conexión en el momento del envío. La aplicación **no reenvía sola** para no duplicar. | **Verificar resultado**. Si no figura registrado: **Reintentar el mismo pago** (es seguro: no se duplica). El intento queda guardado en el teléfono para verificarlo más tarde. |

## 9. Adjuntar el comprobante de transferencia (solo Familia)

El comprobante **no aprueba el pago ni cambia el saldo**: lo revisa la institución.

**Cómo llegar:** desde «Pago registrado» tocá **Adjuntar comprobante**, o desde **Cuotas** tocá **Comprobantes de mis pagos**, que lista los pagos pendientes de verificación del hijo elegido (cada uno con «Pago *CÓDIGO*», su total y cuántos comprobantes tiene) y elegí **Adjuntar comprobante** en el que corresponda. Si no hay pagos pendientes verás «No hay pagos pendientes de verificación».

**Pasos en «Adjuntar comprobante»:**

1. Revisá el resumen (estudiante, código y total calculado por la institución).
2. En **Datos de la transferencia** completá:
   - **Fecha de la transferencia**: formato DD/MM/AAAA (ej. 14/10/2026);
   - **Importe transferido**: hasta dos decimales, con coma o punto (ej. 15000,50). Puede diferir del total calculado: la institución lo revisa. No uses separador de miles;
   - **Número de operación**: figura en el comprobante de tu banco.
   Si el pago ya tiene estos datos informados, se muestran bloqueados («un archivo nuevo no los modifica»).
3. En **Archivo del comprobante** elegí uno (JPG o PNG, o PDF, de **hasta 5 MB**):
   - **Tomar foto** (pide permiso de cámara; si lo denegaste, habilitalo en Ajustes del teléfono o usá otra opción);
   - **Elegir una imagen de la galería**;
   - **Elegir un PDF o archivo**.
   Las imágenes se reducen y se recomprimen a JPG antes de enviarse, lo que además descarta los metadatos (por ejemplo la ubicación). Verás una vista previa y el nombre y tamaño; **Quitar archivo** lo descarta.
4. Tocá **Enviar comprobante** (inactivo hasta elegir un archivo). Aparece «Enviando comprobante…» con tres pasos (preparando, subiendo con porcentaje, verificando en el servidor). **No cierres la aplicación hasta que termine.**

**Resultados:**

| Pantalla | Qué significa | Qué hacer |
|---|---|---|
| **Comprobante enviado** — «Comprobante recibido: pendiente de verificación.» | Quedó registrado; se muestran fecha, importe informado, número de operación y cantidad de comprobantes del pago. El saldo no cambia hasta que la institución apruebe. | **Adjuntar otro comprobante** o **Volver a las cuotas**. |
| **No se registró el comprobante** | Se rechazó el envío (por ejemplo, número de operación ya registrado en otro pago, datos distintos a los ya informados, archivo inválido o carga vencida). El mensaje indica el motivo. | **Volver a intentar** con los datos corregidos. |
| **No pudimos confirmar el envío** | Resultado incierto por la conexión; no se reenvía solo. | **Verificar resultado**. La carga queda guardada para verificarla después. |

## 10. Consultas

Las tres consultas son de **solo lectura**.

### 10.1 Por período: facturas y estado de los pagos

1. Entrá a **Por período** (si sos familia, elegí el hijo).
2. Completá **Desde** y **Hasta** (DD/MM/AAAA; los extremos están incluidos).
3. Elegí **qué fecha se usa para los comprobantes**: **Período de factura** (pagos que cubren facturas cuyo mes cae dentro del rango) o **Fecha de transferencia** (la que informó la familia).
4. Tocá **Consultar**.

Resultados:

- **Facturas por período de factura:** por cada factura, estado, vencimiento, importe, saldo, cantidad de pagos relacionados y de comprobantes.
- **Comprobantes** (el registro de cada pago): fecha del pago, **estado** (*Pendiente de verificación*, *Aprobado* o *Rechazado*), fecha de transferencia, importe informado, importe imputado (aprobado) o seleccionado, la diferencia entre ambos, los ítems abonados o «Ítems seleccionados, no abonados», el motivo del rechazo si lo hubo, la cantidad de comprobantes y las facturas que cubre.
- Solo se muestra el **registro** del comprobante. El **archivo original** solo lo puede ver quien lo cargó y la Dirección de la institución.

### 10.2 Recibos

En el registro de un pago **Aprobado** aparece **Descargar recibo PDF**. Al tocarlo se prepara el archivo («Preparando recibo…», con **Cancelar descarga**) y se abre el menú del teléfono para guardarlo o compartirlo. El archivo temporal se elimina al cerrar ese menú. Si todavía no está listo verás «Recibo preparándose. Consulta nuevamente o contacta a Dirección.». Los pagos pendientes o rechazados no tienen recibo.

### 10.3 Deuda por ítem (historial de deuda)

1. Entrá a **Deuda por ítem** (elegí el hijo si sos familia).
2. Opcional: filtrá por **período de factura** con **Desde** y **Hasta** y tocá **Aplicar filtro**. **Ver todo el historial** quita el filtro. Se toma el mes de cada fecha; no es la fecha de transferencia.
3. **Total adeudado** muestra la suma del filtro completo, con ítems y facturas con saldo y la fecha de «Saldo vigente al». El saldo ya descuenta los pagos aprobados.
4. Debajo hay un bloque por concepto (Cuota, Deportes, Transporte, Comedor) con su **Subtotal adeudado** y una tarjeta por ítem con período, estado (*Pendiente*, *Vencida*, *En verificación*, *Pagado*, *Sin cargo*), vencimiento, importe, pagado y saldo. **Mostrar más ítems** carga más.

Un ítem **en verificación sigue figurando como deuda** hasta que se apruebe el pago. Si algunos importes no coinciden entre sí, aparece «Hay importes para revisar con la institución».

### 10.4 Inscripciones

**Inscripciones** muestra, agrupadas en **Deportes**, **Transporte (recorrido)** y **Comedor**, cada inscripción con estado (*Activa* o *Cancelada*), grupo, nivel del grupo, fecha de inscripción y, si corresponde, de cancelación. El aviso «Solo consulta» recuerda que desde la aplicación **no se pueden agregar, modificar ni cancelar**: lo gestiona la institución. Los nombres son los vigentes hoy en el catálogo.

## 11. Correos que envía el sistema (no son pantallas de la aplicación)

Dos avisos llegan **por correo electrónico**, uno por padre con el detalle de todos sus hijos, siempre que la institución tenga ese envío habilitado:

- **Recordatorio mensual:** el último día hábil de cada mes, con la factura del mes siguiente (vence el día 10) en PDF por cada hijo.
- **Aviso de deuda:** el día 20 de cada mes, con el detalle de la deuda pendiente de los hijos (no se envía si el saldo es cero ni lleva PDF). Un pago en verificación aparece aparte, pero sigue contando como deuda.

El correo es informativo: **el pago se hace por transferencia y se registra desde la aplicación**.

## 12. Cerrar sesión y privacidad

- **Cerrar sesión** (al pie) sale de la cuenta. Conviene usarlo si compartís el teléfono.
- La aplicación solo muestra datos de tus hijos vinculados (o los propios). Si un dato no se puede validar, **no se muestra**.
- Los archivos de comprobante y los recibos descargados son temporales en el teléfono y se limpian solos.
- Nunca compartas tu contraseña ni el código de verificación.

## 13. Problemas frecuentes

| Situación | Qué hacer |
|---|---|
| No puedo ingresar | Revisá correo y contraseña; si los olvidaste, usá «¿Olvidaste tu contraseña?». Si ves «Acceso bloqueado», contactá a la institución. |
| El enlace del correo no funciona | Pedí uno nuevo y abrilo desde el mismo teléfono; usá siempre el último correo recibido. |
| No veo a mi hijo | Los vínculos los registra la institución: contactala. |
| Pagué pero el saldo no bajó | Es lo esperado hasta que la institución verifique el pago. Adjuntá el comprobante y revisá «Por período» para ver el estado. |
| No puedo seleccionar un ítem | Ya está pagado, en verificación, sin cargo, o la cuota tiene importes para revisar. |
| «No pudimos confirmar…» | No reintentes por otro camino: usá **Verificar resultado**. |
| «Ese número de operación ya está registrado en otro pago» | Revisá el número en el comprobante de tu banco; cada transferencia se asocia a un solo pago. |
| Se cortó el envío del comprobante | Volvé a abrir el pago; la carga queda guardada y podés verificar el resultado. |
| No me deja usar la cámara | Habilitá el permiso en Ajustes del teléfono o elegí una imagen o un archivo. |

## 14. Glosario de estados

| Estado | Dónde aparece | Significado |
|---|---|---|
| Pendiente | Cuotas, ítems | Tiene saldo y todavía no hay pago en curso. |
| Pago parcial | Cuotas | Una parte de la cuota fue acreditada. |
| Vencida | Cuotas, deuda | Pasó el vencimiento con saldo pendiente. |
| En verificación | Ítems | Hay un pago registrado que la institución todavía no aprobó; no baja la deuda. |
| Pagada / Pagado | Cuotas, ítems | Saldo cero con pagos aprobados. |
| Pendiente de verificación | Pagos | Pago registrado, a la espera de la institución. |
| Aprobado | Pagos | La institución lo aprobó; el saldo bajó y hay recibo. |
| Rechazado | Pagos | La institución no lo aprobó; el motivo figura en el registro. |
| Activa / Cancelada | Inscripciones | Estado de la inscripción. |

## 15. Capturas de pantalla

Este manual **no incluye todavía capturas de la aplicación Expo ejecutada en un dispositivo o emulador**: el repositorio no contiene capturas de la aplicación real (solo diseños de EPT-95 y capturas del prototipo web de EPT-96, cuya navegación difiere de la aplicación) y no se ejecutó la aplicación en este trabajo. Para no mezclar imágenes de otro origen con las pantallas reales, se omitieron. Pantallas a capturar para completar el manual, con una misma cuenta de prueba, dispositivo y tema:

| N.º | Pantalla | Sección |
|---|---|---|
| F1 | Iniciar sesión | 3 |
| F2 | Recuperar contraseña (enlace enviado) | 5.1 |
| F3 | Tira de secciones con «Hijos vinculados» | 4 y 6 |
| F4 | Cuotas: pestaña Pendientes con selector de hijo | 7.1 |
| F5 | Detalle de una cuota | 7.2 |
| F6 | Pagar ítems con total y datos de transferencia | 8 |
| F7 | Pago registrado | 8 |
| F8 | Adjuntar comprobante con archivo elegido | 9 |
| F9 | Comprobante enviado | 9 |
| F10 | Por período con un pago aprobado y «Descargar recibo PDF» | 10.1 y 10.2 |
| F11 | Deuda por ítem | 10.3 |
| F12 | Inscripciones | 10.4 |
| F13 | Mi cuenta → Cambiar contraseña | 5.2 |
