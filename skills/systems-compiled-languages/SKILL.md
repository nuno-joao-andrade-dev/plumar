---
name: "systems-compiled-languages"
description: "Best practices and build/test workflows for Go, Rust, C/C++ (CMake/Make), and Java (Maven/Gradle) projects."
tags: "go, golang, rust, cargo, c, cpp, cmake, make, java, maven, gradle, systems"
---

# Systems & Compiled Languages Skill

Follow these build, test, and project structure conventions when developing in Go, Rust, C/C++, or Java inside `plumar-cli`.

## 1. Go (`golang`)
- **Module Init & Tidy**:
  ```bash
  go mod init <module-name> && go mod tidy
  ```
- **Build, Vet & Test**:
  - Check for static errors: `go vet ./...`
  - Run tests: `go test -v ./...`
  - Build binary: `go build -o bin/app ./cmd/...` (or `go run main.go`)
- **Concurrency & HTTP**: Always pass `context.Context` to blocking I/O operations, configure timeouts on `http.Server` and `http.Client`, and avoid goroutine leaks.

## 2. Rust (`cargo`)
- **Project Init**: `cargo init --bin` (or `cargo new <name>`)
- **Fast Check, Clippy & Test**:
  - Fast type/borrow check: `cargo check`
  - Run unit/integration tests: `cargo test`
  - Run binary: `cargo run`
- **Error Handling**: Prefer `Result<T, E>` and the `?` operator (`anyhow` for applications, `thiserror` for libraries) over `.unwrap()` in production paths.

## 3. C & C++ (`gcc`, `g++`, `make`, `cmake`)
- **Compiler Warnings & Standards**: Compile with strict warning flags (`-Wall -Wextra -std=c++20` or `-std=c17`) so memory and type bugs are caught at compile time.
- **CMake Workflow**:
  ```bash
  cmake -B build && cmake --build build && ctest --test-dir build --output-on-failure
  ```
- **Memory Safety**: Use RAII (`std::unique_ptr`, `std::vector`, `std::string_view`) in C++ and always check allocation and bounds in C.

## 4. Java (`Maven` / `Gradle`)
- **Maven**: Use `mvn compile`, `mvn test`, or `mvn -q package -DskipTests` via `executeCommand`.
- **Gradle**: Use `./gradlew build` or `./gradlew test` (falling back to `gradle` if wrapper is absent).
