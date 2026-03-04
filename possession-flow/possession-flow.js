function renderPossessionFlow(containerSelector, gameData) {
  const container = d3.select(containerSelector);
  container.selectAll('*').remove();

  const { teamA, teamB, possessions, finalScore } = gameData;

  const margin = { top: 16, right: 44, bottom: 0, left: 90 };
  const targetFieldWidth = 828;
  const totalCols = possessions.length;
  const colWidth = Math.max(28, targetFieldWidth / totalCols);
  const fieldWidth = totalCols * colWidth;
  const halfGap = 28;
  const h2First = possessions.find(p => p.half === 2);
  const fieldWidthWithGap = fieldWidth + (h2First ? halfGap : 0);
  const fieldHeight = 340;
  const endZoneH = 33;
  const tickerRowHeight = 13;
  const tickerPad = 12;
  const chartW = margin.left + fieldWidthWithGap + margin.right;
  const chartH = margin.top + endZoneH * 2 + fieldHeight + tickerPad + tickerRowHeight * 4 + 24;
  const gL = margin.left - 6, gR = margin.left + fieldWidthWithGap + 6;

  const C = {
    scoring: '#2c3e6b',
    normal: '#aaa',
    negative: '#d35400',
    fg: '#6b9fd4',
    startDot: '#666',
    grid: '#e8e8e8',
    exch: '#c8c8c8',
    bg: '#fff'
  };

  // ----- Coordinate mapping -----
  // SY/EY = yards from opponent end zone
  // chart y: 0 at top (teamA scores here) → 100 at bottom (teamB scores here)
  function chartY(sy, team) {
    return team === teamA.name ? sy : 100 - sy;
  }
  const yS = d3.scaleLinear().domain([0, 100]).range([margin.top + endZoneH, margin.top + endZoneH + fieldHeight]);
  const xGP = gp => {
    let x = margin.left + (gp - 1) * colWidth + colWidth / 2;
    if (h2First && gp >= h2First.gp) x += halfGap;
    return x;
  };

  function driveCol(p) {
    if (p.result === '7') return C.scoring;
    if (p.result === '3') return C.fg;
    if (p.yards !== null && p.yards < 0) return C.negative;
    return C.normal;
  }

  const RES = { P: 'Punt', '7': 'TD', '3': 'FG', N: 'Downs', H: 'Half', I: 'Int', F: 'Fum', FGA: 'FGA' };
  const resLabel = r => RES[r] || r;
  const exchLbl = t => ({ KO: 'KO', P: 'P', Int: 'Int', Downs: 'N', FGA: 'FGA', Fumble: 'Fum', 'Punt Block': '' }[t] || t);

  // Field position display string: sy = yards from opponent's end zone
  function fldStr(sy) {
    if (sy === 0) return '▸';
    const own = 100 - sy;
    if (own < 50) return `◁ ${own}`;
    if (own > 50) return `${sy} ▸`;
    return '50';
  }

  // For negative-yardage end position
  function fldStrNeg(ey) {
    const own = 100 - ey;
    return `◂ ${own}`;
  }

  function fmtDate(s) {
    return new Date(s + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }

  // ============ HEADER ============
  const wName = teamA.role === 'winner' ? teamA.name : teamB.name;
  const lName = teamA.role === 'winner' ? teamB.name : teamA.name;
  const hdr = container.append('div').attr('class', 'chart-header');
  hdr.append('h1').text(`${wName} ${finalScore.winner}, ${lName} ${finalScore.loser}`);
  hdr.append('span').attr('class', 'date').text(fmtDate(gameData.date));

  // ============ FLOW CHART SVG ============
  const wrap = container.append('div').attr('class', 'flow-chart-wrapper').style('position', 'relative');
  const svg = wrap.append('svg').attr('width', chartW).attr('height', chartH).attr('class', 'flow-svg');

  // ---- End zones ----
  {
    const defs = svg.append('defs');
    const strPat = defs.append('pattern')
      .attr('id', 'ez-stripe-pat')
      .attr('patternUnits', 'userSpaceOnUse')
      .attr('width', 16).attr('height', 16)
      .attr('patternTransform', 'rotate(-45)');
    strPat.append('line')
      .attr('x1', 0).attr('y1', 0).attr('x2', 16).attr('y2', 0)
      .attr('stroke', '#d0d0d0').attr('stroke-width', 1);

    const ezW = gR - gL;
    [
      { team: teamA, ezY: margin.top },
      { team: teamB, ezY: yS(100) }
    ].forEach(({ team, ezY }) => {
      const ezG = svg.append('g').attr('class', 'end-zone');

      // White background
      ezG.append('rect')
        .attr('x', gL).attr('y', ezY).attr('width', ezW).attr('height', endZoneH)
        .attr('fill', '#fff');

      // Grey diagonal line overlay
      ezG.append('rect')
        .attr('x', gL).attr('y', ezY).attr('width', ezW).attr('height', endZoneH)
        .attr('fill', 'url(#ez-stripe-pat)');

      // Goal line at the field boundary side of the end zone
      const glY = team === teamA ? ezY + endZoneH : ezY;
      ezG.append('line')
        .attr('x1', gL).attr('x2', gR)
        .attr('y1', glY).attr('y2', glY)
        .attr('stroke', '#ccc').attr('stroke-width', 1.5);

      // Team name: letters centered, spanning at most 50% of chart width
      const name = team.name.toUpperCase();
      const chars = name.split('');
      const n = chars.length;
      // Shift toward the outer edge (away from goal line) to avoid overlapping TD labels
      const midY = team === teamA
        ? ezY + endZoneH * 0.3
        : ezY + endZoneH * 0.7;
      const maxNameSpan = Math.min(ezW, chartW * 0.5);
      const nameStartX = gL + ezW / 2 - maxNameSpan / 2;
      chars.forEach((ch, i) => {
        if (ch === ' ') return;
        const lx = nameStartX + (maxNameSpan / n) * (i + 0.5);
        ezG.append('text')
          .attr('x', lx).attr('y', midY).attr('dy', '0.35em')
          .attr('text-anchor', 'middle')
          .attr('font-family', '"Helvetica Neue", Helvetica, Arial, sans-serif')
          .attr('font-size', '16').attr('font-weight', '900')
          .attr('fill', 'rgba(44, 62, 107, 0.32)')
          .text(ch);
      });
    });
  }

  // ---- Field band stripes (alternating per 10-yard segment) ----
  for (let v = 0; v < 100; v += 10) {
    if ((v / 10) % 2 === 0) continue; // only shade odd bands
    svg.append('rect')
      .attr('x', gL).attr('y', yS(v))
      .attr('width', gR - gL).attr('height', yS(v + 10) - yS(v))
      .attr('fill', 'rgba(0, 0, 0, 0.014)');
  }

  // ---- Field grid ----
  const yardVals = [10, 20, 30, 40, 50, 60, 70, 80, 90];
  const yardTxt = [10, 20, 30, 40, 50, 40, 30, 20, 10];

  yardVals.forEach((v, i) => {
    const y = yS(v);
    svg.append('line').attr('class', 'gridline').attr('x1', gL).attr('x2', gR).attr('y1', y).attr('y2', y);
    svg.append('text').attr('class', 'yard-label').attr('x', margin.left - 14).attr('y', y + 3).attr('text-anchor', 'end').text(yardTxt[i]);
    svg.append('text').attr('class', 'yard-label').attr('x', gR + 8).attr('y', y + 3).attr('text-anchor', 'start').text(yardTxt[i]);
  });


  // ---- Half divider ----
  const h1Last = possessions.filter(p => p.half === 1).slice(-1)[0];
  let halfX = null;
  if (h1Last && h2First) {
    halfX = (xGP(h1Last.gp) + xGP(h2First.gp)) / 2;
    svg.append('line').attr('class', 'half-divider')
      .attr('x1', halfX).attr('x2', halfX)
      .attr('y1', yS(0) - 4).attr('y2', yS(100) + 4);
    svg.append('text').attr('class', 'exchange-label')
      .attr('x', halfX).attr('y', yS(42))
      .style('font-size', '8px').text('Half');
  }

  // ---- Exchange curves (behind drives) ----
  const exchG = svg.append('g').attr('class', 'exchanges');
  const curveR = 16;

  // Builds a vertical-then-curve-right path from (sx,sy) to (dx,dy)
  function vtcPath(sx, sy, dx, dy) {
    const p = d3.path();
    const absDy = Math.abs(dy - sy);
    const absDx = Math.abs(dx - sx);
    const r = Math.min(curveR, absDy / 2, absDx);
    p.moveTo(sx, sy);
    if (absDy < 2) {
      p.lineTo(dx, dy);
    } else {
      const dir = dy > sy ? 1 : -1;
      p.lineTo(sx, dy - dir * r);
      p.quadraticCurveTo(sx, dy, sx + r, dy);
      if (sx + r < dx) p.lineTo(dx, dy);
    }
    return p.toString();
  }

  // Opening KO for each half (no prior possession to connect from)
  [1, 2].forEach(half => {
    const first = possessions.find(p => p.half === half);
    if (!first) return;
    if (first.type === 'ST Poss') return; // handled by ST Poss rendering below
    const kicker = first.opponent;
    const koChartPos = chartY(65, kicker);
    const koY = yS(koChartPos);
    const driveX = xGP(first.gp);
    const driveY = yS(chartY(first.sy, first.team));
    const koX = driveX - colWidth * 0.4;

    exchG.append('path').attr('class', 'exchange-curve')
      .attr('d', vtcPath(koX, koY, driveX, driveY));
    exchG.append('circle').attr('class', 'exchange-circle')
      .attr('cx', koX).attr('cy', koY).attr('r', 3.5);
    const koLabelY = koY < yS(50) ? koY - 8 : koY + 10;
    exchG.append('text').attr('class', 'exchange-label')
      .attr('x', koX).attr('y', koLabelY).attr('text-anchor', 'middle').text('KO');
    exchG.append('circle').attr('class', 'exchange-circle')
      .attr('cx', driveX).attr('cy', driveY).attr('r', 3.5);
  });

  for (let i = 1; i < possessions.length; i++) {
    const prev = possessions[i - 1];
    const curr = possessions[i];

    if (prev.half !== curr.half) continue;
    if (prev.type === 'ST Poss' && curr.exchangeType !== 'KO') continue;

    if (curr.exchangeType === 'Punt Block') {
      const mx = (xGP(prev.gp) + xGP(curr.gp)) / 2;
      const pey = yS(chartY(prev.ey, prev.team));
      exchG.append('text').attr('class', 'exchange-label').attr('x', mx).attr('y', pey - 5).text('Punt');
      exchG.append('text').attr('class', 'exchange-label').attr('x', mx).attr('y', pey + 5).text('Block');
      continue;
    }

    const x1 = xGP(prev.gp), x2 = xGP(curr.gp);
    const y1 = prev.type === 'ST Poss'
      ? (prev.team === teamA.name ? yS(0) : yS(100))
      : yS(chartY(prev.ey, prev.team));
    const y2 = yS(chartY(curr.sy, curr.team));
    const midX = (x1 + x2) / 2;

    if (curr.exchangeType === 'KO') {
      // Kickoff: KO waypoint, then curve to next drive.
      // The kicker is curr.opponent (the team that scored and kicked off to curr.team).
      // Using curr.opponent (not prev.team) correctly handles cases where the defensive
      // team scored (e.g. fumble return TD), meaning the same offensive team appears in
      // back-to-back possessions and prev.team would point to the wrong side.
      const koChartPos = chartY(65, curr.opponent);
      const koY = yS(koChartPos);

      // KO circle + label
      exchG.append('circle').attr('class', 'exchange-circle').attr('cx', midX).attr('cy', koY).attr('r', 3.5);
      const koLabelY = koY < yS(50) ? koY - 8 : koY + 10;
      exchG.append('text').attr('class', 'exchange-label')
        .attr('x', midX).attr('y', koLabelY).attr('text-anchor', 'middle').text('KO');

      // From KO, vertical-then-curve to next drive start
      exchG.append('path').attr('class', 'exchange-curve').attr('d', vtcPath(midX, koY, x2, y2));
      exchG.append('circle').attr('class', 'exchange-circle').attr('cx', x2).attr('cy', y2).attr('r', 3.5);

    } else {
      // Non-KO exchange (P, Int, Downs, FGA, Fumble):
      // vertical-then-curve from prev drive end to next drive start
      exchG.append('circle').attr('class', 'exchange-circle').attr('cx', x1).attr('cy', y1).attr('r', 3.5);
      exchG.append('path').attr('class', 'exchange-curve').attr('d', vtcPath(x1, y1, x2, y2));
      exchG.append('circle').attr('class', 'exchange-circle').attr('cx', x2).attr('cy', y2).attr('r', 3.5);
    }
  }

  // ---- Drive lines ----
  const drvG = svg.append('g').attr('class', 'drives');

  possessions.forEach(p => {
    if (p.type === 'ST Poss') return;

    const x = xGP(p.gp);
    const y1 = yS(chartY(p.sy, p.team));
    const y2 = yS(chartY(p.ey, p.team));
    const col = driveCol(p);
    const op = p.isGarbage ? 0.25 : 1;

    const g = drvG.append('g').attr('class', 'drive-group').attr('data-gp', p.gp).style('opacity', op);
    g.append('line').attr('class', 'drive-line').attr('x1', x).attr('x2', x).attr('y1', y1).attr('y2', y2).attr('stroke', col);
    g.append('circle').attr('class', 'drive-dot').attr('cx', x).attr('cy', y1).attr('r', 4).attr('fill', C.startDot);
    g.append('circle').attr('class', 'drive-dot').attr('cx', x).attr('cy', y2).attr('r', 4).attr('fill', col);

    // Result label at the terminating dot
    const goesUp = p.team === teamA.name;
    if (p.result === '7') {
      const ty = goesUp ? yS(0) - 8 : yS(100) + 12;
      g.append('text').attr('class', 'scoring-annotation').attr('x', x).attr('y', ty).attr('fill', C.scoring).text('TD');
    } else if (p.result === '3') {
      g.append('text').attr('class', 'scoring-annotation').attr('x', x).attr('y', y2 + (goesUp ? -8 : 14)).attr('fill', C.fg).text('FG');
    } else if (p.result === 'H') {
      g.append('text').attr('class', 'drive-result-label').attr('x', x).attr('y', y2 + (goesUp ? -8 : 12))
        .attr('fill', p.isGarbage ? C.negative : '#999').text('Half');
    } else {
      const label = resLabel(p.result);
      // For negative yardage, put label on opposite side of dot so it's not obscured by the drive line
      const ly = y2 + (p.yards < 0 ? (goesUp ? 12 : -8) : (goesUp ? -8 : 12));
      g.append('text').attr('class', 'drive-result-label').attr('x', x).attr('y', ly)
        .attr('fill', p.yards < 0 ? C.negative : '#bbb').text(label);
    }
  });

  // ---- Special Teams TDs (KO Ret, Punt Block, etc.) ----
  possessions.filter(p => p.type === 'ST Poss').forEach(pb => {
    const prev = possessions.find(p => p.gp === pb.gp - 1);
    const x = xGP(pb.gp);
    const toY = pb.team === teamA.name ? yS(0) : yS(100);
    const g = drvG.append('g').attr('class', 'drive-group').attr('data-gp', pb.gp);

    const isHalfOpener = !prev || prev.half !== pb.half;
    const isPuntBlock = pb.exchangeType === 'Punt Block' && prev;
    let fromY;
    if (isHalfOpener) {
      const kicker = pb.opponent;
      const koChartPos = chartY(65, kicker);
      const koY = yS(koChartPos);
      const koX = x - colWidth * 0.4;

      exchG.append('circle').attr('class', 'exchange-circle').attr('cx', koX).attr('cy', koY).attr('r', 3.5);
      const koLabelY = koY < yS(50) ? koY - 8 : koY + 10;
      exchG.append('text').attr('class', 'exchange-label')
        .attr('x', koX).attr('y', koLabelY).attr('text-anchor', 'middle').text('KO');

      fromY = koY;
    } else if (isPuntBlock && prev.ey != null) {
      // Block spot = where punt drive ended. Use prev.team so line starts at punt drive's end (connects visually).
      fromY = yS(chartY(prev.ey, prev.team));
    } else {
      fromY = yS(chartY(prev.ey, prev.team));
    }
    g.append('line').attr('x1', x).attr('x2', x).attr('y1', fromY).attr('y2', toY)
      .attr('stroke', C.scoring).attr('stroke-width', 2.5).attr('stroke-dasharray', '5,3');

    g.append('circle').attr('cx', x).attr('cy', toY).attr('r', 4).attr('fill', C.scoring);
    const ty = pb.team === teamA.name ? yS(0) - 8 : yS(100) + 12;
    g.append('text').attr('class', 'scoring-annotation').attr('x', x).attr('y', ty).attr('fill', C.scoring).text('TD');
  });

  // ============ SCORE TICKER ============
  const tY = margin.top + endZoneH * 2 + fieldHeight + tickerPad;
  const tLabelX = 4;

  // Row labels
  [
    { label: 'Game Poss #', dy: 0 },
    { label: 'Possession', dy: tickerRowHeight },
    { label: teamB.name, dy: tickerRowHeight * 2 + 6 },
    { label: teamA.name, dy: tickerRowHeight * 3 + 6 }
  ].forEach(r => {
    svg.append('text').attr('class', 'ticker-label')
      .attr('x', tLabelX).attr('y', tY + r.dy + 10).attr('text-anchor', 'start').text(r.label);
  });

  if (halfX) {
    svg.append('text').attr('class', 'ticker-label').attr('x', halfX).attr('y', tY + tickerRowHeight * 2 + 16)
      .attr('text-anchor', 'middle').attr('fill', '#bbb').text('Half');
  }

  possessions.forEach((p, i) => {
    const x = xGP(p.gp);
    const prev = i > 0 ? possessions[i - 1] : null;

    svg.append('text').attr('class', 'ticker-text').attr('x', x).attr('y', tY + 10).text(p.gp);

    const ab = p.team === teamA.name ? teamA.abbrev : teamB.abbrev;
    svg.append('text').attr('class', 'ticker-text').attr('x', x).attr('y', tY + tickerRowHeight + 10).text(ab);

    const lChg = !prev || p.loserScore !== prev.loserScore;
    const lDelta = lChg ? (prev ? p.loserScore - prev.loserScore : p.loserScore) : 0;
    const lFill = lChg && lDelta === 3 ? C.fg : (lChg && lDelta >= 6 ? C.scoring : null);
    svg.append('text').attr('class', `ticker-text ${lChg ? 'score-changed' : ''}`)
      .attr('x', x).attr('y', tY + tickerRowHeight * 2 + 16)
      .style('fill', lFill).text(p.loserScore);

    const wChg = !prev || p.winnerScore !== prev.winnerScore;
    const wDelta = wChg ? (prev ? p.winnerScore - prev.winnerScore : p.winnerScore) : 0;
    const wFill = wChg && wDelta === 3 ? C.fg : (wChg && wDelta >= 6 ? C.scoring : null);
    svg.append('text').attr('class', `ticker-text ${wChg ? 'score-changed' : ''}`)
      .attr('x', x).attr('y', tY + tickerRowHeight * 3 + 16)
      .style('fill', wFill).text(p.winnerScore);
  });

  svg.append('text').attr('class', 'ticker-label')
    .attr('x', xGP(totalCols) + colWidth / 2 + 4).attr('y', tY + tickerRowHeight * 2.5 + 16)
    .attr('text-anchor', 'start').text('Final');

  // ============ DRIVE SUMMARY TABLES ============
  const summDiv = container.append('div').attr('class', 'summary-section');

  // Draws a field-position arrow in the summary table using a fixed 3-slot layout:
  //   [left-arrow slot (8px)] [number slot (13px, right-aligned)] [right-arrow slot (7px)]
  // This keeps all columns perfectly aligned regardless of which slots are occupied.
  // x, y  = cell left-edge x and text-baseline y within the row group
  // sy    = yards from opponent end zone (0 = end zone, 50 = midfield, >50 = own territory)
  // color = fill color for both arrow and number; bold = bold the yard number
  function drawSummaryArrow(g, x, y, sy, color, bold) {
    const aw = 5;     // arrow polygon width
    const ah = 4;     // arrow half-height
    const aSlot = 8;  // reserved width for each arrow slot
    const nSlot = 13; // reserved width for the number (right-aligned within it)
    const cy = y - 3; // vertical center of arrow relative to text baseline
    const fw = bold ? '700' : '400';

    // Fixed x anchors
    const lArrowX  = x;                    // left arrow tip
    const numEndX  = x + aSlot + nSlot;    // right edge of number slot (text-anchor=end)
    const rArrowX  = x + aSlot + nSlot + 1; // left edge of right arrow

    const drawLeftArrow = () =>
      g.append('polygon')
        .attr('points', `${lArrowX},${cy} ${lArrowX+aw},${cy-ah} ${lArrowX+aw},${cy+ah}`)
        .attr('fill', color);

    const drawRightArrow = () =>
      g.append('polygon')
        .attr('points', `${rArrowX},${cy-ah} ${rArrowX},${cy+ah} ${rArrowX+aw},${cy}`)
        .attr('fill', color);

    const drawNum = (txt) =>
      g.append('text').attr('x', numEndX).attr('y', y)
        .attr('text-anchor', 'end').attr('fill', color).attr('font-weight', fw).text(txt);

    if (sy === 0) {
      drawRightArrow(); // end zone: right arrow only
    } else if (sy > 50) {
      drawLeftArrow(); drawNum(100 - sy); // own territory: ◄ + own-yard
    } else if (sy < 50) {
      drawNum(sy); drawRightArrow();      // opponent territory: yard + ►
    } else {
      drawNum('50');                      // midfield: number only
    }
  }

  [teamA, teamB].forEach(team => {
    const drives = possessions.filter(p => p.team === team.name && p.type === 'Off Drive');
    const panel = summDiv.append('div').attr('class', 'summary-panel');
    panel.append('h2').text(`${team.name} Offensive Drives`);

    const rh = 16, halfGap = 14;
    const hasH2 = drives.some(d => d.half === 2);
    const svgW = 480;
    const rows = drives.length + (hasH2 ? 0.9 : 0);
    const svgH = rows * rh + 20;
    const ss = panel.append('svg').attr('width', svgW).attr('height', svgH).attr('class', 'summary-svg');

    const col = { gp: 2, dr: 30, st: 60, en: 104, pl: 142, yd: 170, res: 200, bar: 242 };
    const barEnd = svgW - 8;
    // Football field scale: 100 = own end zone (left), 0 = opponent end zone (right)
    const fieldScale = d3.scaleLinear().domain([100, 0]).range([col.bar, barEnd]);

    // Football field yard markers (yards from opponent end zone: 10,20,...,50,...,20,10)
    const yardMarkers = [90, 80, 70, 60, 50, 40, 30, 20, 10];

    // Header row
    const hy = 8;
    [
      [col.gp, 'gp'], [col.dr, 'drive'], [col.st, 'start'], [col.en, 'end'],
      [col.pl, 'plays'], [col.yd, 'yards'], [col.res, 'result'],
      [col.bar, 'G'], [barEnd - 4, 'G']
    ].forEach(([x, t]) => {
      ss.append('text').attr('x', x).attr('y', hy).style('font-size', '7px').style('fill', '#bbb').style('font-weight', '600').text(t);
    });
    ss.append('text').attr('x', col.bar - 6).attr('y', hy).style('font-size', '8px').style('fill', '#bbb').text('→');

    // Football field grid (yard lines) in bar area
    const gridTop = hy + 2, gridBottom = svgH - 4;
    const fg = ss.append('g').attr('class', 'field-grid');
    yardMarkers.forEach((yd, i) => {
      const x = fieldScale(yd);
      fg.append('line').attr('x1', x).attr('x2', x).attr('y1', gridTop).attr('y2', gridBottom)
        .style('stroke', '#e8e8e8').style('stroke-width', 0.5);
    });

    let dn = 0, yOff = hy + 10;

    [1, 2].forEach(half => {
      const hd = drives.filter(d => d.half === half);
      if (!hd.length) return;
      if (half === 2 && hasH2) yOff += halfGap;

      hd.forEach(p => {
        dn++;
        const dNum = p.isGarbage ? '-' : dn;
        if (p.isGarbage) dn--;

        const g = ss.append('g')
          .attr('class', `summary-row ${p.isGarbage ? 'garbage' : ''}`)
          .attr('data-gp', p.gp)
          .attr('transform', `translate(0, ${yOff})`);

        g.append('text').attr('x', col.gp).attr('y', 0).text(p.gp);
        g.append('text').attr('x', col.dr).attr('y', 0).text(dNum);

        // Start field position — always neutral grey arrow
        drawSummaryArrow(g, col.st, 0, p.sy, '#999', false);

        // End field position — arrow colored by drive result
        const isTD = p.result === '7';
        const isFG = p.result === '3';
        const eColor = isTD ? C.scoring : (isFG ? C.fg : (p.yards < 0 ? C.negative : '#888'));
        drawSummaryArrow(g, col.en, 0, p.ey, eColor, isTD || isFG);

        g.append('text').attr('x', col.pl).attr('y', 0).text(p.plays);

        const isScoring = p.result === '7' || p.result === '3';
        g.append('text').attr('x', col.yd).attr('y', 0)
          .attr('font-weight', isScoring ? '700' : '400')
          .attr('fill', isScoring ? C.scoring : (p.yards < 0 ? C.negative : '#555'))
          .text(p.yards);

        g.append('text').attr('x', col.res).attr('y', 0).attr('font-weight', '600').text(resLabel(p.result));

        // Bar: spatial field position (start/end yard lines on football field)
        let bc = '#ddd';
        if (p.result === '7') bc = C.scoring;
        else if (p.result === '3') bc = C.fg;
        else if (p.yards < 0) bc = C.negative;

        let barX, barW;
        if (p.yards < 0) {
          // Negative yardage: small indicator at start position
          barX = fieldScale(p.sy) - 2;
          barW = 4;
        } else {
          const x1 = fieldScale(p.sy);
          const x2 = fieldScale(p.ey);
          barX = Math.min(x1, x2);
          barW = Math.max(Math.abs(x2 - x1), 2);
        }

        g.append('rect').attr('class', 'summary-bar')
          .attr('x', barX).attr('y', -8).attr('width', barW).attr('height', 10)
          .attr('fill', bc).attr('rx', 1);

        yOff += rh;
      });
    });
  });

  // ============ TOOLTIP ============
  let tip = d3.select('.tooltip');
  if (tip.empty()) tip = d3.select('body').append('div').attr('class', 'tooltip');

  function showTip(ev, p) {
    let h = `<strong>GP ${p.gp}: ${p.team}</strong><br>`;
    if (p.type === 'ST Poss') {
      h += `Special Teams TD (${p.exchangeType})`;
    } else {
      h += `${p.plays} plays, ${p.yards} yards<br>`;
      const startStr = fldStr(p.sy).replace('◁', 'own').replace('▸', 'opp');
      const endStr = p.ey === 0 ? 'End Zone (TD)' : fldStr(p.ey).replace('◁', 'own').replace('▸', 'opp');
      h += `${startStr} → ${endStr}<br>`;
      h += `Result: ${resLabel(p.result)}`;
    }
    h += `<br>Score: ${teamA.name} ${p.winnerScore}, ${teamB.name} ${p.loserScore}`;
    tip.html(h).style('left', (ev.pageX + 14) + 'px').style('top', (ev.pageY - 10) + 'px').classed('visible', true);
  }
  function hideTip() { tip.classed('visible', false); }

  // ============ CLICK-TO-HIGHLIGHT ============
  let sel = null;
  function toggle(gp) {
    if (sel === gp) {
      sel = null;
      d3.selectAll('.drive-group, .summary-row').classed('dimmed', false).classed('highlighted', false);
      return;
    }
    sel = gp;
    d3.selectAll('.drive-group').classed('dimmed', true).classed('highlighted', false);
    d3.selectAll('.summary-row').classed('dimmed', true).classed('highlighted', false);
    d3.selectAll(`[data-gp="${gp}"]`).classed('dimmed', false).classed('highlighted', true);
  }

  d3.selectAll('.drive-group').each(function () {
    const el = d3.select(this), gp = +el.attr('data-gp');
    const p = possessions.find(q => q.gp === gp);
    el.on('mouseover', e => showTip(e, p))
      .on('mousemove', e => tip.style('left', (e.pageX + 14) + 'px').style('top', (e.pageY - 10) + 'px'))
      .on('mouseout', hideTip)
      .on('click', () => toggle(gp));
  });

  d3.selectAll('.summary-row').each(function () {
    const el = d3.select(this), gp = +el.attr('data-gp');
    const p = possessions.find(q => q.gp === gp);
    el.on('mouseover', e => showTip(e, p))
      .on('mousemove', e => tip.style('left', (e.pageX + 14) + 'px').style('top', (e.pageY - 10) + 'px'))
      .on('mouseout', hideTip)
      .on('click', () => toggle(gp));
  });

  svg.on('click', e => {
    if (e.target === svg.node()) {
      sel = null;
      d3.selectAll('.drive-group, .summary-row').classed('dimmed', false).classed('highlighted', false);
    }
  });

  // ============ EXPORT ============
  container.append('button').attr('class', 'export-btn').text('Export PNG').on('click', () => {
    const str = new XMLSerializer().serializeToString(svg.node());
    const cvs = document.createElement('canvas');
    const sc = 2;
    cvs.width = chartW * sc; cvs.height = chartH * sc;
    const ctx = cvs.getContext('2d');
    ctx.scale(sc, sc);
    const img = new Image();
    const blob = new Blob([str], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, cvs.width, cvs.height);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      cvs.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'possession-flow.png'; a.click(); });
    };
    img.src = url;
  });
}
