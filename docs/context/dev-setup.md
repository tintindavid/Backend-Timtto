**Dev hot-reload setup**

Cambios realizados
- Añadido `scripts/dev-runner.js`: detecta si el proyecto contiene `.ts` en `src` y ejecuta:
  - TypeScript detected: `ts-node-dev --respawn --transpile-only src/server.ts`
  - Otherwise: `nodemon --watch src --ext js,json --exec "node --enable-source-maps src/server.js"`
- Actualizado `package.json`:
  - `dev` ahora ejecuta `node scripts/dev-runner.js`.
  - Añadidos `dev:ts` y `dev:js` como comandos directos para forzar comportamiento.
  - `nodemon` añadido a `devDependencies`.
- Añadido `nodemon.json` para configuración de reinicio en archivos `.js` y `.json`.

Por qué
- El runner permite que `npm run dev` funcione en proyectos con código JS o TS sin necesidad de cambiar scripts manualmente.
- `ts-node-dev` ofrece reinicio rápido y preserva procesos, `nodemon` es usado cuando no hay TypeScript.

Cómo usar
1) Instalar dependencias (si no están instaladas):

```bash
npm install
```

2) Ejecutar desarrollo:

```bash
npm run dev
```

- Si el repositorio contiene `src/*.ts` y `tsconfig.json`, se usará `ts-node-dev`.
- Si solo hay `.js`, se usará `nodemon`.

Ajustes de logging y reinicio
- Logger (winston) ya imprime en consola en modo `development` (ver `src/config/logger.config.js`).
- Para ver `debug` logs, establece la variable de entorno `LOG_LEVEL=debug` antes de ejecutar `npm run dev`:

```bash
# Linux/macOS
LOG_LEVEL=debug npm run dev

# Windows PowerShell
$env:LOG_LEVEL = "debug"; npm run dev
```

Evitar múltiples instancias
- El runner usa `npx` para lanzar `nodemon` o `ts-node-dev`. Aun así, si hay procesos previos, mata el PID que ocupe el puerto (por ejemplo `taskkill /PID <pid> /F` en Windows). El runner no matará procesos existentes automáticamente para evitar riesgos.

No afecta producción
- `build` y `start` no se modificaron: `npm run build` usa `tsc` y `npm start` ejecuta `dist/server.js`.

Notas finales
- Si quieres que el runner mate procesos en el puerto automáticamente, puedo implementarlo (recomendado con cuidado).
- ¿Quieres que agregue un `preinstall` script que instale `nodemon` localmente si falta?