# RTGX: Real-Time Glossary eXplainer

## Overview

RTGX (Real-Time Glossary eXplainer) is an AI-powered educational tool that provides real-time subtitles with contextual definitions during live lectures. The system helps students understand complex terminology and jargon by providing instant, context-aware explanations without disrupting the learning flow.

### Key Features

- **Real-Time Speech Recognition**: Uses OpenAI's Whisper model for accurate, low-latency transcription
- **AI-Powered Contextual Definitions**: Leverages Groq LLM (Llama 3.3 70B) to provide lecture-specific definitions based on surrounding context
- **Multi-Language Support**: Supports 90+ languages for both transcription and definitions
- **Accessibility Features**:
  - Dyslexia-friendly font options (OpenDyslexic)
  - Customizable text size, color, and display settings
  - Multi-word phrase selection for complex terms
  - High contrast modes
- **Professor Dashboard**:
  - Real-time student engagement metrics
  - Most looked-up terms and confusion points
  - Session statistics and analytics
  - Lookup frequency and timing data
- **Pin & Save Feature**: Students can pin important terms and save sessions locally for review
- **Performance**: Sub-500ms transcription latency, <2s for AI-generated definitions

### How It Works

1. **ASR Service** captures audio from microphone and transcribes it in real-time using Faster Whisper
2. **Server** processes transcripts, manages WebSocket connections, and handles LLM requests via Groq API
3. **Client** displays live subtitles and provides an interactive interface for students to click terms and get contextual definitions
4. Students can customize their viewing experience, pin important terms, and professors can monitor engagement

### Use Cases

- Technical lectures with domain-specific terminology
- Multilingual classrooms with non-native speakers
- Students with learning disabilities or accessibility needs
- Online and hybrid learning environments
- Recording review sessions with searchable definitions

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

## System Requirements

### Hardware
- **GPU (Recommended)**: NVIDIA GPU with CUDA support for optimal Whisper performance
- **CPU**: Can run on CPU-only mode with reduced performance
- **RAM**: Minimum 8GB, 16GB recommended
- **Microphone**: Any system microphone or audio input device

### Software
- **Node.js**: v16 or higher
- **Python**: 3.8-3.11 (required for Faster Whisper)
- **CUDA**: 12.x (optional, for GPU acceleration)
- **cuDNN**: v9.x (optional, for GPU acceleration)

### API Keys
- **Groq API Key**: Required for LLM-powered contextual definitions
  - Sign up at [https://groq.com](https://groq.com)
  - Add your key to `.env` file in the server directory:
    ```
    GROQ_API_KEY=your_api_key_here
    GROQ_MODEL=llama-3.3-70b-versatile
    ```

## Project Structure

```
cse_518_project/
├── context-subtitles/
│   ├── client/          # React frontend application
│   │   ├── src/
│   │   └── package.json
│   ├── server/          # Express.js backend with WebSocket
│   │   ├── index.js
│   │   └── package.json
│   └── asr/             # Python ASR service (Faster Whisper)
│       ├── stream.py
│       └── requirements.txt
├── start.bat            # Windows batch launcher
├── start.ps1            # PowerShell launcher
└── README.md
```

## Architecture

The system consists of three main components:

1. **ASR Service (Python)**
   - Captures audio from system microphone
   - Processes audio using Faster Whisper (GPU/CPU)
   - Sends word-level transcriptions via WebSocket
   - Implements VAD (Voice Activity Detection) for silence filtering
   - Deduplication algorithms to prevent repeated words

2. **Server (Node.js)**
   - WebSocket relay between ASR and clients
   - LLM integration via Groq API
   - Caching layer (LRU cache) for definitions
   - Rate limiting and request queuing
   - Session statistics and analytics
   - QR code generation for easy mobile access

3. **Client (React + Vite)**
   - Real-time subtitle display
   - Interactive word selection for definitions
   - Accessibility controls (font, size, color)
   - Pin and save functionality
   - Professor dashboard with analytics
   - Responsive design for mobile and desktop

## Configuration

### ASR Parameters

Customize the ASR service by modifying the command in `start.bat` or running manually:

```bash
python stream.py \
  --model medium \           # Model size: tiny, base, small, medium, large
  --lang en \                # Language code (en, es, fr, etc.)
  --beam 3 \                 # Beam search size (higher = more accurate, slower)
  --rms-thresh 0.0025 \      # RMS threshold for silence detection
  --silence-hold 300 \       # Silence duration in ms before cutting segment
  --vad-threshold 0.45       # VAD threshold (0-1, higher = stricter)
```

### Server Configuration

Edit `context-subtitles/server/index.js` or use environment variables:

- `GROQ_API_KEY`: Your Groq API key
- `GROQ_MODEL`: LLM model to use (default: llama-3.3-70b-versatile)
- `PORT`: Server port (default: 3000)

## Troubleshooting

### Common Issues

1. **"CUDA not available" error**
   - Ensure CUDA and cuDNN are installed correctly
   - Verify PATH includes CUDA bin directories
   - Fall back to CPU mode by removing `--device cuda` from stream.py

2. **"Module not found" errors**
   - Run `npm run install:all` to install all dependencies
   - Ensure Python virtual environment is activated
   - Install Python requirements: `pip install -r requirements.txt`

3. **WebSocket connection failed**
   - Check if server is running on port 3000
   - Verify firewall settings
   - Ensure client is pointing to correct server URL

4. **No audio detected**
   - Run `python stream.py --list-devices` to see available microphones
   - Specify device with `--device <index>`
   - Check microphone permissions in system settings

## Contributing

This project was developed as part of CSE 518 coursework. Contributions, issues, and feature requests are welcome!

## License

[Add your license information here]

## Acknowledgments

- OpenAI Whisper for state-of-the-art speech recognition
- Groq for high-performance LLM inference
- Faster Whisper implementation by SYSTRAN
- React and Vite teams for excellent development tools
