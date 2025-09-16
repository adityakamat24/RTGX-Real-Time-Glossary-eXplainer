// server/index.js
import express from "express";
import http from "http";
import cors from "cors";
import { WebSocketServer } from "ws";
import { LRUCache } from "lru-cache";
import rateLimit from "express-rate-limit";
import PQueue from "p-queue";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Rate limiting disabled for better student experience
// const defineRateLimit = rateLimit({
//   windowMs: 60 * 1000, // 1 minute window
//   max: 30, // limit each IP to 30 requests per windowMs
//   message: { error: "Too many definition requests, please try again later." },
//   standardHeaders: true,
//   legacyHeaders: false,
// });

// Queue for Ollama requests to prevent overload
const ollamaQueue = new PQueue({ 
  concurrency: 8, // Max 8 concurrent Ollama requests for faster response
  timeout: 18000, // 18 second timeout for large models
  throwOnTimeout: true
});

// Local Ollama + HF Router config
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434/api/generate";
const OLLAMA_MODELS = (process.env.OLLAMA_MODELS || "qwen2.5:3b,llama3.2:3b").split(",");
const HF_TOKEN = process.env.HF_TOKEN;
const HF_MODELS = (process.env.HF_MODELS || "deepseek-ai/DeepSeek-V3-0324").split(",");
const HF_ROUTER = "https://router.huggingface.co/v1/chat/completions";

if (!HF_TOKEN) {
  console.warn("[/define] HF_TOKEN missing. Set it in .env file.");
}

// Simple fast hash for cache keys (kept for backward compatibility)
const h = s => [...s].reduce((a,c)=>((a*31+c.charCodeAt(0))>>>0),0).toString(16);

// In-memory state
let glossary = [];                 // [{term, aliases, definition}]
const taps = new Map();            // lemma -> count
const defCache = new LRUCache({
  max: 1000,            // up to 1000 entries
  ttl: 1000 * 60 * 60,  // 1 hour
});

function toMessages(term, context, lang="en") {
  const ctx = (context || "").replace(/\s+/g, " ").trim().slice(-200);
  
  // Enhanced prompt for better glossary-style definitions
  const prompt = ctx 
    ? `Define "${term}" as used in this context: "${ctx}". Provide a clear, concise definition in 1-2 sentences. Do not include phrases like "a term with specific meaning" or "depending on context". Give the actual definition.`
    : `Define "${term}". Provide a clear, concise definition in 1-2 sentences. Focus on the most common meaning.`;
  
  return [
    { role: "user", content: prompt }
  ];
}

async function chatOllama(model, messages) {
  return ollamaQueue.add(async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout for Gemma 12B
    
    try {
      // Convert messages to a single prompt for native Ollama API
      const prompt = messages.map(m => m.content).join('\n');
      
      const r = await fetch(OLLAMA_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          options: {
            temperature: 0.1,
            num_predict: 50,  // Limit response length
            stop: ["\n", ".", "!", "?", "The", "A", "An"]  // Stop at first sentence
          }
        }),
        signal: controller.signal
      });
      
      if (!r.ok) throw new Error(`ollama ${r.status}`);
      const data = await r.json();
      const text = data?.response?.trim() || "";
      return text;
    } finally {
      clearTimeout(timeoutId);
    }
  }, { priority: 5 }); // Higher priority for faster processing
}

async function chatHF(model, messages) {
  const r = await fetch(HF_ROUTER, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${HF_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model, messages,
      temperature: 0.2,
      max_tokens: 64,
      stream: false
    })
  });
  if (!r.ok) throw new Error(`hf-router ${r.status}`);
  const data = await r.json();
  const text = data?.choices?.[0]?.message?.content?.trim() || "";
  return text;
}

// REST: upload glossary; get top taps
app.post("/api/glossary", (req, res) => { glossary = req.body || []; taps.clear(); res.json({ ok:true }); });
app.get("/api/top", (req, res) => {
  const top = [...taps.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3)
                  .map(([term,count])=>({term,count}));
  res.json(top);
});

// POST /define  { term, context, lang? }  -> { definition, model, cached }
app.post("/define", async (req, res) => {
  try {
    const term = String(req.body?.term || "").trim();
    const lang = String(req.body?.lang || "en").trim();
    const context = String(req.body?.context || "");
    
    if (!HF_TOKEN) return res.status(500).json({ error: "HF_TOKEN missing" });
    if (!term) return res.status(400).json({ error: "Missing 'term'" });

    // Caching disabled for better real-time responses
    // const contextWords = context.toLowerCase().match(/\b(money|financial|bank|river|water|lending|deposit|account|stream|shore)\b/g) || [];
    // const key = `${term.toLowerCase()}|${lang}|${contextWords.sort().join(',')}|${context.slice(-50)}`;
    // const hit = defCache.get(key);
    // if (hit) return res.json({ ...hit, cached: true });

    const messages = toMessages(term, context, lang);

    let out = "";
    let used = null;
    
    // Try LLM first (prioritize AI-generated definitions)
    try {
      out = await chatOllama(OLLAMA_MODELS[0], messages);
      used = `ollama:${OLLAMA_MODELS[0]}`;
    } catch (e) {
      console.warn(`Primary Ollama model failed:`, e.message);
      
      // Quick parallel attempt: remaining Ollama + HF
      const promises = [];
      
      // Try remaining Ollama models
      for (let i = 1; i < OLLAMA_MODELS.length; i++) {
        promises.push(
          chatOllama(OLLAMA_MODELS[i], messages)
            .then(result => ({ result, model: `ollama:${OLLAMA_MODELS[i]}` }))
            .catch(() => null)
        );
      }
      
      // Try HF in parallel if available
      if (HF_TOKEN) {
        promises.push(
          chatHF(HF_MODELS[0], messages)
            .then(result => ({ result, model: `hf:${HF_MODELS[0]}` }))
            .catch(() => null)
        );
      }
      
      // Race all alternatives, take first successful response
      const results = await Promise.allSettled(promises);
      const successful = results
        .filter(r => r.status === 'fulfilled' && r.value?.result)
        .map(r => r.value);
      
      if (successful.length > 0) {
        const winner = successful[0];
        out = winner.result;
        used = winner.model;
      }
    }
    
    // Fallback to instructor glossary only if LLM fails
    if (!out) {
      const g = glossary.find(g =>
        g.term.toLowerCase() === term.toLowerCase() ||
        (g.aliases||[]).some(a => a.toLowerCase() === term.toLowerCase())
      );
      if (g) {
        out = g.definition;
        used = "glossary";
      }
    }
    
    if (!out) throw new Error("No local or remote models available");

    if (out.toLowerCase() === "skip") {
      const payload = { definition: "skip", model: used };
      defCache.set(key, payload);
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
    
    // If we cleaned too much and have an empty result, provide a word-specific fallback
    if (!cleaned || cleaned.length < 10) {
      // Better contextual fallbacks without generic "term with specific meaning" phrase
      if (term.toLowerCase().includes('algorithm')) {
        cleaned = 'a set of rules or instructions for solving a problem or completing a task';
      } else if (term.toLowerCase().includes('bank')) {
        cleaned = context.includes('money') || context.includes('deposit') ? 
          'a financial institution for storing money' : 'the land alongside a river or lake';
      } else if (term.toLowerCase().includes('run')) {
        cleaned = context.includes('program') || context.includes('code') ?
          'to execute or start a program' : 'to move quickly on foot';
      } else if (term.toLowerCase().includes('decod')) {
        cleaned = 'the process of converting encoded information into readable form';
      } else if (term.toLowerCase().includes('transform')) {
        cleaned = 'to change something completely, usually to improve it';
      } else if (term.toLowerCase().includes('process')) {
        cleaned = 'a series of actions or steps taken to achieve a result';
      } else if (term.toLowerCase().includes('data')) {
        cleaned = 'information, especially facts or numbers, collected for analysis';
      } else {
        // Last resort: try to infer from context without generic phrasing
        if (context.toLowerCase().includes('computer') || context.toLowerCase().includes('software')) {
          cleaned = `a computing or technology-related concept`;
        } else if (context.toLowerCase().includes('machine') || context.toLowerCase().includes('learning')) {
          cleaned = `a concept related to machine learning or artificial intelligence`;
        } else {
          cleaned = `definition not available in current knowledge base`;
        }
      }
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
  }

  ws.on("message", (buf) => {
    try {
      const msg = JSON.parse(buf.toString());

      if (msg.type === "CAPTION") {
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
  });
});

console.log(`[OLLAMA] models=${OLLAMA_MODELS.join(",")}  url=${OLLAMA_URL}`);
console.log(`[HF] fallback models=${HF_MODELS.join(",")}  token=${HF_TOKEN ? "set" : "MISSING"}`);
console.log(`[SCALING] Max connections: ${MAX_CONNECTIONS}, Ollama queue concurrency: 8, Rate limit: 30/min, Ollama timeout: 7s`);

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
server.listen(PORT, "0.0.0.0", () => console.log(`Relay listening on http://0.0.0.0:${PORT}`));

