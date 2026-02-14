const HIGHLIGHTS = document.getElementById("highlights");
const MONTH_TITLE = document.getElementById("monthTitle");

let allEvents = [];
let calendar;

// Precomputed F1 groups (Grand Prix weekends + Testing blocks)
let f1Groups = [];

function toDate(d) { return new Date(d); }

function startOfDay(dt){
  const d = new Date(dt);
  d.setHours(0,0,0,0);
  return d;
}

function yyyymm(d){
  return `${d.getFullYear()}-${d.getMonth()}`; // month is 0-based
}

function normalizeKey(s){
  return (s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // strip accents
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function formatRange(start, end) {
  const s = new Date(start);
  const e = new Date(end);

  const sameMonth = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear();
  const opts = { month: "short", day: "numeric" };
  const optsY = { year: "numeric" };

  const sTxt = s.toLocaleDateString(undefined, opts);
  const eTxt = e.toLocaleDateString(undefined, opts);
  const yearTxt = s.toLocaleDateString(undefined, optsY);

  if (s.toDateString() === e.toDateString()) return `${sTxt}, ${yearTxt}`;
  if (sameMonth) return `${sTxt}–${e.getDate()}, ${yearTxt}`;
  return `${sTxt} – ${eTxt}, ${yearTxt}`;
}

// ---------------- F1 name extraction ----------------

function stripSessionSuffix(t){
  return t.replace(
    /\s*-\s*(Practice\s*\d+|Free\s*Practice\s*\d+|FP\s*\d+|Qualifying|Sprint\s*Race|Sprint\s*Qualifying|Sprint|Race)\s*$/i,
    ""
  );
}

function cleanF1Prefix(t){
  // Remove leading "Formula 1" regardless of case and extra spaces
  return t.replace(/^\s*formula\s*1\s+/i, "").trim();
}

function titleCaseSmart(phrase){
  return phrase
    .split(" ")
    .filter(Boolean)
    .map(w => {
      if (w.length <= 3 && w === w.toUpperCase()) return w; // keep short acronyms
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

function extractF1BlockName(raw){
  if (!raw) return null;
  let t = raw.replace(/\s+/g, " ").trim();

  // Ignore subscription/system events
  if (/in your calendar/i.test(t)) return null;

  // Remove session suffix + year + emoji clutter
  t = stripSessionSuffix(t);
  t = t.replace(/\b20\d{2}\b/g, "").trim();
  t = t.replace(/[🏁🏎️🔥📅]/g, "").trim();

  // Normalize punctuation for matching
  let norm = normalizeKey(
    t.replace(/[’']/g, "'")
     .replace(/[|–—,:;()]/g, " ")
     .replace(/\s+/g, " ")
  );

  // Remove "formula 1" from normalized scan text
  norm = norm.replace(/\bformula\s*1\b/g, " ").replace(/\s+/g, " ").trim();

  // 1) Testing blocks
  if (/pre[- ]?season.*testing|testing/.test(norm)) return "Testing";

  // 2) Hard canonical map (fixes sponsor/language drift from May onward)
  const GP_MAP = [
    { re: /\baustralia|australian|melbourne\b/, name: "Australian Grand Prix" },
    { re: /\bchina|chinese|shanghai\b/, name: "Chinese Grand Prix" },
    { re: /\bjapan|japanese|suzuka\b/, name: "Japanese Grand Prix" },
    { re: /\bbahrain|sakhir\b/, name: "Bahrain Grand Prix" },
    { re: /\bsaudi\b|jeddah/, name: "Saudi Arabian Grand Prix" },
    { re: /\bmiami\b/, name: "Miami Grand Prix" },
    { re: /\bemilia\b|\bromagna\b|imola|made in italy/, name: "Emilia Romagna Grand Prix" },
    { re: /\bmonaco\b|monte carlo/, name: "Monaco Grand Prix" },
    { re: /\bcanada|canadian|montreal|gilles villeneuve\b/, name: "Canadian Grand Prix" },
    { re: /\bspain|spanish|barcelona|catalunya\b/, name: "Spanish Grand Prix" },
    { re: /\baustria|austrian|spielberg|red bull ring\b/, name: "Austrian Grand Prix" },
    { re: /\bgreat britain|british|silverstone\b/, name: "British Grand Prix" },
    { re: /\bbelgium|belgian|spa[- ]francorchamps|spa francorchamps\b/, name: "Belgian Grand Prix" },
    { re: /\bhungary|hungarian|hungaroring\b/, name: "Hungarian Grand Prix" },
    { re: /\bnetherlands|dutch|zandvoort\b/, name: "Dutch Grand Prix" },
    { re: /\bitaly|italian|monza\b/, name: "Italian Grand Prix" },
    { re: /\bazerbaijan|baku\b/, name: "Azerbaijan Grand Prix" },
    { re: /\bsingapore|marina bay\b/, name: "Singapore Grand Prix" },
    { re: /\busa|united states|austin|cota\b/, name: "United States Grand Prix" },
    { re: /\bmexico|mexican|mexico city|hermanos rodriguez\b/, name: "Mexico City Grand Prix" },
    { re: /\bbrazil|brazilian|sao paulo|interlagos\b/, name: "São Paulo Grand Prix" },
    { re: /\blas vegas\b/, name: "Las Vegas Grand Prix" },
    { re: /\bqatar|lusail\b/, name: "Qatar Grand Prix" },
    { re: /\babu dhabi|yas marina\b/, name: "Abu Dhabi Grand Prix" }
  ];

  for (const row of GP_MAP) {
    if (row.re.test(norm)) return row.name;
  }

  // 3) Fallback parser for unseen titles
  let s = cleanF1Prefix(t);
  s = s.replace(/\bformula\s*1\b/ig, " ").replace(/\s+/g, " ").trim();

  const m = s.match(/(.+?)\s+(grand\s+prix|gran\s+premio|grande\s+premio|grand\s+prix\s+de)\b/i);
  if (!m) return null;

  let location = m[1]
    .replace(/[|–—,:;()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const DROP = new Set([
    "qatar","airways","heineken","aramco","rolex","pirelli","lenovo","aws",
    "crypto","cryptocom","crypto.com","dhl","stc","gulf","tag","moet","moët",
    "de","del","della","dell","dell'","e","in","the","and","of"
  ]);

  const words = location
    .split(" ")
    .filter(Boolean)
    .filter(w => !DROP.has(normalizeKey(w)));

  if (!words.length) return "Grand Prix";

  const keep = Math.min(3, Math.max(1, words.length));
  const loc = words.slice(-keep).join(" ");

  return `${titleCaseSmart(loc)} Grand Prix`;
}

// ---------------- Grouping ----------------

function getSessionKind(title){
  const t = (title || "").toLowerCase();
  if (t.includes("sprint qualifying")) return "sprint qualifying";
  if (t.includes("sprint race")) return "sprint race";
  if (t.includes("sprint")) return "sprint";
  if (t.includes("qualifying")) return "qualifying";
  if (/\brace\b/.test(t)) return "race";
  if (t.includes("practice") || t.includes("fp")) return "practice";
  return "other";
}

function buildF1Groups(events){
  const map = new Map();

  for (const e of events) {
    if ((e.sport || "").toUpperCase() !== "F1") continue;

    const name = extractF1BlockName(e.title);
    if (!name) continue;

    const day = startOfDay(toDate(e.start));
    const monthBucket = `${day.getFullYear()}-${day.getMonth()}`;
    const key = `${monthBucket}||${normalizeKey(name)}`;

    const g = map.get(key) || {
      sport: "F1",
      title: name,
      items: [],
      dateSet: new Set(),
      dedupeSet: new Set(), // day + session kind
      start: day,
      end: day,
      primaryMonth: monthBucket,
      _hasRace: false,
      _hasQuali: false,
      _hasSprint: false,
    };

    const sessionKind = getSessionKind(e.title);
    const dedupeKey = `${day.toISOString().slice(0,10)}||${sessionKind}`;

    // Deduplicate repeated feed entries for same day/session
    if (!g.dedupeSet.has(dedupeKey)) {
      g.dedupeSet.add(dedupeKey);
      g.items.push(e);
      g.dateSet.add(day.toISOString().slice(0,10));

      if (day < g.start) g.start = day;
      if (day > g.end) g.end = day;
    }

    if (sessionKind === "race") g._hasRace = true;
    if (sessionKind === "qualifying" || sessionKind === "sprint qualifying") g._hasQuali = true;
    if (sessionKind.includes("sprint")) g._hasSprint = true;

    map.set(key, g);
  }

  const groups = Array.from(map.values());

  // Prefer Race weekends first, then earliest start
  groups.sort((a,b) => {
    if (a._hasRace !== b._hasRace) return a._hasRace ? -1 : 1;
    return a.start - b.start;
  });

  return groups;
}

function renderHighlights(monthStart, monthEnd) {
  HIGHLIGHTS.innerHTML = "";
  const monthName = monthStart.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  MONTH_TITLE.textContent = `Monthly highlights — ${monthName}`;

  const monthKey = yyyymm(monthStart);

  const groups = f1Groups
    .filter(g => g.primaryMonth === monthKey)
    .slice(0, 8);

  if (!groups.length) {
    HIGHLIGHTS.innerHTML = `<div class="card"><div class="title">No highlights found</div><div class="meta">Try another month.</div></div>`;
    return;
  }

  for (const g of groups) {
    const card = document.createElement("div");
    card.className = "card f1";

    const flags = [];
    if (g._hasRace) flags.push("Race");
    if (g._hasQuali) flags.push("Quali");
    if (g._hasSprint) flags.push("Sprint");
    const summary = flags.length ? ` • ${flags.join(" / ")}` : "";

    const safeTitle = String(g.title || "").replace(/^[🏁🏎️\s]+/g, "");

    card.innerHTML = `
      <div class="title">🏎️ ${safeTitle}</div>
      <div class="meta">
        <span class="pill-date pill-f1">📅 ${formatRange(g.start, g.end)}</span>
        <span class="pill">🔥 F1${summary}</span>
      </div>
    `;

    HIGHLIGHTS.appendChild(card);
  }
}

async function loadEvents() {
  const res = await fetch("./data/events.json", { cache: "no-store" });
  allEvents = await res.json();

  // Build F1 groups (Grand Prix + Testing)
  f1Groups = buildF1Groups(allEvents);

  initCalendar();
}

function initCalendar() {
  const el = document.getElementById("calendar");
  calendar = new FullCalendar.Calendar(el, {
    initialView: "dayGridMonth",
    height: "auto",
    displayEventTime: false,
    dayMaxEvents: true,
    showNonCurrentDates: false,
    fixedWeekCount: false,

    events: allEvents.map(e => ({
      title: e.title,
      start: e.start,
      end: e.end,
      extendedProps: { sport: e.sport, source: e.source }
    })),

    datesSet(info) {
      renderHighlights(info.view.currentStart, info.view.currentEnd);
    },

    eventDidMount(info) {
      const sport = info.event.extendedProps.sport;
      if (sport === "F1") info.el.style.borderColor = "#e10600";
    }
  });

  calendar.render();
}

loadEvents();
