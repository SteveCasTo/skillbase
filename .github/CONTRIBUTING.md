# Guía de Contribución a SkillBase

Gracias por tu interés en colaborar con **SkillBase**. Para mantener la coherencia técnica, la calidad del código y la estabilidad de los entornos, seguimos las directrices detalladas a continuación.

---

## 1. Contexto según la tarea

Comienza por [`AGENTS.md`](../AGENTS.md) y consulta únicamente la documentación relacionada con tu tarea. No es necesario leer todos los documentos:

- [`docs/DEVELOPMENT.md`](../docs/DEVELOPMENT.md): Flujo de trabajo diario, comandos de desarrollo y manejo de base de datos.
- [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md): Arquitectura por capas, límites modulares y estructura del repositorio.
- [`docs/TESTING.md`](../docs/TESTING.md): Estrategia de pruebas automatizadas (unitarias, integración aislada y Playwright E2E).
- [`docs/REQUIREMENTS.md`](../docs/REQUIREMENTS.md): Reglas de negocio y criterios de aceptación funcionales.

---

## 2. Flujo de Ramas (Branching Model)

1. **Rama Base de Trabajo**: Toda nueva característica o corrección se bifurca a partir de `development`.
2. **Nombres de Rama**:
   - `feature/nombre-funcionalidad`
   - `fix/nombre-correccion`
   - `chore/tarea-mantenimiento`
   - `refactor/reestructuracion`
   - `docs/documentacion`
   - `test/cobertura`
3. **Rama `master`**: Reservada exclusivamente para código desplegado y validado en producción. **No se realizan pushes directos a `master`**.
4. **Pull Requests**: Los cambios se integran mediante PR hacia `development`. Solo un PR de release de un milestone validado promueve `development` a `master`, según [`docs/DEVELOPMENT.md`](../docs/DEVELOPMENT.md).

---

## 3. Convenciones de Commits

Preferimos **Conventional Commits**, con mensajes en inglés:

- `feat(courses): add course publication flow`
- `fix(attendance): prevent duplicate attendance records`
- `docs: update contribution guidelines`
- `refactor(certificates): extract verification service`
- `test(enrollment): cover cancelled group refunds`
- `chore: update project tooling`

Commits pequeños, cohesivos y atómicos. No mezclar cambios no relacionados en el mismo commit.

---

## 4. Reglas Globales de Código

- **TypeScript Estricto**: Prohibido el uso de `any` salvo justificación técnica extraordinaria debidamente documentada.
- **Límites de Arquitectura**: La lógica de negocio sensible debe ejecutarse y validarse en el servidor; nunca confiar exclusivamente en validaciones del cliente o componentes React.
- **Componentes y Accesibilidad**: Las interfaces deben ser responsivas (mobile-first cuando aplique), con HTML semántico y accesibilidad de foco y teclado.
- **Seguridad**: No versionar secretos, claves privadas ni datos personales en fixtures o seeds.

---

## 5. Quality Gates (Verificación Local)

Antes de enviar un Pull Request, ejecuta las comprobaciones pertinentes y comunica sus resultados y cualquier advertencia o limitación. CI ejecuta los gates definidos en [`ci.yml`](workflows/ci.yml); no se exige un umbral adicional de advertencias que el tooling no implemente.

```sh
# Verificación de formato, linter y tipos
bun run check

# Pruebas unitarias
bun run test:unit

# Build de producción de Astro
bun run build
```

Si tus cambios afectan flujos críticos, ejecuta además las suites completas:

```sh
# Pruebas de integración en stack aislado
bun run test:integration

# Pruebas E2E de Playwright
bun run test:e2e
```
