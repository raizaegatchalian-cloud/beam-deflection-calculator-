/**
 * BeamStudio — High-DPI Interactive Engineering Diagram Suite (Canvas 2D)
 * Renders:
 *  - Free-Body & Loading Diagram (FBD)
 *  - Shear Force Diagram V(x), Bending Moment Diagram M(x), Slope θ(x), Deflection y(x)
 *  - Moment-Area Diagrams: Decomposed M/EI Curvature Diagram (with Areas A_i & Centroids x̄_i)
 *    + Elastic Curve Reference Tangent & Tangential Deviation Diagram (t_{B/A}, t_{max/A}, θ_ref)
 *  - Conjugate Beam Diagrams: Transformed Conjugate Beam Schematic (Conjugate Supports + w* = M/EI Load)
 *    + Conjugate Shear V*(x) = θ(x) + Conjugate Moment M*(x) = y(x)
 *  - 3-Method Comparison Overlay Chart
 * Features synchronized hover crosshair inspection across all active canvases & the 3D viewport!
 */
(function (global) {
  'use strict';

  const BeamStudio = (global.BeamStudio = global.BeamStudio || {});

  function getColors(dark) {
    if (dark) {
      return {
        bg: 'transparent',
        grid: 'rgba(205, 196, 220, 0.12)',
        axis: 'rgba(243, 238, 248, 0.45)',
        text: '#f3eef8',
        muted: '#cdc4dc',
        aurora: '#8ea4c4',
        auroraFill: 'rgba(142, 164, 196, 0.24)',
        wisteria: '#a58ec4',
        wisteriaFill: 'rgba(165, 142, 196, 0.26)',
        mauve: '#d482a9',
        mauveFill: 'rgba(212, 130, 169, 0.24)',
        beam: '#cdc4dc',
        pillBg: 'rgba(42, 31, 61, 0.94)',
        pillBorder: 'rgba(205, 196, 220, 0.35)',
        probe: '#f3eef8'
      };
    }
    return {
      bg: 'transparent',
      grid: 'rgba(110, 90, 136, 0.10)',
      axis: 'rgba(62, 46, 86, 0.48)',
      text: '#261d36',
      muted: '#635678',
      aurora: '#557cb3',
      auroraFill: 'rgba(142, 164, 196, 0.30)',
      wisteria: '#6e5a88',
      wisteriaFill: 'rgba(110, 90, 136, 0.22)',
      mauve: '#a8527d',
      mauveFill: 'rgba(168, 82, 125, 0.20)',
      beam: '#3c2e54',
      pillBg: 'rgba(243, 238, 248, 0.96)',
      pillBorder: 'rgba(110, 90, 136, 0.32)',
      probe: '#6e5a88'
    };
  }

  function prepCanvas(canvas) {
    const dpr = Math.min(global.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(280, Math.round(rect.width || canvas.parentElement?.clientWidth || 640));
    const h = Math.max(150, Math.round(rect.height || Number(canvas.dataset.height) || 210));
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  function drawRoundedPill(ctx, x, y, text, bg, border, fg, align = 'center') {
    ctx.save();
    ctx.font = '600 11px "Inter", "Segoe UI", sans-serif';
    const tw = ctx.measureText(text).width;
    const pw = tw + 14;
    const ph = 20;
    let rx = x - pw / 2;
    if (align === 'left') rx = x;
    else if (align === 'right') rx = x - pw;
    const ry = y - ph / 2;

    ctx.fillStyle = bg;
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(rx, ry, pw, ph, 10);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, rx + pw / 2, ry + ph / 2 + 0.5);
    ctx.restore();
  }

  function drawArrow2D(ctx, x1, y1, x2, y2, color, lw = 2, headSize = 7) {
    const ang = Math.atan2(y2 - y1, x2 - x1);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headSize * Math.cos(ang - 0.42), y2 - headSize * Math.sin(ang - 0.42));
    ctx.lineTo(x2 - headSize * Math.cos(ang + 0.42), y2 - headSize * Math.sin(ang + 0.42));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawSupportSymbol2D(ctx, type, sx, sy, color, mutedColor, isRightFixed = false) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;

    if (type === 'pin') {
      ctx.beginPath();
      ctx.moveTo(sx, sy + 4);
      ctx.lineTo(sx - 11, sy + 22);
      ctx.lineTo(sx + 11, sy + 22);
      ctx.closePath();
      ctx.fillStyle = 'rgba(110, 90, 136, 0.22)';
      ctx.fill();
      ctx.stroke();
      // Ground hatch
      ctx.beginPath();
      ctx.moveTo(sx - 16, sy + 22);
      ctx.lineTo(sx + 16, sy + 22);
      ctx.stroke();
      for (let i = -12; i <= 12; i += 6) {
        ctx.beginPath();
        ctx.moveTo(sx + i, sy + 22);
        ctx.lineTo(sx + i - 4, sy + 28);
        ctx.stroke();
      }
    } else if (type === 'roller') {
      ctx.beginPath();
      ctx.moveTo(sx, sy + 4);
      ctx.lineTo(sx - 10, sy + 18);
      ctx.lineTo(sx + 10, sy + 18);
      ctx.closePath();
      ctx.fillStyle = 'rgba(142, 164, 196, 0.25)';
      ctx.fill();
      ctx.stroke();
      for (const off of [-6, 6]) {
        ctx.beginPath();
        ctx.arc(sx + off, sy + 22, 3.2, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(sx - 16, sy + 26);
      ctx.lineTo(sx + 16, sy + 26);
      ctx.stroke();
    } else if (type === 'fixed') {
      const dir = isRightFixed ? 1 : -1;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(sx, sy - 26);
      ctx.lineTo(sx, sy + 26);
      ctx.stroke();
      ctx.lineWidth = 1.5;
      for (let yy = -22; yy <= 22; yy += 8) {
        ctx.beginPath();
        ctx.moveTo(sx, sy + yy);
        ctx.lineTo(sx + dir * 10, sy + yy + 6);
        ctx.stroke();
      }
    } else if (type === 'hinge') {
      ctx.fillStyle = '#f3eef8';
      ctx.beginPath();
      ctx.arc(sx, sy, 6.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (type === 'free') {
      ctx.fillStyle = mutedColor;
      ctx.font = '600 10px "Inter", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('FREE', sx, sy + 24);
    }
    ctx.restore();
  }

  /**
   * 1. Free-Body & Applied Loads Schematic
   */
  function drawFBD(canvas, sol, opts = {}) {
    const { ctx, w, h } = prepCanvas(canvas);
    const C = getColors(opts.dark);
    const pad = { l: 64, r: 34, t: 38, b: 44 };
    const plotW = w - pad.l - pad.r;
    const beamY = h * 0.56;
    const L = sol.input.L;
    const toX = (x) => pad.l + (x / L) * plotW;

    // Subtle x-grid ticks
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 6; i++) {
      const gx = pad.l + (plotW * i) / 6;
      ctx.beginPath();
      ctx.moveTo(gx, pad.t - 10);
      ctx.lineTo(gx, h - pad.b + 8);
      ctx.stroke();
    }

    // Beam body
    ctx.save();
    ctx.strokeStyle = C.beam;
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(toX(0), beamY);
    ctx.lineTo(toX(L), beamY);
    ctx.stroke();
    ctx.restore();

    // Supports
    for (const sup of sol.input.supports) {
      drawSupportSymbol2D(ctx, sup.type, toX(sup.x), beamY, C.wisteria, C.muted, sup.x > L * 0.5);
    }

    // Loads
    let maxW = 1;
    for (const ld of sol.input.loads) {
      if (ld.type === 'UDL') maxW = Math.max(maxW, Math.abs(ld.w));
      if (ld.type === 'UVL') maxW = Math.max(maxW, Math.abs(ld.w1), Math.abs(ld.w2));
    }

    for (const ld of sol.input.loads) {
      if (ld.type === 'Point') {
        const sx = toX(ld.a);
        const down = ld.P >= 0;
        drawArrow2D(ctx, sx, down ? beamY - 58 : beamY + 58, sx, down ? beamY - 6 : beamY + 6, C.mauve, 2.4, 8);
        drawRoundedPill(ctx, sx, down ? beamY - 70 : beamY + 70, `${ld.P} kN`, C.pillBg, C.mauve, C.mauve);
      } else if (ld.type === 'UDL' || ld.type === 'UVL') {
        const x1 = toX(ld.a);
        const x2 = toX(ld.b);
        const w1 = ld.type === 'UDL' ? ld.w : ld.w1;
        const w2 = ld.type === 'UDL' ? ld.w : ld.w2;
        const h1 = (Math.abs(w1) / maxW) * 44;
        const h2 = (Math.abs(w2) / maxW) * 44;
        const s1 = w1 >= 0 ? -1 : 1;
        const s2 = w2 >= 0 ? -1 : 1;

        ctx.fillStyle = C.mauveFill;
        ctx.beginPath();
        ctx.moveTo(x1, beamY + s1 * 5);
        ctx.lineTo(x1, beamY + s1 * (h1 + 8));
        ctx.lineTo(x2, beamY + s2 * (h2 + 8));
        ctx.lineTo(x2, beamY + s2 * 5);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = C.mauve;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(x1, beamY + s1 * (h1 + 8));
        ctx.lineTo(x2, beamY + s2 * (h2 + 8));
        ctx.stroke();

        const steps = Math.max(4, Math.min(14, Math.round((x2 - x1) / 26)));
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const ax = x1 + (x2 - x1) * t;
          const wCur = w1 + (w2 - w1) * t;
          const ah = (Math.abs(wCur) / maxW) * 44;
          const dir = wCur >= 0 ? -1 : 1;
          if (Math.abs(wCur) > 1e-6) {
            drawArrow2D(ctx, ax, beamY + dir * (ah + 8), ax, beamY + dir * 6, C.mauve, 1.4, 5);
          }
        }
        const lbl = ld.type === 'UDL' ? `${ld.w} kN/m` : `${ld.w1}→${ld.w2} kN/m`;
        drawRoundedPill(ctx, 0.5 * (x1 + x2), beamY - Math.max(h1, h2) - 22, lbl, C.pillBg, C.mauve, C.mauve);
      } else if (ld.type === 'Moment') {
        const sx = toX(ld.a);
        ctx.save();
        ctx.strokeStyle = C.wisteria;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(sx, beamY, 18, -Math.PI * 0.75, Math.PI * 0.65);
        ctx.stroke();
        ctx.restore();
        drawRoundedPill(ctx, sx, beamY - 32, `${ld.M} kN·m ${ld.M >= 0 ? '↺' : '↻'}`, C.pillBg, C.wisteria, C.wisteria);
      }
    }

    // Reactions
    for (const sup of sol.input.supports) {
      const sx = toX(sup.x);
      const R = sup.id === 'A' ? sol.reactions.RA : sol.reactions.RB;
      const M = sup.id === 'A' ? sol.reactions.MA : sol.reactions.MB;
      let txt = `R${sup.id}=${R.toFixed(2)} kN`;
      if (sup.type === 'fixed' && Math.abs(M) > 1e-4) {
        txt += ` | M${sup.id}=${M.toFixed(1)}`;
      }
      const align = sup.x < L * 0.15 ? 'left' : sup.x > L * 0.85 ? 'right' : 'center';
      drawRoundedPill(ctx, sx, h - 16, txt, C.pillBg, C.aurora, C.aurora, align);
    }

    // Probe line
    if (opts.probeX !== null && opts.probeX !== undefined) {
      const px = toX(opts.probeX);
      ctx.save();
      ctx.strokeStyle = C.probe;
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(px, 8);
      ctx.lineTo(px, h - 8);
      ctx.stroke();
      ctx.restore();
    }

    return { pad, plotW, L };
  }

  /**
   * 2. General Engineering Curve Chart (SFD, BMD, Slope, Deflection, Conjugate V*, Conjugate M*)
   */
  function drawCurveChart(canvas, xArr, yArr, L, opts = {}) {
    const { ctx, w, h } = prepCanvas(canvas);
    const C = getColors(opts.dark);
    const pad = { l: 64, r: 34, t: 26, b: 32 };
    const plotW = w - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;

    const strokeCol = opts.color === 'aurora' ? C.aurora : opts.color === 'mauve' ? C.mauve : C.wisteria;
    const fillCol = opts.color === 'aurora' ? C.auroraFill : opts.color === 'mauve' ? C.mauveFill : C.wisteriaFill;

    let minY = 0;
    let maxY = 0;
    for (const v of yArr) {
      if (v < minY) minY = v;
      if (v > maxY) maxY = v;
    }
    const spanY = Math.max(maxY - minY, 1e-9);
    const padY = spanY * 0.18;
    const yLo = minY - padY;
    const yHi = maxY + padY;

    const toX = (x) => pad.l + (x / L) * plotW;
    const toY = (y) => pad.t + ((yHi - y) / (yHi - yLo)) * plotH;
    const zeroY = toY(0);

    // Grid lines
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    ctx.font = '500 10px "Inter", sans-serif';
    ctx.fillStyle = C.muted;

    for (let i = 0; i <= 4; i++) {
      const val = yLo + ((yHi - yLo) * i) / 4;
      const gy = toY(val);
      ctx.beginPath();
      ctx.moveTo(pad.l, gy);
      ctx.lineTo(w - pad.r, gy);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      const lbl = Math.abs(val) < 1e-9 ? '0' : Math.abs(val) >= 1000 || (Math.abs(val) > 0 && Math.abs(val) < 0.01) ? val.toExponential(1) : val.toFixed(2);
      ctx.fillText(lbl, pad.l - 8, gy);
    }

    for (let i = 0; i <= 6; i++) {
      const xv = (L * i) / 6;
      const gx = toX(xv);
      ctx.beginPath();
      ctx.moveTo(gx, pad.t);
      ctx.lineTo(gx, h - pad.b);
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(`${xv.toFixed(1)}m`, gx, h - pad.b + 7);
    }

    // Zero baseline
    ctx.strokeStyle = C.axis;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(pad.l, zeroY);
    ctx.lineTo(w - pad.r, zeroY);
    ctx.stroke();

    // Filled Area
    ctx.beginPath();
    ctx.moveTo(toX(xArr[0]), zeroY);
    for (let i = 0; i < xArr.length; i++) {
      ctx.lineTo(toX(xArr[i]), toY(yArr[i]));
    }
    ctx.lineTo(toX(xArr[xArr.length - 1]), zeroY);
    ctx.closePath();
    ctx.fillStyle = fillCol;
    ctx.fill();

    // Main Curve Stroke
    ctx.beginPath();
    for (let i = 0; i < xArr.length; i++) {
      const px = toX(xArr[i]);
      const py = toY(yArr[i]);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = strokeCol;
    ctx.lineWidth = 2.4;
    ctx.stroke();

    // Annotate peak absolute value
    let peakIdx = 0;
    let peakAbs = -1;
    for (let i = 0; i < yArr.length; i++) {
      if (Math.abs(yArr[i]) > peakAbs) {
        peakAbs = Math.abs(yArr[i]);
        peakIdx = i;
      }
    }
    if (peakAbs > 1e-11) {
      const px = toX(xArr[peakIdx]);
      const py = toY(yArr[peakIdx]);
      ctx.fillStyle = strokeCol;
      ctx.beginPath();
      ctx.arc(px, py, 4.5, 0, Math.PI * 2);
      ctx.fill();
      const valTxt = `${yArr[peakIdx].toFixed(opts.decimals ?? 2)} ${opts.unit || ''} @ ${xArr[peakIdx].toFixed(2)}m`;
      const align = xArr[peakIdx] < L * 0.2 ? 'left' : xArr[peakIdx] > L * 0.8 ? 'right' : 'center';
      const labelY = py < pad.t + 26 ? py + 18 : py - 18;
      drawRoundedPill(ctx, px, labelY, valTxt, C.pillBg, strokeCol, strokeCol, align);
    }

    // Y-axis unit label
    ctx.save();
    ctx.fillStyle = C.muted;
    ctx.font = '600 10px "Inter", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(opts.yLabel || '', pad.l + 4, 13);
    ctx.restore();

    // Synchronized Hover Probe
    if (opts.probeX !== null && opts.probeX !== undefined) {
      const px = toX(opts.probeX);
      // Nearest sample
      let bestI = 0;
      let bestD = Infinity;
      for (let i = 0; i < xArr.length; i++) {
        const d = Math.abs(xArr[i] - opts.probeX);
        if (d < bestD) { bestD = d; bestI = i; }
      }
      const py = toY(yArr[bestI]);
      ctx.save();
      ctx.strokeStyle = C.probe;
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(px, pad.t);
      ctx.lineTo(px, h - pad.b);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = strokeCol;
      ctx.strokeStyle = '#f3eef8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    return { pad, plotW, L };
  }

  /**
   * 3. Moment-Area Method Diagram 1: Decomposed M/EI Curvature Diagram with Shaded Regions A_i & Centroids x̄_i
   */
  function drawMomentAreaCurvature(canvas, sol, opts = {}) {
    const { ctx, w, h } = prepCanvas(canvas);
    const C = getColors(opts.dark);
    const pad = { l: 64, r: 34, t: 30, b: 36 };
    const plotW = w - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;
    const L = sol.input.L;

    // Display curvature in mrad/m (or kN·m / EI when EI is constant)
    const curvScale = sol.display ? sol.display.curvScale : 1000;
    const curvUnitLabel = sol.display ? sol.display.curvUnitLabel : '×10⁻³ rad/m';
    const kArr = sol.arrays.curvature.map((k) => k * curvScale);
    const xArr = sol.arrays.x;

    let minY = 0, maxY = 0;
    for (const v of kArr) {
      if (v < minY) minY = v;
      if (v > maxY) maxY = v;
    }
    const spanY = Math.max(maxY - minY, 1e-9);
    const yLo = minY - spanY * 0.24;
    const yHi = maxY + spanY * 0.24;

    const toX = (x) => pad.l + (x / L) * plotW;
    const toY = (y) => pad.t + ((yHi - y) / (yHi - yLo)) * plotH;
    const zeroY = toY(0);

    // Subtle grid
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 6; i++) {
      const xv = (L * i) / 6;
      const gx = toX(xv);
      ctx.beginPath();
      ctx.moveTo(gx, pad.t);
      ctx.lineTo(gx, h - pad.b);
      ctx.stroke();
      ctx.fillStyle = C.muted;
      ctx.font = '500 10px "Inter", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${xv.toFixed(1)}m`, gx, h - pad.b + 14);
    }

    // Distinct alternating fills from our Starlight/Opaline/Aurora/Wisteria palette for each region A_i
    const posFills = ['rgba(85, 124, 179, 0.30)', 'rgba(142, 164, 196, 0.36)', 'rgba(110, 90, 136, 0.28)'];
    const negFills = ['rgba(168, 82, 125, 0.28)', 'rgba(110, 90, 136, 0.32)', 'rgba(180, 110, 150, 0.25)'];

    sol.momentArea.regions.forEach((reg, idx) => {
      // Sample curve inside region
      const steps = 40;
      ctx.beginPath();
      ctx.moveTo(toX(reg.x1), zeroY);
      for (let s = 0; s <= steps; s++) {
        const xv = reg.x1 + ((reg.x2 - reg.x1) * s) / steps;
        const kv = sol.evalAt(xv).curvature * curvScale;
        ctx.lineTo(toX(xv), toY(kv));
      }
      ctx.lineTo(toX(reg.x2), zeroY);
      ctx.closePath();
      ctx.fillStyle = reg.sign >= 0 ? posFills[idx % posFills.length] : negFills[idx % negFills.length];
      ctx.fill();

      // Vertical boundary line
      ctx.strokeStyle = C.muted;
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(toX(reg.x2), pad.t);
      ctx.lineTo(toX(reg.x2), h - pad.b);
      ctx.stroke();
      ctx.setLineDash([]);

      // Centroid marker dot & pill
      if (Math.abs(reg.area) > 1e-12) {
        const cx = toX(reg.xBar);
        const kAtBar = sol.evalAt(reg.xBar).curvature * curvScale;
        const cy = toY(kAtBar * 0.48);

        // Centroid drop line to baseline
        ctx.strokeStyle = C.wisteria;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(cx, zeroY);
        ctx.lineTo(cx, cy);
        ctx.stroke();

        // Centroid dot
        ctx.fillStyle = C.wisteria;
        ctx.strokeStyle = '#f3eef8';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        const lblY = reg.sign >= 0 ? Math.max(pad.t + 14, toY(kAtBar) - 14) : Math.min(h - pad.b - 14, toY(kAtBar) + 14);
        drawRoundedPill(ctx, cx, lblY, `${reg.id} (x̄=${reg.xBar.toFixed(2)}m)`, C.pillBg, C.wisteria, C.text);
      }
    });

    // Zero baseline
    ctx.strokeStyle = C.axis;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(pad.l, zeroY);
    ctx.lineTo(w - pad.r, zeroY);
    ctx.stroke();

    // Outer M/EI curve stroke
    ctx.beginPath();
    for (let i = 0; i < xArr.length; i++) {
      const px = toX(xArr[i]);
      const py = toY(kArr[i]);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = C.wisteria;
    ctx.lineWidth = 2.4;
    ctx.stroke();

    ctx.fillStyle = C.muted;
    ctx.font = '600 10px "Inter", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`Shaded bending areas (M/EI in ${curvUnitLabel}) & balance points (dots)`, pad.l + 4, 14);

    if (opts.probeX !== null && opts.probeX !== undefined) {
      const px = toX(opts.probeX);
      ctx.save();
      ctx.strokeStyle = C.probe;
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(px, pad.t);
      ctx.lineTo(px, h - pad.b);
      ctx.stroke();
      ctx.restore();
    }

    return { pad, plotW, L };
  }

  /**
   * 4. Moment-Area Method Diagram 2: Elastic Curve + Reference Tangent Line + Tangential Deviations t_{B/A} & t_{max/A}
   */
  function drawMomentAreaTangent(canvas, sol, opts = {}) {
    const { ctx, w, h } = prepCanvas(canvas);
    const C = getColors(opts.dark);
    const pad = { l: 64, r: 34, t: 30, b: 36 };
    const plotW = w - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;
    const L = sol.input.L;

    const { refX, targetX, thetaRef, yRef, t_target_ref } = sol.momentArea;
    const dScale = sol.display ? sol.display.deflScale : 1000;
    const dUnit = sol.display ? sol.display.deflShortUnit : 'mm';
    const xArr = sol.arrays.x;
    const yDisp = sol.arrays.y.map((v) => v * dScale);
    const tanDisp = xArr.map((x) => (yRef + thetaRef * (x - refX)) * dScale);

    let minY = 0, maxY = 0;
    for (let i = 0; i < xArr.length; i++) {
      minY = Math.min(minY, yDisp[i], tanDisp[i]);
      maxY = Math.max(maxY, yDisp[i], tanDisp[i]);
    }
    const spanY = Math.max(maxY - minY, 1e-6);
    const yLo = minY - spanY * 0.22;
    const yHi = maxY + spanY * 0.22;

    const toX = (x) => pad.l + (x / L) * plotW;
    const toY = (y) => pad.t + ((yHi - y) / (yHi - yLo)) * plotH;
    const zeroY = toY(0);

    // Grid
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 6; i++) {
      const xv = (L * i) / 6;
      const gx = toX(xv);
      ctx.beginPath();
      ctx.moveTo(gx, pad.t);
      ctx.lineTo(gx, h - pad.b);
      ctx.stroke();
      ctx.fillStyle = C.muted;
      ctx.font = '500 10px "Inter", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${xv.toFixed(1)}m`, gx, h - pad.b + 14);
    }

    // Undeformed beam baseline
    ctx.strokeStyle = C.axis;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(pad.l, zeroY);
    ctx.lineTo(w - pad.r, zeroY);
    ctx.stroke();

    // Reference Tangent Line (dashed Aurora)
    ctx.save();
    ctx.strokeStyle = C.aurora;
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(tanDisp[0]));
    ctx.lineTo(toX(L), toY(tanDisp[tanDisp.length - 1]));
    ctx.stroke();
    ctx.restore();

    // Elastic Curve (solid Wisteria)
    ctx.beginPath();
    for (let i = 0; i < xArr.length; i++) {
      const px = toX(xArr[i]);
      const py = toY(yDisp[i]);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = C.wisteria;
    ctx.lineWidth = 2.8;
    ctx.stroke();

    // Highlight Reference Point
    const rx = toX(refX);
    const ry = toY(yRef * dScale);
    ctx.fillStyle = C.aurora;
    ctx.beginPath();
    ctx.arc(rx, ry, 5, 0, Math.PI * 2);
    ctx.fill();
    drawRoundedPill(ctx, rx, ry - 18, `Ref Tangent (${refX.toFixed(1)}m)`, C.pillBg, C.aurora, C.aurora, refX < L * 0.2 ? 'left' : 'right');

    // Vertical Tangential Deviation Arrow t_{target / ref}
    const tx = toX(targetX);
    const yTanTarget = toY((yRef + thetaRef * (targetX - refX)) * dScale);
    const yCurveTarget = toY(sol.evalAt(targetX).y * dScale);
    if (Math.abs(yCurveTarget - yTanTarget) > 6) {
      drawArrow2D(ctx, tx, yTanTarget, tx, yCurveTarget, C.mauve, 2.2, 7);
      drawRoundedPill(
        ctx,
        tx - 6,
        0.5 * (yTanTarget + yCurveTarget),
        `t = ${(t_target_ref * dScale).toFixed(3)} ${dUnit}`,
        C.pillBg,
        C.mauve,
        C.mauve,
        targetX > L * 0.7 ? 'right' : 'left'
      );
    }

    // Also highlight max deflection vertical offset from baseline
    const mx = toX(sol.extrema.deflection.maxX);
    const maxValDisp = sol.extrema.deflection.maxSigned * dScale;
    const my = toY(maxValDisp);
    ctx.fillStyle = C.wisteria;
    ctx.beginPath();
    ctx.arc(mx, my, 4.5, 0, Math.PI * 2);
    ctx.fill();
    drawRoundedPill(
      ctx,
      mx,
      my + (maxValDisp <= 0 ? 18 : -18),
      `δ_max = ${maxValDisp.toFixed(3)} ${dUnit}`,
      C.pillBg,
      C.wisteria,
      C.wisteria
    );

    ctx.fillStyle = C.muted;
    ctx.font = '600 10px "Inter", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`Bent beam (solid) vs. straight reference tangent (dashed) · Gap t (${dUnit})`, pad.l + 4, 14);

    if (opts.probeX !== null && opts.probeX !== undefined) {
      const px = toX(opts.probeX);
      ctx.save();
      ctx.strokeStyle = C.probe;
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(px, pad.t);
      ctx.lineTo(px, h - pad.b);
      ctx.stroke();
      ctx.restore();
    }

    return { pad, plotW, L };
  }

  /**
   * 5. Conjugate Beam Schematic: Transformed Supports + Elastic Load w*(x) = M(x)/EI + Conjugate Reactions
   */
  function drawConjugateBeamSchematic(canvas, sol, opts = {}) {
    const { ctx, w, h } = prepCanvas(canvas);
    const C = getColors(opts.dark);
    const pad = { l: 64, r: 34, t: 36, b: 48 };
    const plotW = w - pad.l - pad.r;
    const beamY = h * 0.54;
    const L = sol.input.L;
    const toX = (x) => pad.l + (x / L) * plotW;

    const maxK = Math.max(...sol.arrays.curvature.map((v) => Math.abs(v)), 1e-12);
    const maxArrowH = 56;

    // Elastic distributed load curtain w*(x) = M(x)/EI
    // Positive M/EI acts UPWARD (pushes from below upward toward beam), negative acts DOWNWARD (pushes from above)
    ctx.beginPath();
    ctx.moveTo(toX(0), beamY);
    for (let i = 0; i < sol.arrays.x.length; i++) {
      const sx = toX(sol.arrays.x[i]);
      const norm = sol.arrays.curvature[i] / maxK;
      // Place upward load envelope below beamY (pointing UP to beam) and downward load envelope above beamY (pointing DOWN)
      const ey = beamY + norm * maxArrowH;
      ctx.lineTo(sx, ey);
    }
    ctx.lineTo(toX(L), beamY);
    ctx.closePath();
    ctx.fillStyle = C.auroraFill;
    ctx.fill();

    // Load arrows
    const nArrows = 18;
    for (let i = 0; i <= nArrows; i++) {
      const xv = (L * i) / nArrows;
      const sx = toX(xv);
      const norm = sol.evalAt(xv).curvature / maxK;
      if (Math.abs(norm) < 0.05) continue;
      const len = Math.max(12, Math.abs(norm) * maxArrowH);
      if (norm > 0) {
        // Positive M/EI -> UPWARD elastic load arrow
        drawArrow2D(ctx, sx, beamY + len + 4, sx, beamY + 5, C.aurora, 1.5, 5);
      } else {
        // Negative M/EI -> DOWNWARD elastic load arrow
        drawArrow2D(ctx, sx, beamY - len - 4, sx, beamY - 5, C.mauve, 1.5, 5);
      }
    }

    // Conjugate Beam Axis
    ctx.save();
    ctx.strokeStyle = C.wisteria;
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(toX(0), beamY);
    ctx.lineTo(toX(L), beamY);
    ctx.stroke();
    ctx.restore();

    // Transformed Conjugate Supports
    for (const cs of sol.conjugateBeam.supports) {
      const sx = toX(cs.x);
      drawSupportSymbol2D(ctx, cs.symbol, sx, beamY, C.aurora, C.muted, cs.x > L * 0.5);
      const align = cs.x < L * 0.15 ? 'left' : cs.x > L * 0.85 ? 'right' : 'center';
      drawRoundedPill(
        ctx,
        sx,
        h - 15,
        `${cs.id}: ${cs.realType} → ${cs.conjType}`,
        C.pillBg,
        C.wisteria,
        C.text,
        align
      );
    }

    ctx.fillStyle = C.muted;
    ctx.font = '600 10px "Inter", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Mirror (Conjugate) Beam — Swapped supports & bending load (↑ sagging, ↓ hogging)', pad.l + 4, 15);

    if (opts.probeX !== null && opts.probeX !== undefined) {
      const px = toX(opts.probeX);
      ctx.save();
      ctx.strokeStyle = C.probe;
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(px, 20);
      ctx.lineTo(px, h - 28);
      ctx.stroke();
      ctx.restore();
    }

    return { pad, plotW, L };
  }

  /**
   * 6. 3-Method Comparison Overlay Chart
   */
  function drawComparisonChart(canvas, sol, opts = {}) {
    const { ctx, w, h } = prepCanvas(canvas);
    const C = getColors(opts.dark);
    const pad = { l: 64, r: 34, t: 30, b: 34 };
    const plotW = w - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;
    const L = sol.input.L;

    const dScale = sol.display ? sol.display.deflScale : 1000;
    const xArr = sol.arrays.x;
    const y1 = sol.arrays.y.map((v) => v * dScale);
    const y2 = sol.arrays.yMA_mm.map((v) => (v / 1000) * dScale);
    const y3 = sol.arrays.yConj_mm.map((v) => (v / 1000) * dScale);

    let minY = 0, maxY = 0;
    for (const v of y1) {
      if (v < minY) minY = v;
      if (v > maxY) maxY = v;
    }
    const spanY = Math.max(maxY - minY, 1e-6);
    const yLo = minY - spanY * 0.2;
    const yHi = maxY + spanY * 0.2;

    const toX = (x) => pad.l + (x / L) * plotW;
    const toY = (y) => pad.t + ((yHi - y) / (yHi - yLo)) * plotH;

    // Grid & zero axis
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 6; i++) {
      const gx = pad.l + (plotW * i) / 6;
      ctx.beginPath();
      ctx.moveTo(gx, pad.t);
      ctx.lineTo(gx, h - pad.b);
      ctx.stroke();
    }
    ctx.strokeStyle = C.axis;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(pad.l, toY(0));
    ctx.lineTo(w - pad.r, toY(0));
    ctx.stroke();

    const series = [
      { arr: y1, color: C.wisteria, width: 4.5, dash: [], label: 'Double Integration' },
      { arr: y2, color: C.aurora, width: 2.8, dash: [10, 6], label: 'Moment-Area' },
      { arr: y3, color: C.mauve, width: 2.2, dash: [3, 5], label: 'Conjugate Beam' }
    ];

    for (const s of series) {
      ctx.save();
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.setLineDash(s.dash);
      ctx.beginPath();
      for (let i = 0; i < xArr.length; i++) {
        const px = toX(xArr[i]);
        const py = toY(s.arr[i]);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.restore();
    }

    // Legend top-right
    let lx = w - pad.r - 360;
    if (lx < pad.l) lx = pad.l + 8;
    series.forEach((s, idx) => {
      const xPos = lx + idx * 124;
      ctx.save();
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 3;
      ctx.setLineDash(s.dash);
      ctx.beginPath();
      ctx.moveTo(xPos, 14);
      ctx.lineTo(xPos + 20, 14);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = C.text;
      ctx.font = '600 10.5px "Inter", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(s.label, xPos + 25, 14);
      ctx.restore();
    });

    return { pad, plotW, L };
  }

  BeamStudio.Diagrams = {
    drawFBD,
    drawCurveChart,
    drawMomentAreaCurvature,
    drawMomentAreaTangent,
    drawConjugateBeamSchematic,
    drawComparisonChart
  };
})(window);
