import React, { useState, useEffect, useRef } from 'react'
import { useLanguage } from '../context/LanguageContext.jsx'
import { IconMic } from './Icons.jsx'

export default function VoiceAssistant({ isOpen, onClose, session }) {
  const { t, lang, setLang } = useLanguage()

  // States: 'IDLE' | 'LISTENING' | 'THINKING' | 'SPEAKING' | 'ERROR'
  const [status, setStatus] = useState('IDLE')
  const [transcript, setTranscript] = useState('')
  const [answer, setAnswer] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [history, setHistory] = useState([])
  const [copied, setCopied] = useState(false)

  // Web Speech API support detection
  const [isSpeechSupported] = useState(() => {
    if (typeof window === 'undefined') return false
    return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
  })

  const recognitionRef = useRef(null)
  const inputRef = useRef(null)

  // Cleanup speech synthesis and recognition when modal closes or unmounts
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort()
        } catch {
          // ignore
        }
      }
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel()
      }
    }
  }, [isOpen])
  // Wake up Render backend when Voice Assistant opens
useEffect(() => {
  if (isOpen) {
    fetch('/api/health').catch(() => {});
  }
}, [isOpen])
  // Stop TTS when closing
  const handleClose = () => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel()
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort()
      } catch {
        // ignore
      }
    }
    setIsSpeaking(false)
    setStatus('IDLE')
    onClose()
  }

  // Speak text aloud using browser SpeechSynthesis
  const speakAloud = (textToSpeak, targetLang = lang) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return

    window.speechSynthesis.cancel()

    // Clean markdown characters (*, #, _, `) for cleaner TTS pronunciation
    const cleanText = textToSpeak
      .replace(/[*#_`>-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    if (!cleanText) return

    const utterance = new SpeechSynthesisUtterance(cleanText)

    // Detect Hindi text or language setting
    const hasHindiChar = /[\u0900-\u097F]/.test(cleanText)
    utterance.lang = targetLang === 'hi' || hasHindiChar ? 'hi-IN' : 'en-IN'
    utterance.rate = 0.95 // Slightly calmer rate for clear agricultural guidance
    utterance.pitch = 1.0

    utterance.onstart = () => {
      setIsSpeaking(true)
      setStatus('SPEAKING')
    }

    utterance.onend = () => {
      setIsSpeaking(false)
      setStatus('IDLE')
    }

    utterance.onerror = (e) => {
      console.warn('[Voice Assistant] TTS Error:', e)
      setIsSpeaking(false)
      setStatus('IDLE')
    }

    window.speechSynthesis.speak(utterance)
  }

  // Stop TTS immediately
  const stopSpeaking = () => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel()
    }
    setIsSpeaking(false)
    if (status === 'SPEAKING') {
      setStatus('IDLE')
    }
  }

  // Start speech recognition
  const startListening = () => {
    setErrorMsg('')
    stopSpeaking()

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      setIsSpeechSupported(false)
      return
    }

    try {
      const recognition = new SpeechRecognition()
      recognitionRef.current = recognition
      recognition.continuous = false
      recognition.interimResults = true
      recognition.lang = lang === 'hi' ? 'hi-IN' : 'en-IN'

      recognition.onstart = () => {
        setStatus('LISTENING')
      }

      recognition.onresult = (event) => {
        const text = Array.from(event.results)
          .map((r) => r[0].transcript)
          .join('')
        setTranscript(text)

        // If the speech engine marked final result
        if (event.results[0] && event.results[0].isFinal) {
          recognition.stop()
          handleQuery(text)
        }
      }

      recognition.onerror = (event) => {
        console.warn('[Voice Assistant] Speech Recognition Error:', event.error)
        if (event.error === 'not-allowed') {
          setErrorMsg(t.voiceAssistant?.micPermissionDenied || 'Microphone access was denied. Please allow microphone permissions or type your question.')
        } else if (event.error !== 'no-speech') {
          setErrorMsg(`Voice recognition notice: ${event.error}`)
        }
        setStatus('IDLE')
      }

      recognition.onend = () => {
        if (status === 'LISTENING') {
          // If transcript has text, submit it
          if (transcript.trim()) {
            handleQuery(transcript)
          } else {
            setStatus('IDLE')
          }
        }
      }

      recognition.start()
    } catch (err) {
      console.error('[Voice Assistant] Recognition start failed:', err)
      setErrorMsg('Could not initialize microphone recognition.')
      setStatus('IDLE')
    }
  }

  // Stop listening
  const stopListening = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop()
      } catch {
        // ignore
      }
    }
    setStatus('IDLE')
  }


  // Send question to backend
  const handleQuery = async (queryText) => {
    const text = (queryText || transcript).trim()
    if (!text) return

    stopSpeaking()
    setStatus('THINKING')
    setErrorMsg('')

    try {
      const res = await fetch('/api/voice-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          language: lang,
          context: {
            role: session?.role || 'user',
            name: session?.name || 'Guest User',
            supportedCrops: ['wheat', 'rice', 'potato', 'onion', 'tomato', 'fruits'],
          },
        }),
      })

      const data = await res.json()

      if (!res.ok || !data.success) {
        const errorText = data.error || t.voiceAssistant?.errorNetwork || 'Failed to get answer from AI.'
        setErrorMsg(errorText)
        setStatus('ERROR')
        return
      }

      const aiAnswer = data.answer
      setAnswer(aiAnswer)
      setHistory((prev) => [{ question: text, answer: aiAnswer, timestamp: new Date() }, ...prev.slice(0, 4)])
      setTranscript('')

      // Speak answer aloud automatically
      speakAloud(aiAnswer, lang)
    } catch (err) {
      console.error('[Voice Assistant] Fetch failed:', err)
      setErrorMsg(t.voiceAssistant?.errorNetwork || 'Unable to connect to voice assistant server.')
      setStatus('ERROR')
    }
  }

  // Handle Enter key in input
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleQuery(transcript)
    }
  }

  // Copy answer to clipboard
  const handleCopy = () => {
    if (!answer) return
    navigator.clipboard.writeText(answer).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  if (!isOpen) return null

  const va = t.voiceAssistant || {}

  return (
    <div className="voice-modal-backdrop" onClick={handleClose}>
      <div
        className="voice-modal-card"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="voice-card-header">
          <div className="voice-title-group">
            <div className="voice-avatar-icon">
              <span className="va-pulse-dot" />
              🤖
            </div>
            <div>
              <h3 className="voice-card-title">{va.title || 'AI Voice Assistant'}</h3>
              <p className="voice-card-sub">{va.subtitle || 'Ask questions in English or Hindi'}</p>
            </div>
          </div>

          <div className="voice-header-actions">
            <span className="voice-groq-pill">{va.badge || 'Powered by Groq'}</span>
            <div className="voice-lang-switcher">
              <button
                type="button"
                className={`voice-lang-btn ${lang === 'en' ? 'active' : ''}`}
                onClick={() => setLang('en')}
              >
                EN
              </button>
              <button
                type="button"
                className={`voice-lang-btn ${lang === 'hi' ? 'active' : ''}`}
                onClick={() => setLang('hi')}
              >
                हिं
              </button>
            </div>
            <button
              className="voice-close-btn"
              onClick={handleClose}
              type="button"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Speech Recognition Warning (if unsupported) */}
        {!isSpeechSupported && (
          <div className="voice-banner-notice">
            <span className="va-notice-icon">ℹ️</span>
            <span>{va.speechUnsupported || 'Voice recognition not supported in this browser. You can type your question below.'}</span>
          </div>
        )}

        {/* Error Alert */}
        {errorMsg && (
          <div className="voice-banner-error">
            <span className="va-err-icon">⚠️</span>
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Central Audio / Visual Indicator Area */}
        <div className="voice-status-stage">
          {status === 'LISTENING' ? (
            <div className="voice-pulse-ring active">
              <button
                type="button"
                className="voice-big-mic listening"
                onClick={stopListening}
                title="Click to stop listening"
              >
                <IconMic style={{ width: 34, height: 34 }} />
              </button>
              <span className="voice-stage-label text-listening">
                {va.listening || 'Listening... Speak now'}
              </span>
              <div className="voice-wave-bars">
                <span className="bar bar-1" />
                <span className="bar bar-2" />
                <span className="bar bar-3" />
                <span className="bar bar-4" />
                <span className="bar bar-5" />
              </div>
            </div>
          ) : status === 'THINKING' ? (
            <div className="voice-pulse-ring thinking">
              <div className="voice-spinner-bot">
                ✨
              </div>
              <span className="voice-stage-label text-thinking">
                {va.thinking || 'AI is analyzing your question...'}
              </span>
            </div>
          ) : status === 'SPEAKING' ? (
            <div className="voice-pulse-ring speaking">
              <div className="voice-sound-anim">
                <span className="voice-speaker-icon">🔊</span>
                <span className="va-sound-wave" />
              </div>
              <span className="voice-stage-label text-speaking">
                {va.speaking || 'Speaking response aloud...'}
              </span>
              <div className="voice-speech-controls">
                <button
                  type="button"
                  className="btn btn-sm btn-outline-danger"
                  onClick={stopSpeaking}
                >
                  ⏹ {va.stopVoice || 'Stop Speaking'}
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-outline"
                  onClick={() => speakAloud(answer, lang)}
                >
                  🔁 {va.replayVoice || 'Listen Again'}
                </button>
              </div>
            </div>
          ) : (
            <div className="voice-pulse-ring idle">
              <button
                type="button"
                className="voice-big-mic"
                onClick={startListening}
                disabled={!isSpeechSupported}
                title={isSpeechSupported ? 'Click to speak' : 'Microphone unsupported'}
              >
                <IconMic style={{ width: 30, height: 30 }} />
              </button>
              <span className="voice-stage-label text-idle">
                {isSpeechSupported ? (va.tapToSpeak || 'Tap to Speak') : 'Type your question below'}
              </span>
            </div>
          )}
        </div>

        {/* Input Bar */}
        <div className="voice-input-wrapper">
          <input
            ref={inputRef}
            type="text"
            className="voice-text-input"
            placeholder={va.typePlaceholder || 'Ask anything about crops, pricing, quality, pickup...'}
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={status === 'THINKING'}
          />
          {transcript && (
            <button
              type="button"
              className="voice-clear-input-btn"
              onClick={() => setTranscript('')}
              title={va.clear || 'Clear'}
            >
              ✕
            </button>
          )}
          <button
            type="button"
            className="voice-ask-submit-btn"
            onClick={() => handleQuery(transcript)}
            disabled={!transcript.trim() || status === 'THINKING'}
          >
            {va.askBtn || 'Ask AI'}
          </button>
        </div>

        {/* Quick Suggestion Chips */}
        {va.quickPrompts && va.quickPrompts.length > 0 && (
          <div className="voice-quick-chips">
            <span className="voice-chips-label">{va.quickSuggestionsTitle || 'Quick Questions:'}</span>
            <div className="voice-chips-list">
              {va.quickPrompts.map((prompt, idx) => (
                <button
                  key={idx}
                  type="button"
                  className="voice-prompt-chip"
                  onClick={() => {
                    setTranscript(prompt)
                    handleQuery(prompt)
                  }}
                >
                  💡 {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* AI Answer Box */}
        {answer && (
          <div className="voice-answer-container">
            <div className="voice-answer-header">
              <span className="voice-answer-tag">🤖 Groq AI Response:</span>
              <div className="voice-answer-actions">
                <button
                  type="button"
                  className="voice-mini-btn"
                  onClick={handleCopy}
                  title="Copy response"
                >
                  {copied ? (va.copied || 'Copied!') : (va.copyAnswer || '📋 Copy')}
                </button>
                {isSpeaking ? (
                  <button
                    type="button"
                    className="voice-mini-btn stop"
                    onClick={stopSpeaking}
                    title="Stop speaking"
                  >
                    ⏹ {va.stopVoice || 'Stop Voice'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="voice-mini-btn play"
                    onClick={() => speakAloud(answer, lang)}
                    title="Read aloud"
                  >
                    🔊 {va.replayVoice || 'Read Aloud'}
                  </button>
                )}
              </div>
            </div>
            <div className="voice-answer-text">
              {answer}
            </div>
            <div className="voice-mandi-disclaimer">
              {va.noticeMandi || 'Note: Live mandi ticker feeds are not integrated in this MVP. Advice is based on platform benchmark algorithms.'}
            </div>
          </div>
        )}

        {/* Recent Session History (if > 1 answer) */}
        {history.length > 1 && (
          <div className="voice-history-section">
            <h4 className="voice-history-title">{va.historyTitle || 'Recent Questions'}</h4>
            <div className="voice-history-items">
              {history.slice(1).map((item, i) => (
                <div key={i} className="voice-history-item">
                  <div className="vh-q">Q: {item.question}</div>
                  <div className="vh-a">{item.answer.slice(0, 140)}...</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
