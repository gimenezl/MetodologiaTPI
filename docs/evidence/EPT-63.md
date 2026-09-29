# EPT-63 — RF17: Generar los reportes oficiales de la Dirección

El paquete original se integró a `origin/main` mediante el PR #22 (merge
`6673d747`). La corrección del rótulo de búsqueda de docentes está en la rama
`codex/ept-63-legajo-label`, basada en ese merge: **pendiente de integrar y
desplegar**. No se verificó el estado de producción ni se ejecutaron pruebas
productivas para esta corrección; las pruebas y mediciones históricas de este
documento corresponden al candidato original en un entorno local aislado. El
estado actual de Jira también requiere una consulta nueva antes de actualizarlo.

La base histórica del candidato original fue `origin/main` =
`50bef50cc0afb79274849ef179261efce3397f28`; su rama fue
`codex/ept-63-reportes-oficiales`.

---

## 1. Resumen ejecutivo

Seis reportes oficiales para Dirección, cada uno con su **grano declarado**, filtros
**combinables aplicados por el servidor** y tres entregas: pantalla responsive,
**CSV completo** e **impresión/PDF del navegador**. No son nueve listados aislados:
los seis admiten los mismos filtros y los cruzan por semiunión (`EXISTS`), de modo
que un alumno con varias materias, deportes y franjas **nunca se multiplica**.

| Reporte | Una fila es… | Historial |
|---|---|---|
| Alumnos por curso y nivel | una matrícula (alumno × curso × período) | sí: matrículas cerradas con fecha y motivo |
| Alumnos por materia | una matrícula vigente × una materia del curso | no |
| Alumnos por deporte | una inscripción deportiva | sí: canceladas con fecha |
| Alumnos por horario | un alumno × una franja semanal, con su **origen** | no |
| Alumnos por recorrido | una inscripción a un recorrido de transporte | sí: canceladas con fecha |
| Docentes por nivel | un docente × una asignación vigente, con su **origen** | no |

Cada reporte tarda **menos de 1 s en pantalla** y el peor CSV completo (78 800 filas)
**10,5 s** (mediana; máximo 11,4 s) frente al límite de 60 s (sección 8).

---

## 2. Fuentes y contradicciones

| Fuente | Qué dice | Coincide |
|---|---|---|
| PDF aprobado (`PlanTrabajo_Grupo12_SistemaGestion (1).pdf`) RF17 y módulo de Reportes | «listados definidos por la Dirección por alumno, docente, curso, materia, deporte, nivel, horario, responsable y recorrido»; «listados cruzados de alumnos por curso, materia, deporte, nivel, horario y recorrido de transporte, y de docentes por nivel» | sí |
| Jira EPT-63 (leída de nuevo: «Por hacer», hija de EPT-7, Lucas Gimenez, sin subtareas) | mismos listados + «responsable», «menos de un minuto» y «las mismas relaciones que usan las operaciones diarias» | sí |
| Contrato aprobado por Lucas | cruces, «responsable» = profesor, origen académico/deportivo sin mezclar, materia derivada del curso, filtros en servidor, historial solo si el esquema lo registra, exclusividad de Dirección, `confirmada_por` fuera, CSV + impresión, 60 s con más de 1000 filas | sí |
| Git | `origin/main` = 50bef50 = línea base informada | sí |

No hubo contradicción material: no se detuvo el trabajo ni se redujo ningún requisito.

---

## 3. Matriz criterio → consulta o pantalla → prueba → evidencia

| # | Criterio (PDF / Jira / contrato) | Consulta o pantalla | Prueba | Evidencia |
|---|---|---|---|---|
| 1 | Alumnos por curso | `reporte_alumnos_curso` · `/dashboard/reportes/alumnos-por-curso` | SQL B1, D1; E2E «los seis reportes devuelven el total exacto» | sección 9, capturas |
| 2 | Alumnos por materia (derivada del curso, sin inscripción individual) | `reporte_alumnos_materia` | SQL B2; E2E «alumno × materia se deriva del curso» | sección 9 |
| 3 | Alumnos por deporte | `reporte_alumnos_deporte` | SQL B3, C3 | sección 9 |
| 4 | Alumnos por nivel | filtro `nivel` en todos; grano propio en el curso | SQL B1, C1 | sección 9 |
| 5 | Alumnos por horario, origen sin mezclar | `reporte_alumnos_horario` (columna `origen`) | SQL B4, E3, E4 | sección 9 |
| 6 | Alumnos por recorrido | `reporte_alumnos_recorrido` (solo TRANSPORTE) | SQL B5 | sección 9 |
| 7 | Docentes por nivel, ambos orígenes | `reporte_docentes_nivel` | SQL B6, E1, E2; E2E «docente con asignación académica y deportiva» | sección 9 |
| 8 | «Responsable» = PROFESOR, no tutor | columnas y filtro «Profesor responsable» | SQL B7; unitaria «el responsable es el profesor» | sección 9 |
| 9 | Cruces sin producto cartesiano | semiunión `app_private.reporte_alumnos_filtrados` | SQL C1, C2; E2E cruce de cuatro dimensiones vs oráculo | sección 9 |
| 10 | Filtros combinables en el servidor | formulario `GET` + parámetros de las funciones | unitarias `leerFiltros`, `argumentosRpc`; E2E filtros | sección 9 |
| 11 | Por defecto solo vigente; historial opt-in donde el esquema lo registra | `p_incluir_historial` solo en 3 reportes | SQL D1–D4; unitaria «el historial se ofrece solo donde…»; E2E `historial` rechazado con 400 | secciones 5 y 9 |
| 12 | No presentar historia no registrada | la pantalla explica por qué no hay historial | E2E «se explican» | captura del reporte de materias |
| 13 | Solo Dirección: sesión + rol + PostgreSQL | `requerirDirector` + `exigir_director_reporte` | SQL A1–A4; E2E 6 actores × API/pantalla/RPC directo | sección 6 |
| 14 | `confirmada_por` y variantes fuera de TODAS las superficies | reportes no leen las vistas de EPT-62 | SQL F1, F2; E2E privacidad con confirmación real; unitaria de columnas | sección 7 |
| 15 | Pantalla responsive | tabla ≥1280 px, tarjetas debajo | E2E 375 px y 1280 px sin scroll horizontal | capturas |
| 16 | CSV completo, legible, escapado, sin fórmulas | `/api/reportes/[reporte]/exportar` | unitarias `celdaCsv`; E2E CSV 78 800 y 36 000 filas, nombres hostiles | sección 9 |
| 17 | Impresión/PDF del navegador con título, fecha y filtros | `/imprimir` + `print:` | E2E impresión + `page.pdf()` | captura de impresión |
| 18 | Ninguna lectura se trunca al límite de 1000 filas ni omite o repite filas si los datos cambian a mitad de la lectura | `leerTodasLasFilasEnParalelo` (páginas solapadas en una fila, frontera verificada) | unitarias (32 con la secuencial, incluidas 500 escenarios aleatorios de altas y bajas); E2E totales exactos | secciones 8 y 9 |
| 19 | Menos de 60 s por reporte con más de 1000 filas por dominio | funciones + lectura paralela | `reportes-rendimiento-auth.spec.ts` | sección 8 |
| 20 | Interfaz en español, accesible | textos, etiquetas, foco, `role=status/alert` | E2E accesibilidad, sin detalle técnico | sección 10 |
| 21 | Errores reales (401/403/400/404/405/500) | API y pantallas | `reportes.spec.ts`; E2E privilegio retirado | sección 9 |

---

## 4. Decisiones

1. **Seis reportes con grano declarado + filtros cruzados por semiunión**, en lugar de
   nueve listados. La semiunión (`EXISTS`) filtra alumnos sin multiplicar filas.
   Un filtro cuya dimensión es del grano acota filas; los demás seleccionan alumnos
   por su situación vigente (tabla en la cabecera de la migración y en cada pantalla).
2. **Funciones RPC `SECURITY INVOKER` y no vistas.** Los cruces no se expresan con
   filtros de PostgREST sobre una vista. Se conserva RLS y se agrega el predicado
   de Dirección explícito (sección 6).
3. **No se reutilizan las vistas de EPT-62.** Unen `confirmaciones_inscripcion` y
   exponen `confirmada_por_*`. Los reportes leen las **mismas tablas base** sin esa
   unión (además, un `LEFT JOIN` sobre un índice parcial no se elimina del plan).
4. **Materia derivada del curso.** No hay inscripción individual por materia.
5. **Historial solo donde hay fechas registradas** (matrículas, inscripciones
   deportivas y de transporte). `materias_cursos` y `grupos_deportivos` guardan solo
   `activo` y el responsable actual: ahí el parámetro **no existe** y la pantalla lo
   explica. En el historial deportivo el responsable es el **actual** del grupo, no el
   de la fecha de la inscripción; se dice en pantalla.
6. **CSV con `;`, BOM UTF-8 y CRLF.** Con «,» una planilla en español de Argentina
   abre cada fila en una sola columna. Compromiso: un consumidor que espere «,» debe
   indicar el separador. Escape RFC 4180 y neutralización de fórmulas (`=`, `+`, `-`,
   `@`, tabulación, retorno de carro, aun con espacios delante).
7. **Exportación con `fetch`, no con un enlace.** Un enlace a un error descargaría un
   archivo con el mensaje de error; así solo se guarda una respuesta correcta.
8. **Lectura completa o error.** El CSV se arma después de leer todo: nunca un
   archivo cortado que parezca completo. Impresión: máximo 10 000 filas, con mensaje
   y total exacto por encima (no recorte silencioso).
9. **Lectura paralela.** Ver sección 8: bajó el peor caso de 37 s a 12 s.
10. **Sin índices ni vistas nuevas.** Los planes usan los índices existentes donde
    hay un filtro selectivo y recorren la relación completa donde el reporte la
    necesita entera (sección 8). Un índice nuevo no reduce esas lecturas.
11. **Rechazo de Dirección distinguido de otros `42501`.** Un privilegio de tabla
    retirado devuelve 500 con mensaje genérico, no «solo Dirección puede…».

---

## 5. Diagrama de relaciones

```
perfiles ─┬─ alumnos ── matriculas ── cursos ── niveles
          │               │  (vigente: fecha_cierre IS NULL)
          │               └─ materias_cursos ── actividades (CURRICULAR)
          │                        │  profesor_id → perfiles (responsable)
          │                        └─ materias_cursos_horarios ── horarios
          ├─ alumnos ── inscripciones_deportivas ── grupos_deportivos ── deportes
          │                        (ACTIVA)              │ profesor_id → perfiles
          │                                              └─ grupos_deportivos_horarios ── horarios
          ├─ alumnos ── inscripciones_servicios ── servicios_escolares (TRANSPORTE) ── paradas_recorrido
          └─ profesores (ficha: especialidad, estado)

reporte_alumnos_curso     : matriculas
reporte_alumnos_materia   : matriculas(vigente) × materias_cursos(activa)
reporte_alumnos_deporte   : inscripciones_deportivas
reporte_alumnos_horario   : [matriculas × materias_cursos × franjas]  UNION ALL  [inscripciones × grupos × franjas]
reporte_alumnos_recorrido : inscripciones_servicios(TRANSPORTE)
reporte_docentes_nivel    : [materias_cursos]  UNION ALL  [grupos_deportivos]
```

Granularidad: cada `UNION ALL` es entre orígenes **distintos** con columnas propias
(`curso` solo académico, `grupo` solo deportivo); nunca se une una franja académica
con una deportiva. Un docente en ambos orígenes del mismo nivel aparece una vez por
asignación (probado con datos: 3 académicas + 1 deportiva = 4 filas, sin repetidas).

---

## 6. Seguridad y permisos

Dos fronteras: (1) sesión y rol DIRECTOR en el servidor/API; (2) PostgreSQL.

- Las siete funciones públicas y los tres auxiliares son `SECURITY INVOKER`, `STABLE`,
  `search_path` vacío. `EXECUTE` solo para `authenticated` (revocado a `PUBLIC`,
  `anon` y `service_role`). Ninguna recibe actor, rol ni perfil.
- **`security_invoker` por sí solo NO prueba exclusividad**: `cursos`, `niveles`,
  `horarios`, `deportes` y `servicios_escolares` admiten `SELECT` a cualquier sesión
  autenticada y un alumno lee sus propias filas. Por eso cada función exige
  `public.es_director_actual()` **antes de leer nada**: identidad ausente → `P5505`,
  no Dirección o bloqueada → `42501`.
- La mutación de prueba lo demuestra: anulada la guardia, un estudiante obtuvo datos
  (RLS solo le limitaba a su fila) y la batería falló.
- No se usa `service_role` en la aplicación. La API responde 401/403/400/404/405/413/
  409/500 con `Cache-Control: no-store` y mensajes en español sin detalle técnico.
- Pruebas: 7 funciones × 7 actores no autorizados (estudiante propio y ajeno, padre,
  docente responsable, personal, dirección bloqueada, cuenta sin perfil) → `42501`;
  sin identidad → `P5505`; `anon` → `42501`. En E2E, con **sesión real** de cada rol y
  llamando a PostgREST directamente: las 7 funciones dan `42501` y las vistas de EPT-62
  siguen devolviendo 0 filas. La batería de permisos de EPT-59 cubre ahora 73 envoltorios
  (las 7 nuevas incluidas) y pasó sin recursión (`42P17`).

Privilegios de las tablas de origen: sin cambios; la migración no concede nada y su
autoverificación comprueba que `anon`/`authenticated` no tienen escritura sobre las
cinco tablas de origen.

---

## 7. Privacidad

- Ninguna columna, argumento ni texto de los reportes alude a `confirmada_por`, a
  ningún nombre o identificador del confirmador ni a la marca de confirmación. Ni
  DNI, teléfono, domicilio o fecha de nacimiento.
- Prueba SQL F1 (firmas de las funciones) y F2 (con una confirmación real registrada,
  ni las filas ni los catálogos de los seis reportes contienen al confirmador).
- E2E: con una confirmación real, API y CSV de los seis reportes no contienen su
  apellido ni la cadena «confirm»; el alumno confirmado **sí** figura (la prueba no
  es vacía).
- Unitaria: una fila con `confirmada_por_*` inyectado no lo muestra, porque solo salen
  las columnas declaradas.

---

## 8. Rendimiento

**Datos:** sintéticos, deterministas, **solo en la base local descartable**
(`supabase/tests/reportes_benchmark_datos.sql`; retiro con
`reportes_benchmark_limpieza.sql`). Nunca se sembró ni se probó carga en producción.

| Dominio | Filas |
|---|---|
| matrículas vigentes / con historial | 3 003 / 4 203 |
| alumno × materia | 36 000 |
| inscripciones deportivas activas / con historial | 3 400 / 4 200 |
| alumno × franja (académicas + deportivas) | 78 800 |
| transporte activo / con historial | 2 500 / 3 000 |
| docente × asignación | 1 379 |

**Entorno:** Windows 10, Intel Core i5-14400F (16 hilos), 32 GiB; PostgreSQL 17.6 en
Docker; Node 24.19; Next.js 16.3.3 en modo **producción** (`next build` + `next start`);
sesión real de Dirección; 5 repeticiones. Archivo: `docs/evidence/EPT-63/mediciones.json`.

**Extremo a extremo** (ms, mediana / máximo de 5; cada repetición exigida < 60 000):

| Reporte | Pantalla (100 filas) | Cruce | CSV completo | Impresión |
|---|---|---|---|---|
| alumnos por curso | 310 / 469 | 278 / 289 | 168 / 204 (3 003 filas) | 1 745 / 1 872 (3 003 filas) |
| alumnos por materia | 686 / 722 | 278 / 303 | 2 377 / 2 407 (36 000 filas) | rechazada por el máximo (647) |
| alumnos por deporte | 266 / 480 | 293 / 322 | 211 / 247 (3 400 filas) | 2 507 / 2 615 (3 400 filas) |
| alumnos por horario | 536 / 845 | 264 / 291 | **10 499 / 11 410** (78 800 filas, 9,1 MiB) | rechazada por el máximo (524) |
| alumnos por recorrido | 312 / 477 | 272 / 293 | 169 / 195 (2 500 filas) | 1 710 / 1 845 (2 500 filas) |
| docentes por nivel | 304 / 763 | 268 / 293 | 107 / 123 (1 379 filas) | 741 / 753 (1 379 filas) |

«Pantalla» incluye consulta, servidor de Next, HTML y representación hasta que la
tabla y el total son visibles. El CSV se verifica contra el archivo recibido (filas =
`X-Total-Filas` + encabezado). Peor caso: **11,4 s < 60 s**. Mediciones repetidas tras la
corrección de la sección 9.2 (5 repeticiones, `next build` + `next start`, declarado en
`mediciones.json`); los números anteriores (12,3 s / 12,9 s) eran del lector previo.
La siembra de 78 800 filas y todas las mediciones son locales; nunca se hicieron en
producción.

Distinción de tiempos: «pantalla» = extremo a extremo hasta ver la tabla; «cruce» =
pantalla con cuatro filtros; «CSV» = descarga completa con el archivo verificado;
«impresión» = vista imprimible completa. El tiempo de SQL puro está aparte
(`tiempos-sql.txt`).

**Hallazgo y corrección.** La primera medición dio 37 s (mediana; 50 s en frío) para el
CSV de horarios: cada página con orden total resuelve y ordena el conjunto (≈0,5 s) y
había 79 páginas en serie. Se implementó `leerTodasLasFilasEnParalelo`
(4 páginas a la vez). Bajó a 12 s. La revisión independiente demostró que esa primera
versión comprobaba solo cantidades y podía entregar filas omitidas con el mismo total
(sección 9.2); la versión final solapa las páginas en una fila y verifica cada frontera
(10,5 s). El primer intento con `work_mem` mayor no cambió nada y se descartó.

**SQL** (`tiempos-sql.txt`, RLS activo): páginas de 1000 filas entre 8 ms (docentes) y
261 ms (horarios); página profunda de horarios (offset 77 000) 481 ms.

**Planes** (`planes-consultas.txt`, EXPLAIN ANALYZE real vía `auto_explain`): los
filtros selectivos usan `idx_inscripciones_deportivas_alumno`,
`idx_matriculas_una_activa_por_alumno`, `idx_materias_cursos_curso` y las claves
primarias (cruce de cuatro dimensiones: 10,7 ms). Sin filtro, los reportes necesitan
la relación entera y `Seq Scan` sobre tablas de miles de filas es el plan correcto.
El único costo notable es el `Sort` externo de horarios (18 MB). **Riesgo:** los
filtros de RLS llevan a estimaciones de 1 fila y a bucles anidados; con un volumen
muy superior conviene revisar estadísticas.

**Advisors** (`advisors-*.json`) y `supabase db lint`: 0 hallazgos sobre objetos de
EPT-63 (10 preexistentes, ajenos: `calcular_porcentaje_asistencia`,
`verificar_cupo_actividad`, políticas de `postulaciones`/`solicitudes_inscripcion`,
`perfiles`, `asistencias`, `inscripciones`, `inscripciones_servicios`). Complementan
los planes; no los reemplazan.

---

## 9. Resultados de verificación

Ejecutadas contra un stack local **aislado** (`project_id` `ept63`, puertos 55xxx):
otros checkouts usan el stack compartido y un `db reset` allí les habría borrado
datos. Se añadió `EPT_SUPABASE_WORKDIR` a `correr-autenticadas.mjs` y
`tipos-generados.mjs` (sin la variable, el comportamiento no cambia).

| Comprobación | Resultado |
|---|---|
| Reset completo de migraciones (24) y lista | aplicadas sin error; la nueva es `20260929012923_ept_63_reportes_oficiales` |
| Tipos generados (CLI 2.117.0 fijada) | dos generaciones idénticas, coincide byte a byte; diff solo agrega 194 líneas |
| `supabase db lint` | «No schema errors found» |
| Advisors seguridad y rendimiento | 0 hallazgos de EPT-63 |
| `reportes_oficiales_rls.sql` | 31 comprobaciones OK (agrega R1, la reversión), exit 0 |
| Mutación: guardia de Dirección anulada | la prueba falla (estudiante obtiene datos) |
| Resto de pruebas SQL del repo (cursos, niveles, alumnos, materias, comedor, deportes, horarios, horarios académicos, hijos, perfiles, profesores, transporte, deportes-admin, inscripciones-admin, alta atómica, reconciliación, preflight) | exit 0 |
| Batería EPT-59 (`usuarios_permisos_rls.sql`, como `supabase_admin`) | exit 0; cubre 73 envoltorios; sin `42P17` |
| `tests/reportes-lib.spec.ts` | 60 pasan (8 casos nuevos de fórmulas con prefijos invisibles) |
| `tests/paginacion.spec.ts` + `paginacion-paralela.spec.ts` | 32 pasan (incluye la baja+alta con el mismo total y 500 escenarios aleatorios) |
| `reportes-auth.spec.ts` DIRECTOR (con más de 1000 filas por dominio) | 44 pasan (incluye el setup) |
| `reportes-auth.spec.ts` (todos los actores) + `reportes.spec.ts` + `reportes-lib.spec.ts` | 123 pasan, 1 omitida (el menú no aplica a un bloqueado), sobre la base «sucia» de la suite completa |
| `reportes-rendimiento-auth.spec.ts` (`EPT_BENCH=1`, producción) | 27 pasan; todo < 60 s (peor CSV 11,4 s) |
| `git diff --check` | sin salida |
| `npx tsc --noEmit --incremental false` | exit 0 |
| ESLint focalizado en los archivos nuevos | 0 errores, 0 advertencias |
| `npm run lint -- --no-cache` | exit 1 por **14 errores preexistentes** en archivos que EPT-63 no toca (`noticias`, `quienes-somos`, `asistencias`, `solicitudes`, `testimonios`, `global-error`, `login`); ningún hallazgo en archivos de EPT-63 |
| `npm run build` | exit 0 (las tres rutas nuevas figuran) |
| Suite E2E completa | ver sección 9.1 |

### 9.1 Suite E2E completa

`node supabase/tests/correr-autenticadas.mjs` (todos los proyectos: escritorio,
Pixel 5, iPhone 13 y una sesión por rol), contra un stack aislado **creado desde
cero** para la revisión (`project_id` `ept63rev`, 24 migraciones aplicadas sin error),
sobre el HEAD final: **1285 pasaron, 11 omitidas, 0 fallaron, exit 0** (19,7 min).

Historia honesta: en la revisión, la corrida completa anterior a la última corrección
falló una vez en «375 px» (desborde de 4 px en los filtros de «alumnos por curso»); se
corrigió (`grid-cols-1` explícito y `min-w-0`) y la corrida completa posterior pasó
sin fallos. Las capturas de EPT-13 que la suite regenera se restauraron con
`git checkout` para no mezclar evidencia ajena.

**Las 11 omitidas, una por una** (ninguna debía haber corrido en esta suite):

| # | Prueba | Motivo |
|---|---|---|
| 1 | `inscripciones-administracion-ui` «objetivos táctiles… en móvil» (chromium) | `test.skip(!esMovil)`: solo aplica a los perfiles móviles |
| 2 | `comedor-ui` «se opera con el teclado» (iPhone 13) | el perfil táctil de WebKit no expone teclado físico |
| 3 | `inscripciones-administracion-ui` «se opera con el teclado» (iPhone 13) | ídem |
| 4 | `transporte-ui` «se opera con el teclado» (iPhone 13) | ídem |
| 5–10 | `reportes-rendimiento-auth` (6 reportes) | `EPT_BENCH` no está definida: son mediciones y se corren aparte (27 pasan, sección 8) |
| 11 | `reportes-auth` «el menú no ofrece Reportes» (director bloqueado) | un perfil bloqueado no llega al panel; la ausencia de acceso se prueba en las otras tres pruebas del mismo actor |

---

### 9.2 Revisión independiente y correcciones

Revisión de todos los cambios de la rama contra el contrato aprobado, sin apoyarse en el
informe previo. Defectos candidato-causados encontrados y corregidos en la misma rama:

| # | Severidad | Hallazgo | Corrección | Prueba |
|---|---|---|---|---|
| 1 | **Alta** (completitud) | `leerTodasLasFilasEnParalelo` comprobaba solo cantidades. Una baja en una página ya leída y un alta al final dejan el total igual y corren un lugar las filas siguientes: el CSV/impresión podía omitir una fila y repetir otra con el mismo total. Reproducido: 317 de 500 escenarios daban un listado incompleto con `ok: true` | páginas solapadas en una fila y frontera verificada; sin tope propio se usa el observado; sin total utilizable falla (`src/lib/paginacion.ts`) | `paginacion-paralela.spec.ts`: caso determinista y 500 escenarios aleatorios (fallaban antes, pasan después) |
| 2 | Media (seguridad) | El CSV no neutralizaba fórmulas con prefijos de control o invisibles (`\x01=…`, `U+200B=…`) | patrón Unicode `[\s\p{Cc}\p{Cf}\p{Z}]` (`src/lib/reportes.ts`) | 8 casos en `reportes-lib.spec.ts` |
| 3 | Media (requisito) | Impresión de más de 10 000 filas: solo un texto genérico «No pudimos cargar el reporte»; sin filtros aplicados ni forma de bajar el CSV | `PanelImpresionExcedida`: total, filtros y botón «Exportar CSV» | E2E «impresión… más filas que el máximo imprimible» |
| 4 | Media (aislamiento) | Con `EPT_SUPABASE_WORKDIR` la API apuntaba al stack aislado pero los `psql` de siembra y limpieza usaban por defecto el contenedor del stack **compartido** | el arnés deduce el contenedor del `project_id` y exige que publique el mismo puerto de base que la API; si no, no corre (`correr-autenticadas.mjs`) | negativa (contenedor equivocado) y positiva verificadas a mano |
| 5 | Baja (evidencia) | Dos capturas mostraban «Cargando…»; el benchmark declaraba «desarrollo» por omitir `EPT_BENCH_MODO` | la prueba espera el contenido; capturas y mediciones regeneradas | capturas revisadas |
| 6 | Baja (UI) | Los filtros desbordaban 4 px a 375 px en la corrida completa | `grid-cols-1` y `min-w-0` | E2E 375 px |
| 7 | Baja (prueba) | La reversión no tenía prueba propia | sección R1 de `reportes_oficiales_rls.sql`; con un `DROP` de menos falla | SQL |

**Aclaración del conteo.** La migración crea **10 funciones**: 7 públicas (6 reportes y
el catálogo) y 3 privadas. Los 10 `DROP` documentados las sueltan exactamente, sin tocar
objetos previos ni dejar nuevos (verificado ejecutándolos en una transacción con
`ROLLBACK` y con la prueba R1). No existe ninguna afirmación de «9 funciones» en el
repositorio.

**Verificado sin hallazgos:** funciones `SECURITY INVOKER` (no hay `SECURITY DEFINER`
nuevo) con `search_path` vacío, `EXECUTE` solo para `authenticated`, Dirección exigida
por `es_director_actual()` (rol DIRECTOR y acceso HABILITADO); 7 actores rechazados con
`42501` (anónimo, estudiante, docente, padre, personal, dirección bloqueada, sin perfil),
en SQL y por PostgREST con sesión real; sin escrituras; `confirmada_por` y variantes
ausentes de columnas, tipos, API, CSV, impresión y capturas; «responsable» es el
profesor; sin SQL dinámico con valores del llamador; separador `;` documentado, BOM y
CRLF; `db lint` sin errores y 0 hallazgos de los advisors sobre objetos de EPT-63.
Una revisión fresca del delta posterior a la corrección no halló defectos altos ni
medios.

### 9.3 Corrección posterior al merge #22 (pendiente de integrar)

`reporte_docentes_nivel` compara `p.apellido` y `p.nombre`, incluida la combinación
de ambos, pero no `legajo_nro`. El formulario ahora muestra «Buscar por nombre o
apellido» solo en docentes; los cinco reportes de alumnos conservan «Buscar por
nombre, apellido o legajo». La migración y el comportamiento de búsqueda no cambian.

| Comprobación local de esta corrección | Resultado |
|---|---|
| `npm run test:e2e -- tests/reportes-lib.spec.ts --project=chromium --reporter=line` | 61 pasan, exit 0; incluye el contrato de etiquetas para los seis reportes |
| `npx tsc --noEmit --incremental false` | exit 0 |
| `npx eslint src/lib/reportes.ts src/app/dashboard/reportes/_components/FormularioFiltros.tsx tests/reportes-lib.spec.ts tests/reportes-auth.spec.ts --no-cache` | exit 0 |
| `npm run build` con las variables públicas de Supabase de relleno del arnés | exit 0; sin variables, el prerender falla por configuración faltante, no por esta corrección |

La aserción de accesibilidad en `reportes-auth.spec.ts` también verifica el rótulo
renderizado de docentes, pero no se ejecutó en esta corrección porque requiere el
stack local aislado y sesiones autenticadas. No se ejecutaron pruebas ni consultas
contra producción. Quedan pendientes merge, despliegue y verificación productiva.

---

## 10. Interfaz y accesibilidad

Todo el texto visible, las etiquetas, los estados (carga, vacío, error, éxito) y el
texto de accesibilidad están en español. Verificado con sesión real:

- Filtros con `<label>`, foco visible, aplicación con teclado (Enter sobre «Aplicar
  filtros»), `aria-current="page"` en la paginación por enlaces, `role="status"` con
  el total («Mostrando 1 a 50 de 3.003 filas») y `role="alert"` en los errores.
- 1280 px: tabla de cada reporte sin scroll horizontal. 375 px: una tarjeta por fila,
  sin scroll horizontal (reportes, índice y vista imprimible).
- Sin controles anidados y sin detalle técnico visible (SQLSTATE, tablas, SQL).
- Impresión: `A4` apaisado, encabezado de columnas repetido, filas sin partirse, sin
  menú ni encabezado del panel; `page.pdf()` produce un PDF válido.

Capturas **reales** (sesión de Dirección, base local con los datos sintéticos de la
sección 8; no son fixtures ni prueban persistencia en producción):
`docs/evidence/EPT-63/capturas/` — índice, alumnos por curso, filtros cruzados,
alumnos por horario, docentes por nivel, estado vacío, error de lectura, error de
exportación, exportación lista, impresión (escritorio) y móvil (índice y horarios).
No se regeneraron las capturas de otras historias.

---

## 11. Riesgos y deuda

1. **Historial no verificable** de asignaciones, franjas y responsables: el esquema
   no lo registra. Habilitarlo exige un historial propio (fuera de alcance).
2. **Separador «;» del CSV**: decisión de usabilidad para planillas en español.
3. **Volumen mucho mayor**: las estimaciones de filas con RLS son pobres (sección 8);
   si el colegio creciera órdenes de magnitud convendría revisar estadísticas o
   materializar. Con el volumen medido hay 4× de margen sobre el límite.
4. **Concurrencia con altas**: no hay instantánea entre páginas (cada página es una
   consulta propia). La lectura garantiza que toda fila que existió durante TODA la
   lectura, con su clave de orden sin cambios, aparece exactamente una vez; ante
   cualquier corrimiento se reintenta una vez y luego se informa (409). Las filas que
   se dan de alta o de baja mientras se lee pueden o no figurar, como en cualquier
   lectura confirmada.
8. **Memoria y duración**: el CSV y la impresión se arman en memoria (un objeto por fila)
   y el tope es de 500 000 filas; con el volumen medido (78 800) el archivo pesa 9,1 MiB
   y tarda ~11 s. No se fijó `maxDuration` de la ruta: conviene comprobar el límite del
   plan de despliegue con datos reales tras desplegar (no se siembra producción).
4. **Búsqueda de docentes**: la consulta solo compara nombre y apellido, no legajo.
   La rama `codex/ept-63-legajo-label` corrige el rótulo a «Buscar por nombre o
   apellido» y mantiene «Buscar por nombre, apellido o legajo» en alumnos. La
   corrección está pendiente de integración y despliegue; no está verificada en
   producción.
5. **Un stack compartido** entre checkouts sigue siendo frágil (`db reset` ajeno).
6. La descarga con `fetch` requiere JavaScript (el panel ya lo requiere).
7. Preexistente: 14 errores de ESLint en archivos ajenos (no se tocaron).

---

## 12. Reversión

La migración es aditiva y no toca filas ni tablas. Crea **10 funciones** (7 públicas y
3 privadas) y los 10 `DROP` de abajo las sueltan exactamente: la sección R de
`reportes_oficiales_rls.sql` los ejecuta literalmente y comprueba que no cambia ninguna
fila, que no queda ninguna función de reportes y que no se pierde ninguna función previa
(con una mutación, un `DROP` de menos, la prueba falla). Revertir el comportamiento sin
perder datos:

```sql
DROP FUNCTION public.catalogos_reportes();
DROP FUNCTION public.reporte_docentes_nivel(text, integer, uuid, integer, uuid, uuid, uuid, text, integer, integer);
DROP FUNCTION public.reporte_alumnos_recorrido(text, integer, uuid, integer, uuid, uuid, uuid, uuid, boolean, integer, integer);
DROP FUNCTION public.reporte_alumnos_horario(text, integer, uuid, integer, uuid, uuid, uuid, uuid, text, integer, integer);
DROP FUNCTION public.reporte_alumnos_deporte(text, integer, uuid, integer, uuid, uuid, uuid, uuid, boolean, integer, integer);
DROP FUNCTION public.reporte_alumnos_materia(text, integer, uuid, integer, uuid, uuid, uuid, uuid, integer, integer);
DROP FUNCTION public.reporte_alumnos_curso(text, integer, uuid, integer, uuid, uuid, uuid, uuid, boolean, integer, integer);
DROP FUNCTION app_private.reporte_alumnos_filtrados(text, integer, uuid, integer, uuid, uuid, uuid, uuid);
DROP FUNCTION app_private.preparar_reporte(text, integer, integer, text);
DROP FUNCTION app_private.exigir_director_reporte();
```

En la aplicación basta revertir los commits (rutas `/dashboard/reportes` y
`/api/reportes`, ítem del menú y clases `print:` del panel). No hay datos que
migrar. Si se revierte solo la aplicación, las funciones quedan inertes.

---

## 13. Comandos reproducibles

```bash
# Stack aislado y reset (desde un directorio con su propio supabase/config.toml).
# correr-autenticadas.mjs deduce el contenedor de psql del project_id y se niega a
# correr si no publica el mismo puerto de base que la API.
npx supabase start -x studio,realtime,storage-api,imgproxy,edge-runtime,logflare,vector,postgres-meta
npx supabase db reset --local
# Pruebas SQL (cada una imprime OK/FALLO)
docker exec -i <db> psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -f supabase/tests/reportes_oficiales_rls.sql
# E2E completas contra el stack aislado
EPT_SUPABASE_WORKDIR=<dir> EPT_TEST_SMTP_PORT=<puerto smtp del stack> node supabase/tests/correr-autenticadas.mjs
# Medición (modo producción)
npm run build && npx next start -p 3000
EPT_BENCH_MODO="producción (next build + next start)" EPT_BENCH=1 EPT_SUPABASE_WORKDIR=<dir> node supabase/tests/correr-autenticadas.mjs tests/reportes-rendimiento-auth.spec.ts --project=setup --project=chromium-directora
```

---

## 14. Textos de entrega originales (históricos)

Los textos siguientes describen la entrega original antes del PR #22; no deben
usarse como declaración del estado actual de producción, Jira o esta corrección.

### Comentario de Jira (EPT-63)

Implementé RF17 en la rama `codex/ept-63-reportes-oficiales`; revisión independiente hecha (docs/evidence/EPT-63.md, sección 9.2). Seis
reportes con grano declarado y filtros cruzados aplicados por el servidor; CSV
completo e impresión/PDF del navegador; solo Dirección, con exigencia repetida en
PostgreSQL. `confirmada_por` no aparece en ninguna superficie. Con más de 1000 filas
por dominio, el peor CSV completo (78 800 filas) tarda 11,4 s y ninguna medición
supera 60 s. La migración NO fue aplicada en producción. Evidencia: `docs/evidence/EPT-63.md`.

### Descripción del PR

**Qué cambia.** Reportes oficiales de Dirección (RF17): siete funciones de solo
lectura `SECURITY INVOKER` con Dirección explícita, API JSON y CSV, pantallas con
filtros, paginación, exportación e impresión, y lector paginado en paralelo con
completitud verificada.

**Cómo se probó.** Ver sección 9 de `docs/evidence/EPT-63.md`.

**Riesgos y reversión.** Secciones 11 y 12. La migración es aditiva.

**Fuera de alcance.** EPT-64 a EPT-68 y EPT-62.
