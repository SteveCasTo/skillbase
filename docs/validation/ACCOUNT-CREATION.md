# Validación del alta de cuentas (2026-10-11)

## Reproducción y causa

Base: `development` `fb24e6882ea800135c02dbbf2c982e24f9f7a4ee`.
En la aplicación local existente, un ADMIN ficticio autorizado envió datos válidos:

- Instructor: `firstName`, `lastName`, `email`, `phone` opcional y `password`.
  POST `/app/instructores/nuevo`: 422, mensaje genérico, `fieldErrors: {}`.
- ADMIN: `name`, `email`, `password`.
  POST `/app/administradores/nuevo`: 503, `AUTH_UNAVAILABLE`, `issues: {}`.

El proceso existente ejecutaba `astro.mjs dev` directamente; el `.env` local no
contenía `SUPABASE_SERVICE_ROLE_KEY`. Ese camino omite `scripts/dev.ts`, que obtiene
la credencial privilegiada del stack local. No se inspeccionó ni publicó el entorno
completo del proceso. En un servidor separado en 4334, omitir explícitamente esa
credencial reprodujo el fallo y registró únicamente
`account_creation_failure`, operación `configuration`, código
`MISSING_SERVICE_ROLE_KEY`: el fallo ocurre antes de llamar al proveedor.
No se observó un error SQL, una migración pendiente ni una respuesta de Auth que
justificase cambiar schema, RLS o configuración del proveedor.

El arranque normal `bun run dev --port 4334`, usando endpoints del stack existente
y Site URL del mismo origen, sí creó ambas cuentas. El launcher ahora toma siempre
la credencial vigente del stack local, incluso si quedó otra obsoleta en el entorno,
y permite seleccionar puerto sin saltarse su preparación. Para recuperar la app
original se debe coordinar su arranque con `bun run dev`; este trabajo no detuvo ni
reinició el proceso original ni cambió su configuración local de Supabase.

## Corrección server-side

- Los dos adaptadores reutilizan creación Auth confirmada y compensación acotada al
  UUID recién creado. El fallo de compensación se registra, no se ignora como éxito.
- Logs estructurales conservan operación y códigos/status saneados de causas
  encadenadas; no incluyen mensajes crudos, SQL, formularios, emails, contraseñas,
  tokens ni claves. No se envían causas técnicas al navegador.
- Instructor distingue validación de campo (422), autorización (403), proveedor/
  aprovisionamiento no disponible (503) y fallo interno inesperado (500). Ya no
  clasifica todos los fallos como datos inválidos. ADMIN conserva su contrato
  discriminado y puede conservar la causa interna sin exponerla.
- Permisos server-side, origen, roles, revalidación del actor, transacciones de
  usuario/rol/perfil/auditoría y guard del último ADMIN permanecen vigentes.
- No hay cambios de Sileo, formularios ni banners. No se añadieron tests ni casos.

## Impacto auditado y verificación observada

| Flujo                                                | Relación con la causa                                           | Verificación de esta tarea                                                                                                                                                              |
| ---------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instructor y ADMIN                                   | Auth Admin requiere la credencial server-only                   | UI real: 200 con JS; 303 HTML sin JS; sin repoblar password. Cuatro cuentas QA nuevas eliminadas por lifecycle normal, 200. Control sin credencial: ambos 503 y código interno saneado. |
| Formato                                              | Solo aplicación/Drizzle, no crea identidad Auth                 | Formato QA propio creado 201 y eliminado 200.                                                                                                                                           |
| Borrador de curso sin foto                           | Solo aplicación/Drizzle                                         | Borrador QA propio creado 201; nunca publicado; archivado 200. Se conserva historial normal.                                                                                            |
| Grupo                                                | Solo aplicación/Drizzle                                         | Grupo nuevo del borrador propio creado 200 y eliminado 200 antes de publicar.                                                                                                           |
| Foto de curso                                        | Storage usa la misma variable privilegiada                      | Dependencia confirmada por lectura de `courses/artwork.ts`; subida real no ejecutada aquí. El launcher normal restaura su credencial.                                                   |
| Baja de instructor                                   | Auth Admin usa la misma variable                                | Eliminación real únicamente de los dos instructores QA recién creados, 200.                                                                                                             |
| Certificados/PDF privado                             | Composición de Storage usa la misma variable                    | Dependencia confirmada en `certificates/service.ts`; no se generaron, emitieron, reemplazaron, revocaron ni descargaron certificados.                                                   |
| Interesados/preinscripciones/participantes           | Casos de uso y repositorios Drizzle, no `auth.admin.createUser` | Revisión de adaptadores y suite de integración existente; no nuevas operaciones sobre demos canónicos ni movimientos financieros.                                                       |
| Settings, sesiones/asistencia, evaluaciones y cierre | Persistencia propia con guards, no alta de identidad Auth       | Revisión de composición/repositorios y suites existentes; sin mutaciones manuales de estas áreas.                                                                                       |

La búsqueda en `src` confirma que las únicas altas de identidad Auth de la
aplicación son instructor y ADMIN. Los demás consumidores de la variable
privilegiada arriba indicados también sufrirían su ausencia; no se afirma haber
ejercitado manualmente todos esos caminos. La lectura posterior observó 8
certificados y ledger 24. No se hicieron reset, seed, migraciones, cambios de
proveedor/cloud ni cambios a credenciales o roles originales. La lectura posterior
no constituye comparación completa de hashes de todas las tablas.

## Checks ejecutados

- Antes: 21 unitarias existentes de Auth dual/instructor/ADMIN PASS.
- Después: 464 unitarias PASS; integración temporal aislada: 176 PASS, 1 omitida,
  0 fallos; 9 E2E existentes de instructor/ADMIN/lifecycle PASS, retries desactivados,
  stack propio y app en 4435.
- ESLint PASS; Astro check: 0 errores, 0 warnings; build PASS.
- Una corrida intermedia detectó un mensaje incompatible con una expectativa
  existente de compensación; se conservó el significado y prefijo público previo,
  sin editar tests. Otra corrida unitaria coincidió con una copia temporal de la
  configuración local API 54321 y falló su guard de puertos; con la configuración
  versionada restaurada, las 464 pasaron. La configuración original permanece intacta.

No se declara login Google real, entrega SMTP ni validación productiva.
