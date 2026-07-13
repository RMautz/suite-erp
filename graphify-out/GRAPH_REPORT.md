# Graph Report - .  (2026-07-08)

## Corpus Check
- 147 files · ~71,567 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 404 nodes · 679 edges · 38 communities (26 shown, 12 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- CRUD Clientes ERP
- Formularios y Tipos ERP
- Middleware y Clientes Supabase
- Dependencias App Admin
- Config Monorepo Raiz
- Dependencias App ERP
- Dependencias App (server-only)
- Dependencias App Web
- Core Maestros (validacion filas)
- Config Paquete UI
- TSConfig Base
- TSConfig App A
- TSConfig App B
- Auth Portal (login/registro)
- TSConfig App C
- Config Paquete Core
- Config Paquete DB
- Panel Admin (activar/suspender)
- Calculo IVA/CLP
- TSConfig UI
- Parser CSV
- Layout App A
- Layout App B
- TSConfig D
- TSConfig E
- TSConfig F
- Next Config A
- Next Env Types A
- Next Config B
- Next Env Types B
- Next Config C
- Next Env Types C

## God Nodes (most connected - your core abstractions)
1. `crearClienteServidor()` - 31 edges
2. `obtenerEmpresaActiva()` - 29 edges
3. `cn()` - 19 edges
4. `compilerOptions` - 12 edges
5. `formatearRut()` - 11 edges
6. `validarRut()` - 10 edges
7. `Encabezado()` - 10 edges
8. `dominioCookie()` - 8 edges
9. `limpiarRut()` - 8 edges
10. `Boton()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `importarProductos()` --indirect_call--> `validarFilaProducto()`  [INFERRED]
  apps/erp/app/importar/acciones.ts → packages/core/src/maestros.ts
- `importarClientes()` --indirect_call--> `validarFilaCliente()`  [INFERRED]
  apps/erp/app/importar/acciones.ts → packages/core/src/maestros.ts
- `PanelAdmin()` --calls--> `formatearRut()`  [EXTRACTED]
  apps/admin/app/page.tsx → packages/core/src/rut.ts
- `verificarAdmin()` --calls--> `crearClienteServidor()`  [EXTRACTED]
  apps/admin/lib/guardia.ts → packages/auth/src/server.ts
- `middleware()` --calls--> `actualizarSesion()`  [EXTRACTED]
  apps/admin/middleware.ts → packages/auth/src/middleware.ts

## Import Cycles
- None detected.

## Communities (38 total, 12 thin omitted)

### Community 0 - "CRUD Clientes ERP"
Cohesion: 0.14
Nodes (29): cambiarEmpresaActiva(), alternarActivoCliente(), guardarCliente(), EditarCliente(), NuevoCliente(), PaginaClientes(), filasComoObjetos(), importarClientes() (+21 more)

### Community 1 - "Formularios y Tipos ERP"
Cohesion: 0.14
Nodes (25): EstadoForm, ResultadoImport, ClienteEditable, VACIO, FormularioImportar(), CategoriaOpcion, ProductoEditable, VACIO (+17 more)

### Community 2 - "Middleware y Clientes Supabase"
Cohesion: 0.12
Nodes (18): config, middleware(), config, middleware(), crearClienteNavegador(), dominioCookie(), OpcionesCookie, actualizarSesion() (+10 more)

### Community 3 - "Dependencias App Admin"
Cohesion: 0.08
Nodes (24): dependencies, server-only, @suite/db, @supabase/ssr, @supabase/supabase-js, devDependencies, next, @types/node (+16 more)

### Community 4 - "Config Monorepo Raiz"
Cohesion: 0.08
Nodes (22): devDependencies, supabase, turbo, typescript, engines, node, name, packageManager (+14 more)

### Community 5 - "Dependencias App ERP"
Cohesion: 0.09
Nodes (22): dependencies, next, react, react-dom, @suite/auth, @suite/core, @suite/db, @suite/ui (+14 more)

### Community 6 - "Dependencias App (server-only)"
Cohesion: 0.10
Nodes (20): dependencies, next, react, react-dom, server-only, @suite/auth, @suite/core, @suite/db (+12 more)

### Community 7 - "Dependencias App Web"
Cohesion: 0.10
Nodes (19): dependencies, next, react, react-dom, @suite/auth, @suite/core, @suite/db, devDependencies (+11 more)

### Community 8 - "Core Maestros (validacion filas)"
Cohesion: 0.23
Nodes (15): AFIRMATIVOS, FilaCliente, FilaProducto, formatearCLP(), NEGATIVOS, opcional(), parsearBooleano(), parsearPrecioCLP() (+7 more)

### Community 9 - "Config Paquete UI"
Cohesion: 0.13
Nodes (14): devDependencies, next, react, @types/react, typescript, exports, ./tema.css, name (+6 more)

### Community 10 - "TSConfig Base"
Cohesion: 0.15
Nodes (12): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, lib, module, moduleResolution, noUncheckedIndexedAccess (+4 more)

### Community 11 - "TSConfig App A"
Cohesion: 0.17
Nodes (11): compilerOptions, allowJs, incremental, jsx, noEmit, paths, plugins, exclude (+3 more)

### Community 12 - "TSConfig App B"
Cohesion: 0.17
Nodes (11): compilerOptions, allowJs, incremental, jsx, noEmit, paths, plugins, exclude (+3 more)

### Community 13 - "Auth Portal (login/registro)"
Cohesion: 0.32
Nodes (7): iniciarSesion(), inicial, PaginaLogin(), registrar(), inicial, PaginaRegistro(), EstadoForm

### Community 14 - "TSConfig App C"
Cohesion: 0.17
Nodes (11): compilerOptions, allowJs, incremental, jsx, noEmit, paths, plugins, exclude (+3 more)

### Community 15 - "Config Paquete Core"
Cohesion: 0.17
Nodes (11): devDependencies, typescript, vitest, main, name, private, scripts, test (+3 more)

### Community 16 - "Config Paquete DB"
Cohesion: 0.17
Nodes (11): devDependencies, supabase, typescript, main, name, private, scripts, gen (+3 more)

### Community 17 - "Panel Admin (activar/suspender)"
Cohesion: 0.51
Nodes (6): activarOrganizacion(), cambiarEstado(), suspenderOrganizacion(), PanelAdmin(), verificarAdmin(), clienteAdmin()

### Community 18 - "Calculo IVA/CLP"
Cohesion: 0.43
Nodes (5): calcularTotales(), ivaDesdeNeto(), LineaVenta, netoDesdeBruto(), Totales

### Community 19 - "TSConfig UI"
Cohesion: 0.40
Nodes (4): compilerOptions, jsx, extends, include

## Knowledge Gaps
- **195 isolated node(s):** `metadata`, `config`, `config`, `name`, `version` (+190 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **12 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `crearClienteServidor()` connect `CRUD Clientes ERP` to `Panel Admin (activar/suspender)`, `Middleware y Clientes Supabase`, `Auth Portal (login/registro)`, `Formularios y Tipos ERP`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Why does `dominioCookie()` connect `Middleware y Clientes Supabase` to `CRUD Clientes ERP`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **Why does `Database` connect `Middleware y Clientes Supabase` to `CRUD Clientes ERP`, `Panel Admin (activar/suspender)`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **What connects `metadata`, `config`, `NOTE: This file should not be edited` to the rest of the system?**
  _198 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `CRUD Clientes ERP` be split into smaller, more focused modules?**
  _Cohesion score 0.13636363636363635 - nodes in this community are weakly interconnected._
- **Should `Formularios y Tipos ERP` be split into smaller, more focused modules?**
  _Cohesion score 0.1353658536585366 - nodes in this community are weakly interconnected._
- **Should `Middleware y Clientes Supabase` be split into smaller, more focused modules?**
  _Cohesion score 0.11692307692307692 - nodes in this community are weakly interconnected._