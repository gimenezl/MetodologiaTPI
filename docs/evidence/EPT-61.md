# EPT-61 — RF18: Administrar deportes y grupos

Evidencia de la tarea completa **EPT-61**, sin subtareas en Jira al momento de
trabajar. El trabajo se hizo en dos fases con escritores distintos: la Fase A
(base de datos) y la Fase B (servidor, API, interfaz y pruebas de navegador),
que es la que documenta la mayor parte de este archivo.

---

## 1. Resumen ejecutivo

La dirección puede administrar por completo, dentro de la ruta existente
`/dashboard/deportes`, el catálogo de deportes y los grupos deportivos:

- **Deportes:** alta (el catálogo ya no está limitado a los seis sembrados),
  renombrado, inactivación y reactivación.
- **Grupos:** edición de nombre, cupo y profesor responsable, inactivación y
  reactivación. El deporte y el nivel de un grupo no cambian.
- **Reglas que protege la base** y que la pantalla anticipa con texto visible:
  no se inactiva un deporte con grupos activos; no se inactiva un grupo con
  inscripciones activas; el cupo no baja de la ocupación; el profesor de un
  grupo debe ser un docente activo; un deporte con grupos solo admite cambios de
  mayúsculas y minúsculas en su nombre.
- **Sin borrado físico en ninguna capa:** no hay tabla de historial nueva, ni
  `DELETE`, ni ruta de borrado. Cualquier `DELETE` recibe 405 con la cabecera
  `Allow`.

El estudiante conserva exactamente su vista (inscribirse y cancelar), sin
controles de administración. Docente, padre, personal y una cuenta sin perfil
siguen sin acceso a la pantalla, como antes. Una cuenta de dirección bloqueada
(EPT-59) recibe «Acceso bloqueado».

La unidad de ejecución fue un candidato local de nueve commits sobre
`origin/main`: tres de la Fase A y seis de la Fase B (sección 17). No hubo push,
PR, merge, `db push` ni cambio alguno en Jira.

---

## 2. Línea base y worktree

| Concepto | Valor |
|---|---|
| `origin/main` | `1d33d300a0307e57dee7ca7fcad7a7862db5d18c` (incluye EPT-60/transporte) |
| Rama local | `codex/ept-61-admin-deportes` |
| Worktree | `E:\Escritorio\codigo\MetodologiaTPI-ept61` |
| Migración nueva | `supabase/migrations/20260928155706_ept_61_administracion_deportes.sql` |
| Base usada | Stack local descartable `educar-para-transformar` (Docker) |

El checkout principal `E:\Escritorio\codigo\MetodologiaTPI` no se tocó. No se
copió ni se creó ningún `.env.local`: las credenciales locales las inyecta
`supabase/tests/correr-autenticadas.mjs` desde `supabase status -o env`, y el
ejecutor se niega a correr si la API no es de bucle local.

Línea base de calidad medida antes de tocar código de aplicación: `npx tsc
--noEmit` exit 0 y `npx eslint` con 121 problemas (14 errores y 107
advertencias, todos preexistentes y fuera de los archivos de esta historia).

---

## 3. Alcance y fuera de alcance

### Dentro del alcance

- Alta, renombrado y cambio de estado de deportes (Fase A: RPC; Fase B: API y
  pantalla).
- Edición y cambio de estado de grupos (Fase A: RPC; Fase B: API y pantalla).
- Traducción de todos los códigos nuevos y reutilizados a mensajes claros en
  español, sin detalle técnico.
- Controles por rol dentro de `/dashboard/deportes`, estados de carga, vacío,
  error y éxito, foco y teclado, contraste AA y diseño sin desborde a 1280 y
  375 px.
- Banco visual sintético con los estados nuevos y pruebas de servidor,
  navegador y base.

### Fuera del alcance, deliberadamente

- Cancelar la inscripción de un alumno por él (es EPT-62): Dirección no cancela
  por el alumno y la pantalla lo dice.
- Cambiar el deporte o el nivel de un grupo existente.
- Editar el nivel, activar niveles o fichas de profesores: viven en sus
  pantallas (Niveles, Profesores).
- Historial de cambios de deportes y grupos, y cualquier borrado.
- Migrar o reescribir la Fase A.

---

## 4. Estado de Jira

Consultado en vivo el 2026-09-28 contra `grupo12-utn.atlassian.net`.

| Clave | Tipo | Resumen | Estado | Responsable | Etiquetas |
|---|---|---|---|---|---|
| EPT-61 | Tarea | RF18 – Administrar deportes y grupos | Por hacer | Lucas Gimenez | RF18, complementario, deportes |

Descripción de la tarea: «Mantener deportes y grupos por nivel y horario,
asignando obligatoriamente un profesor responsable». No se cambió estado,
descripción, responsable ni comentarios: solo se leyó. La sección 22 deja
preparado el comentario y una recomendación de transición, sin publicarlos.

---

## 5. Decisiones funcionales aprobadas

| # | Decisión | Fundamento y dónde se cumple |
|---|---|---|
| D1 | El profesor responsable es obligatorio por grupo, no por deporte | Jira pide «asignando obligatoriamente un profesor responsable». El alta de deporte no recibe profesor (`crearDeporteSchema` es estricto; la base lo verifica). Cada grupo tiene profesor no nulo |
| D2 | El catálogo se puede ampliar más allá de los seis sembrados | `crear_deporte`; botón «Nuevo deporte» |
| D3 | No se inactiva un deporte con grupos activos; reactivar sí | La RPC cuenta con la fila del deporte bloqueada (P5974). La pantalla deshabilita el control con el motivo visible y el rechazo por una carrera nombra los grupos |
| D4 | No se inactiva un grupo con inscripciones activas; reactivar solo si siguen activos deporte, nivel y profesor | P5975 y las validaciones de 014 y EPT-58. La pantalla anticipa cada motivo |
| D5 | El cupo no baja de la ocupación | Regla existente de 014 (P5581). La edición muestra la ocupación, fija el mínimo y explica el rechazo |
| D6 | Sin historial nuevo, sin borrado físico en ninguna capa | La migración no crea tablas ni triggers; la API no expone DELETE |
| D7 | Nivel y deporte de un grupo son inmutables; renombrar un deporte con grupos solo cambia mayúsculas y minúsculas | La RPC de edición no los recibe y `.strict()` los rechaza. El renombrado usa la protección de 014 (P5580) |
| D8 | Todo dentro de `/dashboard/deportes`, con controles según el rol | Sin ruta nueva ni cambios en la navegación |

### Advertencia sobre el renombrado de un deporte

La identidad de un deporte es su nombre en mayúsculas y sin espacios laterales.
Un deporte con **al menos un grupo, aunque esté inactivo**, solo admite cambios
de mayúsculas y minúsculas («Fútbol» por «FÚTBOL»). Cualquier otro cambio
(«Futbol», «Fútbol 5», o dos espacios internos) se rechaza. La pantalla lo
explica **antes** de enviar, en el diálogo, y no envía un nombre que la base va
a rechazar; si otra persona crea un grupo mientras tanto, el rechazo del
servidor se muestra con el mismo texto. Un deporte sin grupos se renombra
libremente.

---

## 6. Modelo de datos, RPC y SQLSTATE

Sin tablas ni columnas nuevas. Cinco funciones públicas (envoltorios
`SECURITY INVOKER`) sobre cinco privadas (`SECURITY DEFINER`, `search_path`
vacío) que revalidan `auth.uid()` y el rol DIRECTOR dentro de PostgreSQL:

| Función pública | Parámetros | Devuelve |
|---|---|---|
| `crear_deporte` | nombre | fila de `deportes` |
| `renombrar_deporte` | deporte, nombre | fila de `deportes` |
| `cambiar_estado_deporte` | deporte, activo | fila de `deportes` |
| `editar_grupo_deportivo` | grupo, nombre, cupo, profesor | fila de `grupos_deportivos` |
| `cambiar_estado_grupo_deportivo` | grupo, activo | fila de `grupos_deportivos` |

Todos los parámetros son obligatorios y repetir el dato o el estado actual es
idempotente. La edición funciona también sobre grupos inactivos (es la forma de
cambiar un profesor inactivo antes de reactivar).

### SQLSTATE y su traducción en la aplicación

| SQLSTATE | Motivo | HTTP | Mensaje mostrado |
|---|---|---|---|
| P5970 | Nombre de deporte inválido | 400 | El nombre del deporte debe tener entre 1 y 100 caracteres. |
| P5971 | Deporte duplicado | 409 | Ya existe un deporte con ese nombre. |
| P5972 | Estado nulo | 400 | Indicá si querés dejarlo activo o inactivo. |
| P5973 | Grupo duplicado | 409 | Ya existe un grupo con ese nombre para ese deporte y nivel. |
| P5974 | Inactivar deporte con grupos activos | 409 | Cuenta y nombra los grupos activos (se lee el detalle con tolerancia a que falte o venga malformado) |
| P5975 | Inactivar grupo con inscripciones activas | 409 | Cuenta los alumnos con inscripción activa |
| P5580 | Renombrar un deporte con grupos | 409 | Regla de mayúsculas y minúsculas (según la operación) |
| P5581 | Cupo menor que la ocupación | 409 | Cupo menor que las inscripciones activas, con la cifra |
| P5561, P5563, P5565, P5605 | Al reactivar un grupo: deporte, nivel, profesor sin rol o inactivo | 409 | Texto propio de la reactivación, con el paso a seguir |
| P5560, P5564, P5568 | Inexistentes | 404 | Mensajes existentes |
| P5566, P5567 | Cupo o nombre de grupo inválidos | 400 | Mensajes existentes |
| P5505, 42501 | Sin sesión, sin rol o cuenta bloqueada | 401, 403 | Mensajes existentes |

P5580 y P5581 ya existían con un mensaje genérico; ahora se traducen según la
operación (`renombrarDeporte`, `editarGrupo`) y conservan el genérico para las
demás. Ningún SQLSTATE ni texto de la base llega a la pantalla: lo verifica
`exigirMensajeSinDetalleTecnico` en cada respuesta de error de las pruebas.

---

## 7. Fase A: base de datos (ya verificada por otro escritor)

Resultados que aportó la Fase A, citados sin reejecutarlos aquí:

- `supabase db reset` aplica toda la cadena.
- `deportes_administracion_rls.sql`: 50 comprobaciones OK.
- `deportes_administracion_concurrencia.mjs`: 14 OK (inscripción contra
  inactivar grupo, alta de grupo contra inactivar deporte, cupo contra
  inscripción, doble cambio de estado, renombrar contra alta de grupo, doble alta
  de deporte, reactivar contra carga de franjas).
- Regresión SQL: `deportes_rls` 59, `profesores_rls` 19, `horarios_rls` 44,
  `horarios_academicos_rls` 8, `comedor_rls` 31, `transporte_rls` 25,
  `usuarios_permisos_rls` 46 (61 envoltorios), `niveles_rls` 73, `materias_rls` 44,
  `cursos_rls` 39, `alumnos_academicos_rls` 69, `perfiles_privacidad_rls` 4,
  `reconciliacion_esquema_remoto` 42, `usuarios_alta_atomica` 23.
- Concurrencia y otras: `deportes_concurrencia` 10, `profesores_concurrencia` 9,
  `horarios_concurrencia` 11, `horarios_academicos_concurrencia` 4,
  `transporte_concurrencia` 4, `comedor_concurrencia` 4, `niveles_concurrencia` 4,
  `alumnos_academicos_concurrencia` 8, `usuarios_permisos_concurrencia` 2,
  `profesores_postgrest` 44, `usuarios_bloqueo_auth` 165.
- Advisors sin observaciones nuevas (10 advertencias preexistentes).
- `tipos-generados.mjs` y `tsc` exit 0.

### Desvíos de la Fase A que este candidato hereda

- **(a) P5974 y P5975 viven en la RPC, no en triggers.** Un trigger rompía
  `profesores_rls` (CA-07) y `horarios_academicos_rls`, y EPT-57 documenta que el
  propietario puede dar de baja un grupo con inscripciones activas. Consecuencia:
  un `UPDATE` directo del propietario de la base podría dejar un grupo inactivo con
  inscripciones activas, como ya ocurría antes. Ningún rol de aplicación tiene
  privilegio de escritura directa, así que la RPC es la autoridad de la aplicación.
- **(b)** La reactivación toma primero el bloqueo consultivo
  `ept57_configuracion_horaria` para evitar un interbloqueo (40P01) preexistente
  entre reactivar un grupo y cargar franjas.
- **(c)** La reactivación también rechaza (P5565) a un profesor que dejó de ser
  DOCENTE, hueco que 014 y EPT-58 no cubrían.
- **(d)** Se revocó `EXECUTE` a `service_role` en los envoltorios.
- **(e)** `database.generated.ts` se regeneró con la CLI fijada 2.117.0 (solo
  stdout): el diff es grande y casi todo de formato, con diferencias del generador
  (`Json` contra `NonNullable<Json>`, `never` contra `Record<PropertyKey, never>`)
  además de las cinco funciones. El mensaje del commit `b9e2361` lo describe de
  forma imprecisa y no se corrigió sin amend. `tipos-generados.mjs` ya fallaba en
  `origin/main`.
- **(f)** No se ejecutaron en la Fase A: `usuarios_vinculo_cuenta`,
  `usuarios_reconciliacion`, `profesores_migracion_a`, `profesores_reversion_a`,
  `migracion_009_colisiones` y `harness_produccion`, por requerir un servidor Next o
  una base en versión anterior. En la Fase B se ejecutó `harness_produccion` (sección
  13). Las que exigen una base anterior o producción quedan fuera de esta evidencia.

---

## 8. Matriz de privilegios y RLS

| Objeto | `anon` | `authenticated` | Notas |
|---|---|---|---|
| `deportes`, `grupos_deportivos`, `inscripciones_deportivas` | sin acceso | `SELECT` (RLS) | Sin `INSERT`, `UPDATE`, `DELETE` ni `TRUNCATE` para ningún rol de aplicación; política RESTRICTIVE de bloqueo de EPT-59 presente |
| Cinco funciones privadas nuevas | sin acceso | `EXECUTE` | `SECURITY DEFINER`, `search_path` vacío; `service_role` sin `EXECUTE` |
| Cinco envoltorios públicos | sin acceso | `EXECUTE` | `SECURITY INVOKER` mínimo |

La Fase B no agrega ningún privilegio, política ni cliente con `service_role`: la
aplicación solo usa la sesión del usuario. La clave de servicio local se usa
únicamente en las pruebas para preparar y limpiar datos.

---

## 9. Matriz actor / acción / dato

| Actor | Ver catálogo y grupos | Administrar deportes y grupos | Inscribirse o cancelar propio | API de administración |
|---|---|---|---|---|
| DIRECTOR habilitado | Sí (activos e inactivos) | Sí | No | Sí |
| DIRECTOR bloqueado | No (Acceso bloqueado) | No | No | 403 |
| ESTUDIANTE | Solo su vista de siempre | No | Sí | 403 |
| DOCENTE, PADRE, PERSONAL, sin perfil | No (Acceso restringido) | No | No | 403 |
| Sin sesión | No (login) | No | No | 401 |

---

## 10. Matriz de criterios de aceptación

| Criterio (RF18, Jira, decisiones) | Base | Servidor y API | Pantalla | Prueba |
|---|---|---|---|---|
| Mantener deportes (alta, nombre, estado) | RPC de catálogo | `POST /api/deportes`, `PATCH /api/deportes/[id]` | Sección «Catálogo de deportes» | `administracion-deportes-auth` (API y pantalla) |
| Mantener grupos por nivel (nivel fijo) y horario (franjas ya existentes) | `editar_grupo_deportivo` | `PATCH /api/deportes/grupos/[id]` | Editar, inactivar, reactivar; franjas visibles en la tarjeta | idem; `horarios-auth` (regresión) |
| Profesor responsable obligatorio por grupo | NOT NULL, DOCENTE, activo | `profesor_id` obligatorio; el alta de deporte no lo acepta | Selector de docentes activos | idem |
| Ampliar el catálogo | `crear_deporte` | 201 y 409 por duplicado | «Nuevo deporte» | idem, incluida la carrera de dos altas |
| No inactivar deporte con grupos activos | P5974 | 409 con los grupos | Control deshabilitado con motivo visible; rechazo por carrera en el diálogo | idem; fixture |
| No inactivar grupo con inscripciones | P5975 | 409 con la cantidad | Control deshabilitado con motivo; pantalla desactualizada | idem; fixture |
| Cupo no menor que la ocupación | P5581 | 409 con la cifra | Mínimo visible y explicado | idem |
| Reactivar solo con deporte, nivel y profesor activos | P5561, P5563, P5565, P5605 | 409 con paso a seguir | Motivo visible antes de intentar | idem |
| Nivel y deporte inmutables; renombrado solo con mayúsculas | P5580 | `.strict()` 400; 409 | Advertencia previa en el diálogo | idem |
| Sin borrado físico ni historial nuevo | sin `GRANT`, sin RPC | DELETE 405 con `Allow` | Sin controles de eliminación | `administracion-deportes` y `-auth` |
| Estudiante y demás roles sin controles ni API | RLS y rol | 401, 403 | Sin región de administración | `administracion-deportes-auth` |
| Español, sin detalle técnico, accesible, sin scroll horizontal | — | mensajes en español | contraste AA, foco, teclado, 375 y 1280 | `administracion-deportes-ui` |

No se pudo contrastar el texto del PDF del enunciado en esta fase: los criterios
de esta matriz salen de la descripción de Jira y de las decisiones aprobadas.

---

## 11. Reproducción local

```bash
docker info                                        # Docker Desktop corriendo
cd MetodologiaTPI-ept61 && npm ci
npx supabase start && npx supabase db reset        # aplica toda la cadena
npx tsc --noEmit
npx playwright test administracion-deportes-ui.spec.ts administracion-deportes.spec.ts
node supabase/tests/correr-autenticadas.mjs deportes-auth.spec.ts
```

Las capturas se generan con `EPT_CAPTURAS=1` **filtrando** por
`administracion-deportes-ui.spec.ts` (fixture) o
`administracion-deportes-auth.spec.ts` (sesión real). No conviene correr la
suite completa con esa variable: regenera la evidencia de otras historias.

---

## 12. Pruebas de base y concurrencia

Ver sección 7: las pruebas de base de la Fase A (`deportes_administracion_rls.sql`
y `deportes_administracion_concurrencia.mjs`) y su regresión se citan de la
verificación independiente hecha por quien coordinó ambas fases. En la Fase B se
agregó una prueba concurrente a nivel HTTP: dos altas simultáneas del mismo
nombre por la API real confirman exactamente una y rechazan la otra con 409.

---

## 13. Pruebas de servidor y de navegador (Fase B)

Tres archivos nuevos. Sus nombres coinciden con las expresiones de dominio de
`playwright.config.ts` (`deportes-auth`, `deportes-ui`) sin modificar la
configuración.

| Archivo | Qué demuestra | Resultado |
|---|---|---|
| `tests/administracion-deportes.spec.ts` | Sin sesión: 401 en cada operación antes de validar; 405 con `Allow` en DELETE, GET y PUT; OPTIONS informa solo lo admitido; las rutas estáticas anteriores conservan su contrato | 5 pasaron |
| `tests/administracion-deportes-ui.spec.ts` | Presentación con datos deterministas en escritorio, Pixel 5 y iPhone 13: estados, avisos, foco, Escape, teclado, doble clic, sesión vencida, fallo de red, contraste AA, controles no anidados, español, sin detalle técnico, tamaño táctil de 44 px, sin scroll horizontal | 75 pasaron (25 por perfil) |
| `tests/administracion-deportes-auth.spec.ts` | Sesión y base reales: cada regla por la API, la pantalla contra la base, todos los roles, cuenta bloqueada y contexto sin cookies | 51 pasaron |

Las pruebas con base real crean todo con el prefijo «E2E Adm», preparan dos
docentes propios (uno con la ficha inactiva) sin depender del nombre del docente
compartido, y limpian antes y después. Los rechazos por duplicado, grupos
activos, inscripciones, cupo, profesor inactivo o sin rol y reactivación con
dependencias inactivas los produce la base, no una comprobación previa.

Cubren, entre otros: alta, duplicado y carrera; renombrado libre y con grupos;
inactivar con y sin grupos activos y reactivar; edición con cupo bajo la
ocupación (dos alumnos reales inscriptos); profesor inactivo, sin rol y
inexistente; inactivar un grupo con inscripciones y de nuevo tras cancelar cada
una; reactivar con deporte inactivo y con profesor inactivo; persistencia tras
recargar; pantalla desactualizada con rechazo real de la base; identificadores
y acciones inválidos (400 y 404); DELETE, GET y PUT (405); el estudiante sin
controles ni API; docente, padre, personal y sin perfil con 403; director
bloqueado; y un contexto sin cookies con 401.

### Comandos y resultados de la verificación final

| Comando | Exit | Resultado |
|---|---|---|
| `npx tsc --noEmit` | 0 | sin errores |
| `npx eslint` sobre los archivos tocados | 0 | limpio |
| `npx eslint` (todo el repositorio) | 1 | 121 problemas (14 errores y 107 advertencias): idéntico a la línea base |
| `npm run build` | 0 | correcto; ninguna ruta `/pruebas-ui/*` figura en el listado |
| `node supabase/tests/harness_produccion.mjs` | 0 | todas las afirmaciones: los bancos responden como una ruta inexistente aun con `EPT_UI_HARNESS=1` |
| `node supabase/tests/correr-autenticadas.mjs administracion-deportes-auth.spec.ts` | 0 | 51 pasaron |
| `node supabase/tests/correr-autenticadas.mjs deportes-auth.spec.ts` | 0 | 81 pasaron (30 anteriores y 51 nuevos), sin pruebas inestables |
| `npx playwright test deportes-ui.spec.ts deportes.spec.ts` | 0 | 112 pasaron (incluye los nuevos `administracion-deportes-ui` y `administracion-deportes`) |
| `npx playwright test horarios-ui.spec.ts profesores-ui.spec.ts transporte-ui.spec.ts` | 0 | 110 pasaron y 1 omitida (una prueba de teclado que no aplica al perfil táctil de WebKit) |
| `node supabase/tests/correr-autenticadas.mjs horarios-auth.spec.ts horarios-academicos-auth.spec.ts profesores-auth.spec.ts` | 0 | 62 pasaron |

La suite completa sin filtro con `EPT_CAPTURAS=1` no se corrió, a propósito. La
corrida completa de toda la E2E queda para quien integra el candidato.

---

## 14. Verificación manual

Se revisaron a ojo las capturas generadas de escritorio y de móvil (diálogo de
edición con errores, renombrado con grupos, rechazo por carrera, edición real,
catálogo completo a 375 px): texto en español, sin desbordes, con los motivos
de bloqueo visibles. **No** se hizo una sesión manual interactiva en el
navegador embebido: la interacción real con sesión y base se cubre con las
pruebas autenticadas de Playwright.

---

## 15. Regresiones y hallazgos

- Ninguna prueba anterior cambió de expectativa. Se cuidaron los textos nuevos
  para no chocar con aserciones existentes que buscan por subcadena («Completo»,
  «2 inscripciones», «Grupos deportivos», `/Inscribir/`, `/Cancelar/`).
- **Next.js 405 sin `Allow`.** Next responde 405 a un método no exportado pero sin
  la cabecera `Allow` (verificado en `auto-implement-methods.js`). Para cumplirla se
  agregó `src/lib/metodos-http.ts` y las tres rutas nuevas exportan manejadores
  explícitos para los métodos no admitidos y para `OPTIONS`. Las rutas anteriores no
  se modificaron.
- **Hallazgo en `Input` y `Select` compartidos.** Los componentes calculan un
  `aria-describedby` que une error y ayuda, pero luego vuelcan `{...props}`; si el
  consumidor pasa `aria-describedby`, este pisa al calculado y el campo pierde el
  vínculo con su error. No se corrigió (es compartido); la administración evita
  pasarlo.
- **Hallazgo: `Dialogo`.** El botón de cerrar mide unos 26 px: por debajo de los
  44 px táctiles. No se cambió el componente compartido; los controles propios de
  la administración sí cumplen 44 px en móvil.
- **Hallazgo de pruebas.** `request.newContext()` hereda el `storageState` del
  proyecto: sin `storageState` vacío explícito, un contexto «anónimo» actuaba como
  la directora. La prueba lo declara.
- **Fase A.** No se encontró ningún defecto nuevo.

---

## 16. Archivos

### Nuevos

```
src/app/api/deportes/route.ts
src/app/api/deportes/[id]/route.ts
src/app/api/deportes/grupos/[id]/route.ts
src/app/dashboard/deportes/_components/CatalogoDeportes.tsx
src/app/dashboard/deportes/_components/AccionesGrupo.tsx
src/app/dashboard/deportes/_components/avisos.tsx
src/app/dashboard/deportes/_components/useEnvio.ts
src/lib/deportes-administracion.ts
src/lib/metodos-http.ts
tests/administracion-deportes.spec.ts
tests/administracion-deportes-ui.spec.ts
tests/administracion-deportes-auth.spec.ts
docs/evidence/EPT-61.md y docs/evidence/EPT-61/ (capturas)
```

### Modificados

`src/lib/validations.ts` (esquemas nuevos en la sección de deportes; el cupo y el
profesor del alta se extrajeron a constantes compartidas sin cambiar su
comportamiento), `src/services/deportes.service.ts`,
`src/services/deportes.client.ts`,
`src/app/dashboard/deportes/page.tsx`,
`src/app/dashboard/deportes/_components/GestionDeportes.tsx`,
`src/app/pruebas-ui/deportes/page.banco.tsx`.

### Compartidos con otras historias (verificados, sin cambios)

`PanelDashboard.tsx` y `playwright.config.ts` no se tocaron: el menú ya ofrecía
«Deportes» a director y estudiante, y los archivos nuevos entran por los patrones
existentes. Nada de transporte se modificó.

---

## 17. Commits del candidato

| Hash | Asunto |
|---|---|
| `97626c1` | feat(deportes): administracion de deportes y grupos (EPT-61) — Fase A |
| `73ffe97` | test(deportes): pruebas de administracion de deportes y grupos — Fase A |
| `b9e2361` | feat(deportes): tipos de las operaciones de administracion de deportes — Fase A |
| `c4d0769` | feat(deportes): API y servicio de administracion de deportes y grupos |
| `cce2fbc` | feat(deportes): interfaz de administracion de deportes y grupos en /dashboard/deportes |
| `ffe3db1` | test(deportes): pruebas de interfaz de la administracion con datos deterministas |
| `afd3680` | test(deportes): frontera HTTP sin sesion de la administracion |
| `30d0479` | test(deportes): pruebas con sesion real y base local de la administracion |
| `a371c7b` | fix(deportes): no duplicar el motivo de bloqueo cuando el rechazo del servidor ya lo dice |

El commit de esta evidencia se agrega después.

---

## 18. Capturas

En `docs/evidence/EPT-61/`. Prefijo `fixture-` (banco visual, sin base) y `real-`
(sesión real y base local); `escritorio` es de 1280 px y `movil` de 375 px. Las
de móvil del banco se generan en dos perfiles con el mismo nombre; queda la del
último (iPhone 13).

- Catálogo y grupos completos, con bloqueos y motivos: `fixture-escritorio-catalogo-y-grupos.png`, `fixture-movil-administracion-completa.png`.
- Diálogos: nuevo deporte, nombre repetido, renombrar con grupos, inactivar deporte, editar grupo con validación, reactivar grupo, rechazo por carrera y sesión vencida.
- Estados: vacío y «sin datos de administración».
- Reales: catálogo, deporte creado y repetido, deporte bloqueado por grupos activos, grupo con inscripciones, grupo con deporte inactivo, editar grupo, rechazo por carrera, sesión vencida, vista del alumno sin administración y móvil.

---

## 19. Privacidad y seguridad

- Ninguna credencial se escribió en el repositorio ni en este documento.
- La autorización se aplica en PostgreSQL y otra vez en el servidor
  (`requerirDirector`, con `auth.getUser()`); ocultar controles es solo
  presentación.
- Ningún mensaje al navegador expone SQLSTATE, tablas ni consultas. El rechazo
  por deporte con grupos nombra grupos y niveles del propio catálogo; el rechazo
  por inscripciones informa solo una cantidad, nunca quiénes.
- La forma del cuerpo de cada operación es estricta: no acepta profesor en el
  catálogo, ni deporte o nivel en la edición de un grupo.

---

## 20. Ausencia de eliminación física

No existe `DELETE` en ninguna capa: la base no concede escritura directa, la
migración no agrega funciones de borrado, la API responde 405 con `Allow` a
`DELETE`, y la pantalla no ofrece ningún control de eliminación (se verifica en
las pruebas de fixture y reales). Inactivar es una baja lógica reversible.

---

## 21. Reversión no destructiva

- **Aplicación:** revertir los commits de aplicación (`c4d0769`, `cce2fbc`,
  `a371c7b` y sus pruebas). No requiere tocar la base.
- **Base:** la migración no cambia datos ni triggers; se revierte soltando solo
  las diez funciones nuevas (cinco privadas y cinco públicas), sin tocar ninguna
  fila. Está probado en `deportes_administracion_rls.sql` (comprobaciones J1 y
  J2). Los deportes y grupos creados con la herramienta siguen existiendo como
  datos normales.

---

## 22. Riesgos, trabajo habilitado y retrospectiva

**Riesgos**

- P5974 y P5975 viven en la RPC (sección 7, desvío a): una escritura directa del
  propietario de la base puede saltearlas, como ya ocurría antes con las bajas.
- El botón de cerrar de `Dialogo` no cumple 44 px táctiles (sección 15).
- Los datos de la pantalla son informativos: la base decide con las filas
  bloqueadas, por lo que un rechazo por una carrera es normal y está cubierto.

**Retrospectiva breve:** conviene definir desde el inicio la regla «el texto de
una razón de bloqueo lo arma un solo módulo» (`deportes-administracion.ts`): así
la pantalla, la API y las pruebas no pueden divergir. La parte más costosa fue
compatibilizar los textos nuevos con aserciones antiguas basadas en subcadenas.

**Comentario preparado para Jira (no publicado; a revisar antes de enviarlo):**

> Administración de deportes y grupos dentro de `/dashboard/deportes` para la
> dirección: alta, renombrado, inactivación y reactivación de deportes;
> edición, inactivación y reactivación de grupos con profesor responsable
> obligatorio por grupo. Las reglas (deporte con grupos activos, grupo con
> inscripciones, cupo, profesor activo, renombrado con grupos) las decide
> PostgreSQL y la pantalla las anticipa con el motivo visible. Sin borrado
> físico ni historial nuevo; DELETE responde 405. El estudiante conserva su
> vista. Pruebas de base, servidor y navegador (escritorio, Pixel 5 e iPhone 13)
> y regresión sobre horarios, profesores y transporte. Candidato en la rama
> `codex/ept-61-admin-deportes`, sin push, sin PR.

**Recomendación de transición:** el candidato está listo para revisión de
código. No se movió el estado en Jira desde esta sesión; queda a criterio de
quien revise pasar EPT-61 de **Por hacer** a **En progreso** o a
**En revisión**.
