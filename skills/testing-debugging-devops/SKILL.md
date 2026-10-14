---
name: "testing-debugging-devops"
description: "Workflows for automated testing, autonomous root-cause debugging, REST API load testing, Docker, Git, and port/process management."
tags: "testing, debugging, devops, docker, git, rest, performance, ports, processes, lint"
---

# Testing, Debugging & DevOps Skill

Follow this structured diagnostic and verification workflow when troubleshooting errors, running test suites, managing background services, or preparing commits and containers in `plumar-cli`.

## 1. Autonomous Root-Cause Debugging Loop
Whenever a build, test, or runtime error occurs, never ask the user to manually inspect or edit files. Execute this loop autonomously:
1. **Locate**: Use `searchGrep` (to find error strings, symbols, or route paths) and `findFiles` (to locate config or source files).
2. **Inspect**: Read the target file and relevant configuration (`package.json`, `tsconfig.json`, `.env`, etc.) using `readFile`.
3. **Fix**: Apply targeted fixes using `codeFixer` or `searchReplace`.
4. **Verify**: Re-run the build, test suite, or server via `executeCommand`, and check logs via `processManager({ action: "logs", name: "..." })`.

## 2. Port & Background Process Management
- **Port Conflicts (`EADDRINUSE`)**:
  - Inspect active processes on the port: `portManager({ action: "list", port: 3000 })`.
  - Terminate the blocking process: `portManager({ action: "kill", port: 3000 })`.
- **Service Lifecycle (`processManager`)**:
  - List active background services: `processManager({ action: "list" })`.
  - Inspect recent stdout/stderr logs: `processManager({ action: "logs", name: "backend", lines: 50 })`.
  - Stop a service before restarting on the same port: `processManager({ action: "stop", name: "backend" })`.

## 3. API Verification & Load Testing
- **Functional Verification**: Use `restClient` to test `GET`, `POST`, `PUT`, `DELETE` endpoints with custom JSON bodies and headers.
- **Performance & Concurrency Benchmarking**: Use `apiPerformanceTest` (`{ url, method, requests: 50, concurrency: 10 }`) to measure min/avg/p95/p99 latency and error rates under load.

## 4. Code Quality, Dependencies, Git & Docker
- **Formatting & Linting**: Run `codeFormatter({ filePath: "...", action: "lint" | "format" })` to catch syntax and style issues early.
- **Dependency Health**: Use `dependencyScanner({ action: "scanImports" })` to detect missing or unused `package.json` dependencies before starting servers.
- **Git Workflows**: Use `gitHelper({ action: "status" })`, `gitHelper({ action: "diff" })`, and `gitHelper({ action: "draftCommitMessage" })` to inspect changes and prepare clean commits.
- **Docker**: Use multi-stage builds, `.dockerignore` (excluding `node_modules`, `.git`, `.env`), and non-root container users where appropriate.
