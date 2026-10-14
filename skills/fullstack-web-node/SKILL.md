---
name: "fullstack-web-node"
description: "Best practices and workflows for Full-Stack Web & Node.js development (HTML/CSS/JS, React/Vite, Angular, Vue, Express/Fastify REST APIs)."
tags: "web, nodejs, javascript, typescript, react, vite, angular, vue, express, html, css, fullstack"
---

# Full-Stack Web & Node.js Development Skill

Follow these engineering patterns and tool workflows when creating, modifying, or debugging JavaScript/TypeScript backends, REST APIs, and modern web frontends in `plumar-cli`.

## 1. Non-Interactive Project Scaffolding
Always pass non-interactive flags so CLI generators never hang waiting for terminal input:
- **Node.js / Express Backend**:
  ```bash
  mkdir -p backend && cd backend && npm init -y && npm install express cors
  ```
- **React / Vue / Vanilla with Vite**:
  ```bash
  npm create vite@latest frontend -- --template react
  cd frontend && npm install
  ```
- **Angular**:
  ```bash
  npx -y @angular/cli@latest new frontend --defaults --skip-git --style=css --ssr=false
  ```
- **HTML/CSS/JS Static App**:
  Create `index.html`, `styles.css`, and `app.js` directly using `writeFile`, and serve via `npx -y serve -l 3000` or a lightweight Node HTTP server.

## 2. Backend API Architecture (Node.js / Express / Fastify)
- **CORS & JSON Body Parsing**: Always enable `cors()` and `express.json()` before defining routes so frontend requests do not fail with CORS or undefined body errors.
- **Health Check Endpoint**: Include a `GET /health` or `GET /api/health` route returning `{ status: "ok" }` so startup verification is deterministic.
- **Port Binding**: Read `process.env.PORT || 3000` (or `4000`/`5000` when paired with a frontend on `3000`/`4200`/`5173`) and log the exact listening URL (`http://localhost:<PORT>`) on startup.
- **Graceful Error Handling**: Wrap async route handlers in `try/catch` and return structured JSON errors (`res.status(400).json({ error: err.message })`) instead of crashing the process.

## 3. Frontend Architecture & API Integration
- **Dev Server Proxy / Base URL**:
  - In **Vite** (`vite.config.js`), configure `server.proxy`:
    ```js
    server: { port: 5173, host: true, proxy: { '/api': 'http://localhost:3000' } }
    ```
  - In **Angular** (`proxy.conf.json`), map `"/api": { "target": "http://localhost:3000", "secure": false }` and pass `--proxy-config proxy.conf.json` or configure `angular.json`.
  - When modifying Angular components/modules, always check whether the app uses **Standalone Components** (`standalone: true`, `imports: [CommonModule, FormsModule, HttpClientModule]`) or `AppModule` (`app.module.ts`), and include `provideHttpClient()` in `app.config.ts` when using `HttpClient`.
- **Resilient UI State**: Always handle `loading`, `error`, and `empty` states in UI components so failed or empty API responses render clearly without uncaught `TypeError: Cannot read properties of undefined (reading 'map')`.

## 4. Running & Verifying Services in `plumar-cli`
1. **Check Ports First**: Before starting servers on common ports (`3000`, `4200`, `5173`, `8080`), use `portManager({ action: "list", port: 3000 })` or `portManager({ action: "kill", port: 3000 })` if a stale process is holding the port.
2. **Launch in Background**: Start backend and frontend services via `executeCommand`:
   - `executeCommand({ command: "cd backend && node index.js", background: true, name: "backend" })`
   - `executeCommand({ command: "cd frontend && npm run dev -- --host", background: true, name: "frontend" })`
3. **Verify Endpoints with `restClient`**: After starting the backend, test `GET`/`POST` endpoints using `restClient({ url: "http://localhost:3000/api/...", method: "GET" })` to confirm status `200` and valid JSON payloads.
4. **Surgical Code Edits**: Prefer `codeFixer` or `searchReplace` over rewriting entire files when fixing imports, routes, or component methods.
