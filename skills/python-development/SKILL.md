---
name: "python-development"
description: "Best practices and workflows for Python development (FastAPI, Flask, CLI scripts, data processing, venv management, and pytest)."
tags: "python, fastapi, flask, uvicorn, pytest, venv, pip, backend, scripting"
---

# Python Development Skill

Follow these patterns and tool workflows when building, testing, and running Python applications, REST APIs (FastAPI / Flask), data scripts, and test suites in `plumar-cli`.

## 1. Environment & Dependency Management
- **Virtual Environments**: Prefer creating or using an isolated virtual environment inside the workspace when installing third-party packages:
  ```bash
  python3 -m venv .venv && .venv/bin/pip install --upgrade pip
  ```
- **Installing Packages**: Run `.venv/bin/pip install <packages>` (or `pip3 install <packages>` if no venv is used) and record dependencies in `requirements.txt` using `writeFile`.
- **Module Execution**: Run entrypoints with `python3 -m <module>` or `.venv/bin/python <script.py>` from the project root so relative package imports resolve cleanly without `ModuleNotFoundError`.

## 2. FastAPI & Flask Web Services
- **FastAPI + Uvicorn**:
  - Define Pydantic models (`BaseModel`) for request validation and response serialization.
  - Enable `CORSMiddleware` when serving a frontend client.
  - Launch with `executeCommand`:
    ```json
    {
      "name": "executeCommand",
      "arguments": {
        "command": "uvicorn main:app --host 0.0.0.0 --port 8000",
        "background": true,
        "name": "fastapi-backend"
      }
    }
    ```
- **Flask**:
  - Avoid running `app.run(debug=True)` with the interactive reloader if it spawns duplicate orphan processes; use `flask --app app run --host=0.0.0.0 --port=5000` or `app.run(host="0.0.0.0", port=5000, use_reloader=False)`.
- **Verify Endpoints**: Immediately test API routes after startup using `restClient({ url: "http://localhost:8000/...", method: "GET" })`.

## 3. Code Quality, Typing & Testing (`pytest`)
- **Type Hints & Docstrings**: Use standard Python 3.10+ type annotations (`list[str]`, `dict[str, Any]`, `str | None`) and clear docstrings.
- **Automated Testing with `pytest`**:
  - Place unit and API tests in `tests/test_*.py`.
  - Run tests non-interactively via `executeCommand({ command: "pytest -q", name: "pytest" })` or `python3 -m unittest discover -v`.
  - For FastAPI endpoints, use `fastapi.testclient.TestClient` or test live endpoints with `restClient`.
- **Surgical Edits**: Use `codeFixer` or `searchReplace` to update functions, classes, and routes while preserving indentation.
