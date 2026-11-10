# 💎 Run Gemma locally with plumar

Gemma is Google's family of open models, and Ollama serves it on your own machine. This page shows how to pull a Gemma model, start plumar with it, and pick the size that fits your hardware.

---

## 1. Pull a model

Make sure the Ollama daemon is running (`ollama serve`), then pull one tag:

```bash
ollama pull gemma4:e4b
```

`gemma4:latest` points to the same model as `gemma4:e4b`, and it is plumar's default.

---

## 2. Run plumar with it

Interactive REPL: start `plumar` and pick the model from the startup menu. To switch later, type `/model` to open the same picker.

One-shot prompt from the shell:

```bash
plumar -m gemma4:e4b "explain what src/agent.js does in three bullet points"
```

---

## 3. Which size for which machine

Download sizes come from the [Ollama library](https://ollama.com/library/gemma4). The Good fit column is a rough guide: the model file plus room for the context window and the rest of your system. On Apple Silicon this is unified memory, on other machines RAM or VRAM. Using LM Studio instead of Ollama? Load the matching Gemma GGUF there; the tags below are Ollama names.

### Gemma 4 (recommended for plumar)

Gemma 4 supports native tool calling and thinking in Ollama, so plumar's tools work without any fallback.

| Tag | Download | Context | Good fit |
|---|---|---|---|
| `gemma4:e2b` | 4.6 GB | 128K | 8 GB laptops, quick edits and questions |
| `gemma4:e4b` (`latest`) | 6.6 GB | 128K | 16 GB machines, everyday coding |
| `gemma4:12b` | 7.7 GB | 256K | 16 to 24 GB, better reasoning on larger files |
| `gemma4:26b` | 16 GB | 256K | 32 GB, mixture of experts (about 4B active), fast for its size |
| `gemma4:31b` | 19 GB | 256K | 32 GB and up, largest dense model |

### Gemma 3

Gemma 3 runs fine for chat and smaller machines. Ollama ships it [without native tool calling](https://ollama.com/library/gemma3), so plumar falls back to text-based tool calls. You will see `retrying in text-only mode...` on each turn (one extra round trip); that is expected.

| Tag | Download | Context | Input | Good fit |
|---|---|---|---|---|
| `gemma3:270m` | 292 MB | 32K | Text | Tiny experiments, chat only; too small for reliable tool use |
| `gemma3:1b` | 806 MB | 32K | Text | Any laptop, short answers |
| `gemma3:4b` (`latest`) | 3.4 GB | 128K | Text, image | 8 GB machines |
| `gemma3:12b` | 8.2 GB | 128K | Text, image | 16 GB machines |
| `gemma3:27b` | 17 GB | 128K | Text, image | 32 GB machines |

---

## 4. Tuning tips

- **Context window.** plumar caps `num_ctx` at 32K tokens even when the model supports more. On a low-memory machine, lower it for the session:

  ```text
  /parameter set num_ctx 8192
  ```

- **Temperature.** The [Gemma 4 model page](https://ollama.com/library/gemma4) recommends `temperature 1.0`, `top_k 64` and `top_p 0.95`, and Ollama's Gemma tags already set `top_k` and `top_p` to these values. plumar's chat mode sets the temperature: the default `coder` mode uses 0.2, which suits code, and `creative` uses 0.9. For open-ended writing, use `/mode creative` or:

  ```text
  /parameter set temperature 1.0
  ```

- **Quantized variants.** Each Gemma tag also comes as a QAT build (for example `gemma4:e4b-it-qat`), which keeps quality closer to full precision at a similar size. See the tags page on Ollama for the full list.
