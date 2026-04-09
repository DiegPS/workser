# Workser — Guía para Claude

## Stack

- React 19 + TypeScript con WXT (Web Extension Toolkit)
- Chrome MV3, target Chrome/Edge
- pnpm como gestor de paquetes
- Sin framework CSS — todo custom en `style.css`

## Estructura clave

```
entrypoints/
  background.ts       → service worker, agrega métricas
  content.ts          → filtrado de tarjetas en LinkedIn/Indeed/Computrabajo
  popup/
    App.tsx           → toda la UI (React, ~900 líneas)
    style.css         → estilos del popup (~1000 líneas)
    main.tsx          → entry point React
```

## Storage keys

| Key | Tipo | Descripción |
|-----|------|-------------|
| `local:blocked_companies` | `string[]` | Empresas bloqueadas |
| `local:blocked_keywords` | `string[]` | Palabras clave bloqueadas |
| `local:workser_whitelist` | `string[]` | Empresas siempre visibles |
| `local:workser_mode` | `"hide"\|"blur"` | Modo de ocultamiento |
| `local:workser_enabled` | `boolean` | On/Off global |
| `local:workser_metrics` | `MetricsStore` | Métricas diarias |
| `local:workser_hidden_count` | `number` | Contador total acumulado |
| `local:workser_metrics_retention_days` | `30\|90\|180` | Retención de datos |

## Comandos de desarrollo

```bash
pnpm dev          # dev server con hot reload
pnpm build        # build producción
pnpm compile      # type check sin emitir
```

---

## Versionado y releases

El proyecto usa **release-it** para versionar y **GitHub Actions** para publicar la release con los zips adjuntos.

### Cómo hacer una release

Desde la rama `main`, con todos los cambios ya commiteados y pusheados:

```bash
pnpm release
```

release-it hará de forma interactiva:
1. Muestra los commits desde la última release
2. Sugiere el tipo de bump según los commits (`feat` → minor, `fix` → patch)
3. Pide confirmación antes de cada paso
4. Edita `package.json` con la nueva versión
5. Actualiza `CHANGELOG.md`
6. Hace commit + tag + push

Tras el push del tag, **GitHub Actions** corre automáticamente y:
- Hace `pnpm zip` y `pnpm zip:firefox`
- Publica la GitHub Release con los zips adjuntos

### Atajos sin preguntas interactivas

```bash
pnpm release:patch   # 0.0.1 → 0.0.2  (bugfixes)
pnpm release:minor   # 0.0.1 → 0.1.0  (nuevas features)
pnpm release:major   # 0.0.1 → 1.0.0  (cambios breaking)
```

### Qué tipo de bump usar según los commits

| Commits desde última release | Bump |
|------------------------------|------|
| Solo `fix:`, `style:`, `docs:` | **patch** |
| Al menos un `feat:` | **minor** |
| Cambio que rompe compatibilidad | **major** |

### Convención de commits (SIEMPRE usar)

```
feat: descripción      → nueva funcionalidad
fix: descripción       → corrección de bug
style: descripción     → cambios visuales/CSS
docs: descripción      → documentación
refactor: descripción  → refactor sin cambio de comportamiento
perf: descripción      → mejora de rendimiento
chore: descripción     → tareas de mantenimiento (no aparece en changelog)
```

### Flujo completo de ejemplo

```bash
# 1. Trabajas normalmente
git commit -m "feat: agregar soporte para Glassdoor"
git commit -m "fix: whitelist no funcionaba en Indeed"
git push

# 2. Cuando quieres publicar
pnpm release
# → release-it sugiere: minor (por el feat:)
# → confirmas con Enter en cada paso
# → push automático del tag v0.1.0
# → GitHub Actions publica la release con los zips
```

### Archivos relacionados con el versionado

- `.release-it.json` → configuración de release-it
- `.github/workflows/release.yml` → workflow que publica los zips
- `CHANGELOG.md` → generado automáticamente, no editar a mano
