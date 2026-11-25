/**
 * BeamStudio — Analytical Step-by-Step Solution Builder (LaTeX + Structured Steps)
 * Produces TWO dedicated solution views for all 3 methods:
 *  1. Max Deflection Solution (finding x_max & peak deflection δ_max)
 *  2. Point x Solution (finding exact Slope θ(x_p) & Deflection y(x_p) at ANY chosen point x_p)
 * Supports mm, cm, m units AND Constant EI symbolic mode (/EI).
 */
(function (global) {
  'use strict';

  const BeamStudio = (global.BeamStudio = global.BeamStudio || {});

  function fmt(n, decimals = 4) {
    if (!isFinite(n)) return '0';
    if (Math.abs(n) < 1e-11) return '0';
    if (Math.abs(n) >= 1e6 || (Math.abs(n) > 0 && Math.abs(n) < 1e-3)) {
      return n.toExponential(3);
    }
    return Number(n.toFixed(decimals)).toString();
  }

  function fmtSci(n) {
    if (!isFinite(n) || Math.abs(n) < 1e-13) return '0';
    return n.toExponential(4);
  }

  function fmtDeflTex(valMeters, sol) {
    if (sol.display && sol.display.isConstantEI) {
      return `\\frac{${fmt(valMeters, 4)}}{EI}\\text{ kN}\\cdot\\text{m}^3/EI`;
    }
    const scale = sol.display ? sol.display.deflScale : 1000;
    const unit = sol.display ? sol.display.deflShortUnit : 'mm';
    return `${fmt(valMeters * scale, 4)}\\text{ ${unit}}`;
  }

  function fmtSlopeTex(valRad, sol) {
    if (sol.display && sol.display.isConstantEI) {
      return `\\frac{${fmt(valRad, 4)}}{EI}\\text{ kN}\\cdot\\text{m}^2/EI`;
    }
    return `${fmtSci(valRad)}\\text{ rad}`;
  }

  function fmtDeflPlain(valMeters, sol) {
    if (sol.display && sol.display.isConstantEI) {
      return `${fmt(valMeters, 4)} / EI`;
    }
    const scale = sol.display ? sol.display.deflScale : 1000;
    const unit = sol.display ? sol.display.deflShortUnit : 'mm';
    return `${fmt(valMeters * scale, 4)} ${unit}`;
  }

  function evalPoly(c, u) {
    let val = 0;
    let p = 1;
    for (let i = 0; i < c.length; i++) {
      val += c[i] * p;
      p *= u;
    }
    return val;
  }

  function integratePoly(c) {
    const out = [0];
    for (let i = 0; i < c.length; i++) out.push(c[i] / (i + 1));
    return out;
  }

  /**
   * Compute exact clipped M/EI sub-areas between xFrom and xTo (for Moment-Area & Conjugate Beam at any point x_p)
   */
  function getSubRegionsBetween(sol, xFrom, xTo) {
    const lo = Math.min(xFrom, xTo);
    const hi = Math.max(xFrom, xTo);
    const rows = [];
    let totalArea = 0;
    let totalMomAboutTarget = 0;
    const dir = xTo >= xFrom ? 1 : -1;

    for (const seg of sol.segments) {
      const a = Math.max(lo, seg.x1);
      const b = Math.min(hi, seg.x2);
      if (b - a <= 1e-8) continue;
      const u1 = a - seg.x1;
      const u2 = b - seg.x1;
      const K = integratePoly(seg.kPoly);
      const area = evalPoly(K, u2) - evalPoly(K, u1);
      const UK = integratePoly([0, ...seg.kPoly]);
      const uArea = evalPoly(UK, u2) - evalPoly(UK, u1);
      const xArea = seg.x1 * area + uArea;
      const xBar = Math.abs(area) > 1e-13 ? xArea / area : 0.5 * (a + b);
      const arm = xTo - xBar;
      const mom = xTo * area - xArea;

      totalArea += dir * area;
      totalMomAboutTarget += dir * mom;

      rows.push({
        interval: `[${fmt(a, 3)}, ${fmt(b, 3)}]`,
        area: dir * area,
        xBar,
        arm,
        contribution: dir * mom
      });
    }

    return { rows, totalArea, totalMomAboutTarget, lo, hi, dir };
  }

  function polyToLatex(coeffs, x1) {
    const varStr = Math.abs(x1) < 1e-7 ? 'x' : `(x - ${fmt(x1, 3)})`;
    const terms = [];
    for (let i = 0; i < coeffs.length; i++) {
      const c = coeffs[i];
      if (Math.abs(c) < 1e-8) continue;
      const sign = c >= 0 ? (terms.length === 0 ? '' : ' + ') : (terms.length === 0 ? '-' : ' - ');
      const absC = fmt(Math.abs(c), 4);
      if (i === 0) terms.push(`${sign}${absC}`);
      else if (i === 1) terms.push(`${sign}${absC}\\,${varStr}`);
      else terms.push(`${sign}${absC}\\,${varStr}^{${i}}`);
    }
    return terms.length ? terms.join('') : '0';
  }

  function polySubLatex(coeffs, x1, xVal) {
    const uVal = xVal - x1;
    const uStr = Math.abs(x1) < 1e-7 ? `(${fmt(xVal, 3)})` : `(${fmt(xVal, 3)} - ${fmt(x1, 3)})`;
    const terms = [];
    for (let i = 0; i < coeffs.length; i++) {
      const c = coeffs[i];
      if (Math.abs(c) < 1e-8) continue;
      const sign = c >= 0 ? (terms.length === 0 ? '' : ' + ') : (terms.length === 0 ? '-' : ' - ');
      const absC = fmt(Math.abs(c), 4);
      if (i === 0) terms.push(`${sign}${absC}`);
      else if (i === 1) terms.push(`${sign}${absC}${uStr}`);
      else terms.push(`${sign}${absC}${uStr}^{${i}}`);
    }
    return terms.length ? terms.join('') : '0';
  }

  function findActiveSegment(segments, xVal) {
    for (const seg of segments) {
      if (xVal >= seg.x1 - 1e-7 && xVal <= seg.x2 + 1e-7) return seg;
    }
    return segments[segments.length - 1];
  }

  function supportLabel(type) {
    const map = {
      simply_supported: 'Simply Supported (Pin at A, Roller at B)',
      cantilever_left: 'Cantilever (Fixed at Left x = 0, Free at x = L)',
      cantilever_right: 'Cantilever (Free at x = 0, Fixed at Right x = L)',
      overhanging: 'Overhanging Beam (Pin at x_A, Roller at x_B)'
    };
    return map[type] || type;
  }

  function describeLoad(ld) {
    if (ld.type === 'Point') return `Point Load P = ${fmt(ld.P, 3)} kN at x = ${fmt(ld.a, 3)} m`;
    if (ld.type === 'Moment') return `Applied Moment M₀ = ${fmt(ld.M, 3)} kN·m (${ld.M >= 0 ? 'CCW' : 'CW'}) at x = ${fmt(ld.a, 3)} m`;
    if (ld.type === 'UDL') return `UDL w = ${fmt(ld.w, 3)} kN/m from x = ${fmt(ld.a, 3)} m to ${fmt(ld.b, 3)} m`;
    if (ld.type === 'UVL') return `UVL w₁ = ${fmt(ld.w1, 3)} → w₂ = ${fmt(ld.w2, 3)} kN/m from x = ${fmt(ld.a, 3)} m to ${fmt(ld.b, 3)} m`;
    return '';
  }

  function buildReactionsStep(sol) {
    const { input, reactions, isIndeterminate, indeterminacyDegree } = sol;
    const eqs = [];
    if (input.isConstantEI) {
      eqs.push(`EI = \\text{Constant (Symbolic)} \\implies \\text{Slopes in } \\frac{\\text{kN}\\cdot\\text{m}^2}{EI},\\quad \\text{Deflections in } \\frac{\\text{kN}\\cdot\\text{m}^3}{EI}`);
    } else {
      eqs.push(`EI = E \\cdot I = (${fmt(input.E_GPa, 3)} \\times 10^6\\text{ kN/m}^2)(${fmtSci(input.I)}\\text{ m}^4) = ${fmt(input.EI, 3)}\\text{ kN}\\cdot\\text{m}^2`);
    }

    const rParts = [];
    if (Math.abs(reactions.RA) > 1e-9 || input.supports.some((s) => s.id === 'A')) rParts.push(`R_A = ${fmt(reactions.RA, 4)}\\text{ kN}`);
    if (Math.abs(reactions.RB) > 1e-9 || input.supports.some((s) => s.id === 'B')) rParts.push(`R_B = ${fmt(reactions.RB, 4)}\\text{ kN}`);
    if (Math.abs(reactions.MA) > 1e-9 || input.supports.some((s) => s.id === 'A' && s.type === 'fixed')) rParts.push(`M_A = ${fmt(reactions.MA, 4)}\\text{ kN}\\cdot\\text{m}`);
    if (Math.abs(reactions.MB) > 1e-9 || input.supports.some((s) => s.id === 'B' && s.type === 'fixed')) rParts.push(`M_B = ${fmt(reactions.MB, 4)}\\text{ kN}\\cdot\\text{m}`);
    eqs.push(rParts.join(', \\quad '));

    const note = 'Support reactions are obtained from static equilibrium (∑F_y = 0, ∑M = 0).';

    return {
      title: 'Step 1 — Beam Stiffness & Support Reactions',
      badge: input.isConstantEI ? 'Constant EI' : 'Static Balance',
      description: note,
      equations: eqs
    };
  }

  // =========================================================================
  // PART A: MAXIMUM DEFLECTION & LOCATION SOLUTIONS (ALL 3 METHODS)
  // =========================================================================

  function buildDoubleIntegrationSteps(sol) {
    const { input, segments, constants, extrema } = sol;
    const steps = [buildReactionsStep(sol)];

    const momentEqs = segments.map((seg) => {
      const mTex = polyToLatex(seg.Mpoly, seg.x1);
      return `M_{${seg.index + 1}}(x) = ${mTex} \\qquad (${fmt(seg.x1, 3)} \\le x \\le ${fmt(seg.x2, 3)}\\text{ m})`;
    });
    steps.push({
      title: 'Step 2 — Bending Moment Equations EI·y′′(x) = M(x)',
      badge: 'Moment Formula',
      description: 'Write the bending moment equation M(x) on each continuous segment along the beam:',
      equations: [`EI \\frac{d^2 y}{dx^2} = M(x)`, ...momentEqs]
    });

    let bcText = '';
    if (input.supportType === 'simply_supported') bcText = `Boundary conditions at pin A and roller B: y(0) = 0 and y(${fmt(input.L, 3)}) = 0.`;
    else if (input.supportType === 'overhanging') bcText = `Boundary conditions at supports A and B: y(${fmt(input.supports[0].x, 3)}) = 0 and y(${fmt(input.supports[1].x, 3)}) = 0.`;
    else if (input.supportType === 'cantilever_left') bcText = 'Fixed-end boundary conditions at x = 0: θ(0) = 0 and y(0) = 0.';
    else if (input.supportType === 'cantilever_right') bcText = `Fixed-end boundary conditions at x = L: θ(${fmt(input.L, 3)}) = 0 and y(${fmt(input.L, 3)}) = 0.`;

    steps.push({
      title: 'Step 3 — Matching Support Conditions (C₁ & C₂)',
      badge: 'Integration Constants',
      description: `${bcText} Integrating twice and enforcing continuity gives:`,
      equations: [
        `EI\\,C_1 = EI\\,\\theta(0) = ${fmt(constants.EI_C1, 4)}\\text{ kN}\\cdot\\text{m}^2 \\implies \\theta(0) = ${fmtSlopeTex(constants.C1, sol)}`,
        `EI\\,C_2 = EI\\,y(0) = ${fmt(constants.EI_C2, 4)}\\text{ kN}\\cdot\\text{m}^3 \\implies y(0) = ${fmtDeflTex(constants.C2, sol)}`
      ]
    });

    const intEqs = [];
    for (const seg of segments) {
      const eiTheta = seg.thetaPoly.map((c) => c * input.EI);
      const eiY = seg.yPoly.map((c) => c * input.EI);
      intEqs.push(`\\text{Interval } [${fmt(seg.x1, 2)}, ${fmt(seg.x2, 2)}]\\text{ m:}\\quad EI\\,\\theta(x) = ${polyToLatex(eiTheta, seg.x1)}`);
      intEqs.push(`EI\\,y(x) = ${polyToLatex(eiY, seg.x1)}`);
    }
    steps.push({
      title: 'Step 4 — Complete Slope & Deflection Equations',
      badge: 'Solved Functions',
      description: 'Substituting C₁ and C₂ yields the exact slope θ(x) and deflection y(x) equations:',
      equations: intEqs
    });

    const maxSeg = findActiveSegment(segments, extrema.deflection.maxX);
    const maxEiY = maxSeg.yPoly.map((c) => c * input.EI);
    const zeroSlopeTxt =
      extrema.zeroSlopePoints.length > 0
        ? `\\text{Zero-slope location(s) } (\\theta(x)=0):\\quad x = ${extrema.zeroSlopePoints.map((p) => `${fmt(p, 4)}\\text{ m}`).join(',\\; ')}`
        : `\\text{Maximum bend occurs at the free end: } x_{\\max} = ${fmt(extrema.deflection.maxX, 4)}\\text{ m}`;

    steps.push({
      title: 'Step 5 — Location & Value of Maximum Deflection',
      badge: 'Peak Deflection',
      description: 'Maximum deflection occurs where beam tilt is zero (θ(x) = 0) or at a free end. Evaluating y(x) at x_max:',
      equations: [
        zeroSlopeTxt,
        `EI\\,y(${fmt(extrema.deflection.maxX, 4)}) = ${polySubLatex(maxEiY, maxSeg.x1, extrema.deflection.maxX)} = ${fmt(extrema.deflection.maxSigned * input.EI, 4)}\\text{ kN}\\cdot\\text{m}^3`,
        `\\delta_{\\max} = y(${fmt(extrema.deflection.maxX, 4)}\\text{ m}) = ${fmtDeflTex(extrema.deflection.maxSigned, sol)}`,
        `\\text{End Slopes:}\\quad \\theta(0) = ${fmtSlopeTex(extrema.thetaStart, sol)}, \\qquad \\theta(L) = ${fmtSlopeTex(extrema.thetaEnd, sol)}`
      ]
    });

    return steps;
  }

  function buildMomentAreaSteps(sol) {
    const { input, momentArea, extrema } = sol;
    const steps = [buildReactionsStep(sol)];
    const areaUnit = input.isConstantEI ? 'kN·m²/EI' : 'rad';

    steps.push({
      title: 'Step 2 — Bending Areas & Balance Points (M/EI)',
      badge: 'Moment-Area Rules',
      description: 'Divide the bending moment curve by stiffness EI and split it into clean shaded areas Aᵢ with balance points (centroids) x̄ᵢ:',
      equations: [
        `\\textbf{Rule 1 (Change in Tilt):}\\quad \\theta_{B/A} = \\int_{x_A}^{x_B} \\frac{M(x)}{EI}\\,dx = \\sum A_i`,
        `\\textbf{Rule 2 (Tangent Gap):}\\quad t_{B/A} = \\int_{x_A}^{x_B} \\frac{M(x)}{EI}(x_B - x)\\,dx = \\sum A_i\\,(x_B - \\bar{x}_i)`
      ],
      table: {
        headers: ['Area', 'Interval (m)', 'Shape', `Area Aᵢ (${areaUnit})`, 'Balance Point x̄ᵢ (m)', 'Distance |x_B - x̄ᵢ| (m)'],
        rows: momentArea.regions.map((r) => [
          r.id,
          `[${fmt(r.x1, 3)}, ${fmt(r.x2, 3)}]`,
          r.shape,
          input.isConstantEI ? `${fmt(r.area, 4)} / EI` : fmtSci(r.area),
          fmt(r.xBar, 4),
          fmt(Math.abs(momentArea.targetX - r.xBar), 4)
        ])
      }
    });

    const isFixedRef =
      input.supportType === 'cantilever_left' ||
      input.supportType === 'cantilever_right';

    if (isFixedRef) {
      steps.push({
        title: 'Step 3 — Reference Tangent at Fixed Support',
        badge: 'Horizontal Line',
        description: `Because the beam is fixed at x_ref = ${fmt(momentArea.refX, 3)} m, the straight reference tangent is perfectly horizontal (θ_ref = 0, y_ref = 0):`,
        equations: [
          `\\theta(${fmt(momentArea.refX, 2)}) = 0, \\qquad y(${fmt(momentArea.refX, 2)}) = 0`,
          `t_{${fmt(momentArea.targetX, 2)}/${fmt(momentArea.refX, 2)}} = ${fmtDeflTex(momentArea.t_target_ref, sol)}`
        ]
      });
    } else {
      const spanAB = momentArea.targetX - momentArea.refX;
      steps.push({
        title: 'Step 3 — Reference Tangent Gap t_{B/A} & Support Tilt θ_A',
        badge: 'Tangent Geometry',
        description: `Draw a straight tangent touching the bent beam at support A (x = ${fmt(momentArea.refX, 3)} m). Measuring the vertical gap t_{B/A} at support B gives θ_A:`,
        equations: [
          `t_{B/A} = \\sum_{x_A}^{x_B} A_i (x_B - \\bar{x}_i) = ${fmtDeflTex(momentArea.t_target_ref, sol)}`,
          `\\theta_A = -\\frac{t_{B/A}}{${fmt(spanAB, 3)}} = ${fmtSlopeTex(momentArea.thetaRef, sol)}`
        ]
      });
    }

    const maAtMax = momentArea.evalAt(extrema.deflection.maxX);
    steps.push({
      title: 'Step 4 — Location & Value of Maximum Deflection',
      badge: 'Peak Deflection',
      description: 'Find x_max where cumulative bending area cancels θ_ref (making the beam horizontal, θ = 0), or check the free tip, then extract δ_max:',
      equations: [
        `x_{\\max} = ${fmt(extrema.deflection.maxX, 4)}\\text{ m} \\implies t_{\\max/\\text{ref}} = ${fmtDeflTex(maAtMax.t_x_ref, sol)}`,
        `\\delta_{\\max} = y_{\\text{ref}} + \\theta_{\\text{ref}}(x_{\\max} - x_{\\text{ref}}) + t_{\\max/\\text{ref}} = ${fmtDeflTex(maAtMax.y, sol)}`
      ]
    });

    return steps;
  }

  function buildConjugateBeamSteps(sol) {
    const { input, conjugateBeam, extrema } = sol;
    const steps = [buildReactionsStep(sol)];

    steps.push({
      title: 'Step 2 — Converting to the Mirror (Conjugate) Beam',
      badge: 'Support Swap',
      description: 'Swap real supports into mirror supports so that shear on this mirror beam gives real beam tilt (V* = θ) and bending moment gives real deflection (M* = y):',
      equations: [
        `w^*(x) = \\frac{M(x)}{EI} \\quad (\\uparrow \\text{ sagging},\\; \\downarrow \\text{ hogging}), \\qquad V^*(x) \\equiv \\theta(x), \\qquad M^*(x) \\equiv y(x)`
      ],
      table: {
        headers: ['Location', 'Position x (m)', 'Real Support', 'Mirror Support', 'What It Means'],
        rows: conjugateBeam.supports.map((s) => {
          let equiv = 'V* = θ ≠ 0, M* = y = 0';
          if (s.symbol === 'free') equiv = 'V* = θ = 0, M* = y = 0';
          else if (s.symbol === 'fixed') equiv = 'V* = θ ≠ 0, M* = y ≠ 0';
          else if (s.symbol === 'hinge') equiv = 'V* continuous (θ), M* = 0 (y = 0)';
          return [s.id, fmt(s.x, 3), s.realType, s.conjType, equiv];
        })
      }
    });

    const cr = conjugateBeam.reactions;
    const conjEqs = [`W^*_{\\text{total}} = \\int_0^L \\frac{M(x)}{EI}\\,dx = ${fmtSlopeTex(conjugateBeam.totalWStar, sol)}`];
    if (Math.abs(cr.RA_star) > 1e-12 || input.supportType === 'simply_supported') {
      conjEqs.push(`R_A^* = ${fmtSlopeTex(cr.RA_star, sol)} \\implies \\theta(0) = V^*(0^+) = ${fmtSlopeTex(extrema.thetaStart, sol)}`);
    }
    if (Math.abs(cr.RB_star) > 1e-12 || input.supportType === 'simply_supported' || input.supportType === 'cantilever_left') {
      conjEqs.push(`R_B^* = ${fmtSlopeTex(cr.RB_star, sol)} \\implies \\theta(L) = V^*(L^-) = ${fmtSlopeTex(extrema.thetaEnd, sol)}`);
    }
    if (Math.abs(cr.MA_star) > 1e-12) {
      conjEqs.push(`M_A^* = ${fmtDeflTex(cr.MA_star, sol)} \\implies y(0) = ${fmtDeflTex(extrema.yStart_mm / 1000, sol)}`);
    }
    if (Math.abs(cr.MB_star) > 1e-12) {
      conjEqs.push(`M_B^* = ${fmtDeflTex(cr.MB_star, sol)} \\implies y(L) = ${fmtDeflTex(extrema.yEnd_mm / 1000, sol)}`);
    }

    steps.push({
      title: 'Step 3 — Mirror Beam Reactions (Support Slopes)',
      badge: 'Mirror Balance',
      description: 'Load the mirror beam with w*(x) = M(x)/EI and solve ∑F_y* = 0, ∑M* = 0 for mirror reactions:',
      equations: conjEqs
    });

    const cjMax = conjugateBeam.evalAt(extrema.deflection.maxX);
    steps.push({
      title: 'Step 4 — Peak Deflection from Mirror Moment M*',
      badge: 'Peak Deflection',
      description: 'Maximum deflection occurs where mirror shear V*(x) = 0 (or at a fixed mirror end). Evaluating M*(x_max) gives exact δ_max:',
      equations: [
        `V^*(x_{\\max}) = \\theta(${fmt(extrema.deflection.maxX, 4)}) = ${fmtSlopeTex(cjMax.V_star, sol)}`,
        `M^*(x_{\\max}) = \\delta_{\\max} = ${fmtDeflTex(cjMax.M_star, sol)} \\quad \\text{at } x_{\\max} = ${fmt(extrema.deflection.maxX, 4)}\\text{ m}`
      ]
    });

    return steps;
  }

  // =========================================================================
  // PART B: SLOPE & DEFLECTION AT ANY SELECTED POINT x_p (ALL 3 METHODS)
  // =========================================================================

  function buildPointSolutionSteps(sol, method, rawX) {
    const xP = Math.max(0, Math.min(sol.input.L, Number(rawX) || 0));
    const st = sol.evalAt(xP);
    const { input, segments, momentArea, conjugateBeam } = sol;

    // 1. Double Integration at x = xP
    if (method === 'double_integration') {
      const seg = findActiveSegment(segments, xP);
      const eiTheta = seg.thetaPoly.map((c) => c * input.EI);
      const eiY = seg.yPoly.map((c) => c * input.EI);

      return [
        {
          title: `Step 1 — Locate Segment Containing x = ${fmt(xP, 3)} m`,
          badge: `Interval [${fmt(seg.x1, 2)}, ${fmt(seg.x2, 2)}] m`,
          description: `Point x = ${fmt(xP, 3)} m lies inside segment ${seg.index + 1} ([${fmt(seg.x1, 3)} m, ${fmt(seg.x2, 3)} m]). Using the solved Double Integration equations for this segment:`,
          equations: [
            `V(${fmt(xP, 3)}) = ${fmt(st.V, 4)}\\text{ kN}, \\qquad M(${fmt(xP, 3)}) = ${fmt(st.M, 4)}\\text{ kN}\\cdot\\text{m}`,
            `EI\\,\\theta(x) = ${polyToLatex(eiTheta, seg.x1)}`,
            `EI\\,y(x) = ${polyToLatex(eiY, seg.x1)}`
          ]
        },
        {
          title: `Step 2 — Substitute x = ${fmt(xP, 3)} m for Slope θ(x)`,
          badge: 'Beam Tilt (Slope)',
          description: `Plug x = ${fmt(xP, 3)} m into the slope equation EI·θ(x) and divide by flexural rigidity EI:`,
          equations: [
            `EI\\,\\theta(${fmt(xP, 3)}) = ${polySubLatex(eiTheta, seg.x1, xP)} = ${fmt(st.theta * input.EI, 4)}\\text{ kN}\\cdot\\text{m}^2`,
            `\\theta(${fmt(xP, 3)}\\text{ m}) = ${fmtSlopeTex(st.theta, sol)}`
          ]
        },
        {
          title: `Step 3 — Substitute x = ${fmt(xP, 3)} m for Deflection y(x)`,
          badge: 'Beam Bend (Deflection)',
          description: `Plug x = ${fmt(xP, 3)} m into the deflection equation EI·y(x) and divide by EI:`,
          equations: [
            `EI\\,y(${fmt(xP, 3)}) = ${polySubLatex(eiY, seg.x1, xP)} = ${fmt(st.y * input.EI, 4)}\\text{ kN}\\cdot\\text{m}^3`,
            `y(${fmt(xP, 3)}\\text{ m}) = ${fmtDeflTex(st.y, sol)}`
          ]
        }
      ];
    }

    // 2. Moment-Area at x = xP
    if (method === 'moment_area') {
      const sub = getSubRegionsBetween(sol, momentArea.refX, xP);
      const maP = momentArea.evalAt(xP);
      const areaUnit = input.isConstantEI ? 'kN·m²/EI' : 'rad';
      const deflUnit = input.isConstantEI ? 'kN·m³/EI' : sol.display.deflShortUnit;

      return [
        {
          title: `Step 1 — Reference Tangent & Bending Areas up to x = ${fmt(xP, 3)} m`,
          badge: `From x_ref = ${fmt(momentArea.refX, 2)} m`,
          description: `Using the reference tangent at x_ref = ${fmt(momentArea.refX, 3)} m (θ_ref = ${input.isConstantEI ? `${fmt(momentArea.thetaRef, 4)}/EI` : `${fmtSci(momentArea.thetaRef)} rad`}), compute the M/EI area(s) strictly between x_ref and x = ${fmt(xP, 3)} m:`,
          equations: [
            `\\theta_{\\text{ref}} = ${fmtSlopeTex(momentArea.thetaRef, sol)}, \\qquad y_{\\text{ref}} = ${fmtDeflTex(momentArea.yRef, sol)}`
          ],
          table:
            sub.rows.length > 0
              ? {
                  headers: ['Sub-Interval (m)', `Signed Area (${areaUnit})`, 'Balance Point x̄ (m)', 'Arm (x - x̄) (m)', `Contribution to t (${deflUnit})`],
                  rows: sub.rows.map((r) => [
                    r.interval,
                    input.isConstantEI ? `${fmt(r.area, 4)} / EI` : fmtSci(r.area),
                    fmt(r.xBar, 4),
                    fmt(r.arm, 4),
                    input.isConstantEI ? `${fmt(r.contribution, 4)} / EI` : fmt(r.contribution * sol.display.deflScale, 4)
                  ])
                }
              : null
        },
        {
          title: `Step 2 — Slope at x = ${fmt(xP, 3)} m (Moment-Area Rule 1)`,
          badge: 'Beam Tilt (Slope)',
          description: `Add the M/EI area between x_ref and x = ${fmt(xP, 3)} m to the reference tangent slope:`,
          equations: [
            `\\Delta\\theta_{${fmt(xP, 2)}/${fmt(momentArea.refX, 2)}} = \\int_{${fmt(momentArea.refX, 2)}}^{${fmt(xP, 2)}} \\frac{M(x)}{EI}\\,dx = ${fmtSlopeTex(maP.dTheta_x_ref, sol)}`,
            `\\theta(${fmt(xP, 3)}\\text{ m}) = \\theta_{\\text{ref}} + \\Delta\\theta = ${fmtSlopeTex(maP.theta, sol)}`
          ]
        },
        {
          title: `Step 3 — Deflection at x = ${fmt(xP, 3)} m (Moment-Area Rule 2)`,
          badge: 'Beam Bend (Deflection)',
          description: `Sum (Area × moment arm to x = ${fmt(xP, 3)} m) for the tangential deviation t, then add the straight reference tangent height:`,
          equations: [
            `t_{${fmt(xP, 2)}/${fmt(momentArea.refX, 2)}} = \\int_{${fmt(momentArea.refX, 2)}}^{${fmt(xP, 2)}} \\frac{M(x)}{EI}(${fmt(xP, 2)} - x)\\,dx = ${fmtDeflTex(maP.t_x_ref, sol)}`,
            `y(${fmt(xP, 3)}\\text{ m}) = y_{\\text{ref}} + \\theta_{\\text{ref}}(${fmt(xP, 2)} - ${fmt(momentArea.refX, 2)}) + t = ${fmtDeflTex(maP.y, sol)}`
          ]
        }
      ];
    }

    // 3. Conjugate Beam at x = xP
    const subLeft = getSubRegionsBetween(sol, 0, xP);
    const cjP = conjugateBeam.evalAt(xP);
    const V0_star = sol.extrema.thetaStart;
    const M0_star = sol.extrema.yStart_mm / 1000;
    const areaUnit = input.isConstantEI ? 'kN·m²/EI' : 'rad';
    const deflUnit = input.isConstantEI ? 'kN·m³/EI' : sol.display.deflShortUnit;

    return [
      {
        title: `Step 1 — Cut the Mirror (Conjugate) Beam at x = ${fmt(xP, 3)} m`,
        badge: `Section Cut [0, ${fmt(xP, 2)}] m`,
        description: `Take a free-body cut on the mirror beam from x = 0 to x = ${fmt(xP, 3)} m. Start with left-end mirror shear V*(0⁺) = θ(0) and moment M*(0⁺) = y(0), plus the elastic load w* = M/EI on [0, ${fmt(xP, 3)}]:`,
        equations: [
          `V^*(0^+) = ${fmtSlopeTex(V0_star, sol)}, \\qquad M^*(0^+) = ${fmtDeflTex(M0_star, sol)}`
        ],
        table:
          subLeft.rows.length > 0
            ? {
                headers: ['Loaded Segment (m)', `Elastic Force W* (${areaUnit})`, 'Balance Point x̄ (m)', 'Arm (x - x̄) (m)', `Moment about Cut (${deflUnit})`],
                rows: subLeft.rows.map((r) => [
                  r.interval,
                  input.isConstantEI ? `${fmt(r.area, 4)} / EI` : fmtSci(r.area),
                  fmt(r.xBar, 4),
                  fmt(r.arm, 4),
                  input.isConstantEI ? `${fmt(r.contribution, 4)} / EI` : fmt(r.contribution * sol.display.deflScale, 4)
                ])
              }
            : null
      },
      {
        title: `Step 2 — Mirror Shear V*(${fmt(xP, 3)}) = Real Slope θ`,
        badge: 'Beam Tilt (Slope)',
        description: `Sum vertical forces on the cut [0, ${fmt(xP, 3)} m] to obtain conjugate shear V*, which equals the actual slope:`,
        equations: [
          `V^*(${fmt(xP, 3)}) = V^*(0^+) + \\int_0^{${fmt(xP, 2)}} \\frac{M(x)}{EI}\\,dx = ${fmtSlopeTex(cjP.V_star, sol)}`,
          `\\theta(${fmt(xP, 3)}\\text{ m}) = V^*(${fmt(xP, 3)}) = ${fmtSlopeTex(cjP.V_star, sol)}`
        ]
      },
      {
        title: `Step 3 — Mirror Moment M*(${fmt(xP, 3)}) = Real Deflection y`,
        badge: 'Beam Bend (Deflection)',
        description: `Sum moments about the cut x = ${fmt(xP, 3)} m to obtain conjugate bending moment M*, which equals the actual deflection:`,
        equations: [
          `M^*(${fmt(xP, 3)}) = M^*(0^+) + V^*(0^+)\\cdot(${fmt(xP, 2)}) + \\int_0^{${fmt(xP, 2)}} \\frac{M(x)}{EI}(${fmt(xP, 2)} - x)\\,dx`,
          `y(${fmt(xP, 3)}\\text{ m}) = M^*(${fmt(xP, 3)}) = ${fmtDeflTex(cjP.M_star, sol)}`
        ]
      }
    ];
  }

  /**
   * Build engineering brief for AI Model prompt
   */
  function buildEngineeringBrief(sol, includeVerifiedGroundTruth = true) {
    const { input, reactions, extrema, momentArea, conjugateBeam, query } = sol;
    const eiLine = input.isConstantEI
      ? `- Flexural Rigidity EI: CONSTANT (symbolic — express slopes in kN·m²/EI and deflections in kN·m³/EI)`
      : `- Young's Modulus E = ${input.E_GPa} GPa, Moment of Inertia I = ${input.I.toExponential(6)} m⁴ (${input.section.label}), EI = ${input.EI.toFixed(4)} kN·m²\n- Requested Deflection Unit: ${input.deflUnit}`;

    const lines = [
      `BEAM CONFIGURATION:`,
      `- Length L = ${input.L} m`,
      eiLine,
      `- Support Condition: ${supportLabel(input.supportType)}`,
      `- Support Coordinates: ${input.supports.map((s) => `${s.id} (${s.type}) at x = ${s.x} m`).join(', ')}`,
      `- Applied Loads (downward force +, CCW moment +):`,
      ...input.loads.map((ld, idx) => `  ${idx + 1}. ${describeLoad(ld)}`),
      `- Specific Check Point: x_q = ${query.x} m`,
      `- Sign Convention: x from 0 (left) to L (right); downward loads positive; internal bending moment M(x) sagging positive; deflection y(x) upward positive (downward sag is negative).`
    ];

    if (includeVerifiedGroundTruth) {
      lines.push(
        ``,
        `VERIFIED NUMERICAL CHECKPOINTS (exact analytical Euler-Bernoulli engine):`,
        `- Reactions: RA = ${reactions.RA.toFixed(5)} kN, RB = ${reactions.RB.toFixed(5)} kN, MA = ${reactions.MA.toFixed(5)} kN·m, MB = ${reactions.MB.toFixed(5)} kN·m`,
        `- Max |Shear|: ${extrema.shear.maxAbsVal.toFixed(5)} kN at x = ${extrema.shear.maxAbsX.toFixed(4)} m`,
        `- Max |Moment|: ${extrema.moment.maxAbsVal.toFixed(5)} kN·m (signed ${extrema.moment.maxAbsSigned.toFixed(5)} kN·m) at x = ${extrema.moment.maxAbsX.toFixed(4)} m`,
        `- Max Deflection: ${fmtDeflPlain(extrema.deflection.maxSigned, sol)} at x = ${extrema.deflection.maxX.toFixed(4)} m`,
        `- At check point x_q = ${query.x} m: V = ${query.V.toFixed(4)} kN, M = ${query.M.toFixed(4)} kN·m, y = ${fmtDeflPlain(query.y, sol)}`,
        `- Moment-Area Regions:`,
        ...momentArea.regions.map(
          (r) => `  * ${r.id} [${r.x1.toFixed(3)}, ${r.x2.toFixed(3)}] m (${r.shape}): Area = ${input.isConstantEI ? `${r.area.toFixed(4)} / EI` : `${r.area.toExponential(5)} rad`}, Centroid x_bar = ${r.xBar.toFixed(4)} m`
        ),
        `- Conjugate Supports: ${conjugateBeam.supports.map((s) => `${s.id} at x=${s.x}m: Real ${s.realType} -> Conjugate ${s.conjType}`).join('; ')}`
      );
    }

    return lines.join('\n');
  }

  BeamStudio.SolutionBuilder = {
    buildDoubleIntegrationSteps,
    buildMomentAreaSteps,
    buildConjugateBeamSteps,
    buildPointSolutionSteps,
    buildEngineeringBrief,
    supportLabel,
    describeLoad,
    fmt,
    fmtSci
  };
})(window);
