const HIGHLIGHTS = document.getElementById("highlights");
const MONTH_TITLE = document.getElementById("monthTitle");

let allEvents = [];
let calendar; // FullCalendar instance

// Precomputed weekend-style groups (e.g., F1 race weekends)
let f1WeekendGroups = [];

function toDate(d) {
  return new Date(d);
}

function startOfDay(dt){
  const d = new Date(dt);
  d.setHours(0,0,0,0);
  return d;
}

function yyyymm(d){
  return `${d.getFullYear()}-${d.getMonth()}`; // month is 0-based
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
  if (sameMonth) return `${sTxt}–${e.getDate()}, ${yearTxt}`; // "Mar 6–8, 2026"
  return `${sTxt} – ${eTxt}, ${yearTxt}`;
}

// ---------- Title normalization (F1-focused) ----------

function stripSessionSuffix(t){
  return t.replace(/\s*-\s*(Practice\s*\d+|Qualifying|Sprint\s*Race|Sprint\s*Qualifying|Race)\s*$/i, "");
}

function extractGPName(raw) {
  if (!raw) return null;
  let t = raw.replace(/\s+/g, " ").trim();

  // Remove obvious noise first
  t = stripSessionSuffix(t);
  t = t.replace(/^FORMULA\s*1\s+/i, "");
  t = t.replace(/\b20\d{2}\b/g, "").trim(); // remove year tokens like 2026

  // Ignore subscription/system events
  if (/in your calendar/i.test(t)) return null;

  // Match variants across languages/diacritics:
  // - GRAND PRIX
  // - GRAN PREMIO
  // - GRANDE PRÊMIO / GRANDE PREMIO
  const rgx = /(.+?)\s+(GRAND\s+PRIX|GRAN\s+PREMIO|GRANDE\s+PR[ÊE]MIO)\b/i;
  const m = t.match(rgx);
  if (!m) {
    // If we can't detect a GP token, treat as non-weekend item (testing etc.)
    return null;
  }

  // Location phrase is everything before the token (often includes sponsors)
  let location = m[1].trim();

  // Try to trim sponsor prefixes by keeping the LAST 1–4 words of the location chunk
  const words = location.split(" ").filter(Boolean);

  const keep = Math.min(4, Math.max(1, words.length));
  location = words.slice(-keep).join(" ");

  // Title-case location a bit (preserve all-caps acronyms)
  const titled = location
    .split(" ")
    .map(w => (w.length <= 3 && w === w.toUpperCase()) ? w : (w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");

  return `${titled} Grand Prix`;
}

// ---------- Grouping logic ----------

function buildF1WeekendGroups(events){
  const map = new Map();

  for (const e of events) {
    if ((e.sport || "").toUpperCase() !== "F1") continue;

    const gpName = extractGPName(e.title);
    if (!gpName) continue;

    const start = startOfDay(toDate(e.start));
    const year = start.getFullYear();
    const key = `${year}||${gpName.toLowerCase()}`;

    const g = map.get(key) || {
      sport: "F1",
      title: gpName,
      source: e.source,
      items: [],
      dateSet: new Set(),
      start,
      end: start,
      primaryMonth: null,
      _hasRace: false,
      _hasQuali: false,
      _hasSprint: false,
    };

    g.items.push(e);
    g.dateSet.add(start.toISOString().slice(0,10)); // yyyy-mm-dd

    if (start < g.start) g.start = start;
    if (start > g.end) g.end = start;

    if (/\-\s*Race\s*$/i.test(e.title)) g._hasRace = true;
    if (/Qualifying/i.test(e.title)) g._hasQuali = true;
    if (/Sprint/i.test(e.title)) g._hasSprint = true;

    map.set(key, g);
  }

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

  groups.sort((a,b) => a.start - b.start);
  return groups;
}

/**
 * Generic grouping for non-F1 items (extend later per sport).
 */
function groupMonthlyHighlightsGeneric(monthStart, monthEnd) {
  const inMonth = allEvents
    .map(e => ({...e, _start: toDate(e.start)}))
    .filter(e => e._start >= monthStart && e._start < monthEnd)
    .filter(e => (e.sport || "").toUpperCase() !== "F1");

  const groups = new Map();

  for (const e of inMonth) {
    const sport = e.sport || "Sport";
    const key = `${sport}||${(e.title || "").toLowerCase()}`;

    const d = startOfDay(e._start);
    const g = groups.get(key) || {
      sport,
      title: e.title || "Event",
      start: d,
      end: d,
      source: e.source,
      items: []
    };

    if (d < g.start) g.start = d;
    if (d > g.end) g.end = d;
    g.items.push(e);
    groups.set(key, g);
  }

  const arr = [...groups.values()];
  arr.sort((a,b) => a.start - b.start);
  return arr.slice(0, 8);
}

function renderHighlights(monthStart, monthEnd) {
  HIGHLIGHTS.innerHTML = "";

  const monthName = monthStart.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  MONTH_TITLE.textContent = `Monthly highlights — ${monthName}`;

  const monthKey = yyyymm(monthStart);

  const f1InMonth = f1WeekendGroups
    .filter(g => g.primaryMonth === monthKey)
    .slice(0, 8);

  const generic = groupMonthlyHighlightsGeneric(monthStart, monthEnd);

  const groups = [...f1InMonth, ...generic].slice(0, 8);

  if (!groups.length) {
    HIGHLIGHTS.innerHTML = `<div class="card"><div class="title">No highlights found</div><div class="meta">Try another month.</div></div>`;
    return;
  }

  for (const g of groups) {
    const sport = g.sport || "Sport";
    const isF1 = sport.toUpperCase() === "F1";

    const card = document.createElement("div");
    card.className = `card ${isF1 ? "f1" : ""}`;

    let sessionSummary = "";
    if (isF1) {
      const flags = [];
      if (g._hasRace) flags.push("Race");
      if (g._hasQuali) flags.push("Quali");
      if (g._hasSprint) flags.push("Sprint");
      if (flags.length) sessionSummary = ` • ${flags.join(" / ")}`;
    }

    card.innerHTML = `
      <div class="title">${isF1 ? "🏎️ " : "🏟️ "}${g.title}</div>
      <div class="meta">
        <span class="pill-date ${isF1 ? "pill-f1" : ""}">📅 ${formatRange(g.start, g.end)}</span>
        <span class="pill">🔥 ${sport}${sessionSummary}</span>
      </div>
      <div class="ideas">💡 <strong>DPR ideas:</strong> travel cost, fan sentiment, ticket pricing</div>
    `;

    HIGHLIGHTS.appendChild(card);
  }
}

async function loadEvents() {
  const res = await fetch("./data/events.json", { cache: "no-store" });
  allEvents = await res.json();

  // Precompute weekend-style groupings
  f1WeekendGroups = buildF1WeekendGroups(allEvents);

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
      info.el.title = `${info.event.title}\n${info.event.extendedProps.sport || ""}`;
      const sport = info.event.extendedProps.sport;
      if (sport === "F1") {
        info.el.style.borderColor = "#e10600";
      }
    }
  });

  calendar.render();
}

loadEvents();
