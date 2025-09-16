@echo off
echo Starting Ollama with custom model directory...
set OLLAMA_MODELS=D:\cse_518_project\models
set OLLAMA_HOST=127.0.0.1:11434
echo Models will be stored in: %OLLAMA_MODELS%

REM Start Ollama service
ollama serve