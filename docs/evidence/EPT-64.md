# EPT-64 — RF20: Credencial digital QR por alumno

**Estado: candidato local listo para revisión.** No hay push, PR, merge, despliegue ni cambio alguno en producción. La tarea sigue «En curso» en Jira: faltan revisión, integración y verificación en producción.

| Dato | Valor |
|---|---|
| Rama | `codex/ept-64-credencial-qr` |
| Base | `origin/main` `1e00169` (contiene los merges de EPT-63: PR #22, #23, #24 y #25) |
| Código probado | `777626a` (el resultado de cada prueba de la sección 9 corresponde a ese SHA) |
| Jira | EPT-64 (tarea hija de EPT-7). EPT-65 no se toca |
| Migración | `supabase/migrations/20260929224534_ept_64_credencial_qr.sql` (aditiva; la última anterior era `20260929012923`) |
| Stack de prueba | Supabase local aislado (`project_id = ept64`, puertos 573xx). No se tocó la base compartida ni producción |

## 1. Resumen ejecutivo

Cada alumno puede tener, como máximo, **una credencial ACTIVA**. Cada emisión es una fila histórica propia; reponer revoca la vigente y emite otra en una sola transacción; una revocada nunca vuelve a valer ni se borra. El QR es estático: contiene solo `EPT1.<kid>.<id>.<firma>` (versión, identificador de clave, identificador aleatorio y HMAC-SHA256 de servidor), sin ningún dato personal. La clave de firma vive **solo** en la configuración del servidor y el servidor falla cerrado si falta.

La validez efectiva (credencial ACTIVA + alumno ACTIVO + perfil habilitado) se calcula al consultar, sin ningún trigger sobre alumnos. Verificar un QR exige firma válida **antes** de cualquier consulta de estado; la base no expone una función que evalúe identificadores sin esa barrera.

Fuera de alcance, como se aprobó: escanear, registrar accesos, elegibilidad de comedor o transporte (EPT-65).

## 2. Fuentes y contradicciones

| Fuente | Resultado |
|---|---|
| Jira EPT-64 y EPT-65 (consulta en vivo) | Tareas hijas de EPT-7, «Por hacer», sin subtareas, comentarios ni vínculos. Coincide con la auditoría. EPT-64 pasó a «En curso» con el contrato aprobado como anexo; EPT-65 sin cambios |
| `PlanTrabajo_Grupo12_SistemaGestion (1).pdf` | RF20 «Emitir credenciales» (p. 2), tratamiento «Integración»; ventana 12/10 al 16/10. La Definición de Hecho exige validaciones en servidor y base, migraciones versionadas, prueba por rol, escritorio y móvil |
| Otro PDF (aplicación de cobros) | Descartado: su RF20 trata pagos deportivos |
| Auditoría del 2026-09-29 (sobre `7870f10`) | Contexto. `7870f10` es ancestro de la base actual; no se usó como base |
| Código y esquema reales | Rol de Dirección es `DIRECTOR` (no existe `DIRECCION`); `padres_hijos` no tiene columnas de vigencia (vínculo vigente = existencia de la fila); `P5620` a `P5629` estaban libres (el mayor de la familia era `P5612`) |

No apareció ninguna contradicción material con el contrato aprobado.

## 3. Contrato aplicado

Todo lo aprobado por Lucas está implementado. Las decisiones que el contrato no cerraba están en la sección 4 y son las únicas a confirmar en la revisión.

## 4. Decisiones técnicas

1. **Una tabla append-only** `credenciales_qr` (id aleatorio, alumno, estado, `clave_kid`, emisión y actor, reemplazo, revocación y actor, motivo). FK `ON DELETE RESTRICT`, CHECK de coherencia de estado, índice único parcial `WHERE estado = 'ACTIVA'`. Un trigger impide DELETE, TRUNCATE y cualquier UPDATE que no sea ACTIVA → REVOCADA con el resto de las columnas idénticas, **incluso para el propietario**.
2. **No se guarda** payload, firma ni clave. Con lo que hay en la base es imposible reconstruir un QR válido: falta la clave. Una autoverificación de la migración lo comprueba por nombre de columna.
3. **Operaciones privilegiadas** en `app_private` (SECURITY DEFINER, `search_path` vacío) con envoltorios `public` SECURITY INVOKER. Sin EXECUTE para `anon` ni `service_role`. Ninguna recibe actor ni rol: salen de la sesión.
4. **Concurrencia**: orden de bloqueos del dominio de alumnos (primero `alumnos FOR NO KEY UPDATE`, después la credencial). Reponer y revocar viajan con el identificador de la credencial que Dirección **ve**; si ya cambió responde `P5623` (409) en lugar de reemplazar por error a la nueva.
5. **Privilegios por columna**: los datos internos (`emitida_por`, `revocada_por`, `motivo_revocacion`, `reemplaza_a`) no tienen SELECT para ningún rol de aplicación. Las lecturas nombran sus columnas (`select *` falla a propósito). Dirección lee el historial completo solo por `historial_credenciales_qr`.
6. **Una sola política permisiva de lectura por actor** (Dirección habilitada, alumno propio, padre de hijos vinculados) más la política RESTRICTIVE de bloqueo de cuenta, replicada a mano porque la 059 no cubre tablas nuevas. La versión inicial tenía tres políticas y el asesor de rendimiento avisaba; se unificó como en la 016.
7. **Criptografía**: `node:crypto` (HMAC-SHA256 y `timingSafeEqual`), sin primitivas propias. Decodificación base64url canónica estricta (se rechaza relleno, alfabeto y bits sobrantes). Con `kid` desconocido igualmente se calcula un HMAC, para no distinguirlo por tiempo. Verificador puro, sin acceso a la base.
8. **Librería QR**: `@paulmillr/qr` 0.3.0 (MIT o Apache-2.0, sin dependencias, con tipos, mantenida; `npm audit` no la señala). Se usa solo la matriz `raw`; el SVG lo arma el propio módulo (fondo blanco, zona silenciosa de 4 módulos, un solo `<path>`, sin texto). `qrcode-generator`, sugerida por la auditoría, no se adoptó: la elegida es más pequeña, tipada y sin dependencias. Generar la imagen no valida nada.
9. **El QR se reconstruye en el servidor** al mostrarse, con el `kid` de cada credencial; el cliente recibe una URI de datos SVG sin el payload como texto.
10. **Emitir, reponer y revocar no dependen del estado del alumno.** El contrato no prohíbe emitir a un alumno inactivo y sí prevé que una ACTIVA sobreviva a una inactivación; la validez efectiva es lo que cambia. *A confirmar en la revisión.*
11. **Motivo obligatorio de 3 a 200 caracteres** al reponer y revocar (queda en el historial interno).
12. **Verificación solo para Dirección.** `consultar_validez_credencial_qr` y la ruta `POST /api/credenciales-qr/verificacion` son la interfaz mínima para EPT-65: PERSONAL y el resto quedan denegados. EPT-65 deberá abrirla a PERSONAL con su propia migración y sus propias pruebas.
13. **Sin `service_role` en ninguna API.** Todas las lecturas y escrituras usan la sesión verificada del usuario.

## 5. Formato del payload (sin ejemplos válidos)

```
EPT1.<kid>.<id>.<firma>
```

| Campo | Contenido |
|---|---|
| `EPT1` | versión del formato; otra versión se rechaza |
| `kid` | 1 a 16 caracteres `a-z0-9`: qué clave firmó |
| `id` | UUID aleatorio de 16 bytes en base64url, 22 caracteres |
| `firma` | HMAC-SHA256 de 32 bytes en base64url, 43 caracteres |

Mensaje firmado: `"EPT-QR-V1" 0x00 kid 0x00 id(16 bytes)`. Los campos van separados por un byte 0x00 que no pueden contener; el identificador tiene largo fijo, así que no hay ambigüedad. El estado de la credencial **no** forma parte de la firma: se consulta al verificar. Por eso el QR es estático y no caduca solo. Longitud total: 74 caracteres.

## 6. Gestión de la clave

Variables de servidor (nunca `NEXT_PUBLIC_`):

| Variable | Contenido |
|---|---|
| `QR_CREDENCIAL_KID_ACTIVA` | `kid` con el que se firman las credenciales nuevas |
| `QR_CREDENCIAL_CLAVES` | lista `kid:clave` separada por comas; clave en base64url de al menos 32 bytes aleatorios |

Falla cerrado ante: variable ausente, clave corta o de relleno, mal codificada, `kid` repetido o mal formado, o activa fuera de la lista. Ningún mensaje de error contiene material de clave (probado).

**Generar** sin mostrarla en pantalla ni en el historial de la terminal: generarla y enviarla directo al gestor de variables.

```bash
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))" | vercel env add QR_CREDENCIAL_CLAVES production
```

Guardar además una copia en el gestor de contraseñas del equipo.

**Rotar**: (1) agregar la clave nueva a `QR_CREDENCIAL_CLAVES` conservando las viejas; (2) cambiar `QR_CREDENCIAL_KID_ACTIVA`; (3) desplegar. Las credenciales existentes siguen valiendo con su clave vieja y las nuevas usan la activa. (4) Retirar una clave vieja solo cuando no quede ninguna credencial ACTIVA con ese `kid`:

```sql
SELECT clave_kid, count(*) FROM public.credenciales_qr WHERE estado = 'ACTIVA' GROUP BY 1;
```

**Pérdida de la clave**: todas las credenciales firmadas con ella dejan de poder mostrarse y verificarse (fallan cerrado). Plan: recuperar la copia del gestor; si no existe, generar una clave nueva con `kid` nuevo, desplegar, y **reponer** cada credencial ACTIVA afectada (la reposición conserva el historial y emite con la clave nueva); reimprimir las tarjetas. Ver el listado de afectadas con la consulta anterior.

**Sospecha de filtración**: rotar de inmediato (pasos 1 a 3) y reponer todas las ACTIVAS del `kid` comprometido; luego retirar esa clave.

## 7. Matriz de actores

`✔` permitido, `✖` denegado (código en la prueba). Cada celda se probó en las tres capas: pantalla, API y PostgREST.

| Actor | Ver la propia o de hijos | Emitir, reponer, revocar | Historial interno | Verificar |
|---|---|---|---|---|
| Dirección habilitada | ✔ todas | ✔ | ✔ | ✔ |
| Alumno propio | ✔ solo la suya | ✖ 403 | ✖ 403 | ✖ 403 |
| Alumno ajeno | ✖ 404 (igual que inexistente) | ✖ | ✖ | ✖ |
| Alumno inactivo | ✔ pero sin QR: «Estás inactivo» | ✖ | ✖ | ✖ |
| Padre con hijo vinculado | ✔ solo la del hijo | ✖ 403 | ✖ 403 | ✖ 403 |
| Padre no vinculado o desvinculado | ✖ 404, pierde acceso en el acto | ✖ | ✖ | ✖ |
| Docente | ✖ 403 | ✖ | ✖ | ✖ |
| PERSONAL | ✖ 403 | ✖ | ✖ | ✖ 403 (sin permisos de escáner) |
| Cuenta sin perfil | ✖ 403 | ✖ | ✖ | ✖ |
| Rol bloqueado (los 5) | ✖ 403 `ACCESO_BLOQUEADO` | ✖ | ✖ | ✖ |
| Anónimo | ✖ 401 | ✖ 401 | ✖ 401 | ✖ 401 |

## 8. Matriz criterio, capa, prueba y resultado

| Criterio aprobado | Capa | Prueba | Resultado |
|---|---|---|---|
| Como máximo una ACTIVA por alumno | Base | Índice único parcial; `credenciales_qr_rls.sql` D16; concurrencia 1 y 5 | Pasó |
| Cada emisión es una fila; reponer es atómico | Base y API | `credenciales_qr_rls.sql` E16; concurrencia 2; API «ciclo completo» | Pasó |
| Una revocada no vuelve a valer ni se borra | Base | `credenciales_qr_rls.sql` D9, D10, E23, F20 a F24 | Pasó |
| Solo Dirección emite, repone, revoca | Base, API, pantalla | `credenciales_qr_rls.sql` B1 a B8, E1 a E5; specs por actor | Pasó |
| Alumno ve la propia; padre las de hijos vinculados | Base, API, pantalla | `credenciales_qr_rls.sql` C2 a C16; spec de alumno y de padre | Pasó |
| Docente, PERSONAL, anónimo, bloqueado, sin perfil, no vinculado denegados | Base, API, pantalla | `credenciales_qr_rls.sql` C7 a C14; `credenciales-qr-auth.spec.ts` | Pasó |
| QR no es URL, sin datos personales | Cripto y API | `credenciales-qr-cripto.spec.ts`; specs de alumno y Dirección | Pasó |
| Clave solo en servidor; falla cerrado | Cripto, API | `credenciales-qr-cripto.spec.ts`; servidor sin clave (503); revisión del bundle | Pasó |
| Firma antes de consultar estado; sin oráculo | Cripto, API | «la firma se comprueba ANTES de consultar la base» (0 consultas ante lo inválido) | Pasó |
| Validez = ACTIVA + alumno ACTIVO + perfil habilitado | Base, API | `credenciales_qr_rls.sql` F1 a F27; spec de Dirección | Pasó |
| Reactivar restaura solo la misma ACTIVA | Base, API | `credenciales_qr_rls.sql` F16, F23; spec «el estado del alumno decide» | Pasó |
| Curso, DNI o legajo no cambian el payload | Base, API | `credenciales_qr_rls.sql` H1 a H5; spec «cambiar curso, DNI o legajo» | Pasó |
| Tarjeta con nombre, apellido, legajo; sin DNI ni foto | Pantalla | `credenciales-qr-ui.spec.ts`; specs de alumno y padre | Pasó |
| Descarga e impresión | Pantalla | descarga PNG 1011×638 verificada por bytes; impresión con `emulateMedia('print')` | Pasó |
| Español, accesible, responsive | Pantalla | contraste WCAG AA, foco, objetivos táctiles de 44 px, sin desborde en escritorio, Pixel 5 e iPhone 13 | Pasó |
| Ausencia de credencial no emite | Pantalla, API | specs «sin credencial NO se emite sola» (UI y sesión real) | Pasó |
| EPT-64 no escanea ni registra accesos | Diseño | sin tablas de eventos ni rutas de escaneo; verificación solo Dirección | Cumplido |
| Nada rompe alumnos, bloqueo, vínculo, matrícula parental, comedor, transporte, deportes | Todas | sección 9.4 | Pasó |

## 9. Resultados de verificación

Todo se ejecutó sobre el SHA `777626a` contra el stack local aislado. Salvo lo indicado, cada comando terminó con **exit 0**.

### 9.1 Base de datos

| Comando | Exit | Resultado |
|---|---|---|
| `supabase db reset` | 0 | 25 migraciones aplicadas desde cero, la última la de EPT-64 |
| `supabase migration list --local` | 0 | local y remoto (stack) coinciden en las 25 |
| `supabase db lint --local --level warning` | 0 | «No schema errors found» |
| `supabase db advisors --local --type all` | 0 | 10 avisos, **ninguno sobre `credenciales_qr`**. Los 10 son preexistentes (tablas de otras historias) |
| `node supabase/tests/tipos-generados.mjs` | 0 | regeneración reproducible byte a byte (dos generaciones idénticas; normalizada, sin línea final en blanco) |

### 9.2 SQL, RLS y concurrencia

| Prueba | Exit | Resultado |
|---|---|---|
| `credenciales_qr_rls.sql` | 0 | 137 comprobaciones OK: estructura, emisión, lectura por actor y por fila, escritura directa (incluido el propietario), reposición, revocación, validez, historial, curso/DNI/legajo y reversión |
| `credenciales_qr_concurrencia.mjs` | 0 | conexiones `psql` independientes con `pg_blocking_pids`: doble emisión, doble reposición, reposición contra revocación (dos órdenes), emisión y reposición contra inactivar y reactivar (sin deadlock), y ráfagas de 6 emisiones y 6 reposiciones simultáneas. Siempre exactamente una ACTIVA |
| `usuarios_permisos_rls.sql` (EPT-59) | 0 | la batería exige cubrir toda RPC pública: se agregaron las cinco nuevas; 78 envoltorios públicos cubiertos; bloqueado y reactivado sin diferencias |

### 9.3 Criptografía y pantalla

| Prueba | Resultado |
|---|---|
| `credenciales-qr-cripto.spec.ts` (24 pruebas) | Pasó. Incluye: firma válida; 128 de 128 bits alterados en el identificador y 256 de 256 en la firma; `kid` alterado o desconocido; formato malformado (decenas de casos); codificaciones no canónicas; versión desconocida; clave equivocada; clave faltante o inválida; rotación; **0 consultas a la base ante cualquier payload inválido**; respuesta idéntica para lo inválido y para un identificador firmado pero inexistente; el SVG se decodifica de vuelta al mismo texto |
| `credenciales-qr-ui.spec.ts` | Pasó en escritorio, Pixel 5 y iPhone 13 (23 pruebas por perfil): estados, descarga, impresión, diálogos, teclado, foco, contraste AA, sin desborde |
| `credenciales-qr-auth.spec.ts` | Pasó (43 pruebas, incluida la del servidor sin clave): sesiones reales de Dirección, alumno propio, ajeno e inactivo, padre vinculado y desvinculado, padre sin hijos, docente, PERSONAL, sin perfil, anónimo y los cinco roles bloqueados; API, pantalla y PostgREST directo; concurrencia por HTTP |

### 9.4 Regresiones y suite completa

| Comando | Exit | Resultado |
|---|---|---|
| 18 pruebas SQL (`*_rls.sql` y `usuarios_alta_atomica.sql`) | 0 | alumnos, bloqueo de usuarios, vínculo familiar, matrícula parental, comedor, transporte, deportes, horarios, materias, niveles, cursos, profesores, inscripciones y reportes |
| 12 pruebas de concurrencia | 0 | las mismas historias más usuarios y permisos |
| `node supabase/tests/correr-autenticadas.mjs` (suite E2E completa) | 0 | **1401 pruebas pasaron, 0 fallaron, 0 inestables** (27,8 min) |
| `npx tsc --noEmit` | 0 | sin errores |
| `npm run build` | 0 | compila y genera las rutas nuevas; el bundle del cliente no contiene `QR_CREDENCIAL`, `EPT-QR-V1` ni `createHmac` |
| `git diff --check origin/main..HEAD` | 0 | limpio |
| `npx eslint .` | **1** | 121 hallazgos (14 errores, 107 avisos), **todos en archivos que esta historia no modifica** (páginas públicas, asistencias, solicitudes, testimonios, `global-error`, login). Cero hallazgos en los archivos de EPT-64. ESLint focalizado sobre los archivos nuevos: 0 |

**Defectos hallados por la propia verificación y corregidos** (por eso el SHA probado es `777626a` y no uno anterior):

1. La regla `@media print` inicial ocultaba toda la página y **rompía la impresión de los reportes de EPT-63**; la suite completa lo detectó. Se acotó con `:has(.imprimible)` y ambas impresiones quedaron probadas.
2. `tests/auth.setup.ts` vacía `alumnos` en cada corrida; con la FK restrictiva de la nueva tabla habría fallado a partir de la segunda. Ahora vacía `credenciales_qr` antes, con la guarda deshabilitada solo dentro de esa transacción local.
3. La batería de EPT-59 falló por RPC públicas sin cubrir; se agregaron.
4. El cierre del diálogo dependía de un efecto de un componente compartido y en WebKit podía perder un `Escape`; se consulta un espejo síncrono. Safari además no da foco a un botón al hacer clic, así que el foco se devuelve al disparador guardado.
5. Tres políticas permisivas de lectura se unificaron en una (aviso del asesor de rendimiento).

La suite completa regenera las capturas de EPT-13; se restauraron con `git checkout -- docs/evidence/EPT-13`.

## 10. Evidencia visual

Carpeta `docs/evidence/EPT-64/`. **Ninguna captura contiene un QR válido.** Las de banco visual (`fixture-*`) usan un texto ficticio con firma de ceros y un `kid` que ninguna configuración conoce: es imposible de validar en cualquier entorno. Las de sesión real (`chromium-*`) solo muestran estados sin QR: sin credencial, revocada, inactivo y bloqueado.

Se generan con `EPT_CAPTURAS=1` únicamente; sin esa variable la suite no reescribe nada.

- Vigente: `fixture-chromium-vigente.png`, `fixture-pixel-5-chromium-vigente.png`, `fixture-iphone-13-webkit-vigente.png`.
- Impresión: `fixture-chromium-impresion.png` (solo se imprime la tarjeta).
- Estados: `sin-credencial-propia`, `sin-credencial-hijo`, `revocada-propia`, `inactivo-propia`, `inactivo-hijo`, `bloqueado-direccion`, `carga`, `error`.
- Dirección: `panel`, `panel-vacio`, `historial`, `direccion-dialogo-reponer`, `direccion-conflicto`, `direccion-emitida`, `foco-visible`.
- Sesiones reales: `chromium-directora-director-sin-credencial`, `chromium-directora-director-revocada`, `chromium-directora-director-panel-movil`, `chromium-estudiante-ajeno-estudiante-sin-credencial`, `chromium-estudiante-inactivo-estudiante-inactivo`, `chromium-padre-segundo-padre-sin-hijos` y una por cada rol bloqueado.

## 11. Amenazas y riesgo residual

| Amenaza | Mitigación | Riesgo residual |
|---|---|---|
| **Fotografiar o copiar un QR estático y reutilizarlo** | Ninguna técnica: el QR es estático por contrato. Se puede revocar y reponer en el acto; quien verifica ve el estado actual | **Aceptado por diseño.** Una foto vale hasta que Dirección la revoque. Si el escaneo lo hace una persona, conviene contrastar con el nombre de la tarjeta. EPT-65 podrá sumar controles (por ejemplo, alertas de uso repetido) |
| Falsificar un QR | Necesita la clave; HMAC-SHA256 y `id` aleatorio de 128 bits | Nulo sin filtración de la clave |
| Filtración de la clave | Solo en variables de servidor; nunca en base, bundle, repositorio, logs ni evidencia. Rotación por `kid` | Depende de la custodia en Vercel y del gestor de contraseñas |
| Oráculo de existencia | Toda entrada inválida o de identificador desconocido recibe la misma respuesta; HMAC también con `kid` desconocido | Diferencias de red o de tiempo remanentes: despreciables para un endpoint solo de Dirección |
| Acceso indebido a filas | RLS por actor y por fila, columnas internas sin SELECT, sin `service_role` | Cubierto en base, API y pantalla |
| Alteración del historial | Trigger que también rige para el propietario; sin DELETE ni TRUNCATE | Quien administre la base puede desactivar el trigger (como en cualquier tabla append-only del proyecto) |
| CSRF en las rutas POST | Cookies de sesión `SameSite=Lax`, igual que el resto de la aplicación | Sin token propio |
| Fuerza bruta contra la verificación | Solo Dirección autenticada puede llamarla | **No hay límite de tasa.** Deuda para EPT-65, que abre la verificación a más roles |
| Registros | Solo se registra el código SQLSTATE; nunca payloads, claves ni datos personales | — |

## 12. Reversión

Antes de que existan credenciales reales, la migración se revierte soltando lo que creó (probado en `credenciales_qr_rls.sql`, sección R): las diez funciones (`public` y `app_private`), la tabla `public.credenciales_qr`, las tres funciones de trigger y de validación, y el tipo `estado_credencial_qr`. No toca ninguna tabla, función ni política preexistente. **Con credenciales emitidas en producción, `DROP TABLE` destruye el historial:** en ese caso no se revierte por SQL; se hace un respaldo previo (sección 13), se retira la clave del servidor (todo falla cerrado) y se decide con Dirección. Volver atrás en la aplicación es desplegar el commit anterior: las pantallas y rutas desaparecen sin efecto sobre el resto.

## 13. Procedimiento futuro de despliegue (NO ejecutado en esta sesión)

1. **Verificar el proyecto correcto**: el de producción del colegio (`ycvrpmrogvjnntnoosbh`, según `docs/evidence/EPT-63.md`). Confirmar el ref antes de cualquier comando; no usar el proyecto compartido ni otro.
2. **Respaldo y preflight** de la base de producción; comparar `supabase migration list` contra el repositorio y confirmar que la última aplicada es `20260929012923`.
3. **Configurar la clave en Vercel antes del código**: crear `QR_CREDENCIAL_KID_ACTIVA` y `QR_CREDENCIAL_CLAVES` en el entorno de producción (sección 6). El código nuevo falla cerrado sin ellas, así que el orden importa.
4. **Aplicar la migración una sola vez** (`supabase db push` contra el proyecto verificado). No reaplicar.
5. **Desplegar** la rama integrada.
6. **Postflight**: (a) `supabase migration list`; (b) autoverificación de la migración sin errores; (c) con una cuenta de Dirección real, emitir la credencial de un alumno de prueba, verla, descargarla, reponerla y revocarla; (d) comprobar 403 con una cuenta de alumno y de docente; (e) comprobar que sin sesión la API responde 401; (f) confirmar que la verificación devuelve «válida» y luego «revocada».
7. **Plan ante pérdida de clave**: sección 6.
8. Recién entonces, cierre de EPT-64 tras revisión e integración.

## 14. Riesgos y deuda

- Decisión 10 (emitir a inactivos) y decisión 11 (motivo obligatorio): a confirmar en la revisión.
- Falta límite de tasa en la verificación (EPT-65).
- La descarga dibuja la tarjeta en un canvas con la tipografía del sistema; no incluye foto porque el contrato no la prevé.
- `tests/auth.setup.ts` y `usuarios_permisos_rls.sql` se tocaron (limpieza y batería): cualquier historia futura con una tabla que referencie alumnos deberá hacer lo mismo.
- Dos avisos del asesor de la base tienen origen en migraciones anteriores y no se tocaron.

## 15. Retrospectiva

- **Lo que funcionó**: separar el verificador puro del acceso a la base permitió probar «la firma va antes» con un espía y probar 384 alteraciones de bits sin una base. Decodificar la imagen que entrega la propia aplicación probó la legibilidad del QR sin conocer la clave.
- **Lo que costó**: los cambios que una tabla nueva impone a suites ajenas (siembra, batería de permisos, impresión de reportes) solo aparecieron al correr la suite completa. Conviene correrla temprano en la próxima historia.
- **Trampas de herramientas**: los archivos del árbol de trabajo son CRLF, así que reemplazos con `\n` no encuentran el ancla; `MSYS_NO_PATHCONV=1` rompe rutas para el CLI de Supabase; WebKit necesita esperar la hidratación de React antes de operar.

## 16. Comandos reproducibles

```bash
# Stack aislado (directorio con su propio supabase/config.toml, otro project_id y puertos)
npx supabase start --workdir E:/Escritorio/codigo/_sb-ept64
npx supabase db reset --workdir E:/Escritorio/codigo/_sb-ept64

# SQL y concurrencia (cada una imprime OK o FALLO)
docker cp supabase/tests/credenciales_qr_rls.sql supabase_db_ept64:/tmp/
docker exec supabase_db_ept64 psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/credenciales_qr_rls.sql
EPT_SUPABASE_DB_CONTAINER=supabase_db_ept64 node supabase/tests/credenciales_qr_concurrencia.mjs

# Tipos (verifica; con --escribir regenera)
EPT_SUPABASE_WORKDIR=E:/Escritorio/codigo/_sb-ept64 node supabase/tests/tipos-generados.mjs

# Criptografía y pantalla (sin base)
npx playwright test tests/credenciales-qr-cripto.spec.ts tests/credenciales-qr-ui.spec.ts

# E2E con sesiones reales (el runner genera una clave QR efímera por corrida)
EPT_SUPABASE_WORKDIR=E:/Escritorio/codigo/_sb-ept64 EPT_SUPABASE_DB_CONTAINER=supabase_db_ept64 \
EPT_TEST_SMTP_PORT=57325 node supabase/tests/correr-autenticadas.mjs

# Servidor sin clave (falla cerrado): construir con las variables públicas locales, iniciar
# `next start -p 3100` SIN las variables QR_CREDENCIAL_* y agregar EPT_URL_SIN_CLAVE=http://localhost:3100
```
