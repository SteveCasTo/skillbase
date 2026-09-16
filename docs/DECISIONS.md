# DECISIONS

## OBJETIVO

Registrar decisiones técnicas relevantes y su contexto.

Este archivo no debe convertirse en un diario de cambios menores.

## FORMATO ADR

Cada decisión debe incluir:

- ID.
- fecha.
- estado.
- contexto.
- decisión.
- alternativas.
- consecuencias.

Estados:

- Proposed.
- Accepted.
- Superseded.
- Deprecated.

---

## ADR-001 — SUPABASE COMO BACKEND PLATFORM

**Estado:** Accepted

### Contexto

El sistema requiere PostgreSQL, autenticación, Google OAuth, almacenamiento de archivos y un entorno local reproducible.

### Decisión

Usar Supabase para:

- PostgreSQL;
- Auth;
- Storage;
- entorno local.

### Alternativas

- Firebase.
- Cloudflare D1/R2.
- PostgreSQL y servicios independientes.

### Consecuencias

Positivas:

- modelo relacional;
- local development;
- menor cantidad de infraestructura propia;
- Auth y Storage integrados.

Negativas:

- dependencia de Supabase en algunas capacidades;
- necesidad de mantener migraciones y configuración consistentes.

---

## ADR-002 — MONOLITO MODULAR

**Estado:** Accepted

### Decisión

Iniciar con Astro full-stack y no crear backend independiente.

### Motivo

Existe un único cliente web y no hay aún integraciones que justifiquen un servicio separado.

### Regla de evolución

Evaluar Elysia + Bun si aparece:

- múltiples clientes;
- API externa;
- integración institucional compleja;
- procesamiento independiente;
- escalado separado.

---

## ADR-003 — DRIZZLE

**Estado:** Accepted

### Decisión

Usar Drizzle para acceso tipado a PostgreSQL.

### Consecuencia

La lógica de datos debe pasar por repositories/services.

No utilizar Supabase Data API como mecanismo principal para lógica de negocio del servidor.

---

## ADR-004 — SUPABASE LOCAL

**Estado:** Accepted

### Decisión

Usar Supabase local mediante CLI y Docker para desarrollo e integración.

### Motivo

Mantener similitud entre development y production.

SQLite no se utilizará como sustituto de PostgreSQL para desarrollo.

---

## ADR-005 — VERCEL

**Estado:** Accepted

### Decisión

Desplegar producción en Vercel.

El despliegue de `master` se ejecutará después de CI exitoso.

---

## ADR-006 — GITHUB ACTIONS COMO GATE

**Estado:** Accepted

### Decisión

Todo release desde `master` requiere:

- lint;
- typecheck;
- tests;
- build.

Las migraciones pendientes se aplicarán a Supabase Cloud desde CI antes del despliegue final.

---

## ADR-007 — SHADCN/UI

**Estado:** Accepted

### Decisión

Usar shadcn/ui como base del sistema de componentes.

### Motivo

Reduce trabajo repetitivo manteniendo control sobre el código.

---

## ADR-008 — SILEO

**Estado:** Accepted with validation

### Decisión

Usar Sileo como toast principal.

### Condiciones

- validar accesibilidad;
- verificar reduced motion;
- no usar toast para información crítica;
- mantener fallback visual coherente si una necesidad no está cubierta.

---

## ADR-009 — GOOGLE AUTH

**Estado:** Accepted

### Decisión

Google OAuth será gestionado mediante Supabase Auth.

El usuario interno no utilizará `googleId` como PK.

La identidad de proveedor debe permanecer desacoplada del identificador de dominio.

---

## ADR-010 — SIN STAGING INICIAL

**Estado:** Accepted

### Decisión

No mantener staging permanente mientras el sistema aún no tenga uso productivo real.

Entornos:

- local development;
- isolated testing;
- preview cuando corresponda;
- production.

Reevaluar staging después del lanzamiento.

---

## ADR-011 — DRIZZLE CONTROLA LAS MIGRACIONES DE APLICACIÓN

**Fecha:** 2026-09-13

**Estado:** Accepted

### Contexto

Supabase CLI y Drizzle pueden mantener historiales de migración independientes. Usar ambos para las mismas tablas generaría orden ambiguo y resets locales distintos de producción.

### Decisión

Drizzle Kit genera y aplica las migraciones del schema de aplicación. Supabase CLI administra el stack local y reinicia los servicios; después de cada reset se ejecutan las migraciones Drizzle.

Los objetos propios de la plataforma Supabase solo tendrán una migración específica si una capacidad futura no puede representarse de forma coherente con el schema Drizzle.

### Alternativas

- Mantener dos historiales para las mismas tablas.
- Escribir migraciones Supabase manuales y usar Drizzle solo para queries.

### Consecuencias

- Existe una única fuente versionada para las entidades de aplicación.
- Desarrollo, CI y producción ejecutan `drizzle-kit migrate`.
- Foundation contiene metadata Drizzle, pero ninguna tabla de negocio anticipada.

---

## ADR-012 — IDENTIDAD AUTH E INVITACIONES INTERNAS

**Fecha:** 2026-09-14

**Estado:** Accepted

### Contexto

Supabase Auth controla identidades y sesiones, pero los permisos institucionales deben ser preaprovisionados, soportar múltiples roles y poder deshabilitarse sin eliminar la identidad externa.

### Decisión

Mantener `auth.users` fuera del schema Drizzle. Una invitación interna se identifica por correo normalizado y se vincula una sola vez al UUID Auth después de un Google OAuth exitoso con correo verificado. Roles y estado viven únicamente en tablas internas. No se añade FK cross-schema: se usa unicidad DB y vinculación transaccional en aplicación.

Las tablas públicas quedan sin acceso por Data API para `anon`/`authenticated`; Astro con Drizzle aplica la autorización operativa.

### Consecuencias

- Deshabilitar el usuario interno corta acceso aunque la sesión Google siga siendo válida.
- Los cambios de rol se observan en el siguiente request sin esperar a renovar JWT.
- El proceso de preaprovisionamiento no necesita privilegios sobre el schema `auth`.
- Los fixtures automatizados pueden crear identidades locales por Admin API sin alterar el mecanismo visible de login.

---

## ADR-013 — URLs DB SEPARADAS PARA RUNTIME Y MIGRACIONES

**Fecha:** 2026-09-14

**Estado:** Accepted

### Decisión

`DATABASE_URL` es la conexión server-side de runtime y `MIGRATION_DATABASE_URL` es la conexión directa preferida por Drizzle Kit. Localmente pueden ser iguales; en Vercel el runtime puede usar pooler mientras las migraciones conservan una conexión directa.

---

## ADR-015 — CICLO EDITORIAL Y CONTRATOS DE CURSO

**Fecha:** 2026-09-15

**Estado:** Accepted

### Contexto

La gestión administrativa debe alimentar una experiencia pública posterior sin mezclar publicación editorial, disponibilidad de preinscripción ni calendario operativo de grupos. Los cambios sobre cursos publicados y precios necesitan trazabilidad.

### Decisión

Modelar el curso con estados `DRAFT`, `PUBLISHED` y `ARCHIVED`. Publicar transforma borrador en publicado; retirar transforma publicado en borrador y se audita como retiro; archivar no borra y es terminal en Fase 2A. La disponibilidad de preinscripción se deriva de una ventana opcional válida y no se persiste.

Generar un slug único y normalizado al crear, resolver colisiones de forma transaccional y mantenerlo inmutable. Persistir precios obligatorios `STUDENT` y `EXTERNAL` como `numeric(12,2)` y strings TypeScript, con moneda `BOB`. Mantener DTO administrativo y DTO público separados; el segundo solo se produce para `PUBLISHED`. En Fase 2A el DTO público existe como contrato de repositorio, pero todavía no hay rutas HTTP públicas.

Astro SSR coordina formularios POST en páginas dedicadas. Los casos de uso autorizan `ADMIN`, el repositorio Drizzle conserva atomicidad entre entidad, precios y `audit_events`, y no se expone Data API.

Los valores `datetime-local` se definen como tiempo civil `America/La_Paz` y se convierten simétricamente con UTC-04, sin consultar el timezone del runtime. `updatedAt` actúa como revisión optimista para edición. Un advisory lock global serializa la asignación de slugs; las transiciones continúan usando bloqueo de fila. Todo éxito mutable finaliza con Post/Redirect/Get `303`.

### Alternativas

- Combinar publicación y preinscripción en un único estado.
- Regenerar el slug al editar el nombre.
- Persistir disponibilidad calculada.
- Exponer las tablas mediante Supabase Data API.

### Consecuencias

- El calendario público actual es informativo; grupos futuros podrán definir el operativo sin reinterpretar cursos existentes.
- Retirar conserva curso, URL y trazabilidad, pero lo oculta de lecturas públicas.
- Editar contenido o precios publicados es posible y auditable.
- Ediciones obsoletas se rechazan sin pérdida silenciosa y los no-op no generan eventos de cambio.
- La serialización global sacrifica paralelismo mínimo durante la breve asignación de slug a cambio de unicidad determinista para bases solapadas.
- Fase 2B puede consumir un contrato público estable sin acceder a campos administrativos ni cambiar la persistencia.
