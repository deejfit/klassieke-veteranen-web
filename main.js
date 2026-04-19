import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  getFirestore,
  collection,
  getDocs,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import {
  getAuth,
  signInAnonymously,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";

/**
 * Zelfde Firebase Web-config als `klassieke_veteranen/lib/firebase_options.dart` (web).
 * Firestore-paden gelijk aan `FirestoreService`: `competitions/{competitionId}/teams|matches`.
 */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyD26WDV_NcLOzVd5Zg2CUMP7vN6smygpPo",
  authDomain: "competitions-86b37.firebaseapp.com",
  projectId: "competitions-86b37",
  storageBucket: "competitions-86b37.firebasestorage.app",
  messagingSenderId: "752716670867",
  appId: "1:752716670867:web:4e946ee498606aa998aa66",
};

const COMPETITION_ID = "klassieke-veteranen";

const MATCH_STATUS_NOT_STARTED = "not_started";

function getFirebaseApp() {
  if (!getApps().length) return initializeApp(FIREBASE_CONFIG);
  return getApp();
}

/** Basis-URL van de site (eindigt op `/`), o.a. voor GitHub Pages zonder trailing slash. */
function siteBaseDir() {
  if (location.protocol === "https:" || location.protocol === "http:") {
    let path = location.pathname.replace(/\/index\.html?$/i, "");
    if (path !== "/" && !path.endsWith("/")) path += "/";
    return location.origin + path;
  }
  const link =
    document.querySelector('link[rel="stylesheet"][href$="styles.css"]') ||
    document.querySelector('link[rel="stylesheet"]');
  if (link?.href) {
    try {
      return new URL(".", link.href).href;
    } catch {
      /* fallthrough */
    }
  }
  try {
    return new URL(".", window.location.href).href;
  } catch {
    return "";
  }
}

function assetHref(relativePath) {
  const base = siteBaseDir();
  if (!base) return relativePath;
  try {
    return new URL(relativePath.replace(/^\//, ""), base).href;
  } catch {
    return relativePath;
  }
}

function standingsDataUrl() {
  return assetHref("assets/standings-data.json");
}

let _placeholderLogoHref;
function teamLogoPlaceholderHref() {
  if (!_placeholderLogoHref) {
    _placeholderLogoHref = assetHref("assets/teams/placeholder.png");
  }
  return _placeholderLogoHref;
}

/** Clublogo: zelfde bestandsnamen als in de Flutter-app (`assets/images/teams/{id}.png`). */
function teamLogoImg(teamId, className, size = 28) {
  const src = assetHref(`assets/teams/${encodeURIComponent(teamId)}.png`);
  const ph = teamLogoPlaceholderHref().replace(/'/g, "\\'");
  return `<img class="${className}" src="${src}" width="${size}" height="${size}" alt="" loading="lazy" decoding="async" onerror="if(!this.dataset.fb){this.dataset.fb=1;this.src='${ph}'}">`;
}

function matchTimeMs(match) {
  const t = match.startTime;
  if (t && typeof t.toMillis === "function") return t.toMillis();
  if (t && typeof t.seconds === "number") return t.seconds * 1000;
  if (typeof match.startTime === "string") {
    const p = Date.parse(match.startTime);
    return Number.isFinite(p) ? p : 0;
  }
  return 0;
}

function normalizeMatch(m) {
  const homeScore =
    m.homeScore === undefined || m.homeScore === null
      ? null
      : Number(m.homeScore);
  const awayScore =
    m.awayScore === undefined || m.awayScore === null
      ? null
      : Number(m.awayScore);
  return {
    id: m.id,
    round: m.round ?? "",
    home: m.home ?? "",
    away: m.away ?? "",
    date: m.date ?? "",
    startTime: m.startTime,
    homeScore: Number.isFinite(homeScore) ? homeScore : null,
    awayScore: Number.isFinite(awayScore) ? awayScore : null,
    status: m.status ?? "not_started",
    startTimeMs: matchTimeMs(m),
  };
}

async function loadFromFirestore() {
  const app = getFirebaseApp();
  const db = getFirestore(app);

  async function readCollections() {
    const comp = COMPETITION_ID;
    const teamSnap = await getDocs(collection(db, "competitions", comp, "teams"));
    const teams = [];
    teamSnap.forEach((doc) => {
      const d = doc.data();
      teams.push({
        id: d.id ?? doc.id,
        name: d.name ?? d.id ?? doc.id,
      });
    });

    const matchSnap = await getDocs(collection(db, "competitions", comp, "matches"));
    const matches = [];
    matchSnap.forEach((doc) => {
      const d = doc.data();
      matches.push(
        normalizeMatch({
          id: d.id ?? doc.id,
          round: d.round,
          home: d.home,
          away: d.away,
          date: d.date,
          startTime: d.startTime,
          homeScore: d.homeScore,
          awayScore: d.awayScore,
          status: d.status,
        }),
      );
    });
    return { teams, matches };
  }

  try {
    return await readCollections();
  } catch (e) {
    if (e?.code === "permission-denied") {
      try {
        const auth = getAuth(app);
        await signInAnonymously(auth);
        return await readCollections();
      } catch {
        throw e;
      }
    }
    throw e;
  }
}

async function loadFromJsonFallback() {
  const res = await fetch(standingsDataUrl(), { cache: "no-store" });
  if (!res.ok) throw new Error(String(res.status));
  const data = await res.json();
  const teams = (data.teams || []).map((t) => ({ ...t }));
  const matches = (data.matches || []).map((m) => normalizeMatch(m));
  return { teams, matches };
}

function isPlaceholderFiveNil(homeScore, awayScore) {
  return (
    (homeScore === 5 && awayScore === 0) || (homeScore === 0 && awayScore === 5)
  );
}

function matchCountsTowardStandingGoals(match) {
  const h = match.homeScore;
  const a = match.awayScore;
  if (h == null || a == null) return false;
  if (!isPlaceholderFiveNil(h, a)) return true;
  const s = (match.status || "").trim();
  if (!s) return false;
  return s !== MATCH_STATUS_NOT_STARTED;
}

function calculateStandings(teams, matches) {
  const standings = {};
  for (const team of teams) {
    standings[team.id] = {
      teamId: team.id,
      teamName: team.name,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      points: 0,
      goalDifference: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      headToHeadPoints: 0,
    };
  }

  for (const match of matches) {
    if (match.homeScore == null || match.awayScore == null) continue;
    const home = standings[match.home];
    const away = standings[match.away];
    if (!home || !away) continue;

    home.played += 1;
    away.played += 1;

    const homeGoals = match.homeScore;
    const awayGoals = match.awayScore;

    if (matchCountsTowardStandingGoals(match)) {
      home.goalDifference += homeGoals - awayGoals;
      away.goalDifference += awayGoals - homeGoals;
      home.goalsFor += homeGoals;
      home.goalsAgainst += awayGoals;
      away.goalsFor += awayGoals;
      away.goalsAgainst += homeGoals;
    }

    if (homeGoals > awayGoals) {
      home.wins += 1;
      away.losses += 1;
      home.points += 3;
    } else if (homeGoals < awayGoals) {
      away.wins += 1;
      home.losses += 1;
      away.points += 3;
    } else {
      home.draws += 1;
      away.draws += 1;
      home.points += 1;
      away.points += 1;
    }
  }

  for (const match of matches) {
    if (match.homeScore == null || match.awayScore == null) continue;
    const homeRow = standings[match.home];
    const awayRow = standings[match.away];
    if (!homeRow || !awayRow) continue;
    if (homeRow.points === awayRow.points) {
      if (match.homeScore > match.awayScore) {
        homeRow.headToHeadPoints += 3;
      } else if (match.homeScore < match.awayScore) {
        awayRow.headToHeadPoints += 3;
      } else {
        homeRow.headToHeadPoints += 1;
        awayRow.headToHeadPoints += 1;
      }
    }
  }

  const list = Object.values(standings);
  list.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goalDifference !== a.goalDifference) {
      return b.goalDifference - a.goalDifference;
    }
    if (b.headToHeadPoints !== a.headToHeadPoints) {
      return b.headToHeadPoints - a.headToHeadPoints;
    }
    return a.teamName.localeCompare(b.teamName, "nl", { sensitivity: "base" });
  });

  return list;
}

function escapeHtml(text) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return String(text).replace(/[&<>"']/g, (ch) => map[ch] || ch);
}

function renderStandings(container, rows, { live } = { live: false }) {
  const playedAny = rows.some((r) => r.played > 0);
  let note = "";
  if (!playedAny) {
    note = live
      ? '<p class="standings-note">Nog geen wedstrijden met een ingevulde uitslag in Firestore. Zodra er uitslagen zijn, verschijnt hier de stand.</p>'
      : '<p class="standings-note">Nog geen uitslagen in de lokale data — zodra wedstrijden zijn gespeeld, verschijnt hier de stand. Voor de live stand: open de app.</p>';
  }

  const thead = `<thead><tr>
    <th scope="col">#</th>
    <th scope="col">Team</th>
    <th scope="col">GES</th>
    <th scope="col">W</th>
    <th scope="col">G</th>
    <th scope="col">V</th>
    <th scope="col">+/-</th>
    <th scope="col">Ptn</th>
  </tr></thead>`;

  const bodyRows = rows
    .map((r, i) => {
      const sign = r.goalDifference > 0 ? "+" : "";
      const gd =
        r.goalDifference === 0 ? "0" : `${sign}${r.goalDifference}`;
      const logo = teamLogoImg(r.teamId, "standings-logo");
      return `<tr>
      <td>${i + 1}</td>
      <td class="standings-team"><span class="standings-team-inner">${logo}<span class="standings-team-name">${escapeHtml(r.teamName)}</span></span></td>
      <td>${r.played}</td>
      <td>${r.wins}</td>
      <td>${r.draws}</td>
      <td>${r.losses}</td>
      <td>${gd}</td>
      <td><strong>${r.points}</strong></td>
    </tr>`;
    })
    .join("");

  container.innerHTML = `${note}<div class="standings-scroll"><table class="standings-table">${thead}<tbody>${bodyRows}</tbody></table></div>`;
}

function buildTeamNameMap(teams) {
  const map = { vrij: "Vrij" };
  for (const t of teams) map[t.id] = t.name;
  return map;
}

/** Kalenderdag in lokale tijd (YYYY-MM-DD) voor groeperen. */
function localDateKey(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

/** Titel boven een datumsectie (bijv. "zaterdag 12 april 2026"). */
function formatNlDateSectionTitle(ms) {
  if (!ms) return "Onbekende datum";
  return new Date(ms).toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Groepeert op kalenderdag, nieuwste dagen eerst; binnen een dag nieuwste wedstrijd eerst. */
function groupPlayedMatchesByDate(matches) {
  const map = new Map();
  for (const m of matches) {
    const k = localDateKey(m.startTimeMs) || "unknown";
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(m);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => (b.startTimeMs || 0) - (a.startTimeMs || 0));
  }
  const keys = [...map.keys()].filter((k) => k !== "unknown").sort().reverse();
  const out = keys.map((key) => ({ key, matches: map.get(key) }));
  const unknown = map.get("unknown");
  if (unknown?.length) {
    out.push({ key: "unknown", matches: unknown });
  }
  for (const g of out) {
    const ms0 = g.matches[0]?.startTimeMs;
    g.title = ms0 ? formatNlDateSectionTitle(ms0) : "Onbekende datum";
  }
  return out;
}

function renderMatchRow(m, nameMap) {
  const hn = nameMap[m.home] || m.home;
  const an = nameMap[m.away] || m.away;
  const homeLogo = teamLogoImg(m.home, "results-logo", 24);
  const awayLogo = teamLogoImg(m.away, "results-logo", 24);
  return `<tr>
    <td class="results-match"><span class="results-pair"><span class="results-side results-side--home">${homeLogo}<span class="results-name">${escapeHtml(hn)}</span></span><span class="results-vs">–</span><span class="results-side results-side--away"><span class="results-name">${escapeHtml(an)}</span>${awayLogo}</span></span></td>
    <td class="results-score"><strong>${m.homeScore}</strong> – <strong>${m.awayScore}</strong></td>
  </tr>`;
}

/** Aantal recente speeldagen (weekenden) in het blok Laatste uitslagen. */
const RECENT_RESULTS_DAY_GROUPS = 4;

function renderRecentResults(container, matches, nameMap, { live } = { live: false }) {
  const played = matches.filter(
    (m) =>
      m.homeScore != null &&
      m.awayScore != null &&
      !(m.home === "vrij" && m.away === "vrij"),
  );
  played.sort((a, b) => (b.startTimeMs || 0) - (a.startTimeMs || 0));

  if (!played.length) {
    container.innerHTML = `<p class="results-empty">Nog geen uitslagen om te tonen.</p>${
      live
        ? ""
        : '<p class="results-empty results-empty--sub">Tip: als Firestore-leesrechten ontbreken, wordt lokale JSON gebruikt.</p>'
    }`;
    return;
  }

  const groups = groupPlayedMatchesByDate(played).slice(0, RECENT_RESULTS_DAY_GROUPS);

  const thead = `<thead><tr>
    <th scope="col">Wedstrijd</th>
    <th scope="col">Uitslag</th>
  </tr></thead>`;

  const sections = groups
    .map((g, idx) => {
      const id = `results-day-${g.key.replace(/[^0-9a-z-]/gi, "")}-${idx}`;
      const rows = g.matches.map((m) => renderMatchRow(m, nameMap)).join("");
      return `<section class="results-day" aria-labelledby="${id}">
    <h3 class="results-day-title" id="${id}">${escapeHtml(g.title)}</h3>
    <div class="results-scroll">
      <table class="results-table">${thead}<tbody>${rows}</tbody></table>
    </div>
  </section>`;
    })
    .join("");

  container.innerHTML = `<div class="results-by-date">${sections}</div>`;
}

async function loadCompetition() {
  const standingsRoot = document.getElementById("standings-root");
  const resultsRoot = document.getElementById("results-root");
  if (!standingsRoot) return;

  let teams = [];
  let matches = [];
  let live = false;

  try {
    ({ teams, matches } = await loadFromFirestore());
    live = true;
  } catch (err) {
    console.warn("Firestore niet beschikbaar, fallback op standings-data.json", err);
    try {
      ({ teams, matches } = await loadFromJsonFallback());
    } catch {
      standingsRoot.innerHTML =
        '<p class="standings-error">Kon geen data laden (Firestore en lokale JSON mislukten). Controleer Firestore-regels en of <code>assets/standings-data.json</code> bestaat.</p>';
      if (resultsRoot) {
        resultsRoot.innerHTML =
          '<p class="standings-error">Kon uitslagen niet laden.</p>';
      }
      return;
    }
  }

  const teamsStandings = teams.filter((t) => t.id !== "vrij");
  const rows = calculateStandings(teamsStandings, matches);
  renderStandings(standingsRoot, rows, { live });

  if (resultsRoot) {
    const nameMap = buildTeamNameMap(teams);
    renderRecentResults(resultsRoot, matches, nameMap, { live });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadCompetition();
});
