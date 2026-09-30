# EPT-64 — RF20: Credencial digital QR por alumno

**Estado al 30/09/2026: integrada y desplegada, con verificación productiva parcial.** La migración y las variables de servidor están presentes en producción. Lucas autorizó un único alumno de prueba activo: Dirección emitió, repuso y revocó sus credenciales desde la aplicación; quedaron dos filas REVOCADAS y ninguna ACTIVA. EPT-64 sigue «En curso» porque faltan la verificación autenticada, las denegaciones por otros roles, la comprobación concluyente de descarga e impresión y la integración de esta evidencia. EPT-65 no se tocó. La sección 9 conserva las pruebas previas al merge; la sección 13 registra el postflight.

| Dato | Valor |
|---|---|
| Integración | PR #26 integrado en `main`: `cbb6f1be9ca5d8e8c640e5d78dc30ecf56661757` |
| Base y código de las pruebas originales | `origin/main` `1e00169` fue la base de implementación. La sección 9 corresponde a `cd54c21`; los commits posteriores hasta el merge solo modificaron documentación. La implementación original se probó sobre `777626a`; ese resultado **no** se reutiliza para el código corregido |
| Jira | EPT-64 (tarea hija de EPT-7). EPT-65 no se toca |
| Migración | `supabase/migrations/20260929224534_ept_64_credencial_qr.sql` (aditiva; la última anterior era `20260929012923`) |
| Entornos | Las pruebas de la sección 9 usaron Supabase local aislado (`project_id = ept64`, puertos 573xx). El postflight de producción figura en la sección 13 |

## 1. Resumen ejecutivo

Cada alumno puede tener, como máximo, **una credencial ACTIVA**. Cada emisión es una fila histórica propia; reponer revoca la vigente y emite otra en una sola transacción; una revocada nunca vuelve a valer ni se borra. El QR es estático: contiene solo `EPT1.<kid>.<id>.<firma>` (versión, identificador de clave, identificador aleatorio y HMAC-SHA256 de servidor), sin ningún dato personal. La clave de firma vive **solo** en la configuración del servidor y el servidor falla cerrado si falta.

La validez efectiva (credencial ACTIVA + alumno ACTIVO + perfil habilitado) se calcula al consultar, sin ningún trigger sobre alumnos. Verificar un QR exige firma válida **antes** de cualquier consulta de estado; la base no expone una función que evalúe identificadores sin esa barrera.

Fuera de alcance, como se aprobó: escanear, registrar accesos, elegibilidad de comedor o transporte (EPT-65).

## 2. Fuentes y contradicciones

| Fuente | Resultado |
|---|---|
| Jira EPT-64 y EPT-65 | En la auditoría inicial ambas estaban «Por hacer», sin subtareas, comentarios ni vínculos. EPT-64 pasó a «En curso» con el contrato aprobado como anexo y permanece allí tras el postflight parcial; EPT-65 sigue «Por hacer» |
| `PlanTrabajo_Grupo12_SistemaGestion (1).pdf` | RF20 «Emitir credenciales» (p. 2), tratamiento «Integración»; ventana 12/10 al 16/10. La Definición de Hecho exige validaciones en servidor y base, migraciones versionadas, prueba por rol, escritorio y móvil |
| Otro PDF (aplicación de cobros) | Descartado: su RF20 trata pagos deportivos |
| Auditoría del 2026-09-29 (sobre `7870f10`) | Contexto. `7870f10` es ancestro de la base actual; no se usó como base |
| Código y esquema reales | Rol de Dirección es `DIRECTOR` (no existe `DIRECCION`); `padres_hijos` no tiene columnas de vigencia (vínculo vigente = existencia de la fila); `P5620` a `P5629` estaban libres (el mayor de la familia era `P5612`) |

Las fuentes son coherentes entre sí. La revisión independiente encontró que la implementación original se apartaba del contrato en un punto (emitir y reponer la credencial de un alumno inactivo la dejaba inútil); se corrigió y consta en la sección 9.5.

## 3. Contrato aplicado

Todo lo aprobado por Lucas está implementado. Las decisiones que el contrato no cerraba están en la sección 4; las dos que quedaban por confirmar (emitir a inactivos y el motivo) se resolvieron en la revisión: la primera se corrigió y la segunda la aprobó Lucas.

## 4. Decisiones técnicas

1. **Una tabla de historial inmutable** `credenciales_qr` (id aleatorio, alumno, estado, `clave_kid`, emisión y actor, reemplazo, revocación y actor, motivo). FK `ON DELETE RESTRICT`, CHECK de coherencia de estado, índice único parcial `WHERE estado = 'ACTIVA'`. **La garantía real**: ninguna fila se elimina (sin DELETE ni TRUNCATE) y cada fila admite **una sola modificación**, ACTIVA → REVOCADA, con el resto de las columnas idénticas; una revocada no se vuelve a tocar. La fila se actualiza al revocarla, así que la tabla **no es de «solo inserción»**. Un trigger lo hace cumplir **incluso para el propietario** mientras esté habilitado (quien administre la base puede deshabilitarlo, como en las demás tablas de historial del proyecto).
2. **No se guarda** payload, firma ni clave. Con lo que hay en la base es imposible reconstruir un QR válido: falta la clave. Una autoverificación de la migración lo comprueba por nombre de columna.
3. **Operaciones privilegiadas** en `app_private` (SECURITY DEFINER, `search_path` vacío) con envoltorios `public` SECURITY INVOKER. Sin EXECUTE para `anon` ni `service_role`. Ninguna recibe actor ni rol: salen de la sesión.
4. **Concurrencia**: orden de bloqueos del dominio de alumnos (primero `alumnos FOR NO KEY UPDATE`, después la credencial). Reponer y revocar viajan con el identificador de la credencial que Dirección **ve**; si ya cambió responde `P5623` (409) en lugar de reemplazar por error a la nueva.
5. **Privilegios por columna**: los datos internos (`emitida_por`, `revocada_por`, `motivo_revocacion`, `reemplaza_a`) no tienen SELECT para ningún rol de aplicación. Las lecturas nombran sus columnas (`select *` falla a propósito). Dirección lee el historial completo solo por `historial_credenciales_qr`.
6. **Una sola política permisiva de lectura por actor** (Dirección habilitada, alumno propio, padre de hijos vinculados) más la política RESTRICTIVE de bloqueo de cuenta, replicada a mano porque la 059 no cubre tablas nuevas. La versión inicial tenía tres políticas y el asesor de rendimiento avisaba; se unificó como en la 016.
7. **Criptografía**: `node:crypto` (HMAC-SHA256 y `timingSafeEqual`), sin primitivas propias. Decodificación base64url canónica estricta (se rechaza relleno, alfabeto y bits sobrantes). Con `kid` desconocido igualmente se calcula un HMAC, para no distinguirlo por tiempo. Verificador puro, sin acceso a la base.
8. **Librería QR**: `qr` 0.7.2 (MIT o Apache-2.0, sin dependencias, con tipos). La versión inicial usaba `@paulmillr/qr` 0.3.0, que su autor **deprecó** («cambiar a `qr` para recibir actualizaciones de seguridad»); en la revisión se reemplazó por su sucesor. Se comprobó que ambas producen **la misma matriz en 200 de 200 payloads** con el formato real, y el lockfile solo agrega `qr`. Se usa solo la matriz `raw`; el SVG lo arma el propio módulo (fondo blanco, zona silenciosa de 4 módulos, un solo `<path>`, sin texto, sin `<title>` ni atributos con el payload). `qrcode-generator`, sugerida por la auditoría, no se adoptó: la elegida es más pequeña, tipada y sin dependencias. Generar la imagen no valida nada.
9. **El QR se reconstruye en el servidor** al mostrarse, con el `kid` de cada credencial; el cliente recibe una URI de datos SVG sin el payload como texto.
10. **Emitir y reponer exigen alumno ACTIVO; revocar no.** La versión inicial permitía emitir y reponer a un alumno inactivo. La revisión lo corrigió: la validez exige alumno ACTIVO y la tarjeta muestra el legajo, así que esa credencial nacía inútil. Con el alumno inactivo, emitir y reponer responden `P5627` (409 `ALUMNO_INACTIVO`); en la reposición el rechazo ocurre **antes** de revocar, de modo que la vigente se conserva. Revocar sigue permitido por seguridad. Una credencial ACTIVA que ya existía sobrevive a una inactivación (la validez se calcula al consultar) y vuelve a valer al reactivar. No hace falta una regla de legajo aparte: desde 008 un alumno ACTIVO siempre tiene legajo (`P5512`, restricción diferida). La pantalla de Dirección no ofrece lo que la base rechazaría y lo explica.
11. **Motivo obligatorio, texto libre, de 3 a 200 caracteres** al reponer y revocar (queda en el historial interno; no hay catálogo cerrado). El contrato aprobado no lo definía: es una decisión de producto que **Lucas aprobó durante la revisión** entre tres opciones (texto libre obligatorio, catálogo cerrado, motivo opcional). Coincide con la convención del proyecto para los cambios de estado. Una misma regla rige en la base (`CHECK` y validación, `P5624`), en la API (Zod, 422 `MOTIVO_INVALIDO`) y en la pantalla, con mensajes en español.
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

**Formato de configuración**: `QR_CREDENCIAL_KID_ACTIVA` contiene solo el identificador (por ejemplo, `k1`); `QR_CREDENCIAL_CLAVES` contiene el par `kid:clave_base64url`, no la clave sola. El comando mostrado en una versión anterior de este documento omitía `kid:` y habría configurado una variable inválida: **no usarlo**. La clave desplegada se generó con un generador criptográfico del sistema, se transfirió sin imprimirse y se cotejó contra su copia en una nota segura de Bitwarden bajo custodia de Lucas. No se incluye su valor ni una huella derivada de él en esta evidencia. La disponibilidad para el equipo no se verificó y requiere un acuerdo de custodia independiente.

**Rotar**: (1) agregar la clave nueva a `QR_CREDENCIAL_CLAVES` conservando las viejas; (2) cambiar `QR_CREDENCIAL_KID_ACTIVA`; (3) desplegar. Las credenciales existentes siguen valiendo con su clave vieja y las nuevas usan la activa. (4) Retirar una clave vieja solo cuando no quede ninguna credencial ACTIVA con ese `kid`:

```sql
SELECT clave_kid, count(*) FROM public.credenciales_qr WHERE estado = 'ACTIVA' GROUP BY 1;
```

**Pérdida de la clave**: todas las credenciales firmadas con ella dejan de poder mostrarse y verificarse (fallan cerrado). Plan: recuperar la copia del gestor; si no existe, generar una clave nueva con `kid` nuevo, desplegar, y **reponer** cada credencial ACTIVA afectada (la reposición conserva el historial y emite con la clave nueva); reimprimir las tarjetas. Ver el listado de afectadas con la consulta anterior.

**Sospecha de filtración**: rotar de inmediato (pasos 1 a 3) y reponer todas las ACTIVAS del `kid` comprometido; luego retirar esa clave.

## 7. Matriz de actores

`✔` permitido, `✖` denegado (código en la prueba). Cada celda se probó en las tres capas —pantalla, API y PostgREST— **en el stack local antes del merge**. No equivale a una prueba autenticada en producción; ver sección 13.

| Actor | Ver la propia o de hijos | Emitir, reponer, revocar | Historial interno | Verificar |
|---|---|---|---|---|
| Dirección habilitada | ✔ todas | ✔ emitir y reponer solo con el alumno ACTIVO (`P5627`); revocar siempre | ✔ | ✔ |
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
| Emitir y reponer solo con el alumno ACTIVO; revocar siempre | Base, API, pantalla | `credenciales_qr_rls.sql` B21, B22, F25 a F34; concurrencia 4; spec «un alumno inactivo no recibe ni repone credencial» | Pasó |
| Imprimir imprime solo la tarjeta elegida (padre con varios hijos) | Pantalla | `credenciales-qr-ui.spec.ts` «con dos hijos» (tres perfiles) | Pasó |
| Curso, DNI o legajo no cambian el payload | Base, API | `credenciales_qr_rls.sql` H1 a H5; spec «cambiar curso, DNI o legajo» | Pasó |
| Tarjeta con nombre, apellido, legajo; sin DNI ni foto | Pantalla | `credenciales-qr-ui.spec.ts`; specs de alumno y padre | Pasó |
| Descarga e impresión | Pantalla | descarga PNG 1011×638 verificada por bytes; impresión con `emulateMedia('print')` | Pasó |
| Español, accesible, responsive | Pantalla | contraste WCAG AA, foco, objetivos táctiles de 44 px, sin desborde en escritorio, Pixel 5 e iPhone 13 | Pasó |
| Ausencia de credencial no emite | Pantalla, API | specs «sin credencial NO se emite sola» (UI y sesión real) | Pasó |
| EPT-64 no escanea ni registra accesos | Diseño | sin tablas de eventos ni rutas de escaneo; verificación solo Dirección | Cumplido |
| Nada rompe alumnos, bloqueo, vínculo, matrícula parental, comedor, transporte, deportes | Todas | sección 9.4 | Pasó |

## 9. Resultados de verificación

Todo se ejecutó sobre el SHA `cd54c21` contra el stack local aislado `ept64` (otro `project_id`, puertos 573xx; no se tocó ninguna base compartida ni producción). Salvo lo indicado, cada comando terminó con **exit 0**. Las cifras son las **medidas en esa corrida**, no las del informe de implementación.

### 9.1 Base de datos

| Comando | Exit | Resultado |
|---|---|---|
| `supabase db reset` | 0 | 25 migraciones aplicadas desde cero, la última la de EPT-64 |
| `supabase migration list --local` | 0 | las 25 coinciden entre el repositorio y la base |
| `supabase db lint --local --level warning` | 0 | «No schema errors found» |
| `supabase db advisors --local --type all` | 0 | 10 avisos `WARN`, **ninguno sobre `credenciales_qr`**; son de tablas de otras historias |
| `node supabase/tests/tipos-generados.mjs` | 0 | tipos generados reproducibles y sin diferencias |

### 9.2 SQL, RLS y concurrencia

| Prueba | Exit | Resultado |
|---|---|---|
| `credenciales_qr_rls.sql` | 0 | **147** comprobaciones OK (137 originales + 10 de la regla del alumno inactivo): estructura, emisión, lectura por actor y por fila, escritura directa (incluido el propietario), reposición, revocación, validez, historial, curso/DNI/legajo y reversión |
| `credenciales_qr_concurrencia.mjs` | 0 | cinco escenarios con conexiones `psql` independientes y `pg_blocking_pids`: doble emisión, doble reposición, reposición contra revocación (dos órdenes), emisión y reposición contra inactivar y reactivar (sin deadlock; con el alumno inactivo se rechazan con `P5627` y revocar sigue permitido), y ráfagas de 6 emisiones y 6 reposiciones. Siempre exactamente una ACTIVA |
| `usuarios_permisos_rls.sql` (EPT-59) | 0 | 78 envoltorios públicos cubiertos; se ejecuta como `supabase_admin` |
| Resto de las pruebas `*_rls.sql` y `usuarios_alta_atomica.sql` (16 archivos; con las dos filas anteriores son 18) | 0 | alumnos, vínculo familiar, matrícula parental, comedor, transporte, deportes, horarios, materias, niveles, cursos, profesores, inscripciones y reportes |
| Las otras 11 pruebas `*_concurrencia.mjs` | 0 | las mismas historias más usuarios y permisos |

**La regresión falla antes y pasa después.** Con la migración anterior (`5bef912`), la comprobación `[B21]` del SQL falla: la base emitía la credencial a un alumno inactivo. Con la migración corregida pasa.

### 9.3 Criptografía y pantalla

| Prueba | Resultado |
|---|---|
| `credenciales-qr-cripto.spec.ts` | 24 pruebas. Incluye: firma válida; 128 de 128 bits alterados en el identificador y 256 de 256 en la firma; `kid` alterado o desconocido; formato malformado; codificaciones no canónicas; versión desconocida; clave equivocada; clave faltante o inválida; rotación; **0 consultas a la base ante cualquier payload inválido**; respuesta idéntica para lo inválido y para un identificador firmado pero inexistente; el SVG se decodifica de vuelta al mismo texto (también con el paquete `qr` nuevo) |
| `credenciales-qr-ui.spec.ts` | 72 ejecuciones (24 por perfil: escritorio, Pixel 5 e iPhone 13): estados, descarga, impresión —incluida la de un padre con dos hijos—, diálogos, teclado, foco, contraste AA y sin desborde |
| `credenciales-qr-auth.spec.ts` | 19 pruebas declaradas, 23 ejecuciones (una se repite por cada uno de los cinco roles bloqueados): sesiones reales de Dirección, alumno propio, ajeno e inactivo, padre vinculado y desvinculado, padre sin hijos, docente, PERSONAL, sin perfil, anónimo y los cinco roles bloqueados; API, pantalla y PostgREST directo; concurrencia por HTTP; **servidor sin clave: 503 y nada persistido** |

### 9.4 Regresiones y suite completa

| Comando | Exit | Resultado |
|---|---|---|
| `node supabase/tests/correr-autenticadas.mjs` (suite E2E completa, con un servidor extra sin claves en el puerto 3100) | 0 | **1405 pasaron**, 0 fallaron, 0 inestables, 11 omitidas (24,5 min). Las 11 omisiones son de otras historias y ninguna es de credenciales: teclado en iPhone de comedor, transporte e inscripciones, benchmark de reportes y un caso de Dirección bloqueada |
| `npx tsc --noEmit` | 0 | sin errores |
| `npm run build` | 0 | compila y genera las rutas nuevas. El bundle del cliente (`.next/static`) **no** contiene `QR_CREDENCIAL`, `EPT-QR-V1`, `createHmac`, `timingSafeEqual`, `EPT1.` ni `encodeQR`; no hay sourcemaps públicos |
| `git diff --check origin/main..HEAD` | 0 | limpio |
| `npx eslint .` | 1 | 121 hallazgos (14 errores, 107 avisos). **Comparado con `origin/main` (`1e00169`) en un worktree limpio: idéntico** (mismos 26 archivos, mismas reglas y mismas líneas). Ninguno está en los archivos de EPT-64. ESLint focalizado sobre los archivos que esta historia agrega o modifica: 0 |

El informe de implementación hablaba de «43 pruebas autenticadas»; la cifra medida es la de la tabla anterior (23 ejecuciones de 19 pruebas). La diferencia no oculta ninguna cobertura: todos los actores de la sección 7 están en esas pruebas.

También se comprobó, contra el código corregido, cómo falla cerrado el despliegue (sección 13): con el servidor sin claves, 503; con las claves pero sin la migración (objetos eliminados en el stack local), 500 `ERROR_INTERNO` en la lectura, la emisión, la verificación y el historial, y la pantalla de Dirección muestra el error genérico sin ningún detalle técnico.

La suite completa regenera las capturas de EPT-13; se restauraron con `git checkout -- docs/evidence/EPT-13`.

### 9.5 Hallazgos de la revisión independiente

| # | Hallazgo | Severidad | Resolución |
|---|---|---|---|
| 1 | Emitir y reponer se permitían a un alumno **inactivo**: la credencial nacía inútil (la validez exige alumno activo y la tarjeta muestra el legajo) | Bloqueante de contrato | Corregido: `P5627` / 409 `ALUMNO_INACTIVO`; en la reposición ocurre antes de revocar; revocar sigue permitido. Regresiones SQL, concurrencia y E2E. Decisión 10 |
| 2 | Con un padre de **varios hijos** con credencial vigente, «Imprimir» dejaba visibles todas las tarjetas, superpuestas en el mismo punto | Funcional | Corregido: el botón marca su tarjeta (`data-imprimiendo`) y el CSS de impresión oculta las demás. Regresión de UI con dos hijos |
| 3 | `@paulmillr/qr` está **deprecado** por su autor («cambiar a `qr` para recibir actualizaciones de seguridad»); la evidencia lo llamaba «mantenida» | Riesgo de dependencia | Reemplazado por `qr` 0.7.2 con matriz idéntica en 200/200 payloads. Decisión 8 |
| 4 | La documentación llamaba «append-only» a una tabla cuya fila se actualiza al revocarla | Precisión | Reescrito: garantía real en la decisión 1 y en la migración |
| 5 | Motivo de reposición y revocación: texto libre obligatorio (3–200), no un catálogo; el contrato no lo definía | Decisión de producto | Lucas aprobó el texto libre obligatorio. Decisión 11 |
| 6 | La prueba de concurrencia 4 asumía emitir a un alumno inactivo | Consecuencia del hallazgo 1 | Reescrita para la regla nueva |

Sin hallazgos en autorización, criptografía, secretos ni privacidad: el verificador rechaza formato y firma **antes** de cualquier consulta; la verificación es solo de Dirección y responde igual ante lo inválido y lo desconocido; ninguna clave, payload válido ni token aparece en el bundle, el repositorio, las capturas ni la documentación.

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
| Alteración del historial | Trigger que también rige para el propietario; sin DELETE ni TRUNCATE; una sola modificación por fila (ACTIVA → REVOCADA) | Quien administre la base puede deshabilitar el trigger (como en las demás tablas de historial del proyecto) |
| CSRF en las rutas POST | Cookies de sesión `SameSite=Lax`, igual que el resto de la aplicación | Sin token propio |
| Fuerza bruta contra la verificación | Solo Dirección autenticada puede llamarla | **No hay límite de tasa.** Deuda para EPT-65, que abre la verificación a más roles |
| Registros | Solo se registra el código SQLSTATE; nunca payloads, claves ni datos personales | — |

## 12. Reversión

La reversión del esquema se probó **solo en el stack local** (`credenciales_qr_rls.sql`, sección R): elimina las diez funciones (`public` y `app_private`), la tabla `public.credenciales_qr`, las tres funciones de trigger y de validación, y el tipo `estado_credencial_qr`; no toca objetos preexistentes. La migración **ya está aplicada en producción** y hay dos credenciales de prueba REVOCADAS, ninguna ACTIVA, según la consulta posterior. Esto no autoriza un `DROP TABLE` automático: destruiría incluso el historial de prueba. Antes de cualquier reversión productiva hay que verificar de nuevo el recuento, el alcance, el respaldo y la decisión de Dirección. Si ya existen credenciales reales, `DROP TABLE` destruye también su historial: primero se debe preservar la información, retirar la clave del servidor para fallar cerrado y acordar el plan. El respaldo de la sección 13 no tiene una restauración aislada probada. Volver a una versión anterior de la aplicación retira las pantallas y rutas, pero no revierte por sí solo la migración.

## 13. Despliegue y postflight de producción — 30/09/2026

**Veredicto: infraestructura y estructura desplegadas; ciclo de emisión, reposición y revocación comprobado parcialmente con una sesión productiva de Dirección.** Lucas confirmó expresamente un único alumno activo como sujeto de prueba. El recorrido no cubrió la verificación autenticada del QR, otros roles ni la descarga e impresión concluyentes. Los resultados locales de la sección 9 no sustituyen esas comprobaciones.

### 13.1 Identidad y preflight

| Control | Evidencia y resultado | Límite |
|---|---|---|
| Código integrado | PR #26 `MERGED`; commit de merge `cbb6f1be9ca5d8e8c640e5d78dc30ecf56661757`. El árbol de `origin/main` contiene la implementación | El `main` local estaba atrasado; la operación usó un worktree limpio en el merge, no ese checkout |
| Proyecto de base | Supabase `ycvrpmrogvjnntnoosbh`; antes: 24 migraciones remotas alineadas con 24 locales y solo `20260929224534_ept_64_credencial_qr.sql` pendiente | No se aplicaron migraciones ajenas |
| Simulación SQL | `supabase db push --dry-run --skip-vault` terminó con exit 0 y enumeró únicamente la migración QR | Una simulación no demuestra reversibilidad |
| Datos antes de migrar | `public.alumnos`: 6 filas; `public.credenciales_qr` todavía no existía | «Tabla inexistente» no equivale a «cero credenciales» en el preflight |
| Respaldo previo | Cinco archivos `.age` cifrados fuera del repositorio: roles, esquema, datos, esquema y datos del historial de migraciones, en `E:\Escritorio\resguardos\MetodologiaTPI\EPT-64-20260930-pre-migration`. SHA-256 del manifiesto: `2afafb4306c19a6455496600018b0cbc894993de6f2b8115f2c845e6c4b00480`. Identidad de descifrado custodiada y cotejada en Bitwarden | Se verificó la integridad de archivos, **no** una restauración aislada. No incluye archivos físicos de Storage (había 9 objetos); no es un respaldo integral del proyecto |
| Servicio de respaldos administrados | `backups list` informó WAL-G habilitado, PITR deshabilitado y cero copias visibles | No se presupuso un punto de restauración administrado |

### 13.2 Cambio aplicado y despliegue

| Control | Evidencia y resultado | Límite |
|---|---|---|
| Variables de firma | `QR_CREDENCIAL_KID_ACTIVA` y `QR_CREDENCIAL_CLAVES` presentes en Vercel **Production**; clave generada con CSPRNG y copia cotejada desde Bitwarden | No se leyeron valores desde Vercel. La sesión de Dirección obtuvo tarjetas QR; falta verificar sus firmas y estados mediante el endpoint autenticado |
| Migración | `supabase db push` terminó con exit 0 y aplicó **una vez** `20260929224534_ept_64_credencial_qr.sql` al proyecto verificado | No volver a ejecutarla como paso manual sin comprobar el ledger |
| Ledger tras la migración, **antes de la prueba** | 25 migraciones locales y 25 remotas alineadas; `public.alumnos` tenía 6 filas y `public.credenciales_qr` existía con 0 filas | Es el corte anterior al recorrido autenticado, no el estado final |
| Estado **después de la prueba** | Ledger 25/25; `public.alumnos`: 6; `public.credenciales_qr`: 2 filas, 0 ACTIVA y 2 REVOCADAS | Consulta SQL productiva agregada de solo lectura; no acredita por sí sola la verificación del payload ni permisos de otros roles |
| Estructura posterior | 10 columnas; 4 FK `RESTRICT`; 4 `CHECK`; índice único parcial para `ACTIVA`; triggers que impiden `DELETE`/`TRUNCATE`; 5 funciones privadas y 5 envoltorios públicos; RLS y 2 políticas; DML directo denegado | Es una inspección estructural y de privilegios, no un ciclo funcional autenticado |
| Asesores | 33 → 37 avisos: +4 `INFO` por índices nuevos aún sin uso; 9 `WARN`, 4 de seguridad y 0 `ERROR`, sin aumento de advertencias | Los avisos preexistentes no se resolvieron en EPT-64 |
| Vercel | `dpl_G9CjhYKvW9jFet93M7WF3SVqCqWQ` quedó `READY` y `Current`, asociado a `cbb6f1b`; snapshot con ambos nombres de variables. `/` y `/login`: HTTP 200 | Esos 200 públicos no acreditan el recorrido autenticado posterior; sus resultados y límites están en la matriz siguiente |

### 13.3 Matriz contrato → prueba → resultado → límite

| Contrato o actor | Prueba local | Prueba productiva | Resultado y límite |
|---|---|---|---|
| Firma, formato, rotación y rechazo previo a base | `credenciales-qr-cripto.spec.ts`: 24/24 sobre el código integrado | Dos imágenes QR decodificadas solo en memoria: formato `EPT1` correcto y contenido diferente tras la reposición | Formato y cambio comprobados sin exponer el contenido; **no** se invocó la verificación autenticada de firma y estado |
| Dirección: emitir, ver, descargar, reponer, revocar, historial y verificar | SQL/RLS y sesión local de la sección 9 | En UI productiva se emitió, vio la tarjeta, repuso con motivo genérico y revocó la nueva. Tras recargar siguió sin tarjeta vigente | Emisión, reposición y revocación comprobadas para el alumno de prueba; historial y verificación autenticada pendientes. Descarga e impresión no concluyentes |
| Verificación de estado «válida» y «revocada» por Dirección | API y sesión local de la sección 9 | No se invocó el `POST /api/credenciales-qr/verificacion` autenticado: no había formulario en la UI ni vía disponible en el control usado | **Pendiente**: decodificar la imagen y comprobar el formato no demuestra firma ni estado; tampoco se probó el rechazo tras revocación |
| Alumno propio/ajeno/inactivo, padre vinculado/desvinculado, docente, PERSONAL y roles bloqueados | SQL, API y UI local de la sección 9 | No ejecutada con cuentas autenticadas | Matriz de permisos productiva **pendiente** |
| Anónimo en API de credenciales y verificación | Casos locales de la sección 9 | GET/POST/verificación sintéticos: HTTP 401, JSON, `Cache-Control: no-store`, sin filtración observada | Denegación anónima comprobada; no cubre autorizaciones por rol |
| GET no admitido de verificación | Contrato de ruta solo POST | HTTP 405 con caché pública; no se observó dato sensible | Conviene revisar el encabezado de caché de esa respuesta; no equivale a exposición de un QR |
| Pantalla: tarjeta, PNG, impresión individual, accesibilidad y móvil | UI QR: 72/72 en escritorio, Pixel 5 e iPhone 13; regresiones EPT-63/alumnos/familia/comedor/transporte/deportes: 101/101 | Tarjeta y QR visibles en sesión productiva de Dirección. «Descargar» mostró aviso de inicio, pero no se confirmó el archivo; «Imprimir» terminó en timeout del control | La prueba local cubre impresión individual de dos hijos, PNG, foco/teclado, contraste AA y español. No hay prueba productiva concluyente de archivo descargado ni de impresión |
| SQL/RLS y concurrencia locales de la sección 9 | 147 aserciones SQL y escenarios de concurrencia en la corrida previa al merge | Inspección estructural y recuento posterior; las transacciones de UI se describen arriba | No se repitieron la batería SQL/RLS ni los E2E automatizados en esta sesión: Docker local no estaba disponible |

### 13.4 Dependencias ausentes: ensayos locales, no estado actual de producción

| Ensayo local | Resultado observado | Alcance |
|---|---|---|
| Servidor sin clave QR válida | Las operaciones ensayadas que requieren la clave respondieron 503 `SERVICIO_NO_DISPONIBLE`, sin material de clave en la respuesta ni credenciales persistidas | Confirma falla cerrada en esos casos locales; en producción ambas variables están presentes, pero sus valores no se leyeron |
| Claves configuradas, pero objetos de la migración eliminados en el stack local | Las operaciones ensayadas que llegaron a consultar la base —lectura, emisión, verificación e historial— respondieron 500 `ERROR_INTERNO` sin detalles técnicos | No significa que **toda** solicitud sin tabla devuelva 500: autenticación, validación o ausencia de clave pueden detenerla antes. La migración sí existe ahora en producción |

**Riesgos conservados:** un QR estático puede copiarse hasta su revocación (aceptado por diseño). El botón individual «Imprimir» aísla la tarjeta elegida; el atajo del navegador `Ctrl+P` con varios hijos puede superponer tarjetas y no está cubierto por esa prueba. No se habilitó EPT-65 ni se probó el escaneo.

No se incorporaron a esta evidencia payloads QR, datos personales, registros de auditoría ni capturas del recorrido productivo.

**Siguiente acción para cerrar EPT-64:** con la identidad de prueba ya autorizada, obtener una vía controlada para invocar el `POST` de verificación autenticada y acreditar los estados «válida» y «revocada» (una comprobación de «válida» requeriría un nuevo ciclo de prueba autorizado, pues ya no hay credencial ACTIVA). Confirmar el archivo descargado y la impresión, y usar cuentas autorizadas para probar las denegaciones por rol. Registrar resultados y defectos sin exponer QR, datos personales ni claves; Lucas debe integrar el PR #27 de esta evidencia. Solo con el recorrido productivo faltante acreditado y la documentación integrada corresponde evaluar la transición de Jira a «Hecho». Hasta entonces EPT-64 permanece «En curso» y EPT-65 «Por hacer».

**Mejoras operativas separadas del cierre:** la identidad de respaldo y la clave QR quedaron bajo custodia de Lucas y se cotejaron desde Bitwarden; compartir esa custodia requiere una decisión de equipo, no es un requisito nuevo de EPT-64. Una restauración aislada permitiría calificar el respaldo como recuperable; mientras no se pruebe, se lo describe únicamente como cifrado e íntegro.

## 14. Riesgos y deuda

- Decisión 11 (motivo de texto libre, obligatorio): aprobada por Lucas en la revisión. La decisión 10 (emitir y reponer solo con el alumno activo) se corrigió en la revisión.
- **Riesgo residual aceptado por contrato**: el QR es estático y se puede copiar o fotografiar. Esta historia **no** resuelve el replay: lo mitiga únicamente revocar y reponer. EPT-65 deberá definir escáner, autorización, límite de intentos y registros.
- Imprimir con el atajo del navegador (Ctrl+P) en la pantalla de un padre con varios hijos vigentes superpone las tarjetas; el botón «Imprimir» de cada tarjeta imprime solo la elegida.
- Falta límite de tasa en la verificación (EPT-65).
- La descarga dibuja la tarjeta en un canvas con la tipografía del sistema; no incluye foto porque el contrato no la prevé.
- `tests/auth.setup.ts` y `usuarios_permisos_rls.sql` se tocaron (limpieza y batería): cualquier historia futura con una tabla que referencie alumnos deberá hacer lo mismo.
- Los avisos preexistentes del asesor no se resolvieron en EPT-64; el postflight registró 9 `WARN`, 4 de seguridad y cuatro `INFO` nuevos por índices todavía sin uso, sin `ERROR` (sección 13.2).

## 15. Retrospectiva

- **Lo que funcionó**: separar el verificador puro del acceso a la base permitió probar «la firma va antes» con un espía y probar 384 alteraciones de bits sin una base. Decodificar la imagen que entrega la propia aplicación probó la legibilidad del QR sin conocer la clave.
- **Lo que costó**: los cambios que una tabla nueva impone a suites ajenas (siembra, batería de permisos, impresión de reportes) solo aparecieron al correr la suite completa. Conviene correrla temprano en la próxima historia.
- **Trampas de herramientas**: los archivos del árbol de trabajo son CRLF, así que reemplazos con `\n` no encuentran el ancla; `MSYS_NO_PATHCONV=1` rompe rutas para el CLI de Supabase; WebKit necesita esperar la hidratación de React antes de operar.

## 16. Comandos reproducibles

```bash
# Comparación de ESLint contra la base (worktree limpio de origin/main con el mismo node_modules)
npx eslint . -f json -o eslint_head.json   # y lo mismo sobre origin/main; se comparan archivo, regla y línea

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
