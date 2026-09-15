# PLAN

## OBJETIVO

Definir un plan incremental de implementación que permita entregar avances demostrables al docente y reduzca el riesgo técnico.

Este documento debe actualizarse cuando cambie el alcance, el orden de prioridades o aparezcan dependencias nuevas.

## CRITERIOS DE PRIORIZACIÓN

El orden de implementación se determina combinando:

1. Dependencias técnicas.
2. Valor funcional demostrable.
3. Riesgo.
4. Importancia académica.
5. Capacidad de validar tempranamente reglas de negocio.
6. Capacidad de recibir retroalimentación del docente.

No priorizar únicamente por facilidad de programación.

## FASE 0 — FOUNDATION

### Objetivos

- [x] Crear y publicar repositorio.
- [x] Configurar ramas `master` y `development`.
- [x] Crear Astro + React.
- [x] Configurar Bun.
- [x] Configurar Tailwind.
- [x] Configurar shadcn/ui.
- [x] Incorporar design tokens.
- [x] Incorporar Sileo.
- [x] Configurar Supabase local.
- [x] Configurar Drizzle sin entidades de negocio anticipadas.
- [x] Configurar lint, format y typecheck.
- [x] Configurar Playwright con Chromium.
- [x] Configurar scripts de `package.json`.
- [x] Configurar GitHub Actions para `master`.
- [x] Configurar Vercel CLI y adapter.
- [x] Crear documentación base.

### Resultado demostrable

Aplicación ejecutable de forma reproducible en cualquier equipo del grupo.

### Estado

La implementación técnica se completa siguiendo este checklist, sin avanzar sobre Auth ni módulos funcionales:

1. Preparar exclusiones e inicializar Git en `master` sin eliminar archivos locales.
2. Inicializar Astro full-stack, React, Tailwind y TypeScript estricto en la raíz.
3. Configurar shadcn/ui, tokens, fuentes, temas y Sileo.
4. Configurar Supabase local con servicios mínimos y entorno reproducible.
5. Configurar Drizzle y una estrategia única de migraciones.
6. Incorporar lint, format, typecheck, unit, integration y E2E.
7. Exponer las operaciones habituales mediante scripts de `package.json`.
8. Ejecutar CI exclusivamente para pushes y pull requests de `master`.
9. Documentar setup, testing, migraciones y preparación de Vercel.
10. Verificar todo localmente, publicar `master` y crear `development` desde esa base.

Foundation queda completa cuando este checklist, CI y ambas ramas están publicados y verificados.

## FASE 1 — AUTH Y ESTRUCTURA PRIVADA

### Objetivos

- Implementar Supabase Auth.
- Implementar Google OAuth.
- Gestionar sesión.
- Modelar usuario interno.
- Implementar roles.
- Crear layout privado.
- Proteger rutas.
- Implementar navegación base.

### Resultado demostrable

Administrador e instructor pueden autenticarse y acceder únicamente a las zonas correspondientes.

### Checklist de implementación

- [x] Añadir los clientes oficiales de Supabase para Auth SSR con versiones fijadas.
- [ ] Configurar variables públicas y privadas separadas para local, CI y cloud.
- [x] Modelar usuarios internos preaprovisionados con estados `INVITED`, `ACTIVE` y `DISABLED`.
- [x] Modelar roles `ADMIN` e `INSTRUCTOR` como una relación multirol.
- [x] Vincular una invitación interna con una identidad Google únicamente después de autenticar un correo verificado coincidente.
- [x] Crear y verificar la migración Drizzle, restricciones, índices, privilegios y RLS correspondientes.
- [x] Implementar clientes Supabase por request, renovación de cookies y contexto de autenticación en middleware.
- [x] Implementar inicio de sesión Google mediante OAuth PKCE y callback con redirects validados.
- [x] Implementar logout limitado a la sesión del navegador actual.
- [x] Rechazar explícitamente identidades sin invitación, usuarios deshabilitados y usuarios sin permisos.
- [x] Crear guards server-side reutilizables para sesión, estado y roles.
- [x] Crear login, layout privado y navegación responsive accesible según permisos.
- [x] Crear rutas privadas representativas para administración e instructores.
- [x] Crear fixtures locales deterministas que no dependan de la interfaz de Google.
- [x] Cubrir autenticación, sesión, logout, redirects y autorización con pruebas unitarias, de integración y E2E.
- [x] Enlazar y verificar el proyecto dedicado de Supabase Cloud.
- [x] Configurar Google OAuth local y cloud sin versionar secretos.
- [x] Preaprovisionar el primer administrador cloud mediante su correo autorizado.
- [x] Crear y configurar el proyecto Vercel con `master` como rama de producción.
- [x] Ejecutar migraciones y despliegue de producción únicamente después de superar los checks de CI.
- [x] Actualizar documentación de arquitectura, datos, Auth, seguridad, testing y despliegue.

### Decisiones de alcance

- Google OAuth es el mecanismo visible de acceso; email/password solo podría utilizarse en fixtures automatizados locales. Los fixtures actuales usan sesiones de un solo uso generadas por Admin API porque el proveedor público de email está deshabilitado.
- Una identidad autenticada no obtiene acceso por defecto. Debe existir una invitación interna previa y activa.
- Un usuario puede tener simultáneamente los roles `ADMIN` e `INSTRUCTOR`.
- El rol y el estado se consultan desde la base interna, no desde metadata editable ni desde el dominio del correo.
- Las rutas y operaciones privadas validan autorización en servidor; la navegación filtrada no constituye un control de acceso.
- Supabase Cloud y Vercel se configuran en esta fase, pero ningún secreto se almacena en Git.

### Estado

Fase 1 completada y verificada en local, CI y cloud. El primer administrador puede autenticarse con Google y acceder a `/app`; las identidades no preaprovisionadas, deshabilitadas o sin roles quedan rechazadas en servidor.

## FASE 2 — LANDING Y CURSOS

### Objetivos

- Landing pública.
- Catálogo de cursos.
- Detalle público.
- CRUD administrativo de cursos.
- Niveles: básico, medio y avanzado.
- Horas.
- horarios.
- precios.
- estado de publicación.
- periodos de preinscripción.
- reglas configurables de aprobación.

### Resultado demostrable

Administración crea un curso y puede publicarlo; el curso aparece automáticamente en la web pública.

## FASE 3 — PREINSCRIPCIÓN

### Objetivos

- Formulario público.
- Validaciones.
- Prevención razonable de duplicados.
- Listado administrativo.
- Métricas de demanda.
- Estados de preinscripción.

### Resultado demostrable

Una persona se preinscribe y administración ve la demanda acumulada.

## FASE 4 — GRUPOS

### Objetivos

- Crear grupos.
- Definir mínimo.
- Definir cupo.
- Asignar instructor.
- Definir horario.
- Gestionar cancelación.
- Gestionar grupo adicional.
- Gestionar reemplazo por feriados.

### Resultado demostrable

Administración transforma demanda en grupos operativos.

## FASE 5 — INSCRIPCIÓN ADMINISTRATIVA

### Objetivos

- Convertir preinscripción en inscripción.
- Registrar tipo de participante.
- Registrar precio aplicado.
- Aplicar descuentos.
- Registrar condición de auxiliar.
- Registrar boleta/valorado si corresponde.
- Revertir inscripciones.
- Gestionar devolución por cancelación de grupo.
- Generar listados administrativos.

### Resultado demostrable

Administración puede cerrar una lista real de participantes inscritos.

## FASE 6 — SESIONES Y ASISTENCIA

### Objetivos

- Crear calendario de sesiones.
- Registrar asistencia.
- Registrar asistencia del instructor.
- Manejar sesiones de reemplazo.
- Calcular porcentaje.
- Señalar faltas continuas.
- Mostrar alertas operativas.

### Resultado demostrable

Instructor gestiona asistencia diaria de un grupo.

## FASE 7 — EVALUACIONES Y NOTAS

### Objetivos

- Permitir esquema de evaluación configurable.
- Permitir múltiples componentes.
- Definir porcentajes.
- Validar que total sea 100 %.
- Registrar calificaciones.
- Calcular nota final.
- Manejar evaluación teórica, práctica o mixta.

### Resultado demostrable

Instructor configura evaluación y el sistema calcula resultados finales.

## FASE 8 — CIERRE DE CURSO

### Objetivos

- Determinar elegibilidad.
- Cerrar calificaciones.
- Generar planilla.
- Registrar informe de finalización.
- Impedir cambios no autorizados posteriores al cierre.
- Permitir reapertura controlada si la política lo permite.

### Resultado demostrable

Administración completa el cierre administrativo y académico.

## FASE 9 — CERTIFICADOS

### Objetivos

- Generar certificado PDF.
- Generar credential ID.
- Generar QR.
- Mantener estado de firma.
- Permitir carga del certificado firmado.
- Calcular hash.
- Publicar verificación.
- Descargar certificado.
- Revocar.
- Reemplazar.

### Resultado demostrable

Un tercero puede verificar un certificado real mediante una URL pública.

## FASE 10 — REPORTES, HARDENING Y CALIDAD

### Objetivos

- Reportes requeridos.
- Auditoría.
- Revisión de seguridad.
- Revisión de accesibilidad.
- Revisión responsive.
- Performance.
- Estados vacíos y loading.
- Validación completa de archivos.
- Limpieza de deuda técnica.
- Pruebas de regresión.

### Resultado demostrable

Release candidate listo para adopción.

## REGLA DE AVANCE

Una fase no requiere que absolutamente todo lo anterior esté cerrado, pero ninguna funcionalidad debe avanzar dejando roto el flujo principal.

Cada milestone debe incluir:

- implementación;
- tests;
- build exitoso;
- documentación actualizada;
- demostración funcional.

## FUERA DE ALCANCE INICIAL

- LMS.
- Recursos educativos.
- clases virtuales.
- videoconferencia.
- foros.
- entrega completa de tareas como plataforma educativa.
- aplicación móvil nativa.
- aplicación desktop.
- microservicios.
- firma criptográfica avanzada del PDF en MVP.
