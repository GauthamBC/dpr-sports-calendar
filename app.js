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
  return t.replace(/\s*-\s*(Practice\s*\d+|Qualifying|Sprint\s*Race|Sprint\s*Qualifying|Race)\s*$/i, "");
}

function cleanF1Prefix(t){
  // Remove leading "Formula 1" regardless of case and extra spaces
  return t.replace(/^\s*formula\s*1\s+/i, "").trim();
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

  // 1) Testing blocks (so Feb isn't empty)
  // Examples: "AROMCO PRE-SEASON TESTING 1", "ARAMCO PRE-SEASON TESTING 2"
  if (/testing/i.test(t)) {
    // Keep just "... Testing X"
    const m = t.match(/(pre[-\s]?season\s+testing\s*\d*)/i) || t.match(/(testing\s*\d*)/i);
    if (m) {
      const name = m[1].replace(/\s+/g, " ").trim();
      // Title-case
      const titled = name.replace(/\b\w/g, c => c.toUpperCase());
      return titled;
    }
    return "Testing";
  }

  // 2) Grand Prix weekends (supports languages/diacritics)
  const rgx = /(.+?)\s+(grand\s+prix|gran\s+premio|grande\s+pr[êe]mio)\b/i;
  const m = t.match(rgx);
  if (!m) return null;

  let location = m[1].trim();

  // If the left part still contains "FORMULA 1" somewhere, remove it (sometimes it's not at the start)
  location = location.replace(/\bformula\s*1\b/i, "").trim();

  // Sponsor/noise stripping:
  // Some feeds include sponsors in the race name (e.g., "Qatar Airways Australian Grand Prix").
  // We strip common sponsor tokens BEFORE taking the tail words, so all sessions collapse into one group.
  const SPONSOR_WORDS = new Set([
    "airways","heineken","aramco","rolex","pirelli","lenovo","aws","crypto","cryptocom","crypto.com",
    "gulf","etihad","emirates","stc","petronas","dhl","paddock","club","msc","cruises",
    "qatar" // appears both as a sponsor and a location; fallback below keeps location when needed
  ]);

  const rawWords = location.split(" ").filter(Boolean);
  const cleanedWords = rawWords.filter(w => !SPONSOR_WORDS.has(w.toLowerCase()));
  const words = cleanedWords.length ? cleanedWords : rawWords;

  // Keep the last 1–3 words (enough for "Saudi Arabian", "United States", "Las Vegas", etc.)
  const keep = Math.min(3, Math.max(1, words.length));
  location = words.slice(-keep).join(" ");

  // Title-case (preserve acronyms <=3 chars that are all caps)
  const titledLoc = location
    .split(" ")
    .map(w => (w.length <= 3 && w === w.toUpperCase()) ? w : (w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");

  return `${titledLoc} Grand Prix`;
}

// ---------------- Grouping ----------------

function buildF1Groups(events){
  const map = new Map();

  for (const e of events) {
    if ((e.sport || "").toUpperCase() !== "F1") continue;

    const name = extractF1BlockName(e.title);
    if (!name) continue;

    const day = startOfDay(toDate(e.start));
    const year = day.getFullYear();
    const key = `${year}||${normalizeKey(name)}`;

    const g = map.get(key) || {
      sport: "F1",
      title: name,
      items: [],
      dateSet: new Set(),
      start: day,
      end: day,
      primaryMonth: null,
      _hasRace: false,
      _hasQuali: false,
      _hasSprint: false,
    };

    g.items.push(e);
    g.dateSet.add(day.toISOString().slice(0,10));

    if (day < g.start) g.start = day;
    if (day > g.end) g.end = day;

    if (/\-\s*Race\s*$/i.test(e.title)) g._hasRace = true;
    if (/Qualifying/i.test(e.title)) g._hasQuali = true;
    if (/Sprint/i.test(e.title)) g._hasSprint = true;

    map.set(key, g);
  }

  // Determine primary month by majority of UNIQUE days (handles month spillovers)
  const groups = [];
  for (const g of map.values()) {
    const byMonth = new Map();
    for (const ds of g.dateSet) {
      const d = new Date(ds + "T00:00:00");
      const k = yyyymm(d);
      byMonth.set(k, (byMonth.get(k) || 0) + 1);
    }
    let bestK = null, bestV = -1;
    for (const [k,v] of byMonth.entries()) {
      if (v > bestV) { bestV = v; bestK = k; }
    }
    g.primaryMonth = bestK;
    groups.push(g);
  }

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
      <div class="title">🏎️ ${g.title}</div>
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
