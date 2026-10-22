## Resumen del cambio

<!-- Describe de forma concisa qué problema resuelve este Pull Request o qué funcionalidad incorpora. -->

-

## Tipo de cambio

- [ ] `feat`: Nueva funcionalidad
- [ ] `fix`: Corrección de defecto o bug
- [ ] `refactor`: Refactorización de código sin cambio de comportamiento
- [ ] `perf`: Optimización de rendimiento
- [ ] `chore`: Tareas de mantenimiento, dependencias o configuración
- [ ] `docs`: Actualización o incorporación de documentación
- [ ] `test`: Incorporación o ajuste de pruebas automatizadas

## Alcance y restricciones

<!-- Especifica qué partes del sistema fueron modificadas y verifica que no se introduzcan efectos colaterales no deseados. -->

<!-- Marca solo lo comprobado. Indica «No aplica» y el motivo para restricciones o verificaciones ajenas al alcance (por ejemplo, un PR solo de documentación). No declares como aprobada una comprobación omitida o fallida. -->

- [ ] Lógica de negocio validada en servidor (no solo en componentes React/UI).
- [ ] Tipado estricto en TypeScript (sin uso injustificado de `any`).
- [ ] Interfaz accesible y responsive (mobile-first cuando aplica).
- [ ] Sin exposición de secretos ni credenciales en código versionado.

## Verificación y Quality Gates

Marca las comprobaciones locales completadas exitosamente antes de solicitar revisión:

- [ ] `bun run format:check` (verificación sin modificar archivos)
- [ ] `bun run lint` (sin errores; documentar advertencias si aparecen)
- [ ] `bun run typecheck` (`astro check` sin errores)
- [ ] `bun run test:unit` (pruebas unitarias aprobadas)
- [ ] `bun run build` (build de producción completado)
- [ ] Pruebas de integración o E2E ejecutadas si el cambio afectó flujos críticos (`bun run test:integration` / `bun run test:e2e`).

## Issues relacionados

<!-- Enlaza los issues que este PR resuelve o cierra automáticamente. Ej: Closes #123 -->

<!-- Si no hay un issue asociado, omite esta sección. -->
