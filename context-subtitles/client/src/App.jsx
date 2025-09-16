import { useEffect, useRef, useState, useCallback } from "react";
import "./App.css";

// Dynamic host detection for different environments
const getHost = () => {
  const hostname = window.location.hostname;
  const port = window.location.port;
  
  // If accessing via network IP (like 172.24.20.57:5173), use the same IP for backend
  if (hostname.match(/^\d+\.\d+\.\d+\.\d+$/)) {
    return hostname;
  }
  
  return hostname || "localhost";
};

const host = getHost();
const WS_URL = `ws://${host}:3000/?role=audience`;
const API_URL = `http://${host}:3000`;

// Basic glossary for testing purposes
const BASIC_GLOSSARY = {
  "technology": "The application of scientific knowledge for practical purposes, especially in industry.",
  "artificial": "Made or produced by human beings rather than occurring naturally.",
  "artificial intelligence": "Computer systems able to perform tasks that typically require human intelligence.",
  "intelligence": "The ability to acquire and apply knowledge and skills.",
  "machine": "An apparatus using mechanical power and having several parts, each with a definite function.",
  "learning": "The acquisition of knowledge or skills through experience, study, or instruction.",
  "algorithm": "A process or set of rules to be followed in calculations or problem-solving operations.",
  "data": "Facts and statistics collected together for reference or analysis.",
  "computer": "An electronic device for storing and processing data according to instructions.",
  "software": "Computer programs and operating information used by a computer.",
  "hardware": "The physical components of a computer system.",
  "network": "A group of interconnected computers or devices that can communicate with each other.",
  "internet": "A global computer network providing information and communication facilities.",
  "application": "A computer program designed to fulfill a particular purpose or task.",
  "database": "A structured set of data held in a computer for easy access and management.",
  "programming": "The process of creating a set of instructions that tell a computer how to perform a task.",
  "development": "The process of creating software applications or systems.",
  "system": "A set of connected things or parts forming a complex whole.",
  "interface": "A point where two systems meet and interact with each other.",
  "user": "A person who uses or operates something, especially a computer program.",
  "design": "The process of planning and creating something with a specific purpose in mind.",
  "innovation": "The introduction of new ideas, methods, or products.",
  "digital": "Relating to computer technology and electronic data processing.",
  "platform": "A computing system that serves as a base for developing or running applications.",
  "framework": "A basic structure underlying a system, concept, or approach.",
  "architecture": "The overall design and structure of a computer system or software.",
  "security": "Measures taken to protect against unauthorized access or cyber threats.",
  "encryption": "The process of converting information into a coded format to prevent unauthorized access.",
  "authentication": "The process of verifying the identity of a user or system.",
  "server": "A computer or system that provides data or services to other computers over a network.",
  "cloud": "Internet-based computing that provides shared processing resources and data.",
  "analysis": "Detailed examination of elements or structure of something complex.",
  "optimization": "The process of making something as effective or functional as possible.",
  "machine learning": "A method of data analysis that automates analytical model building using algorithms that iteratively learn from data.",
  "speculative decoding": "A technique in language models that attempts to generate multiple tokens in parallel to speed up inference.",
  "efficiency": "The ability to accomplish something with minimal waste of time and resources.",
  "scalability": "The capacity to handle increased workload or expand system capabilities.",
  "integration": "The process of combining different systems or components to work together.",
  "automation": "The use of technology to perform tasks with minimal human intervention.",
  "workflow": "The sequence of processes through which work passes from start to completion.",
  "productivity": "The effectiveness of productive effort measured in terms of output per unit of input.",
  "collaboration": "The action of working with others to produce or create something.",
  "communication": "The means of sending or receiving information between people or systems."
};

export default function App() {
  const [parts, setParts] = useState([]);
  const [displayedParts, setDisplayedParts] = useState([]);
  const [popover, setPopover] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [connectionError, setConnectionError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [wordCount, setWordCount] = useState(0);
  const [sessionStartTime, setSessionStartTime] = useState(null);
  const [showAccessibilityPanel, setShowAccessibilityPanel] = useState(false);
  const [preferredSource, setPreferredSource] = useState('auto'); // 'local', 'llm', 'auto'
  const [selectedTokens, setSelectedTokens] = useState(new Set());
  const [isSelecting, setIsSelecting] = useState(false);
  
  // Accessibility settings
  const [textSize, setTextSize] = useState('medium');
  const [fontFamily, setFontFamily] = useState('inter');
  const [lineSpacing, setLineSpacing] = useState('normal');
  const [letterSpacing, setLetterSpacing] = useState('normal');
  const [wordSpacing, setWordSpacing] = useState('normal');
  const [highContrast, setHighContrast] = useState(false);
  const [readingGuide, setReadingGuide] = useState(false);
  const [colorOverlay, setColorOverlay] = useState('none');
  const [showSyllables, setShowSyllables] = useState(false);
  
  const animationTimeoutRef = useRef(null);
  const pendingWordsRef = useRef([]);
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const retryCountRef = useRef(0);
  const captionsContainerRef = useRef(null);

  // Load accessibility settings from localStorage
  useEffect(() => {
    const savedSettings = localStorage.getItem('contextSubtitlesAccessibility');
    if (savedSettings) {
      try {
        const settings = JSON.parse(savedSettings);
        setTextSize(settings.textSize || 'medium');
        setFontFamily(settings.fontFamily || 'inter');
        setLineSpacing(settings.lineSpacing || 'normal');
        setLetterSpacing(settings.letterSpacing || 'normal');
        setWordSpacing(settings.wordSpacing || 'normal');
        setHighContrast(settings.highContrast || false);
        setReadingGuide(settings.readingGuide || false);
        setColorOverlay(settings.colorOverlay || 'none');
        setShowSyllables(settings.showSyllables || false);
        setPreferredSource(settings.preferredSource || 'auto');
      } catch (e) {
        console.warn('Failed to load accessibility settings:', e);
      }
    }
  }, []);
  
  // Save accessibility settings to localStorage
  const saveAccessibilitySettings = useCallback(() => {
    const settings = {
      textSize, fontFamily, lineSpacing, letterSpacing, wordSpacing,
      highContrast, readingGuide, colorOverlay, showSyllables, preferredSource
    };
    localStorage.setItem('contextSubtitlesAccessibility', JSON.stringify(settings));
  }, [textSize, fontFamily, lineSpacing, letterSpacing, wordSpacing, highContrast, readingGuide, colorOverlay, showSyllables, preferredSource]);
  
  useEffect(() => {
    saveAccessibilitySettings();
  }, [saveAccessibilitySettings]);
  
  // Debug popover state changes
  useEffect(() => {
    console.log('🔄 Popover state changed:', popover);
  }, [popover]);
  
  // Syllable splitting for dyslexia assistance
  const splitIntoSyllables = (word) => {
    const cleanWord = word.trim().replace(/[^a-zA-Z]/g, '');
    if (cleanWord.length <= 2) return [word];
    
    const vowels = 'aeiouAEIOU';
    const syllables = [];
    let currentSyllable = '';
    
    for (let i = 0; i < cleanWord.length; i++) {
      const char = cleanWord[i];
      currentSyllable += char;
      
      if (vowels.includes(char) && i < cleanWord.length - 1) {
        const nextChar = cleanWord[i + 1];
        if (!vowels.includes(nextChar) || currentSyllable.length >= 3) {
          syllables.push(currentSyllable);
          currentSyllable = '';
        }
      }
    }
    
    if (currentSyllable) {
      if (syllables.length > 0) {
        syllables[syllables.length - 1] += currentSyllable;
      } else {
        syllables.push(currentSyllable);
      }
    }
    
    return syllables.length > 0 ? syllables : [word];
  };
  
  const getAccessibilityClasses = () => {
    return [
      `text-size-${textSize}`,
      `font-${fontFamily}`,
      `line-spacing-${lineSpacing}`,
      `letter-spacing-${letterSpacing}`,
      `word-spacing-${wordSpacing}`,
      highContrast ? 'high-contrast' : '',
      readingGuide ? 'reading-guide' : '',
      colorOverlay !== 'none' ? `overlay-${colorOverlay}` : ''
    ].filter(Boolean).join(' ');
  };

  const connectWebSocket = useCallback(() => {
    // Don't reconnect if already connected or connecting
    if (wsRef.current && (wsRef.current.readyState === WebSocket.CONNECTING || wsRef.current.readyState === WebSocket.OPEN)) {
      return;
    }

    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      
      ws.onopen = () => {
        setIsConnected(true);
        setConnectionError(null);
        retryCountRef.current = 0;
      };
      
      ws.onclose = (event) => {
        setIsConnected(false);
        
        // Only reconnect if it wasn't a manual close (code 1000) and we haven't exceeded retry limit
        if (event.code !== 1000 && retryCountRef.current < 3) {
          const delay = Math.min(3000 * Math.pow(1.5, retryCountRef.current), 15000);
          reconnectTimeoutRef.current = setTimeout(() => {
            retryCountRef.current += 1;
            connectWebSocket();
          }, delay);
        } else if (retryCountRef.current >= 3) {
          setConnectionError('Connection lost');
        }
      };
      
      ws.onerror = () => {
        // Don't set error immediately, let onclose handle it
      };
      
      ws.onmessage = async (e) => {
        try {
          const data = typeof e.data === 'string' ? e.data : await e.data.text();
          const msg = JSON.parse(data);
          if (msg.type !== "CAPTION") return;
          
          const newWords = msg.words.map(w => ({
            ...w, 
            text: (w.text || "") + " ",
            timestamp: Date.now()
          }));
          setParts(p => [...p, ...newWords]);
          
          // Add new words to pending queue for animation
          pendingWordsRef.current = [...pendingWordsRef.current, ...newWords];
          startWordAnimation();
        } catch (error) {
          // Silent error handling
        }
      };
      
    } catch (error) {
      setConnectionError('Failed to connect');
    }
  }, []);

  useEffect(() => {
    connectWebSocket();
    
    return () => {
      if (wsRef.current) {
        wsRef.current.close(1000, 'Component unmounting');
      }
      if (animationTimeoutRef.current) {
        clearTimeout(animationTimeoutRef.current);
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []); // Remove connectWebSocket dependency to prevent loops

  const startWordAnimation = useCallback(() => {
    if (animationTimeoutRef.current) return; // Already animating
    
    setIsTyping(true);
    
    const animateNextWord = () => {
      if (pendingWordsRef.current.length === 0) {
        animationTimeoutRef.current = null;
        setIsTyping(false);
        return;
      }
      
      const nextWord = pendingWordsRef.current.shift();
      const wordWithId = { 
        ...nextWord, 
        uniqueId: `${nextWord.id}-${Date.now()}`, 
        isNew: true,
        timestamp: nextWord.timestamp || Date.now(),
        conf: nextWord.conf || 0.5 // Default confidence if missing
      };
      
      setDisplayedParts(prev => [...prev, wordWithId]);
      setWordCount(prev => prev + 1);
      
      // Remove the "new" flag after animation with RAF for smoother performance
      requestAnimationFrame(() => {
        setTimeout(() => {
          setDisplayedParts(prev => 
            prev.map(part => part.uniqueId === wordWithId.uniqueId ? { ...part, isNew: false } : part)
          );
        }, 150);
      });
      
      // Dynamic timing based on word length for more natural feel
      const baseDelay = 90;
      const wordLength = nextWord.text.trim().length;
      const delay = Math.max(baseDelay - (wordLength * 5), 50);
      
      animationTimeoutRef.current = setTimeout(animateNextWord, delay);
    };
    
    animateNextWord();
  }, []);

  // Multi-word selection functions
  const handleTokenClick = (e, token, tokenIndex) => {
    if (e.ctrlKey || e.metaKey) {
      // Multi-select mode
      e.preventDefault();
      setSelectedTokens(prev => {
        const newSet = new Set(prev);
        if (newSet.has(tokenIndex)) {
          newSet.delete(tokenIndex);
        } else {
          newSet.add(tokenIndex);
        }
        return newSet;
      });
      setIsSelecting(true);
    } else if (selectedTokens.size > 0) {
      // If we have selected tokens, define the selection
      handleMultiWordDefinition(e);
    } else {
      // Single word selection
      onTap(e, token, tokenIndex);
    }
  };

  const handleMultiWordDefinition = async (e) => {
    if (selectedTokens.size === 0) return;
    
    const sortedIndices = Array.from(selectedTokens).sort((a, b) => a - b);
    const selectedWords = sortedIndices.map(idx => displayedParts[idx]?.text?.trim() || '').join(' ');
    const cleanedTerm = selectedWords.replace(/[^\w\s-]/g, '').trim().toLowerCase();
    
    if (!cleanedTerm) {
      setSelectedTokens(new Set());
      setIsSelecting(false);
      return;
    }
    
    // Use the position of the first selected token for popover positioning
    const firstIndex = Math.min(...sortedIndices);
    const mockToken = {
      text: selectedWords,
      conf: Math.min(...sortedIndices.map(idx => displayedParts[idx]?.conf || 0.5)),
      timestamp: Date.now()
    };
    
    setSelectedTokens(new Set());
    setIsSelecting(false);
    await onTap(e, mockToken, firstIndex);
  };

  const clearSelection = () => {
    setSelectedTokens(new Set());
    setIsSelecting(false);
  };

  async function onTap(e, token, tokenIndex, forceSource = null) {
    console.log('🔍 onTap called with token:', token, 'index:', tokenIndex);
    const term = token.text.trim().replace(/[^\w\s-]/g, "").toLowerCase();
    if (!term) {
      return;
    }
    
    setIsLoading(true);
    
    const rect = e.target.getBoundingClientRect();
    const scrollY = window.scrollY;
    
    // Build context from surrounding words (~12 words around the tapped word)
    const left = displayedParts.slice(Math.max(0, tokenIndex - 6), tokenIndex).map(t => t.text).join("");
    const focus = displayedParts[tokenIndex]?.text || "";
    const right = displayedParts.slice(tokenIndex + 1, tokenIndex + 7).map(t => t.text).join("");
    const context = (left + focus + right).trim();
    
    // Always try API first (server handles LLM vs local priority)
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
      const res = await fetch(`${API_URL}/define`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ 
          term: focus.trim(), 
          context: context, 
          lang: "en" 
        })
      });
      
      clearTimeout(timeoutId);
      
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      
      const ans = await res.json();
      
      // Skip filler words
      if (ans.definition === "skip") {
        setIsLoading(false);
        return;
      }
      
      // Prevent click event from closing popover
      e.stopPropagation();
      
      setPopover({ 
        text: focus.trim(), 
        def: ans.definition || "Definition not available", 
        x: rect.left, 
        y: rect.top + scrollY - 70,
        confidence: token.conf,
        timestamp: token.timestamp,
        source: ans.model || "AI",
        showSourceOptions: false, // Remove source options for cleaner UI
        originalTerm: term,
        originalToken: token,
        originalIndex: tokenIndex
      });
      
    } catch (error) {
      console.warn('API error:', error);
      
      // Simple fallback without annoying messages
      e.stopPropagation();
      
      setPopover({ 
        text: term, 
        def: `Definition temporarily unavailable. Please try again.`,
        x: rect.left, 
        y: rect.top + scrollY - 70,
        source: "Temporary Error",
        showSourceOptions: false,
        originalTerm: term,
        originalToken: token,
        originalIndex: tokenIndex
      });
    } finally {
      setIsLoading(false);
    }
  }

  function closePopover() {
    setPopover(null);
  }

  useEffect(() => {
    function handleClickOutside(event) {
      // Don't close if clicking on a word (which would have caption-word class)
      if (popover && !event.target.closest('.definition-popover') && !event.target.closest('.caption-word')) {
        console.log('🔄 Closing popover due to outside click');
        closePopover();
      }
    }
    
    // Add a small delay to prevent immediate closing when popover is first shown
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
    }, 100);
    
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClickOutside);
    };
  }, [popover]);

  const formatSessionTime = () => {
    if (!sessionStartTime) return "--";
    const elapsed = Math.floor((Date.now() - sessionStartTime) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const getStatusText = () => {
    if (connectionError) return "Connection lost";
    if (!isConnected) return "Connecting...";
    if (displayedParts.length === 0) return "Ready for captions";
    return `${wordCount} words • ${formatSessionTime()}`;
  };

  return (
    <div className={`app-container ${getAccessibilityClasses()}`}>
      <header className="app-header">
        <button 
          className="accessibility-toggle"
          onClick={() => setShowAccessibilityPanel(!showAccessibilityPanel)}
          aria-label="Toggle accessibility settings"
          title="Accessibility Settings"
        >
          ⚙️
        </button>
        <h1 className="app-title">Context Subtitles</h1>
        <div className={`status-indicator ${isLoading ? 'loading' : ''}`}>
          <div className={`status-dot ${
            !isConnected || displayedParts.length === 0 ? 'waiting' : ''
          } ${
            connectionError ? 'error' : ''
          }`}></div>
          {getStatusText()}
        </div>
      </header>

      {showAccessibilityPanel && (
        <div className="accessibility-panel">
          <div className="panel-header">
            <h3>Accessibility Settings</h3>
            <button 
              className="close-panel"
              onClick={() => setShowAccessibilityPanel(false)}
              aria-label="Close accessibility settings"
              title="Close Settings"
            >
              ✕
            </button>
          </div>
          
          <div className="setting-group">
            <label>Text Size</label>
            <select 
              value={textSize} 
              onChange={(e) => setTextSize(e.target.value)}
              aria-label="Select text size"
            >
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
              <option value="extra-large">Extra Large</option>
              <option value="huge">Huge</option>
            </select>
          </div>
          
          <div className="setting-group">
            <label>Font Family</label>
            <select 
              value={fontFamily} 
              onChange={(e) => setFontFamily(e.target.value)}
              aria-label="Select font family"
            >
              <option value="inter">Inter (Default)</option>
              <option value="lexend">Lexend (Dyslexia-friendly)</option>
              <option value="atkinson">Atkinson Hyperlegible</option>
              <option value="open-sans">Open Sans</option>
              <option value="comic-sans">Comic Sans MS</option>
            </select>
          </div>
          
          <div className="setting-group">
            <label>Line Spacing</label>
            <select 
              value={lineSpacing} 
              onChange={(e) => setLineSpacing(e.target.value)}
              aria-label="Select line spacing"
            >
              <option value="tight">Tight</option>
              <option value="normal">Normal</option>
              <option value="relaxed">Relaxed</option>
              <option value="loose">Loose</option>
            </select>
          </div>
          
          <div className="setting-group">
            <label>Letter Spacing</label>
            <select 
              value={letterSpacing} 
              onChange={(e) => setLetterSpacing(e.target.value)}
              aria-label="Select letter spacing"
            >
              <option value="tight">Tight</option>
              <option value="normal">Normal</option>
              <option value="wide">Wide</option>
              <option value="wider">Wider</option>
            </select>
          </div>
          
          <div className="setting-group">
            <label>Word Spacing</label>
            <select 
              value={wordSpacing} 
              onChange={(e) => setWordSpacing(e.target.value)}
              aria-label="Select word spacing"
            >
              <option value="normal">Normal</option>
              <option value="wide">Wide</option>
              <option value="wider">Wider</option>
            </select>
          </div>
          
          <div className="setting-group">
            <label>Color Overlay</label>
            <select 
              value={colorOverlay} 
              onChange={(e) => setColorOverlay(e.target.value)}
              aria-label="Select color overlay"
            >
              <option value="none">None</option>
              <option value="yellow">Yellow Tint</option>
              <option value="blue">Blue Tint</option>
              <option value="green">Green Tint</option>
              <option value="pink">Pink Tint</option>
            </select>
          </div>
          
          <div className="setting-group checkbox-group">
            <label>
              <input 
                type="checkbox" 
                checked={highContrast}
                onChange={(e) => setHighContrast(e.target.checked)}
                aria-describedby="high-contrast-desc"
              />
              <span>High Contrast Mode</span>
            </label>
            <small id="high-contrast-desc">Increases text contrast for better readability</small>
          </div>
          
          <div className="setting-group checkbox-group">
            <label>
              <input 
                type="checkbox" 
                checked={readingGuide}
                onChange={(e) => setReadingGuide(e.target.checked)}
                aria-describedby="reading-guide-desc"
              />
              <span>Reading Guide</span>
            </label>
            <small id="reading-guide-desc">Highlights the current line being read</small>
          </div>
          
          <div className="setting-group checkbox-group">
            <label>
              <input 
                type="checkbox" 
                checked={showSyllables}
                onChange={(e) => setShowSyllables(e.target.checked)}
                aria-describedby="syllables-desc"
              />
              <span>Show Syllable Breaks</span>
            </label>
            <small id="syllables-desc">Separates words into syllables for easier reading</small>
          </div>
          
          <div className="setting-group">
            <label>Definition Source Preference</label>
            <select 
              value={preferredSource} 
              onChange={(e) => setPreferredSource(e.target.value)}
              aria-label="Select definition source preference"
            >
              <option value="auto">Auto (Local first, then LLM)</option>
              <option value="local">Local Glossary Only</option>
              <option value="llm">LLM Generated Only</option>
            </select>
            <small>Choose whether to prioritize local definitions or AI-generated ones</small>
          </div>
          
          <button 
            className="reset-settings"
            onClick={() => {
              setTextSize('medium');
              setFontFamily('inter');
              setLineSpacing('normal');
              setLetterSpacing('normal');
              setWordSpacing('normal');
              setHighContrast(false);
              setReadingGuide(false);
              setColorOverlay('none');
              setShowSyllables(false);
              setPreferredSource('auto');
            }}
          >
            Reset to Defaults
          </button>
        </div>
      )}

      <main className="captions-container" ref={captionsContainerRef}>
        {displayedParts.length > 0 ? (
          <>
            {displayedParts.map((tok, index) => (
              <span 
                key={tok.uniqueId || `${tok.id}-${index}`}
                className={`caption-word ${
                  tok.conf < 0.7 ? 'low-confidence' : ''
                } ${
                  tok.isNew ? 'word-appearing' : ''
                } ${
                  isLoading ? 'loading' : ''
                } ${
                  selectedTokens.has(index) ? 'selected' : ''
                }`}
                onClick={(e) => {
                  console.log('🖱️ Word clicked:', tok.text.trim());
                  !isLoading && handleTokenClick(e, tok, index);
                }}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ' ') && !isLoading) {
                    e.preventDefault();
                    handleTokenClick(e, tok, index);
                  }
                  if (e.key === 'Escape') {
                    clearSelection();
                  }
                }}
                tabIndex={isLoading ? -1 : 0}
                role="button"
                aria-label={`Define "${tok.text.trim()}" (confidence: ${Math.round(tok.conf * 100)}%)`}
                title={`Confidence: ${Math.round(tok.conf * 100)}% • Click for definition`}
              >
                {showSyllables ? (
                  splitIntoSyllables(tok.text).map((syllable, syllIndex) => (
                    <span key={syllIndex} className="syllable">
                      {syllable}
                      {syllIndex < splitIntoSyllables(tok.text).length - 1 && (
                        <span className="syllable-separator">•</span>
                      )}
                    </span>
                  ))
                ) : (
                  tok.text
                )}
              </span>
            ))}
            {isTyping && <span className="typing-cursor"></span>}
            {selectedTokens.size > 0 && (
              <div className="multi-select-controls">
                <button 
                  className="define-selection-btn"
                  onClick={handleMultiWordDefinition}
                  title={`Define selected ${selectedTokens.size} words`}
                >
                  Define Selection ({selectedTokens.size} words)
                </button>
                <button 
                  className="clear-selection-btn"
                  onClick={clearSelection}
                  title="Clear selection"
                >
                  Clear
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="empty-state">
            <div className="empty-state-icon">🎤</div>
            <div>Waiting for live captions to appear...</div>
            {sessionStartTime && (
              <div style={{ marginTop: '1rem', fontSize: '0.9rem', opacity: 0.7 }}>
                Session time: {formatSessionTime()}
              </div>
            )}
            <div style={{ marginTop: '1rem', fontSize: '0.8rem', opacity: 0.6 }}>
              💡 Tip: Use the ⚙️ button to customize text for better readability<br/>
              🔍 Hold Ctrl/Cmd while clicking words to select multiple words like "artificial intelligence"
            </div>
            <div style={{ marginTop: '1rem' }}>
              <button 
                className="test-glossary-btn"
                onClick={() => {
                  // Add some test words with definitions from our glossary
                  const currentTime = Date.now();
                  const testWords = [
                    { id: 1, text: "technology ", conf: 0.95, timestamp: currentTime },
                    { id: 2, text: "and ", conf: 0.98, timestamp: currentTime },
                    { id: 3, text: "artificial ", conf: 0.92, timestamp: currentTime },
                    { id: 4, text: "intelligence ", conf: 0.89, timestamp: currentTime },
                    { id: 5, text: "are ", conf: 0.97, timestamp: currentTime },
                    { id: 6, text: "transforming ", conf: 0.85, timestamp: currentTime },
                    { id: 7, text: "our ", conf: 0.99, timestamp: currentTime },
                    { id: 8, text: "digital ", conf: 0.93, timestamp: currentTime },
                    { id: 9, text: "world. ", conf: 0.96, timestamp: currentTime },
                    { id: 10, text: "Machine ", conf: 0.88, timestamp: currentTime },
                    { id: 11, text: "learning ", conf: 0.91, timestamp: currentTime },
                    { id: 12, text: "algorithms ", conf: 0.87, timestamp: currentTime },
                    { id: 13, text: "process ", conf: 0.94, timestamp: currentTime },
                    { id: 14, text: "data ", conf: 0.96, timestamp: currentTime },
                    { id: 15, text: "to ", conf: 0.99, timestamp: currentTime },
                    { id: 16, text: "improve ", conf: 0.92, timestamp: currentTime },
                    { id: 17, text: "user ", conf: 0.95, timestamp: currentTime },
                    { id: 18, text: "experience. ", conf: 0.90, timestamp: currentTime }
                  ];
                  
                  pendingWordsRef.current = [...pendingWordsRef.current, ...testWords];
                  startWordAnimation();
                }}
              >
                🧪 Test Glossary (Click words like "technology", "artificial", "intelligence")
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Debug indicator removed for production */}
      
      {popover && (
        <div 
          className={`definition-popover ${popover.isError ? 'error' : ''}`}
          style={{
            left: Math.min(Math.max(popover.x, 16), window.innerWidth - 350),
            top: popover.y < 100 ? popover.y + 50 : popover.y - 80
          }}
        >
          <div className="definition-header">
            <span className="definition-term">{popover.text}</span>
            {popover.confidence && (
              <span className="definition-confidence">
                {Math.round(popover.confidence * 100)}% confident
              </span>
            )}
          </div>
          <div className="definition-content">
            {popover.def}
          </div>
          <div className="definition-footer">
            {popover.source && (
              <span className="definition-source">
                Source: {popover.source}
              </span>
            )}
            {popover.timestamp && (
              <span className="definition-timestamp">
                {new Date(popover.timestamp).toLocaleTimeString()}
              </span>
            )}
            {/* Source options removed for cleaner UI */}
          </div>
        </div>
      )}
    </div>
  );
}
