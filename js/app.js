"use strict";

/**
 * Quest Terminal — NFC-driven quest app.
 * Config is loaded from config.json. Codes are never stored in plaintext:
 * only a salted SHA-256 hash is kept, computed/checked entirely client-side.
 */

const els = {
  log: document.getElementById("term-log"),
  clock: document.getElementById("clock"),
  appTitle: document.getElementById("app-title"),

  idle: document.getElementById("screen-idle"),
  idleText: document.getElementById("idle-text"),
  btnScan: document.getElementById("btn-scan"),
  scanStatus: document.getElementById("scan-status"),

  unsupported: document.getElementById("screen-unsupported"),
  unsupportedText: document.getElementById("unsupported-text"),

  unknown: document.getElementById("screen-unknown"),
  unknownText: document.getElementById("unknown-text"),

  reveal: document.getElementById("screen-reveal"),
  revealTitle: document.getElementById("reveal-title"),
  revealText: document.getElementById("reveal-text"),
  revealImages: document.getElementById("reveal-images"),

  code: document.getElementById("screen-code"),
  codeTitle: document.getElementById("code-title"),
  codePrompt: document.getElementById("code-prompt"),
  codeInput: document.getElementById("code-input"),
  btnSubmitCode: document.getElementById("btn-submit-code"),
  codeFeedback: document.getElementById("code-feedback"),

  success: document.getElementById("screen-success"),
  successTitle: document.getElementById("success-title"),
  successText: document.getElementById("success-text"),
  successImages: document.getElementById("success-images"),
};

const allScreens = [
  els.idle, els.unsupported, els.unknown, els.reveal, els.code, els.success,
];

let CONFIG = null;
let ndefReader = null;
const attemptCounts = Object.create(null);
let currentTagKey = null;

init();

async function init() {
  startClock();
  try {
    CONFIG = await loadConfig();
  } catch (err) {
    logLine(`CONFIG LOAD ERROR: ${err.message}`);
    CONFIG = {
      appTitle: "QUEST TERMINAL",
      idleText: "CONFIGURATION ERROR.",
      unknownTagText: "UNKNOWN TAG.",
      unsupportedText: "WEB NFC NOT AVAILABLE.",
      tags: {},
    };
  }

  if (CONFIG.appTitle) {
    els.appTitle.textContent = CONFIG.appTitle;
    document.title = CONFIG.appTitle;
  }

  showScreen("idle");
  typeInto(els.idleText, CONFIG.idleText || "");

  els.btnScan.addEventListener("click", onScanButton);
  els.btnSubmitCode.addEventListener("click", submitCode);
  els.codeInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitCode();
  });
  document.querySelectorAll(".btn-rescan").forEach((btn) => {
    btn.addEventListener("click", resetToIdle);
  });

  maybeAutoStartFromDebugParam();
}

async function loadConfig() {
  const res = await fetch("config.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/* ---------------- Screen management ---------------- */

function showScreen(name) {
  allScreens.forEach((el) => el.classList.add("hidden"));
  const map = {
    idle: els.idle,
    unsupported: els.unsupported,
    unknown: els.unknown,
    reveal: els.reveal,
    code: els.code,
    success: els.success,
  };
  map[name].classList.remove("hidden");
}

function resetToIdle() {
  currentTagKey = null;
  els.codeInput.value = "";
  els.codeFeedback.textContent = "";
  showScreen("idle");
  els.scanStatus.textContent = ndefReader ? "SCANNING FOR TAGS..." : "";
}

/* ---------------- NFC scanning ---------------- */

async function onScanButton() {
  if (!("NDEFReader" in window)) {
    showScreen("unsupported");
    typeInto(els.unsupportedText, CONFIG.unsupportedText || "");
    return;
  }
  try {
    ndefReader = new NDEFReader();
    await ndefReader.scan();
    els.scanStatus.textContent = "SCANNING FOR TAGS...";
    logLine("NFC READER ACTIVE.");
    ndefReader.onreading = handleReading;
    ndefReader.onreadingerror = () => {
      els.scanStatus.textContent = "READ ERROR. HOLD TAG STEADY AND RETRY.";
    };
  } catch (err) {
    els.scanStatus.textContent = `SCAN FAILED: ${err.message}`;
    logLine(`NFC ERROR: ${err.message}`);
  }
}

function handleReading(event) {
  const key = decodeTagKey(event.message);
  if (!key) {
    routeUnknown();
    return;
  }
  routeTag(key.trim());
}

function decodeTagKey(message) {
  for (const record of message.records) {
    if (record.recordType === "text") {
      try {
        const decoder = new TextDecoder(record.encoding || "utf-8");
        return decoder.decode(record.data);
      } catch {
        /* fall through */
      }
    }
  }
  return null;
}

/* Allows testing without physical NFC hardware: index.html?tag=relic-01 */
function maybeAutoStartFromDebugParam() {
  const params = new URLSearchParams(location.search);
  const debugTag = params.get("tag");
  if (debugTag) routeTag(debugTag.trim());
}

/* ---------------- Routing ---------------- */

function routeTag(key) {
  currentTagKey = key;
  const entry = CONFIG.tags && CONFIG.tags[key];
  logLine(`TAG DETECTED: ${key}`);

  if (!entry) {
    routeUnknown();
    return;
  }

  if (entry.type === "code") {
    showCodeScreen(entry);
  } else {
    showRevealScreen(entry, els.reveal, els.revealTitle, els.revealText, els.revealImages);
  }
}

function routeUnknown() {
  showScreen("unknown");
  typeInto(els.unknownText, CONFIG.unknownTagText || "UNKNOWN TAG.");
}

function showRevealScreen(entry, screenEl, titleEl, textEl, imagesEl) {
  showScreen(screenEl === els.reveal ? "reveal" : "success");
  titleEl.textContent = entry.title || "";
  typeInto(textEl, entry.text || "");
  renderImages(imagesEl, entry.images || []);
}

function renderImages(container, images) {
  container.innerHTML = "";
  images.forEach((src) => {
    const img = document.createElement("img");
    img.src = src;
    img.alt = "";
    container.appendChild(img);
  });
}

function showCodeScreen(entry) {
  showScreen("code");
  els.codeTitle.textContent = entry.title || "";
  typeInto(els.codePrompt, entry.prompt || "ENTER ACCESS CODE");
  els.codeInput.value = "";
  els.codeFeedback.textContent = "";
  els.codeFeedback.className = "term-status";
  els.codeInput.disabled = false;
  els.btnSubmitCode.disabled = false;
  setTimeout(() => els.codeInput.focus(), 50);
}

/* ---------------- Code validation ---------------- */

async function submitCode() {
  const entry = CONFIG.tags[currentTagKey];
  if (!entry || entry.type !== "code") return;

  const guess = els.codeInput.value;
  if (!guess) return;

  els.btnSubmitCode.disabled = true;
  const hash = await sha256Hex((entry.salt || "") + guess);
  els.btnSubmitCode.disabled = false;

  if (hash.toLowerCase() === String(entry.codeHash || "").toLowerCase()) {
    els.codeFeedback.className = "term-status ok";
    els.codeFeedback.textContent = "ACCESS GRANTED.";
    showRevealScreen(
      {
        title: entry.successTitle || "ACCESS GRANTED",
        text: entry.successText || "",
        images: entry.successImages || [],
      },
      els.success,
      els.successTitle,
      els.successText,
      els.successImages
    );
    return;
  }

  attemptCounts[currentTagKey] = (attemptCounts[currentTagKey] || 0) + 1;
  els.codeFeedback.className = "term-status error";
  els.codeFeedback.textContent = entry.failText || "ACCESS DENIED.";
  els.codeInput.value = "";
  els.codeInput.focus();

  const max = Number(entry.maxAttempts) || 0;
  if (max > 0 && attemptCounts[currentTagKey] >= max) {
    els.codeInput.disabled = true;
    els.btnSubmitCode.disabled = true;
    els.codeFeedback.textContent = "SECURITY LOCKOUT. SCAN TAG AGAIN TO RETRY.";
  }
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/* ---------------- Cosmetic helpers ---------------- */

function typeInto(el, text, speed = 14) {
  el.classList.remove("typing");
  el.textContent = "";
  if (!text) return;
  el.classList.add("typing");
  let i = 0;
  const timer = setInterval(() => {
    el.textContent += text[i];
    i++;
    if (i >= text.length) {
      clearInterval(timer);
      el.classList.remove("typing");
    }
  }, speed);
}

function logLine(msg) {
  const time = new Date().toLocaleTimeString();
  els.log.textContent = `[${time}] ${msg}`;
}

function startClock() {
  const tick = () => {
    els.clock.textContent = new Date().toLocaleTimeString();
  };
  tick();
  setInterval(tick, 1000);
}
