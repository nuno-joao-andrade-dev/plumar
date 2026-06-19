# 📖 plumar-cli - Documentation Index

Welcome to the official documentation directory for **Plumar (plumar-cli)**. This project is a premium, offline-first, terminal-based AI Agent REPL built with modern JavaScript (ESM) that operates 100% locally. By utilizing local **Ollama** models and the **Google Agent Development Kit (@google/adk)**, it equips the user with an intelligent, sandboxed terminal companion.

Explore the following sections to understand, configure, and extend this local AI developer platform:

---

## 🗺️ Documentation Directory

### 🚀 [Getting Started](file:///home/nandrade/localmodel/docs/getting-started.md)
Learn about prerequisites, model pulling, initial setup, running the REPL, and configuring environment variables/flags for custom logging.

### 🏛️ [System Architecture](file:///home/nandrade/localmodel/docs/architecture.md)
Take a deep dive into the decoupled modular architecture, path-traversal safety boundaries, and our custom manual turn-by-turn orchestration loop designed for maximum local model stability.

### 🛠️ [Complete Tools Reference](file:///home/nandrade/localmodel/docs/tools-reference.md)
A comprehensive reference of the **35 powerful workspace, diagnostic, and utility tools** built directly into the agent.

### 🔌 [Model Context Protocol (MCP) Integration](file:///home/nandrade/localmodel/docs/mcp-servers.md)
Discover how the agent dynamically extends its capabilities by spawning, communicating with, and translating tools from any external JSON-RPC-compliant Model Context Protocol server.

### 🎛️ [Terminal Slash Commands](file:///home/nandrade/localmodel/docs/slash-commands.md)
Learn how to use 22 runtime REPL commands to switch prompt profiles, change active local LLM models, manage local/remote hosts, configure custom headers/auth token endpoints, toggle verbose modes, and manage internal telemetry logging.

### 👾 [plumar-cli Dino Game Guide](file:///home/nandrade/localmodel/docs/dino-game.md)
A fun, high-fidelity guide to our custom retro-synth space-themed browser game—featuring low gravity, gravity flipping, and synthesized Web Audio sound effects.

---

## 🎨 Design Philosophy & Core Stack

The plumar-cli is built with **Aesthetics & Usability** as top-tier requirements:
- **Visual Vibrancy**: Standard console outputs are transformed into premium, colorful block layouts using `picocolors` to log tool operations clearly.
- **Thinking Observability**: The agent displays its local `<thinking>` process in a gorgeous dimmed italic format, so the developer always understands what the model is planning.
- **Strict Sandboxing**: All file-based operations are filtered through our safe resolution engine (`resolveSafePath`) to prevent malicious or accidental directory traversal outside the active workspace.
- **Modular ESM**: The codebase avoids boilerplate and uses pure modern Node.js and ES Modules for lightning-fast startups.

---

> [!NOTE]
> All documentation files are designed to be accessible directly within the workspace. Click any of the section links above to jump straight into details.
