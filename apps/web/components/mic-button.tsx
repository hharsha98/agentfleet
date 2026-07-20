"use client";

// Dictation button — Web Speech API, browser-native, no server round trip.
// Renders nothing when the browser doesn't support it (Firefox, most of
// desktop Linux).
//
// Support is read via useSyncExternalStore, not a render-time `typeof
// window` check or a `useEffect` + `setState`: the server snapshot always
// returns false (matching SSR's window-less render), so hydration never
// mismatches, and React re-syncs to the real client value right after
// hydration — no extra render-then-setState pass, and no lint complaint
// about setState-in-effect for what's really an external-value read.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

function noopSubscribe() {
  return () => {};
}

function getClientSpeechSupport() {
  return !!(window.SpeechRecognition ?? window.webkitSpeechRecognition);
}

function getServerSpeechSupport() {
  return false;
}

export function MicButton({
  onTranscript,
  className = "",
}: {
  onTranscript: (text: string) => void;
  className?: string;
}) {
  const supported = useSyncExternalStore(
    noopSubscribe,
    getClientSpeechSupport,
    getServerSpeechSupport,
  );
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognition | null>(null);

  // Abort any in-flight recognition if the button unmounts mid-dictation.
  useEffect(() => {
    return () => recRef.current?.abort();
  }, []);

  function start() {
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) return;
    // A fresh instance every time — Safari misbehaves if a stopped
    // recognizer is restarted rather than recreated.
    const rec = new Ctor();
    rec.interimResults = false;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    rec.lang = "en-US";
    rec.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i][0].transcript;
      }
      text = text.trim();
      if (text) onTranscript(text);
    };
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
    };
    rec.onerror = () => {
      // Covers not-allowed / no-speech / network — fail silent, just reset
      // to idle so the button is immediately usable again.
      setListening(false);
      recRef.current = null;
    };
    recRef.current = rec;
    setListening(true);
    rec.start();
  }

  function stop() {
    recRef.current?.stop();
  }

  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={listening ? stop : start}
      aria-label={listening ? "Stop dictation" : "Dictate"}
      aria-pressed={listening}
      title={listening ? "Stop dictation" : "Dictate"}
      className={
        listening
          ? `flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-hue-red/40 px-2.5 text-hue-red transition-colors duration-200 ${className}`
          : `flex shrink-0 cursor-pointer items-center justify-center rounded-md border border-hairline px-2.5 text-muted transition-colors duration-200 hover:text-foreground ${className}`
      }
    >
      {listening && (
        <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-hue-red" />
      )}
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4"
        aria-hidden="true"
      >
        <rect x="9" y="3.5" width="6" height="11" rx="3" />
        <path d="M6 11.5a6 6 0 0 0 12 0M12 17.5V21M9 21h6" />
      </svg>
    </button>
  );
}
