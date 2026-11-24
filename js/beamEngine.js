/**
 * BeamStudio — Exact Piecewise-Polynomial Euler-Bernoulli Structural Mechanics Engine
 * Supports:
 *  - 6 Support Conditions: Simply Supported, Cantilever (Fixed Left / Fixed Right),
 *    Overhanging (custom pin & roller positions), Propped Cantilever, Fixed-Fixed.
 *  - 4 Load Types: Point Load, UDL, UVL (Triangular/Trapezoidal), Applied Moment.
 *  - 3 Analysis Methods: Double Integration, Moment-Area, Conjugate Beam (independent formulations).
 *  - Cross-Section Properties: I-Beam (W-Section), Rectangular, Circular Tube, T-Beam, Custom I.
 *
 * Units: Length (m), Force (kN), Distributed Load (kN/m), Moment (kN·m),
 *        E (GPa -> kN/m² via *1e6), I (m⁴), Slope (rad), Deflection (m & mm).
 * Sign Convention:
 *  - x: 0 at left end to L at right end
 *  - Applied vertical loads P, w: positive DOWNWARD
 *  - Applied moments M0: positive COUNTERCLOCKWISE (CCW)
 *  - Support reactions RA, RB: positive UPWARD
 *  - Internal Shear V(x): standard beam convention (up on left -> positive)
 *  - Internal Bending Moment M(x): sagging positive (compression top, tension bottom)
 *  - Deflection y(x): positive UPWARD (so downward sag is negative, matching 3D +Y up)
 *  - Slope theta(x) = dy/dx: positive CCW
 */
(function (global) {
  'use strict';

  const BeamStudio = (global.BeamStudio = global.BeamStudio || {});

  const EPS = 1e-10;

  /**
   * Unit conversion factors to m^4 for Custom Moment of Inertia I
   */
  const I_UNIT_TO_M4 = {
    m4: 1,
    cm4: 1e-8,
    e6mm4: 1e-6,
    mm4: 1e-12,
    in4: 4.162314256e-7
  };

  const I_UNIT_LABELS = {
    m4: 'm⁴',
    cm4: 'cm⁴',
    e6mm4: '×10⁶ mm⁴',
    mm4: 'mm⁴',
    in4: 'in⁴'
  };

  /**
   * Compute cross-section geometric properties (all dimensions in mm, returns I in m^4 & area in m^2)
   */
  function computeSectionProperties(section) {
    const type = section.type || 'ibeam';
    if (type === 'custom') {
      const unit = section.customIUnit || 'm4';
      const factor = I_UNIT_TO_M4[unit] || 1;
      const rawVal = Number(section.customI);
      const I = (rawVal > 0 ? rawVal : 8.5e-5) * factor;
      return {
        type: 'custom',
        I,
        rawI: rawVal > 0 ? rawVal : 8.5e-5,
        customIUnit: unit,
        area: 0.01,
        depth: 0.30,
        width: 0.15,
        label: `Custom Section (I = ${rawVal > 0 ? rawVal : 8.5e-5} ${I_UNIT_LABELS[unit] || 'm⁴'} = ${I.toExponential(3)} m⁴)`
      };
    }

    if (type === 'ibeam') {
      const h = (Number(section.h) || 300) / 1000;
      const bf = (Number(section.bf) || 150) / 1000;
      const tf = Math.min((Number(section.tf) || 12) / 1000, h * 0.45);
      const tw = Math.min((Number(section.tw) || 8) / 1000, bf * 0.9);
      const hw = Math.max(h - 2 * tf, 1e-4);
      const I = (bf * Math.pow(h, 3) - (bf - tw) * Math.pow(hw, 3)) / 12;
      const area = 2 * bf * tf + hw * tw;
      return {
        type, I, area, depth: h, width: bf, tf, tw,
        label: `I-Beam ${Math.round(h * 1000)}×${Math.round(bf * 1000)} mm`
      };
    }

    if (type === 'rect') {
      const b = (Number(section.b) || 200) / 1000;
      const h = (Number(section.h) || 350) / 1000;
      const I = (b * Math.pow(h, 3)) / 12;
      return {
        type, I, area: b * h, depth: h, width: b,
        label: `Rectangular ${Math.round(b * 1000)}×${Math.round(h * 1000)} mm`
      };
    }

    if (type === 'tube') {
      const D = (Number(section.D) || 260) / 1000;
      const t = Math.min((Number(section.t) || 12) / 1000, D / 2);
      const di = Math.max(D - 2 * t, 0);
      const I = (Math.PI * (Math.pow(D, 4) - Math.pow(di, 4))) / 64;
      const area = (Math.PI * (D * D - di * di)) / 4;
      return {
        type, I, area, depth: D, width: D, t,
        label: di > 1e-5
          ? `Circular Tube Ø${Math.round(D * 1000)}×${Math.round(t * 1000)} mm`
          : `Solid Circular Ø${Math.round(D * 1000)} mm`
      };
    }

    if (type === 'tbeam') {
      const bf = (Number(section.bf) || 260) / 1000;
      const tf = (Number(section.tf) || 25) / 1000;
      const tw = Math.min((Number(section.tw) || 30) / 1000, bf);
      const hw = (Number(section.hw) || 260) / 1000;
      const A1 = bf * tf;
      const y1 = hw + tf / 2;
      const A2 = tw * hw;
      const y2 = hw / 2;
      const area = A1 + A2;
      const yc = (A1 * y1 + A2 * y2) / area;
      const I1 = (bf * Math.pow(tf, 3)) / 12 + A1 * Math.pow(y1 - yc, 2);
      const I2 = (tw * Math.pow(hw, 3)) / 12 + A2 * Math.pow(y2 - yc, 2);
      return {
        type, I: I1 + I2, area, depth: hw + tf, width: bf, tf, tw, hw, yc,
        label: `T-Beam ${Math.round((hw + tf) * 1000)}×${Math.round(bf * 1000)} mm`
      };
    }

    return { type: 'custom', I: 8.5e-5, area: 0.01, depth: 0.3, width: 0.15, label: 'Custom' };
  }

  /**
   * Evaluate a polynomial c[0] + c[1]*u + c[2]*u^2 + ...
   */
  function evalPoly(c, u) {
    let val = 0;
    let p = 1;
    for (let i = 0; i < c.length; i++) {
      val += c[i] * p;
      p *= u;
    }
    return val;
  }

  /**
   * Integrate polynomial c from 0 to u: returns array of coefficients (deg + 1) with const = c0
   */
  function integratePoly(c, c0 = 0) {
    const out = [c0];
    for (let i = 0; i < c.length; i++) {
      out.push(c[i] / (i + 1));
    }
    return out;
  }

  /**
   * Find real roots of a polynomial (up to degree 4) on strictly interior (0, L)
   */
  function findInteriorRoots(c, len) {
    if (len <= EPS) return [];
    const roots = [];
    // Sample finely and refine with bisection for guaranteed robustness on deg <= 4
    const samples = 64;
    const du = len / samples;
    let prevU = 0;
    let prevF = evalPoly(c, 0);

    for (let i = 1; i <= samples; i++) {
      const u = i * du;
      const f = evalPoly(c, u);
      if (Math.abs(f) < 1e-11 && u > EPS && u < len - EPS) {
        roots.push(u);
      } else if (prevF * f < 0) {
        // Bisection refinement to 1e-12
        let lo = prevU;
        let hi = u;
        let flo = prevF;
        for (let iter = 0; iter < 50; iter++) {
          const mid = 0.5 * (lo + hi);
          const fmid = evalPoly(c, mid);
          if (Math.abs(fmid) < 1e-13 || hi - lo < 1e-12) {
            lo = hi = mid;
            break;
          }
          if (flo * fmid <= 0) {
            hi = mid;
          } else {
            lo = mid;
            flo = fmid;
          }
        }
        const r = 0.5 * (lo + hi);
        if (r > 1e-7 && r < len - 1e-7) {
          roots.push(r);
        }
      }
      prevU = u;
      prevF = f;
    }

    // Deduplicate close roots
    roots.sort((a, b) => a - b);
    const unique = [];
    for (const r of roots) {
      if (unique.length === 0 || r - unique[unique.length - 1] > 1e-5) {
        unique.push(r);
      }
    }
    return unique;
  }

  /**
   * Collect sorted unique breakpoints along [0, L]
   */
  function getBreakpoints(L, supports, loads) {
    const pts = [0, L];
    for (const s of supports) {
      if (s.x >= -EPS && s.x <= L + EPS) pts.push(Math.max(0, Math.min(L, s.x)));
    }
    for (const ld of loads) {
      if (ld.a !== undefined) pts.push(Math.max(0, Math.min(L, ld.a)));
      if (ld.b !== undefined) pts.push(Math.max(0, Math.min(L, ld.b)));
    }
    pts.sort((a, b) => a - b);
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      if (pts[i] - out[out.length - 1] > 1e-7) {
        out.push(pts[i]);
      }
    }
    return out;
  }

  /**
   * Total vertical downward force and CW moment about reference xRef from applied loads
   */
  function appliedLoadResultants(loads, xRef = 0) {
    let totalForce = 0; // positive downward
    let totalMomentCW = 0; // positive CW about xRef

    for (const ld of loads) {
      if (ld.type === 'Point') {
        const P = ld.P;
        totalForce += P;
        totalMomentCW += P * (ld.a - xRef);
      } else if (ld.type === 'Moment') {
        // Positive input M is CCW -> reduces CW moment about xRef
        totalMomentCW -= ld.M;
      } else if (ld.type === 'UDL') {
        const len = ld.b - ld.a;
        const R = ld.w * len;
        const xc = 0.5 * (ld.a + ld.b);
        totalForce += R;
        totalMomentCW += R * (xc - xRef);
      } else if (ld.type === 'UVL') {
        const len = ld.b - ld.a;
        const w1 = ld.w1;
        const w2 = ld.w2;
        const R = 0.5 * (w1 + w2) * len;
        // First moment about a: integral_0^len (w1 + (w2-w1)*u/len)*u du = w1*len^2/2 + (w2-w1)*len^2/3
        const mAboutA = (w1 / 2 + (w2 - w1) / 3) * len * len;
        totalForce += R;
        totalMomentCW += R * (ld.a - xRef) + mAboutA;
      }
    }
    return { totalForce, totalMomentCW };
  }

  /**
   * Build exact piecewise polynomials for q(x), V(x), M(x) given all point forces (upward positive reactions + downward applied)
   * and moments (CCW positive).
   *
   * pointForces: [{ x, F_up }] (upward positive)
   * appliedMoments: [{ x, M_ccw }] (CCW positive)
   * distLoads: UDL and UVL items from loads
   */
  function buildExactInternalPolys(L, breakpoints, pointForces, appliedMoments, distLoads) {
    const segments = [];

    for (let k = 0; k < breakpoints.length - 1; k++) {
      const x1 = breakpoints[k];
      const x2 = breakpoints[k + 1];
      const len = x2 - x1;
      const xMid = 0.5 * (x1 + x2);

      // Local downward distributed load intensity q(u) = q0 + q1*u on u in [0, len]
      let q0 = 0;
      let q1 = 0;
      for (const ld of distLoads) {
        if (xMid >= ld.a - EPS && xMid <= ld.b + EPS) {
          if (ld.type === 'UDL') {
            q0 += ld.w;
          } else if (ld.type === 'UVL') {
            const slope = (ld.w2 - ld.w1) / (ld.b - ld.a);
            q0 += ld.w1 + slope * (x1 - ld.a);
            q1 += slope;
          }
        }
      }

      // Compute exact V(x1+) and M(x1+) from left free-body cut immediately to the right of x1
      let V0 = 0;
      let M0 = 0;

      // 1. Point forces at x <= x1 (upward positive)
      for (const pf of pointForces) {
        if (pf.x <= x1 + 1e-7) {
          V0 += pf.F_up;
          M0 += pf.F_up * (x1 - pf.x);
        }
      }

      // 2. Concentrated moments at x <= x1 (CCW positive -> causes M jump of -M_ccw)
      for (const mm of appliedMoments) {
        if (mm.x <= x1 + 1e-7) {
          M0 -= mm.M_ccw;
        }
      }

      // 3. Distributed loads strictly to the left of x1 (on [a, min(b, x1)])
      for (const ld of distLoads) {
        if (ld.a < x1 - 1e-7) {
          const endX = Math.min(ld.b, x1);
          const span = endX - ld.a;
          if (span > 1e-9) {
            if (ld.type === 'UDL') {
              const R = ld.w * span;
              const xc = 0.5 * (ld.a + endX);
              V0 -= R;
              M0 -= R * (x1 - xc);
            } else if (ld.type === 'UVL') {
              const slope = (ld.w2 - ld.w1) / (ld.b - ld.a);
              const wStart = ld.w1;
              const wEnd = ld.w1 + slope * span;
              const R = 0.5 * (wStart + wEnd) * span;
              // Moment of downward load about x1:
              // integral_{ld.a}^{endX} q(s)*(x1 - s) ds
              // Let t = s - ld.a in [0, span], q(t) = wStart + slope*t, (x1 - s) = (x1 - ld.a) - t
              const d = x1 - ld.a;
              const intQ = wStart * span + 0.5 * slope * span * span;
              const intQt = 0.5 * wStart * span * span + (slope * Math.pow(span, 3)) / 3;
              const mAboutX1 = d * intQ - intQt;
              V0 -= R;
              M0 -= mAboutX1;
            }
          }
        }
      }

      // On interval u in [0, len]:
      // dV/du = -q(u) = -q0 - q1*u
      // V(u) = V0 - q0*u - (q1/2)*u^2
      const Vpoly = [V0, -q0, -0.5 * q1];
      // dM/du = V(u)
      // M(u) = M0 + V0*u - (q0/2)*u^2 - (q1/6)*u^3
      const Mpoly = [M0, V0, -0.5 * q0, -q1 / 6];

      segments.push({
        index: k,
        x1,
        x2,
        len,
        qPoly: [q0, q1],
        Vpoly,
        Mpoly
      });
    }

    return segments;
  }

  /**
   * Integrate M(u)/EI twice across all segments assuming initial theta(0) = theta0, y(0) = y0
   */
  function integrateCurvatureSegments(segments, EI, thetaStart = 0, yStart = 0) {
    let curTheta = thetaStart;
    let curY = yStart;
    const integrated = [];

    for (const seg of segments) {
      const kPoly = seg.Mpoly.map((c) => c / EI);
      const thetaPoly = integratePoly(kPoly, curTheta);
      const yPoly = integratePoly(thetaPoly, curY);
      const nextTheta = evalPoly(thetaPoly, seg.len);
      const nextY = evalPoly(yPoly, seg.len);
      integrated.push({
        ...seg,
        kPoly,
        thetaPoly,
        yPoly,
        thetaStart: curTheta,
        thetaEnd: nextTheta,
        yStart: curY,
        yEnd: nextY
      });
      curTheta = nextTheta;
      curY = nextY;
    }

    return {
      segments: integrated,
      endTheta: curTheta,
      endY: curY
    };
  }

  /**
   * Evaluate piecewise polynomial segments at arbitrary x in [0, L]
   */
  function evalPiecewise(segments, x, propName, side = 'right') {
    if (segments.length === 0) return 0;
    if (x <= segments[0].x1 + 1e-9) {
      return evalPoly(segments[0][propName], 0);
    }
    const last = segments[segments.length - 1];
    if (x >= last.x2 - 1e-9) {
      return evalPoly(last[propName], last.len);
    }
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (side === 'left') {
        if (x >= seg.x1 - 1e-9 && x <= seg.x2 + 1e-9) {
          return evalPoly(seg[propName], Math.max(0, Math.min(seg.len, x - seg.x1)));
        }
      } else {
        if (x >= seg.x1 - 1e-9 && x < seg.x2 - 1e-9) {
          return evalPoly(seg[propName], Math.max(0, Math.min(seg.len, x - seg.x1)));
        }
      }
    }
    return evalPoly(last[propName], last.len);
  }

  /**
   * Main Solver: solves beam with exact piecewise analytical polynomials AND verifies across all 3 methods
   */
  function solveBeam(config) {
    const L = Number(config.length);
    const isConstantEI = Boolean(config.constantEI);
    const E_GPa = isConstantEI ? 1 : Number(config.E);
    const sectionProps = computeSectionProperties(config.section || { type: 'custom', customI: config.I });
    const I = isConstantEI
      ? 1
      : config.section && config.section.type !== 'custom'
        ? sectionProps.I
        : Number(config.I || sectionProps.I);
    const E = isConstantEI ? 1 : E_GPa * 1e6; // GPa -> kN/m^2
    const EI = isConstantEI ? 1 : E * I; // kN·m^2 (or 1 for symbolic constant EI)

    if (!(L > 0) || (!isConstantEI && (!(E > 0) || !(I > 0)))) {
      throw new Error('Beam length L, Young’s modulus E, and moment of inertia I must be positive.');
    }

    const deflUnit = ['mm', 'cm', 'm'].includes(config.deflUnit) ? config.deflUnit : 'mm';
    const deflScale = isConstantEI ? 1 : deflUnit === 'mm' ? 1000 : deflUnit === 'cm' ? 100 : 1;
    const deflShortUnit = isConstantEI ? '/EI' : deflUnit;
    const slopeScale = isConstantEI ? 1 : 1000;
    const slopeUnitLabel = isConstantEI ? '/EI' : 'mrad';

    const supportType = config.supportType || 'simply_supported';
    const loads = (config.loads || []).map((ld) => ({ ...ld }));
    const distLoads = loads.filter((ld) => ld.type === 'UDL' || ld.type === 'UVL');

    // Validate loads
    for (const ld of loads) {
      if (ld.a < -1e-6 || ld.a > L + 1e-6) {
        throw new Error(`Load position a = ${ld.a} m is outside beam length [0, ${L} m].`);
      }
      if ((ld.type === 'UDL' || ld.type === 'UVL') && (ld.b <= ld.a || ld.b > L + 1e-6)) {
        throw new Error(`Distributed load [${ld.a}, ${ld.b}] must satisfy 0 ≤ a < b ≤ ${L}.`);
      }
    }

    // Determine support positions & types
    let xA = 0;
    let xB = L;
    let supports = [];
    let isIndeterminate = false;
    let indeterminacyDegree = 0;

    if (supportType === 'simply_supported') {
      supports = [
        { id: 'A', type: 'pin', x: 0 },
        { id: 'B', type: 'roller', x: L }
      ];
    } else if (supportType === 'cantilever_left') {
      supports = [{ id: 'A', type: 'fixed', x: 0 }];
    } else if (supportType === 'cantilever_right') {
      supports = [{ id: 'B', type: 'fixed', x: L }];
    } else if (supportType === 'overhanging') {
      xA = Number(config.supportA ?? 0);
      xB = Number(config.supportB ?? L * 0.75);
      if (!(xA >= 0 && xB <= L && xB - xA > 1e-4)) {
        throw new Error('Overhanging supports must satisfy 0 ≤ x_A < x_B ≤ L.');
      }
      supports = [
        { id: 'A', type: 'pin', x: xA },
        { id: 'B', type: 'roller', x: xB }
      ];
    } else if (supportType === 'propped_cantilever') {
      isIndeterminate = true;
      indeterminacyDegree = 1;
      supports = [
        { id: 'A', type: 'fixed', x: 0 },
        { id: 'B', type: 'roller', x: L }
      ];
    } else if (supportType === 'fixed_fixed') {
      isIndeterminate = true;
      indeterminacyDegree = 2;
      supports = [
        { id: 'A', type: 'fixed', x: 0 },
        { id: 'B', type: 'fixed', x: L }
      ];
    } else {
      throw new Error(`Unsupported support type: ${supportType}`);
    }

    const breakpoints = getBreakpoints(L, supports, loads);

    // Collect applied point forces (downward -> negative F_up) and moments (CCW positive)
    const appliedPointForces = loads
      .filter((ld) => ld.type === 'Point')
      .map((ld) => ({ x: ld.a, F_up: -ld.P }));
    const appliedMomentsList = loads
      .filter((ld) => ld.type === 'Moment')
      .map((ld) => ({ x: ld.a, M_ccw: ld.M }));

    // Step 1: Solve Support Reactions
    const reactions = { RA: 0, RB: 0, MA: 0, MB: 0 };
    const { totalForce, totalMomentCW } = appliedLoadResultants(loads, 0);

    if (supportType === 'simply_supported') {
      reactions.RB = totalMomentCW / L;
      reactions.RA = totalForce - reactions.RB;
    } else if (supportType === 'overhanging') {
      const resA = appliedLoadResultants(loads, xA);
      reactions.RB = resA.totalMomentCW / (xB - xA);
      reactions.RA = resA.totalForce - reactions.RB;
    } else if (supportType === 'cantilever_left') {
      reactions.RA = totalForce;
      reactions.MA = totalMomentCW; // CCW reaction moment at x=0 balancing CW load moment
    } else if (supportType === 'cantilever_right') {
      const resB = appliedLoadResultants(loads, L);
      reactions.RB = resB.totalForce;
      reactions.MB = resB.totalMomentCW; // CCW reaction moment at x=L
    } else if (supportType === 'propped_cantilever') {
      // Primary structure: cantilever fixed at x=0
      const pForces0 = [{ x: 0, F_up: totalForce }, ...appliedPointForces];
      const pMoments0 = [{ x: 0, M_ccw: totalMomentCW }, ...appliedMomentsList];
      const segs0 = buildExactInternalPolys(L, breakpoints, pForces0, pMoments0, distLoads);
      const int0 = integrateCurvatureSegments(segs0, EI, 0, 0);
      const deltaB0 = int0.endY;
      const deltaB1 = Math.pow(L, 3) / (3 * EI);
      reactions.RB = -deltaB0 / deltaB1;
      reactions.RA = totalForce - reactions.RB;
      reactions.MA = totalMomentCW - reactions.RB * L;
    } else if (supportType === 'fixed_fixed') {
      // Primary structure: cantilever fixed at x=0, release RB (upward) & MB (CCW) at x=L
      const pForces0 = [{ x: 0, F_up: totalForce }, ...appliedPointForces];
      const pMoments0 = [{ x: 0, M_ccw: totalMomentCW }, ...appliedMomentsList];
      const segs0 = buildExactInternalPolys(L, breakpoints, pForces0, pMoments0, distLoads);
      const int0 = integrateCurvatureSegments(segs0, EI, 0, 0);
      const d0 = int0.endY;
      const t0 = int0.endTheta;
      reactions.RB = (EI / Math.pow(L, 3)) * (-12 * d0 + 6 * L * t0);
      reactions.MB = (EI / Math.pow(L, 2)) * (6 * d0 - 4 * L * t0);
      reactions.RA = totalForce - reactions.RB;
      // Sum M_A (CCW+) = MA + MB + RB*L - totalMomentCW = 0 => MA = totalMomentCW - RB*L - MB
      reactions.MA = totalMomentCW - reactions.RB * L - reactions.MB;
    }

    // Build complete point force and moment lists including reactions
    const allPointForces = [...appliedPointForces];
    const allMoments = [...appliedMomentsList];
    if (supportType === 'simply_supported') {
      allPointForces.push({ x: 0, F_up: reactions.RA }, { x: L, F_up: reactions.RB });
    } else if (supportType === 'overhanging') {
      allPointForces.push({ x: xA, F_up: reactions.RA }, { x: xB, F_up: reactions.RB });
    } else if (supportType === 'cantilever_left') {
      allPointForces.push({ x: 0, F_up: reactions.RA });
      allMoments.push({ x: 0, M_ccw: reactions.MA });
    } else if (supportType === 'cantilever_right') {
      allPointForces.push({ x: L, F_up: reactions.RB });
      allMoments.push({ x: L, M_ccw: reactions.MB });
    } else if (supportType === 'propped_cantilever') {
      allPointForces.push({ x: 0, F_up: reactions.RA }, { x: L, F_up: reactions.RB });
      allMoments.push({ x: 0, M_ccw: reactions.MA });
    } else if (supportType === 'fixed_fixed') {
      allPointForces.push({ x: 0, F_up: reactions.RA }, { x: L, F_up: reactions.RB });
      allMoments.push({ x: 0, M_ccw: reactions.MA }, { x: L, M_ccw: reactions.MB });
    }

    // Step 2: Exact piecewise V(x) and M(x)
    const rawSegments = buildExactInternalPolys(L, breakpoints, allPointForces, allMoments, distLoads);

    // Step 3A: METHOD 1 — DOUBLE INTEGRATION METHOD
    const zeroInt = integrateCurvatureSegments(rawSegments, EI, 0, 0);
    let C1 = 0; // theta(0)
    let C2 = 0; // y(0)

    if (supportType === 'simply_supported') {
      // y(0) = 0 -> C2 = 0; y(L) = 0 -> y0(L) + C1*L = 0
      C1 = -zeroInt.endY / L;
      C2 = 0;
    } else if (supportType === 'overhanging') {
      const y0A = evalPiecewise(zeroInt.segments, xA, 'yPoly');
      const y0B = evalPiecewise(zeroInt.segments, xB, 'yPoly');
      C1 = -(y0B - y0A) / (xB - xA);
      C2 = -y0A - C1 * xA;
    } else if (
      supportType === 'cantilever_left' ||
      supportType === 'propped_cantilever' ||
      supportType === 'fixed_fixed'
    ) {
      // theta(0) = 0, y(0) = 0
      C1 = 0;
      C2 = 0;
    } else if (supportType === 'cantilever_right') {
      // theta(L) = 0 -> theta0(L) + C1 = 0; y(L) = 0 -> y0(L) + C1*L + C2 = 0
      C1 = -zeroInt.endTheta;
      C2 = -zeroInt.endY - C1 * L;
    }

    const doubleIntRes = integrateCurvatureSegments(rawSegments, EI, C1, C2);
    const segments = doubleIntRes.segments;

    // Step 3B: METHOD 2 — MOMENT-AREA METHOD (Exact Region Decomposition + Theorems 1 & 2)
    const momentAreaRegions = [];
    for (const seg of segments) {
      // Split at any interior M(x) = 0 roots so each region has a consistent sign
      const roots = findInteriorRoots(seg.Mpoly, seg.len);
      const subBounds = [0, ...roots, seg.len];

      for (let j = 0; j < subBounds.length - 1; j++) {
        const u1 = subBounds[j];
        const u2 = subBounds[j + 1];
        const subLen = u2 - u1;
        if (subLen < 1e-7) continue;

        // Exact definite integral of k(u) and (x1+u)*k(u) over [u1, u2]
        const K = integratePoly(seg.kPoly, 0);
        const area = evalPoly(K, u2) - evalPoly(K, u1);

        // u * k(u)
        const ukPoly = [0, ...seg.kPoly];
        const UK = integratePoly(ukPoly, 0);
        const firstMomLocal = evalPoly(UK, u2) - evalPoly(UK, u1);
        const xStart = seg.x1 + u1;
        const xEnd = seg.x1 + u2;

        // Centroid global xBar
        let xBar = 0.5 * (xStart + xEnd);
        if (Math.abs(area) > 1e-14) {
          xBar = seg.x1 + firstMomLocal / area;
        }

        const kStart = evalPoly(seg.kPoly, u1);
        const kEnd = evalPoly(seg.kPoly, u2);
        const kMid = evalPoly(seg.kPoly, 0.5 * (u1 + u2));

        // Classify geometric shape
        let shape = 'Constant (Rectangle)';
        const c2 = Math.abs(seg.Mpoly[2] || 0);
        const c3 = Math.abs(seg.Mpoly[3] || 0);
        const c1 = Math.abs(seg.Mpoly[1] || 0);
        if (c3 > 1e-7) {
          shape = 'Cubic Curve (UVL)';
        } else if (c2 > 1e-7) {
          shape = 'Parabolic (UDL)';
        } else if (c1 > 1e-7) {
          if (Math.abs(kStart) < 1e-9 || Math.abs(kEnd) < 1e-9) {
            shape = 'Triangle';
          } else {
            shape = 'Trapezoid';
          }
        } else if (Math.abs(area) < 1e-13) {
          shape = 'Zero Curvature';
        }

        momentAreaRegions.push({
          id: `A${momentAreaRegions.length + 1}`,
          x1: xStart,
          x2: xEnd,
          width: subLen,
          area, // rad
          xBar, // m
          kStart,
          kEnd,
          kMid,
          sign: area >= 0 ? 1 : -1,
          shape
        });
      }
    }

    // Moment-Area Reference Point & Tangential Deviations
    // Helper: exact integral_a^b (M/EI) dx and t_{target / ref} = integral_{ref}^{target} (M/EI)*(target - s) ds
    function momentAreaIntegral(xFrom, xTo) {
      const dir = xTo >= xFrom ? 1 : -1;
      const lo = Math.min(xFrom, xTo);
      const hi = Math.max(xFrom, xTo);
      let dTheta = 0;
      let momAboutTarget = 0;

      for (const seg of segments) {
        const a = Math.max(lo, seg.x1);
        const b = Math.min(hi, seg.x2);
        if (b - a <= 1e-10) continue;
        const u1 = a - seg.x1;
        const u2 = b - seg.x1;
        const K = integratePoly(seg.kPoly, 0);
        const areaSeg = evalPoly(K, u2) - evalPoly(K, u1);
        const UK = integratePoly([0, ...seg.kPoly], 0);
        const uAreaSeg = evalPoly(UK, u2) - evalPoly(UK, u1);
        const xAreaSeg = seg.x1 * areaSeg + uAreaSeg;
        dTheta += dir * areaSeg;
        // t_{xTo / xFrom} = integral_{lo}^{hi} k(s)*(xTo - s) ds  (signed properly for both directions)
        momAboutTarget += xTo * areaSeg - xAreaSeg;
      }
      // Note: standard second moment-area theorem:
      // y(xTo) - [y(xFrom) + theta(xFrom)*(xTo - xFrom)] = integral_{xFrom}^{xTo} k(s)*(xTo - s) ds
      // When xTo < xFrom, integral_{xFrom}^{xTo} k(s)*(xTo - s) ds = -integral_{xTo}^{xFrom} k(s)*(xTo - s) ds
      // = integral_{xTo}^{xFrom} k(s)*(s - xTo) ds = -momAboutTarget!
      const t_to_from = dir >= 0 ? momAboutTarget : -momAboutTarget;
      return { dTheta, t_to_from };
    }

    let refX = 0;
    let targetX = L;
    let thetaRef = C1;
    let yRef = C2;
    let t_target_ref = 0;

    if (supportType === 'simply_supported') {
      refX = 0;
      targetX = L;
      const ma = momentAreaIntegral(0, L);
      t_target_ref = ma.t_to_from;
      // y(L) = y(0) + theta(0)*L + t_{B/A} = 0 => theta(0) = -t_{B/A} / L
      thetaRef = -t_target_ref / L;
      yRef = 0;
    } else if (supportType === 'overhanging') {
      refX = xA;
      targetX = xB;
      const ma = momentAreaIntegral(xA, xB);
      t_target_ref = ma.t_to_from;
      thetaRef = -t_target_ref / (xB - xA);
      yRef = 0;
    } else if (supportType === 'cantilever_right') {
      refX = L;
      targetX = 0;
      const ma = momentAreaIntegral(L, 0);
      t_target_ref = ma.t_to_from;
      thetaRef = 0;
      yRef = 0;
    } else {
      // cantilever_left, propped_cantilever, fixed_fixed -> tangent at x=0 is horizontal!
      refX = 0;
      targetX = L;
      const ma = momentAreaIntegral(0, L);
      t_target_ref = ma.t_to_from;
      thetaRef = 0;
      yRef = 0;
    }

    function evalMomentAreaAt(x) {
      const ma = momentAreaIntegral(refX, x);
      const theta = thetaRef + ma.dTheta;
      const y = yRef + thetaRef * (x - refX) + ma.t_to_from;
      return { theta, y, t_x_ref: ma.t_to_from, dTheta_x_ref: ma.dTheta };
    }

    // Step 3C: METHOD 3 — CONJUGATE BEAM METHOD
    // Real-to-Conjugate Support Mapping
    const conjugateSupports = [];
    const conjugateReactions = { RA_star: 0, RB_star: 0, MA_star: 0, MB_star: 0 };

    // Total upward elastic load W* = integral_0^L (M/EI) dx and its moment about x=0: integral_0^L x*(M/EI) dx
    let totalWStar = 0;
    let totalMStarAbout0 = 0;
    for (const reg of momentAreaRegions) {
      totalWStar += reg.area;
      totalMStarAbout0 += reg.area * reg.xBar;
    }

    if (supportType === 'simply_supported') {
      conjugateSupports.push(
        { id: 'A*', x: 0, realType: 'Pin', conjType: 'Pin', symbol: 'pin' },
        { id: 'B*', x: L, realType: 'Roller', conjType: 'Roller', symbol: 'roller' }
      );
      // Upward elastic load w* = M/EI. Sum M*_B = 0 (or Sum M*_A = 0):
      // RB* (upward) * L + totalMStarAbout0 = 0 => RB* = -totalMStarAbout0 / L
      // Wait: check sign! With V*(0+) = RA* = theta(0) and V*(L-) = -RB*_upward?
      // Let's keep RA* and RB* as UPWARD forces on conjugate beam:
      // Sum F_y* = RA* + RB* + totalWStar = 0
      // Sum M_A* (CCW+) = totalMStarAbout0 + RB* * L = 0 => RB* = -totalMStarAbout0 / L
      // RA* = -totalWStar - RB*
      // Check V*(0+) = RA* = -totalWStar + totalMStarAbout0 / L = -1/L * integral_0^L (L-x)*k(x) dx = -t_{B/A}/L = theta(0)! EXACT!
      conjugateReactions.RB_star = -totalMStarAbout0 / L;
      conjugateReactions.RA_star = -totalWStar - conjugateReactions.RB_star;
    } else if (supportType === 'cantilever_left') {
      conjugateSupports.push(
        { id: 'A*', x: 0, realType: 'Fixed', conjType: 'Free', symbol: 'free' },
        { id: 'B*', x: L, realType: 'Free', conjType: 'Fixed', symbol: 'fixed' }
      );
      // Free at x=0, Fixed at x=L:
      // Conjugate fixed wall at x=L resists upward W* with upward RB* = -totalWStar
      // and CCW moment MB* = -integral_0^L (x - L)*k(x) dx = L*totalWStar - totalMStarAbout0
      conjugateReactions.RB_star = -totalWStar;
      conjugateReactions.MB_star = L * totalWStar - totalMStarAbout0;
    } else if (supportType === 'cantilever_right') {
      conjugateSupports.push(
        { id: 'A*', x: 0, realType: 'Free', conjType: 'Fixed', symbol: 'fixed' },
        { id: 'B*', x: L, realType: 'Fixed', conjType: 'Free', symbol: 'free' }
      );
      conjugateReactions.RA_star = -totalWStar;
      conjugateReactions.MA_star = -totalMStarAbout0;
    } else if (supportType === 'overhanging') {
      if (xA > 1e-6) {
        conjugateSupports.push({ id: '0*', x: 0, realType: 'Free End', conjType: 'Fixed', symbol: 'fixed' });
        conjugateSupports.push({ id: 'A*', x: xA, realType: 'Interior Pin', conjType: 'Internal Hinge', symbol: 'hinge' });
      } else {
        conjugateSupports.push({ id: 'A*', x: 0, realType: 'Pin', conjType: 'Pin', symbol: 'pin' });
      }
      if (xB < L - 1e-6) {
        conjugateSupports.push({ id: 'B*', x: xB, realType: 'Interior Roller', conjType: 'Internal Hinge', symbol: 'hinge' });
        conjugateSupports.push({ id: 'L*', x: L, realType: 'Free End', conjType: 'Fixed', symbol: 'fixed' });
      } else {
        conjugateSupports.push({ id: 'B*', x: L, realType: 'Roller', conjType: 'Roller', symbol: 'roller' });
      }
      // Conjugate left end force/moment equals real theta(0) and y(0)
      conjugateReactions.RA_star = evalPiecewise(segments, 0, 'thetaPoly');
      conjugateReactions.MA_star = -evalPiecewise(segments, 0, 'yPoly');
      conjugateReactions.RB_star = -evalPiecewise(segments, L, 'thetaPoly');
      conjugateReactions.MB_star = evalPiecewise(segments, L, 'yPoly');
    } else if (supportType === 'propped_cantilever') {
      conjugateSupports.push(
        { id: 'A*', x: 0, realType: 'Fixed', conjType: 'Free', symbol: 'free' },
        { id: 'B*', x: L, realType: 'Roller', conjType: 'Roller', symbol: 'roller' }
      );
      conjugateReactions.RB_star = -totalWStar; // equals -theta(L)
    } else if (supportType === 'fixed_fixed') {
      conjugateSupports.push(
        { id: 'A*', x: 0, realType: 'Fixed', conjType: 'Free', symbol: 'free' },
        { id: 'B*', x: L, realType: 'Fixed', conjType: 'Free', symbol: 'free' }
      );
      // Self-equilibrating elastic load! totalWStar == 0 and totalMStarAbout0 == 0!
    }

    function evalConjugateBeamAt(x) {
      // Starting from x=0 with V*(0+) = theta(0), M*(0+) = y(0) determined by conjugate boundary conditions:
      let V0_star = 0;
      let M0_star = 0;
      if (supportType === 'simply_supported') {
        V0_star = conjugateReactions.RA_star;
        M0_star = 0;
      } else if (supportType === 'cantilever_right') {
        V0_star = conjugateReactions.RA_star;
        M0_star = -conjugateReactions.MA_star;
      } else if (supportType === 'overhanging') {
        V0_star = conjugateReactions.RA_star;
        M0_star = -conjugateReactions.MA_star;
      } else {
        // cantilever_left, propped_cantilever, fixed_fixed -> free at x=0 => V*(0)=0, M*(0)=0
        V0_star = 0;
        M0_star = 0;
      }
      // Integrate upward w* = M/EI from 0 to x
      const ma = momentAreaIntegral(0, x);
      const V_star = V0_star + ma.dTheta;
      const M_star = M0_star + V0_star * x + ma.t_to_from;
      return { V_star, M_star };
    }

    // Step 4: Dense Sampling Grid (including exact left/right discontinuity points at breakpoints!)
    const N = 400;
    const gridX = [];
    for (let i = 0; i <= N; i++) {
      gridX.push((L * i) / N);
    }
    // Insert breakpoint values +/- tiny epsilon for sharp jumps in V(x) and M(x)
    const samplePoints = [];
    const rawCoords = new Set(gridX.map((v) => Number(v.toFixed(9))));
    for (const bp of breakpoints) {
      rawCoords.add(Number(bp.toFixed(9)));
      if (bp > 1e-6) rawCoords.add(Number((bp - 1e-6).toFixed(9)));
      if (bp < L - 1e-6) rawCoords.add(Number((bp + 1e-6).toFixed(9)));
    }
    const sortedX = Array.from(rawCoords).sort((a, b) => a - b);

    const xArr = [];
    const qArr = [];
    const VArr = [];
    const MArr = [];
    const kArr = [];
    const thetaArr = [];
    const yArr = [];
    const thetaMA = [];
    const yMA = [];
    const thetaConj = [];
    const yConj = [];

    for (let i = 0; i < sortedX.length; i++) {
      const x = sortedX[i];
      // Determine whether to evaluate left or right side of a breakpoint
      const isLeftJump = i + 1 < sortedX.length && Math.abs(sortedX[i + 1] - x) < 2e-6;
      const side = isLeftJump ? 'left' : 'right';

      const qv = evalPiecewise(segments, x, 'qPoly', side);
      const Vv = evalPiecewise(segments, x, 'Vpoly', side);
      const Mv = evalPiecewise(segments, x, 'Mpoly', side);
      const kv = Mv / EI;
      const tv = evalPiecewise(segments, x, 'thetaPoly', side);
      const yv = evalPiecewise(segments, x, 'yPoly', side);

      const maVal = evalMomentAreaAt(x);
      const cjVal = evalConjugateBeamAt(x);

      xArr.push(x);
      qArr.push(qv);
      VArr.push(Vv);
      MArr.push(Mv);
      kArr.push(kv);
      thetaArr.push(tv);
      yArr.push(yv);
      thetaMA.push(maVal.theta);
      yMA.push(maVal.y);
      thetaConj.push(cjVal.V_star);
      yConj.push(cjVal.M_star);
    }

    // Step 5: Find EXACT Extrema (Max/Min V, M, Deflection, Zero-Shear, Zero-Slope, Inflection Points)
    const zeroShearPoints = [];
    const inflectionPoints = [];
    const zeroSlopePoints = [];

    for (const seg of segments) {
      for (const r of findInteriorRoots(seg.Vpoly, seg.len)) {
        zeroShearPoints.push(seg.x1 + r);
      }
      for (const r of findInteriorRoots(seg.Mpoly, seg.len)) {
        inflectionPoints.push(seg.x1 + r);
      }
      for (const r of findInteriorRoots(seg.thetaPoly, seg.len)) {
        zeroSlopePoints.push(seg.x1 + r);
      }
    }

    // Candidate extrema locations
    const candX = [...breakpoints, ...zeroShearPoints, ...zeroSlopePoints];

    function findExtrema(evalFn) {
      let maxVal = -Infinity, maxX = 0;
      let minVal = Infinity, minX = 0;
      let maxAbsVal = -1, maxAbsX = 0, maxAbsSigned = 0;

      // Check both exact candidates and dense grid
      for (let i = 0; i < xArr.length; i++) {
        const x = xArr[i];
        const v = evalFn(i, x);
        if (v > maxVal) { maxVal = v; maxX = x; }
        if (v < minVal) { minVal = v; minX = x; }
        if (Math.abs(v) > maxAbsVal) { maxAbsVal = Math.abs(v); maxAbsX = x; maxAbsSigned = v; }
      }
      return { maxVal, maxX, minVal, minX, maxAbsVal, maxAbsX, maxAbsSigned };
    }

    const shearExtrema = findExtrema((i) => VArr[i]);
    const momentExtrema = findExtrema((i) => MArr[i]);

    // Refine exact deflection extrema using exact zero-slope candidates + endpoints
    let maxDeflAbs = -1, maxDeflX = 0, maxDeflSigned = 0;
    let maxDeflDown = 0, maxDeflDownX = 0;
    let maxDeflUp = 0, maxDeflUpX = 0;
    const deflCandidates = [...candX, ...xArr];
    for (const x of deflCandidates) {
      const y = evalPiecewise(segments, x, 'yPoly');
      if (Math.abs(y) > maxDeflAbs) {
        maxDeflAbs = Math.abs(y);
        maxDeflX = x;
        maxDeflSigned = y;
      }
      if (y < maxDeflDown) { maxDeflDown = y; maxDeflDownX = x; }
      if (y > maxDeflUp) { maxDeflUp = y; maxDeflUpX = x; }
    }

    // Compute 3-method comparison metrics
    let maxDiffMA = 0;
    let maxDiffConj = 0;
    let maMaxAbs = 0, maMaxX = 0, maMaxSigned = 0;
    let cjMaxAbs = 0, cjMaxX = 0, cjMaxSigned = 0;
    for (let i = 0; i < xArr.length; i++) {
      maxDiffMA = Math.max(maxDiffMA, Math.abs(yArr[i] - yMA[i]));
      maxDiffConj = Math.max(maxDiffConj, Math.abs(yArr[i] - yConj[i]));
      if (Math.abs(yMA[i]) > maMaxAbs) { maMaxAbs = Math.abs(yMA[i]); maMaxX = xArr[i]; maMaxSigned = yMA[i]; }
      if (Math.abs(yConj[i]) > cjMaxAbs) { cjMaxAbs = Math.abs(yConj[i]); cjMaxX = xArr[i]; cjMaxSigned = yConj[i]; }
    }

    // Query point evaluation
    const queryX = Math.max(0, Math.min(L, Number(config.queryX ?? L / 2)));
    const queryResult = {
      x: queryX,
      V: evalPiecewise(segments, queryX, 'Vpoly'),
      M: evalPiecewise(segments, queryX, 'Mpoly'),
      curvature: evalPiecewise(segments, queryX, 'Mpoly') / EI,
      theta: evalPiecewise(segments, queryX, 'thetaPoly'),
      y: evalPiecewise(segments, queryX, 'yPoly'),
      y_mm: evalPiecewise(segments, queryX, 'yPoly') * 1000,
      momentArea: evalMomentAreaAt(queryX),
      conjugate: evalConjugateBeamAt(queryX)
    };

    return {
      input: {
        L,
        isConstantEI,
        deflUnit,
        E_GPa,
        E,
        I,
        EI,
        section: sectionProps,
        supportType,
        supports,
        loads,
        queryX
      },
      display: {
        isConstantEI,
        deflUnit,
        deflScale,
        deflShortUnit,
        slopeScale,
        slopeUnitLabel,
        curvScale: isConstantEI ? 1 : 1000,
        curvUnitLabel: isConstantEI ? 'kN·m / EI' : '×10⁻³ rad/m'
      },
      isIndeterminate,
      indeterminacyDegree,
      reactions,
      breakpoints,
      segments,
      constants: { C1, C2, EI_C1: EI * C1, EI_C2: EI * C2 },
      momentArea: {
        regions: momentAreaRegions,
        refX,
        targetX,
        thetaRef,
        yRef,
        t_target_ref,
        t_maxDefl_ref: evalMomentAreaAt(maxDeflX).t_x_ref,
        totalArea: totalWStar,
        evalAt: evalMomentAreaAt
      },
      conjugateBeam: {
        supports: conjugateSupports,
        reactions: conjugateReactions,
        totalWStar,
        totalMStarAbout0,
        evalAt: evalConjugateBeamAt
      },
      extrema: {
        shear: shearExtrema,
        moment: momentExtrema,
        deflection: {
          maxAbs: maxDeflAbs,
          maxAbs_mm: maxDeflAbs * 1000,
          maxSigned: maxDeflSigned,
          maxSigned_mm: maxDeflSigned * 1000,
          maxX: maxDeflX,
          maxDown_mm: maxDeflDown * 1000,
          maxDownX: maxDeflDownX,
          maxUp_mm: maxDeflUp * 1000,
          maxUpX: maxDeflUpX
        },
        thetaStart: evalPiecewise(segments, 0, 'thetaPoly'),
        thetaEnd: evalPiecewise(segments, L, 'thetaPoly'),
        yStart_mm: evalPiecewise(segments, 0, 'yPoly') * 1000,
        yEnd_mm: evalPiecewise(segments, L, 'yPoly') * 1000,
        zeroShearPoints,
        inflectionPoints,
        zeroSlopePoints
      },
      comparison: {
        doubleIntegration: { maxSigned_mm: maxDeflSigned * 1000, maxAbs_mm: maxDeflAbs * 1000, maxX: maxDeflX },
        momentArea: { maxSigned_mm: maMaxSigned * 1000, maxAbs_mm: maMaxAbs * 1000, maxX: maMaxX, maxError_mm: maxDiffMA * 1000 },
        conjugateBeam: { maxSigned_mm: cjMaxSigned * 1000, maxAbs_mm: cjMaxAbs * 1000, maxX: cjMaxX, maxError_mm: maxDiffConj * 1000 }
      },
      query: queryResult,
      arrays: {
        x: xArr,
        q: qArr,
        V: VArr,
        M: MArr,
        curvature: kArr,
        theta: thetaArr,
        y: yArr,
        y_mm: yArr.map((v) => v * 1000),
        thetaMA,
        yMA_mm: yMA.map((v) => v * 1000),
        thetaConj,
        yConj_mm: yConj.map((v) => v * 1000)
      },
      evalAt: function (x) {
        const clamped = Math.max(0, Math.min(L, x));
        const V = evalPiecewise(segments, clamped, 'Vpoly');
        const M = evalPiecewise(segments, clamped, 'Mpoly');
        const theta = evalPiecewise(segments, clamped, 'thetaPoly');
        const y = evalPiecewise(segments, clamped, 'yPoly');
        return {
          x: clamped,
          q: evalPiecewise(segments, clamped, 'qPoly'),
          V,
          M,
          curvature: M / EI,
          theta,
          y,
          y_mm: y * 1000
        };
      }
    };
  }

  BeamStudio.Engine = {
    computeSectionProperties,
    solveBeam
  };
})(window);
