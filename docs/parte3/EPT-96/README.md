# EPT-96 — Prototipo navegable de la aplicación móvil

Prototipo local, recorrible en un navegador, de los flujos económicos de Parte 3: cuotas, selección y pago de ítems, carga de comprobantes e información por rol. Reutiliza la identidad, la estructura y los datos ficticios de EPT-95 (`docs/parte3/EPT-95/`, que permanece intacto). **No es la aplicación Expo** (EPT-102) ni el catálogo de componentes (EPT-99).

> Prototipo — datos y operaciones simulados. Sin autenticación real, sin Supabase, sin Storage, sin correo ni pagos reales. Ningún archivo se lee, envía ni persiste.

## Cómo abrirlo

Requisitos: Node 22 o superior. No necesita `npm ci` para abrir el prototipo.

```bash
node docs/parte3/EPT-96/servidor/servidor.mjs
```

Abrir <http://127.0.0.1:4196/> (se puede cambiar con `--puerto 4300`). Para empezar, elegir una cuenta de ejemplo en la pantalla de ingreso; el prototipo no recibe contraseñas.

| Cuenta de ejemplo | Qué muestra |
|---|---|
| Laura Ejemplo (PADRE) | Dos hijos: Mateo (factura vencida y pago parcial) y Sofía (cuota pendiente) |
| Diego Ejemplo (PADRE) | Otro padre vinculado a Mateo: ve el registro de los comprobantes, no el original |
| Mateo / Sofía Ejemplo (ESTUDIANTE) | Información propia, sin selector, pago ni carga |
| Ana Ejemplo (PADRE) | Sin estudiantes vinculados |
| Cuenta Bloqueada | Aviso de cuenta bloqueada tras una autenticación válida |
| Dirección, Docente y Personal | Orientación al canal web, sin información económica |

El **panel de simulación** (al pie, fuera de la aplicación) permite recorrer escenarios: habilitar el escenario simulado de registro de pago, fijar el resultado del próximo envío (normal o incierto), retener o hacer fallar la carga de cuotas, simular una sesión expirada y reiniciar el prototipo.

### Recorrido sugerido (PADRE)

1. Ingresar como Laura Ejemplo → elegir a Mateo → Cuotas (Vencida y Pago parcial).
2. Abrir «Septiembre 2026» → «Seleccionar ítems para pagar». Con datos bancarios **no configurados** el botón «Registrar pago» está bloqueado.
3. En el panel de simulación, habilitar el escenario simulado → elegir comedor de septiembre y transporte y comedor de octubre (total ARS 63.606,65) → «Registrar pago».
4. «Cargar comprobante» → agregar un archivo de ejemplo → completar el número de operación → «Enviar comprobante». El resultado es «pendiente de verificación»: el saldo no cambia.

## Contenido

| Ruta | Función |
|---|---|
| `prototipo/index.html`, `prototipo/estilos.css` | Entrada y estilos (tokens institucionales de EPT-95) |
| `prototipo/js/datos.mjs` | Datos ficticios compartidos y fixtures aprobados (referencia 09/10/2026) |
| `prototipo/js/dinero.mjs` | Importes en centavos y formato ARS con dos decimales |
| `prototipo/js/reglas.mjs` | Reglas: estados, selección, pagos, comprobantes, período y permisos (sin DOM) |
| `prototipo/js/vista.mjs`, `pantallas.mjs`, `app.mjs` | Piezas de interfaz, pantallas, ruteo por hash y guardas |
| `servidor/servidor.mjs` | Servidor local de lista cerrada de archivos |
| `pruebas/prototipo.mjs` | Runner funcional (reglas puras, servidor y Chromium real) |
| `matriz-aceptacion.md`, `mapa-navegacion.md` | Criterio → recorrido → prueba → evidencia, y navegación por rol |
| `evidencia/` | 47 capturas de los recorridos finales (390 px, factor 1) |
| `receta-prototipo.json`, `bitacora-academica.csv` | Receta de arranque y bitácora de aportes de IA |

Las fuentes tipográficas y el logo se sirven desde `docs/parte3/EPT-95/fuentes/` mediante rutas virtuales (`/activos/…`); no se duplican binarios.

## Cómo probarlo

```bash
npm ci                                                       # una vez
npx playwright install chromium                              # una vez
node docs/parte3/EPT-96/pruebas/prototipo.mjs                # 31 comprobaciones, ~25 s
node docs/parte3/EPT-96/pruebas/prototipo.mjs --capturas docs/parte3/EPT-96/evidencia   # regenera la evidencia
```

Opciones: `--solo N03,N12` ejecuta pruebas puntuales (depuración) y `--sin-navegador` omite la fase de Chromium. Con `EPT96_PLAYWRIGHT=/ruta/absoluta/playwright/index.mjs` se indica un Playwright instalado fuera del repositorio. El runner tiene un límite total de 4 minutos y cierra navegador y servidor en `finally`.

## Aislamiento y seguridad del prototipo

- El servidor escucha solo en `127.0.0.1`, acepta únicamente `GET`/`HEAD` y valida `Host`. No decodifica ni une rutas: la URL cruda debe coincidir con una de 15 entradas. Traversal, doble codificación, `.env`, directorios y consultas responden 404.
- CSP estricta (`default-src 'none'`, `connect-src 'none'`): sin scripts en línea, sin estilos en línea y sin red.
- El DOM se construye con `createElement`/`textContent`; no existe `innerHTML`, `fetch`, `localStorage` ni `<input type="file">`.
- Los archivos de comprobante son ejemplos inocuos (solo metadatos): nunca se leen, envían ni persisten.

## Límites

- Los **filtros y las guardas del prototipo ilustran el contrato**; no equivalen a autorización productiva ni a RLS. Los permisos reales dependen de EPT-101 y de la app.
- La emulación de viewport y de agente de usuario en Chromium **no demuestra** ejecución nativa en Android o iOS, TalkBack ni VoiceOver, ni teclado nativo ni escalado real del sistema.
- No hay aprobación humana ni docente de este prototipo.
- Los datos bancarios permanecen «no configurados»: no se inventan CBU, alias ni titulares. El escenario simulado solo habilita recorrer la confirmación.
- Reglas con supuestos propios del prototipo, a confirmar en la implementación: formato del número de operación (letras y números, hasta 30), fecha de transferencia sin restricción de futuro, y rango de la deuda aplicado al vencimiento de la factura.

## Rollback

Revertir el commit de integración: elimina `docs/parte3/EPT-96/`, `scripts/ci/ept96-assets.mjs`, los cambios en `scripts/ci/impact.mjs`, `scripts/ci/impact.test.mjs`, `.github/workflows/ci.yml`, `docs/ci.md` y `docs/evidence/EPT-96.md`. No afecta producto, base de datos ni EPT-95.
