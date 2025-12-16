/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable no-useless-concat */
/* eslint-disable no-unused-vars */
/* eslint-disable no-unused-vars */
/* eslint-disable no-unused-vars */
/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable no-useless-concat */
/* eslint-disable no-unused-vars */
import React, { useState, useRef, useEffect, useContext } from "react";
import { FaMicrophoneAlt, FaMicrophoneSlash } from "react-icons/fa";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { motion, AnimatePresence } from "framer-motion";
import AudioWave from "./AudioWave";
// import Dashboard from "./Dashboard";
import "../styles/VoiceAssistant.css";
import useUiStore from "./store/useUiStore";
import * as THREE from "three";
import { FormContext } from "./context/FormContext";
import MeetingContext from "./context/MeetingContext";
import ChatInputWidget from "./ChatInputWidget";
import { NavigationContext } from "./context/NavigationContext";

/* ---------- WebRTC refs ---------- */
const peerConnectionRef = React.createRef();
const dataChannelRef = React.createRef();
const localStreamRef = React.createRef();

/* ---------- Whitelists / tools (kept intact) ---------- */
const ALLOWED_SECTIONS = new Set([
  "home",
  "products",
  "policy",
  "watch_tutorial",
  "contact",
  "footer",
  "chat",
  "doctor",
  "transcription",
  "analyst",
  "report",
  "ivf",
  "patient",
  "survey",
  "card_console",
  "meeting",
]);
const ALLOWED_CONTROL_IDS = new Set([
  "nav.about",
  "nav.products",
  "nav.policy",
  "nav.watch_tutorial",
  "nav.contact",
  "nav.footer",
  "products.launch:doctor",
  "products.launch:transcription",
  "products.launch:analyst",
  "products.launch:report",
  "products.launch:ivf",
  "products.launch:patient",
  "products.launch:survey",
  "products.launch:meeting",
  "products.help:doctor",
  "products.help:transcription",
  "products.help:analyst",
  "products.help:report",
  "products.help:ivf",
  "products.help:patient",
  "products.help:survey",
  "products.help:meeting",
  "contact.submit",
]);
const TOOL_SCHEMAS = [
  {
    type: "function",
    name: "navigate_to",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        section: { type: "string", enum: Array.from(ALLOWED_SECTIONS) },
      },
      required: ["section"],
    },
  },
  {
    type: "function",
    name: "click_control",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { control_id: { type: "string" } },
      required: ["control_id"],
    },
  },
  {
    type: "function",
    name: "chat_ask",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { text: { type: "string", minLength: 1, maxLength: 500 } },
      required: ["text"],
    },
  },
  {
    type: "function",
    name: "contact_fill",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string" },
        email: { type: "string" },
        recipient: { type: "string" },
        message: { type: "string" },
      },
    },
  },
  {
    type: "function",
    name: "contact_submit",
    parameters: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    type: "function",
    name: "toggle_theme",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        theme: { type: "string", enum: ["light", "dark", "system", "toggle"] },
      },
      required: ["theme"],
    },
  },
  {
    type: "function",
    name: "chat_toggle",
    parameters: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    type: "function",
    name: "chat_close",
    parameters: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    type: "function",
    name: "set_chat_visible",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { visible: { type: "boolean" } },
      required: ["visible"],
    },
  },
  {
    type: "function",
    name: "tutorial_play",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: {
          type: "string",
          enum: ["doctorai", "transcription", "medreport", "ivf", "meeting"],
        },
        open_modal: { type: "boolean" }, // optional: true = open in lightbox
      },
      required: ["id"],
    },
  },
  {
    type: "function",
    name: "card_play",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: {
          type: "string",
          enum: [
            "ai_doctor",
            "transcription",
            "bi_dashboard",
            "report_enhance",
            "ivf_assistant",
            "meeting_assistant",
            "patient_avatar",
          ],
        },
        autoplay: { type: "boolean" }, // default true
      },
      required: ["id"],
    },
  },
  {
    type: "function",
    name: "assistant_close",
    parameters: { type: "object", additionalProperties: false, properties: {} },
  },
];

/* =====================================================================================
   ReactiveOrb — keep your design; only enforce circle, lock canvas size, and
   make rotation speed react to audio level.
===================================================================================== */
const ReactiveOrb = ({ stream, size = 200, speed = 2.0 }) => {
  const hostRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);

  const orbRef = useRef(null);
  const orbMatRef = useRef(null);
  const haloRef = useRef(null);
  const rafRef = useRef(0);

  // audio analysis
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const freqRef = useRef(null);

  // hover state
  const hoverRef = useRef(0);
  const hotAngleRef = useRef(0);
  const tiltTargetRef = useRef({ x: 0, y: 0 });

  // ---- GLSL: Simplex noise (Ashima) + fbm ----
  const simplex = `
  vec3 mod289(vec3 x){return x - floor(x * (1.0 / 289.0)) * 289.0;}
  vec4 mod289(vec4 x){return x - floor(x * (1.0 / 289.0)) * 289.0;}
  vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
  float snoise(vec3 v){
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute( permute( permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 1.0/7.0; vec3  ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_ );
    vec4 x = x_ *ns.x + ns.yyyy;
    vec4 y = y_ *ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4( x.xy, y.xy ); vec4 b1 = vec4( x.zw, y.zw );
    vec4 s0 = floor(b0)*2.0 + 1.0; vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;
    vec3 p0 = vec3(a0.xy,h.x); vec3 p1 = vec3(a0.zw,h.y);
    vec3 p2 = vec3(a1.xy,h.z); vec3 p3 = vec3(a1.zw,h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1),
                             dot(x2,x2), dot(x3,x3)), 0.0);
    m = m*m;
    return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1),
                                   dot(p2,x2), dot(p3,x3) ) );
  }
  float fbm(vec3 p){
    float f=0.0; float a=0.5;
    for(int i=0;i<5;i++){ f += a * snoise(p); p *= 2.02; a *= 0.56; }
    return f;
  }`;

  const vtx = `
  uniform float u_time;
  uniform float u_audio;
  uniform float u_hover;
  uniform float u_dispBase;
  uniform float u_dispAudio;
  uniform float u_dispHover;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec3 vViewDir;
  varying float vNoise;
  ${simplex}
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec3 P = normal * 2.0 + vec3(u_time*0.22, u_time*0.18, u_time*0.16);
    float n = fbm(P);
    vNoise = n;
    float disp = (u_dispBase + u_dispAudio * u_audio + u_dispHover * u_hover) * n;
    vec3 displaced = position + normal * disp;
    vec4 wp = modelMatrix * vec4(displaced, 1.0);
    vWorldPos = wp.xyz;
    vViewDir = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

  const frg = `
  precision highp float;
  uniform float u_time;
  uniform float u_audio;
  uniform float u_hover;
  uniform vec2  u_res;
  uniform vec2  u_hotDir;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec3 vViewDir;
  varying float vNoise;
  const vec3 b_core1 = vec3(0.03, 0.06, 0.13);
  const vec3 b_core2 = vec3(0.05, 0.15, 0.35);
  const vec3 b_glow1 = vec3(0.00, 0.72, 1.00);
  const vec3 b_glow2 = vec3(0.42, 0.90, 1.00);
  const vec3 w_core1 = vec3(0.10, 0.02, 0.00);
  const vec3 w_core2 = vec3(0.72, 0.22, 0.03);
  const vec3 w_glow1 = vec3(1.00, 0.45, 0.05);
  const vec3 w_glow2 = vec3(1.00, 0.80, 0.30);
  float fresnel(vec3 n, vec3 v, float p){
    return pow(1.0 - max(dot(normalize(n), normalize(v)), 0.0), p);
  }
  void main() {
    float bands = sin(9.0 * vNoise + u_time*1.6);
    float plasma = smoothstep(-0.9, 0.9, bands);
    float warm = clamp(0.65*u_hover + 0.5*u_audio, 0.0, 1.0);
    vec3 coreBlue = mix(b_core1, b_core2, plasma);
    vec3 coreWarm = mix(w_core1, w_core2, plasma);
    vec3 baseCol  = mix(coreBlue, coreWarm, warm);
    float fr = fresnel(vNormal, vViewDir, 2.4 + 3.3*u_audio);
    vec3 rimBlue = mix(b_glow1, b_glow2, 0.5 + 0.5*sin(u_time*1.5));
    vec3 rimWarm = mix(w_glow1, w_glow2, 0.5 + 0.5*sin(u_time*1.8));
    vec3 rimCol  = mix(rimBlue, rimWarm, warm);
    vec3 col = baseCol + fr * rimCol * (1.1 + 1.7*u_audio);
    float spark = smoothstep(0.70, 1.0, fract(vNoise*9.0 + u_time*0.9));
    col += spark * 0.10 * mix(b_glow2, w_glow2, warm);
    vec2 nv = normalize(vNormal.xy);
    float dirMatch = max(0.0, dot(nv, normalize(u_hotDir)));
    float rimness = smoothstep(0.25, 0.88, fresnel(vNormal, vViewDir, 2.2));
    float hotspot = pow(dirMatch, 12.0) * rimness * (0.35 + 1.2*u_hover);
    col += hotspot * mix(b_glow2, w_glow1, warm) * 2.2;
    gl_FragColor = vec4(col, 1.0);
  }`;

  const haloFrg = `
  precision highp float;
  uniform float u_time;
  uniform float u_audio;
  uniform vec3  u_tint;
  varying vec3 vNormal; varying vec3 vViewDir;
  float fresnel(vec3 n, vec3 v, float p){
    return pow(1.0 - max(dot(normalize(n), normalize(v)), 0.0), p);
  }
  void main(){
    float fr = fresnel(vNormal, vViewDir, 1.6 + 3.0*u_audio);
    float a  = smoothstep(0.0, 1.0, fr);
    vec3 c = u_tint * (0.9 + 1.3*u_audio);
    gl_FragColor = vec4(c, a*0.55);
  }`;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 50);
    camera.position.set(0, 0, 3.0);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      premultipliedAlpha: true,
    });
    renderer.setClearAlpha(0);
    host.appendChild(renderer.domElement);

    // 🔒 perfect circle mask on both wrapper and canvas
    host.style.borderRadius = "50%";
    host.style.overflow = "hidden";
    renderer.domElement.style.borderRadius = "50%";

    const geo = new THREE.SphereGeometry(0.92, 196, 196);
    const orbMat = new THREE.ShaderMaterial({
      uniforms: {
        u_time: { value: 0 },
        u_audio: { value: 0 },
        u_hover: { value: 0 },
        u_res: { value: new THREE.Vector2(1, 1) },
        u_hotDir: { value: new THREE.Vector2(1, 0) },
        u_dispBase: { value: 0.1 },
        u_dispAudio: { value: 0.22 },
        u_dispHover: { value: 0.16 },
      },
      vertexShader: vtx,
      fragmentShader: frg,
      transparent: true,
    });
    const orb = new THREE.Mesh(geo, orbMat);
    scene.add(orb);

    const haloGeo = new THREE.SphereGeometry(1.08, 160, 160);
    const haloMat = new THREE.ShaderMaterial({
      uniforms: {
        u_time: { value: 0 },
        u_audio: { value: 0 },
        u_tint: { value: new THREE.Color(0x00b7ff) },
      },
      vertexShader: `
        varying vec3 vNormal; varying vec3 vViewDir;
        void main(){
          vNormal = normalize(normalMatrix * normal);
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vViewDir = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: haloFrg,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    scene.add(halo);

    scene.add(new THREE.AmbientLight(0x2244ff, 0.08));

    // 🔒 lock canvas size — no ResizeObserver, no layout-driven changes
    const d = size;
    // AFTER: lock both drawing buffer AND CSS box size
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(d, d, true); // ✅ true = also sets canvas.style width/height
    const cvs = renderer.domElement;
    cvs.style.width = `${d}px`;
    cvs.style.height = `${d}px`;
    cvs.style.minWidth = `${d}px`;
    cvs.style.minHeight = `${d}px`;
    cvs.style.maxWidth = `${d}px`;
    cvs.style.maxHeight = `${d}px`;
    cvs.style.flex = "0 0 auto";
    cvs.style.display = "block"; // avoid inline-canvas baseline quirks

    camera.aspect = 1;
    camera.updateProjectionMatrix();
    orbMat.uniforms.u_res.value.set(d, d);

    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;
    orbRef.current = orb;
    orbMatRef.current = orbMat;
    haloRef.current = halo;

    // hover/tilt
    const onEnter = () => (hoverRef.current = 1);
    const onLeave = () => {
      hoverRef.current = 0;
      tiltTargetRef.current = { x: 0, y: 0 };
    };
    const onMove = (e) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      hotAngleRef.current = Math.atan2(dy, dx);
      const nx = dx / (rect.width / 2);
      const ny = dy / (rect.height / 2);
      tiltTargetRef.current = { x: ny * 0.12, y: -nx * 0.12 };
    };
    renderer.domElement.addEventListener("pointerenter", onEnter);
    renderer.domElement.addEventListener("pointerleave", onLeave);
    renderer.domElement.addEventListener("pointermove", onMove);

    const clock = new THREE.Clock();
    const blue = new THREE.Color(0x00b7ff);
    const warm = new THREE.Color(0xff6b00);

    const loop = () => {
      rafRef.current = requestAnimationFrame(loop);
      const t = clock.getElapsedTime();
      const orb = orbRef.current;
      const mat = orbMatRef.current;
      const halo = haloRef.current;

      // audio analysis value from previous effect (smoothed in uniforms)
      const audioLevel = mat.uniforms.u_audio.value;

      // 🎚️ rotation speed reacts to audio
      const boost = 1 + audioLevel * 2.5; // 1..3.5x
      if (orb) {
        orb.rotation.y += 0.02 * speed * boost;
        orb.rotation.x += (tiltTargetRef.current.x - orb.rotation.x) * 0.08;
        orb.rotation.z += (tiltTargetRef.current.y - orb.rotation.z) * 0.08;
      }
      if (halo) halo.rotation.y += 0.008 * speed * boost;

      // uniforms
      mat.uniforms.u_time.value = t;
      halo.material.uniforms.u_time.value = t;

      // halo tint blends blue→warm with audio/hover
      const mixK = Math.min(1, 0.7 * hoverRef.current + 0.5 * audioLevel);
      const tint = blue.clone().lerp(warm, mixK);
      halo.material.uniforms.u_tint.value.copy(tint);

      renderer.render(sceneRef.current, cameraRef.current);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafRef.current);
      try {
        renderer.domElement.removeEventListener("pointerenter", onEnter);
        renderer.domElement.removeEventListener("pointerleave", onLeave);
        renderer.domElement.removeEventListener("pointermove", onMove);
      } catch {}
      renderer.domElement.replaceWith(
        document.createComment("orb-canvas-removed")
      );
      renderer.dispose();
      try {
        geo.dispose();
        haloGeo.dispose();
        orbMat.dispose();
        haloMat.dispose();
      } catch {}
      sceneRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
      orbRef.current = null;
      orbMatRef.current = null;
      haloRef.current = null;
    };
  }, [size, speed]);

  // build AudioContext from remote stream (kept intact, just used for rotation/color)
  useEffect(() => {
    let ac, an, src;
    if (stream) {
      try {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        an = ac.createAnalyser();
        an.fftSize = 256;
        an.smoothingTimeConstant = 0.9;
        src = ac.createMediaStreamSource(stream);
        src.connect(an);
        audioCtxRef.current = ac;
        analyserRef.current = an;
        freqRef.current = new Uint8Array(an.frequencyBinCount);
      } catch (e) {
        console.warn("Audio analyser init failed:", e);
      }
    }
    return () => {
      try {
        src && src.disconnect();
      } catch {}
      try {
        an && an.disconnect();
      } catch {}
      try {
        ac && ac.close();
      } catch {}
      audioCtxRef.current = null;
      analyserRef.current = null;
      freqRef.current = null;
    };
  }, [stream]);

  // sample audio & push to uniforms (smoothing)
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const an = analyserRef.current;
      const buf = freqRef.current;
      const mat = orbMatRef.current;
      if (!an || !buf || !mat) return;
      an.getByteFrequencyData(buf);
      const end = Math.floor(buf.length * 0.6);
      let s = 0;
      for (let i = 0; i < end; i++) s += buf[i];
      const level = end ? s / (end * 255) : 0;
      mat.uniforms.u_audio.value =
        mat.uniforms.u_audio.value * 0.85 + level * 0.15;
      mat.uniforms.u_hover.value =
        mat.uniforms.u_hover.value * 0.8 + hoverRef.current * 0.2;
      mat.uniforms.u_hotDir.value.set(
        Math.cos(hotAngleRef.current),
        Math.sin(hotAngleRef.current)
      );
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      ref={hostRef}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        minWidth: `${size}px`, // ✅ new
        minHeight: `${size}px`, // ✅ new
        flex: "0 0 auto", // ✅ new (don’t let flexbox shrink it)
        margin: "10px auto 4px",
        background: "transparent",
        pointerEvents: "auto",
        userSelect: "none",
        borderRadius: "50%",
        overflow: "hidden",
      }}
    />
  );
};
const initialQuestions = [
  "What can the AI Meeting Assistant do?",
  "How does AI Meeting Co-Pilot App work?",
  "How Can I schedule a meeting?",
  "How can I ask questions related to a meeting",
  "How to use the AI Meeting Assistant?",
  "How do I add or remove participants?",
  "How do I set the meeting agenda?",
  "Are there any decisions made in the meeting?",
  "Can you generate a meeting summary?",
];
/* --------------------------------- Main component --------------------------------- */
const VoiceAssistant = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isMicActive, setIsMicActive] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("idle");
  const [transcript, setTranscript] = useState("");
  const [responseText, setResponseText] = useState("");
  const [remoteStream, setRemoteStream] = useState(null);
  const audioPlayerRef = useRef(null);
  const dragConstraintsRef = useRef(null);
  const { formData, setFormData } = useContext(FormContext);
  const { selectedMeeting } = useContext(MeetingContext);
  const [mode, setMode] = useState("chat");
  const [chatMessages, setChatMessages] = useState([
    {
      role: "assistant",
      text: "Hi! I'm your Meeting Co-Pilot. How can I assist you today?",
    },
    {
      role: "assistant",
      text: "You can ask me to schedule meetings, update fields, add participants, or summarize tasks.",
    },
  ]);
  const [visibleQuestions, setVisibleQuestions] = useState(initialQuestions);
  const [accordionOpen, setAccordionOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const chatEndRef = useRef(null);
  const [chatInputText, setChatInputText] = useState("");
  const { activeTab, setActiveTab } = useContext(NavigationContext);

const chatInputRef = useRef(null);

const sendChatMessage = async ({ text }) => {
  const message = text.trim();
  if (!message) return;

  setChatMessages((prev) => [...prev, { role: "user", text: message }]);
  setResponseText("");

  const res = await fetch("https://ai-meeting-assistant-backend-suu9.onrender.com/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      formData,
      meetingContext: selectedMeeting,
    }),
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");

  let toolCall = null;
  let assistantText = ""; // ✅ LOCAL BUFFER (IMPORTANT)

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split("\n\n").filter(Boolean);

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;

      const payload = JSON.parse(line.slice(6));

      if (payload.type === "text") {
        assistantText += payload.delta;        // ✅ accumulate
        setResponseText((prev) => prev + payload.delta); // UI typing
      }

      if (payload.type === "tool") {
        toolCall = payload.tool;
      }

      if (payload.type === "done") {
        // ✅ push FINAL assistant message
        setChatMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            text: assistantText.trim(),
          },
        ]);

        if (toolCall) {
          let args = toolCall.args;
          if (typeof args === "string") {
            try {
              args = JSON.parse(args);
            } catch {}
          }
          handleToolCall(toolCall.name, args);
        }

        setResponseText("");
        return;
      }
    }
  }
};

  useEffect(() => {
    setTimeout(() => {
      if (chatEndRef.current) {
        chatEndRef.current.scrollTop = chatEndRef.current.scrollHeight;
      }
    }, 0); // run after DOM update
  }, [chatMessages]);

  const toolBuffersRef = useRef(new Map());
  const recentClicksRef = useRef(new Map());

  const { hideVoiceBtn, chooseVoice, resetToggles } = useUiStore();

  useEffect(() => {
    if (dragConstraintsRef.current == null) {
      dragConstraintsRef.current = document.body;
    }
  }, []);

  useEffect(() => {
    if (mode === "chat") {
      console.log("Switching to Chat Mode → stopping WebRTC");
      cleanupWebRTC();
    }

    if (mode === "voice") {
      console.log("Switching to Voice Mode → starting WebRTC");
      chooseVoice();
      startWebRTC();
    }
  }, [mode]);

const ensureCorrectTab = (requiredTab) => {
  if (activeTab !== requiredTab) {
    console.log(`🔀 Auto-navigating to ${requiredTab}`);
    setActiveTab(requiredTab);
  }
};


  const cleanupWebRTC = () => {
    if (peerConnectionRef.current) {
      try {
        peerConnectionRef.current.close();
      } catch {}
      peerConnectionRef.current = null;
    }
    if (dataChannelRef.current) {
      try {
        dataChannelRef.current.close();
      } catch {}
      dataChannelRef.current = null;
    }
    if (localStreamRef.current) {
      try {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      } catch {}
      localStreamRef.current = null;
    }
    try {
      if (audioPlayerRef.current) audioPlayerRef.current.srcObject = null;
    } catch {}

    setConnectionStatus("idle");
    setIsMicActive(false);
    setTranscript("");
    setResponseText("");
    setRemoteStream(null);
    resetToggles();
  };
const handleQuestionClick = (question) => {
  sendChatMessage({ text: question });

  // optional: collapse accordion after click
  setAccordionOpen(false);

  // optional: clear predefined questions after first use
  // setVisibleQuestions([]);
};

  const sendSessionUpdate = () => {
    const ch = dataChannelRef.current;
    if (!ch || ch.readyState !== "open") return;
    try {
      ch.send(
        JSON.stringify({
          type: "session.update",
          session: {
            modalities: ["text", "audio"],
            turn_detection: { type: "server_vad" },
            tools: TOOL_SCHEMAS,
            tool_choice: { type: "auto" },
          },
        })
      );
    } catch {}
  };

  function handleToolCall(name, args = {}) {
    console.log("Tool:", name, args);

    switch (name) {
      // ---------------------------------------------------------
      // SET MEETING TITLE
      // ---------------------------------------------------------
      case "set_meeting_title": {
        ensureCorrectTab("schedule");
        setFormData((prev) => ({
          ...prev,
          meeting_title: args.value || "",
        }));
        break;
      }

      // ---------------------------------------------------------
      // SET MEETING TYPE
      // ---------------------------------------------------------
      case "set_meeting_type": {
        ensureCorrectTab("schedule");
        setFormData((prev) => ({
          ...prev,
          meeting_type: args.value || "",
        }));
        break;
      }

      // ---------------------------------------------------------
      // SET MEETING FULL DATETIME (YYYY-MM-DDTHH:MM)
      // ---------------------------------------------------------
      case "set_meeting_datetime": {
        ensureCorrectTab("schedule");
        setFormData((prev) => ({
          ...prev,
          meeting_time: args.value || "",
        }));
        break;
      }

      // ---------------------------------------------------------
      // SET ONLY DATE (YYYY-MM-DD)
      // Keep existing time or default 00:00
      // ---------------------------------------------------------
      case "set_meeting_date": {
        ensureCorrectTab("schedule");
        setFormData((prev) => {
          const oldTime = prev.meeting_time?.split("T")[1] || "00:00";
          return {
            ...prev,
            meeting_time: `${args.value}T${oldTime}`,
          };
        });
        break;
      }

      // ---------------------------------------------------------
      // SET ONLY TIME (HH:MM)
      // Keep existing date or default today
      // ---------------------------------------------------------
      case "set_meeting_time": {
        ensureCorrectTab("schedule");
        setFormData((prev) => {
          const oldDate =
            prev.meeting_time?.split("T")[0] ||
            new Date().toISOString().split("T")[0];

          return {
            ...prev,
            meeting_time: `${oldDate}T${args.value}`,
          };
        });
        break;
      }

      // ---------------------------------------------------------
      // ADD PARTICIPANT (name, email, role)
      // ---------------------------------------------------------
      case "add_participant": {
        ensureCorrectTab("schedule");
        window.dispatchEvent(
          new CustomEvent("voice_participant", {
            detail: {
              mode: "add",
              name: args.name,
              email: args.email,
              role: args.role,
            },
          })
        );
        break;
      }

      case "set_participant_field": {
        ensureCorrectTab("schedule");
        window.dispatchEvent(
          new CustomEvent("voice_participant", {
            detail: {
              mode: "update",
              index: args.index,
              field: args.field, // name | email | role
              value: args.value,
            },
          })
        );
        break;
      }

      // ---------------------------------------------------------
      // REMOVE PARTICIPANT BY INDEX
      // ---------------------------------------------------------
      case "remove_participant": {
        ensureCorrectTab("schedule");
        window.dispatchEvent(
          new CustomEvent("voice_remove_participant", {
            detail: args, // {index}
          })
        );
        break;
      }

      // ---------------------------------------------------------
      // ADD AGENDA ITEM (item, minutes_into_meeting, assigned_to)
      // ---------------------------------------------------------
      case "add_agenda_item": {
        ensureCorrectTab("schedule");
        window.dispatchEvent(
          new CustomEvent("voice_add_agenda", {
            detail: args,
          })
        );
        break;
      }

      // ---------------------------------------------------------
      // DELETE AGENDA ITEM BY INDEX
      // ---------------------------------------------------------
      case "delete_agenda_item": {
        ensureCorrectTab("schedule");
        window.dispatchEvent(
          new CustomEvent("voice_delete_agenda", {
            detail: args,
          })
        );
        break;
      }

      // ---------------------------------------------------------
      // SUBMIT FORM
      // ---------------------------------------------------------
      case "submit_meeting": {
        ensureCorrectTab("schedule");
        document
          .querySelector("form")
          ?.dispatchEvent(new Event("submit", { bubbles: true }));
        break;
      }
      // ---------------------------------------------------------
      // Navigation Tool 
      // ---------------------------------------------------------
      case "navigate_tab": {
        setActiveTab(args.tab);
        break;
      }
      // ---------------------------------------------------------
      // UNKNOWN TOOL
      // ---------------------------------------------------------
      default:
        console.warn("Unknown tool:", name);
    }
  }

  const startWebRTC = async () => {
    if (peerConnectionRef.current || connectionStatus === "connecting") return;
    setConnectionStatus("connecting");
    setResponseText("Connecting to assistant...");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
      peerConnectionRef.current = pc;

      pc.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
          const s = event.streams[0];
          if (audioPlayerRef.current) {
            audioPlayerRef.current.srcObject = s;
            audioPlayerRef.current.play().catch(() => {});
          }
          setRemoteStream(s);
        }
      };

      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      const channel = pc.createDataChannel("response", { ordered: true });
      dataChannelRef.current = channel;

      channel.onopen = () => {
        setConnectionStatus("connected");
        setResponseText("Connected! Speak now...");
        setIsMicActive(true);
        sendSessionUpdate();
        try {
          channel.send(
            JSON.stringify({
              type: "response.create",
              response: { modalities: ["text", "audio"] },
            })
          );
        } catch {}
      };

      channel.onmessage = (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        if (
          msg.type === "conversation.item.input_audio_transcription.completed"
        ) {
          setTranscript(msg.transcript || "");
          setResponseText("");
          return;
        }
        if (msg.type === "response.text.delta") {
          setResponseText((p) => p + (msg.delta || ""));
          return;
        }
        if (msg.type === "response.done") {
          setTranscript("");
          return;
        }

        if (
          msg.type === "response.output_item.added" &&
          msg.item?.type === "function_call"
        ) {
          const id = msg.item.call_id || msg.item.id || "default";
          toolBuffersRef.current.set(id, {
            name: msg.item.name || "",
            argsText: "",
          });
          return;
        }
        if (
          msg.type === "response.function_call_arguments.delta" ||
          msg.type === "tool_call.delta"
        ) {
          const id = msg.call_id || msg.id || "default";
          const prev = toolBuffersRef.current.get(id) || {
            name: "",
            argsText: "",
          };
          prev.argsText += msg.delta || msg.arguments_delta || "";
          toolBuffersRef.current.set(id, prev);
          return;
        }
        if (
          msg.type === "response.function_call_arguments.done" ||
          msg.type === "tool_call_arguments.done" ||
          msg.type === "response.function_call.completed" ||
          msg.type === "tool_call.completed"
        ) {
          console.log("Tool call event received:", msg.type);

          const id = msg.call_id || msg.id || "default";
          console.log("Using call id:", id);

          const buf = toolBuffersRef.current.get(id);
          toolBuffersRef.current.delete(id);

          if (!buf) {
            console.warn("No buffer found for id:", id);
            return;
          }

          let args = {};
          try {
            args = JSON.parse(buf.argsText || "{}");
            console.log("Parsed tool arguments:", args);
          } catch (err) {
            console.warn("Failed parsing tool args:", err);
          }

          // FINAL + CORRECT:
          console.log(`Calling handleToolCall with name: ${buf.name}`);
          handleToolCall(buf.name, args);
          return;
        }
      };

      channel.onerror = () => {
        setConnectionStatus("error");
        setResponseText("Connection error.");
      };
      channel.onclose = () => {
        cleanupWebRTC();
      };

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        if (
          state === "failed" ||
          state === "disconnected" ||
          state === "closed"
        )
          cleanupWebRTC();
      };

      let offer = await pc.createOffer({ offerToReceiveAudio: true });
      offer.sdp = offer.sdp.replace(
        /a=rtpmap:\d+ opus\/48000\/2/g,
        "a=rtpmap:111 opus/48000/2\r\n" +
          "a=fmtp:111 minptime=10;useinbandfec=1"
      );
      await pc.setLocalDescription(offer);

      const res = await fetch(
        "https://ai-meeting-assistant-backend-suu9.onrender.com/api/rtc-connect",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sdp: offer.sdp,
            meetingContext: selectedMeeting,
          }),
        }
      );

      if (!res.ok) throw new Error(`Server responded with ${res.status}`);

      const answer = await res.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answer });
    } catch (err) {
      console.error("WebRTC error:", err);
      setConnectionStatus("error");
      setResponseText("Failed to start session.");
      cleanupWebRTC();
    }
  };

  // const toggleAssistant = () => {
  //   setIsOpen((prev) => {
  //     const opening = !prev;
  //     if (opening) {
  //       chooseVoice();
  //       startWebRTC();
  //     } else {
  //       cleanupWebRTC();
  //     }
  //     return !prev;
  //   });
  // };

  const toggleAssistant = () => {
    setIsOpen((prev) => {
      const opening = !prev;

      if (opening) {
        // Only start voice pipeline if voice mode is selected
        if (mode === "voice") {
          chooseVoice();
          startWebRTC();
        }
      } else {
        cleanupWebRTC();
      }

      return opening;
    });
  };

  const toggleMic = () => {
    if (connectionStatus === "connected" && localStreamRef.current) {
      const next = !isMicActive;
      setIsMicActive(next);
      try {
        localStreamRef.current
          .getAudioTracks()
          .forEach((t) => (t.enabled = next));
      } catch {}
    }
  };
  // ⬇️ add this small helper
  const closeAssistantNow = () => {
    setIsOpen(false);
    cleanupWebRTC();
  };

  return (
    <>
      {!isOpen && !hideVoiceBtn && (
        <motion.button
          className="voice-toggle-btn left"
          onClick={toggleAssistant}
        >
          +
        </motion.button>
      )}

      <AnimatePresence>
        {isOpen && (
          <motion.div
            className="voice-sidebar glassmorphic"
            style={{
              position: "fixed",
              top: 188,
              right: 20,
              zIndex: 1001,
              width: "429px",
              height: "639px",
              background: "transparent",
            }}
          >
            <audio ref={audioPlayerRef} style={{ display: "none" }} />

            <div className="voice-header">
              <h3>Meeting Co-Pilot</h3>
              <button className="close-btn-green" onClick={toggleAssistant}>
                ✖
              </button>
              {/* 🔵 Mode Toggle */}
              <div className="mode-toggle-container">
                <div className="mode-toggle">
                  <button
                    className={`mode-btn ${mode === "chat" ? "active" : ""}`}
                    onClick={() => setMode("chat")}
                  >
                    Chat Mode
                  </button>

                  <button
                    className={`mode-btn ${mode === "voice" ? "active" : ""}`}
                    onClick={() => setMode("voice")}
                  >
                    Voice Mode
                  </button>
                </div>
              </div>
            </div>
            {mode === "chat" && (
              <div className="chat-box">
                <div className="chat-messages" ref={chatEndRef}>
                  {chatMessages.map((msg, i) => (
                    <div
                      key={i}
                      className={`chat-bubble ${
                        msg.role === "user" ? "user-bubble" : "assistant-bubble"
                      }`}
                    >
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {msg.text}
                      </ReactMarkdown>
                    </div>
                  ))}

                  {/* live typing from model */}
                  {responseText && (
                    <div className="assistant-bubble typing">
                      {responseText}
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
                          <span
                            className={`chevron ${
                              accordionOpen ? "rotate" : ""
                            }`}
                          >
                            ▼
                          </span>
                        </div>
                        <div
                          className={`accordion-body ${
                            accordionOpen ? "open" : ""
                          }`}
                        >
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
  ref={chatInputRef}
  inputText={chatInputText}
  setInputText={setChatInputText}
  onSendMessage={sendChatMessage}
/>

              </div>
            )}

            {mode === "voice" && (
              <>
                {/* ✅ perfect-circle, locked size, audio-reactive rotation & color */}
                <ReactiveOrb stream={remoteStream} size={220} speed={2.2} />

                <div className="voice-visualizer-container">
                  {remoteStream ? (
                    <AudioWave stream={remoteStream} />
                  ) : (
                    <div className="visualizer-placeholder">
                      {connectionStatus === "connected"
                        ? "Listening..."
                        : "Connecting..."}
                    </div>
                  )}
                </div>

                <div className="voice-controls">
                  <button
                    className={`mic-btn ${
                      isMicActive ? "active" : "inactive"
                    } ${connectionStatus !== "connected" ? "disabled" : ""}`}
                    onClick={toggleMic}
                    disabled={connectionStatus !== "connected"}
                    aria-pressed={isMicActive}
                    aria-label={
                      isMicActive ? "Mute microphone" : "Unmute microphone"
                    }
                    title={
                      isMicActive
                        ? "Mic on — click to mute"
                        : "Mic off — click to unmute"
                    }
                  >
                    {isMicActive ? <FaMicrophoneAlt /> : <FaMicrophoneSlash />}
                  </button>
                  <span className={`status ${connectionStatus}`}>
                    {isMicActive ? "listening" : "mic off"}
                  </span>

                  <span className={`status ${connectionStatus}`}>
                    {connectionStatus}
                  </span>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      {/* <Dashboard /> */}
    </>
  );
};

export default VoiceAssistant;
