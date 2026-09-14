# AGENTS

Este archivo es el punto de entrada para agentes de IA y colaboradores automatizados que trabajen en el repositorio.

Su objetivo no es duplicar la documentación completa, sino indicar las reglas globales y dirigir hacia el documento adecuado según la tarea.

## REGLA PRINCIPAL DE CONTEXTO

**No leer todos los archivos de documentación por defecto.**

Antes de realizar una tarea:

1. Identificar qué área del sistema se modifica.
2. Leer únicamente los documentos estrictamente necesarios.
3. Evitar cargar información no relacionada con la tarea.
4. Consultar documentación adicional solo si aparece una dependencia real.

El contexto del agente es un recurso limitado. No consumirlo con documentación irrelevante.

## MAPA DE DOCUMENTACIÓN

### Arquitectura o estructura del proyecto

Leer:

- `docs/ARCHITECTURE.md`

Si se toma o modifica una decisión arquitectónica:

- `docs/DECISIONS.md`

### UI, UX, componentes, estilos o responsive

Leer:

- `docs/DESIGN.md`

### Requisitos o reglas de negocio

Leer:

- `README.md`
- `docs/REQUIREMENTS.md`

Leer `README.md` únicamente cuando se requiera contexto general del producto.

### Base de datos, entidades, relaciones o migraciones

Leer:

- `docs/DATA_MODEL.md`
- `docs/ARCHITECTURE.md` cuando la tarea afecte límites entre módulos.

### Autenticación, sesiones o Google OAuth

Leer:

- `docs/AUTHENTICATION.md`
- `docs/SECURITY.md` si la tarea modifica permisos o exposición de datos.

### Testing

Leer:

- `docs/TESTING.md`

Si el test cubre una regla de negocio compleja:

- `docs/REQUIREMENTS.md`

### Seguridad

Leer:

- `docs/SECURITY.md`

### Certificados

Leer:

- `docs/CERTIFICATES.md`

### CI/CD, Vercel, Supabase Cloud o GitHub Actions

Leer:

- `docs/DEPLOYMENT.md`

### Flujo de desarrollo, ramas o commits

Leer:

- `docs/DEVELOPMENT.md`

### Orden de implementación

Leer:

- `docs/PLAN.md`

## REGLAS GLOBALES

Estas reglas aplican a cualquier cambio.

### Código

- Usar TypeScript estricto.
- No usar `any` salvo justificación excepcional.
- Evitar duplicación.
- Mantener funciones pequeñas y con responsabilidad clara.
- No introducir abstracciones sin necesidad.
- La lógica de negocio no debe vivir en componentes React.
- La lógica de negocio no debe depender de la capa HTTP.
- Los componentes UI no deben acceder directamente a PostgreSQL.
- Toda operación sensible debe validarse en servidor.
- Mantener límites claros entre dominio, aplicación, infraestructura y presentación.

### Desarrollo

- Trabajar normalmente sobre `development` mediante ramas de feature/fix/chore.
- No desarrollar directamente sobre `master`.
- Mantener commits pequeños y cohesivos.
- No mezclar cambios no relacionados en el mismo commit.
- Usar mensajes de commit en inglés.
- Preferir Conventional Commits.
- Ejecutar las pruebas correspondientes antes de finalizar una tarea.
- Actualizar documentación cuando cambie comportamiento, arquitectura o una regla relevante.

### Testing

- Implementación y pruebas deben avanzar juntas.
- No esperar al final del proyecto para añadir cobertura.
- Las pruebas deben validar resultados y comportamiento observable.
- Evitar E2E frágiles acoplados a detalles visuales innecesarios.
- Si una característica cambia deliberadamente la UI, actualizar únicamente las pruebas cuya expectativa dejó de ser válida.
- Nunca modificar tests únicamente para ocultar un defecto real.

### UI/UX

- Toda interfaz debe ser responsive.
- Mobile-first cuando corresponda.
- Mantener HTML semántico.
- Mantener accesibilidad de teclado y foco.
- Usar componentes del design system.
- Evitar APIs nativas como `alert`, `confirm` o `prompt`.
- Evitar selects nativos cuando el design system tenga una alternativa adecuada.
- Evitar tablas como única representación de información crítica en mobile.
- Evitar modales para formularios extensos.
- Proporcionar estados de loading, empty, success y error.
- Preferir skeletons para cargas estructurales.
- Usar toast solamente para información transitoria.

### Seguridad

- No confiar en controles del frontend para autorización.
- Verificar roles y ownership en servidor.
- Validar MIME, extensión, tamaño y finalidad de archivos.
- No exponer secretos al cliente.
- No almacenar credenciales en Git.
- No usar datos reales sensibles en seeds o fixtures.
- Toda ruta privada debe validar sesión y permisos.
- Evitar exposición innecesaria de datos personales en páginas públicas.

## SKILLS Y HERRAMIENTAS ESPECIALIZADAS

El repositorio o el entorno del agente puede contener skills especializadas, por ejemplo:

- Supabase CLI.
- Vercel.
- GitHub.
- Playwright.
- Frontend design.
- UI quality.
- Security.
- Database migrations.
- Accessibility.

No cargar skills de forma preventiva.

Usar una skill únicamente cuando la tarea actual requiera conocimiento especializado que dicha skill proporcione.

## ANTES DE IMPLEMENTAR

Verificar:

1. Qué requisito resuelve el cambio.
2. Qué módulo es responsable.
3. Si ya existe una utilidad o componente reutilizable.
4. Qué pruebas deben añadirse o modificarse.
5. Si afecta documentación.
6. Si afecta seguridad o permisos.
7. Si afecta responsive o accesibilidad.
8. Si requiere migración.

## ANTES DE FINALIZAR

Siempre que corresponda:

- Ejecutar formatter.
- Ejecutar lint.
- Ejecutar typecheck.
- Ejecutar tests relacionados.
- Ejecutar build.
- Confirmar que no existen archivos temporales o secretos.
- Confirmar que no se introdujeron dependencias innecesarias.
- Revisar cambios de documentación.
