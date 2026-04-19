const MATCH_STATUS_NOT_STARTED = "not_started";

/** Pad naar JSON naast index.html; werkt op GitHub Pages ook als de URL geen afsluitende / heeft. */
function standingsDataUrl() {
  const target = "assets/standings-data.json";
  if (location.protocol === "https:" || location.protocol === "http:") {
    let path = location.pathname.replace(/\/index\.html?$/i, "");
    if (path !== "/" && !path.endsWith("/")) path += "/";
    const base = location.origin + path;
    try {
      return new URL(target, base).href;
    } catch {
      /* fallthrough */
    }
  }
  const link =
    document.querySelector('link[rel="stylesheet"][href$="styles.css"]') ||
    document.querySelector('link[rel="stylesheet"]');
  if (link?.href) {
    try {
      return new URL(target, link.href).href;
    } catch {
      /* fallthrough */
    }
  }
  try {
    return new URL(target, window.location.href).href;
  } catch {
    return target;
  }
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

function renderStandings(container, rows) {
  const playedAny = rows.some((r) => r.played > 0);
  const note = !playedAny
    ? '<p class="standings-note">Nog geen uitslagen in de geëxporteerde data — zodra wedstrijden zijn gespeeld, verschijnt hier de stand. Voor de live stand: open de app.</p>'
    : "";

  const thead = `<thead><tr>
    <th scope="col">#</th>
    <th scope="col">Team</th>
    <th scope="col">GES</th>
    <th scope="col">W</th>
    <th scope="col">G</th>
    <th scope="col">V</th>
    <th scope="col">DV</th>
    <th scope="col">DT</th>
    <th scope="col">+/-</th>
    <th scope="col">Ptn</th>
  </tr></thead>`;

  const bodyRows = rows
    .map((r, i) => {
      const sign = r.goalDifference > 0 ? "+" : "";
      const gd =
        r.goalDifference === 0 ? "0" : `${sign}${r.goalDifference}`;
      return `<tr>
      <td>${i + 1}</td>
      <td class="standings-team">${escapeHtml(r.teamName)}</td>
      <td>${r.played}</td>
      <td>${r.wins}</td>
      <td>${r.draws}</td>
      <td>${r.losses}</td>
      <td>${r.goalsFor}</td>
      <td>${r.goalsAgainst}</td>
      <td>${gd}</td>
      <td><strong>${r.points}</strong></td>
    </tr>`;
    })
    .join("");

  container.innerHTML = `${note}<div class="standings-scroll"><table class="standings-table">${thead}<tbody>${bodyRows}</tbody></table></div>`;
}

async function loadStandings() {
  const container = document.getElementById("standings-root");
  if (!container) return;

  try {
    const res = await fetch(standingsDataUrl(), { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    let teams = data.teams || [];
    const matches = data.matches || [];
    teams = teams.filter((t) => t.id !== "vrij");
    const rows = calculateStandings(teams, matches);
    renderStandings(container, rows);
  } catch {
    container.innerHTML =
      '<p class="standings-error">Kon de stand niet laden. Vernieuw de pagina of bekijk de stand in de app.</p>';
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadStandings();
});
