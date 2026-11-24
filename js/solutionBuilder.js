/**
 * BeamStudio — Analytical Step-by-Step Solution Builder (LaTeX + Structured Steps)
 * Supports:
 *  - Deflection output units: mm, cm, m
 *  - Constant EI symbolic mode (slopes in kN·m²/EI, deflections in kN·m³/EI)
 *  - Double Integration, Moment-Area, and Conjugate Beam methods
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

  function supportLabel(type) {
    const map = {
      simply_supported: 'Simply Supported (Pin at A, Roller at B)',
      cantilever_left: 'Cantilever (Fixed at Left x = 0, Free at x = L)',
      cantilever_right: 'Cantilever (Free at x = 0, Fixed at Right x = L)',
      overhanging: 'Overhanging Beam (Pin at x_A, Roller at x_B)',
      propped_cantilever: 'Propped Cantilever (Fixed at x = 0, Roller at x = L — Statically Indeterminate)',
      fixed_fixed: 'Fixed-Fixed Beam (Fixed at Both Ends — Statically Indeterminate)'
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

    let note = 'Support reactions are obtained from static equilibrium (∑F_y = 0, ∑M = 0).';
    if (isIndeterminate) {
      note = `This beam is statically indeterminate to degree ${indeterminacyDegree}. Redundant reactions were solved via exact elastic compatibility coupled with static equilibrium.`;
    }

    return {
      title: 'Step 1 — Beam Stiffness & Support Reactions',
      badge: input.isConstantEI ? 'Constant EI' : isIndeterminate ? `Indeterminate (deg ${indeterminacyDegree})` : 'Balance',
      description: note,
      equations: eqs
    };
  }

  /**
   * 1. Double Integration Method Step-by-Step Derivation
   */
  function buildDoubleIntegrationSteps(sol) {
    const { input, segments, constants, extrema, query } = sol;
    const steps = [buildReactionsStep(sol)];

    const momentEqs = segments.map((seg) => {
      const mTex = polyToLatex(seg.Mpoly, seg.x1);
      return `M_{${seg.index + 1}}(x) = ${mTex} \\qquad (${fmt(seg.x1, 3)} \\le x \\le ${fmt(seg.x2, 3)}\\text{ m})`;
    });
    steps.push({
      title: 'Step 2 — Bending Moment Equations EI·y′′(x) = M(x)',
      badge: 'Governing ODE',
      description:
        'Using the Euler-Bernoulli differential equation EI·d²y/dx² = M(x) (sagging positive, y upward positive), express M(x) on each continuous segment:',
      equations: [`EI \\frac{d^2 y}{dx^2} = M(x)`, ...momentEqs]
    });

    const intEqs = [];
    for (const seg of segments) {
      const eiTheta = seg.thetaPoly.map((c) => c * input.EI);
      const eiY = seg.yPoly.map((c) => c * input.EI);
      intEqs.push(`\\text{Interval } [${fmt(seg.x1, 2)}, ${fmt(seg.x2, 2)}]\\text{ m:}\\quad EI\\,\\theta(x) = ${polyToLatex(eiTheta, seg.x1)}`);
      intEqs.push(`EI\\,y(x) = ${polyToLatex(eiY, seg.x1)}`);
    }

    let bcText = '';
    if (input.supportType === 'simply_supported') bcText = `Boundary conditions at pin A and roller B: y(0) = 0 and y(${fmt(input.L, 3)}) = 0.`;
    else if (input.supportType === 'overhanging') bcText = `Boundary conditions at supports A and B: y(${fmt(input.supports[0].x, 3)}) = 0 and y(${fmt(input.supports[1].x, 3)}) = 0.`;
    else if (input.supportType === 'cantilever_left') bcText = 'Fixed-end boundary conditions at x = 0: θ(0) = 0 and y(0) = 0.';
    else if (input.supportType === 'cantilever_right') bcText = `Fixed-end boundary conditions at x = L: θ(${fmt(input.L, 3)}) = 0 and y(${fmt(input.L, 3)}) = 0.`;
    else if (input.supportType === 'propped_cantilever') bcText = `Fixed end at x = 0 gives θ(0) = 0, y(0) = 0; roller at x = L gives y(${fmt(input.L, 3)}) = 0.`;
    else if (input.supportType === 'fixed_fixed') bcText = `Fixed ends at x = 0 and x = L enforce θ(0) = 0, y(0) = 0, θ(${fmt(input.L, 3)}) = 0, y(${fmt(input.L, 3)}) = 0.`;

    steps.push({
      title: 'Step 3 — Boundary Conditions & Integration Constants',
      badge: 'Integration Constants',
      description: `${bcText} Enforcing continuity across segment boundaries yields:`,
      equations: [
        `EI\\,C_1 = EI\\,\\theta(0) = ${fmt(constants.EI_C1, 4)}\\text{ kN}\\cdot\\text{m}^2 \\implies \\theta(0) = ${fmtSlopeTex(constants.C1, sol)}`,
        `EI\\,C_2 = EI\\,y(0) = ${fmt(constants.EI_C2, 4)}\\text{ kN}\\cdot\\text{m}^3 \\implies y(0) = ${fmtDeflTex(constants.C2, sol)}`
      ]
    });

    steps.push({
      title: 'Step 4 — Closed-Form Slope & Elastic Curve Equations',
      badge: 'Solved Functions',
      description: 'Substituting C₁ and C₂ back into each piecewise integral yields the exact slope θ(x) and deflection y(x):',
      equations: intEqs
    });

    steps.push({
      title: 'Step 5 — Maximum Deflection & Check Point Evaluation',
      badge: 'Final Results',
      description: 'Setting θ(x) = 0 (and checking free ends) locates the peak elastic deflection:',
      equations: [
        `\\delta_{\\max} = y(${fmt(extrema.deflection.maxX, 4)}\\text{ m}) = ${fmtDeflTex(extrema.deflection.maxSigned, sol)}`,
        `\\theta(0) = ${fmtSlopeTex(extrema.thetaStart, sol)}, \\qquad \\theta(L) = ${fmtSlopeTex(extrema.thetaEnd, sol)}`,
        `\\text{At check point } x_q = ${fmt(query.x, 3)}\\text{ m:}\\quad \\theta(x_q) = ${fmtSlopeTex(query.theta, sol)}, \\quad y(x_q) = ${fmtDeflTex(query.y, sol)}`
      ]
    });

    return steps;
  }

  /**
   * 2. Moment-Area Method Step-by-Step Derivation
   */
  function buildMomentAreaSteps(sol) {
    const { input, momentArea, extrema, query } = sol;
    const steps = [buildReactionsStep(sol)];
    const areaUnit = input.isConstantEI ? 'kN·m²/EI' : 'rad';

    steps.push({
      title: 'Step 2 — Bending Areas & Balance Points (M/EI)',
      badge: 'Moment-Area Rules',
      description:
        'Divide the bending moment curve by stiffness EI and split it into clean shaded areas Aᵢ with balance points (centroids) x̄ᵢ:',
      equations: [
        `\\textbf{Theorem 1:}\\quad \\theta_{B/A} = \\theta_B - \\theta_A = \\int_{x_A}^{x_B} \\frac{M(x)}{EI}\\,dx = \\sum A_i`,
        `\\textbf{Theorem 2:}\\quad t_{B/A} = \\int_{x_A}^{x_B} \\frac{M(x)}{EI}(x_B - x)\\,dx = \\sum A_i\\,(x_B - \\bar{x}_i)`
      ],
      table: {
        headers: ['Region', 'Interval (m)', 'Geometry', `Area Aᵢ (${areaUnit})`, 'Centroid x̄ᵢ (m)', 'Arm |x_B - x̄ᵢ| (m)'],
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
      input.supportType === 'cantilever_right' ||
      input.supportType === 'propped_cantilever' ||
      input.supportType === 'fixed_fixed';

    if (isFixedRef) {
      steps.push({
        title: 'Step 3 — Reference Tangent at Fixed Support',
        badge: 'Horizontal Tangent',
        description: `Because the beam is fixed at x_ref = ${fmt(momentArea.refX, 3)} m, the reference tangent is strictly horizontal (θ_ref = 0, y_ref = 0). The deflection at any point x equals the tangential deviation t_{x/ref} directly:`,
        equations: [
          `\\theta(${fmt(momentArea.refX, 2)}) = 0, \\qquad y(${fmt(momentArea.refX, 2)}) = 0`,
          `t_{${fmt(momentArea.targetX, 2)}/${fmt(momentArea.refX, 2)}} = ${fmtDeflTex(momentArea.t_target_ref, sol)}`
        ]
      });
    } else {
      const spanAB = momentArea.targetX - momentArea.refX;
      steps.push({
        title: 'Step 3 — Tangential Deviation t_{B/A} & Reference Support Slope θ_A',
        badge: 'Tangent Geometry',
        description: `Draw a reference tangent at support A (x = ${fmt(momentArea.refX, 3)} m). Because both supports have zero deflection, the vertical deviation t_{B/A} at support B directly gives θ_A:`,
        equations: [
          `t_{B/A} = \\sum_{x_A}^{x_B} A_i (x_B - \\bar{x}_i) = ${fmtDeflTex(momentArea.t_target_ref, sol)}`,
          `y_B = y_A + \\theta_A (x_B - x_A) + t_{B/A} = 0 \\implies \\theta_A = -\\frac{t_{B/A}}{${fmt(spanAB, 3)}} = ${fmtSlopeTex(momentArea.thetaRef, sol)}`
        ]
      });
    }

    const maAtMax = momentArea.evalAt(extrema.deflection.maxX);
    const maAtQuery = query.momentArea;

    steps.push({
      title: 'Step 4 — Peak Deflection & Check Point via Moment-Area',
      badge: 'Deflection Extraction',
      description: 'Locate maximum deflection where the tangent becomes horizontal (θ(x) = 0) or at a free end, then combine tangent offset and tangential deviation:',
      equations: [
        `t_{\\max/\\text{ref}} = ${fmtDeflTex(maAtMax.t_x_ref, sol)} \\quad \\text{at } x_{\\max} = ${fmt(extrema.deflection.maxX, 4)}\\text{ m}`,
        `\\delta_{\\max} = y_{\\text{ref}} + \\theta_{\\text{ref}}(x_{\\max} - x_{\\text{ref}}) + t_{\\max/\\text{ref}} = ${fmtDeflTex(maAtMax.y, sol)}`,
        `\\text{At check point } x_q = ${fmt(query.x, 3)}\\text{ m:}\\quad t_{q/\\text{ref}} = ${fmtDeflTex(maAtQuery.t_x_ref, sol)},\\quad y(x_q) = ${fmtDeflTex(maAtQuery.y, sol)}`
      ]
    });

    return steps;
  }

  /**
   * 3. Conjugate Beam Method Step-by-Step Derivation
   */
  function buildConjugateBeamSteps(sol) {
    const { input, conjugateBeam, extrema, query } = sol;
    const steps = [buildReactionsStep(sol)];

    steps.push({
      title: 'Step 2 — Converting to the Mirror (Conjugate) Beam',
      badge: 'Support Swap',
      description: 'Swap real supports into mirror supports so that shear on this mirror beam gives real beam tilt (V* = θ) and bending moment gives real deflection (M* = y):',
      equations: [
        `w^*(x) = \\frac{M(x)}{EI} \\quad (\\text{positive } M/EI \\text{ acts upward}), \\qquad V^*(x) \\equiv \\theta(x), \\qquad M^*(x) \\equiv y(x)`
      ],
      table: {
        headers: ['Location', 'Position x (m)', 'Real Support', 'Conjugate Support', 'Physical Equivalence'],
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
    if (input.supportType === 'fixed_fixed') {
      conjEqs.push(`\\text{Fixed-Fixed } \\to \\text{ Free-Free conjugate beam: elastic load } w^*(x) \\text{ is self-equilibrating } (\\sum F_y^* = 0, \\sum M^* = 0).`);
    }

    steps.push({
      title: 'Step 3 — Conjugate Beam Equilibrium & Elastic Reactions',
      badge: 'Conjugate Statics',
      description: 'Load the conjugate beam with w*(x) = M(x)/EI and solve ∑F_y* = 0, ∑M* = 0 for conjugate reactions:',
      equations: conjEqs
    });

    const cjMax = conjugateBeam.evalAt(extrema.deflection.maxX);
    const cjQ = query.conjugate;

    steps.push({
      title: 'Step 4 — Conjugate Shear V*(x) & Conjugate Moment M*(x)',
      badge: 'Slope & Deflection',
      description: 'Maximum deflection occurs where conjugate shear V*(x) = 0 (or at a conjugate fixed end). Evaluating conjugate bending moment M*(x) yields the real deflection:',
      equations: [
        `V^*(x_{\\max}) = \\theta(${fmt(extrema.deflection.maxX, 4)}) = ${fmtSlopeTex(cjMax.V_star, sol)}`,
        `M^*(x_{\\max}) = \\delta_{\\max} = ${fmtDeflTex(cjMax.M_star, sol)} \\quad \\text{at } x = ${fmt(extrema.deflection.maxX, 4)}\\text{ m}`,
        `\\text{At check point } x_q = ${fmt(query.x, 3)}\\text{ m:}\\quad V^*(x_q) = ${fmtSlopeTex(cjQ.V_star, sol)},\\quad M^*(x_q) = ${fmtDeflTex(cjQ.M_star, sol)}`
      ]
    });

    return steps;
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
    buildEngineeringBrief,
    supportLabel,
    describeLoad,
    fmt,
    fmtSci
  };
})(window);
