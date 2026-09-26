# ARCHITECTURE

## OBJETIVO

Definir la arquitectura técnica del sistema, responsabilidades entre capas, estructura del repositorio y reglas para mantener el código desacoplado y mantenible.

## ESTILO ARQUITECTÓNICO

El sistema inicia como un **monolito modular full-stack**.

No se utilizará un backend independiente mientras no exista una necesidad concreta de:

- múltiples clientes independientes;
- API pública significativa para terceros;
- integraciones institucionales complejas;
- procesamiento asíncrono especializado;
- escalado independiente;
- despliegues independientes entre frontend y backend.

Astro actuará como host de la aplicación web y de la capa server-side.

## STACK

### Runtime y tooling

- Bun.

Responsabilidades:

- instalar dependencias;
- ejecutar scripts;
- ejecutar herramientas;
- ejecutar tests unitarios cuando corresponda.

Vite no se considera runtime ni package manager del proyecto. Astro ya utiliza Vite internamente.

### Frontend

- Astro.
- React para componentes interactivos.
- Tailwind CSS.
- shadcn/ui.

Astro debe ser la opción por defecto para contenido estático o renderizado en servidor.

React debe utilizarse cuando exista interacción real del lado cliente.

No convertir páginas completas en React sin necesidad.

### Backend integrado

Astro server-side manejará:

- server actions;
- endpoints;
- coordinación de casos de uso;
- autorización;
- acceso a servicios;
- generación de respuestas.

Los endpoints no deben contener lógica de negocio extensa.

### Base de datos

- PostgreSQL mediante Supabase.
- Drizzle ORM como capa de acceso tipada.

Drizzle se utilizará para:

- schema de aplicación;
- queries;
- repositories;
- migraciones según la estrategia definida.

No acceder directamente a tablas desde componentes React.

### Supabase

Se utilizará para:

- PostgreSQL.
- Auth.
- Google OAuth.
- Storage.
- desarrollo local reproducible mediante Supabase CLI + Docker.

Supabase Realtime no debe utilizarse salvo que exista un caso de uso concreto.

### Storage

Los archivos deben clasificarse por sensibilidad y finalidad.

Ejemplos:

Privados:

- documentos administrativos;
- boletas;
- respaldos;
- certificados aún no emitidos;
- archivos internos.

Públicos o verificables:

- certificados emitidos cuando la política lo permita.

La existencia de un archivo en Storage no determina por sí sola su autorización.

## CAPAS

### Presentation

Responsable de:

- páginas Astro;
- componentes React;
- formularios;
- composición visual;
- interacción del usuario.

No debe contener reglas de negocio.

### Application

Responsable de casos de uso.

Ejemplos:

- CreateCourse.
- PublishCourse.
- CreateGroup.
- RegisterParticipant.
- RecordAttendance.
- ConfigureAssessmentPlan.
- RecordGrade.
- CloseGroup.
- IssueCertificate.
- RevokeCertificate.

### Domain

Responsable de:

- reglas de negocio;
- invariantes;
- políticas;
- cálculos;
- estados.

Debe poder probarse con la menor dependencia de infraestructura posible.

### Infrastructure

Responsable de:

- Drizzle;
- PostgreSQL;
- Supabase;
- Storage;
- generación de archivos;
- servicios externos;
- logging;
- integración OAuth.

## MÓDULOS

La aplicación debe mantener límites claros.

Módulos iniciales:

- Auth
- Users
- Courses
- Groups
- Participants
- PreRegistrations
- Enrollments
- Sessions
- Attendance
- Assessments
- Grades
- Payments
- Refunds
- Certificates
- Audit

No es obligatorio que cada módulo sea un package independiente.

El objetivo es separación lógica.

## ESTRUCTURA DE REFERENCIA

```text
src/
├── components/
│   ├── ui/
│   └── shared/
├── layouts/
├── pages/
│   ├── app/
│   ├── cursos/
│   ├── certificados/
│   └── api/
├── features/
│   ├── courses/
│   ├── groups/
│   ├── participants/
│   ├── enrollments/
│   ├── attendance/
│   ├── assessments/
│   ├── certificates/
│   └── ...
├── server/
│   ├── auth/
│   ├── db/
│   │   ├── schema/
│   │   ├── repositories/
│   │   └── migrations/
│   ├── services/
│   ├── policies/
│   └── storage/
├── domain/
│   ├── rules/
│   ├── types/
│   └── errors/
├── lib/
├── styles/
└── test/
```

La estructura puede evolucionar.

No crear directorios vacíos únicamente por seguir este ejemplo.

## RUTAS PÚBLICAS Y PRIVADAS

### Públicas

Ejemplos:

- `/`
- `/cursos`
- `/cursos/[slug]`
- `/preinscripcion/[slug]`
- `/certificados/[code]`
- `/login`

### Privadas

Ejemplos:

- `/app`
- `/app/cursos`
- `/app/grupos`
- `/app/asistencia`
- `/app/evaluaciones`
- `/app/certificados`

Toda ruta privada debe validar sesión y autorización server-side.

## LÓGICA DE NEGOCIO

Ejemplo de flujo incorrecto:

```text
React component
→ db.insert(...)
```

Flujo esperado:

```text
React/Astro
→ action/endpoint
→ application service
→ repository
→ Drizzle
→ PostgreSQL
```

## TRANSACCIONES

Utilizar transacciones cuando una operación requiera consistencia entre múltiples escrituras.

Ejemplos:

- confirmar inscripción;
- cerrar grupo;
- emitir certificado;
- registrar devolución y actualizar estado relacionado.

No dividir artificialmente una operación atómica entre múltiples requests.

## ESTADOS Y ENUMS

Los estados importantes deben modelarse explícitamente.

Para Fase 2A, el curso usa únicamente:

- `DRAFT`;
- `PUBLISHED`;
- `ARCHIVED`.

La disponibilidad de preinscripción (`UNAVAILABLE`, `UPCOMING`, `OPEN`, `CLOSED`) se deriva de la ventana de fechas y no es un estado persistido. Los estados operativos de grupos y el resto del ciclo académico quedan para fases posteriores.

Grupo:

- planned
- open
- confirmed
- cancelled
- in_progress
- completed

Certificado:

- pending
- generated
- awaiting_signature
- issued
- revoked
- replaced

La lista definitiva debe mantenerse en el modelo de datos.

## ERRORES

Definir errores de dominio y aplicación diferenciados.

No mostrar errores internos de PostgreSQL al usuario.

Los mensajes públicos deben ser comprensibles.

Los logs internos deben conservar contexto técnico suficiente sin incluir secretos.

## AUDITORÍA

Operaciones sensibles deben ser auditables.

Ejemplos:

- cambios de nota;
- cambios de asistencia;
- confirmación de inscripción;
- aplicación de descuento;
- devolución;
- emisión de certificado;
- revocación;
- cambios de rol.

## MÓDULO COURSES EN FASE 2

El flujo implementado conserva los límites del monolito modular:

```text
páginas Astro SSR
→ casos de uso Courses
→ validación y políticas de dominio
→ CourseRepository
→ Drizzle/PostgreSQL
```

Las páginas administrativas hacen render server-side y usan POST tradicional como base sin JavaScript. La edición de campos de formato y el guardado del formulario de curso utilizan `fetch` con respuestas JSON cuando hay JavaScript: conservan el formulario, actualizan el token de revisión optimista y muestran errores sin navegar. El servidor reutiliza los mismos casos de uso, validación y autorización que para POST HTML. Cada escritura vuelve a verificar origen y autorización `ADMIN`; el middleware registra de forma explícita las rutas de cursos y formatos y mantiene el comportamiento fail-closed para cualquier otra ruta `/app`. El constructor/recortador de imágenes es una isla React acotada a la interacción que la necesita.

`DrizzleCourseRepository` agrupa curso y auditoría en transacción; los términos comerciales se resuelven desde la revisión inmutable de formato referenciada por el curso. `DrizzleFormatRepository` crea y revisa formatos, conserva auditoría, mueve cursos `DRAFT` a la revisión vigente y deja intactas revisiones de cursos publicados/archivados. La migración versionada reconstruye formatos a partir de las tuplas históricas de duración y precios y elimina los campos/tablas directos al completar la migración.

El contrato administrativo incluye campos operativos; el contrato público independiente se construye solo desde filas `PUBLISHED`, omite estado, nota mínima, IDs y timestamps administrativos, y deriva disponibilidad de la ventana en tiempo de lectura. `/` y `/cursos` cargan catálogo SSR en cada solicitud; `/cursos/[slug]` consulta detalle publicado y responde 404 para no-publicados e inexistentes. La landing elige el destacado único si existe y usa un fallback determinista si no.

El contenido Markdown del curso se interpreta mediante un parser de nodos permitidos y se renderiza sin insertar HTML arbitrario; destinos de enlaces pasan por allowlist. El horario se conserva como texto legado: un constructor de días/horas ayuda a producirlo, pero no crea un calendario estructurado ni sesiones operativas. Instructor es texto, no una relación de identidad.

El editor de artwork produce una imagen WebP recortada y la envía a un endpoint SSR. El endpoint exige origen esperado, sesión/usuario activo y rol `ADMIN`, limita tamaño, comprueba MIME/extensión y dimensiones/contenedor WebP y sube con credencial service-role solo en servidor al bucket público `course-artwork`. Las filas guardan una key de formato canónico vinculada al curso, no una URL proporcionada por el cliente; la URL pública se genera desde el host Supabase configurado. El bucket se verifica/crea con política pública de lectura y escritura solo server-side mediante privilegio privilegiado.

Los formularios `datetime-local` representan exclusivamente tiempo civil de `America/La_Paz`. La conversión pura de dominio aplica UTC-04 —Bolivia no utiliza horario de verano— tanto al persistir instantes UTC como al volver a editar, sin depender del timezone del proceso. La edición envía `updatedAt` como revisión optimista y el repositorio rechaza escrituras obsoletas. La asignación de slugs se serializa con un advisory lock transaccional global y estable para evitar colisiones incluso entre bases solapadas como `foo` y `foo-2`.

## CRITERIOS PARA EXTRAER UN BACKEND

Considerar Elysia + Bun únicamente cuando aparezca al menos una necesidad real:

- múltiples aplicaciones cliente;
- API externa estable;
- integraciones externas complejas;
- workers especializados;
- necesidad clara de escalar backend y frontend independientemente.

No extraer backend por anticipación.

## AUTH EN EL MONOLITO MODULAR

La Fase 1 mantiene los límites siguientes:

```text
middleware/endpoints Astro
→ casos de uso Auth
→ políticas y errores de dominio
→ AuthUserRepository
→ Drizzle/PostgreSQL
```

La integración Supabase SSR vive en infraestructura server-side y se instancia por request únicamente en rutas dependientes de sesión. El middleware clasifica antes de inicializar dependencias: las rutas públicas ordinarias no crean contexto Auth; `/auth/**` recibe el cliente SSR ligado a cookies; `/login` y `/app/**` resuelven identidad y usuario interno. `Astro.locals` modela ese contexto como opcional y los consumidores protegidos lo exigen mediante assertions server-side. Los guards de ruta reutilizan políticas de aplicación, mantienen autorización fail-closed y la navegación solo refleja permisos ya evaluados.

La conexión `DATABASE_URL` corresponde al runtime y puede apuntar a un pooler compatible con serverless. `MIGRATION_DATABASE_URL` prioriza una conexión directa para Drizzle Kit. En local ambas apuntan a `127.0.0.1:54322`.

La configuración de base y la configuración pública de Auth se validan mediante accessors separados. Las lecturas de oferta pública reutilizan el singleton Drizzle y reintentan exclusivamente `listPublic` ante causas transitorias reconocidas, con tres intentos totales (esperas de 150 ms y 400 ms); errores de configuración, permisos, schema, validación y escrituras no se reintentan.
