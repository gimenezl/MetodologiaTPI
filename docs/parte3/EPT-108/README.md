# EPT-108 · Selección de ítems a pagar y registro inicial del pago

Historia P3-HU8 (EPT-108) y sus subtareas EPT-141 a EPT-146. Este documento describe el contrato
implementado; la evidencia de ejecución está en [`docs/evidence/EPT-108.md`](../../evidence/EPT-108.md).

## Alcance

Un PADRE habilitado y vinculado hoy a su hijo puede, desde la aplicación Expo:

1. elegir uno o varios ítems **completos** de las facturas de **un mismo hijo**;
2. ver el total **calculado por el servidor** y los datos bancarios institucionales (ficticios);
3. confirmar el registro y obtener un pago **PENDIENTE_VERIFICACION** con identidad durable.

Fuera de alcance (otras tarjetas): fecha de transferencia, importe informado, número de operación y
comprobante (EPT-109); aprobación, rechazo, liberación, recibos y correos (EPT-110/111); expiración o
liberación automática de pendientes (no existe una regla aprobada).

## Contrato de base de datos (migración `20261015180000_ept_108_seleccion_registro_pago.sql`)

| Operación | Efecto | Quién |
|---|---|---|
| `public.cotizar_pago(p_item_ids uuid[])` | Sin efectos: valida la selección y devuelve total en centavos, ítems y datos bancarios | PADRE habilitado |
| `public.registrar_pago(p_clave_intento uuid, p_item_ids uuid[], p_total_esperado_centavos bigint)` | Atómico: pago PENDIENTE_VERIFICACION + imputaciones + ítems EN_VERIFICACION | PADRE habilitado |
| `public.consultar_intento_pago(p_clave_intento uuid)` | Sin escritura: resultado durable de un intento propio | PADRE habilitado |
| `public.datos_bancarios_transferencia()` | Datos bancarios ficticios | PADRE habilitado |

Todas son envoltorios `SECURITY INVOKER` sobre cuerpos `SECURITY DEFINER` en `app_private`, con
`search_path` vacío; solo `authenticated` ejecuta. Ningún rol de aplicación recibe escritura directa.

### Autoridad

* La identidad sale de `auth.uid()` y del perfil **vigente**; ningún argumento transporta padre, rol,
  estado ni importe como autoridad.
* `p_total_esperado_centavos` es una **precondición de consentimiento** (detecta una cotización
  desactualizada, P6857). El importe cobrado se recalcula siempre desde `items_factura.importe`
  (importe histórico, no la tarifa actual).
* El total se calcula con `NUMERIC` exacto y se entrega en centavos enteros (`bigint`), dentro del rango
  seguro de JavaScript (< 10^12).

### Orden de bloqueos (sin ciclos, sin autorización vieja)

1. perfil del actor `FOR SHARE` (guarda de EPT-103): una revocación posterior **espera**, una anterior
   rechaza con 42501;
2. consultivo del intento `(padre, clave)`: serializa reintentos idénticos;
3. vínculo `(padre, hijo)` `FOR SHARE`: un `DELETE` concurrente del vínculo espera;
4. ítems seleccionados `FOR UPDATE` ordenados por `id`.

Solo hay dos órdenes seriales válidos entre un registro y la revocación del permiso. Tradeoff aceptado
(igual que EPT-103): una revocación puede esperar a un registro que ya estaba autorizado.

### Idempotencia e incertidumbre

* `pagos.clave_intento` + `pagos.huella_seleccion` (SHA-256 de la selección canónica). Único por
  `(padre_id, clave_intento)`.
* Mismo intento y mismo contenido → mismo pago (`repetido = true`). Misma clave con otro contenido →
  P6856. Claves distintas no pueden reservar dos veces un ítem (índice único parcial de imputaciones
  activas + bloqueo de fila).
* La clave **no** es el número de operación bancaria y no es un secreto.
* Distinción en el cliente: **registrado**, **rechazado con certeza** (4xx con código de la función; la
  transacción se revirtió) e **incierto** (sin respuesta, 5xx o ilegible). Ante la incertidumbre no se
  reenvía hasta consultar el intento.

### Códigos propios

| SQLSTATE | Significado |
|---|---|
| P6850 | Selección inválida (vacía, nula, duplicada, > 100) o argumentos ausentes |
| P6851 | Ítem inexistente, ajeno o de un hijo sin vínculo vigente (mismo error: no confirma existencia) |
| P6852 | Ítems de hijos distintos |
| P6853 | Ítem pagado, en verificación o reservado |
| P6854 | Ítem sin cargo (importe 0) |
| P6855 | Factura con importes incoherentes (suma de ítems ≠ total): no se cobra ni se corrige |
| P6856 | Clave de intento usada con otra selección |
| P6857 | El total cambió desde la cotización |
| 42501 / P5505 | Identidad no autorizada / sin identidad |

### Decisiones sobre el contrato real

* **Ítem con importe 0**: EPT-107 lo presenta como «Sin cargo» y una factura de total 0 es PAGADA; por
  coherencia no es seleccionable (P6854). No se inventa un pago de cero.
* **Factura incoherente**: se rechaza; no se «arregla» ocultando ni cobrando otra cantidad.
* **Selección duplicada**: error del cliente, no se normaliza en silencio.
* **Copadre**: ve el pago del otro padre (política de EPT-101) y no puede reservar lo ya reservado.

## Datos bancarios (EPT-143, decisión EPT-84 punto 8)

Fuente única y reproducible: `app_private.datos_bancarios_institucion()` en la migración. Valores
**ficticios**, fijos y precargados; sin tabla editable ni pantalla de configuración. El CBU son 22 ceros
(no cumple los dígitos verificadores) y la respuesta lleva `ficticio: true` y un aviso que la aplicación
muestra.

**Reconciliación con el prototipo**: el escenario «Datos bancarios: no configurados» de M05/V15 era
provisional. La decisión aprobada (datos fijos precargados) lo reemplaza: la aplicación nunca muestra
«banco no configurado» y no hay estado de configuración. EPT-122 (release, migraciones, cron) no es una
dependencia de esta configuración.

## Aplicación móvil

Flujo: **Cuotas → Pagar ítems → Registrar pago → Pago registrado**. Solo el PADRE ve «Pagar ítems»; el
estudiante y los demás roles no tienen la acción ni la pantalla, y el servidor rechaza igualmente la
operación (42501).

| Pieza | Archivo |
|---|---|
| Servicios (RPC, validación estricta, clasificación de fallos) | `mobile/src/servicios/pagos.ts` |
| Recuperación del intento (almacenamiento cifrado por usuario) | `mobile/src/servicios/intento-pago.ts` |
| Contenedor (estado, concurrencia, incertidumbre) | `mobile/src/contenedores/pagos/PagoContenedor.tsx` |
| Vistas presentacionales | `mobile/src/contenedores/pagos/PagoVistas.tsx` |
| `FilaSeleccionable` y `ResumenTotal` (EPT-99) | `mobile/src/catalogo/Seleccion.tsx` |

Reglas del contenedor:

* el total mostrado es el del servidor y está atado a la selección exacta que lo originó;
* un solo envío en vuelo (el doble toque no duplica);
* un resultado incierto no permite otro envío hasta verificar; el reintento usa la **misma clave**;
* volver o cancelar antes de confirmar no escribe; después de confirmar, no libera nada;
* una respuesta atrasada no se aplica a otro hijo, a otra selección ni a otra cuenta (el contenedor se
  remonta por `usuario:hijo`, las lecturas se cancelan y cada resultado queda atado a su contexto);
* lo guardado para recuperación contiene solo identificadores y el total visto, acotado por usuario.

## Matriz de trazabilidad

La matriz requisito → implementación → prueba → evidencia → tarjeta está en
[`docs/evidence/EPT-108.md`](../../evidence/EPT-108.md#matriz-de-trazabilidad).

## Reversión

La migración es aditiva y forward-only. Antes de usarse en producción se puede revertir con una
migración nueva que elimine las cuatro funciones públicas, las cinco privadas y las dos columnas de
`pagos` (más su índice). **Después** de registrar pagos reales, eliminar las columnas pierde la identidad
de idempotencia (los pagos y sus imputaciones permanecen válidos): no es una reversión inocua y exige
evaluación explícita.

## Bitácora de IA

| Campo | Registro |
|---|---|
| Tarjetas | EPT-108, EPT-141 a EPT-146 |
| Problema | Diseñar y verificar el registro atómico e idempotente del pago pendiente y su pantalla móvil |
| Prompt | Encargo de la sesión: implementar HU8 con base de datos, RPC, aplicación React Native, pruebas y entrega |
| Respuesta | Migración SQL, suites SQL/concurrencia/API, servicios y pantallas móviles, pruebas Jest, documentación |
| Comprensión y adaptación | Se reutilizó la guarda `FOR SHARE` de EPT-103, las vistas de EPT-107 y el catálogo de EPT-99; se ajustó el contrato a las reglas reales (ítem cero, factura incoherente) |
| Prueba | Suites SQL, concurrencia con conexiones reales, etapa de API con JWT reales, Jest y mutaciones focales (ver evidencia) |
| Resultado | Ver evidencia. No hay aprobación docente registrada ni inventada |
