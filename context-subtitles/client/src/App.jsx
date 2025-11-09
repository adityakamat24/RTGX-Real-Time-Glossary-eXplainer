import { useEffect, useRef, useState, useCallback } from "react";
import { useTranslation } from 'react-i18next';
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

// LLM-only mode - no local glossary fallback

export default function App() {
  const { t, i18n } = useTranslation();
  const [parts, setParts] = useState([]);
  const [displayedParts, setDisplayedParts] = useState([]);
  const [popover, setPopover] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [connectionError, setConnectionError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingWordIndex, setLoadingWordIndex] = useState(-1);
  const [wordCount, setWordCount] = useState(0);
  const [sessionStartTime, setSessionStartTime] = useState(null);
  const [showAccessibilityPanel, setShowAccessibilityPanel] = useState(false);
  const [preferredSource, setPreferredSource] = useState('llm'); // LLM-only mode
  const [selectedTokens, setSelectedTokens] = useState(new Set());
  const [isSelecting, setIsSelecting] = useState(false);
  const [popoverRef, setPopoverRef] = useState(null);
  const [currentWordIndex, setCurrentWordIndex] = useState(-1);
  const [isMobile, setIsMobile] = useState(false);
  const [touchStartTime, setTouchStartTime] = useState(0);
  const [longPressTimer, setLongPressTimer] = useState(null);
  const [longPressTriggered, setLongPressTriggered] = useState(false);
  const [pinnedWords, setPinnedWords] = useState([]);
  const [showPinnedPanel, setShowPinnedPanel] = useState(false);
  const [showClearModal, setShowClearModal] = useState(false);
  const [showStatsPanel, setShowStatsPanel] = useState(false);
  const [stats, setStats] = useState(null);
  const [isProfessor, setIsProfessor] = useState(false);
  const [transcriptionLang, setTranscriptionLang] = useState('en');

  // Check if user is professor (via URL parameter ?role=professor)
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const role = urlParams.get('role');
    setIsProfessor(role === 'professor');

    // Check for language parameter
    const lang = urlParams.get('lang');
    if (lang) {
      i18n.changeLanguage(lang);
      setTranscriptionLang(lang);
    }
  }, [i18n]);

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

  // Mobile device detection and setup
  useEffect(() => {
    const checkIsMobile = () => {
      const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
        window.innerWidth <= 768 ||
        ('ontouchstart' in window);
      setIsMobile(isMobileDevice);
    };

    checkIsMobile();
    window.addEventListener('resize', checkIsMobile);
    return () => window.removeEventListener('resize', checkIsMobile);
  }, []);

  // Load accessibility settings and pinned words from localStorage
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
        setPreferredSource('llm'); // Force LLM-only mode
      } catch (e) {
        console.warn('Failed to load accessibility settings:', e);
      }
    }

    // Load pinned words
    const savedPinnedWords = localStorage.getItem('contextSubtitlesPinnedWords');
    if (savedPinnedWords) {
      try {
        const pinnedWordsData = JSON.parse(savedPinnedWords);
        setPinnedWords(pinnedWordsData);
      } catch (e) {
        console.warn('Failed to load pinned words:', e);
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

  // Reading Guide - Mouse tracking
  useEffect(() => {
    if (!readingGuide || !captionsContainerRef.current) return;

    const container = captionsContainerRef.current;

    const handleMouseMove = (e) => {
      const rect = container.getBoundingClientRect();
      const mouseY = e.clientY - rect.top;
      const containerHeight = rect.height;

      // Calculate percentage position (clamped between 10% and 90%)
      const percentage = Math.max(10, Math.min(90, (mouseY / containerHeight) * 100));

      container.style.setProperty('--guide-position', `${percentage}%`);
    };

    const handleMouseLeave = () => {
      // Reset to center when mouse leaves
      container.style.setProperty('--guide-position', '50%');
    };

    container.addEventListener('mousemove', handleMouseMove);
    container.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      container.removeEventListener('mousemove', handleMouseMove);
      container.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [readingGuide]);
  
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
            text: w.text || "",
            timestamp: Date.now()
          }));

          // Enhanced client-side deduplication
          const filteredWords = newWords.filter(newWord => {
            // Check if we already have this exact word ID
            const existsInParts = parts.some(existingWord => existingWord.id === newWord.id);
            const existsInPending = pendingWordsRef.current.some(pendingWord => pendingWord.id === newWord.id);

            return !existsInParts && !existsInPending;
          });

          if (filteredWords.length > 0) {
            setParts(p => [...p, ...filteredWords]);

            // Add new words to pending queue for animation
            pendingWordsRef.current = [...pendingWordsRef.current, ...filteredWords];
            startWordAnimation();
          }
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
      if (longPressTimer) {
        clearTimeout(longPressTimer);
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
        conf: nextWord.conf || 0.5, // Default confidence if missing
        text: nextWord.text.endsWith(' ') ? nextWord.text : nextWord.text + ' ' // Ensure proper spacing
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

    // Don't clear selected tokens yet - keep them highlighted until popover closes
    setIsSelecting(false);
    await onTap(e, mockToken, firstIndex, sortedIndices);
  };

  const clearSelection = () => {
    setSelectedTokens(new Set());
    setIsSelecting(false);
  };

  // Pinned words management
  const savePinnedWords = useCallback((words) => {
    localStorage.setItem('contextSubtitlesPinnedWords', JSON.stringify(words));
  }, []);

  const pinWord = useCallback((wordData) => {
    const newPinnedWord = {
      id: `pin_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      word: wordData.text,
      definition: wordData.def,
      context: wordData.context || '',
      timestamp: new Date().toISOString(),
      source: wordData.source || 'AI',
      confidence: wordData.confidence || null
    };

    setPinnedWords(prev => {
      // Check if word already pinned (avoid duplicates)
      const alreadyPinned = prev.some(pinned =>
        pinned.word.toLowerCase() === wordData.text.toLowerCase() &&
        pinned.definition === wordData.def
      );

      if (alreadyPinned) {
        return prev;
      }

      const updated = [...prev, newPinnedWord];
      savePinnedWords(updated);
      return updated;
    });

    return newPinnedWord;
  }, [savePinnedWords]);

  const unpinWord = useCallback((pinnedWordId) => {
    setPinnedWords(prev => {
      const updated = prev.filter(word => word.id !== pinnedWordId);
      savePinnedWords(updated);
      return updated;
    });
  }, [savePinnedWords]);

  const isWordPinned = useCallback((text, definition) => {
    return pinnedWords.some(pinned =>
      pinned.word.toLowerCase() === text.toLowerCase() &&
      pinned.definition === definition
    );
  }, [pinnedWords]);

  const getPinnedWordId = useCallback((text, definition) => {
    const found = pinnedWords.find(pinned =>
      pinned.word.toLowerCase() === text.toLowerCase() &&
      pinned.definition === definition
    );
    return found?.id;
  }, [pinnedWords]);

  // Fetch statistics for professor dashboard
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/stats`);
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    }
  }, []);

  // Auto-refresh stats every 5 seconds when panel is open
  useEffect(() => {
    if (showStatsPanel) {
      fetchStats(); // Initial fetch
      const interval = setInterval(fetchStats, 5000); // Refresh every 5 seconds
      return () => clearInterval(interval);
    }
  }, [showStatsPanel, fetchStats]);

  // Format duration in minutes:seconds
  const formatDuration = (ms) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Session time formatting
  const formatSessionTime = useCallback(() => {
    if (!sessionStartTime) return "--";
    const elapsed = Math.floor((Date.now() - sessionStartTime) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }, [sessionStartTime]);

  // Clear display only (keeps data for download)
  const clearDisplay = useCallback(() => {
    setDisplayedParts([]);
    setShowClearModal(false);
    closePopover();
    clearSelection();
    console.log('Display cleared (session data preserved)');
  }, []);

  // Clear everything (including session data)
  const clearEverything = useCallback(() => {
    setDisplayedParts([]);
    setParts([]);
    setWordCount(0);
    pendingWordsRef.current = [];
    setShowClearModal(false);
    closePopover();
    clearSelection();
    console.log('Everything cleared (session data reset)');
  }, []);

  // Download session functionality
  const downloadSession = useCallback(() => {
    const sessionData = {
      timestamp: new Date().toISOString(),
      sessionStartTime: sessionStartTime ? new Date(sessionStartTime).toISOString() : null,
      sessionDuration: sessionStartTime ? formatSessionTime() : '00:00',
      wordCount: wordCount,
      captions: displayedParts.map(part => ({
        text: part.text, // Keep original spacing
        confidence: part.conf,
        timestamp: part.timestamp ? new Date(part.timestamp).toLocaleString() : 'Unknown'
      })),
      pinnedWords: pinnedWords
    };

    // Create the content string
    let content = `# Context Subtitles Session Export\n\n`;
    content += `**Export Date:** ${new Date().toLocaleString()}\n`;
    content += `**Session Duration:** ${sessionData.sessionDuration}\n`;
    content += `**Total Words:** ${sessionData.wordCount}\n`;
    content += `**Pinned Definitions:** ${pinnedWords.length}\n\n`;

    content += `## Session Captions\n\n`;
    if (sessionData.captions.length > 0) {
      const fullText = sessionData.captions.map(caption => caption.text).join('');
      // Split into paragraphs for better readability
      const sentences = fullText.split(/[.!?]+/).filter(s => s.trim().length > 0);
      sentences.forEach(sentence => {
        if (sentence.trim()) {
          content += `${sentence.trim()}.\n\n`;
        }
      });
    } else {
      content += `No captions recorded in this session.\n\n`;
    }

    if (pinnedWords.length > 0) {
      content += `## Pinned Definitions\n\n`;
      content += `The following words and their definitions were pinned during this session:\n\n`;

      pinnedWords.forEach((pinned, index) => {
        content += `### ${index + 1}. ${pinned.word}\n\n`;
        content += `**Definition:** ${pinned.definition}\n\n`;
        if (pinned.context) {
          content += `**Context:** ${pinned.context}\n\n`;
        }
        content += `**Source:** ${pinned.source}\n`;
        content += `**Saved:** ${new Date(pinned.timestamp).toLocaleString()}\n`;
        if (pinned.confidence) {
          content += `**Confidence:** ${Math.round(pinned.confidence * 100)}%\n`;
        }
        content += `\n---\n\n`;
      });
    }

    content += `\n## Export Information\n\n`;
    content += `Generated by Context Subtitles - Real-time AI-powered caption glossary system\n`;
    content += `Export generated on: ${new Date().toLocaleString()}\n`;

    // Create and download the file
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    link.download = `context-subtitles-session-${timestamp}.txt`;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    console.log('📥 Session downloaded successfully');
  }, [displayedParts, pinnedWords, wordCount, sessionStartTime, formatSessionTime]);

  // Enhanced popover positioning with mobile optimization
  const calculatePopoverPosition = useCallback((targetElement, popoverElement = null) => {
    if (!targetElement) return { x: 0, y: 0, position: 'below' };

    const rect = targetElement.getBoundingClientRect();
    const scrollY = window.scrollY;
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    // Dynamic popover dimensions
    const popoverHeight = popoverElement ? popoverElement.offsetHeight : (isMobile ? 180 : 150);
    const popoverWidth = isMobile ? Math.min(viewportWidth - 40, 320) : 350;

    // Mobile-specific positioning
    if (isMobile) {
      // On mobile, prefer positioning that doesn't cover the word
      const spaceAbove = rect.top;
      const spaceBelow = viewportHeight - rect.bottom;

      let popoverY;
      let position = 'below';

      // Check if there's enough space for mobile keyboards and touch interaction
      const safeSpaceAbove = spaceAbove > popoverHeight + 60;
      const safeSpaceBelow = spaceBelow > popoverHeight + 100; // Extra space for mobile keyboards

      if (safeSpaceAbove && !safeSpaceBelow) {
        // Position above on mobile
        popoverY = rect.top + scrollY - popoverHeight - 20;
        position = 'above';
      } else if (safeSpaceBelow) {
        // Position below on mobile
        popoverY = rect.bottom + scrollY + 20;
        position = 'below';
      } else {
        // Not enough safe space, position in center of viewport
        popoverY = scrollY + (viewportHeight - popoverHeight) / 2;
        position = spaceAbove > spaceBelow ? 'above' : 'below';
      }

      // Center horizontally on mobile for better accessibility
      const popoverX = (viewportWidth - popoverWidth) / 2;
      return { x: Math.max(20, popoverX), y: popoverY, position };
    }

    // Desktop positioning (original logic)
    const spaceAbove = rect.top;
    const spaceBelow = viewportHeight - rect.bottom;
    const preferAbove = spaceAbove > popoverHeight + 20;
    const preferBelow = spaceBelow > popoverHeight + 20;

    let popoverY;
    let position = 'below';

    if (preferAbove && (!preferBelow || spaceAbove > spaceBelow)) {
      popoverY = rect.top + scrollY - popoverHeight - 15;
      position = 'above';
    } else if (preferBelow) {
      popoverY = rect.bottom + scrollY + 15;
      position = 'below';
    } else {
      if (spaceAbove > spaceBelow) {
        popoverY = scrollY + 20;
        position = 'above';
      } else {
        popoverY = scrollY + viewportHeight - popoverHeight - 20;
        position = 'below';
      }
    }

    // Desktop horizontal positioning
    let popoverX = rect.left;
    const rightEdge = popoverX + popoverWidth;

    if (rightEdge > viewportWidth - 20) {
      popoverX = viewportWidth - popoverWidth - 20;
    }
    if (popoverX < 20) {
      popoverX = 20;
    }

    return { x: popoverX, y: popoverY, position };
  }, [isMobile]);

  // Dynamic popover repositioning on scroll
  useEffect(() => {
    if (!popover || !popoverRef) return;

    const handleScroll = () => {
      // Find the original word element
      const targetElement = document.querySelector(`[data-word-index="${popover.originalIndex}"]`);
      if (!targetElement) return;

      const newPosition = calculatePopoverPosition(targetElement, popoverRef);

      setPopover(prev => ({
        ...prev,
        x: newPosition.x,
        y: newPosition.y,
        position: newPosition.position
      }));
    };

    const throttledScroll = throttle(handleScroll, 16); // ~60fps

    window.addEventListener('scroll', throttledScroll, { passive: true });
    window.addEventListener('resize', throttledScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', throttledScroll);
      window.removeEventListener('resize', throttledScroll);
    };
  }, [popover, popoverRef, calculatePopoverPosition]);

  // Simple throttle function
  function throttle(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  // Keyboard navigation for accessibility
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (displayedParts.length === 0) return;

      // Global keyboard shortcuts
      if (e.key === 'Escape') {
        closePopover();
        setCurrentWordIndex(-1);
        return;
      }

      // Only handle arrow keys if not in an input field
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        const nextIndex = Math.min(currentWordIndex + 1, displayedParts.length - 1);
        setCurrentWordIndex(nextIndex);

        // Focus the word element
        const wordElement = document.querySelector(`[data-word-index="${nextIndex}"]`);
        if (wordElement) {
          wordElement.focus();
          wordElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }

      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        const prevIndex = Math.max(currentWordIndex - 1, 0);
        setCurrentWordIndex(prevIndex);

        // Focus the word element
        const wordElement = document.querySelector(`[data-word-index="${prevIndex}"]`);
        if (wordElement) {
          wordElement.focus();
          wordElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }

      if (e.key === 'Enter' || e.key === ' ') {
        if (currentWordIndex >= 0 && currentWordIndex < displayedParts.length) {
          e.preventDefault();
          const wordElement = document.querySelector(`[data-word-index="${currentWordIndex}"]`);
          if (wordElement && loadingWordIndex < 0) {
            const syntheticEvent = {
              target: wordElement,
              stopPropagation: () => {},
              preventDefault: () => {}
            };
            handleTokenClick(syntheticEvent, displayedParts[currentWordIndex], currentWordIndex);
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [currentWordIndex, displayedParts, loadingWordIndex, handleTokenClick]);

  // Update current word index when popover opens
  useEffect(() => {
    if (popover && popover.originalIndex !== undefined) {
      setCurrentWordIndex(popover.originalIndex);
    }
  }, [popover]);

  async function onTap(e, token, tokenIndex, selectedIndices = null) {
    console.log('🔍 onTap called with token:', token, 'index:', tokenIndex, 'selectedIndices:', selectedIndices);
    const term = token.text.trim().replace(/[^\w\s-]/g, "").toLowerCase();
    if (!term) {
      return;
    }

    setIsLoading(true);
    setLoadingWordIndex(tokenIndex);

    // Calculate optimal position using enhanced positioning
    const position = calculatePopoverPosition(e.target);

    // Build context from surrounding words (~12 words around the tapped word)
    const left = displayedParts.slice(Math.max(0, tokenIndex - 6), tokenIndex).map(t => t.text).join("");
    // Use the full token text (which includes multi-word selections) instead of just the single word
    const focus = token.text.trim();
    const right = displayedParts.slice(tokenIndex + 1, tokenIndex + 7).map(t => t.text).join("");
    const context = (left + focus + right).trim();
    
    // LLM-only API call for definitions
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout for LLM processing
      
      console.log('🔍 Requesting definition for:', focus.trim(), 'with context length:', context.length);

      const res = await fetch(`${API_URL}/define`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          term: focus,
          context: context,
          lang: transcriptionLang  // Use selected language
        })
      });

      clearTimeout(timeoutId);

      console.log('📡 Response status:', res.status, res.statusText);

      if (!res.ok) {
        const errorText = await res.text();
        console.error('❌ Response error body:', errorText);
        throw new Error(`HTTP ${res.status}: ${errorText || res.statusText}`);
      }

      const ans = await res.json();
      console.log('✅ Successfully received definition:', ans);
      
      // Skip filler words
      if (ans.definition === "skip") {
        setIsLoading(false);
        return;
      }
      
      // Prevent click event from closing popover
      e.stopPropagation();
      
      setPopover({
        text: focus,
        def: ans.definition || "Definition not available",
        x: position.x,
        y: position.y,
        position: position.position,
        confidence: token.conf,
        timestamp: token.timestamp,
        source: ans.model || "AI",
        showSourceOptions: false, // Remove source options for cleaner UI
        originalTerm: term,
        originalToken: token,
        originalIndex: tokenIndex,
        selectedIndices: selectedIndices, // Store selected indices for multi-word highlighting
        context: context, // Add context for pinning
        isPinned: isWordPinned(focus, ans.definition || "Definition not available"),
        pinnedId: getPinnedWordId(focus, ans.definition || "Definition not available")
      });
      
    } catch (error) {
      console.error('API error details:', {
        error: error.message,
        name: error.name,
        stack: error.stack,
        term,
        context: context.substring(0, 100) + '...'
      });

      // Determine error type for better user messaging
      let errorMessage = "AI definition service temporarily unavailable. Please try again in a moment.";
      let errorSource = "Service Error";

      if (error.name === 'AbortError') {
        errorMessage = "Request timed out. The AI service is taking longer than expected. Please try again.";
        errorSource = "Timeout Error";
      } else if (error.message.includes('fetch')) {
        errorMessage = "Unable to connect to definition service. Please check your connection and try again.";
        errorSource = "Connection Error";
      } else if (error.message.includes('HTTP')) {
        errorMessage = `Server error (${error.message}). Please try again in a moment.`;
        errorSource = "Server Error";
      }

      e.stopPropagation();

      setPopover({
        text: term,
        def: errorMessage,
        x: position.x,
        y: position.y,
        position: position.position,
        source: errorSource,
        showSourceOptions: false,
        originalTerm: term,
        originalToken: token,
        originalIndex: tokenIndex,
        selectedIndices: selectedIndices, // Store selected indices for multi-word highlighting
        context: context,
        isError: true,
        isPinned: false, // Error messages can't be pinned
        pinnedId: null
      });
    } finally {
      setIsLoading(false);
      setLoadingWordIndex(-1);
    }
  }

  function closePopover() {
    setPopover(null);
    setCurrentWordIndex(-1); // Clear the highlighted word when closing popover
    setSelectedTokens(new Set()); // Clear multi-word selection when closing popover
  }

  const handlePinToggle = useCallback(() => {
    if (!popover) return;

    if (popover.isPinned) {
      // Unpin the word
      unpinWord(popover.pinnedId);
      setPopover(prev => ({
        ...prev,
        isPinned: false,
        pinnedId: null
      }));
    } else {
      // Pin the word
      const pinnedWord = pinWord({
        text: popover.text,
        def: popover.def,
        context: popover.context,
        source: popover.source,
        confidence: popover.confidence
      });
      setPopover(prev => ({
        ...prev,
        isPinned: true,
        pinnedId: pinnedWord.id
      }));
    }
  }, [popover, pinWord, unpinWord]);

  useEffect(() => {
    function handleClickOutside(event) {
      // Don't close if clicking on a word (which would have caption-word class)
      if (popover && !event.target.closest('.definition-popover') && !event.target.closest('.caption-word')) {
        console.log('🔄 Closing popover due to outside click');
        closePopover();
      }
    }

    function handleTouchOutside(event) {
      // Mobile-specific touch handling for closing popover
      if (isMobile && popover && !event.target.closest('.definition-popover') && !event.target.closest('.caption-word')) {
        closePopover();
      }
    }

    // Add a small delay to prevent immediate closing when popover is first shown
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
      if (isMobile) {
        document.addEventListener('touchstart', handleTouchOutside, { passive: true });
      }
    }, 100);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClickOutside);
      if (isMobile) {
        document.removeEventListener('touchstart', handleTouchOutside);
      }
    };
  }, [popover, isMobile]);

  const getStatusText = () => {
    if (connectionError) return "Connection lost";
    if (!isConnected) return "Connecting...";
    if (displayedParts.length === 0) return "Ready for captions";
    return `${wordCount} words • ${formatSessionTime()}`;
  };

  return (
    <div className={`app-container ${getAccessibilityClasses()}`}>
      <header className="app-header">
        <div className="header-left">
          <button
            className="accessibility-toggle"
            onClick={() => setShowAccessibilityPanel(!showAccessibilityPanel)}
            aria-label="Toggle accessibility settings"
            title="Accessibility Settings"
          >
            ⚙️
          </button>
          <button
            className={`pinned-toggle ${pinnedWords.length > 0 ? 'has-pinned' : ''}`}
            onClick={() => setShowPinnedPanel(!showPinnedPanel)}
            aria-label="Toggle pinned words panel"
            title={`Pinned Words (${pinnedWords.length})`}
          >
            📌 {pinnedWords.length > 0 && <span className="pin-count">{pinnedWords.length}</span>}
          </button>
          <button
            className="download-button"
            onClick={downloadSession}
            disabled={displayedParts.length === 0}
            aria-label="Download session"
            title="Download session with captions and pinned words"
          >
            📥
          </button>
          <button
            className="clear-button"
            onClick={() => setShowClearModal(true)}
            disabled={displayedParts.length === 0}
            aria-label="Clear subtitles"
            title="Clear subtitles"
          >
            🗑️
          </button>
          {isProfessor && (
            <button
              className="stats-button"
              onClick={() => setShowStatsPanel(!showStatsPanel)}
              aria-label="Toggle dashboard"
              title="Dashboard"
            >
              📊
            </button>
          )}
        </div>
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
            <small id="reading-guide-desc">Highlights text near your cursor to help track reading position</small>
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
            <label>{t('uiLanguage')}</label>
            <select
              value={i18n.language}
              onChange={(e) => i18n.changeLanguage(e.target.value)}
              aria-label="Select UI language"
            >
              <option value="en">English</option>
              <option value="es">Español</option>
              <option value="fr">Français</option>
              <option value="zh">中文</option>
              <option value="hi">हिन्दी</option>
            </select>
            <small>Change the interface language</small>
          </div>

          <div className="setting-group">
            <label>{t('transcriptionLanguage')}</label>
            <select
              value={transcriptionLang}
              onChange={(e) => setTranscriptionLang(e.target.value)}
              aria-label="Select transcription language"
            >
              <option value="en">English</option>
              <option value="es">Spanish</option>
              <option value="fr">French</option>
              <option value="de">German</option>
              <option value="it">Italian</option>
              <option value="pt">Portuguese</option>
              <option value="zh">Chinese</option>
              <option value="ja">Japanese</option>
              <option value="ko">Korean</option>
              <option value="hi">Hindi</option>
              <option value="ar">Arabic</option>
              <option value="ru">Russian</option>
            </select>
            <small>Language for ASR transcription and AI definitions</small>
          </div>

          <div className="setting-group">
            <label>Definition Source</label>
            <select
              value={preferredSource}
              onChange={(e) => setPreferredSource(e.target.value)}
              aria-label="Definition source (LLM-only mode)"
              disabled
            >
              <option value="llm">AI Generated Definitions</option>
            </select>
            <small>All definitions are generated by AI language models for contextual accuracy</small>
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
              setPreferredSource('llm');
            }}
          >
            Reset to Defaults
          </button>
        </div>
      )}

      {showStatsPanel && isProfessor && (
        <div className="stats-panel">
          <div className="panel-header">
            <h3>📊 Dashboard</h3>
            <button
              className="close-panel"
              onClick={() => setShowStatsPanel(false)}
              aria-label="Close statistics panel"
              title="Close Panel"
            >
              ✕
            </button>
          </div>

          {stats ? (
            <div className="stats-content">
              {/* Key Metric: Lookup Percentage */}
              <div className="stat-card highlight-card">
                <div className="stat-icon">🎯</div>
                <div className="stat-details">
                  <div className="stat-label">Words Looked Up</div>
                  <div className="stat-value-large">{stats.lookupPercentage}%</div>
                  <div className="stat-subtitle">
                    {stats.uniqueWordsLookedUp} of {stats.totalWords} unique words
                  </div>
                </div>
              </div>

              {/* Session Overview */}
              <div className="stats-grid">
                <div className="stat-card">
                  <div className="stat-icon">👥</div>
                  <div className="stat-details">
                    <div className="stat-label">Connected Students</div>
                    <div className="stat-value">{stats.connectedStudents}</div>
                    <div className="stat-subtitle">Peak: {stats.peakStudents}</div>
                  </div>
                </div>

                <div className="stat-card">
                  <div className="stat-icon">🔍</div>
                  <div className="stat-details">
                    <div className="stat-label">Total Lookups</div>
                    <div className="stat-value">{stats.totalLookups}</div>
                    <div className="stat-subtitle">Avg: {stats.avgLookupsPerStudent} per student</div>
                  </div>
                </div>

                <div className="stat-card">
                  <div className="stat-icon">⏱️</div>
                  <div className="stat-details">
                    <div className="stat-label">Session Duration</div>
                    <div className="stat-value">{formatDuration(stats.sessionDuration)}</div>
                    <div className="stat-subtitle">
                      Started: {new Date(stats.sessionStartTime).toLocaleTimeString()}
                    </div>
                  </div>
                </div>

                <div className="stat-card">
                  <div className="stat-icon">💬</div>
                  <div className="stat-details">
                    <div className="stat-label">Words Transcribed</div>
                    <div className="stat-value">{stats.totalWords}</div>
                    <div className="stat-subtitle">Live subtitles</div>
                  </div>
                </div>
              </div>

              {/* Engagement Over Time */}
              <div className="stat-section">
                <h4>📈 Recent Engagement</h4>
                <div className="engagement-bars">
                  <div className="engagement-item">
                    <span className="engagement-label">Last 1 min</span>
                    <div className="engagement-bar-container">
                      <div
                        className="engagement-bar"
                        style={{width: `${Math.min((stats.engagementByInterval.last1min / Math.max(stats.engagementByInterval.last30min, 1)) * 100, 100)}%`}}
                      ></div>
                      <span className="engagement-count">{stats.engagementByInterval.last1min}</span>
                    </div>
                  </div>
                  <div className="engagement-item">
                    <span className="engagement-label">Last 5 min</span>
                    <div className="engagement-bar-container">
                      <div
                        className="engagement-bar"
                        style={{width: `${Math.min((stats.engagementByInterval.last5min / Math.max(stats.engagementByInterval.last30min, 1)) * 100, 100)}%`}}
                      ></div>
                      <span className="engagement-count">{stats.engagementByInterval.last5min}</span>
                    </div>
                  </div>
                  <div className="engagement-item">
                    <span className="engagement-label">Last 15 min</span>
                    <div className="engagement-bar-container">
                      <div
                        className="engagement-bar"
                        style={{width: `${Math.min((stats.engagementByInterval.last15min / Math.max(stats.engagementByInterval.last30min, 1)) * 100, 100)}%`}}
                      ></div>
                      <span className="engagement-count">{stats.engagementByInterval.last15min}</span>
                    </div>
                  </div>
                  <div className="engagement-item">
                    <span className="engagement-label">Last 30 min</span>
                    <div className="engagement-bar-container">
                      <div
                        className="engagement-bar active"
                        style={{width: '100%'}}
                      ></div>
                      <span className="engagement-count">{stats.engagementByInterval.last30min}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Top Looked-Up Words */}
              <div className="stat-section">
                <h4>🔥 Most Confusing Terms</h4>
                {stats.topLookups.length > 0 ? (
                  <div className="top-words-list">
                    {stats.topLookups.map((item, index) => (
                      <div key={item.term} className="top-word-item">
                        <div className="top-word-rank">#{index + 1}</div>
                        <div className="top-word-term">{item.term}</div>
                        <div className="top-word-count">{item.count} lookup{item.count > 1 ? 's' : ''}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-stat">No lookups yet</div>
                )}
              </div>

              {/* Recent Lookups */}
              <div className="stat-section">
                <h4>🕐 Recent Lookups</h4>
                {stats.recentLookups.length > 0 ? (
                  <div className="recent-lookups-list">
                    {stats.recentLookups.slice(0, 10).map((lookup, index) => (
                      <div key={index} className="recent-lookup-item">
                        <div className="recent-lookup-term">{lookup.term}</div>
                        <div className="recent-lookup-time">
                          {new Date(lookup.timestamp).toLocaleTimeString()}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-stat">No recent lookups</div>
                )}
              </div>
            </div>
          ) : (
            <div className="stats-loading">
              <div className="loading-spinner"></div>
              <p>Loading statistics...</p>
            </div>
          )}
        </div>
      )}

      {showPinnedPanel && (
        <div className="pinned-panel">
          <div className="panel-header">
            <h3>Pinned Words ({pinnedWords.length})</h3>
            <button
              className="close-panel"
              onClick={() => setShowPinnedPanel(false)}
              aria-label="Close pinned words panel"
              title="Close Panel"
            >
              ✕
            </button>
          </div>

          <div className="pinned-content">
            {pinnedWords.length === 0 ? (
              <div className="empty-pinned">
                <div className="empty-pinned-icon">📌</div>
                <p>No words pinned yet</p>
                <small>Click the pin button (📍) on any definition to save it here</small>
              </div>
            ) : (
              <div className="pinned-list">
                {pinnedWords.map((pinned) => (
                  <div key={pinned.id} className="pinned-item">
                    <div className="pinned-header">
                      <span className="pinned-word">{pinned.word}</span>
                      <button
                        className="unpin-button"
                        onClick={() => unpinWord(pinned.id)}
                        aria-label={`Unpin ${pinned.word}`}
                        title="Remove from pinned words"
                      >
                        🗑️
                      </button>
                    </div>
                    <div className="pinned-definition">{pinned.definition}</div>
                    {pinned.context && (
                      <div className="pinned-context">
                        <small><strong>Context:</strong> {pinned.context}</small>
                      </div>
                    )}
                    <div className="pinned-meta">
                      <small>
                        {pinned.source} • {new Date(pinned.timestamp).toLocaleDateString()}
                        {pinned.confidence && ` • ${Math.round(pinned.confidence * 100)}% confidence`}
                      </small>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="pinned-actions">
            <button
              className="download-pinned-btn"
              onClick={downloadSession}
              disabled={displayedParts.length === 0}
              title="Download session with all captions and pinned words"
            >
              📥 Download Session
            </button>
          </div>
        </div>
      )}

      <main className="captions-container" ref={captionsContainerRef}>
        {displayedParts.length > 0 ? (
          <>
            {displayedParts.map((tok, index) => (
              <span
                key={tok.uniqueId || `${tok.id}-${index}`}
                data-word-index={index}
                className={`caption-word ${
                  tok.conf < 0.7 ? 'low-confidence' : ''
                } ${
                  tok.isNew ? 'word-appearing' : ''
                } ${
                  loadingWordIndex === index ? 'loading' : ''
                } ${
                  selectedTokens.has(index) || (popover?.selectedIndices?.includes(index)) ? 'selected' : ''
                } ${
                  currentWordIndex === index ? 'focused' : ''
                }`}
                onClick={(e) => {
                  console.log('🖱️ Word clicked:', tok.text.trim());
                  !(loadingWordIndex >= 0) && handleTokenClick(e, tok, index);
                }}
                onTouchStart={(e) => {
                  if (isMobile) {
                    setTouchStartTime(Date.now());
                    setLongPressTriggered(false);

                    // Clear any existing timer
                    if (longPressTimer) {
                      clearTimeout(longPressTimer);
                    }

                    // Set up long press detection (600ms)
                    const timer = setTimeout(() => {
                      setLongPressTriggered(true);
                      // Trigger selection mode on long press
                      setSelectedTokens(prev => {
                        const newSet = new Set(prev);
                        if (newSet.has(index)) {
                          newSet.delete(index);
                        } else {
                          newSet.add(index);
                        }
                        return newSet;
                      });
                      setIsSelecting(true);

                      // Provide haptic feedback if available
                      if (navigator.vibrate) {
                        navigator.vibrate(50);
                      }

                      // Visual feedback
                      e.target.style.transform = 'scale(1.05)';
                      setTimeout(() => {
                        e.target.style.transform = '';
                      }, 150);
                    }, 600);

                    setLongPressTimer(timer);
                  }
                }}
                onTouchEnd={(e) => {
                  if (isMobile) {
                    // Clear the long press timer
                    if (longPressTimer) {
                      clearTimeout(longPressTimer);
                      setLongPressTimer(null);
                    }

                    const touchDuration = Date.now() - touchStartTime;

                    // If long press was triggered, don't handle as normal tap
                    if (longPressTriggered) {
                      setLongPressTriggered(false);
                      return;
                    }

                    // Handle normal tap (short duration)
                    if (touchDuration < 500 && loadingWordIndex < 0) {
                      e.preventDefault();
                      if (isSelecting) {
                        // In selection mode, add/remove from selection
                        setSelectedTokens(prev => {
                          const newSet = new Set(prev);
                          if (newSet.has(index)) {
                            newSet.delete(index);
                          } else {
                            newSet.add(index);
                          }
                          return newSet;
                        });
                      } else {
                        // Normal tap behavior
                        handleTokenClick(e, tok, index);
                      }
                    }
                  }
                }}
                onTouchCancel={(e) => {
                  // Clean up on touch cancel
                  if (isMobile && longPressTimer) {
                    clearTimeout(longPressTimer);
                    setLongPressTimer(null);
                    setLongPressTriggered(false);
                  }
                }}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ' ') && loadingWordIndex < 0) {
                    e.preventDefault();
                    handleTokenClick(e, tok, index);
                  }
                  if (e.key === 'Escape') {
                    clearSelection();
                  }
                }}
                tabIndex={loadingWordIndex >= 0 ? -1 : 0}
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
              <div className={`multi-select-controls ${isMobile ? 'mobile-controls' : ''}`}>
                {isMobile && (
                  <div className="mobile-selection-indicator">
                    📝 {selectedTokens.size} word{selectedTokens.size > 1 ? 's' : ''} selected
                  </div>
                )}
                <button
                  className="define-selection-btn"
                  onClick={handleMultiWordDefinition}
                  title={`Define selected ${selectedTokens.size} words`}
                >
                  {isMobile ? '📖 Define' : `Define Selection (${selectedTokens.size} words)`}
                </button>
                <button
                  className="clear-selection-btn"
                  onClick={clearSelection}
                  title="Clear selection"
                >
                  {isMobile ? '✖️' : 'Clear'}
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
              {isMobile ? (
                <>
                  📱 Long press a word to start selecting multiple words<br/>
                  🔍 Tap words to add them to your selection, then tap "Define Selection"<br/>
                </>
              ) : (
                <>🔍 Hold Ctrl/Cmd while clicking words to select multiple words like "artificial intelligence"<br/></>
              )}
              🤖 All definitions are generated by AI for contextual accuracy
            </div>
            <div style={{ marginTop: '1rem' }}>
              <button
                className="test-glossary-btn"
                onClick={() => {
                  // Add some test words for AI definition testing
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
                🤖 Test AI Definitions (Click words for AI-generated explanations)
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Clear Modal */}
      {showClearModal && (
        <div className="modal-overlay" onClick={() => setShowClearModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Clear Subtitles</h3>
              <button
                className="modal-close"
                onClick={() => setShowClearModal(false)}
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p>Choose how you want to clear the subtitles:</p>
              <div className="clear-options">
                <button
                  className="clear-option-btn clear-display-btn"
                  onClick={clearDisplay}
                >
                  <div className="option-icon">🧹</div>
                  <div className="option-content">
                    <h4>Clear Display Only</h4>
                    <p>Hides subtitles from view, but keeps them in session for download</p>
                  </div>
                </button>
                <button
                  className="clear-option-btn clear-everything-btn"
                  onClick={clearEverything}
                >
                  <div className="option-icon">🗑️</div>
                  <div className="option-content">
                    <h4>Clear Everything</h4>
                    <p>Permanently deletes all subtitles and resets the session</p>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Debug indicator removed for production */}

      {popover && (
        <div
          ref={setPopoverRef}
          className={`definition-popover ${popover.isError ? 'error' : ''} ${popover.position || 'below'}`}
          style={{
            left: popover.x,
            top: popover.y,
            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
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
            <div className="definition-info">
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
            </div>
            {!popover.isError && (
              <button
                className={`pin-button ${popover.isPinned ? 'pinned' : ''}`}
                onClick={handlePinToggle}
                title={popover.isPinned ? 'Unpin this definition' : 'Pin this definition'}
                aria-label={popover.isPinned ? 'Unpin definition' : 'Pin definition'}
              >
                {popover.isPinned ? '📌' : '📍'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
