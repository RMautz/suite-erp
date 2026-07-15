# Diseño: Rediseño de páginas de inicio — landing del portal + dashboard del ERP

**Fecha:** 2026-07-14
**Estado:** Aprobado por el usuario (maqueta v2 "colores vivos" aprobada visualmente — artifact `4bebc90c`, label `maqueta-v2-colores-vivos`)
**Alcance:** UI solamente — CERO migraciones, CERO dependencias nuevas. Los datos del dashboard salen de vistas existentes (Planes 4-7).

## 1. Propósito

Darle a Suite ERP una cara comercial (la landing hoy son 10 líneas sin estilo) y un dashboard que muestre el negocio de un vistazo (hoy son 4 tarjetas planas), con la dirección estética aprobada: **sobrio profesional con colores vivos** — azul eléctrico, gradientes puntuales, semáforo intenso en los KPIs.

## 2. Decisiones fundacionales (aprobadas por el usuario)

| Decisión | Elección |
|---|---|
| Alcance | Ambas páginas: landing del portal (web) + dashboard del ERP |
| Estética | Sobrio profesional + colores vivos (maqueta v2 aprobada = referencia visual vinculante) |
| Paleta | La escala `marca` de `packages/ui/src/tema.css` pasa del azul petróleo al **azul eléctrico** (escala sky de Tailwind). TODA la app la hereda — es un swap de tokens |
| Gráficos | CSS puro (divs proporcionales) — sin librería de charts |
| Precios en landing | Estáticos en el código (comentario apunta a la tabla `planes` como fuente de verdad; leer de BD requeriría grant a anon — innecesario por ahora) |
| Botones | `@suite/ui` `Boton` NO cambia de forma (hereda el nuevo azul por tokens); los botones con gradiente son estilos LOCALES de la landing |

## 3. Cambio de paleta (packages/ui/src/tema.css)

Reemplazar los valores de `--color-marca-50 … 950` por la escala sky de Tailwind:
`50 #f0f9ff · 100 #e0f2fe · 200 #bae6fd · 300 #7dd3fc · 400 #38bdf8 · 500 #0ea5e9 · 600 #0284c7 · 700 #0369a1 · 800 #075985 · 900 #0c4a6e · 950 #082f49`.
Ningún otro token cambia. Efecto: botones, insignias, links, sidebar y focos de toda la app se avivan sin tocar componentes.

## 4. Landing del portal (`apps/web`)

Página única server-rendered, estática, responsive, sin JS cliente adicional. Estructura (fiel a la maqueta v2):

1. **Header**: logo (cuadrado con gradiente azul + "Suite ERP") · nav con anclas (Módulos, Precios) · "Iniciar sesión" (/login) + CTA "Prueba gratis" (/registro, botón con gradiente azul→cian y sombra).
2. **Hero** (fondo con wash radial celeste): H1 "El ERP para pymes chilenas: ventas, facturación SII e inventario en un solo lugar" (con "facturación SII" en gradiente de texto azul→cian) · subtítulo · CTAs "Prueba gratis 14 días" + "Ver precios" (ancla) · nota "Sin tarjeta de crédito · Cancela cuando quieras" · **maqueta decorativa del dashboard** en CSS (3 mini-KPIs + mini-barras con gradiente), `aria-hidden`.
3. **Módulos** (`id="modulos"`): 6 tarjetas con ícono SVG inline sobre fondo tintado (azul=Ventas DTE, cian=Inventario, ámbar=Compras, verde=Cobranza, violeta=Reportes SII, rosa=Multi-empresa), título y una línea de descripción. Hover: borde celeste.
4. **Precios** (`id="precios"`): Básico $29.990 / **Pro $49.990 destacado** ("Más elegido", borde azul, fondo degradado suave, sombra) / Empresa $89.990 — "/ mes + IVA", bullets con ✓ verde, CTA a /registro.
5. **CTA final**: banda con gradiente azul→cian, "Deja las planillas hoy", botón blanco.
6. **Footer**: © Suite ERP · contacto@suite-erp.cl.

Archivos: `apps/web/app/page.tsx` (composición) + `apps/web/componentes/landing/` (`hero.tsx`, `modulos.tsx`, `precios.tsx` — presentacionales puros, cero fetching). Copy en español chileno, exactamente el de la maqueta.

## 5. Dashboard del ERP (`apps/erp/app/page.tsx` — reescritura)

Un único `Promise.all` sobre vistas/tablas existentes, todas `.eq('empresa_id', activa.id)`:

- **Fila KPI (4 tarjetas con borde izquierdo de color y cifra coloreada):**
  - *Ventas de hoy* (verde esmeralda `emerald-600`): `ventas_diarias` con `fecha = hoy` — total y n° documentos.
  - *Ventas del mes* (azul marca): suma de `ventas_diarias` del mes actual (`rangoDeMes`).
  - *Por cobrar vencido* (rojo `red-600`): lógica existente sobre `saldos_documentos` (se conserva), link a `/cobranza?vencidas=1`.
  - *Stock crítico* (ámbar `amber-600`): lógica existente (se conserva), link a `/productos`.
- **Gráfico "Ventas últimos 14 días"**: `ventas_diarias` del rango `[hoy−13, hoy]` (14 días, hoy incluido); barras CSS (`div` con altura % del máximo del rango, gradiente azul; la barra de HOY en gradiente verde), etiqueta con el día del mes bajo cada barra y `title` con el monto exacto. Días sin ventas = barra de altura mínima. Rango completo sin ventas → estado vacío "Aún sin ventas en los últimos 14 días".
- **"Top 5 productos del mes"**: `ventas_por_producto` del mes agregada por producto (mismo reduce del reporte), barras horizontales proporcionales al subtotal (pista gris, relleno gradiente azul→cian), monto con `formatearCLP`. Vacío → "Aún sin ventas este mes".
- **Accesos rápidos (4)**: Nueva venta (`/ventas/nueva`) · Registrar pago (`/cobranza/pagos/nuevo`) · Orden de compra (`/compras/nueva`) · Movimiento (`/inventario/movimientos`) — tarjetas con borde discontinuo celeste.
- **Se conservan tal cual**: banners de trial/suspendida, `Encabezado` con razón social + RUT.

Componentes presentacionales nuevos (reciben datos, cero fetching): `apps/erp/componentes/kpi.tsx` y `apps/erp/componentes/grafico-barras.tsx`. Guards `?? 0` sobre columnas nullable de vistas (precedente establecido). Sin divisiones por cero (máximo del rango con `Math.max(1, …)`).

## 6. Manejo de errores y estados

Empresa sin datos → estados vacíos amables en gráfico y top (nunca crash ni NaN); queries fallidas siguen el precedente del repo (data-only). La landing no consulta nada. Fechas "hoy"/mes en UTC (deuda repo-wide conocida).

## 7. Testing

- `pnpm build` de web y erp (las dos páginas compilan).
- E2E ligero (script): dashboard renderiza los 4 KPIs y el gráfico con la demo sembrada; landing responde 200 con los textos clave (hero, precios).
- Verificación visual final con Playwright (screenshots de ambas páginas) en la demo con el usuario.
- Sin pgTAP (no hay SQL nuevo) ni unit nuevos (componentes presentacionales sin lógica; el reduce del top reusa el patrón ya probado del reporte).

## 8. Fuera de v1 (YAGNI)

Páginas por producto/módulo, blog, testimonios, librería de charts, dark mode, animaciones de scroll, i18n, leer precios desde la BD, personalización del dashboard por usuario.

## 9. Criterio de éxito

Un visitante entiende qué es Suite ERP, ve los módulos y precios y llega al registro en un clic; un usuario del ERP abre Inicio y ve — sin navegar — cuánto vendió hoy y en el mes, la curva de los últimos 14 días, sus productos top, cuánto le deben vencido y qué stock está crítico, con accesos de un clic a las 4 acciones más frecuentes. Toda la app luce la paleta viva nueva de forma coherente.
