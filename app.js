const HIGHLIGHTS = document.getElementById("highlights");
const MONTH_TITLE = document.getElementById("monthTitle");

let allEvents = [];
let calendar; // FullCalendar instance

function toDate(d) {
  return new Date(d);
}

function startOfDay(dt){
  const d = new Date(dt);
  d.setHours(0,0,0,0);
  return d;
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

/**
 * Turn "FORMULA 1 QATAR AIRWAYS AUSTRALIAN GRAND PRIX 2026 - Practice 1"
 * into base title: "Australian Grand Prix"
 * (Generic fallback keeps the left side if no match)
 */
function baseTitle(raw) {
  if (!raw) return "Event";

  // Normalize whitespace and remove extra tokens
  let t = raw.replace(/\s+/g, " ").trim();

  // Remove session suffixes
  t = t.replace(/\s*-\s*(Practice\s*\d+|Qualifying|Sprint\s*Race|Sprint\s*Qualifying|Race)\s*$/i, "");

  // If it contains "GRAND PRIX", try to return "<X> Grand Prix"
  const m = t.match(/([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*)\s+GRAND PRIX/i);
  if (m && m[1]) return `${m[1].trim()} Grand Prix`;

  // Otherwise title-case the last chunk after "FORMULA 1"
  t = t.replace(/^FORMULA\s*1\s+/i, "");
  return t.replace(/\b\w/g, c => c.toUpperCase());
}

function groupMonthlyHighlights(monthStart, monthEnd) {
  // Collect events in visible month range
  const inMonth = allEvents
    .map(e => ({...e, _start: toDate(e.start)}))
    .filter(e => e._start >= monthStart && e._start < monthEnd);

  // Group by base title + sport
  const groups = new Map();

  for (const e of inMonth) {
    const sport = e.sport || "Sport";
    const key = `${sport}||${baseTitle(e.title)}`;

    const d = startOfDay(e._start);
    const g = groups.get(key) || {
      sport,
      title: baseTitle(e.title),
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

  // “Top events” logic: prefer groups that include a Race (for F1), else by earliest date.
  const arr = [...groups.values()].map(g => {
    const hasRace = g.items.some(x => /-\s*Race\s*$/i.test(x.title));
    return {...g, _hasRace: hasRace};
  });

  arr.sort((a,b) => {
    // Race weekends first for F1
    if (a.sport === "F1" || b.sport === "F1") {
      if (a._hasRace !== b._hasRace) return a._hasRace ? -1 : 1;
    }
    return a.start - b.start;
  });

  // Keep it manageable
  return arr.slice(0, 8);
}

function renderHighlights(monthStart, monthEnd) {
  HIGHLIGHTS.innerHTML = "";

  const monthName = monthStart.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  MONTH_TITLE.textContent = `Monthly highlights — ${monthName}`;

  const groups = groupMonthlyHighlights(monthStart, monthEnd);

  if (!groups.length) {
    HIGHLIGHTS.innerHTML = `<div class="card"><div class="title">No events found</div><div class="meta">Try another month.</div></div>`;
    return;
  }

  for (const g of groups) {
    const sport = g.sport;
    const isF1 = sport === "F1";

    const card = document.createElement("div");
    card.className = `card ${isF1 ? "f1" : ""}`;

    // Optional: show a compact session summary for F1 (Race/Quali/Sprint)
    let sessionSummary = "";
    if (isF1) {
      const flags = [];
      if (g.items.some(x => /-\s*Race\s*$/i.test(x.title))) flags.push("Race");
      if (g.items.some(x => /Qualifying/i.test(x.title))) flags.push("Quali");
      if (g.items.some(x => /Sprint/i.test(x.title))) flags.push("Sprint");
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

  initCalendar();
}

function initCalendar() {
  const el = document.getElementById("calendar");
  calendar = new FullCalendar.Calendar(el, {
    initialView: "dayGridMonth",
    height: "auto",

    // Make calendar less noisy:
    displayEventTime: false,   // hides 1:30a etc
    dayMaxEvents: true,        // collapses extra events under “+ more”

    events: allEvents.map(e => ({
      title: e.title,
      start: e.start,
      end: e.end,
      extendedProps: { sport: e.sport, source: e.source }
    })),

    datesSet(info) {
      // info.start/info.end = visible range for the current month view
      renderHighlights(info.start, info.end);
    },

    eventDidMount(info) {
      info.el.title = `${info.event.title}\n${info.event.extendedProps.sport || ""}`;

      // Optional: make F1 items red-ish in the month grid
      const sport = info.event.extendedProps.sport;
      if (sport === "F1") {
        info.el.style.borderColor = "#e10600";
      }
    }
  });

  calendar.render();
}

loadEvents();
