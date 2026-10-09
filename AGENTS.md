<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Verificación por PR

- Cada PR debe pasar `CI / gate` sobre su SHA final; registrar perfil, comandos, resultados y duración.
- Usar `scripts/ci/impact.mjs`: documentación y puras no requieren Docker; cambios compartidos usan contratos DB y core UI. Rutas o pruebas desconocidas bloquean hasta registrar cobertura. La matriz completa queda para manual/semanal/pre-release, nunca por rutina de PR.
- SQL, auth, importes y Storage necesitan contratos reales y carreras aplicables, no solo mocks. No reducir negativas para acelerar.
- Reutilizar evidencia solo si bytes, entorno y fixtures siguen iguales. No ejecutar la misma matriz larga en local y CI sin motivo.
- Mantener secretos, datos y jobs de producción fuera de las pruebas. Mobile requiere gates propios cuando exista su paquete.
