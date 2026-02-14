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
      // keep short all-caps acronyms
      if (w.length <= 3 && w === w.toUpperCase()) return w;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

function canonicalizeLocation(loc){
  const l = normalizeKey(loc);

  // Common drift normalization (expand as needed)
  if (/\bbahrain\b/.test(l)) return "Bahrain";
  if (/\bsaudi\b/.test(l)) return "Saudi Arabian";
  if (/\baustralia|australian\b/.test(l)) return "Australian";
  if (/\bjapan|japanese\b/.test(l)) return "Japanese";
  if (/\bchina|chinese\b/.test(l)) return "Chinese";
  if (/\bmiami\b/.test(l)) return "Miami";
  if (/\bemilia\b/.test(l) || /\bimola\b/.test(l)) return "Emilia Romagna";
  if (/\bmonaco\b/.test(l)) return "Monaco";
  if (/\bcanada|canadian\b/.test(l)) return "Canadian";
  if (/\bspain|spanish\b/.test(l)) return "Spanish";
  if (/\baustria|austrian\b/.test(l)) return "Austrian";
  if (/\bgreat britain|british|silverstone\b/.test(l)) return "British";
  if (/\bhungary|hungarian\b/.test(l)) return "Hungarian";
  if (/\bbelgium|belgian\b/.test(l)) return "Belgian";
  if (/\bnetherlands|dutch\b/.test(l)) return "Dutch";
  if (/\bitaly|italian|monza\b/.test(l)) return "Italian";
  if (/\bsingapore\b/.test(l)) return "Singapore";
  if (/\busa|united states|las vegas|austin\b/.test(l)) return "United States";
  if (/\bmexico|mexican\b/.test(l)) return "Mexico City";
  if (/\bbrazil|sao paulo|brazilian\b/.test(l)) return "São Paulo";
  if (/\babu dhabi\b/.test(l)) return "Abu Dhabi";
  if (/\bazerbaijan|baku\b/.test(l)) return "Azerbaijan";
  if (/\bqatar\b/.test(l)) return "Qatar";
  if (/\bstc\b/.test(l) && /\bsaudi\b/.test(l)) return "Saudi Arabian";

  return titleCaseSmart(loc);
}

function extractF1BlockName(raw){
  if (!raw) return null;
  let t = raw.replace(/\s+/g, " ").trim();

  // Ignore subscription/system events
  if (/in your calendar/i.test(t)) return null;

  // Remove session suffix & year
  t = stripSessionSuffix(t);
  t = t.replace(/\b20\d{2}\b/g, "").trim();

  // Remove leading "Formula 1"
  t = cleanF1Prefix(t);

  // 1) Testing blocks
  if (/testing/i.test(t)) {
    const m = t.match(/(pre[-\s]?season\s+testing\s*\d*)/i) || t.match(/(testing\s*\d*)/i);
    if (m) {
      const name = m[1].replace(/\s+/g, " ").trim();
      return titleCaseSmart(name);
    }
    return "Testing";
  }

  // 2) Grand Prix weekends (supports language variants)
  const rgx = /(.+?)\s+(grand\s+prix|gran\s+premio|grande\s+pr[êe]mio)\b/i;
  const m = t.match(rgx);
  if (!m) return null;

  let location = m[1].trim();

  // Remove FORMULA 1 if it appears again
  location = location.replace(/\bformula\s*1\b/ig, "").trim();

  // Remove punctuation-ish leftovers
  location = location.replace(/[|–—,:;]+/g, " ").replace(/\s+/g, " ").trim();

  // Remove common sponsor / noise tokens
  const SPONSOR_WORDS = new Set([
    "qatar", "qatarairways", "qatar-airways", "airways",
    "heineken", "aramco", "rolex", "pirelli", "lenovo", "aws",
    "crypto", "cryptocom", "crypto.com", "etihad", "emirates",
    "petronas", "dhl", "stc", "gulf", "moet", "moët"
  ]);

  const rawWords = location.split(" ").filter(Boolean);
  const cleanedWords = rawWords.filter(w => !SPONSOR_WORDS.has(normalizeKey(w).replace(/\./g, "")));

  // If aggressive cleanup removes too much, fallback gracefully
  const words = cleanedWords.length ? cleanedWords : rawWords;

  // Keep tail words so we retain country/location, not sponsor prefix
  const keep = Math.min(3, Math.max(1, words.length));
  location = words.slice(-keep).join(" ");

  // Canonicalize naming drift
  const canonical = canonicalizeLocation(location);

  return `${canonical} Grand Prix`;
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
    const monthBucket = `${day.getFullYear()}-${day.getMonth()}`; // IMPORTANT
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

    card.innerHTML = `
      <div class="title">🏎️ 🏁 ${g.title}</div>
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
