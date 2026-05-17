@echo off
for /f "usebackq tokens=1,* delims==" %%A in (".env") do if /i "%%A"=="N8N_API_KEY" set API_KEY=%%B
if "%API_KEY%"=="" (
  echo Falta N8N_API_KEY. Agregala en .env o define la variable de entorno.
  exit /b 1
)
set BASE_URL=http://localhost:5678/api/v1

curl -s -X POST "%BASE_URL%/credentials" -H "Accept: application/json" -H "Content-Type: application/json" -H "X-N8N-API-KEY: %API_KEY%" -d "{\"name\":\"Ollama IPv4\",\"type\":\"ollamaApi\",\"data\":{\"baseUrl\":\"http://127.0.0.1:11434\"}}"
echo.
