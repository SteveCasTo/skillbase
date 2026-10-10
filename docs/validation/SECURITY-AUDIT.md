# Revisión de seguridad — 2026-10-09

## Estado y alcance

- **Base inspeccionada:** `f388327424b9010a0ec5e5c209fe46d09b960d9f` (`development`).
- **Naturaleza:** revisión estática reportada de código, configuración y lockfile; este documento registra el reporte, no afirma una nueva ejecución de la auditoría.
- **Resultado:** no se confirmó explotación end-to-end. Los hallazgos siguientes quedan **pendientes de validación y decisión del responsable**. No se realizaron cambios de implementación ni se aprueba por este registro una remediación concreta.
- **Límite:** inspección acotada del árbol y de los controles descritos abajo; no equivale a una certificación, prueba dinámica integral ni evaluación de producción.

## Hallazgos

### AUTH-1 — La reautenticación de cambio de contraseña depende de los guards de aplicación

**Clasificación reportada:** potencialmente alta; requiere validación. **Estado:** no confirmado como exploit end-to-end.

En `src/domain/auth/identity.ts:133-134`, `requireApprovedProviders` da por válida una sesión cuyo método actual sea `PASSWORD` o `EMAIL_CONFIRMATION` sin comprobar si la identidad Google enlazada está aprobada. La decisión es coherente con que una identidad asociada en Supabase no concede por sí sola acceso OAuth a la aplicación, pero no vincula la operación de cambio de contraseña del proveedor a esa aprobación.

El adapter de aplicación `src/server/auth/profile.ts:118-129` exige aprobación/prueba Google reciente para el camino Google-only; `src/application/auth/change-password.ts:47-60` acepta ese `hasGoogleProof` como alternativa a verificar la contraseña actual. Por tanto, esos controles se ejecutan en el flujo de aplicación inspeccionado, no necesariamente en una operación directa contra Supabase Auth. La configuración versionada `supabase/config.toml:181,229` fija mínimo de contraseña en seis caracteres y `secure_password_change = true`; esto no demuestra una exigencia de contraseña actual ni una prueba Google de cinco minutos en la frontera del proveedor. El comportamiento efectivo depende además de la versión/configuración desplegada del proveedor y no fue verificado dinámicamente.

**Escenario y límites:** una sesión Auth válida de una cuenta con proveedor Google automáticamente enlazado pero no aprobado internamente podría intentar cambiar la contraseña directamente en el proveedor y luego usar el login `PASSWORD`; la autorización interna seguiría dependiendo de que la cuenta tenga rol habilitado (incluido `ADMIN`). La persona atacante tendría que poseer una sesión Auth válida; el reporte no verificó controles adicionales, exposición real de la operación directa ni éxito del escenario. Se trata de una brecha potencial entre controles de aplicación y de proveedor, no de una elevación de privilegios demostrada.

**Evidencia/estado de pruebas:** se reportó que las pruebas existentes de autenticación dual rechazan OAuth no aprobado, pero no cubren conversión de contraseña contra el proveedor. No se añadieron ni ejecutaron pruebas nuevas como parte de esta documentación. La revisión reportó 67 pruebas unitarias existentes PASS; ese resultado es reportado por la auditoría y no se volvió a ejecutar para esta tarea.

**Seguimiento:** requiere validación de la operación y configuración efectivas del proveedor y decisión del responsable sobre el límite de seguridad esperado antes de elegir una remediación. Este registro no prescribe ni implementa un mecanismo específico.

### DEP-1 — Versiones fijadas de dependencias coinciden con advisories

**Estado:** coincidencia de paquete/versión reportada; aplicabilidad y exposición de la aplicación pendientes de validar. No se confirmó explotación.

| Paquete fijado en `bun.lock` | Advisory | Riesgo resumido por la revisión | Versión corregida indicada por la revisión |
| --- | --- | --- | --- |
| `sharp@0.35.4` (línea 1618) | [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w) | Posible RCE al procesar SVG malicioso; impacto reportado como específico de Linux. | `0.35.5` |
| `devalue@5.9.2` (línea 1080) | [GHSA-j22f-vq7h-c4qm](https://github.com/advisories/GHSA-j22f-vq7h-c4qm) | Posible exposición de memoria al serializar `Buffer`/vistas compartidas. | `5.9.3` |

El reporte indicó una consulta de OSV sobre 1.106 combinaciones paquete/versión. Otras coincidencias quedaron sin clasificar y **no** se cuentan aquí como vulnerabilidades. La coincidencia de versiones no establece por sí sola que el código afectado se ejecute con entrada controlable ni que exista exposición en producción. En la superficie inspeccionada no se encontró una ruta de usuario que entregue SVG a Sharp ni una ruta PDF que hidrate los buffers descritos; la ausencia de esas rutas en la inspección acotada no prueba ausencia en todos los contextos.

**Seguimiento:** validar uso transitivo/alcanzable, plataformas objetivo, rutas de entrada y configuración efectiva; la revisión no actualizó dependencias ni lockfile.

## Cobertura y límites de verificación

La revisión reportó inspección de guards fail-closed, ownership/transacciones, proyecciones públicas, grants/RLS, límites de body, validación de origen/CSRF, redirects y manejo server-side de credenciales. No confirmó IDOR, escalación `INSTRUCTOR`→`ADMIN`, SQL injection, HTML arbitrario ni acceso anónimo al PDF de certificados en las superficies inspeccionadas; esto no equivale a demostrar su ausencia global.

No se verificaron dinámicamente integraciones, E2E, permisos cloud, configuración desplegada ni historia de secretos. No se hizo probing de producción, reset de base de datos, carga de seeds, migración, cambio de contraseña ni envío de correo. La modificación local preexistente de `supabase/config.toml` observada en otro checkout no se trató como vulnerabilidad demostrada ni se incorporó a este registro.

## Evidencia de pruebas

- La auditoría reportó **67 pruebas unitarias existentes PASS** (`--no-env-file`) en los grupos focales de Auth/Google/password, certificados/uploads, Markdown, privacidad académica y CSV. No se repitió esa batería para redactar este documento ni se modificaron tests.
- Las pruebas existentes de Auth dual reportadas cubren rechazo de OAuth no aprobado; no cubren cambio/conversión de contraseña directo en el proveedor.
- No se añadieron pruebas: esta entrega es solo documental.

## Seguimiento

Mantener los hallazgos abiertos hasta que el responsable decida el tratamiento y se aporte evidencia de validación correspondiente. Cualquier remediación, test adicional o cambio de configuración pertenece a una tarea aprobada separada y no debe inferirse como aceptado a partir de este reporte.