/**
 * ESPN to Possession Flow Converter (JavaScript port)
 *
 * Fetches ESPN college football game data and converts it to possession-flow JSON
 * for the D3 visualization. Mirrors the Python script at scripts/espn_to_possession.py.
 *
 * Usage:
 *   const game = await espnToPossession.fetchAndConvert('401677189');
 *   const game = await espnToPossession.fetchAndConvert('https://www.espn.com/college-football/game/_/gameId/401677189/...');
 */

const API_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event={game_id}';

const RESULT_MAP = {
  TD: '7',
  FG: '3',
  PUNT: 'P',
  INT: 'I',
  DOWNS: 'N',
  FUMBLE: 'F',
  'END OF HALF': 'H',
  'END OF GAME': 'H',
  'MISSED FG': 'FGA',
};

const EXCHANGE_FROM_PREV_RESULT = {
  PUNT: 'P',
  INT: 'Int',
  DOWNS: 'Downs',
  FUMBLE: 'Fumble',
  'MISSED FG': 'FGA',
};

/**
 * Extract game ID from ESPN URL or return as-is if already an ID.
 */
function extractGameId(input) {
  const cleaned = String(input).trim().replace(/\/$/, '');
  const match = cleaned.match(/gameId\/(\d+)/);
  if (match) return match[1];
  if (/^\d+$/.test(cleaned)) return cleaned;
  const parts = cleaned.split('/');
  const last = parts[parts.length - 1];
  return /^\d+$/.test(last) ? last : cleaned;
}

/**
 * Fetch game data from ESPN API.
 */
async function fetchGame(gameId) {
  const url = API_URL.replace('{game_id}', gameId);
  const res = await fetch(url, { headers: { 'User-Agent': 'BCFPlus/1.0' } });
  if (!res.ok) throw new Error(`ESPN API error: ${res.status} ${res.statusText}`);
  return res.json();
}

/**
 * Slugify a name for filenames.
 */
function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Parse drive start/end text like 'UGA 25' or '50' into yardsToEndzone.
 */
function yteFromText(text, possTeamAbbrev, homeAbbrev, awayAbbrev) {
  if (!text) return null;
  text = String(text).trim();
  if (text === '50') return 50;
  const parts = text.split(/\s+/);
  if (parts.length !== 2) return null;
  const [sideAbbrev, ylStr] = parts;
  const yl = parseInt(ylStr, 10);
  if (Number.isNaN(yl)) return null;
  const onOwnSide = sideAbbrev === possTeamAbbrev;
  return onOwnSide ? 100 - yl : yl;
}

/**
 * Get yardsToEndzone for the start or end of a drive.
 */
function getDriveYte(drive, pos, possTeamId, home, away) {
  const isHomePoss = possTeamId === home.id;
  const possAbbrev = isHomePoss ? home.abbrev : away.abbrev;
  const plays = drive.plays || [];

  if (plays.length && pos === 'start') {
    for (const p of plays) {
      const ptype = (p.type && p.type.text) || '';
      if (['Kickoff', 'Kickoff Return (Offense)', 'Penalty'].includes(ptype)) continue;
      const yte = (p.start && p.start.yardsToEndzone) || 0;
      if (yte > 0) return yte;
      break;
    }
  } else if (plays.length && pos === 'end') {
    const skipEnd = new Set([
      'Timeout', 'End of Half', 'End of Game', 'Penalty',
      'Kickoff', 'Kickoff Return (Offense)',
      'Punt', 'Punt Return (Offense)',
      'Pass Interception Return', 'Fumble Recovery (Opponent)',
      'Fumble Recovery (Own)', 'Blocked Field Goal',
      'Blocked Punt',
    ]);
    // On a turnover (or FGA), ESPN's end.yardsToEndzone reflects the *new* possessor's
    // perspective (e.g. ASU at own 8 = 92). We need the drive end from the
    // *offensive* team's perspective, so use start for the last play.
    // (PUNT excluded: we skip the punt play and use the prior play's end.)
    // FGA: on a missed FG, the ball goes to the opponent; end position is from their
    // perspective. The drive ended at the spot of the kick = start of the FG attempt.
    // ESPN returns "MISSED FG" in drive.result, not "FGA".
    const turnoverResults = new Set(['DOWNS', 'INT', 'FUMBLE', 'FGA', 'MISSED FG']);
    const isTurnover = turnoverResults.has(drive.result || '');
    const halfEndResults = new Set(['END OF HALF', 'END OF GAME']);
    const isHalfEnd = halfEndResults.has(drive.result || '');
    for (let i = plays.length - 1; i >= 0; i--) {
      const p = plays[i];
      const ptype = (p.type && p.type.text) || '';
      // For END OF HALF/GAME, the clock-expiration play has the true end position.
      // Use its start (ball position when clock hit 0) instead of skipping it.
      // ESPN uses "End Period" for end-of-half (not "End of Half").
      if (isHalfEnd && (ptype === 'End of Half' || ptype === 'End of Game' || ptype === 'End Period')) {
        const yte = (p.start && p.start.yardsToEndzone) || 0;
        if (yte > 0) return yte;
        break;
      }
      if (skipEnd.has(ptype)) continue;
      if (p.scoringPlay) {
        const yte = (p.start && p.start.yardsToEndzone) || 0;
        if (yte > 0) return yte;
      } else {
        let yte;
        if (isTurnover) {
          yte = (p.start && p.start.yardsToEndzone) || 0;
        } else {
          yte = (p.end && p.end.yardsToEndzone) || 0;
          if (yte <= 0) yte = (p.start && p.start.yardsToEndzone) || 0;
        }
        if (yte > 0) return yte;
      }
      break;
    }
  }

  const drivePos = drive[pos] || drive.start || {};
  const text = drivePos.text || '';
  return yteFromText(text, possAbbrev, home.abbrev, away.abbrev);
}

function firstPlayType(drive) {
  const plays = drive.plays || [];
  return plays.length ? ((plays[0].type && plays[0].type.text) || '') : '';
}

function driveHasKickoff(drive) {
  return firstPlayType(drive).includes('Kickoff');
}

function getExchangeType(drive, prevDrive, isHalfOpener) {
  if (isHalfOpener || driveHasKickoff(drive)) return 'KO';
  if (!prevDrive) return 'KO';
  return EXCHANGE_FROM_PREV_RESULT[prevDrive.result] || 'KO';
}

function getScoresAfterDrive(drive) {
  const plays = drive.plays || [];
  if (!plays.length) return [0, 0];
  const h = Math.max(...plays.map(p => p.homeScore || 0));
  const a = Math.max(...plays.map(p => p.awayScore || 0));
  return [h, a];
}

function isSpecialTeamsTd(drive) {
  const result = drive.result || '';
  if (result.includes('END OF HALF') && result.includes('TD')) return true;
  const offPlays = drive.offensivePlays || 0;
  const plays = drive.plays || [];
  if (offPlays === 0 && plays.length) {
    if (result === 'TD') return true;
    for (const p of plays) {
      const ptype = (p.type && p.type.text) || '';
      if (ptype.includes('Touchdown') && (ptype.includes('Kickoff') || ptype.includes('Punt') || ptype.includes('Return'))) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Split drives that span the halftime boundary.
 */
function splitCrossHalfDrives(drives) {
  const result = [];
  for (const drv of drives) {
    const plays = drv.plays || [];
    if (!plays.length) {
      result.push(drv);
      continue;
    }

    const h1Plays = plays.filter(p => (p.period && p.period.number) <= 2);
    const h2Plays = plays.filter(p => (p.period && p.period.number) >= 3);

    if (!h1Plays.length || !h2Plays.length) {
      result.push(drv);
      continue;
    }

    const h1Off = h1Plays.filter(p => {
      const t = (p.type && p.type.text) || '';
      return !['Kickoff', 'Kickoff Return (Offense)'].includes(t);
    });
    const h1Yards = h1Off.reduce((s, p) => s + (p.statYardage || 0), 0);

    const h1Drive = {
      ...drv,
      plays: h1Plays,
      result: 'END OF HALF',
      offensivePlays: h1Off.length,
      yards: h1Yards,
    };

    const h2Scoring = h2Plays.some(p => p.scoringPlay);
    const h2Drive = {
      ...drv,
      plays: h2Plays,
      result: h2Scoring ? 'TD' : 'END OF HALF',
      offensivePlays: 0,
      yards: 0,
      start: {
        ...(drv.start || {}),
        period: { type: 'quarter', number: 3 },
      },
      end: (h2Plays[h2Plays.length - 1].end || h2Plays[h2Plays.length - 1].start || {}),
    };

    result.push(h1Drive, h2Drive);
  }
  return result;
}

/**
 * Extract teams from ESPN header.
 */
function extractTeams(data) {
  const comps = data.header.competitions[0];
  const teams = {};
  for (const c of comps.competitors) {
    const t = c.team;
    const side = c.homeAway;
    teams[side] = {
      name: t.location || t.shortDisplayName || t.displayName,
      abbrev: t.abbreviation,
      color: '#' + (t.color || '333333'),
      id: t.id,
      score: parseInt(c.score, 10),
      winner: c.winner || false,
    };
  }
  return [teams.home, teams.away];
}

/**
 * Derive game title from ESPN metadata.
 */
function determineTitle(data) {
  const comps = data.header.competitions[0];
  const notes = comps.notes || [];
  if (notes.length) {
    const headline = notes[0].headline || '';
    if (headline) return headline;
  }
  const seasonType = (data.header.season && data.header.season.type) || 0;
  if (seasonType === 3) return 'College Football Playoff';
  return 'College Football';
}

/**
 * Convert raw ESPN API response to possession-flow JSON.
 */
function convertGame(data) {
  const [home, away] = extractTeams(data);
  const homeIsWinner = home.winner;
  const winner = homeIsWinner ? home : away;
  const loser = homeIsWinner ? away : home;

  const comps = data.header.competitions[0];
  const dateStr = comps.date.slice(0, 10);
  const title = determineTitle(data);

  const teamA = winner;
  const teamB = loser;

  const drives = splitCrossHalfDrives((data.drives && data.drives.previous) || []);
  const possessions = [];
  let gp = 0;
  let prevDrive = null;
  let prevHalf = null;

  for (let i = 0; i < drives.length; i++) {
    const drv = drives[i];
    gp += 1;
    const teamId = drv.team.id;
    let isHomePoss = teamId === home.id;
    let teamName = isHomePoss ? home.name : away.name;
    let oppName = isHomePoss ? away.name : home.name;

    const period = (drv.start && drv.start.period && drv.start.period.number) || 1;
    const half = period <= 2 ? 1 : 2;
    const isHalfOpener = half !== prevHalf;

    let espnResult = drv.result || '';
    if (!espnResult && i === drives.length - 1) espnResult = 'END OF GAME';
    const stPoss = isSpecialTeamsTd(drv);

    const [homeScore, awayScore] = getScoresAfterDrive(drv);
    const winnerScore = homeIsWinner ? homeScore : awayScore;
    const loserScore = homeIsWinner ? awayScore : homeScore;

    if (stPoss && prevDrive) {
      const [prevH, prevA] = getScoresAfterDrive(prevDrive);
      const homeGained = homeScore - prevH;
      const awayGained = awayScore - prevA;
      const scorerIsHome = homeGained > awayGained;
      if (scorerIsHome !== isHomePoss) {
        isHomePoss = scorerIsHome;
        teamName = isHomePoss ? home.name : away.name;
        oppName = isHomePoss ? away.name : home.name;
      }
    }

    let sy = getDriveYte(drv, 'start', teamId, home, away);
    let ey = getDriveYte(drv, 'end', teamId, home, away);
    let offPlays = drv.offensivePlays;
    let yds = drv.yards;

    if (stPoss) {
      sy = null;
      ey = null;
      offPlays = null;
      yds = null;
    } else if (espnResult === 'TD') {
      ey = 0;
    }

    let resultCode = RESULT_MAP[espnResult] || espnResult;
    if (stPoss) resultCode = '7';

    let exchange = getExchangeType(drv, prevDrive, isHalfOpener);
    if (stPoss && !isHalfOpener) {
      const fp = firstPlayType(drv);
      if (fp.includes('Kickoff')) exchange = 'KO Ret';
      else if (fp.includes('Punt')) exchange = 'Punt Block';
      else if (prevDrive) exchange = EXCHANGE_FROM_PREV_RESULT[prevDrive.result] || 'KO';
    }

    let isGarbage = false;
    if (i === drives.length - 1 && espnResult === 'END OF GAME' && (yds === null || yds <= 0)) {
      isGarbage = true;
    }

    possessions.push({
      gp,
      team: teamName,
      opponent: oppName,
      half,
      type: stPoss ? 'ST Poss' : 'Off Drive',
      sy,
      ey,
      plays: offPlays,
      yards: yds,
      result: resultCode,
      winnerScore,
      loserScore,
      exchangeType: exchange,
      isGarbage,
    });

    prevDrive = drv;
    prevHalf = half;
  }

  return {
    date: dateStr,
    title,
    teamA: { name: teamA.name, abbrev: teamA.abbrev, color: teamA.color, role: 'winner' },
    teamB: { name: teamB.name, abbrev: teamB.abbrev, color: teamB.color, role: 'loser' },
    finalScore: { winner: winner.score, loser: loser.score },
    possessions,
  };
}

/**
 * Generate output filename for a game.
 */
function outputFilename(game) {
  const a = slugify(game.teamA.name);
  const b = slugify(game.teamB.name);
  return `${game.date}-${a}-${b}.json`;
}

/**
 * Fetch an ESPN game and convert to possession-flow format.
 * @param {string} input - ESPN game ID or full URL
 * @returns {Promise<object>} Possession-flow game object
 */
async function fetchAndConvert(input) {
  const gameId = extractGameId(input);
  const raw = await fetchGame(gameId);
  return convertGame(raw);
}

// Public API
const espnToPossession = {
  extractGameId,
  fetchGame,
  convertGame,
  fetchAndConvert,
  outputFilename,
};

// Support both module and script usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = espnToPossession;
}
if (typeof window !== 'undefined') {
  window.espnToPossession = espnToPossession;
}
