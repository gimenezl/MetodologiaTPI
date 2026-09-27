# Educar para Transformar

Sistema de gestion y sitio web institucional para el Centro Educativo "Educar para Transformar".
Stack principal: Next.js (App Router) + Tailwind v4 + Supabase.

## Requisitos

- Node.js 18+
- Variables de entorno en `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=tu_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu_anon_key
```

- Opcional, vinculación presencial de cuentas (Usuarios, EPT-59). Sin la bandera
  o sin `EPT_SMTP_HOST` y `EPT_SMTP_REMITENTE`, la API responde 503
  `VINCULO_DESHABILITADO` y la pantalla lo explica. Solo del lado del servidor:
  nunca con prefijo `NEXT_PUBLIC_`.
  **No activar D5 en producción con esta frontera.** El canal SMTP productivo y
  su autorización son un trabajo posterior; el ejemplo siguiente es referencia
  para esa decisión futura, no una configuración de despliegue actual.

```bash
# EPT_VINCULO_CUENTAS=habilitado  # habilitar solo tras aprobar el canal productivo
EPT_SMTP_HOST=smtp.tu-proveedor.com
EPT_SMTP_PORT=587            # 465 si EPT_SMTP_SECURE=true
EPT_SMTP_SECURE=false        # true: TLS implícito; false: STARTTLS si el servidor lo ofrece
EPT_SMTP_USUARIO=usuario     # opcional
EPT_SMTP_CLAVE=clave         # opcional, junto con el usuario
EPT_SMTP_REMITENTE="Educar para Transformar <no-responder@tu-dominio>"
```

En la pila local, Mailpit recibe los correos por `127.0.0.1:54325` (sin usuario
ni TLS) y los muestra en `http://127.0.0.1:54324`.

## Desarrollo

```bash
npm run dev
```

Abrir [http://localhost:3000](http://localhost:3000).

## Scripts utiles

```bash
npm run build
npm run lint
npm run test:e2e
```

## Funcionalidades principales

- Sitio institucional, galeria, noticias y formularios publicos.
- Gestion de usuarios, roles y vinculos familiares.
- Gestion de legajos, actividades, cupos e inscripciones.
- Registro y consulta de asistencias.
- Gestion de solicitudes, postulaciones y testimonios.

## Integrantes

- Lucas Benjamin Gimenez
- Milagros Gonzalez

Alojado en: https://metodologia-tpi.vercel.app/
