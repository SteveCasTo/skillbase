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

| Paquete fijado en `bun.lock` | Advisory                                                                 | Riesgo resumido por la revisión                                                    | Versión corregida indicada por la revisión |
| ---------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------ |
| `sharp@0.35.4` (línea 1618)  | [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w) | Posible RCE al procesar SVG malicioso; impacto reportado como específico de Linux. | `0.35.5`                                   |
| `devalue@5.9.2` (línea 1080) | [GHSA-j22f-vq7h-c4qm](https://github.com/advisories/GHSA-j22f-vq7h-c4qm) | Posible exposición de memoria al serializar `Buffer`/vistas compartidas.           | `5.9.3`                                    |

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

## Seguimiento autorizado — 2026-10-11

### Fuente y aislamiento

La remediación se inició en `fix/audited-security-risks`, worktree temporal desde
`origin/development` `fb24e6882ea800135c02dbbf2c982e24f9f7a4ee`. Comparar con
`f388327424b9010a0ec5e5c209fe46d09b960d9f` confirmó que los tres archivos Auth
citados no habían cambiado; el manifest/lockfile ya incluía el patch declarado
de Sileo 0.1.5, que se conserva sin modificaciones.

No se añadieron tests permanentes. Las validaciones de integración y E2E usan
el runner existente, con proyecto, puertos y credenciales efímeros propios y
SMTP externo eliminado. No se usaron cuentas demo existentes, correo real,
Google real, cloud ni producción; no se reinició/resetearon el stack o la app
canónicos.

### AUTH-1: pendiente de decisión y revisión autorizada

El asunto Auth queda fuera del mantenimiento defensivo de dependencias del
PR 332. Requiere una revisión específica autorizada de la frontera del proveedor
y una decisión del responsable que preserve login password, Google, recovery,
invitaciones y asociación explícita. No se afirma una corrección ni exposición
verificada en producción. Este seguimiento no proporciona un procedimiento de
reproducción ni autoriza nuevas comprobaciones sobre ese escenario.

No se modificaron archivos runtime Auth, contratos, permisos, credenciales,
configuración del proveedor o migraciones. No se presenta un guard de aplicación
como remediación de la frontera del proveedor. AUTH-1 permanece **abierto**.

### AUTH-1: envío defensivo autorizado posterior (2026-10-11)

Rama `fix/auth-provider-current-password`, worktree aislado desde `development`
`cdb7ac95`: el gateway recibe la contraseña actual solo para cambio normal y el
adaptador la transmite a Supabase como `current_password`, además de conservar
la verificación server-side previa. Recovery validado y primera contraseña con
Google reciente/aprobado omiten la propiedad. Errores nativos de contraseña actual
se traducen al campo seguro, sin detalles de proveedor ni logs de credenciales.
Provisioning, linking/aprobación, roles/ownership, bootstrap Google ADMIN, Sileo,
dependencias, schema, configuración local/cloud y secretos permanecen intactos.
No se crearon tests/casos/suites nuevos: solo se ajustaron las expectativas del
gateway en dos tests existentes, preservando sus assertions de autorización.

Evidencia de soporte: [documentación oficial de password security](https://supabase.com/docs/guides/auth/password-security),
`UserAttributes.current_password` en JS/auth-js 2.116.0 y
[`UserUpdate` de GoTrue v2.196.0](https://github.com/supabase/auth/blob/v2.196.0/internal/api/user.go).
La lectura pública `/auth/v1/health` del runtime local confirmó v2.196.0. Esa
implementación exige contraseña actual únicamente con el control nativo activado,
para una cuenta con password y sesión que no sea recovery. Exime primera
contraseña y recovery por reglas propias; no conoce la aprobación Google interna.
No se ejecutó reproducción ofensiva ni se cambiaron cuentas reales/demo.

CLI 2.117.0 no expone ese control en su
[`emailAuth` TOML](https://github.com/supabase/cli/blob/v2.117.0/apps/cli-go/pkg/config/auth.go).
`secure_password_change` controla reautenticación/nonce, no password actual.
El esquema oficial de Management API sí define el boolean
`security_update_password_require_current_password`; GoTrue self-hosted define
`GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD`. Son nombres verificados,
no una nueva variable de aplicación ni una clave TOML inventada. No se aplicaron.
La lectura filtrada del entorno del contenedor canónico encontró reautenticación
activada y ninguna asignación explícita del control de contraseña actual; no se
inspeccionaron ni imprimieron otros valores. No acredita configuración cloud.

Gate de release separado: después de desplegar source compatible y con la
coordinación autorizada, comprobar soporte/configuración cloud y activar solo
«Require current password when changing password» (o ese boolean de Management
API), preservando todos los demás campos. Verificar cambios legítimos de una
cuenta QA propia con contraseña conocida, recovery real y primera contraseña
Google aprobada. No usar `supabase config push` como sustituto: puede cambiar
otros ajustes y el TOML fijado no representa este control. El runtime local
requiere una vía soportada separada/actualización coordinada; no reiniciarlo ni
reescribir su configuración WIP para simular soporte TOML.

AUTH-1 sigue **abierto/parcial**: enviar el campo no activa enforcement y la
frontera nativa de primera contraseña Google sigue sin cerrar. No se declara
remediación completa ni validación productiva.

Validación local de esta implementación:

- Frozen install, lint, format global, typecheck (0 errores/0 warnings/354 hints),
  build con placeholders sintéticos y `git diff --check`: PASS. La primera
  invocación conjunta alcanzó el timeout del shell durante typecheck; el comando
  dedicado terminó correctamente sin cambio de código.
- Unit focal existente: 9 PASS/83 assertions; integración Auth focal mediante
  runner temporal: 21 PASS/177 assertions (156 filtrados, no skips añadidos).
- E2E existente `dual-auth`, `google-association`, `password-hydration` en Astro
  aislado `4345`: 8/8 PASS, retries=0. Incluye cambio normal/errores, recuperación
  con prueba acotada, primera contraseña Google-only ADMIN y login posterior,
  linking aprobado/no aprobado, fallback HTML y estados del formulario. Es
  proveedor controlado, no Google real ni entrega SMTP/cloud. El control nativo
  de password actual no se activó en esta corrida; no prueba su enforcement.
- Stacks temporales limpiados por runners; app canónica PID 35780 continúa viva.
  API/config versionadas conservan `55321`; el WIP original `54321` queda fuera
  de este worktree y no se modifica. CI/merge se verifican en el PR antes de
  integrarlo; no se promueve a master desde esta implementación.

### DEP-1: versiones corregidas fijadas

Las APIs oficiales de GitHub confirmaron los advisories no retirados y las
releases estables [Sharp 0.35.5](https://github.com/lovell/sharp/releases/tag/v0.35.5)
y [devalue 5.9.3](https://github.com/sveltejs/devalue/releases/tag/v5.9.3).
Astro 7.3.2 requiere Sharp `^0.35.4` opcional y devalue `^5.8.1`;
`@astrojs/react` 6.0.5 requiere devalue `^5.8.1`. Ambas correcciones satisfacen esos
rangos. Overrides exactos en `package.json` y resolución en `bun.lock` actualizan
solo esas dos familias, incluidos binarios Sharp 0.35.5/libvips 1.3.4. No hay
actualización masiva, nueva dependencia directa, cambio de Astro, scripts ni
vendor patch de Sileo.

`bun install --frozen-lockfile` confirmó resolución reproducible y las versiones
efectivas 0.35.5/5.9.3. La coincidencia de versiones vulnerables DEP-1 queda
corregida en esta fuente; no afirma actualización de producción ni ausencia de
otros advisories o de una librsvg instalada globalmente en otro entorno.

### Validación local de esta fuente

- `bun run check`: lint/format/typecheck PASS.
- `bun run test:unit`: 464 PASS, 0 FAIL (4033 assertions).
- `bun run build`: PASS, Astro/Vercel con configuración pública sintética y sin
  acceso a DB canónica.
- 21 pruebas Auth focales existentes: PASS.
- Comparación puntual fuera de Git del servicio Sharp real de Astro entre
  0.35.4 y 0.35.5: 16 transforms (4 anchos × WebP/AVIF × 2 calidades), bytes,
  hashes y dimensiones idénticos en Windows/Node 24. Es input PNG sintético,
  no comparación de imágenes estáticas de producción ni benchmark de carga.
  Los tiempos individuales se conservaron solo como observación, no como
  garantía de rendimiento Linux/cloud. No se cambiaron assets ni encoders.
- Comprobación manual puntual de devalue en Node 24: `stringify`/`parse` y
  `uneval` conservaron solo los 2 bytes visibles de un Buffer sintético con
  backing store compartido, sin serializar el resto del pool.
- E2E focal existente (Google association, password hydration y public courses)
  sobre puerto alternativo 44894, sin retries: **7 PASS / 1 FAIL**. El fallo fue
  `catalog navigation, keyboard focus, and responsive layout`, expectativa de
  foco del skip-link tras Tab; no fue un error de transformación de imagen.
  No se eliminó/modificó assertion, timeout ni test. No se atribuye todavía una
  causa raíz al fallo, ni se declara esa corrida verde.
- `bun run test:integration`: 176 PASS, 0 FAIL, 1 skip preexistente de
  `attendance-flow-fixture` condicionado al fin de semana; no se añadió skip ni
  se modificaron pruebas. 1441 assertions, stack aislado limpiado.
- Checks remotos se verifican en el PR antes del merge; no se infieren de la
  prueba del proveedor o del build.
