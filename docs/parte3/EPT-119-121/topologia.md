# Topología y aislamiento del ciclo económico conectado (EPT-119)

Campaña EPT-119 / EPT-120 / EPT-121. Producción sin cambios: todo corre en stacks descartables de CI.

## Por qué hace falta una topología distinta para iOS

Los runners `macos-26` (ARM) de GitHub no tienen Docker ni virtualización anidada. Entre el 12 y el 15/10/2026 se
intentó levantar Supabase en macOS con Colima/QEMU y luego con binarios nativos durante unas 40 corridas, sin éxito
(`docs/evidence/EPT-105.md`). El resultado fue un smoke de iOS sin backend, que **no** satisface el ciclo económico.

## Topología

```
 ┌────────────── job Linux: mobile-ios-backend ──────────────┐        ┌──────── job macOS: mobile-ios ────────┐
 │ Supabase local aislado (project_id aleatorio, JWT 120 s)  │        │ prebuild Expo (sin backend)           │
 │ Next (next dev) con las claves SOLO en su entorno         │        │ espera el apretón de manos             │
 │ Chromium: Dirección decide en la web real                 │ HTTPS  │ build iOS con las URL públicas         │
  │ proxy por capacidad + cloudflared ×2 ────────────────────┼───────▶│ simulador iPhone + app nativa real     │
 │ ciclo-economico.mjs: preparar / decidir / verificar       │        │ Maestro: ciclo-pago → espera → estado  │
 └──────────────────── artefacto ios-apreton ────────────────┴────────┴──── artefacto ios-fin ◀───────────────┘
```

* **Android** no usa túnel: el emulador y el backend viven en el mismo job Linux (`10.0.2.2`); el ciclo corre allí
  con su propio stack y namespace (`EPT_CICLO_CLAVE` con sufijo `-android`).
* **Coordinación entre jobs iOS.** El job macOS publica una clave pública efímera en un artifact del mismo run. Linux
  cifra para esa clave las URL, las capacidades, la clave anónima y la semilla aleatoria de la fixture; solo publica el
  ciphertext. El job macOS lo descifra, compila la app con esas URL (Expo las incrusta en el bundle) y, al terminar,
  sube `ios-fin`; el backend no se destruye hasta verlo. Entre ambos, la coordinación real es el **estado del backend**:
  el simulador registra dos pagos con comprobante, Dirección los decide en la web y la app espera (sin esperas fijas) a
  ver `APROBADO` y `RECHAZADO` con la sesión real del padre.

## Controles de seguridad

| Control | Cómo se cumple |
|---|---|
| URL aleatoria | Túneles rápidos de Cloudflare (`*.trycloudflare.com`), efímeros y sin cuenta ni configuración persistente. |
| Binario verificado | `cloudflared 2026.10.1` fijado por versión y SHA-256 (`sha256sum -c -`, resumen publicado por GitHub para ese recurso). |
| Acceso al túnel | Los túneles apuntan a proxies loopback, no directamente a Supabase ni a Next. Cada proxy exige una capacidad independiente de 256 bits antes de reenviar solicitudes. |
| Sin `service_role` | No viaja en el apretón de manos ni llega a la app (`entorno.ts` rechaza claves privilegiadas). El script del túnel no la lee; Next la recibe solo en su entorno local. El apretón de manos exige que la clave sea `role: anon`. |
| Datos sintéticos | Cuentas `@ept119.invalid`, importes fijos, sin datos ni comprobantes reales. |
| Duración | `timeout` limita los procesos a 50 minutos; el cleanup comprueba los grupos y la evidencia iOS que incorpora capacidades solo se publica después de confirmar el cierre. La cancelación y la infraestructura del runner requieren verificación real. |
| Logs | El host del túnel se enmascara (`::add-mask::`); los registros del proceso del túnel quedan fuera de los artefactos y los diagnósticos se sanean con `run-stage.py --sanitize-directory`. |
| Producto sin debilitar | La app usa HTTPS normal: no se habilita ATS ni cleartext, no se tocan Bearer, cookies, CSRF ni la validación de destinos. |

### Límite declarado (honesto)

El repositorio es **público** y sus artifacts pueden descargarse. Los artifacts v4 del mismo run son inmutables, pero
la autenticidad de la clave pública depende de la integridad y permisos de los jobs del run: el cifrado por sí solo no
autentica su origen. Las capacidades se incrustan en el build iOS de prueba y no son credenciales de producción; ese
bundle debe mantenerse privado mientras el túnel exista. Las claves locales de Supabase no son una barrera adecuada:
el proxy exige su capacidad incluso si una solicitud aporta una credencial privilegiada conocida. Cloudflare y los
propios runners forman parte de la frontera de confianza. No se debe presentar el diseño como verificado hasta probar
el recorrido nativo y los casos de cancelación en CI con esta versión exacta.

## Fixtures y namespaces

Un namespace por plataforma (`ciclo-<plataforma>-*@ept119.invalid`, nivel `Nivel ciclo <plataforma> …`), identificadores
derivados de la clave del run, tres ítems con importes exactos e independientes:

| Ítem | Importe | Destino |
|---|---|---|
| A | 45.250,75 | pago aprobado por Dirección en la web |
| B | 38.900,25 | pago rechazado por Dirección en la web (motivo registrado) |
| C | 51.000,00 | control: no se toca |

Deuda final esperada: B + C = **89.900,25** (el rechazo no reduce el saldo y libera la reserva de B).

## Rollback

Un rollback de código no deshace pagos aprobados: el ciclo solo toca stacks efímeros, que se destruyen. Para revertir la
campaña basta revertir el PR; no hay migraciones ni cambios de producción.
