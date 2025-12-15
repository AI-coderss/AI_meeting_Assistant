/* eslint-disable no-loop-func */
import React, {
  useState,
  useRef,
  useLayoutEffect,
  useEffect,
  useCallback,
} from "react";
import ReactMarkdown from "react-markdown";
import ChatInputWidget from "./ChatInputWidget";
import "../styles/ChatBot.css";
import useCardStore from "./store/useCardStore";
import useUiStore from "./store/useUiStore";

/**
 * D-ID agent is injected on demand when the user presses "Open Avatar".
 * We no longer re-parent or wrap it in a draggable container.
 */
const DID_AGENT_SRC = "https://agent.d-id.com/v2/index.js";
const DID_SCRIPT_ID = "did-agent-loader-v2";

// 👉 use your real key/id or env vars.
const DID_CLIENT_KEY =
  "Z29vZ2xlLW9hdXRoMnwxMTI1MzgwMDI5NzAxNDIxMTMxNDI6TG5FLWVDS1IyaE9VMEcyS2FUVnh0";
const DID_AGENT_ID = "v2_agt_uxCkm0YX";

// ---- Product URLs for launching -------------------------------------------------
const urls = {
  doctor: "https://ai-doctor-assistant-app-dev.onrender.com",
  transcript: "https://medicaltranscription-version2-tests.onrender.com",
  analyst: "/videos/unddev.mp4",
  report: "https://medical-report-editor-ai-powered-dsah.onrender.com",
  ivf: "https://ivf-virtual-training-assistant-dsah.onrender.com",
  patient: "https://patient-ai-assistant-mulltimodal-app.onrender.com",
  meeting: "https://ai-meeting-assistant-frontend.onrender.com/authpage",
  survey:
    "https://forms.visme.co/formsPlayer/zzdk184y-ai-applications-usage-at-dsah",
};

// Quick map from friendly names → card ids used in your <AppCard> list
const cardNameToId = {
  "doctor assistant": 1,
  doctor: 1,
  "ai doctor assistant": 1,
  transcription: 2,
  scribe: 2,
  "medical transcription": 2,
  analyst: 3,
  "data analyst": 3,
  "report enhancer": 4,
  "medical report enhancement": 4,
  report: 4,
  ivf: 5,
  "ivf assistant": 5,
  patient: 6,
  "patient assistant": 6,
};

// ---- Chat content ---------------------------------------------------------------
const initialQuestions = [
  "What can the AI Doctor Assistant do?",
  "How does the Medical Transcription App work?",
  "Can the Data Analyst show me hospital insights?",
  "How can I enhance a medical report using AI?",
  "Tell me more about the IVF Virtual Training Assistant.",
  "Can the Patient Assistant help with navigation?",
  "How to use the AI Doctor Assistant?",
  "How does the IVF Virtual Training Assistant work?",
];

const ChatBot = () => {
  const [open, setOpen] = useState(false);
  const [accordionOpen, setAccordionOpen] = useState(false);
  const [messages, setMessages] = useState([
    { type: "bot", text: "Hi! Ask me anything about these AI tools." },
  ]);
  const [visibleQuestions, setVisibleQuestions] = useState(initialQuestions);
  const [loading, setLoading] = useState(false);
  const [inputText, setInputText] = useState("");
  const chatBodyRef = useRef(null);
  const inputRef = useRef(null); // ref for ChatInputWidget (forwardRef)
  const { setActiveCardId } = useCardStore();

  // UI Store (for Avatar toggle)
  const { hideAvatarBtn, chooseAvatar } = useUiStore();

  // Session id for your backend chat
  const [sessionId] = useState(() => {
    const id = localStorage.getItem("chatbot-session") || crypto.randomUUID();
    localStorage.setItem("chatbot-session", id);
    return id;
  });

  // Inject D-ID script on demand
  const injectDidScript = () => {
    if (typeof document === "undefined") return;
    if (document.getElementById(DID_SCRIPT_ID)) return;

    const s = document.createElement("script");
    s.type = "module";
    s.async = true;
    s.src = DID_AGENT_SRC;
    s.id = DID_SCRIPT_ID;

    // data-* attributes to configure the agent
    s.dataset.mode = "fabio";
    s.dataset.clientKey = DID_CLIENT_KEY;
    s.dataset.agentId = DID_AGENT_ID;
    s.dataset.name = "did-agent";
    s.dataset.monitor = "true";
    s.dataset.orientation = "horizontal";
    s.dataset.position = "right";

    document.body.appendChild(s);
  };

  const openDid = () => {
    chooseAvatar(); // Hide the other control
    injectDidScript();
  };

  // Keep scroll pinned to bottom while streaming
  useLayoutEffect(() => {
    if (chatBodyRef.current) {
      requestAnimationFrame(() => {
        chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
      });
    }
  }, [messages, loading]);

  // --- Helpers: navigation + launch + selection ---------------------------------
  const scrollTo = useCallback((id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const highlightCardByName = useCallback(
    (name) => {
      if (!name) return;
      const key = name.toLowerCase().trim();
      const cardId = cardNameToId[key];
      if (cardId) {
        setActiveCardId(cardId);
        scrollTo("products");
      }
      return cardId;
    },
    [setActiveCardId, scrollTo]
  );

  const launchApp = useCallback((appKey) => {
    const url = urls[appKey];
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  // --- Intent parser: simple local “function calling” from user text -------------
  const tryLocalIntent = useCallback(
    (text) => {
      if (!text || typeof text !== "string") return false;
      const t = text.toLowerCase();

      // Open survey
      if (/\b(open|launch)\b.*\bsurvey\b/.test(t)) {
        launchApp("survey");
        setMessages((prev) => [
          ...prev,
          { type: "bot", text: "Opening the survey in a new tab…" },
        ]);
        return true;
      }

      // Go to a section
      const sectionMatch = t.match(
        /\b(go to|show|navigate to|open)\b.*\b(home|products|tutorial|policy|contact|footer)\b/
      );
      if (sectionMatch) {
        const section = sectionMatch[2];
        const idMap = {
          home: "hero",
          products: "products",
          tutorial: "watch_tutorial",
          policy: "policy",
          contact: "contact",
          footer: "footer",
        };
        const targetId = idMap[section];
        if (targetId) {
          scrollTo(targetId);
          setMessages((prev) => [
            ...prev,
            { type: "bot", text: `Navigated to ${section}.` },
          ]);
          return true;
        }
      }

      // Launch or open app by name
      const appMatch = t.match(
        /\b(launch|open|start)\b.*\b(doctor assistant|ai doctor assistant|doctor|transcription|scribe|medical transcription|analyst|data analyst|report|report enhancer|medical report enhancement|ivf|ivf assistant|patient|patient assistant|meeting|meeting assistant)\b/
      );
      if (appMatch) {
        const verb = appMatch[1];
        const appName = appMatch[2];
        const id = highlightCardByName(appName);

        const appKeyMap = {
          doctor: "doctor",
          "doctor assistant": "doctor",
          "ai doctor assistant": "doctor",
          transcription: "transcript",
          scribe: "transcript",
          "medical transcription": "transcript",
          analyst: "analyst",
          "data analyst": "analyst",
          report: "report",
          "report enhancer": "report",
          "medical report enhancement": "report",
          ivf: "ivf",
          "ivf assistant": "ivf",
          patient: "patient",
          "patient assistant": "patient",
          meeting: "meeting",
          "meeting assistant": "meeting",
        };
        const appKey = appKeyMap[appName];

        if (verb === "launch" && appKey) {
          launchApp(appKey);
          setMessages((prev) => [
            ...prev,
            { type: "bot", text: `Launching ${appName}…` },
          ]);
        } else if (id) {
          setMessages((prev) => [
            ...prev,
            { type: "bot", text: `Highlighted ${appName}.` },
          ]);
        }
        return true;
      }

      return false;
    },
    [highlightCardByName, launchApp, scrollTo]
  );

  // --- Core: send message to your backend (stream) --------------------------------
  const sendToBackend = useCallback(
    async (text) => {
      let botText = "";
      const response = await fetch(
        "https://ai-platform-dsah-backend-chatbot.onrender.com/stream",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, session_id: sessionId }),
        }
      );

      if (!response.ok || !response.body) throw new Error("Streaming failed");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      setMessages((prev) => [...prev, { type: "bot", text: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        botText += decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { type: "bot", text: botText };
          return updated;
        });
      }

      // Optional post-classification to auto-highlight card
      try {
        const classifyRes = await fetch(
          "https://ai-platform-dsah-backend-chatbot.onrender.com/classify",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question: text, ai_response: botText }),
          }
        );

        if (classifyRes.ok) {
          const data = await classifyRes.json();
          if (data.card_id) {
            setActiveCardId(data.card_id);
            scrollTo("products");
          }
        }
      } catch {
        // non-critical
      }
    },
    [scrollTo, sessionId, setActiveCardId]
  );

  // --- Public entry point used by UI & global API ---------------------------------
  const handleSendMessage = useCallback(
    async ({ text }) => {
      if (!text?.trim()) return;

      // Ensure chat is visible when programmatically sending
      setOpen(true);

      // Local intent (navigate/launch) first
      const handledLocally = tryLocalIntent(text);
      if (handledLocally) {
        setMessages((prev) => [
          ...prev,
          { type: "bot", text: "Happy to help. What else can I do?" },
        ]);
        return;
      }

      // Otherwise, go to backend
      const userMsg = { type: "user", text };
      setMessages((prev) => [...prev, userMsg]);
      setAccordionOpen(false);
      setLoading(true);

      try {
        await sendToBackend(text);
      } catch (err) {
        console.error(err);
        setMessages((prev) => [
          ...prev,
          { type: "bot", text: "⚠️ Error streaming response." },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [sendToBackend, tryLocalIntent]
  );

  const handleQuestionClick = (question) => {
    handleSendMessage({ text: question });
    setVisibleQuestions((prev) => prev.filter((q) => q !== question));
    setAccordionOpen(false);
  };

  // ---------- Programmatic control & event bridges --------------------------------
  useEffect(() => {
    // Global API
    window.ChatBot = {
      open: () => {
        setOpen(true);
        setTimeout(() => inputRef.current?.focusInput?.(), 60);
      },
      close: () => setOpen(false),
      toggle: () => setOpen((v) => !v),
      isOpen: () => open,
      setText: (text) => {
        setOpen(true);
        setInputText(text || "");
        setTimeout(() => inputRef.current?.focusInput?.(), 60);
      },
      focusInput: () => inputRef.current?.focusInput?.(),
      clearInput: () => inputRef.current?.clear?.(),
      sendMessage: (text) => {
        setOpen(true);
        if (text && text.trim()) {
          handleSendMessage({ text });
          setInputText("");
          inputRef.current?.clear?.();
        } else if ((inputText || "").trim()) {
          // send current input
          handleSendMessage({ text: inputText });
          setInputText("");
          inputRef.current?.clear?.();
        }
      },
    };

    // DOM event fallbacks
    const onOpen = () => window.ChatBot.open();
    const onClose = () => window.ChatBot.close();
    const onToggle = () => window.ChatBot.toggle();
    const onSetText = (e) => window.ChatBot.setText(e?.detail?.text || "");
    const onSend = (e) => window.ChatBot.sendMessage(e?.detail?.text || "");
    const onNav = (e) =>
      e?.detail?.targetId && window.ChatBot.navigate?.(e.detail.targetId);
    const onLaunch = (e) => e?.detail?.app && window.ChatBot.launch?.(e.detail.app);

    window.addEventListener("chatbot:open", onOpen);
    window.addEventListener("chatbot:close", onClose);
    window.addEventListener("chatbot:toggle", onToggle);
    window.addEventListener("chatbot:setText", onSetText);
    window.addEventListener("chatbot:send", onSend);
    window.addEventListener("chatbot:navigate", onNav);
    window.addEventListener("chatbot:launch", onLaunch);

    return () => {
      window.removeEventListener("chatbot:open", onOpen);
      window.removeEventListener("chatbot:close", onClose);
      window.removeEventListener("chatbot:toggle", onToggle);
      window.removeEventListener("chatbot:setText", onSetText);
      window.removeEventListener("chatbot:send", onSend);
      window.removeEventListener("chatbot:navigate", onNav);
      window.removeEventListener("chatbot:launch", onLaunch);
      try {
        delete window.ChatBot;
      } catch {}
    };
  }, [open, inputText, handleSendMessage]);

  return (
    <>
      {/* Floating Chat FAB */}
      <button className="chat-toggle" onClick={() => setOpen(!open)}>
        <img src="/icons/chat.svg" alt="Chat" className="chat-icon" />
      </button>

      {open && window.innerWidth <= 768 && (
        <button className="chat-close-mobile" onClick={() => setOpen(false)}>
          ✖
        </button>
      )}

      {open && (
        <div className="chat-box chatbot-root">
          <div
            className="chat-header"
            style={{ background: "#2563eb", color: "#fff", fontWeight: 600 }}
          >
            AI Assistant
          </div>

          <div className="chat-body" ref={chatBodyRef}>
            {/* In-chat controls row */}
            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                margin: "6px 8px 10px",
                alignItems: "center",
              }}
            >
              {/* Show only if NOT hidden by the other control */}
              {!hideAvatarBtn && (
                <button
                  onClick={openDid}
                  aria-label="Open D-ID Avatar"
                  className="open-avatar-3d"
                  title="Open D-ID Avatar"
                >
                  <span className="open-avatar-icon">🎭</span>
                  <span>Open Avatar</span>
                </button>
              )}
            </div>

            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`chat-msg ${msg.type}`}
                style={{
                  maxWidth: "70%",
                  alignSelf: msg.type === "user" ? "flex-end" : "flex-start",
                  background: msg.type === "user" ? "#2563eb" : "#f1f6fd",
                  color: msg.type === "user" ? "#fff" : "#222",
                  padding: "8px 12px",
                  margin: msg.type === "user" ? "6px" : "0px 15px",
                  borderRadius: "14px",
                  fontSize: "14px",
                  lineHeight: 1.4,
                }}
              >
                {msg.type === "bot" ? (
                  <ReactMarkdown>{msg.text}</ReactMarkdown>
                ) : (
                  msg.text
                )}
              </div>
            ))}

            {loading && (
              <div
                className="chat-msg bot loader"
                style={{ alignSelf: "flex-start" }}
              >
                <span className="dot"></span>
                <span className="dot"></span>
                <span className="dot"></span>
              </div>
            )}
          </div>

          {visibleQuestions.length > 0 && (
            <div className="predefined-questions-container">
              {visibleQuestions.length > 3 ? (
                <>
                  <div
                    className="accordion-header"
                    onClick={() => setAccordionOpen((prev) => !prev)}
                  >
                    <span>Show Suggested Questions</span>
                    <span className={`chevron ${accordionOpen ? "rotate" : ""}`}>
                      ▼
                    </span>
                  </div>
                  <div className={`accordion-body ${accordionOpen ? "open" : ""}`}>
                    <div className="accordion-content">
                      {visibleQuestions.map((q, i) => (
                        <button
                          key={i}
                          className="predefined-q fade-in"
                          style={{ animationDelay: `${i * 0.05}s` }}
                          onClick={() => handleQuestionClick(q)}
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                visibleQuestions.map((q, i) => (
                  <button
                    key={i}
                    className="predefined-q fade-in"
                    style={{ animationDelay: `${i * 0.05}s` }}
                    onClick={() => handleQuestionClick(q)}
                  >
                    {q}
                  </button>
                ))
              )}
            </div>
          )}

          <ChatInputWidget
            ref={inputRef}
            onSendMessage={handleSendMessage}
            inputText={inputText}
            setInputText={setInputText}
          />
        </div>
      )}
    </>
  );
};

export default ChatBot;
