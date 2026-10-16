---
version: 1
slug: "src-pages-404-astro"
primary_target: "src/pages/404.astro"
related_targets: []
---

# Página global no encontrada

Modo Operate: identificar la ruta ausente y volver al inicio, sin explicaciones redundantes.

## Direction contract

**THESIS:** La ilustración de linterna/roca 404 aportada por el usuario es el único gesto visual. No añade navegación, badges ni paneles redundantes.

**OWN-WORLD:** Extensión del sistema existente: Montserrat, colores semánticos globales light/dark y acción delineada del design system. Se preservan transparencia, luz, composición y color del archivo original. La variante delineada mantiene el contraste del texto de primer plano sin alterar los tokens globales.

**STORY:** El visitante reconoce la ausencia mediante la imagen y el título «Página no encontrada»; «Volver al inicio» es la única acción.

**FIRST VIEWPORT:** Composición centrada verticalmente: ilustración completa de hasta 832 px, título y acción separados por 24 px; padding responsive de 16 px y altura mínima de viewport. La imagen reserva dimensiones y selecciona un WebP de 640 o 1280 px sin hidratación.

**FORM:** Dirección acotada explícita del usuario, sin exploración de identidad ni comp nuevo. Página Astro nativa con HTTP 404, noindex y layout base existente; los guards privados y estados de dominio permanecen intactos.

**FINISH:** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
