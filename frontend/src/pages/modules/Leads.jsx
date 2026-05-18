import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { useNavigate } from "react-router-dom";
import API from "../../api";
import Pagination from "../../components/Pagination";
import { ALL_STAGE_OPTIONS } from "../../utils/stages";
import "./styles/LeadsDashboard.css";
import "./styles/Expense.css";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const MAX_FILES             = 2;
const MAX_FILE_SIZE_MB      = 2;
const MAX_FILE_SIZE_BYTES   = MAX_FILE_SIZE_MB * 1024 * 1024;
const ACCEPTED_MIME         = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const ACCEPTED_EXT_LABEL    = "JPG, PNG, WEBP, GIF";
const HANDLE_HALF           = 9;   // half-size of resize handles in px

function compactOcrText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().replace(/[.,;:]+$/g, "");
}

function normalizeOcrKey(value) {
  return compactOcrText(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function looksLikeMongoObjectId(value) {
  return /^[a-f0-9]{24}$/i.test(String(value || "").trim());
}

function isReadableOcrText(value) {
  const text = compactOcrText(value);
  if (!text) return false;
  if (["UNREADABLE", "NONE", "NULL", "N/A", "NA"].includes(text.toUpperCase())) return false;
  return /[A-Za-z0-9]/.test(text);
}

function hasOcrIdentity(fields = {}) {
  return isReadableOcrText(fields.company) || isReadableOcrText(fields.name);
}

function hasOcrStrongContact(fields = {}) {
  return isReadableOcrText(fields.phone) || isReadableOcrText(fields.email);
}

function hasOcrUsefulData(fields = {}) {
  return [
    fields.name,
    fields.company,
    fields.designation,
    fields.address,
    fields.phone,
    fields.email,
    fields.website,
  ].some(isReadableOcrText);
}

function extractUrlDomain(value) {
  const text = compactOcrText(value).toLowerCase();
  if (!text) return "";

  const match = text.match(/(?:https?:\/\/)?(?:www\.)?([a-z0-9.-]+\.[a-z]{2,}(?:\.[a-z]{2,})?)/i);
  if (!match) return "";
  return match[1].replace(/^www\./, "");
}

function extractEmailDomain(value) {
  const text = compactOcrText(value);
  const match = text.match(/@([a-z0-9.-]+\.[a-z]{2,}(?:\.[a-z]{2,})?)/i);
  return match ? match[1].toLowerCase().replace(/^www\./, "") : "";
}

function canonicalWebsiteValue(value) {
  const text = compactOcrText(value).toLowerCase();
  if (!text) return "";

  const match = text.match(/(?:https?:\/\/)?((?:www\.)?[a-z0-9.-]+\.[a-z]{2,}(?:\.[a-z]{2,})?)/i);
  if (!match) return "";

  return match[1];
}

const OCR_BRAND_STOPWORDS = new Set([
  "and", "the", "for", "with", "from", "your", "pure", "power", "solar", "system",
  "grid", "off", "on", "best", "quality", "professional", "maintenance", "services",
  "advanced", "solutions", "electrical", "energy", "renew", "email", "phone", "mobile",
  "road", "street", "estate", "college", "dist", "suite", "main", "manager", "sales",
  "office", "director", "gmail", "yahoo", "hotmail", "outlook", "mail", "www", "com",
  "net", "org", "in", "co", "ltd", "private", "limited", "india", "pune", "nagar",
  "floor", "building", "near", "opp", "plot",
]);

function normalizeCompanyName(value) {
  return compactOcrText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((part) => part && !["ltd", "pvt", "private", "limited", "llp", "inc", "corp", "co", "company", "group", "services", "solutions", "technologies", "enterprise", "renew", "energy", "electrical"].includes(part))
    .join(" ")
    .trim();
}

function extractDomainRoot(value) {
  const domain = compactOcrText(value).toLowerCase().replace(/^www\./, "");
  if (!domain) return "";
  return domain.split(".")[0] || "";
}

function extractIdentityTokens(value) {
  return compactOcrText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((token) => token.length >= 3 && !OCR_BRAND_STOPWORDS.has(token));
}

function collectScanBrandTokens(scanResult = {}) {
  const fields = scanResult.fields || {};
  const values = [
    fields.name,
    fields.company,
    fields.designation,
    fields.address,
    ...(Array.isArray(scanResult.lineLabels) ? scanResult.lineLabels.map((item) => item?.text) : []),
  ];
  return new Set(values.flatMap(extractIdentityTokens));
}

function pairHasSharedBrandToken(scanResults) {
  if (scanResults.length < 2) return false;
  const tokenSets = scanResults.map(collectScanBrandTokens).filter((set) => set.size > 0);
  if (tokenSets.length < 2) return false;

  const [first, ...rest] = tokenSets;
  return Array.from(first).some((token) => rest.every((set) => set.has(token)));
}

function resolveOcrCompanyName(fieldsList = [], merged = {}, scanResults = []) {
  const companyCandidates = Array.from(new Set(
    fieldsList
      .map((fields) => compactOcrText(fields.company))
      .filter((value) => isReadableOcrText(value))
  ));
  if (companyCandidates.length === 0) return "";
  if (companyCandidates.length === 1) return companyCandidates[0];

  const domainRoots = Array.from(new Set([
    ...fieldsList.map((fields) => extractDomainRoot(extractUrlDomain(fields.website))),
    ...fieldsList.map((fields) => extractDomainRoot(extractEmailDomain(fields.email))),
  ].filter(Boolean)));
  const sharedBrandTokens = new Set(
    scanResults.length >= 2
      ? Array.from(collectScanBrandTokens(scanResults[0])).filter((token) =>
          scanResults.slice(1).every((result) => collectScanBrandTokens(result).has(token))
        )
      : []
  );

  const scored = companyCandidates
    .map((candidate) => {
      const normalized = normalizeCompanyName(candidate);
      const tokens = extractIdentityTokens(candidate);
      let score = tokens.length;

      if (domainRoots.some((root) => normalized.includes(root) || root.includes(normalized.replace(/\s+/g, "")))) {
        score += 6;
      }
      if (tokens.some((token) => sharedBrandTokens.has(token))) {
        score += 4;
      }
      if (candidate.length <= 40) {
        score += 1;
      }

      return { candidate, score };
    })
    .sort((a, b) => b.score - a.score || a.candidate.length - b.candidate.length);

  return scored[0]?.candidate || compactOcrText(merged.company);
}

function companiesCompatible(a, b) {
  const left = normalizeCompanyName(a);
  const right = normalizeCompanyName(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.includes(right) || right.includes(left)) return true;

  const leftTokens = left.split(" ").filter(Boolean);
  const rightTokens = right.split(" ").filter(Boolean);
  const shared = leftTokens.filter((token) => rightTokens.includes(token));
  return shared.length > 0 && (shared.length >= Math.min(leftTokens.length, rightTokens.length) || shared[0].length >= 3);
}

function uniqueJoin(values) {
  const seen = new Set();
  const out = [];

  for (const value of values) {
    const text = compactOcrText(value);
    const key = normalizeOcrKey(text);
    if (!text || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }

  return out.join(", ");
}

function mergeWebsiteValues(values) {
  const seen = new Set();
  const out = [];

  for (const value of values) {
    for (const part of String(value || "").split(/\s*(?:\||,)\s*/)) {
      const canonical = canonicalWebsiteValue(part);
      const key = normalizeOcrKey(canonical);
      if (!canonical || !key || seen.has(key)) continue;
      seen.add(key);
      out.push(canonical);
    }
  }

  return out.join(", ");
}

function buildCardMismatchWarning() {
  return "Different business cards detected. Please upload the front and back of the same card.";
}

function mergeOcrScanResults(scanResults) {
  const fieldsList = scanResults.map(({ fields }) => fields || {});
  const merged = {};
  const companyValues = fieldsList
    .map((fields) => compactOcrText(fields.company))
    .filter((value) => isReadableOcrText(value));
  const websiteDomains = fieldsList
    .map((fields) => extractUrlDomain(fields.website))
    .filter(Boolean);
  const emailDomains = fieldsList
    .map((fields) => extractEmailDomain(fields.email))
    .filter(Boolean);

  for (const key of ["name", "company", "designation", "address", "phone", "email", "website"]) {
    const mergedValue = uniqueJoin(fieldsList.map((fields) => fields[key]));
    if (mergedValue) merged[key] = mergedValue;
  }
  const mergedWebsite = mergeWebsiteValues(fieldsList.map((fields) => fields.website));
  if (mergedWebsite) merged.website = mergedWebsite;

  merged.company = resolveOcrCompanyName(fieldsList, merged, scanResults);

  const uniqueCompanies = Array.from(new Set(companyValues.map(normalizeOcrKey))).filter(Boolean);
  const uniqueWebsites = Array.from(new Set(websiteDomains.map(normalizeOcrKey))).filter(Boolean);
  const uniqueEmails = Array.from(new Set(emailDomains.map(normalizeOcrKey))).filter(Boolean);
  const sharedWebsiteIdentity = websiteDomains.length > 1 && uniqueWebsites.length === 1;
  const sharedEmailIdentity = emailDomains.length > 1 && uniqueEmails.length === 1;
  const sharedContactIdentity = sharedWebsiteIdentity || sharedEmailIdentity;
  const sharedBrandIdentity = pairHasSharedBrandToken(scanResults);
  const strongIdentityScans = fieldsList.filter((fields) => {
    const company = isReadableOcrText(fields.company);
    const name = isReadableOcrText(fields.name);
    const phone = isReadableOcrText(fields.phone);
    const email = isReadableOcrText(fields.email);
    const website = isReadableOcrText(fields.website);
    return website || email || (company && phone) || (company && name && (phone || email));
  });

  const identityMismatch =
    !sharedContactIdentity && !sharedBrandIdentity && strongIdentityScans.length > 1 && (
      uniqueCompanies.length > 1 &&
      !companyValues.every((value, index) =>
        companyValues.every((other, otherIndex) => index === otherIndex || companiesCompatible(value, other))
      )
    ) ||
    (!sharedContactIdentity && !sharedBrandIdentity && strongIdentityScans.length > 1 && uniqueCompanies.length === 0 && uniqueWebsites.length > 1) ||
    (!sharedContactIdentity && !sharedBrandIdentity && strongIdentityScans.length > 1 && uniqueCompanies.length === 0 && uniqueWebsites.length === 0 && uniqueEmails.length > 1);

  if (identityMismatch) {
    return {
      fields: {},
      warning: buildCardMismatchWarning(),
    };
  }

  const hasIdentity = hasOcrIdentity(merged);
  const hasContact = hasOcrStrongContact(merged);
  const hasUsefulData = hasOcrUsefulData(merged);

  if (hasIdentity && hasContact) {
    return { fields: merged, warning: "" };
  }

  if (!hasUsefulData) {
    return {
      fields: {},
      warning: "Can't extract data. Image not clear.",
    };
  }

  return {
    fields: merged,
    warning: "Not sufficient details to extract. Please upload a card with a readable name or company and a phone or email.",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ImageCropper – pure HTML5 Canvas, zero external libs
// ─────────────────────────────────────────────────────────────────────────────
const CURSOR_MAP = {
  nw: "nw-resize", ne: "ne-resize", sw: "sw-resize", se: "se-resize",
  n:  "n-resize",  s:  "s-resize",  w:  "w-resize",  e:  "e-resize",
  move: "move",
};

function getHandles(x, y, w, h) {
  return [
    { name: "nw", hx: x,         hy: y         },
    { name: "ne", hx: x + w,     hy: y         },
    { name: "sw", hx: x,         hy: y + h     },
    { name: "se", hx: x + w,     hy: y + h     },
    { name: "n",  hx: x + w / 2, hy: y         },
    { name: "s",  hx: x + w / 2, hy: y + h     },
    { name: "w",  hx: x,         hy: y + h / 2 },
    { name: "e",  hx: x + w,     hy: y + h / 2 },
  ];
}

function hitTest(mx, my, crop) {
  if (!crop) return null;
  const { x, y, w, h } = crop;
  for (const { name, hx, hy } of getHandles(x, y, w, h)) {
    if (Math.abs(mx - hx) <= HANDLE_HALF + 3 && Math.abs(my - hy) <= HANDLE_HALF + 3) return name;
  }
  if (mx > x && mx < x + w && my > y && my < y + h) return "move";
  return null;
}

function clamp(crop, s) {
  const ix = s.offsetX, iy = s.offsetY;
  const iw = s.img.width * s.scale, ih = s.img.height * s.scale;
  const MIN = 20;
  let { x, y, w, h } = crop;
  w = Math.max(MIN, Math.min(w, iw - (x - ix)));
  h = Math.max(MIN, Math.min(h, ih - (y - iy)));
  x = Math.max(ix, Math.min(x, ix + iw - MIN));
  y = Math.max(iy, Math.min(y, iy + ih - MIN));
  return { x, y, w, h };
}

function ImageCropper({ imgSrc, fileName, onDone, onCancel }) {
  const canvasRef = useRef(null);
  const imgEl     = useRef(new Image());
  const st        = useRef({ img: null, scale: 1, offsetX: 0, offsetY: 0, crop: null, dragging: false, resizing: null, dragStart: null });
  const [ready, setReady]       = useState(false);
  const [info,  setInfo]        = useState(null);   // { w, h } in original px

  // ── Draw ──────────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const { img, scale, offsetX: ox, offsetY: oy, crop } = st.current;
    if (!img) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Dark background
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Dimmed full image
    ctx.globalAlpha = 0.28;
    ctx.drawImage(img, ox, oy, img.width * scale, img.height * scale);
    ctx.globalAlpha = 1;

    if (!crop) {
      ctx.globalAlpha = 1;
      ctx.drawImage(img, ox, oy, img.width * scale, img.height * scale);
      return;
    }

    const { x, y, w, h } = crop;

    // Bright crop area
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.globalAlpha = 1;
    ctx.drawImage(img, ox, oy, img.width * scale, img.height * scale);
    ctx.restore();

    // Crop border
    ctx.strokeStyle = "#818cf8";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);

    // Rule-of-thirds grid
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.lineWidth = 0.7;
    for (let i = 1; i <= 2; i++) {
      ctx.beginPath(); ctx.moveTo(x + (w / 3) * i, y); ctx.lineTo(x + (w / 3) * i, y + h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, y + (h / 3) * i); ctx.lineTo(x + w, y + (h / 3) * i); ctx.stroke();
    }

    // Resize handles
    getHandles(x, y, w, h).forEach(({ hx, hy }) => {
      ctx.fillStyle = "#fff";
      ctx.fillRect(hx - HANDLE_HALF, hy - HANDLE_HALF, HANDLE_HALF * 2, HANDLE_HALF * 2);
      ctx.strokeStyle = "#6366f1";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(hx - HANDLE_HALF, hy - HANDLE_HALF, HANDLE_HALF * 2, HANDLE_HALF * 2);
    });
  }, []);

  const refreshInfo = () => {
    const s = st.current;
    if (!s.crop || !s.img) return;
    setInfo({ w: Math.round(s.crop.w / s.scale), h: Math.round(s.crop.h / s.scale) });
  };

  // ── Load image ────────────────────────────────────────────────────────────
  useEffect(() => {
    const img = imgEl.current;
    img.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const scale = Math.min(canvas.width / img.width, canvas.height / img.height, 1);
      const dw = img.width * scale, dh = img.height * scale;
      const ox = (canvas.width  - dw) / 2;
      const oy = (canvas.height - dh) / 2;
      Object.assign(st.current, { img, scale, offsetX: ox, offsetY: oy, crop: { x: ox, y: oy, w: dw, h: dh } });
      draw(); refreshInfo(); setReady(true);
    };
    img.src = imgSrc;
  }, [imgSrc, draw]);

  // ── Pointer helpers ───────────────────────────────────────────────────────
  function xy(e) {
    const r = canvasRef.current.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    return { mx: src.clientX - r.left, my: src.clientY - r.top };
  }

  const onDown = (e) => {
    e.preventDefault();
    const { mx, my } = xy(e);
    const s = st.current;
    const hit = hitTest(mx, my, s.crop);
    s.dragging = true;
    if (hit) {
      s.resizing  = hit;
      s.dragStart = { mx, my, crop: { ...s.crop } };
    } else {
      s.resizing  = "new";
      s.dragStart = { mx, my };
      s.crop      = null;
    }
  };

  const onMove = (e) => {
    e.preventDefault();
    const { mx, my } = xy(e);
    const s = st.current;
    if (!s.dragging) {
      const hit = hitTest(mx, my, s.crop);
      if (canvasRef.current) canvasRef.current.style.cursor = hit ? (CURSOR_MAP[hit] || "crosshair") : "crosshair";
      return;
    }
    const dx = mx - s.dragStart.mx, dy = my - s.dragStart.my;
    if (s.resizing === "new") {
      s.crop = clamp({ x: Math.min(mx, s.dragStart.mx), y: Math.min(my, s.dragStart.my), w: Math.abs(dx), h: Math.abs(dy) }, s);
    } else if (s.resizing === "move") {
      const b = s.dragStart.crop;
      s.crop = clamp({ x: b.x + dx, y: b.y + dy, w: b.w, h: b.h }, s);
    } else {
      let { x, y, w, h } = s.dragStart.crop;
      if (s.resizing.includes("e")) w += dx;
      if (s.resizing.includes("s")) h += dy;
      if (s.resizing.includes("w")) { x += dx; w -= dx; }
      if (s.resizing.includes("n")) { y += dy; h -= dy; }
      s.crop = clamp({ x, y, w, h }, s);
    }
    draw(); refreshInfo();
  };

  const onUp = (e) => {
    e.preventDefault();
    const s = st.current;
    s.dragging = false; s.resizing = null; s.dragStart = null;
    if (s.crop && (s.crop.w < 20 || s.crop.h < 20)) {
      s.crop = { x: s.offsetX, y: s.offsetY, w: s.img.width * s.scale, h: s.img.height * s.scale };
      draw(); refreshInfo();
    }
  };

  const resetCrop = () => {
    const s = st.current;
    if (!s.img) return;
    s.crop = { x: s.offsetX, y: s.offsetY, w: s.img.width * s.scale, h: s.img.height * s.scale };
    draw(); refreshInfo();
  };

  const applyCrop = () => {
    const s = st.current;
    if (!s.crop || !s.img) return;
    const { x, y, w, h } = s.crop;
    const rx = (x - s.offsetX) / s.scale, ry = (y - s.offsetY) / s.scale;
    const rw = w / s.scale,               rh = h / s.scale;
    const out = document.createElement("canvas");
    out.width = Math.round(rw); out.height = Math.round(rh);
    out.getContext("2d").drawImage(s.img, rx, ry, rw, rh, 0, 0, out.width, out.height);
    onDone(out.toDataURL("image/jpeg", 0.92));
  };

  return (
    <div className="expense-modal-overlay">
      <div className="ocr-cropper-shell">
        <div className="ocr-cropper-header">
          <div className="ocr-bc-title-row">
            <span style={{ fontSize: 20 }}>✂️</span>
            <h3>Crop Image</h3>
            {fileName && <span className="ocr-cropper-filename">{fileName}</span>}
          </div>
          <button className="expense-close-btn ocr-bc-close" onClick={onCancel} aria-label="Back">✕</button>
        </div>

        <div className="ocr-cropper-canvas-wrap">
          <canvas
            ref={canvasRef}
            width={680}
            height={440}
            className="ocr-cropper-canvas"
            onMouseDown={onDown}
            onMouseMove={onMove}
            onMouseUp={onUp}
            onMouseLeave={onUp}
            onTouchStart={onDown}
            onTouchMove={onMove}
            onTouchEnd={onUp}
          />
          {!ready && <div className="ocr-cropper-loading">⏳ Loading image…</div>}
        </div>

        {info && (
          <div className="ocr-cropper-info">
            <span>📐 <strong>{info.w} × {info.h} px</strong></span>
            <span className="ocr-cropper-hint">Drag corners / edges to resize · drag inside to move · drag outside to reselect</span>
          </div>
        )}

        <div className="ocr-bc-footer">
          <button className="btn" type="button" onClick={onCancel}>← Back</button>
          <button className="btn ocr-reset-btn" type="button" onClick={resetCrop}>↺ Reset</button>
          <button className="expense-ai-btn" type="button" disabled={!ready} onClick={applyCrop}>
            ✅ Apply Crop
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// OcrBusinessCardModal
// ─────────────────────────────────────────────────────────────────────────────
function OcrBusinessCardModal({ isOpening = false, onClose }) {
  const [files,       setFiles]       = useState([]);  // [{ file, previewUrl, error, wasCropped }]
  const [dragOver,    setDragOver]    = useState(false);
  const [globalError, setGlobalError] = useState("");
  const [cropTarget,  setCropTarget]  = useState(null);  // { index, imgSrc }
  const fileInputRef = useRef(null);

  // Revoke blob URLs on cleanup
  useEffect(() => {
    return () => files.forEach((f) => {
      if (f.previewUrl && !f.previewUrl.startsWith("data:")) URL.revokeObjectURL(f.previewUrl);
    });
  }, [files]);

  const addFiles = (rawList) => {
    setGlobalError("");
    const combined = [...files];
    for (const raw of rawList) {
      if (combined.length >= MAX_FILES) {
        setGlobalError(`Maximum ${MAX_FILES} images allowed at a time.`);
        break;
      }
      let error = "";
      if (!ACCEPTED_MIME.includes(raw.type))  error = `"${raw.name}" is not a supported image type.`;
      else if (raw.size > MAX_FILE_SIZE_BYTES) error = `"${raw.name}" exceeds the ${MAX_FILE_SIZE_MB} MB limit.`;
      combined.push({ file: raw, previewUrl: error ? null : URL.createObjectURL(raw), error });
    }
    setFiles(combined);
  };

  const onInputChange = (e) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = "";
    if (picked.length) addFiles(picked);
  };

  const onDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    const dropped = Array.from(e.dataTransfer.files || []);
    if (dropped.length) addFiles(dropped);
  };

  const removeFile = (idx) => {
    setFiles((prev) => {
      const next = [...prev];
      const url = next[idx].previewUrl;
      if (url && !url.startsWith("data:")) URL.revokeObjectURL(url);
      next.splice(idx, 1);
      return next;
    });
    setGlobalError("");
  };

  const handleCropDone = (croppedDataUrl) => {
    setFiles((prev) => {
      const next = [...prev];
      const old = next[cropTarget.index];
      if (old.previewUrl && !old.previewUrl.startsWith("data:")) URL.revokeObjectURL(old.previewUrl);
      next[cropTarget.index] = { ...old, previewUrl: croppedDataUrl, wasCropped: true };
      return next;
    });
    setCropTarget(null);
  };

  const validFiles = files.filter((f) => !f.error);
  const hasErrors  = files.some((f) => f.error);
  const canScan    = validFiles.length > 0 && !hasErrors;

  const navigate = useNavigate();
  const [scanStatus, setScanStatus] = useState("idle");

  const toDataUrl = async (item) => {
    if (!item) return "";
    if (item.previewUrl && item.previewUrl.startsWith("data:")) return item.previewUrl;

    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Failed to prepare image preview"));
      reader.readAsDataURL(item.file);
    });
  };

  const handleScan = async () => {
    if (validFiles.length === 0) return;
    setScanStatus("scanning");
    setGlobalError("");

    try {
      const scanResults = [];

      for (const item of validFiles) {
        let blob = item.file;
        if (item.previewUrl && item.previewUrl.startsWith("data:")) {
          const res = await fetch(item.previewUrl);
          blob = await res.blob();
        }

        const formData = new FormData();
        formData.append("card", blob, item.file.name);

        const { data } = await API.post("/ocr/scan-business-card", formData, {
          headers: { "Content-Type": "multipart/form-data" },
        });

        if (!data || !data.success || !data.fields) {
          throw new Error(data?.error || "Invalid response format");
        }

        scanResults.push({
          fields: data.fields,
          lineLabels: Array.isArray(data.line_labels) ? data.line_labels : [],
          warning: data.warning || "",
        });
      }

      const merged = mergeOcrScanResults(scanResults);

      if (merged.warning && Object.keys(merged.fields || {}).length === 0) {
        setGlobalError(merged.warning);
        setScanStatus("error");
        return;
      }

      const previewForForm = await Promise.all(validFiles.map((item) => toDataUrl(item)));

      onClose();
      navigate("/leads/new", {
        state: {
          ocrData: merged.fields,
          ocrLineLabels: scanResults.flatMap((item) => item.lineLabels || []),
          ocrPreview: previewForForm[0] || "",
          ocrPreviews: previewForForm,
          ocrWarning: merged.warning || "",
        }
      });
    } catch (err) {
      console.error("OCR scan failed:", err);
      const msg = err.response?.data?.error || err.message || "OCR scan failed";
      setGlobalError(`Scan Error: ${msg}`);
      setScanStatus("error");
    } finally {
      setScanStatus((current) => (current === "error" ? current : "idle"));
    }
  };

  // Show cropper if active
  if (cropTarget) {
    return ReactDOM.createPortal(
      <ImageCropper
        imgSrc={cropTarget.imgSrc}
        fileName={files[cropTarget.index]?.file?.name}
        onDone={handleCropDone}
        onCancel={() => setCropTarget(null)}
      />,
      document.body
    );
  }

  const fullZone = files.length >= MAX_FILES;

  return (
    <div className="expense-modal-overlay" onClick={(e) => e.target === e.currentTarget && scanStatus !== "scanning" && onClose()}>
      <div className="expense-modal expense-large-modal ocr-bc-modal">
        {(isOpening || scanStatus === "scanning") && (
          <div className="ocr-bc-loading-overlay">
            <div className="ocr-bc-spinner" aria-hidden="true" />
            <strong>{isOpening ? "Opening scanner..." : "Scanning card..."}</strong>
            <span>{isOpening ? "Preparing OCR upload area" : "Reading text and predicting fields"}</span>
          </div>
        )}

        {/* ── Header ── */}
        <div className="expense-modal-header">
          <div className="ocr-bc-title-row">
            <span className="ocr-bc-icon">📇</span>
            <h3>Business Card Scanner</h3>
          </div>
          <button className="expense-close-btn ocr-bc-close" onClick={onClose} disabled={scanStatus === "scanning"} aria-label="Close">✕</button>
        </div>

        {/* ── Info bar ── */}
        <div className="ocr-bc-info-bar">
          <span>📁 Max <strong>{MAX_FILES} images</strong> for one card</span>
          <span>|</span>
          <span>📏 Max <strong>{MAX_FILE_SIZE_MB} MB</strong> per file</span>
          <span>|</span>
          <span>🖼 <strong>{ACCEPTED_EXT_LABEL}</strong></span>
        </div>

        {/* ── Drop zone ── */}
        <div
          className={`ocr-bc-dropzone${dragOver ? " ocr-bc-dropzone--active" : ""}${fullZone ? " ocr-bc-dropzone--disabled" : ""}`}
          onClick={() => !fullZone && fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); if (!fullZone) setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && !fullZone && fileInputRef.current?.click()}
          aria-label="Upload business card images"
        >
          <input ref={fileInputRef} type="file" accept={ACCEPTED_MIME.join(",")} multiple style={{ display: "none" }} onChange={onInputChange} />
          <div className="ocr-bc-dropzone-inner">
            <span className="ocr-bc-upload-icon">⬆️</span>
            <p className="ocr-bc-drop-text">
              {fullZone ? `Maximum ${MAX_FILES} images selected` : dragOver ? "Release to upload" : "Drop images here or click to browse"}
            </p>
            <p className="ocr-bc-drop-sub">
              {files.length}/{MAX_FILES} selected · use front/back of the same card · {ACCEPTED_EXT_LABEL} · Max {MAX_FILE_SIZE_MB} MB each
            </p>
          </div>
        </div>

        {/* ── Global error ── */}
        {globalError && <div className="ocr-bc-global-error">⚠️ {globalError}</div>}

        {/* ── Previews ── */}
        {files.length > 0 && (
          <div className="ocr-bc-previews">
            {files.map((item, idx) => (
              <div key={idx} className={`ocr-bc-preview-card${item.error ? " ocr-bc-preview-card--error" : ""}`}>
                {item.previewUrl
                  ? <img src={item.previewUrl} alt={`Preview ${idx + 1}`} className="ocr-bc-thumb" />
                  : <div className="ocr-bc-thumb ocr-bc-thumb--error">🚫</div>
                }
                <div className="ocr-bc-preview-info">
                  <span className="ocr-bc-file-name" title={item.file.name}>{item.file.name}</span>
                  <span className="ocr-bc-file-size">{(item.file.size / (1024 * 1024)).toFixed(2)} MB</span>
                  {item.error && <span className="ocr-bc-file-error">⚠️ {item.error}</span>}
                  {item.wasCropped && !item.error && <span className="ocr-bc-cropped-badge">✂️ Cropped</span>}
                </div>
                <div className="ocr-bc-card-actions">
                  {!item.error && item.previewUrl && (
                    <button
                      className="ocr-bc-crop-btn"
                      title="Crop this image"
                      onClick={() => setCropTarget({ index: idx, imgSrc: item.previewUrl })}
                    >
                      ✂️ Crop
                    </button>
                  )}
                  <button className="ocr-bc-remove-btn" onClick={() => removeFile(idx)} aria-label={`Remove ${item.file.name}`}>✕</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Footer ── */}
        <div className="ocr-bc-footer">
          <button className="btn" type="button" onClick={onClose} disabled={scanStatus === "scanning"}>Cancel</button>
          <button className="expense-ai-btn" type="button" disabled={!canScan || scanStatus === "scanning"} onClick={handleScan}>
            {scanStatus === "scanning"
              ? "Scanning..."
              : "🔍 Scan Card"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LeadsDashboard
// ─────────────────────────────────────────────────────────────────────────────
function LeadsDashboard({ defaultView = "leads" }) {
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState(defaultView === "deals" ? "deals" : "leads");
  const [leads, setLeads] = useState([]);
  const [deals, setDeals] = useState([]);
  const [deletedLeads, setDeletedLeads] = useState([]);
  const [loadingLeads, setLoadingLeads] = useState(true);
  const [loadingDeals, setLoadingDeals] = useState(true);
  const [loadingDeleted, setLoadingDeleted] = useState(true);
  const [showDeletedLeads, setShowDeletedLeads] = useState(false);
  const [search, setSearch] = useState("");
  const [industryFilter, setIndustryFilter] = useState("All");
  const [stageFilter, setStageFilter] = useState("All");
  const [industryCatalog, setIndustryCatalog] = useState([]);
  const [industryOptions, setIndustryOptions] = useState([]);

  const [deletedDeals, setDeletedDeals] = useState([]);
  const [loadingDeletedDeals, setLoadingDeletedDeals] = useState(true);
  const [showOcrModal, setShowOcrModal] = useState(false);
  const [openingOcrModal, setOpeningOcrModal] = useState(false);
  const [isImportingCsv, setIsImportingCsv] = useState(false);
  const csvInputRef = useRef(null);

  // Tabs: "active", "inactive", "deleted"
  const [activeTab, setActiveTab] = useState("active");

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  useEffect(() => {
    setViewMode(defaultView === "deals" ? "deals" : "leads");
    setActiveTab("active");
    setCurrentPage(1);
  }, [defaultView]);

  const loadDashboardData = useCallback(async () => {
    const [
      leadsRes,
      dealsRes,
      deletedRes,
      deletedDealsRes,
      industriesRes,
    ] = await Promise.allSettled([
      API.get("/leads", { params: { include_converted: true } }),
      API.get("/deals"),
      API.get("/leads", { params: { deleted_only: true, include_converted: true } }),
      API.get("/deals", { params: { deleted_only: true } }),
      API.get("/industries", { params: { status: "all" } }),
    ]);

    if (leadsRes.status === "fulfilled")
      setLeads(Array.isArray(leadsRes.value.data) ? leadsRes.value.data : []);

    if (dealsRes.status === "fulfilled")
      setDeals(Array.isArray(dealsRes.value.data) ? dealsRes.value.data : []);

    if (deletedRes.status === "fulfilled")
      setDeletedLeads(Array.isArray(deletedRes.value.data) ? deletedRes.value.data : []);

    if (deletedDealsRes.status === "fulfilled")
      setDeletedDeals(
        Array.isArray(deletedDealsRes.value.data)
          ? deletedDealsRes.value.data.filter(d => d.deleted === true || d.is_deleted === true)
          : []
      );

    if (industriesRes.status === "fulfilled") {
      const catalog = Array.isArray(industriesRes.value.data) ? industriesRes.value.data : [];
      setIndustryCatalog(catalog);
      setIndustryOptions(
        catalog
          .map((item) => item?.name)
          .filter(Boolean)
      );
    }

    setLoadingLeads(false);
    setLoadingDeals(false);
    setLoadingDeleted(false);
    setLoadingDeletedDeals(false);
  }, []);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  const industryNameMap = useMemo(() => {
    const map = new Map();
    const nameMap = new Map();
    industryCatalog.forEach((item) => {
      const id = String(item?._id || "").trim();
      const name = String(item?.name || "").trim();
      if (id && name) {
        map.set(id, name);
        nameMap.set(name.toLowerCase(), name);
      }
    });
    return { byId: map, byName: nameMap };
  }, [industryCatalog]);

  const resolveIndustryLabel = useCallback((value) => {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    const resolved = industryNameMap.byId.get(raw);
    if (resolved) return resolved;
    const matchedByName = industryNameMap.byName.get(raw.toLowerCase());
    if (matchedByName) return matchedByName;
    return looksLikeMongoObjectId(raw) ? "" : raw;
  }, [industryNameMap]);

  const normalizeHeader = (value) =>
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

  const parseCsv = (text) => {
    const rows = [];
    let current = "";
    let row = [];
    let inQuotes = false;

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      const next = text[i + 1];

      if (char === "\"") {
        if (inQuotes && next === "\"") {
          current += "\"";
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (char === "," && !inQuotes) {
        row.push(current);
        current = "";
        continue;
      }

      if ((char === "\n" || char === "\r") && !inQuotes) {
        if (char === "\r" && next === "\n") i += 1;
        row.push(current);
        rows.push(row);
        row = [];
        current = "";
        continue;
      }

      current += char;
    }

    if (current.length > 0 || row.length > 0) {
      row.push(current);
      rows.push(row);
    }

    return rows;
  };

  const parseNumber = (value) => {
    const cleaned = String(value ?? "").replace(/[^0-9.-]/g, "");
    if (!cleaned) return undefined;
    const numberValue = Number(cleaned);
    return Number.isNaN(numberValue) ? undefined : numberValue;
  };

  const parseBoolean = (value, fallback = undefined) => {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(normalized)) return true;
    if (["false", "0", "no", "n"].includes(normalized)) return false;
    return fallback;
  };

  const firstFilled = (source, keys) => {
    for (const key of keys) {
      const value = source[key];
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        return String(value).trim();
      }
    }
    return "";
  };

  const normalizeObjectId = (value) => {
    const raw = String(value ?? "").trim();
    return /^[a-f0-9]{24}$/i.test(raw) ? raw : undefined;
  };

  const normalizeStatus = (value) => {
    const raw = String(value ?? "").trim().toLowerCase();
    if (!raw) return undefined;

    const mapped = {
      new: "new",
      contacted: "contacted",
      contact: "contacted",
      qualified: "qualified",
      qualify: "qualified",
      converted: "converted",
      convert: "converted",
      rejected: "rejected",
      reject: "rejected",
    };

    return mapped[raw] || undefined;
  };

  const mapCsvRowToLeadPayload = (row) => {
    const companyName = firstFilled(row, [
      "company_name",
      "company",
      "companyname",
      "organization",
      "organisation",
      "business_name",
      "account_name",
    ]);
    const contactName = firstFilled(row, [
      "contact_name",
      "contact_person",
      "person_name",
      "name",
      "full_name",
      "primary_contact",
    ]);
    const contactPhone = firstFilled(row, [
      "contact_phone",
      "phone",
      "mobile",
      "contact_mobile",
      "contact_number",
      "phone_number",
      "mobile_number",
    ]);
    const contactEmail = firstFilled(row, [
      "contact_email",
      "email",
      "contact_mail",
      "mail",
      "email_id",
    ]);
    const contactDesignation = firstFilled(row, [
      "contact_designation",
      "designation",
      "title",
      "job_title",
      "role",
    ]);
    const contactLinkedin = firstFilled(row, [
      "contact_linkedin",
      "linkedin",
      "linkedin_url",
      "linked_in",
    ]);
    const contactAddress = firstFilled(row, [
      "contact_address",
      "address",
      "contact_location",
    ]);

    const payload = {
      company_name: companyName,
      industry: firstFilled(row, ["industry", "sector", "business_industry"]),
      employee_count: parseNumber(firstFilled(row, ["employee_count", "employees", "employee", "team_size"])),
      turnover_range: firstFilled(row, ["turnover_range", "turnover", "revenue_range"]),
      Address: firstFilled(row, ["address", "company_address", "office_address", "location"]),
      website: firstFilled(row, ["website", "url", "website_url", "company_website"]),
      source: normalizeObjectId(firstFilled(row, ["source_id", "source", "lead_source"])),
      deal_value_estimate: parseNumber(
        firstFilled(row, ["deal_value_estimate", "deal_value", "value", "amount", "deal_amount", "estimated_value"])
      ),
      assigned_to: normalizeObjectId(
        firstFilled(row, ["assigned_to", "owner", "user_id", "assignee", "lead_owner"])
      ),
      stage: firstFilled(row, ["stage", "pipeline_stage"]) || "P3",
      country: firstFilled(row, ["country", "nation"]),
      State: firstFilled(row, ["state", "province", "region"]),
      city: firstFilled(row, ["city", "town"]),
      is_active: parseBoolean(firstFilled(row, ["is_active", "active", "enabled"]), undefined),
    };

    const hasContact = contactName || contactPhone || contactEmail || contactDesignation || contactLinkedin;
    if (hasContact) {
      payload.contacts = [
        {
          name: contactName,
          phone: contactPhone,
          email: contactEmail,
          designation: contactDesignation,
          linkedin: contactLinkedin,
          address: contactAddress,
          is_primary: true,
        },
      ];
    }

    Object.keys(payload).forEach((key) => {
      if (payload[key] === undefined || payload[key] === "") {
        delete payload[key];
      }
    });

    if (Object.keys(payload).length === 0) return null;

    return payload;
  };

  const handleImportCsvClick = () => {
    if (isImportingCsv) return;
    csvInputRef.current?.click();
  };

  const handleCsvFileChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      setIsImportingCsv(true);
      const text = await file.text();
      const rawRows = parseCsv(text).filter((cells) =>
        cells.some((cell) => String(cell || "").trim() !== "")
      );

      if (rawRows.length < 2) {
        alert("CSV must include a header row and at least one data row.");
        return;
      }

      const headers = rawRows[0].map(normalizeHeader);
      const payloads = rawRows
        .slice(1)
        .map((cells) => {
          const rowObject = {};
          headers.forEach((header, index) => {
            rowObject[header] = cells[index] ?? "";
          });
          return mapCsvRowToLeadPayload(rowObject);
        })
        .filter(Boolean);

      if (!payloads.length) {
        alert("No valid rows found. Please include company or contact fields.");
        return;
      }

      let successCount = 0;
      let failedCount = 0;
      const failedRows = [];

      for (const [index, payload] of payloads.entries()) {
        const csvRowNumber = index + 2;
        try {
          await API.post("/leads", payload);
          successCount += 1;
        } catch (err) {
          failedCount += 1;
          const responseData = err?.response?.data;
          const reason =
            responseData?.message ||
            responseData?.error ||
            (typeof responseData === "string" ? responseData : "") ||
            err?.message ||
            "Unknown error";
          failedRows.push({ row: csvRowNumber, reason });
          console.error(
            `CSV row ${csvRowNumber} import failed: ${reason}`,
            { payload, responseData }
          );
        }
      }

      await loadDashboardData();
      if (failedRows.length) {
        const summary = failedRows
          .slice(0, 5)
          .map((item) => `Row ${item.row}: ${item.reason}`)
          .join("\n");
        const more = failedRows.length > 5 ? `\n...and ${failedRows.length - 5} more` : "";
        alert(
          `CSV import complete. Success: ${successCount}, Failed: ${failedCount}\n\n${summary}${more}`
        );
      } else {
        alert(`CSV import complete. Success: ${successCount}, Failed: ${failedCount}`);
      }
    } catch (err) {
      console.error("CSV import failed", err);
      alert("Failed to import CSV.");
    } finally {
      setIsImportingCsv(false);
    }
  };

  const formatCurrency = (value) => {
    const amount = Number(value);
    if (Number.isNaN(amount)) return "-";
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatDate = (value) => {
    if (!value) return "-";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "-";
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  };

  const loading = viewMode === "deals" ? loadingDeals : loadingLeads;
  const isRowActive = (row, mode = viewMode) => {
    if (!row) return true;
    if (row.is_active === false || row.isActive === false) return false;
    if (mode === "deals") {
      const stage = String(row.stage || "").toUpperCase();
      if (stage === "P7" || stage === "P6") return false;
    }
    if (mode === "leads") {
      const stage = String(row.stage || "").toUpperCase();
      if (stage === "P4" || stage === "P6" || stage === "P7") return false;
    }
    return true;
  };

  const tabCounts = useMemo(() => {
    let active = 0, inactive = 0, deleted = 0;
    if (viewMode === "deals") {
      active = deals.filter((d) => isRowActive(d, "deals")).length;
      inactive = deals.filter((d) => !isRowActive(d, "deals")).length;
      deleted = deletedDeals.length;
    } else {
      active = leads.filter((l) => isRowActive(l)).length;
      inactive = leads.filter((l) => !isRowActive(l)).length;
      deleted = deletedLeads.length;
    }
    return { active, inactive, deleted };
  }, [viewMode, deals, leads, deletedDeals, deletedLeads]);

  // Decide which source array to use based on viewMode AND activeTab
  const sourceRows = useMemo(() => {
    if (viewMode === "deals") {
      if (activeTab === "deleted") return deletedDeals;
      return deals.filter((d) => (activeTab === "active" ? isRowActive(d, "deals") : !isRowActive(d, "deals")));
    } else {
      if (activeTab === "deleted") return deletedLeads;
      return leads.filter((l) => (activeTab === "active" ? isRowActive(l) : !isRowActive(l)));
    }
  }, [viewMode, activeTab, deals, deletedDeals, leads, deletedLeads]);
  const industries = useMemo(() => {
    const fromRows = sourceRows.map((r) => resolveIndustryLabel(r.industry)).filter(Boolean);
    const base = industryOptions.length ? [...industryOptions, ...fromRows] : fromRows;
    const seen = new Set();
    const unique = [];
    for (const item of base) {
      const key = String(item || "").trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      unique.push(item);
    }
    return ["All", ...unique];
  }, [sourceRows, industryOptions, resolveIndustryLabel]);

  const filteredRows = useMemo(() => {
    return sourceRows.filter((row) => {
      const q = search.trim().toLowerCase();
      const company = (row.company_name || "").toLowerCase();
      const contact = (row.primary_contact?.name || "").toLowerCase();
      const industry = resolveIndustryLabel(row.industry).toLowerCase();
      const valueText = String(row.deal_value_estimate ?? "").toLowerCase();
      const formattedValue = formatCurrency(row.deal_value_estimate).toLowerCase();
      const lastContactText = String(row.last_contact_date || "").toLowerCase();
      const formattedLastContact = formatDate(row.last_contact_date).toLowerCase();
      const nextAction = (row.next_action || "").toLowerCase();

      const matchesSearch =
        !q ||
        company.includes(q) ||
        contact.includes(q) ||
        industry.includes(q) ||
        valueText.includes(q) ||
        formattedValue.includes(q) ||
        lastContactText.includes(q) ||
        formattedLastContact.includes(q) ||
        nextAction.includes(q);
      const matchesIndustry = industryFilter === "All" || resolveIndustryLabel(row.industry) === industryFilter;
      const matchesStage = stageFilter === "All" || row.stage === stageFilter;
      return matchesSearch && matchesIndustry && (viewMode === "deals" ? matchesStage : true);
    });
  }, [sourceRows, search, industryFilter, stageFilter, viewMode, resolveIndustryLabel]);

  // Reset pagination when data or filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [filteredRows.length, activeTab, viewMode]);

  // Pagination calculation
  const totalPages = Math.ceil(filteredRows.length / itemsPerPage);
  const paginatedRows = filteredRows.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const handlePageChange = (page) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  const roleName = String(localStorage.getItem("RoleName") || "").toLowerCase();
  const isAdmin = roleName === "admin";
  const isAdminOrManager = roleName === "admin" || roleName === "manager";

  const openOcrModal = () => {
    setOpeningOcrModal(true);
    setShowOcrModal(true);
    window.setTimeout(() => setOpeningOcrModal(false), 350);
  };

  return (
    <div className="leads-container">
      {viewMode === "leads" && (
        <div className="top-actions">
          <button className="btn" type="button" onClick={openOcrModal} disabled={openingOcrModal}>
            <span className="action-icon">📇</span>
            {openingOcrModal ? "Opening Scanner..." : "Scan Business Card"}
            <span className="ocr-tag">OCR</span>
          </button>
          <button className="btn" type="button" onClick={() => navigate("/leads/new")}>
            <span className="action-icon">➕</span>
            Add Lead Manually
          </button>
          <button
            className="btn"
            type="button"
            onClick={handleImportCsvClick}
            disabled={isImportingCsv}
          >
            <span className="action-icon">📥</span>
            {isImportingCsv ? "Importing CSV..." : "Import CSV"}
          </button>
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleCsvFileChange}
            style={{ display: "none" }}
          />
        </div>
      )}

      <div className="leads-header">
        <div className="status-tabs">
          <button
            className={`tab-btn ${activeTab === "active" ? "active" : ""}`}
            onClick={() => setActiveTab("active")}
          >
            Active ({tabCounts.active})
          </button>
          <button
            className={`tab-btn ${activeTab === "inactive" ? "active" : ""}`}
            onClick={() => setActiveTab("inactive")}
          >
            Inactive ({tabCounts.inactive})
          </button>
          {isAdminOrManager && (
            <button
              className={`tab-btn ${activeTab === "deleted" ? "active" : ""}`}
              onClick={() => setActiveTab("deleted")}
            >
              Deleted ({tabCounts.deleted})
            </button>
          )}
        </div>

        <div className="filters">
          <input
            type="text"
            placeholder={viewMode === "deals" ? "Search deals..." : "Search leads..."}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />


          {viewMode === "deals" ? (
            <select
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value)}
            >
              <option value="All">All Stages</option>
              {ALL_STAGE_OPTIONS.map((stage) => (
                <option key={stage.key} value={stage.key}>{stage.title}</option>
              ))}
            </select>
          ) : null}

          <select
            value={industryFilter}
            onChange={(e) => setIndustryFilter(e.target.value)}
          >
            {industries.map((industry) => (
              <option key={industry} value={industry}>
                {industry === "All" ? "All Industries" : industry}
              </option>
            ))}
          </select>

          {viewMode === "deals" && (
            <button
              className="btn add-deal-btn"
              type="button"
              onClick={() => navigate("/leads/new?view=deal")}
            >
              ➕ Add Deal
            </button>
          )}
        </div>
      </div>

      <div className="table-wrapper">
        <table className="crm-responsive-table">
          <thead>
            <tr>
              <th>Company</th>
              {viewMode === "deals" && <th className="col-contact">Contact</th>}
              <th>Industry</th>
              <th>Value</th>
              {viewMode === "leads" && <th>Stage</th>}
              {viewMode === "deals" && <th>Stage</th>}
              <th className="col-last-contact">Last Contact</th>
              {!(viewMode === "deals" && activeTab === "inactive") && <th>Next Action</th>}
              {viewMode === "deals" && activeTab === "inactive" && <th>Stage</th>}
              {activeTab === "deleted" && <th>Delete Reason</th>}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr className="crm-table-status-row"><td colSpan={viewMode === "deals" ? (activeTab === "deleted" ? 9 : 8) : (activeTab === "deleted" ? 8 : 7)}>{viewMode === "deals" ? "Loading deals..." : "Loading leads..."}</td></tr>}
            {!loading && paginatedRows.length === 0 && <tr className="crm-table-status-row"><td colSpan={viewMode === "deals" ? (activeTab === "deleted" ? 9 : 8) : (activeTab === "deleted" ? 8 : 7)}>{viewMode === "deals" ? "No deals found" : "No leads found"}</td></tr>}
            {!loading && paginatedRows.map((row) => {
              const industryLabel = resolveIndustryLabel(row.industry);
              return (
                <tr key={row._id}>
                  <td
                    className="company-cell"
                    data-label="Company"
                    title={viewMode === "deals" ? (row.deal_name || row.company_name || "-") : (row.deal_name || row.company_name || "-")}
                  >
                    {viewMode === "deals" ? (row.deal_name || row.company_name || "-") : (row.deal_name || row.company_name || "-")}
                  </td>
                  {viewMode === "deals" && (
                    <td className="deal-contact-cell" data-label="Contact">
                      <div className="contact-name">{row.primary_contact?.name || "-"}</div>
                      <small className="contact-subtext">{row.primary_contact?.email || row.primary_contact?.phone || "-"}</small>
                    </td>
                  )}
                  <td data-label="Industry">{industryLabel || "-"}</td>
                  <td data-label="Value">{formatCurrency(row.deal_value_estimate)}</td>
                  {viewMode === "leads" && (
                    <td data-label="Stage">
                      <span className="stage-chip">
                        {row.stage || "-"}
                      </span>
                    </td>
                  )}

                  {viewMode === "deals" && (
                    <td data-label="Stage">
                      <span className="stage-chip">
                        {row.stage || "-"}
                      </span>
                    </td>
                  )}
                  <td className="last-contact-cell" data-label="Last Contact">{formatDate(row.last_contact_date)}</td>
                  {!(viewMode === "deals" && activeTab === "inactive") && <td data-label="Next Action">{row.next_action || "-"}</td>}
                  {viewMode === "deals" && activeTab === "inactive" && (
                    <td data-label="Stage">
                      <span className="stage-chip">
                        {row.stage || "-"}
                      </span>
                    </td>
                  )}
                  {activeTab === "deleted" && (
                    <td data-label="Delete Reason">
                      <span className="delete-reason">
                        {row.delete_reason || row.deleted_reason || "No reason provided"}
                      </span>
                    </td>
                  )}
                  <td data-label="Actions">
                    <div className="row-actions">
                      <button
                        className="view-btn"
                        onClick={() => {
                          if (viewMode === "deals") {
                            const dealId = String(row._id || row.deal_id || "").trim();
                            if (!dealId) return;
                            navigate(`/leads/${dealId}?view=deal&dealId=${dealId}${activeTab === 'deleted' ? '&deleted=true' : ''}`);
                            return;
                          }
                          const leadId = row._id || row.lead_id;
                          if (!leadId) return;
                          navigate(`/leads/${leadId}${activeTab === 'deleted' ? '?deleted=true' : ''}`);
                        }}
                      >
                        View More
                      </button>

                      {activeTab === "inactive" && (
                        <button
                          className="view-btn quote-btn"
                          style={{ backgroundColor: '#28a745' }}
                          onClick={async () => {
                            try {
                              const endpoint = viewMode === "deals" ? `/deals/${row._id}` : `/leads/${row._id}`;
                              await API.put(endpoint, { isActive: true, is_active: true });
                              await loadDashboardData();
                            } catch (err) {
                              console.error("Failed to reactivate:", err);
                              alert("Failed to reactivate record.");
                            }
                          }}
                        >
                          Activate
                        </button>
                      )}

                      {viewMode === "deals" && activeTab === "active" && !isAdmin && (
                        <button
                          className="view-btn quote-btn"
                          disabled={!row._id || row.isActive === false}
                          onClick={() => {
                            if (!row._id) return;
                            navigate(`/quotations/new?dealId=${row._id}`);
                          }}
                        >
                          Create Quote
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!loading && totalPages > 1 && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          handlePageChange={handlePageChange}
        />
      )}

      {
        showOcrModal &&
        ReactDOM.createPortal(
          <OcrBusinessCardModal
            isOpening={openingOcrModal}
            onClose={() => {
              setOpeningOcrModal(false);
              setShowOcrModal(false);
            }}
          />,
          document.body
        )
      }
    </div >
  );
}

export default LeadsDashboard;
