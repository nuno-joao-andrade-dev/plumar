# 💎 Run Gemma locally with plumar

Gemma is Google's family of open models. With Ollama it runs on your own machine, and plumar prefers it when it is installed.

New here? Install plumar first: [Getting Started](getting-started.md).

---

## 1. Pull a model

Make sure Ollama is installed and running (the desktop app, or `ollama serve` in a terminal), then pull Gemma 4:

```bash
ollama pull gemma4
```

plumar looks for a Gemma 4 model first and uses it by default.

---

## 2. Run plumar

```bash
plumar
```

Pick the model from the startup menu. To switch later, type `/model`.

---

## 3. Pick a size

Bigger models answer better but need more memory. Choose by how much memory your machine has:

| Your machine | Pull this | Download size |
|---|---|---|
| 8 GB | `ollama pull gemma4:e2b` | 4.6 GB |
| 16 GB | `ollama pull gemma4` | 6.6 GB |
| 32 GB or more | `ollama pull gemma4:26b` | 16 GB |

Memory use while running is a bit higher than the download size. All sizes are on the [Ollama Gemma 4 page](https://ollama.com/library/gemma4).

**Older or smaller machine?** `gemma3:1b` is under 1 GB and fine for chat. In Ollama, Gemma 3 cannot use plumar's tools (reading files, running commands) directly, so plumar prints `retrying in text-only mode...` and carries on. That message is expected.

**Running low on memory?** Inside plumar, type `/parameter set num_ctx 8192`. The model then keeps less of the chat in memory at once: it uses less memory, but forgets older messages sooner.
