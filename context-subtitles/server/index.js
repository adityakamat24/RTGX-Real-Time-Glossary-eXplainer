// server/index.js
import express from "express";
import http from "http";
import cors from "cors";
import { WebSocketServer } from "ws";
import { LRUCache } from "lru-cache";
import rateLimit from "express-rate-limit";
import PQueue from "p-queue";
import dotenv from "dotenv";
import Groq from "groq-sdk";
import QRCode from "qrcode";
import os from "os";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static('public')); // Serve static files from public directory

// Rate limiting disabled for better student experience
// const defineRateLimit = rateLimit({
//   windowMs: 60 * 1000, // 1 minute window
//   max: 30, // limit each IP to 30 requests per windowMs
//   message: { error: "Too many definition requests, please try again later." },
//   standardHeaders: true,
//   legacyHeaders: false,
// });

// Queue for Groq requests to prevent overload
const groqQueue = new PQueue({
  concurrency: 8, // Max 8 concurrent Groq requests for faster response
  timeout: 18000, // 18 second timeout
  throwOnTimeout: true
});

// Groq configuration
const groqClient = new Groq({
  apiKey: process.env.GROQ_API_KEY
});
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

// Simple fast hash for cache keys (kept for backward compatibility)
const h = s => [...s].reduce((a,c)=>((a*31+c.charCodeAt(0))>>>0),0).toString(16);

// In-memory state (glossary removed - LLM-only mode)
const taps = new Map();            // lemma -> count
const defCache = new LRUCache({
  max: 1000,            // up to 1000 entries
  ttl: 1000 * 60 * 60,  // 1 hour
});

// Statistics tracking for professor dashboard
const sessionStats = {
  totalWords: 0,              // Total words spoken
  totalLookups: 0,            // Total definition lookups
  uniqueWordsLookedUp: new Set(), // Unique words that have been looked up
  wordFrequency: new Map(),   // word -> frequency in transcript
  lookupTimestamps: [],       // Array of lookup timestamps for engagement over time
  sessionStartTime: Date.now(),
  connectedStudents: 0,       // Current student count
  peakStudents: 0,            // Peak concurrent students
  definitionRequests: [],     // Recent definition requests with details
};

// Reset statistics
function resetStats() {
  sessionStats.totalWords = 0;
  sessionStats.totalLookups = 0;
  sessionStats.uniqueWordsLookedUp.clear();
  sessionStats.wordFrequency.clear();
  sessionStats.lookupTimestamps = [];
  sessionStats.sessionStartTime = Date.now();
  sessionStats.connectedStudents = 0;
  sessionStats.peakStudents = 0;
  sessionStats.definitionRequests = [];
}

// Language names for better prompts
const LANGUAGE_NAMES = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  zh: "Chinese",
  ja: "Japanese",
  ko: "Korean",
  hi: "Hindi",
  ar: "Arabic",
  ru: "Russian"
};

function toMessages(term, context, lang="en") {
  const ctx = (context || "").replace(/\s+/g, " ").trim().slice(-200);
  const langName = LANGUAGE_NAMES[lang] || "English";

  // Enhanced prompt for better glossary-style definitions in target language
  const prompt = ctx
    ? `Define "${term}" as used in this context: "${ctx}". Provide a clear, concise definition in 1-2 sentences in ${langName}. Do not include phrases like "a term with specific meaning" or "depending on context". Give the actual definition in ${langName}.`
    : `Define "${term}". Provide a clear, concise definition in 1-2 sentences in ${langName}. Focus on the most common meaning.`;

  return [
    { role: "user", content: prompt }
  ];
}

async function chatGroq(messages) {
  return groqQueue.add(async () => {
    try {
      const completion = await groqClient.chat.completions.create({
        model: GROQ_MODEL,
        messages: messages,
        temperature: 0.1,
        max_tokens: 50,
        stop: ["\n", ".", "!", "?"]
      });

      const text = completion.choices[0]?.message?.content?.trim() || "";
      return text;
    } catch (error) {
      throw new Error(`Groq API error: ${error.message}`);
    }
  }, { priority: 5 }); // Higher priority for faster processing
}


// Helper function to get local IP addresses
function getLocalIPAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Skip internal and non-IPv4 addresses
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }

  return addresses;
}

// QR Code endpoint - generates QR code for easy client connection
app.get("/qr", async (req, res) => {
  try {
    const port = process.env.PORT || 3000;
    const clientPort = process.env.CLIENT_PORT || 5173;

    // Get all local IP addresses
    const ips = getLocalIPAddresses();

    // Prefer the first non-localhost IP, fallback to localhost
    const host = ips.length > 0 ? ips[0] : 'localhost';

    // Generate URL for the client app
    const clientUrl = `http://${host}:${clientPort}`;

    // Generate QR code as data URL
    const qrDataUrl = await QRCode.toDataURL(clientUrl, {
      width: 300,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });

    res.json({
      url: clientUrl,
      qrCode: qrDataUrl,
      serverIPs: ips,
      instructions: "Scan this QR code to connect to the live captions"
    });
  } catch (error) {
    console.error("QR code generation error:", error);
    res.status(500).json({ error: "Failed to generate QR code" });
  }
});

// REST: get top taps (glossary upload removed - LLM-only mode)
app.get("/api/top", (req, res) => {
  const top = [...taps.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3)
                  .map(([term,count])=>({term,count}));
  res.json(top);
});

// GET /api/stats - Professor dashboard statistics
app.get("/api/stats", (req, res) => {
  const lookupPercentage = sessionStats.totalWords > 0
    ? ((sessionStats.uniqueWordsLookedUp.size / sessionStats.totalWords) * 100).toFixed(2)
    : 0;

  // Top 10 most looked-up words
  const topLookups = [...taps.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([term, count]) => ({ term, count }));

  // Recent lookups (last 20)
  const recentLookups = sessionStats.definitionRequests.slice(-20).reverse();

  // Engagement over time (lookups per 5-minute interval)
  const now = Date.now();
  const intervals = [1, 5, 10, 15, 30]; // minutes
  const engagementByInterval = {};

  intervals.forEach(minutes => {
    const threshold = now - (minutes * 60 * 1000);
    const count = sessionStats.lookupTimestamps.filter(ts => ts >= threshold).length;
    engagementByInterval[`last${minutes}min`] = count;
  });

  // Calculate average lookups per student
  const avgLookupsPerStudent = sessionStats.connectedStudents > 0
    ? (sessionStats.totalLookups / sessionStats.connectedStudents).toFixed(2)
    : 0;

  res.json({
    lookupPercentage: parseFloat(lookupPercentage),
    totalWords: sessionStats.totalWords,
    totalLookups: sessionStats.totalLookups,
    uniqueWordsLookedUp: sessionStats.uniqueWordsLookedUp.size,
    connectedStudents: sessionStats.connectedStudents,
    peakStudents: sessionStats.peakStudents,
    topLookups,
    recentLookups,
    engagementByInterval,
    avgLookupsPerStudent: parseFloat(avgLookupsPerStudent),
    sessionDuration: now - sessionStats.sessionStartTime,
    sessionStartTime: sessionStats.sessionStartTime
  });
});

// POST /api/stats/reset - Reset statistics for new session
app.post("/api/stats/reset", (req, res) => {
  resetStats();
  res.json({ message: "Statistics reset successfully" });
});

// POST /define  { term, context, lang? }  -> { definition, model, cached }
app.post("/define", async (req, res) => {
  try {
    const term = String(req.body?.term || "").trim();
    const lang = String(req.body?.lang || "en").trim();
    const context = String(req.body?.context || "");

    if (!term) return res.status(400).json({ error: "Missing 'term'" });

    // Track lookup statistics
    sessionStats.totalLookups++;
    sessionStats.uniqueWordsLookedUp.add(term.toLowerCase());
    sessionStats.lookupTimestamps.push(Date.now());

    // Track recent definition requests
    sessionStats.definitionRequests.push({
      term,
      timestamp: Date.now(),
      context: context.slice(0, 100) // Store first 100 chars of context
    });

    // Keep only last 100 requests
    if (sessionStats.definitionRequests.length > 100) {
      sessionStats.definitionRequests.shift();
    }

    // Caching disabled for better real-time responses
    // const contextWords = context.toLowerCase().match(/\b(money|financial|bank|river|water|lending|deposit|account|stream|shore)\b/g) || [];
    // const key = `${term.toLowerCase()}|${lang}|${contextWords.sort().join(',')}|${context.slice(-50)}`;
    // const hit = defCache.get(key);
    // if (hit) return res.json({ ...hit, cached: true });

    const messages = toMessages(term, context, lang);

    let out = "";
    let used = null;

    // Call Groq API
    try {
      out = await chatGroq(messages);
      used = `groq:${GROQ_MODEL}`;
    } catch (error) {
      throw new Error(`Groq API failed: ${error.message}`);
    }

    if (!out) throw new Error("Groq API returned empty response");

    if (out.toLowerCase() === "skip") {
      const payload = { definition: "skip", model: used };
      return res.json({ ...payload, cached: false });
    }

    // Clean up model thinking/reasoning artifacts while preserving actual definitions
    let cleaned = out;
    
    // Remove thinking tags and content
    cleaned = cleaned.replace(/<think>.*?<\/think>/gi, '');
    cleaned = cleaned.replace(/<think>.*$/gm, '');
    
    // Remove common reasoning prefixes but preserve the actual definition
    cleaned = cleaned.replace(/^(?:Hmm,|Let me think|I need to|The user wants me to).*?(?:\.|:)\s*/gm, '');
    
    // Clean up and get the main definition
    cleaned = cleaned.replace(/\s+/g, " ").trim();

    // If we cleaned too much and have an empty result, retry with different prompt
    if (!cleaned || cleaned.length < 10) {
      throw new Error(`LLM response too short or empty for term: ${term}`);
    }
    
    const one = (cleaned.match(/^(.+?[.!?])\s/)?.[1] || cleaned).slice(0, 240);
    
    const payload = { definition: one, model: used };
    // Caching disabled
    // defCache.set(key, payload);
    res.json({ ...payload, cached: false });
  } catch (e) {
    console.error("/define error", e);
    res.status(502).json({ error: e.message || "define_failed" });
  }
});

// WS relay
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const audience = new Set();
let presenter = null;
const MAX_CONNECTIONS = 100; // Limit total connections
const HEARTBEAT_INTERVAL = 30000; // 30 seconds

// Heartbeat to detect broken connections
const heartbeat = setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) {
      audience.delete(ws);
      if (ws === presenter) presenter = null;
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT_INTERVAL);

wss.on("connection", (ws, req) => {
  // Connection limit check
  if (wss.clients.size >= MAX_CONNECTIONS) {
    ws.close(1013, "Server overloaded - too many connections");
    return;
  }
  
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  
  const role = new URL(req.url, "http://x").searchParams.get("role");
  if (role === "presenter") {
    if (presenter) {
      // Close existing presenter connection
      presenter.close(1000, "New presenter connected");
    }
    presenter = ws;
  } else {
    audience.add(ws);
    // Update student count
    sessionStats.connectedStudents = audience.size;
    sessionStats.peakStudents = Math.max(sessionStats.peakStudents, audience.size);
  }

  ws.on("message", (buf) => {
    try {
      const msg = JSON.parse(buf.toString());

      if (msg.type === "CAPTION") {
        // Track words in transcript for statistics
        if (msg.words && Array.isArray(msg.words)) {
          msg.words.forEach(wordObj => {
            const word = (wordObj.text || '').trim().toLowerCase();
            if (word) {
              sessionStats.totalWords++;
              sessionStats.wordFrequency.set(
                word,
                (sessionStats.wordFrequency.get(word) || 0) + 1
              );
            }
          });
        }

        // Broadcast to audience with error handling
        const deadConnections = [];
        for (const c of audience) {
          try {
            if (c.readyState === c.OPEN) {
              c.send(buf);
            } else {
              deadConnections.push(c);
            }
          } catch (e) {
            deadConnections.push(c);
          }
        }
        // Clean up dead connections
        deadConnections.forEach(c => audience.delete(c));

        // Update student count
        sessionStats.connectedStudents = audience.size;
        sessionStats.peakStudents = Math.max(sessionStats.peakStudents, audience.size);
      }

      if (msg.type === "TAP") {
        const lemma = (msg.lemma || msg.word || "").toLowerCase().trim();
        if (!lemma) return;
        taps.set(lemma, (taps.get(lemma)||0) + 1);
      }
    } catch (e) {
      console.warn("Invalid WebSocket message:", e.message);
    }
  });

  ws.on("close", () => {
    audience.delete(ws);
    if (ws === presenter) presenter = null;
    // Update student count
    sessionStats.connectedStudents = audience.size;
  });
});

console.log(`[GROQ] model=${GROQ_MODEL}`);
console.log(`[SCALING] Max connections: ${MAX_CONNECTIONS}, Groq queue concurrency: 8, Rate limit: 30/min, Groq timeout: 18s`);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  clearInterval(heartbeat);
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  const ips = getLocalIPAddresses();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🎓 Context Subtitles Server Running`);
  console.log(`${'='.repeat(60)}`);
  console.log(`\n📡 Server listening on port ${PORT}`);

  if (ips.length > 0) {
    console.log(`\n🌐 Network addresses:`);
    ips.forEach(ip => console.log(`   - http://${ip}:${PORT}`));
  }

  console.log(`\n📱 QR Code for Students:`);
  console.log(`   Open in browser: http://localhost:${PORT}/qr.html`);
  if (ips.length > 0) {
    console.log(`   Or: http://${ips[0]}:${PORT}/qr.html`);
  }
  console.log(`\n💡 Display the QR code page on your projector for easy student access!`);
  console.log(`${'='.repeat(60)}\n`);
});

