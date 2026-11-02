# EPT-120: matriz de acceso por rol y archivos privados

La suite `supabase/tests/acceso_economico_matriz.mjs` cruza **recurso × actor × canal × operación × resultado** contra Auth, PostgREST, Storage y el servidor de Next reales, con el JWT de cada actor. `service_role` solo prepara el fixture y verifica el estado de Storage; ninguna operación bajo prueba lo usa. Cada caso `[XNN]` de la salida de la suite figura abajo.

Regla de construcción: toda negativa va precedida, dentro de su caso, de la positiva del actor autorizado sobre el mismo recurso y de la confirmación (con credencial de servidor) de que el recurso existe. Una denegación no puede venir de un fixture roto.

## Reglas vigentes que la matriz verifica (no se cambiaron para simplificar)

- **Original** de la transferencia: solo el padre que lo cargó y Dirección. El estudiante y el copadre vinculado no, ni siquiera el otro padre del mismo hijo.
- **Registro saneado y datos económicos** (facturas, ítems, pagos, imputaciones, resumen, historial): por alcance del hijo (Dirección, padre vinculado hoy, estudiante propio). Sin ruta, MIME ni URL.
- **Recibo institucional**: distinto del original. Lo ven padre, copadre vinculado, estudiante propio y Dirección. Otra familia y roles no autorizados, no. No existe bucket de recibos y `recibos.archivo_path` está fuera del GRANT.
- **PERSONAL** y **DOCENTE** no tienen acceso económico. **Dirección** verifica, pero ninguna tabla económica admite escritura de clientes (no edita importes).
- **Límite documentado, no garantía**: una URL firmada ya emitida sigue sirviendo hasta vencer aunque después se bloquee o desvincule a la cuenta o se le cambie el rol. Storage no impone un TTL máximo global (acepta firmar a un año). El tope de 60 s es del endpoint del producto. La suite verifica esa distinción (`L01`, `L02`, `E03`) y no afirma revocación instantánea.

## Actores y fixture

| Clave | Quién es |
|---|---|
| `padre` | padre cargador de P1 (original C1) |
| `copadre` | segundo padre vinculado al mismo hijo; cargador de P2 (cargas temporales) y P4 (original C4) |
| `otraFamilia` | padre de otra familia; cargador de P3 (original C3) |
| `alumno` | estudiante propio del hijo de `padre` y `copadre` |
| `ajeno` | estudiante de la otra familia |
| `director` | DIRECTOR habilitado que verifica P1 y P3 |
| `segundo` | DIRECTOR habilitado; al final pierde el rol (pasa a PERSONAL) |
| `bloqueado` | DIRECTOR con JWT emitido ANTES del bloqueo y todavía vigente en GoTrue (`V00`) |
| `docente`, `personal` | roles sin acceso económico |
| anónimo | sin sesión |

Recursos del fixture: P1 (aprobado, recibo R1, original C1), P2 (pendiente, cinco cargas temporales PREPARADAS), P3 (aprobado, recibo R3, original C3), P4 (pendiente, original C4). Los originales y los recibos se crean por los flujos reales (`registrar_pago`, `preparar_carga_comprobante`, subida al bucket temporal, finalización por HTTP con Bearer, `verificar_pago`).

## Matriz

La columna «Antes» indica si otra suite ya cubría la celda. `ES` = `economico_storage.mjs`, `CC` = `comprobantes_carga.mjs`, `CV` = `comprobantes_verificacion.mjs`, `RH` = `recibos_historial.mjs`. «Nuevo» = no estaba cubierto; «Parcial» = otra suite probaba un subconjunto de actores u operaciones.

### Facturas, ítems, pagos e imputaciones

| Recurso | Actor | Canal | Operación | Resultado esperado | Caso | Antes |
|---|---|---|---|---|---|---|
| facturas, ítems, pagos, imputaciones | Dirección (`director`, `segundo`) | PostgREST | lectura | todas las filas | R01, R02 | Parcial (ES, sin imputaciones por actor ni segundo Director) |
| facturas, ítems, pagos, imputaciones | `padre`, `copadre` | PostgREST | lectura | solo las del hijo vinculado, incluidos los pagos del otro padre | R01, R02 | Parcial (ES) |
| facturas, ítems, pagos, imputaciones | `alumno` | PostgREST | lectura | solo las propias | R01, R02 | Parcial (ES) |
| facturas, ítems, pagos, imputaciones | `otraFamilia`, `ajeno` | PostgREST | lectura | solo las de su familia; 0 del hijo ajeno | R01, R02 | Parcial (ES) |
| facturas, ítems, pagos, imputaciones | `docente`, `personal` | PostgREST | lectura | 0 filas | R01, R02 | Parcial (ES) |
| facturas, ítems, pagos, imputaciones | `bloqueado` (DIRECTOR, JWT previo) | PostgREST | lectura | 0 filas; antes del bloqueo veía todo | P01, R01, V01 | Nuevo (ES bloquea un PADRE) |
| todas las tablas económicas | anónimo | PostgREST | lectura | 401 o 403 con `42501` | R01 | Sí (ES) |
| imputaciones, pagos, registro, resumen | `copadre`, `padre` con vínculo revocado y JWT vigente | PostgREST y RPC | lectura | 0 filas; al revincular, vuelve el mismo acceso | V02, V03 | Nuevo |
| imputaciones, pagos, ítems, comprobantes | `segundo` con rol DIRECTOR cambiado a PERSONAL | PostgREST y RPC | lectura | 0 filas; al restaurar el rol, vuelve | V04 | Nuevo |
| tarifas | solo Dirección | PostgREST | lectura | 2 filas para Dirección, 0 para el resto, 42501 al anónimo | R03 | Parcial (ES) |
| `cargas_comprobante` | todos, incluida Dirección | PostgREST | lectura | 42501 (tabla cerrada) | R03 | Nuevo |
| facturas, ítems, imputaciones, pagos, recibos, comprobantes, cargas, tarifas | todos, incluida Dirección y el bloqueado | PostgREST | INSERT, PATCH, DELETE | 42501 y huella SHA de filas idéntica (no se editan importes) | R05, R05b, R99 | Parcial (ES, solo pagos y comprobantes y 4 actores) |
| pago pendiente | todos salvo Dirección habilitada, incluido el DIRECTOR bloqueado | RPC | `verificar_pago` | 401 o 403; el pago sigue pendiente | R06 | Parcial (CV, por la API web) |

### Registro saneado (sin ruta de archivo)

| Recurso | Actor | Canal | Operación | Resultado esperado | Caso | Antes |
|---|---|---|---|---|---|---|
| `resumen_comprobantes_pago` | `director`, `segundo`, `padre`, `copadre`, `alumno` (P1, P2) y `otraFamilia`, `ajeno`, Dirección (P3) | RPC | consulta | una fila con cantidad real (también 0 si no hay archivo) y solo `pago_id`, `cantidad_archivos`, `ultima_carga_en` | S01 | Parcial (ES) |
| `resumen_comprobantes_pago` | el resto, incluido el bloqueado | RPC | consulta | 0 filas | S01 | Parcial (ES) |
| `resumen_comprobantes_pago` | anónimo | RPC | consulta | 401 o 403 | S01 | Sí (ES) |
| `consultar_registro_comprobantes` | autorizado por hijo | RPC | consulta | los pagos del hijo (3 o 1), sin `ruta_archivo`, URL ni token | S02 | Parcial (RH) |
| `consultar_registro_comprobantes` | `alumno` sobre el hijo ajeno, `otraFamilia` sobre el nuestro, roles sin acceso, bloqueado | RPC | consulta | 200 con 0 filas | S02 | Parcial (RH) |

### Original del comprobante (Storage directo)

| Recurso | Actor | Canal | Operación | Resultado esperado | Caso | Antes |
|---|---|---|---|---|---|---|
| C1 | `padre` (cargador), `director`, `segundo` | Storage | descarga, firma, firma por lote, listado | bytes idénticos; la URL firmada sirve los bytes | O01, O02, O03 | Parcial (ES) |
| C4 | `copadre` (cargador), `director`, `segundo` | Storage | ídem | ídem | O01, O02, O03 | Nuevo |
| C3 | `otraFamilia`, `director`, `segundo` | Storage | ídem | ídem | O01, O02, O03 | Nuevo |
| C1, C3, C4 | `alumno` y `ajeno` (estudiante propio y ajeno, incluido el dueño del pago C3) | Storage | descarga, firma, firma por lote, listado | denegado; listado vacío | O01, O02, O03 | Parcial (ES, un estudiante y solo descarga y firma) |
| C1 | `copadre` (otro padre del mismo hijo) | Storage | ídem | denegado | O01, O02, O03 | Sí (ES) |
| C4 | `padre` (el otro padre del mismo hijo) | Storage | ídem | denegado | O01, O02, O03 | Nuevo |
| C1, C3, C4 | `otraFamilia`, `docente`, `personal` | Storage | ídem | denegado | O01, O02, O03 | Parcial (ES, solo C1) |
| C1, C3, C4 | `bloqueado` (DIRECTOR, JWT previo) | Storage | descarga, firma, listado | denegado; antes del bloqueo descargaba | P01, O01, V01 | Nuevo (ES bloquea un PADRE) |
| C1, C3, C4 | anónimo | Storage | descarga, firma, listado, ruta pública | denegado | O01, O02, O03, O04 | Parcial (ES) |
| bucket final | todos, incluidos los autorizados | Storage | subir, upsert, PUT, borrar, mover, copiar | rechazado; los tres originales idénticos (SHA-256) y sin objetos nuevos | O05 | Parcial (ES, 6 actores) |

### Endpoint `/api/comprobantes/[id]/archivo`

| Recurso | Actor | Canal | Operación | Resultado esperado | Caso | Antes |
|---|---|---|---|---|---|---|
| C1, C3, C4 | cargador correspondiente, `director`, `segundo` | cookies | GET | 302 sin caché a una URL firmada que sirve los bytes | E01 | Parcial (CC) |
| C1, C3, C4 | `alumno`, `ajeno`, `copadre` o `padre` ajeno al cargador, `otraFamilia`, `docente`, `personal` | cookies | GET | 404 sin ubicación ni detalle técnico | E01 | Parcial (CC, CV) |
| C1, C3, C4 | `bloqueado` (DIRECTOR, JWT previo) | cookies | GET | 403 con código `ACCESO_BLOQUEADO` | P01, E01, V01 | Nuevo |
| C1, C3, C4 | anónimo | cookies | GET | 401 | E01 | Sí (CC) |
| C1 | cualquier actor con sesión válida | Bearer sin cookies | GET | 401: el endpoint solo autentica por cookies (límite documentado, no se cambió el producto) | E02 | Nuevo |
| C1 | Bearer de Dirección más cookie del cargador | cookies y Bearer | GET | decide la cookie; el Bearer no suma privilegios | E02 | Nuevo |
| URL emitida | padre cargador | cookies | seguir la redirección | vence en unos 60 s: tope del producto, no de Storage | E03 | Nuevo |

### Cargas temporales (bucket `comprobantes-pago-temporal`)

| Recurso | Actor | Canal | Operación | Resultado esperado | Caso | Antes |
|---|---|---|---|---|---|---|
| carga A, B de P2 | `copadre` (dueño de la carga) | Storage | subir sin upsert, firmar subida | aceptado; el objeto existe | T00, T09 | Parcial (CC, con otro padre) |
| carga A | `padre` (mismo hijo), `alumno`, `ajeno`, `otraFamilia`, `docente`, `personal`, `director`, `segundo`, `bloqueado`, anónimo | Storage | subir, firmar subida | rechazado; la ranura queda libre y luego la ocupa su dueño | T01, T08, T09 | Parcial (CC, 5 actores y sin firma de subida) |
| objeto B | todos, incluido el dueño | Storage | reemplazo (upsert y PUT) | rechazado; SHA intacto | T02, T08 | Parcial (CC, solo el dueño) |
| objeto B | todos, incluidos el dueño y Dirección | Storage | lectura autenticada, lectura pública | denegado | T03 | Parcial (CC) |
| objeto B | todos | Storage | listado del pago y de la raíz | vacío | T04 | Parcial (CC, solo Dirección) |
| objeto B | todos | Storage | firma de lectura, individual y por lote | sin URL | T05 | Parcial (CC, solo el dueño) |
| objeto B | todos | Storage | borrar | el objeto sigue existiendo | T06 | Parcial (CC, solo el dueño) |
| objeto B | todos | Storage | mover; copiar al bucket final | rechazado; nada llega al bucket final | T07 | Parcial (CC, solo el dueño) |
| carga C | `copadre` con vínculo revocado | Storage | subir | rechazado; al revincular, la misma ranura se acepta | V02 | Parcial (CC, bloqueo) |

### Recibos institucionales

| Recurso | Actor | Canal | Operación | Resultado esperado | Caso | Antes |
|---|---|---|---|---|---|---|
| `/api/recibos/[id]/pdf` R1 | `padre`, `copadre`, `alumno`, `director`, `segundo` | cookies y Bearer | GET | 200, `application/pdf`, comienza con `%PDF-` | C01, C02 | Parcial (RH, Bearer y cookies solo para 4 actores) |
| R3 | `otraFamilia`, `ajeno`, `director`, `segundo` | cookies y Bearer | GET | ídem | C01, C02 | Nuevo |
| R1 y R3 | `otraFamilia`, `ajeno`, `docente`, `personal` y cruce de familias | cookies y Bearer | GET | 403 | C01, C02 | Parcial (RH, solo Bearer) |
| R1 y R3 | `bloqueado` (DIRECTOR, JWT previo) | cookies y Bearer | GET | 403; antes del bloqueo recibía el PDF | P01, C01, C02, V01 | Parcial (RH, solo Bearer) |
| R1 y R3 | anónimo | cookies y Bearer | GET | 401 | C01, C02 | Parcial (RH) |
| R3 | Bearer del padre con cookie de Dirección | cookies y Bearer | GET | 403: manda el Bearer, no se suman privilegios | C03 | Nuevo |
| R1 | cookie de Dirección con Bearer inválido | cookies y Bearer | GET | 401 | C03 | Nuevo |
| R1 | `copadre`, `padre` con vínculo revocado; `segundo` con rol perdido; `bloqueado` | cookies y Bearer | GET | 403; al revincular o restaurar el rol, 200 | V01, V02, V03, V04 | Parcial (RH, solo Bearer) |
| `recibos.archivo_path` | todos, incluida Dirección | PostgREST | columna, `select=*`, filtro, orden y embed | 42501 (sin oráculo de existencia) | R04 | Parcial (ES, padre y Dirección, solo columna) |
| bucket de recibos | todos, incluida Dirección | Storage | firmar, listar o leer en `recibos`, el bucket final y el temporal | imposible: no existe el bucket y ninguna ruta de recibo es un comprobante registrado | B01 | Nuevo |
| bucket de recibos | `director`, `padre`, anónimo | Storage | crear bucket «recibos» y subir un PDF | rechazado; el bucket no existe después | B02 | Nuevo |
| fuente del recibo | `padre` | RPC `consultar_recibo` | consulta | JSON sin `archivo_path`, rutas ni URL de Storage | B03 | Nuevo |

### Revocaciones con el JWT todavía vigente

| Caso | Qué se revoca | Qué se verifica | Resultado esperado |
|---|---|---|---|
| V00 | bloqueo de la cuenta DIRECTOR | GoTrue sigue aceptando el JWT | la denegación la decide la base, no Auth |
| V01 | bloqueo | PostgREST, RPC, Storage y ambos endpoints | todo denegado; antes del bloqueo todo estaba permitido (P01) |
| V02 | vínculo del `copadre` | economía, registro, original, recibo y subida temporal | 0 o denegado; al revincular, vuelve |
| V03 | vínculo del `padre` cargador | su propio original, economía, registro y recibo | 0 o denegado; al revincular, vuelve |
| V04 | rol DIRECTOR a PERSONAL | economía, originales, recibos y `verificar_pago` | 0 o denegado; al restaurar el rol, vuelve |

### Límites documentados (no son garantías)

| Caso | Observación verificada |
|---|---|
| L01 | La URL firmada por el DIRECTOR antes de su bloqueo sigue sirviendo los bytes después del bloqueo; la cuenta bloqueada ya no obtiene firmas nuevas. |
| L02 | Tras desvincular al `copadre`, siguen sirviendo la URL de 60 s, la emitida por el endpoint y una URL firmada a un año. Storage no revoca URL ya emitidas ni acota el TTL; el tope de 60 s del endpoint es del producto. |
| E02 | El original no se entrega con Bearer (solo cookies). |

## Resultado de la ejecución

- 44 casos, 955 comprobaciones, 0 fallos. Duración: entre 49 y 53 s contra un stack local aislado (`ept119`, Next en modo desarrollo).
- Registrada en `scripts/ci/suites.mjs` (`dbScripts`); `node --test scripts/ci/impact.test.mjs` pasa (39 pruebas) y el selector clasifica la ruta como `db`.
- Mutaciones: se aplicaron al stack aislado (no al repositorio) y se revirtieron; las definiciones de políticas, función y privilegios quedaron idénticas (MD5 antes y después). La suite pasó de 0 a 15 casos en fallo, y las cuatro fueron detectadas:

| Mutación | Casos que fallaron |
|---|---|
| la política de lectura de `comprobantes_pago` pasa a «quien ve el pago» (el original lo ven copadre y estudiante) | R01, R02, O01, O02, O03, E01, V02, V03 |
| la política de INSERT del bucket temporal deja de exigir una carga propia | T01, T08, T09 |
| `GRANT SELECT (archivo_path) ON recibos TO authenticated` | R04 |
| el auxiliar económico ignora `estado_acceso` y se aflojan las políticas de bloqueo de la economía | S01, S02, V01 |

## Cómo ejecutarla

```bash
EPT_SUPABASE_WORKDIR=<dir del stack aislado> \
EPT_SUPABASE_DB_CONTAINER=supabase_db_<project_id> \
EPT_PUERTO_NEXT=3120 \
  node supabase/tests/acceso_economico_matriz.mjs
```

Solo corre contra una API de bucle local. Siembra DNI `97119xxx` y correos `ept119.*@ept.local`, y los retira al terminar.
