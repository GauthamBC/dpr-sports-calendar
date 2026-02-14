const UPCOMING = document.getElementById("upcoming");
const CHIPS = document.getElementById("chips");

let allEvents = [];
let activeDays = 7;

function toDate(d) {
  // supports "YYYY-MM-DD" or ISO datetime
  return new Date(d);
}

function fmtDate(d) {
  const dt = new Date(d);
  return dt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function renderUpcoming() {
  UPCOMING.innerHTML = "";

  const now = new Date();
  const limit = new Date(now.getTime() + activeDays * 24 * 60 * 60 * 1000);

  const upcoming = allEvents
    .map(e => ({...e, _start: toDate(e.start)}))
    .filter(e => e._start >= now && e._start <= limit)
    .sort((a,b) => a._start - b._start)
    .slice(0, 12);

  if (!upcoming.length) {
    UPCOMING.innerHTML = `<div class="card"><div class="title">No events found</div><div class="meta">Try a wider window (14/30 days).</div></div>`;
    return;
  }

  for (const e of upcoming) {
    const ideas = e.ideas?.length ? `💡 <strong>DPR ideas:</strong> ${e.ideas.join(", ")}` : "";
    const sport = e.sport || "Sport";
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="title">${e.title}</div>
      <div class="meta">
        <span>📅 ${fmtDate(e.start)}</span>
        <span class="pill">🔥 ${sport}</span>
      </div>
      ${ideas ? `<div class="ideas">${ideas}</div>` : ""}
    `;
    UPCOMING.appendChild(card);
  }
}

async function loadEvents() {
  const res = await fetch("./data/events.json", { cache: "no-store" });
  allEvents = await res.json();

  // OPTIONAL: add default DPR ideas by sport (simple starter)
  const defaults = {
    "F1": ["travel cost", "fan sentiment", "ticket pricing"],
    "NASCAR": ["travel cost", "local spend", "hotel price surge"],
    "NFL": ["fan stress", "ticket vs income", "tailgate cost"]
  };
  allEvents = allEvents.map(e => ({
    ...e,
    ideas: e.ideas || defaults[e.sport] || []
  }));

  renderUpcoming();
  initCalendar();
}

function initCalendar() {
  const el = document.getElementById("calendar");
  const calendar = new FullCalendar.Calendar(el, {
    initialView: "dayGridMonth",
    height: "auto",
    events: allEvents.map(e => ({
      title: e.title,
      start: e.start,
      end: e.end,
      extendedProps: { sport: e.sport, source: e.source }
    })),
    eventDidMount(info) {
      // Tooltip-like title
      info.el.title = `${info.event.title}\n${info.event.extendedProps.sport || ""}`;
    }
  });
  calendar.render();
}

CHIPS.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-days]");
  if (!btn) return;
  [...CHIPS.querySelectorAll(".chip")].forEach(x => x.classList.remove("active"));
  btn.classList.add("active");
  activeDays = Number(btn.dataset.days);
  renderUpcoming();
});

loadEvents();
