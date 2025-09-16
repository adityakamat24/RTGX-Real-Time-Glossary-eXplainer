# Context Subtitles

A real-time subtitle application with context-aware definitions.

## Quick Start

### Option 1: Double-click the batch file (Easiest)
```
Double-click: start.bat
```

### Option 2: PowerShell script
```powershell
./start.ps1
```

### Option 3: NPM command (with colored output)
```bash
npm run dev
```

### Option 4: Manual (your old way)
Run these 3 commands in separate terminals:
```bash
# Terminal 1 - Server
cd D:\cse_518_project\context-subtitles\server
node index.js

# Terminal 2 - ASR
cd D:\cse_518_project\context-subtitles\asr
.\.venv\Scripts\activate
set "PATH=C:\Program Files\NVIDIA\CUDNN\v9.13\bin\12.9;%PATH%"
python stream.py --model medium --lang en --beam 3 --rms-thresh 0.0025 --silence-hold 300 --vad-threshold 0.45

# Terminal 3 - Client
cd D:\cse_518_project\context-subtitles\client
npm run dev -- --host
```

## Access Points
- **Client**: http://localhost:5173
- **Server**: http://localhost:3000

## Available Scripts
- `npm run dev` - Start all services with one command
- `npm run start:server` - Start only the server
- `npm run start:client` - Start only the client
- `npm run start:asr` - Start only the ASR service
- `npm run install:all` - Install dependencies for both client and server

## Stopping Services
- **Batch file**: Press any key in the batch window
- **PowerShell**: Press Ctrl+C
- **NPM**: Press Ctrl+C