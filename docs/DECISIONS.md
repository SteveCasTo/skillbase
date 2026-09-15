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
