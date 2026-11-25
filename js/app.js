/**
 * BeamStudio 3D — Main Application Controller
 * Features:
 *  - Clean blank initial state (auto-populates on Ready-Made Example or user input)
 *  - SI (Metric: m, kN, GPa, mm/cm/m) & English (US: ft, kip/lb, ksi, in/ft) unit systems + Constant EI (/EI)
 *  - Exact 0 snap for floating-point noise & crisp × 10^n scientific notation (no raw e-3)
 *  - Clean magnitude + direction on Max Deflection KPI (no redundant "-" with "Downward")
 *  - Two separate Step-by-Step Solution tabs: Max Deflection Solution & Point x Solution
 *  - Multi-provider AI Model API integration & Tutor
 */
(function (global) {
  'use strict';

  const { Engine, SolutionBuilder, AIService, Viewer3D, Diagrams } = global.BeamStudio;

  // =========================================================================
  // Application State (Starts Clean / Blank!)
  // =========================================================================
  const state = {
    dark: false,
    unitSystem: 'si', // 'si' | 'us'
    usForceUnit: 'kip', // 'kip' | 'lb'
    activeMethod: 'double_integration', // 'double_integration' | 'moment_area' | 'conjugate_beam' | 'compare'
    activeWsTab: 'diagrams', // 'diagrams' | 'solution_max' | 'solution_point' | 'ai'
    activeLoadType: 'Point',
    constantEI: false,
    deflUnit: 'mm', // SI: 'mm'|'cm'|'m'  |  US: 'in'|'ft'
    section: {
      type: 'ibeam',
      h: '',
      bf: '',
      tf: '',
      tw: '',
      b: '',
      D: '',
      t: '',
      hw: '',
      customI: '',
      customIUnit: 'm4'
    },
    loads: [],
    solution: null,
    probeX: 0,
    aiSettings: AIService.loadSettings(),
    tutorHistory: []
  };

  let viewer3d = null;
  let toastTimer = null;

  // =========================================================================
  // Ready-Made Engineering Examples (Determinate Beams — SI & English!)
  // =========================================================================
  const PRESETS = {
    ss_point: {
      label: 'Simply Supported + Midspan Point Load',
      unitSystem: 'si',
      length: 6,
      E: 200,
      supportType: 'simply_supported',
      queryX: 3,
      section: { type: 'ibeam', h: 300, bf: 150, tf: 12, tw: 8 },
      loads: [{ type: 'Point', P: 30, a: 3 }]
    },
    ss_combined: {
      label: 'Simply Supported + UDL, Point & Moment',
      unitSystem: 'si',
      length: 8,
      E: 200,
      supportType: 'simply_supported',
      queryX: 4,
      section: { type: 'ibeam', h: 350, bf: 170, tf: 14, tw: 9 },
      loads: [
        { type: 'UDL', w: 10, a: 0, b: 8 },
        { type: 'Point', P: 35, a: 2.5 },
        { type: 'Moment', M: 20, a: 6 }
      ]
    },
    cantilever_uvl: {
      label: 'Cantilever + Triangular UVL & Tip Load',
      unitSystem: 'si',
      length: 5,
      E: 200,
      supportType: 'cantilever_left',
      queryX: 5,
      section: { type: 'rect', b: 200, h: 350 },
      loads: [
        { type: 'UVL', w1: 24, w2: 0, a: 0, b: 4 },
        { type: 'Point', P: 15, a: 5 }
      ]
    },
    overhang: {
      label: 'Overhanging Beam + Combined Loads',
      unitSystem: 'si',
      length: 8,
      E: 200,
      supportType: 'overhanging',
      supportA: 1.5,
      supportB: 6.5,
      queryX: 8,
      section: { type: 'tbeam', bf: 280, tf: 25, tw: 35, hw: 280 },
      loads: [
        { type: 'Point', P: 18, a: 0 },
        { type: 'UDL', w: 14, a: 1.5, b: 6.5 },
        { type: 'Point', P: 22, a: 8 }
      ]
    },
    us_ss_point: {
      label: 'English: Simply Supported 20 ft + 10 kip',
      unitSystem: 'us',
      usForceUnit: 'kip',
      length: 20,
      E: 29000,
      supportType: 'simply_supported',
      queryX: 10,
      section: { type: 'custom', customI: 500, customIUnit: 'in4' },
      loads: [{ type: 'Point', P: 10, a: 10 }]
    }
  };

  const METHOD_SHORT_NAMES = {
    double_integration: 'Double Integration',
    moment_area: 'Moment-Area',
    conjugate_beam: 'Conjugate Beam',
    compare: 'Compare All 3'
  };

  // =========================================================================
  // Active Unit Labels Helper
  // =========================================================================
  function getActiveUnits() {
    const isUS = state.unitSystem === 'us';
    const force = isUS ? state.usForceUnit : 'kN';
    const length = isUS ? 'ft' : 'm';
    return {
      isUS,
      length,
      force,
      dist: `${force}/${length}`,
      moment: `${force}·${length}`,
      ei: `${force}·${length}²`,
      eiDefl: `${force}·${length}³`,
      eUnit: isUS ? 'ksi' : 'GPa',
      dimUnit: isUS ? 'in' : 'mm',
      iBase: isUS ? 'in⁴' : 'm⁴'
    };
  }

  // =========================================================================
  // Utilities & Clean Scientific Formatting (× 10^n, exact 0 snap)
  // =========================================================================
  const $ = (id) => document.getElementById(id);

  function showToast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function cleanZero(val) {
    return Math.abs(val) < 1e-10 ? 0 : val;
  }

  function fmtNumHtml(val, decimals = 3) {
    const v = cleanZero(val);
    if (v === 0) return '0';
    const absV = Math.abs(v);
    if (absV >= 1e6 || absV < 1e-3) {
      return SolutionBuilder.fmtSciHtml(v, 3);
    }
    return v.toFixed(decimals);
  }

  function fmtDeflHtml(valLenUnit, sol, useMagnitude = false) {
    const disp = sol.display;
    const raw = useMagnitude ? Math.abs(valLenUnit) : valLenUnit;
    const scaled = cleanZero(raw * disp.deflScale);
    if (scaled === 0) {
      return disp.isConstantEI ? '0' : `0 ${disp.deflShortUnit}`;
    }
    const decimals = !disp.isConstantEI && (disp.deflUnit === 'm' || disp.deflUnit === 'ft') ? 5 : 3;
    const numHtml = fmtNumHtml(scaled, decimals);
    return disp.isConstantEI ? `${numHtml} / EI` : `${numHtml} ${disp.deflShortUnit}`;
  }

  function fmtSlopeHtml(valRad, sol) {
    const disp = sol.display;
    const scaled = cleanZero(valRad * disp.slopeScale);
    if (scaled === 0) {
      return disp.isConstantEI ? '0' : `0 ${disp.slopeUnitLabel}`;
    }
    const numHtml = fmtNumHtml(scaled, 3);
    return disp.isConstantEI ? `${numHtml} / EI` : `${numHtml} ${disp.slopeUnitLabel}`;
  }

  function renderLatex(tex, displayMode = true) {
    if (typeof global.katex !== 'undefined') {
      try {
        return global.katex.renderToString(tex, {
          displayMode,
          throwOnError: false,
          strict: false
        });
      } catch (_) {}
    }
    return `<code>${escapeHtml(tex)}</code>`;
  }

  function renderMarkdownWithMath(mdText) {
    let cleaned = String(mdText || '').replace(/```json[\s\S]*?```/gi, '').trim();

    const mathTokens = [];
    cleaned = cleaned.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => {
      const id = `@@MATH_DISP_${mathTokens.length}@@`;
      mathTokens.push({ id, html: `<div class="math-block">${renderLatex(tex.trim(), true)}</div>` });
      return id;
    });
    cleaned = cleaned.replace(/\\\[([\s\S]+?)\\\]/g, (_, tex) => {
      const id = `@@MATH_DISP_${mathTokens.length}@@`;
      mathTokens.push({ id, html: `<div class="math-block">${renderLatex(tex.trim(), true)}</div>` });
      return id;
    });
    cleaned = cleaned.replace(/\\\((.+?)\\\)/g, (_, tex) => {
      const id = `@@MATH_INL_${mathTokens.length}@@`;
      mathTokens.push({ id, html: renderLatex(tex.trim(), false) });
      return id;
    });
    cleaned = cleaned.replace(/(^|[^\\$])\$([^\n$]+?)\$/g, (m, pre, tex) => {
      const id = `@@MATH_INL_${mathTokens.length}@@`;
      mathTokens.push({ id, html: renderLatex(tex.trim(), false) });
      return `${pre}${id}`;
    });

    let html = escapeHtml(cleaned);
    html = html.replace(/```[\w]*\n([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^##\s+(.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');

    const lines = html.split('\n');
    const out = [];
    let inList = false;
    for (const line of lines) {
      const bulletMatch = line.match(/^\s*[-*•]\s+(.+)$/);
      if (bulletMatch) {
        if (!inList) {
          out.push('<ul>');
          inList = true;
        }
        out.push(`<li>${bulletMatch[1]}</li>`);
      } else {
        if (inList) {
          out.push('</ul>');
          inList = false;
        }
        if (line.trim() === '') out.push('<div style="height:6px;"></div>');
        else if (line.startsWith('<h') || line.startsWith('<pre') || line.startsWith('@@MATH_DISP')) out.push(line);
        else out.push(`<p style="margin:4px 0;">${line}</p>`);
      }
    }
    if (inList) out.push('</ul>');

    let finalHtml = out.join('\n');
    for (const tok of mathTokens) finalHtml = finalHtml.replace(tok.id, tok.html);
    return finalHtml;
  }

  // =========================================================================
  // Unit System Sync (SI Metric <-> English US)
  // =========================================================================
  function syncUnitSystemUI(resetDeflUnit = true) {
    const U = getActiveUnits();

    $('unitSystemPills').querySelectorAll('.unit-pill').forEach((b) => {
      b.classList.toggle('active', b.dataset.unitSys === state.unitSystem);
    });
    $('usForceUnitGroup').classList.toggle('hidden', !U.isUS);
    $('usForcePills').querySelectorAll('.unit-pill').forEach((b) => {
      b.classList.toggle('active', b.dataset.usForce === state.usForceUnit);
    });

    // Update form labels & placeholders
    $('beamLengthLabel').textContent = `Length L (${U.length})`;
    $('beamLength').placeholder = U.isUS ? 'e.g. 20' : 'e.g. 6';
    $('supportAXLabel').textContent = `Pin Position x_A (${U.length})`;
    $('supportBXLabel').textContent = `Roller Position x_B (${U.length})`;
    $('youngsELabel').textContent = `Modulus E (${U.eUnit})`;
    $('youngsE').placeholder = U.isUS ? 'e.g. 29000' : 'e.g. 200';
    $('queryXLabel').textContent = `Check Point x (${U.length})`;
    $('queryXInput').placeholder = U.isUS ? 'e.g. 10' : 'e.g. 3';
    $('loadBLabel').textContent = `End Position b (${U.length})`;
    $('loadB').placeholder = U.isUS ? 'e.g. 20' : 'e.g. 6';
    $('loadW2Label').textContent = `End Intensity w₂ (${U.dist})`;
    $('pointSolutionXUnit').textContent = U.length;

    // Update Material Preset dropdown values for SI (GPa) vs English (ksi)
    const matSel = $('materialPreset');
    const prevMat = matSel.value;
    if (U.isUS) {
      matSel.innerHTML = `
        <option value="">Select material...</option>
        <option value="29000">Steel (29,000 ksi)</option>
        <option value="10000">Aluminum (10,000 ksi)</option>
        <option value="4000">Concrete (4,000 ksi)</option>
        <option value="1600">Timber (1,600 ksi)</option>
        <option value="constant_ei">Constant EI (Symbolic)</option>
        <option value="custom">Custom E...</option>`;
    } else {
      matSel.innerHTML = `
        <option value="">Select material...</option>
        <option value="200">Steel (200 GPa)</option>
        <option value="69">Aluminum (69 GPa)</option>
        <option value="28">Concrete (28 GPa)</option>
        <option value="11">Timber (11 GPa)</option>
        <option value="constant_ei">Constant EI (Symbolic)</option>
        <option value="custom">Custom E...</option>`;
    }
    if (state.constantEI) {
      matSel.value = 'constant_ei';
    } else if (prevMat === 'custom') {
      matSel.value = 'custom';
    } else if (U.isUS && ['200', '69', '28', '11'].includes(prevMat)) {
      const map = { '200': '29000', '69': '10000', '28': '4000', '11': '1600' };
      matSel.value = map[prevMat];
      $('youngsE').value = map[prevMat];
    } else if (!U.isUS && ['29000', '10000', '4000', '1600'].includes(prevMat)) {
      const map = { '29000': '200', '10000': '69', '4000': '28', '1600': '11' };
      matSel.value = map[prevMat];
      $('youngsE').value = map[prevMat];
    }

    // Update Deflection Unit Pills (SI: mm|cm|m  |  US: in|ft)
    const pillsWrap = $('deflUnitPills');
    if (U.isUS) {
      if (resetDeflUnit || !['in', 'ft'].includes(state.deflUnit)) state.deflUnit = 'in';
      pillsWrap.innerHTML = `
        <button class="unit-pill ${state.deflUnit === 'in' ? 'active' : ''}" data-defl-unit="in" type="button">in</button>
        <button class="unit-pill ${state.deflUnit === 'ft' ? 'active' : ''}" data-defl-unit="ft" type="button">ft</button>`;
    } else {
      if (resetDeflUnit || !['mm', 'cm', 'm'].includes(state.deflUnit)) state.deflUnit = 'mm';
      pillsWrap.innerHTML = `
        <button class="unit-pill ${state.deflUnit === 'mm' ? 'active' : ''}" data-defl-unit="mm" type="button">mm</button>
        <button class="unit-pill ${state.deflUnit === 'cm' ? 'active' : ''}" data-defl-unit="cm" type="button">cm</button>
        <button class="unit-pill ${state.deflUnit === 'm' ? 'active' : ''}" data-defl-unit="m" type="button">m</button>`;
    }
    pillsWrap.querySelectorAll('.unit-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        pillsWrap.querySelectorAll('.unit-pill').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.deflUnit = btn.dataset.deflUnit;
        if (state.solution) recalculate(true);
      });
    });

    // Update custom I default unit cleanly when switching systems
    if (resetDeflUnit) {
      state.section.customIUnit = U.isUS ? 'in4' : 'm4';
    }

    updateLoadInputVisibility();
    renderSectionInputs();
    renderLoadsList();
  }

  // =========================================================================
  // Workspace Tab Switching (4 Clean Tabs)
  // =========================================================================
  function switchWorkspaceTab(tabName) {
    state.activeWsTab = tabName;
    $('workspaceTabs').querySelectorAll('.ws-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.wsTab === tabName);
    });
    $('panelDiagrams').classList.toggle('hidden', tabName !== 'diagrams');
    $('panelSolutionMax').classList.toggle('hidden', tabName !== 'solution_max');
    $('panelSolutionPoint').classList.toggle('hidden', tabName !== 'solution_point');
    $('panelAi').classList.toggle('hidden', tabName !== 'ai');

    if (tabName === 'diagrams' && state.solution) {
      requestAnimationFrame(() => renderActiveMethodDiagrams());
    } else if (tabName === 'solution_point') {
      renderPointSolution();
    } else if (tabName === 'solution_max') {
      renderMaxSolution();
    }
  }

  // =========================================================================
  // Cross-Section UI Builder
  // =========================================================================
  function getEffectiveSection() {
    const isUS = state.unitSystem === 'us';
    const s = state.section;
    return {
      type: s.type || 'ibeam',
      h: Number(s.h) > 0 ? Number(s.h) : (isUS ? 12 : 300),
      bf: Number(s.bf) > 0 ? Number(s.bf) : (isUS ? 6 : 150),
      tf: Number(s.tf) > 0 ? Number(s.tf) : (isUS ? 0.5 : 12),
      tw: Number(s.tw) > 0 ? Number(s.tw) : (isUS ? 0.35 : 8),
      b: Number(s.b) > 0 ? Number(s.b) : (isUS ? 8 : 200),
      D: Number(s.D) > 0 ? Number(s.D) : (isUS ? 10 : 260),
      t: Number(s.t) > 0 ? Number(s.t) : (isUS ? 0.5 : 12),
      hw: Number(s.hw) > 0 ? Number(s.hw) : (isUS ? 10 : 260),
      customI: Number(s.customI) > 0 ? Number(s.customI) : (isUS ? 500 : 8.5e-5),
      customIUnit: s.customIUnit || (isUS ? 'in4' : 'm4')
    };
  }

  function renderSectionInputs() {
    const U = getActiveUnits();
    const type = $('sectionType').value;
    state.section.type = type;
    const container = $('sectionDimsContainer');

    if (type === 'custom') {
      const unit = state.section.customIUnit || (U.isUS ? 'in4' : 'm4');
      container.innerHTML = `
        <div class="form-group">
          <label for="customIInput">Moment of Inertia I</label>
          <input class="input-3d sec-dim-input" id="customIInput" data-sec-key="customI" type="number" step="any" min="0.000000000001" placeholder="${U.isUS ? 'e.g. 500' : 'e.g. 8000'}" value="${state.section.customI}" />
        </div>
        <div class="form-group">
          <label for="customIUnitSelect">Unit of I</label>
          <select class="select-3d" id="customIUnitSelect">
            <option value="m4" ${unit === 'm4' ? 'selected' : ''}>m⁴</option>
            <option value="cm4" ${unit === 'cm4' ? 'selected' : ''}>cm⁴ (×10⁻⁸ m⁴)</option>
            <option value="e6mm4" ${unit === 'e6mm4' ? 'selected' : ''}>×10⁶ mm⁴ (×10⁻⁶ m⁴)</option>
            <option value="mm4" ${unit === 'mm4' ? 'selected' : ''}>mm⁴ (×10⁻¹² m⁴)</option>
            <option value="in4" ${unit === 'in4' ? 'selected' : ''}>in⁴ (English)</option>
            <option value="ft4" ${unit === 'ft4' ? 'selected' : ''}>ft⁴ (English)</option>
          </select>
        </div>
        <div class="form-group span-2 hidden" id="hugeIWarning" style="background:rgba(166,87,128,0.14); border:1px solid rgba(166,87,128,0.4); border-radius:9px; padding:8px 10px; font-size:0.73rem; line-height:1.45;">
          <strong>Heads up:</strong> <span id="hugeIWarningText"></span>
          <div style="display:flex; gap:6px; margin-top:6px;">
            <button class="link-btn" id="switchToCm4Btn" type="button" style="background:var(--surface-input); border:1px solid var(--border-strong); padding:3px 8px;">Use cm⁴</button>
            <button class="link-btn" id="switchToE6Mm4Btn" type="button" style="background:var(--surface-input); border:1px solid var(--border-strong); padding:3px 8px;">Use ×10⁶ mm⁴</button>
            <button class="link-btn" id="switchToMm4Btn" type="button" style="background:var(--surface-input); border:1px solid var(--border-strong); padding:3px 8px;">Use mm⁴</button>
          </div>
        </div>`;

      const inp = $('customIInput');
      const sel = $('customIUnitSelect');
      inp.addEventListener('input', () => {
        state.section.customI = inp.value;
        updateSectionBadge();
      });
      inp.addEventListener('change', () => { if (state.solution) recalculate(true); });
      sel.addEventListener('change', () => {
        state.section.customIUnit = sel.value;
        updateSectionBadge();
        if (state.solution) recalculate(true);
      });
      $('switchToCm4Btn').addEventListener('click', () => {
        state.section.customIUnit = 'cm4';
        sel.value = 'cm4';
        updateSectionBadge();
        if (state.solution) recalculate(true);
      });
      $('switchToE6Mm4Btn').addEventListener('click', () => {
        state.section.customIUnit = 'e6mm4';
        sel.value = 'e6mm4';
        updateSectionBadge();
        if (state.solution) recalculate(true);
      });
      $('switchToMm4Btn').addEventListener('click', () => {
        state.section.customIUnit = 'mm4';
        sel.value = 'mm4';
        updateSectionBadge();
        if (state.solution) recalculate(true);
      });

      updateSectionBadge();
      return;
    }

    const dU = U.dimUnit;
    let fields = [];
    if (type === 'ibeam') {
      fields = [
        { key: 'h', label: `Depth h (${dU})`, val: state.section.h, ph: U.isUS ? '12' : '300' },
        { key: 'bf', label: `Flange b_f (${dU})`, val: state.section.bf, ph: U.isUS ? '6' : '150' },
        { key: 'tf', label: `Flange t_f (${dU})`, val: state.section.tf, ph: U.isUS ? '0.5' : '12' },
        { key: 'tw', label: `Web t_w (${dU})`, val: state.section.tw, ph: U.isUS ? '0.35' : '8' }
      ];
    } else if (type === 'rect') {
      fields = [
        { key: 'b', label: `Width b (${dU})`, val: state.section.b, ph: U.isUS ? '8' : '200' },
        { key: 'h', label: `Height h (${dU})`, val: state.section.h, ph: U.isUS ? '14' : '350' }
      ];
    } else if (type === 'tube') {
      fields = [
        { key: 'D', label: `Outer Dia D (${dU})`, val: state.section.D, ph: U.isUS ? '10' : '260' },
        { key: 't', label: `Wall Thick t (${dU})`, val: state.section.t, ph: U.isUS ? '0.5' : '12' }
      ];
    } else if (type === 'tbeam') {
      fields = [
        { key: 'bf', label: `Flange b_f (${dU})`, val: state.section.bf, ph: U.isUS ? '10' : '280' },
        { key: 'tf', label: `Flange t_f (${dU})`, val: state.section.tf, ph: U.isUS ? '1' : '25' },
        { key: 'hw', label: `Web h_w (${dU})`, val: state.section.hw, ph: U.isUS ? '10' : '280' },
        { key: 'tw', label: `Web t_w (${dU})`, val: state.section.tw, ph: U.isUS ? '1.25' : '35' }
      ];
    }

    container.innerHTML = fields
      .map(
        (f) => `
      <div class="form-group">
        <label>${f.label}</label>
        <input class="input-3d sec-dim-input" data-sec-key="${f.key}" type="number" step="any" min="0.01" placeholder="e.g. ${f.ph}" value="${f.val}" />
      </div>`
      )
      .join('');

    container.querySelectorAll('.sec-dim-input').forEach((inp) => {
      inp.addEventListener('input', () => {
        state.section[inp.dataset.secKey] = inp.value;
        updateSectionBadge();
      });
      inp.addEventListener('change', () => { if (state.solution) recalculate(true); });
    });

    updateSectionBadge();
  }

  function updateSectionBadge() {
    const U = getActiveUnits();
    if (state.constantEI) {
      $('computedILabel').textContent = 'EI = Constant (Symbolic)';
      $('computedEILabel').textContent = 'Answers in /EI';
      $('sectionSummaryMeta').textContent = 'Constant EI ▾';
      const warnBox = $('hugeIWarning');
      if (warnBox) warnBox.classList.add('hidden');
      return;
    }

    const E_val = Number($('youngsE').value);
    if (!(E_val > 0)) {
      $('computedILabel').textContent = 'I = —';
      $('computedEILabel').textContent = 'EI = —';
      $('sectionSummaryMeta').textContent = 'Optional ▾';
      return;
    }

    const props = Engine.computeSectionProperties(getEffectiveSection(), state.unitSystem);
    const EI = U.isUS
      ? (E_val * (state.usForceUnit === 'lb' ? 1000 : 1) * props.I) / 144
      : E_val * 1e6 * props.I;
    const shortType = { ibeam: 'I-Beam', rect: 'Rect', tube: 'Tube', tbeam: 'T-Beam', custom: 'Custom I' }[state.section.type] || 'Section';
    $('computedILabel').innerHTML = `I = ${fmtNumHtml(props.I, 3)} ${U.iBase}`;
    $('computedEILabel').innerHTML = `EI = ${EI >= 1e6 ? SolutionBuilder.fmtSciHtml(EI, 3) : EI.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${U.ei}`;
    $('sectionSummaryMeta').textContent = `${shortType} ▾`;

    const warnBox = $('hugeIWarning');
    if (warnBox) {
      const isHugeM4 = !U.isUS && state.section.type === 'custom' && (state.section.customIUnit || 'm4') === 'm4' && Number(state.section.customI) >= 1;
      warnBox.classList.toggle('hidden', !isHugeM4);
      if (isHugeM4) {
        $('hugeIWarningText').textContent = `${state.section.customI} m⁴ is extremely stiff (deflection ≈ 0). Did you mean cm⁴, ×10⁶ mm⁴, or mm⁴?`;
      }
    }
  }

  // =========================================================================
  // Load Builder UI
  // =========================================================================
  function updateLoadInputVisibility() {
    const U = getActiveUnits();
    const t = state.activeLoadType;
    const magLabel = $('loadMagLabel');
    const aLabel = $('loadALabel');
    const bGroup = $('loadBGroup');
    const w2Group = $('loadW2Group');

    if (t === 'Point') {
      magLabel.textContent = `Force P (${U.force}, ↓+)`;
      aLabel.textContent = `Position a (${U.length})`;
      bGroup.classList.add('hidden');
      w2Group.classList.add('hidden');
    } else if (t === 'UDL') {
      magLabel.textContent = `Intensity w (${U.dist}, ↓+)`;
      aLabel.textContent = `Start a (${U.length})`;
      bGroup.classList.remove('hidden');
      w2Group.classList.add('hidden');
    } else if (t === 'UVL') {
      magLabel.textContent = `Start w₁ (${U.dist}, ↓+)`;
      aLabel.textContent = `Start a (${U.length})`;
      bGroup.classList.remove('hidden');
      w2Group.classList.remove('hidden');
    } else if (t === 'Moment') {
      magLabel.textContent = `Moment M₀ (${U.moment}, ↺+)`;
      aLabel.textContent = `Position a (${U.length})`;
      bGroup.classList.add('hidden');
      w2Group.classList.add('hidden');
    }
  }

  function renderLoadsList() {
    const U = getActiveUnits();
    const list = $('loadsList');
    if (state.loads.length === 0) {
      list.innerHTML = `<div class="hint-text" style="text-align:center; padding:8px;">No loads added yet. Enter a load above or pick a ready-made example.</div>`;
      return;
    }
    list.innerHTML = state.loads
      .map((ld, idx) => {
        let desc = '';
        if (ld.type === 'Point') desc = `${ld.P} ${U.force} at x = ${ld.a} ${U.length}`;
        else if (ld.type === 'UDL') desc = `${ld.w} ${U.dist} from ${ld.a} to ${ld.b} ${U.length}`;
        else if (ld.type === 'UVL') desc = `${ld.w1}→${ld.w2} ${U.dist} (${ld.a}–${ld.b} ${U.length})`;
        else if (ld.type === 'Moment') desc = `${ld.M} ${U.moment} (${ld.M >= 0 ? 'CCW' : 'CW'}) at ${ld.a} ${U.length}`;
        return `
        <div class="load-item">
          <div><span class="load-item-tag">${ld.type}</span>${escapeHtml(desc)}</div>
          <button class="load-remove-btn" data-remove-idx="${idx}" type="button" title="Remove load">×</button>
        </div>`;
      })
      .join('');

    list.querySelectorAll('.load-remove-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.loads.splice(Number(btn.dataset.removeIdx), 1);
        renderLoadsList();
        if (state.loads.length > 0 && state.solution) recalculate(true);
        else if (state.loads.length === 0) renderEmptyState();
      });
    });
  }

  function addLoadFromForm() {
    const U = getActiveUnits();
    const L = Number($('beamLength').value);
    if (!(L > 0)) return showToast(`Enter Beam Length L (${U.length}) in Step 1 first.`);
    const t = state.activeLoadType;
    const rawMag = $('loadMag').value.trim();
    const rawA = $('loadA').value.trim();
    if (rawMag === '' || rawA === '') return showToast('Enter the load magnitude and position first.');

    const mag = Number(rawMag);
    const a = Number(rawA);
    if (!isFinite(mag) || !isFinite(a)) return showToast('Enter valid numeric load values.');
    if (a < 0 || a > L) return showToast(`Position a must be within [0, ${L}] ${U.length}.`);

    if (t === 'Point') {
      state.loads.push({ type: 'Point', P: mag, a });
    } else if (t === 'Moment') {
      state.loads.push({ type: 'Moment', M: mag, a });
    } else {
      const rawB = $('loadB').value.trim();
      if (rawB === '') return showToast(`Enter End Position b (${U.length}) for the distributed load.`);
      const b = Number(rawB);
      if (!isFinite(b) || b <= a || b > L) {
        return showToast(`Distributed load must satisfy 0 ≤ a < b ≤ ${L} ${U.length}.`);
      }
      if (t === 'UDL') state.loads.push({ type: 'UDL', w: mag, a, b });
      else {
        const rawW2 = $('loadW2').value.trim();
        if (rawW2 === '') return showToast(`Enter End Intensity w₂ (${U.dist}) for UVL.`);
        const w2 = Number(rawW2);
        if (!isFinite(w2)) return showToast('Enter a valid end intensity w₂.');
        state.loads.push({ type: 'UVL', w1: mag, w2, a, b });
      }
    }

    renderLoadsList();
    if (isStep1Ready()) recalculate(true);
    else showToast(`${t} load added! Complete Step 1 & click Calculate Beam.`);
  }

  function isStep1Ready() {
    const L = Number($('beamLength').value);
    const sup = $('supportType').value;
    const E = Number($('youngsE').value);
    return L > 0 && Boolean(sup) && (state.constantEI || E > 0);
  }

  // =========================================================================
  // Empty State Renderer (Initial Clean Blank View)
  // =========================================================================
  function renderEmptyState() {
    state.solution = null;
    $('stageEmptyOverlay').classList.remove('hidden');
    $('kpiDefl').textContent = '—';
    $('kpiDeflSub').textContent = 'Enter inputs or choose an example';
    $('kpiMoment').textContent = '—';
    $('kpiMomentSub').textContent = 'Peak section';
    $('kpiShear').textContent = '—';
    $('kpiShearSub').textContent = 'Peak section';
    $('kpiReactions').textContent = '—';
    $('kpiReactionsSub').textContent = 'Static equilibrium';

    $('sectionProbeSlider').disabled = true;
    $('probeXVal').textContent = '—';
    $('pointTabBadge').textContent = 'x = —';
    $('pointSolutionXInput').value = '';
    $('probeMetrics').innerHTML = `<span>V: <b>—</b></span><span>M: <b>—</b></span><span>θ: <b>—</b></span><span>δ: <b>—</b></span>`;

    $('diagramsGrid').innerHTML = `
      <div class="diagram-box full-span">
        <div class="empty-panel-card">
          <strong>No diagrams calculated yet.</strong><br/>
          Pick a ready-made example under <strong>Start Here</strong> on the left — or enter your beam details and click <strong>Calculate Beam</strong>.
        </div>
      </div>`;

    $('builtInSolutionMaxContainer').innerHTML = `
      <div class="empty-panel-card">
        Calculate a beam first to view the step-by-step computation for <strong>Maximum Deflection &amp; Location</strong>.
      </div>`;

    $('builtInSolutionPointContainer').innerHTML = `
      <div class="empty-panel-card">
        Calculate a beam first, then slide <strong>Inspect Point x</strong> (or type any coordinate above) to view the step-by-step <strong>Slope &amp; Deflection</strong> at that exact point.
      </div>`;
  }

  // =========================================================================
  // Main Calculation & Rendering Pipeline
  // =========================================================================
  function recalculate(silentMissing = false) {
    const U = getActiveUnits();
    const L = Number($('beamLength').value);
    const supportType = $('supportType').value;
    const E = Number($('youngsE').value);

    if (!(L > 0)) {
      if (!silentMissing) showToast(`Step 1: Enter Beam Length L (${U.length}) or pick a ready-made example.`);
      return;
    }
    if (!supportType) {
      if (!silentMissing) showToast('Step 1: Select a Support Condition.');
      return;
    }
    if (!state.constantEI && !(E > 0)) {
      if (!silentMissing) showToast('Step 1: Select a Material (or check "Treat EI as Constant").');
      return;
    }
    if (state.loads.length === 0) {
      if (!silentMissing) showToast('Step 2: Add at least one load to the beam.');
      return;
    }

    try {
      const rawQuery = $('queryXInput').value.trim();
      const queryX = rawQuery !== '' ? Math.max(0, Math.min(L, Number(rawQuery))) : L / 2;

      const config = {
        unitSystem: state.unitSystem,
        usForceUnit: state.usForceUnit,
        length: L,
        E: state.constantEI ? 1 : E,
        constantEI: state.constantEI,
        deflUnit: state.deflUnit,
        section: getEffectiveSection(),
        supportType,
        supportA: $('supportAX').value !== '' ? Number($('supportAX').value) : 0,
        supportB: $('supportBX').value !== '' ? Number($('supportBX').value) : L * 0.75,
        loads: state.loads,
        queryX
      };

      const sol = Engine.solveBeam(config);
      state.solution = sol;

      if (state.probeX <= 0 || state.probeX > L) {
        state.probeX = queryX;
      }

      $('stageEmptyOverlay').classList.add('hidden');

      const slider = $('sectionProbeSlider');
      slider.disabled = false;
      slider.min = '0';
      slider.max = String(L);
      slider.step = String(Math.max(L / 200, 0.01));
      slider.value = String(state.probeX);

      $('pointSolutionXInput').max = String(L);
      $('pointSolutionXInput').value = state.probeX.toFixed(2);

      updateSectionBadge();
      updateKPIs(sol);
      updateProbeReadout();
      if (viewer3d) {
        viewer3d.update(sol);
        viewer3d.setProbeX(state.probeX);
      }
      if (state.activeWsTab === 'diagrams') {
        renderActiveMethodDiagrams();
      }
      renderMaxSolution();
      renderPointSolution();
    } catch (err) {
      showToast(`Error: ${err.message}`);
    }
  }

  function updateKPIs(sol) {
    const U = sol.units;
    const { deflection, moment, shear } = sol.extrema;
    const signedClean = cleanZero(deflection.maxSigned);
    const dirWord = signedClean < 0 ? 'Downward' : signedClean > 0 ? 'Upward' : 'Zero';

    // Show clean magnitude without redundant "-" since Downward / Upward is stated right below!
    $('kpiDefl').innerHTML = fmtDeflHtml(deflection.maxSigned, sol, true);
    if (sol.display.isConstantEI) {
      $('kpiDeflSub').textContent = `${dirWord} at x = ${deflection.maxX.toFixed(2)} ${U.length} (${U.eiDefl}/EI)`;
    } else {
      const ratio = Math.abs(signedClean) > 1e-12 ? Math.round(sol.input.L / Math.abs(signedClean)).toLocaleString() : '∞';
      $('kpiDeflSub').textContent = `${dirWord} at x = ${deflection.maxX.toFixed(2)} ${U.length} (L/${ratio})`;
    }

    $('deflUnitPills').classList.toggle('hidden', sol.display.isConstantEI);
    $('deflEiTag').classList.toggle('hidden', !sol.display.isConstantEI);

    $('kpiMoment').textContent = `${cleanZero(moment.maxAbsSigned).toFixed(2)} ${U.moment}`;
    $('kpiMomentSub').textContent = `at x = ${moment.maxAbsX.toFixed(2)} ${U.length}`;

    $('kpiShear').textContent = `${cleanZero(shear.maxAbsSigned).toFixed(2)} ${U.force}`;
    $('kpiShearSub').textContent = `at x = ${shear.maxAbsX.toFixed(2)} ${U.length}`;

    const r = sol.reactions;
    const rList = [];
    if (sol.input.supports.some((s) => s.id === 'A')) rList.push(`R<sub>A</sub> = ${cleanZero(r.RA).toFixed(2)} ${U.force}`);
    if (sol.input.supports.some((s) => s.id === 'B')) rList.push(`R<sub>B</sub> = ${cleanZero(r.RB).toFixed(2)} ${U.force}`);
    if (Math.abs(r.MA) > 1e-4) rList.push(`M<sub>A</sub> = ${cleanZero(r.MA).toFixed(1)} ${U.moment}`);
    if (Math.abs(r.MB) > 1e-4) rList.push(`M<sub>B</sub> = ${cleanZero(r.MB).toFixed(1)} ${U.moment}`);
    $('kpiReactions').innerHTML = rList.join(' &middot; ');
    $('kpiReactionsSub').textContent = 'Static equilibrium (determinate)';
  }

  function setInspectPointX(newX, updateNumberInput = true) {
    if (!state.solution) return;
    const L = state.solution.input.L;
    state.probeX = Math.max(0, Math.min(L, Number(newX) || 0));
    $('sectionProbeSlider').value = String(state.probeX);
    if (updateNumberInput) {
      $('pointSolutionXInput').value = state.probeX.toFixed(2);
    }
    updateProbeReadout();
    if (viewer3d) viewer3d.setProbeX(state.probeX);
    if (state.activeWsTab === 'diagrams') redrawCurrentCanvasesOnly();
    if (state.activeWsTab === 'solution_point') renderPointSolution();
  }

  function updateProbeReadout() {
    if (!state.solution) return;
    const sol = state.solution;
    const U = sol.units;
    const st = sol.evalAt(state.probeX);
    $('probeXVal').textContent = `${st.x.toFixed(2)} ${U.length}`;
    $('pointTabBadge').textContent = `x = ${st.x.toFixed(2)} ${U.length}`;
    $('probeMetrics').innerHTML = `
      <span>V: <b>${cleanZero(st.V).toFixed(2)} ${U.force}</b></span>
      <span>M: <b>${cleanZero(st.M).toFixed(2)} ${U.moment}</b></span>
      <span>θ: <b>${fmtSlopeHtml(st.theta, sol)}</b></span>
      <span>δ: <b>${fmtDeflHtml(st.y, sol, false)}</b></span>
    `;
  }

  // =========================================================================
  // Diagrams Renderer (Plain-English Titles + Full SI / English Unit Support)
  // =========================================================================
  function renderActiveMethodDiagrams() {
    if (!state.solution) return;
    const sol = state.solution;
    const U = sol.units;
    const grid = $('diagramsGrid');
    const method = state.activeMethod;
    const commonOpts = { dark: state.dark, probeX: state.probeX, xUnit: U.length };
    const disp = sol.display;
    const dUnit = disp.deflShortUnit;
    const sUnit = disp.slopeUnitLabel;
    const dDecimals = !disp.isConstantEI && (disp.deflUnit === 'm' || disp.deflUnit === 'ft') ? 5 : 3;

    if (method === 'double_integration') {
      grid.innerHTML = `
        <div class="diagram-box full-span">
          <div class="diagram-header">
            <div>
              <div class="diagram-title">Beam Setup &amp; Support Push-Back</div>
              <div class="diagram-sub">Your supports, applied loads, and calculated reaction forces</div>
            </div>
            <span class="diagram-tag">Setup / FBD</span>
          </div>
          <canvas class="diagram-canvas" id="cvFbd" style="height:170px;"></canvas>
        </div>
        <div class="diagram-box">
          <div class="diagram-header">
            <div>
              <div class="diagram-title">Shear Force Along Beam</div>
              <div class="diagram-sub">Internal up-and-down slicing force, V(x)</div>
            </div>
            <span class="diagram-tag">${U.force}</span>
          </div>
          <canvas class="diagram-canvas" id="cvSfd"></canvas>
        </div>
        <div class="diagram-box">
          <div class="diagram-header">
            <div>
              <div class="diagram-title">Bending Moment Along Beam</div>
              <div class="diagram-sub">Internal bending effort curving the beam, M(x)</div>
            </div>
            <span class="diagram-tag">${U.moment}</span>
          </div>
          <canvas class="diagram-canvas" id="cvBmd"></canvas>
        </div>
        <div class="diagram-box">
          <div class="diagram-header">
            <div>
              <div class="diagram-title">Beam Tilt (Slope)</div>
              <div class="diagram-sub">How steeply the beam angles at each spot, θ(x)</div>
            </div>
            <span class="diagram-tag">${sUnit}</span>
          </div>
          <canvas class="diagram-canvas" id="cvSlope"></canvas>
        </div>
        <div class="diagram-box">
          <div class="diagram-header">
            <div>
              <div class="diagram-title">Beam Bend (Deflection)</div>
              <div class="diagram-sub">How far the beam sags or lifts from flat, y(x)</div>
            </div>
            <span class="diagram-tag">${dUnit}</span>
          </div>
          <canvas class="diagram-canvas" id="cvDefl"></canvas>
        </div>
      `;

      registerCanvas($('cvFbd'), Diagrams.drawFBD($('cvFbd'), sol, commonOpts));
      registerCanvas($('cvSfd'), Diagrams.drawCurveChart($('cvSfd'), sol.arrays.x, sol.arrays.V, sol.input.L, { ...commonOpts, color: 'aurora', unit: U.force, yLabel: `Shear V (${U.force})` }));
      registerCanvas($('cvBmd'), Diagrams.drawCurveChart($('cvBmd'), sol.arrays.x, sol.arrays.M, sol.input.L, { ...commonOpts, color: 'wisteria', unit: U.moment, yLabel: `Moment M (${U.moment})` }));
      registerCanvas($('cvSlope'), Diagrams.drawCurveChart($('cvSlope'), sol.arrays.x, sol.arrays.theta.map((t) => t * disp.slopeScale), sol.input.L, { ...commonOpts, color: 'aurora', unit: sUnit, decimals: 3, yLabel: `Slope θ (${sUnit})` }));
      registerCanvas($('cvDefl'), Diagrams.drawCurveChart($('cvDefl'), sol.arrays.x, sol.arrays.y.map((v) => v * disp.deflScale), sol.input.L, { ...commonOpts, color: 'mauve', unit: dUnit, decimals: dDecimals, yLabel: `Deflection y (${dUnit})` }));
    } else if (method === 'moment_area') {
      grid.innerHTML = `
        <div class="diagram-box full-span">
          <div class="diagram-header">
            <div>
              <div class="diagram-title">Bending Areas &amp; Balance Points</div>
              <div class="diagram-sub">Splits the bending curve (M/EI) into shaded areas Aᵢ and marks each balance center x̄ᵢ</div>
            </div>
            <span class="diagram-tag">Moment-Area · Part 1</span>
          </div>
          <canvas class="diagram-canvas tall" id="cvMaCurv"></canvas>
        </div>
        <div class="diagram-box full-span">
          <div class="diagram-header">
            <div>
              <div class="diagram-title">Bent Beam vs. Straight Reference Line</div>
              <div class="diagram-sub">Compares the bent beam against a straight tangent line to measure vertical gap t</div>
            </div>
            <span class="diagram-tag">Moment-Area · Part 2 (${dUnit})</span>
          </div>
          <canvas class="diagram-canvas tall" id="cvMaTan"></canvas>
        </div>
        <div class="diagram-box">
          <div class="diagram-header">
            <div>
              <div class="diagram-title">Shear Force Along Beam</div>
              <div class="diagram-sub">Internal slicing force, V(x)</div>
            </div>
            <span class="diagram-tag">${U.force}</span>
          </div>
          <canvas class="diagram-canvas" id="cvSfdMa"></canvas>
        </div>
        <div class="diagram-box">
          <div class="diagram-header">
            <div>
              <div class="diagram-title">Bending Moment Along Beam</div>
              <div class="diagram-sub">Internal bending effort, M(x)</div>
            </div>
            <span class="diagram-tag">${U.moment}</span>
          </div>
          <canvas class="diagram-canvas" id="cvBmdMa"></canvas>
        </div>
      `;

      registerCanvas($('cvMaCurv'), Diagrams.drawMomentAreaCurvature($('cvMaCurv'), sol, commonOpts));
      registerCanvas($('cvMaTan'), Diagrams.drawMomentAreaTangent($('cvMaTan'), sol, commonOpts));
      registerCanvas($('cvSfdMa'), Diagrams.drawCurveChart($('cvSfdMa'), sol.arrays.x, sol.arrays.V, sol.input.L, { ...commonOpts, color: 'aurora', unit: U.force, yLabel: `Shear V (${U.force})` }));
      registerCanvas($('cvBmdMa'), Diagrams.drawCurveChart($('cvBmdMa'), sol.arrays.x, sol.arrays.M, sol.input.L, { ...commonOpts, color: 'wisteria', unit: U.moment, yLabel: `Moment M (${U.moment})` }));
    } else if (method === 'conjugate_beam') {
      grid.innerHTML = `
        <div class="diagram-box full-span">
          <div class="diagram-header">
            <div>
              <div class="diagram-title">Mirror (Conjugate) Beam Setup</div>
              <div class="diagram-sub">Uses swapped supports loaded with the bending curve (M/EI) so normal forces equal real bend</div>
            </div>
            <span class="diagram-tag">Real → Mirror</span>
          </div>
          <canvas class="diagram-canvas tall" id="cvConjSch"></canvas>
        </div>
        <div class="diagram-box">
          <div class="diagram-header">
            <div>
              <div class="diagram-title">Mirror Shear = Real Beam Tilt</div>
              <div class="diagram-sub">Shear on the mirror beam (V*) gives actual beam slope θ(x)</div>
            </div>
            <span class="diagram-tag">${sUnit}</span>
          </div>
          <canvas class="diagram-canvas" id="cvConjV"></canvas>
        </div>
        <div class="diagram-box">
          <div class="diagram-header">
            <div>
              <div class="diagram-title">Mirror Moment = Real Beam Bend</div>
              <div class="diagram-sub">Moment on the mirror beam (M*) gives actual deflection y(x)</div>
            </div>
            <span class="diagram-tag">${dUnit}</span>
          </div>
          <canvas class="diagram-canvas" id="cvConjM"></canvas>
        </div>
      `;

      registerCanvas($('cvConjSch'), Diagrams.drawConjugateBeamSchematic($('cvConjSch'), sol, commonOpts));
      registerCanvas($('cvConjV'), Diagrams.drawCurveChart($('cvConjV'), sol.arrays.x, sol.arrays.thetaConj.map((v) => v * disp.slopeScale), sol.input.L, { ...commonOpts, color: 'aurora', unit: sUnit, decimals: 3, yLabel: `V* = θ (${sUnit})` }));
      registerCanvas($('cvConjM'), Diagrams.drawCurveChart($('cvConjM'), sol.arrays.x, sol.arrays.yConj_mm.map((v) => (v / 1000) * disp.deflScale), sol.input.L, { ...commonOpts, color: 'wisteria', unit: dUnit, decimals: dDecimals, yLabel: `M* = y (${dUnit})` }));
    } else if (method === 'compare') {
      grid.innerHTML = `
        <div class="diagram-box full-span">
          <div class="diagram-header">
            <div>
              <div class="diagram-title">All 3 Methods Compared Side-by-Side</div>
              <div class="diagram-sub">Double Integration, Moment-Area, and Conjugate Beam overlap on the exact same bend curve</div>
            </div>
            <span class="diagram-tag">Exact Match (${dUnit})</span>
          </div>
          <canvas class="diagram-canvas tall" id="cvCompare"></canvas>
        </div>
        <div class="diagram-box">
          <div class="diagram-header">
            <div>
              <div class="diagram-title">Shear Force Along Beam</div>
              <div class="diagram-sub">Internal slicing force, V(x)</div>
            </div>
            <span class="diagram-tag">${U.force}</span>
          </div>
          <canvas class="diagram-canvas" id="cvSfdCmp"></canvas>
        </div>
        <div class="diagram-box">
          <div class="diagram-header">
            <div>
              <div class="diagram-title">Bending Moment Along Beam</div>
              <div class="diagram-sub">Internal bending effort, M(x)</div>
            </div>
            <span class="diagram-tag">${U.moment}</span>
          </div>
          <canvas class="diagram-canvas" id="cvBmdCmp"></canvas>
        </div>
      `;

      registerCanvas($('cvCompare'), Diagrams.drawComparisonChart($('cvCompare'), sol, commonOpts));
      registerCanvas($('cvSfdCmp'), Diagrams.drawCurveChart($('cvSfdCmp'), sol.arrays.x, sol.arrays.V, sol.input.L, { ...commonOpts, color: 'aurora', unit: U.force, yLabel: `Shear V (${U.force})` }));
      registerCanvas($('cvBmdCmp'), Diagrams.drawCurveChart($('cvBmdCmp'), sol.arrays.x, sol.arrays.M, sol.input.L, { ...commonOpts, color: 'wisteria', unit: U.moment, yLabel: `Moment M (${U.moment})` }));
    }
  }

  function registerCanvas(canvas, meta) {
    if (!canvas || !meta) return;
    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const frac = Math.max(0, Math.min(1, (mx - meta.pad.l) / meta.plotW));
      const newX = frac * meta.L;
      if (Math.abs(newX - state.probeX) > 0.005) {
        setInspectPointX(newX, true);
      }
    });
  }

  function redrawCurrentCanvasesOnly() {
    if (!state.solution || state.activeWsTab !== 'diagrams') return;
    const sol = state.solution;
    const U = sol.units;
    const disp = sol.display;
    const dUnit = disp.deflShortUnit;
    const sUnit = disp.slopeUnitLabel;
    const dDecimals = !disp.isConstantEI && (disp.deflUnit === 'm' || disp.deflUnit === 'ft') ? 5 : 3;
    const opts = { dark: state.dark, probeX: state.probeX, xUnit: U.length };
    if ($('cvFbd')) Diagrams.drawFBD($('cvFbd'), sol, opts);
    if ($('cvSfd')) Diagrams.drawCurveChart($('cvSfd'), sol.arrays.x, sol.arrays.V, sol.input.L, { ...opts, color: 'aurora', unit: U.force, yLabel: `Shear V (${U.force})` });
    if ($('cvBmd')) Diagrams.drawCurveChart($('cvBmd'), sol.arrays.x, sol.arrays.M, sol.input.L, { ...opts, color: 'wisteria', unit: U.moment, yLabel: `Moment M (${U.moment})` });
    if ($('cvSlope')) Diagrams.drawCurveChart($('cvSlope'), sol.arrays.x, sol.arrays.theta.map((t) => t * disp.slopeScale), sol.input.L, { ...opts, color: 'aurora', unit: sUnit, decimals: 3, yLabel: `Slope θ (${sUnit})` });
    if ($('cvDefl')) Diagrams.drawCurveChart($('cvDefl'), sol.arrays.x, sol.arrays.y.map((v) => v * disp.deflScale), sol.input.L, { ...opts, color: 'mauve', unit: dUnit, decimals: dDecimals, yLabel: `Deflection y (${dUnit})` });
    if ($('cvMaCurv')) Diagrams.drawMomentAreaCurvature($('cvMaCurv'), sol, opts);
    if ($('cvMaTan')) Diagrams.drawMomentAreaTangent($('cvMaTan'), sol, opts);
    if ($('cvSfdMa')) Diagrams.drawCurveChart($('cvSfdMa'), sol.arrays.x, sol.arrays.V, sol.input.L, { ...opts, color: 'aurora', unit: U.force, yLabel: `Shear V (${U.force})` });
    if ($('cvBmdMa')) Diagrams.drawCurveChart($('cvBmdMa'), sol.arrays.x, sol.arrays.M, sol.input.L, { ...opts, color: 'wisteria', unit: U.moment, yLabel: `Moment M (${U.moment})` });
    if ($('cvConjSch')) Diagrams.drawConjugateBeamSchematic($('cvConjSch'), sol, opts);
    if ($('cvConjV')) Diagrams.drawCurveChart($('cvConjV'), sol.arrays.x, sol.arrays.thetaConj.map((v) => v * disp.slopeScale), sol.input.L, { ...opts, color: 'aurora', unit: sUnit, decimals: 3, yLabel: `V* = θ (${sUnit})` });
    if ($('cvConjM')) Diagrams.drawCurveChart($('cvConjM'), sol.arrays.x, sol.arrays.yConj_mm.map((v) => (v / 1000) * disp.deflScale), sol.input.L, { ...opts, color: 'wisteria', unit: dUnit, decimals: dDecimals, yLabel: `M* = y (${dUnit})` });
    if ($('cvCompare')) Diagrams.drawComparisonChart($('cvCompare'), sol, opts);
    if ($('cvSfdCmp')) Diagrams.drawCurveChart($('cvSfdCmp'), sol.arrays.x, sol.arrays.V, sol.input.L, { ...opts, color: 'aurora', unit: U.force, yLabel: `Shear V (${U.force})` });
    if ($('cvBmdCmp')) Diagrams.drawCurveChart($('cvBmdCmp'), sol.arrays.x, sol.arrays.M, sol.input.L, { ...opts, color: 'wisteria', unit: U.moment, yLabel: `Moment M (${U.moment})` });
  }

  // =========================================================================
  // Shared Step-Card HTML Renderer
  // =========================================================================
  function renderStepCardsHtml(steps) {
    return steps
      .map((st) => {
        const eqHtml = (st.equations || []).map((eq) => `<div class="math-block">${renderLatex(eq, true)}</div>`).join('');
        let tblHtml = '';
        if (st.table) {
          tblHtml = `
            <div class="eng-table-wrap">
              <table class="eng-table">
                <thead><tr>${st.table.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
                <tbody>
                  ${st.table.rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}
                </tbody>
              </table>
            </div>`;
        }
        return `
          <div class="step-card">
            <div class="step-card-head">
              <span class="step-title">${escapeHtml(st.title)}</span>
              <span class="step-badge">${escapeHtml(st.badge)}</span>
            </div>
            <p class="step-desc">${escapeHtml(st.description)}</p>
            ${eqHtml}
            ${tblHtml}
          </div>`;
      })
      .join('');
  }

  // =========================================================================
  // TAB 2: MAXIMUM DEFLECTION & LOCATION SOLUTION
  // =========================================================================
  function renderMaxSolution() {
    if (!state.solution) return;
    const sol = state.solution;
    const U = sol.units;
    const container = $('builtInSolutionMaxContainer');
    const method = state.activeMethod;

    const titles = {
      double_integration: 'Max Deflection Solution — Double Integration Method',
      moment_area: 'Max Deflection Solution — Moment-Area Method',
      conjugate_beam: 'Max Deflection Solution — Conjugate Beam Method',
      compare: 'Max Deflection Comparison — All 3 Methods'
    };
    $('solutionMaxTitle').textContent = titles[method] || titles.double_integration;

    if (method === 'compare') {
      const cmp = sol.comparison;
      const dUnit = sol.display.deflShortUnit;
      const dirWord = sol.extrema.deflection.maxSigned < -1e-10 ? '(Downward)' : sol.extrema.deflection.maxSigned > 1e-10 ? '(Upward)' : '';
      const maErr = cleanZero((cmp.momentArea.maxError_mm / 1000) * sol.display.deflScale);
      const cjErr = cleanZero((cmp.conjugateBeam.maxError_mm / 1000) * sol.display.deflScale);
      container.innerHTML = `
        <div class="step-card">
          <div class="step-card-head">
            <span class="step-title">Maximum Deflection Convergence Across All 3 Methods</span>
            <span class="step-badge">All 3 Match</span>
          </div>
          <p class="step-desc">Double Integration, Moment-Area, and Conjugate Beam all independently locate the same peak deflection:</p>
          <div class="eng-table-wrap">
            <table class="eng-table">
              <thead>
                <tr>
                  <th>Method</th>
                  <th>Max Deflection δ_max (${dUnit})</th>
                  <th>Location x_max (${U.length})</th>
                  <th>Difference</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>1. Double Integration</strong></td>
                  <td>${fmtDeflHtml(cmp.doubleIntegration.maxSigned_mm / 1000, sol, true)} ${dirWord}</td>
                  <td>${cmp.doubleIntegration.maxX.toFixed(4)} ${U.length}</td>
                  <td>Exact Reference</td>
                </tr>
                <tr>
                  <td><strong>2. Moment-Area Method</strong></td>
                  <td>${fmtDeflHtml(cmp.momentArea.maxSigned_mm / 1000, sol, true)} ${dirWord}</td>
                  <td>${cmp.momentArea.maxX.toFixed(4)} ${U.length}</td>
                  <td>${maErr === 0 ? '0 (Exact)' : `${SolutionBuilder.fmtSciHtml(maErr, 2)} ${dUnit}`}</td>
                </tr>
                <tr>
                  <td><strong>3. Conjugate Beam Method</strong></td>
                  <td>${fmtDeflHtml(cmp.conjugateBeam.maxSigned_mm / 1000, sol, true)} ${dirWord}</td>
                  <td>${cmp.conjugateBeam.maxX.toFixed(4)} ${U.length}</td>
                  <td>${cjErr === 0 ? '0 (Exact)' : `${SolutionBuilder.fmtSciHtml(cjErr, 2)} ${dUnit}`}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      `;
      return;
    }

    let steps = [];
    if (method === 'double_integration') steps = SolutionBuilder.buildDoubleIntegrationSteps(sol);
    else if (method === 'moment_area') steps = SolutionBuilder.buildMomentAreaSteps(sol);
    else if (method === 'conjugate_beam') steps = SolutionBuilder.buildConjugateBeamSteps(sol);

    container.innerHTML = renderStepCardsHtml(steps);
  }

  // =========================================================================
  // TAB 3: SLOPE & DEFLECTION AT ANY SELECTED POINT x
  // =========================================================================
  function renderPointSolution() {
    if (!state.solution) return;
    const sol = state.solution;
    const U = sol.units;
    const xP = state.probeX;
    const container = $('builtInSolutionPointContainer');
    const method = state.activeMethod;

    const titles = {
      double_integration: `Slope & Deflection at x = ${xP.toFixed(2)} ${U.length} — Double Integration Method`,
      moment_area: `Slope & Deflection at x = ${xP.toFixed(2)} ${U.length} — Moment-Area Method`,
      conjugate_beam: `Slope & Deflection at x = ${xP.toFixed(2)} ${U.length} — Conjugate Beam Method`,
      compare: `Slope & Deflection at x = ${xP.toFixed(2)} ${U.length} — All 3 Methods Compared`
    };
    $('solutionPointTitle').textContent = titles[method] || titles.double_integration;

    if (method === 'compare') {
      const st = sol.evalAt(xP);
      const ma = sol.momentArea.evalAt(xP);
      const cj = sol.conjugateBeam.evalAt(xP);
      container.innerHTML = `
        <div class="step-card">
          <div class="step-card-head">
            <span class="step-title">Comparison at Selected Point x = ${xP.toFixed(3)} ${U.length}</span>
            <span class="step-badge">All 3 Methods Match</span>
          </div>
          <p class="step-desc">Independent slope and deflection evaluation at x = ${xP.toFixed(3)} ${U.length} across all three structural methods:</p>
          <div class="eng-table-wrap">
            <table class="eng-table">
              <thead>
                <tr>
                  <th>Method</th>
                  <th>Slope θ(${xP.toFixed(2)} ${U.length})</th>
                  <th>Deflection y(${xP.toFixed(2)} ${U.length})</th>
                  <th>Internal Section Values</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>1. Double Integration</strong></td>
                  <td>${fmtSlopeHtml(st.theta, sol)}</td>
                  <td>${fmtDeflHtml(st.y, sol, false)}</td>
                  <td>V = ${cleanZero(st.V).toFixed(2)} ${U.force} · M = ${cleanZero(st.M).toFixed(2)} ${U.moment}</td>
                </tr>
                <tr>
                  <td><strong>2. Moment-Area Method</strong></td>
                  <td>${fmtSlopeHtml(ma.theta, sol)}</td>
                  <td>${fmtDeflHtml(ma.y, sol, false)}</td>
                  <td>t = ${fmtDeflHtml(ma.t_x_ref, sol, false)}</td>
                </tr>
                <tr>
                  <td><strong>3. Conjugate Beam Method</strong></td>
                  <td>${fmtSlopeHtml(cj.V_star, sol)}</td>
                  <td>${fmtDeflHtml(cj.M_star, sol, false)}</td>
                  <td>V* = θ · M* = y</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      `;
      return;
    }

    const steps = SolutionBuilder.buildPointSolutionSteps(sol, method, xP);
    container.innerHTML = renderStepCardsHtml(steps);
  }

  // =========================================================================
  // AI Model Configuration & Execution
  // =========================================================================
  function updateAiStatusBadge() {
    const s = state.aiSettings;
    const hasKey = Boolean((s.apiKey && s.apiKey.trim()) || s.provider === 'custom');
    const led = $('aiStatusLed');
    const txt = $('aiStatusText');
    if (hasKey) {
      led.classList.add('connected');
      txt.textContent = `${AIService.PROVIDERS[s.provider]?.name || s.provider}`;
    } else {
      led.classList.remove('connected');
      txt.textContent = 'Connect AI Key';
    }
  }

  function populateAiModal() {
    const s = state.aiSettings;
    $('aiProviderSelect').value = s.provider;
    syncProviderModels(s.provider, s.model);
    $('aiApiKeyInput').value = s.apiKey || '';
    $('aiCustomBaseUrl').value = s.customBaseUrl || 'http://localhost:11434/v1/chat/completions';
    $('aiPersistKeyCheckbox').checked = s.persistKey !== false;
    $('aiTestResult').textContent = '';
  }

  function syncProviderModels(providerKey, selectedModel) {
    const info = AIService.PROVIDERS[providerKey] || AIService.PROVIDERS.gemini;
    const presetSel = $('aiModelPreset');
    presetSel.innerHTML = info.models.map((m) => `<option value="${m}">${m}</option>`).join('');
    const modelToUse = selectedModel || info.defaultModel;
    if (info.models.includes(modelToUse)) presetSel.value = modelToUse;
    $('aiModelInput').value = modelToUse;
    $('aiApiKeyInput').placeholder = info.placeholderKey || 'Enter API key...';
    $('aiKeyHint').textContent = info.keyHint || '';
    $('customBaseUrlGroup').classList.toggle('hidden', providerKey !== 'custom');
  }

  function readAiSettingsFromModal() {
    return {
      provider: $('aiProviderSelect').value,
      model: $('aiModelInput').value.trim() || AIService.PROVIDERS[$('aiProviderSelect').value].defaultModel,
      apiKey: $('aiApiKeyInput').value.trim(),
      customBaseUrl: $('aiCustomBaseUrl').value.trim(),
      persistKey: $('aiPersistKeyCheckbox').checked,
      aiMode: state.aiSettings.aiMode || 'verified'
    };
  }

  async function runAiDerivation(mode) {
    if (!state.solution) {
      showToast('Calculate a beam (or pick a ready-made example) first.');
      return;
    }
    const s = state.aiSettings;
    if (!s.apiKey && s.provider !== 'custom') {
      openAiModal();
      showToast('Add your AI API key first to enable AI-powered derivations.');
      return;
    }

    switchWorkspaceTab('ai');

    const btn = mode === 'independent' ? $('aiIndependentBtn') : $('aiVerifiedBtn');
    const origText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> ${mode === 'independent' ? 'Checking...' : 'Generating...'}`;

    const box = $('aiSolutionBox');
    box.classList.remove('hidden');
    $('aiModelStamp').textContent = `${AIService.PROVIDERS[s.provider]?.name} (${s.model})`;
    $('aiVerifyBanner').innerHTML = '';
    $('aiMarkdownOutput').innerHTML = `<div style="display:flex; align-items:center; gap:10px; padding:10px 0;"><span class="spinner" style="border-top-color:var(--wisteria);"></span> Querying ${escapeHtml(s.model)}...</div>`;

    try {
      const result = await AIService.generateSolution(s, state.solution, state.activeMethod, mode);
      if (result.verification) {
        const v = result.verification;
        $('aiVerifyBanner').innerHTML = `
          <div class="ai-verify-badge ${v.matched ? 'pass' : 'warn'}">
            ${v.matched ? '✓ Independent AI Cross-Check PASSED' : '⚠ Independent AI Deviation Detected'} —
            AI: ${v.aiDefl.toFixed(4)} vs. Solver: ${v.engineDefl.toFixed(4)} (Δ = ${v.deflErrPct.toFixed(2)}%)
          </div>`;
      } else {
        $('aiVerifyBanner').innerHTML = `
          <div class="ai-verify-badge pass">
            ✦ Verified AI Step-by-Step Derivation — Grounded against exact analytical solver
          </div>`;
      }
      $('aiMarkdownOutput').innerHTML = renderMarkdownWithMath(result.markdown);
    } catch (err) {
      $('aiMarkdownOutput').innerHTML = `<div style="color:var(--mauve-accent); font-weight:700;">AI Request Failed: ${escapeHtml(err.message)}</div>`;
      showToast(`AI Error: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.innerHTML = origText;
    }
  }

  async function sendTutorMessage(overrideQuestion) {
    if (!state.solution) {
      showToast('Calculate a beam or pick a ready-made example first.');
      return;
    }
    const input = $('tutorInput');
    const q = (overrideQuestion !== undefined ? overrideQuestion : input.value).trim();
    if (!q) return;
    const s = state.aiSettings;
    if (!s.apiKey && s.provider !== 'custom') {
      openAiModal();
      showToast('Connect an AI API key to chat with the Structural Tutor.');
      return;
    }

    input.value = '';
    state.tutorHistory.push({ role: 'user', content: q });
    renderTutorMessages(true);

    try {
      const reply = await AIService.askTutor(s, state.solution, state.activeMethod, state.tutorHistory.slice(0, -1), q);
      state.tutorHistory.push({ role: 'assistant', content: reply });
      renderTutorMessages(false);
    } catch (err) {
      state.tutorHistory.push({ role: 'assistant', content: `**Error:** ${err.message}` });
      renderTutorMessages(false);
    }
  }

  function renderTutorMessages(loading) {
    const box = $('tutorMessages');
    box.innerHTML = state.tutorHistory
      .map(
        (m) => `
      <div class="tutor-msg ${m.role}">
        ${m.role === 'user' ? escapeHtml(m.content) : renderMarkdownWithMath(m.content)}
      </div>`
      )
      .join('');
    if (loading) {
      box.innerHTML += `<div class="tutor-msg assistant"><span class="spinner" style="border-top-color:var(--wisteria);"></span> Thinking...</div>`;
    }
    box.scrollTop = box.scrollHeight;
  }

  function openAiModal() {
    populateAiModal();
    $('aiModalBackdrop').classList.add('open');
  }
  function closeAiModal() { $('aiModalBackdrop').classList.remove('open'); }
  function openGuideModal() { $('guideModalBackdrop').classList.add('open'); }
  function closeGuideModal() { $('guideModalBackdrop').classList.remove('open'); }

  // =========================================================================
  // Preset Loader (Auto-populates SI or English example cleanly!)
  // =========================================================================
  function loadPreset(key) {
    const p = PRESETS[key];
    if (!p) return;
    state.unitSystem = p.unitSystem || 'si';
    state.usForceUnit = p.usForceUnit || 'kip';
    state.constantEI = false;
    $('constantEICheckbox').checked = false;
    syncUnitSystemUI(true);

    $('presetSelect').value = key;
    $('beamLength').value = p.length;
    $('youngsE').value = p.E;
    const matValues = state.unitSystem === 'us' ? ['29000', '10000', '4000', '1600'] : ['200', '69', '28', '11'];
    $('materialPreset').value = matValues.includes(String(p.E)) ? String(p.E) : 'custom';
    $('supportType').value = p.supportType;
    $('queryXInput').value = p.queryX;
    if (p.supportA !== undefined) $('supportAX').value = p.supportA;
    if (p.supportB !== undefined) $('supportBX').value = p.supportB;
    toggleOverhangInputs();

    Object.assign(state.section, p.section);
    $('sectionType').value = p.section.type;
    renderSectionInputs();

    state.loads = p.loads.map((ld) => ({ ...ld }));
    state.probeX = p.queryX;
    state.tutorHistory = [];
    renderTutorMessages(false);
    renderLoadsList();
    recalculate(false);
    showToast(`Loaded: ${p.label}`);
  }

  function toggleOverhangInputs() {
    const isOverhang = $('supportType').value === 'overhanging';
    $('overhangAGroup').classList.toggle('hidden', !isOverhang);
    $('overhangBGroup').classList.toggle('hidden', !isOverhang);
  }

  function selectMethod(method) {
    state.activeMethod = method;
    $('methodRadioList').querySelectorAll('.method-radio').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.method === method);
    });
    $('activeMethodPill').textContent = METHOD_SHORT_NAMES[method] || method;

    const map3d = {
      double_integration: 'real',
      moment_area: 'moment_area',
      conjugate_beam: 'conjugate',
      compare: 'real'
    };
    const target3d = map3d[method] || 'real';
    $('view3dModeGroup').querySelectorAll('.pill-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.view3d === target3d);
    });
    if (viewer3d) viewer3d.setViewMode(target3d);

    if (state.solution) {
      if (state.activeWsTab === 'diagrams') renderActiveMethodDiagrams();
      renderMaxSolution();
      renderPointSolution();
    }
  }

  // =========================================================================
  // Initialization (Starts Completely Blank & Ready!)
  // =========================================================================
  function init() {
    viewer3d = new Viewer3D($('viewer3dContainer'));

    syncUnitSystemUI(true);
    updateAiStatusBadge();

    // Unit System Toggle (SI Metric vs English US)
    $('unitSystemPills').querySelectorAll('.unit-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextSys = btn.dataset.unitSys;
        if (nextSys === state.unitSystem) return;
        state.unitSystem = nextSys;
        syncUnitSystemUI(true);
        if (state.solution) recalculate(true);
        showToast(`Switched to ${nextSys === 'us' ? 'English (US: ft, kip/lb, ksi, in)' : 'SI Metric (m, kN, GPa, mm)'} units`);
      });
    });

    $('usForcePills').querySelectorAll('.unit-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.usForceUnit = btn.dataset.usForce;
        syncUnitSystemUI(false);
        if (state.solution) recalculate(true);
      });
    });

    // Example Preset Dropdown & Empty-State Starter Button
    $('presetSelect').addEventListener('change', (e) => {
      if (e.target.value) loadPreset(e.target.value);
    });
    $('quickStartExampleBtn').addEventListener('click', () => loadPreset('ss_point'));

    // Step 1 Controls
    $('supportType').addEventListener('change', () => {
      toggleOverhangInputs();
      if (state.solution) recalculate(true);
    });
    $('supportAX').addEventListener('change', () => { if (state.solution) recalculate(true); });
    $('supportBX').addEventListener('change', () => { if (state.solution) recalculate(true); });
    $('beamLength').addEventListener('change', () => { if (state.solution) recalculate(true); });
    $('queryXInput').addEventListener('change', () => {
      if (state.solution && $('queryXInput').value !== '') {
        setInspectPointX(Number($('queryXInput').value), true);
      }
    });

    $('materialPreset').addEventListener('change', () => {
      const val = $('materialPreset').value;
      if (val === 'constant_ei') {
        state.constantEI = true;
        $('constantEICheckbox').checked = true;
        updateSectionBadge();
        if (state.solution) recalculate(true);
      } else if (val === '') {
        state.constantEI = false;
        $('constantEICheckbox').checked = false;
        $('youngsE').value = '';
        updateSectionBadge();
      } else {
        state.constantEI = false;
        $('constantEICheckbox').checked = false;
        if (val === 'custom') {
          $('sectionDisclosure').open = true;
          $('youngsE').focus();
        } else {
          $('youngsE').value = val;
          updateSectionBadge();
          if (state.solution) recalculate(true);
        }
      }
    });

    $('constantEICheckbox').addEventListener('change', (e) => {
      state.constantEI = e.target.checked;
      if (state.constantEI) {
        $('materialPreset').value = 'constant_ei';
      } else {
        const curE = String(Number($('youngsE').value) || '');
        const validMats = state.unitSystem === 'us' ? ['29000', '10000', '4000', '1600'] : ['200', '69', '28', '11'];
        $('materialPreset').value = validMats.includes(curE) ? curE : curE ? 'custom' : '';
      }
      updateSectionBadge();
      if (state.solution) recalculate(true);
    });

    $('youngsE').addEventListener('input', updateSectionBadge);
    $('youngsE').addEventListener('change', () => { if (state.solution) recalculate(true); });
    $('sectionType').addEventListener('change', () => {
      renderSectionInputs();
      if (state.solution) recalculate(true);
    });

    // Step 2: Load Builder
    $('loadTypeTabs').querySelectorAll('.load-type-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        $('loadTypeTabs').querySelectorAll('.load-type-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.activeLoadType = btn.dataset.loadType;
        updateLoadInputVisibility();
      });
    });
    $('addLoadBtn').addEventListener('click', addLoadFromForm);
    $('clearLoadsBtn').addEventListener('click', () => {
      state.loads = [];
      renderLoadsList();
      renderEmptyState();
      showToast('All loads cleared');
    });

    // Step 3: Method Radio Cards & Calculate
    $('methodRadioList').querySelectorAll('.method-radio').forEach((btn) => {
      btn.addEventListener('click', () => selectMethod(btn.dataset.method));
    });
    $('calculateBtn').addEventListener('click', () => recalculate(false));

    // 4-Tab Workspace Switcher
    $('workspaceTabs').querySelectorAll('.ws-tab').forEach((btn) => {
      btn.addEventListener('click', () => switchWorkspaceTab(btn.dataset.wsTab));
    });
    $('jumpToAiBtn').addEventListener('click', () => switchWorkspaceTab('ai'));
    $('aiSettingsInlineBtn').addEventListener('click', openAiModal);

    // 3D Stage Controls
    $('view3dModeGroup').querySelectorAll('.pill-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        $('view3dModeGroup').querySelectorAll('.pill-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        if (viewer3d) viewer3d.setViewMode(btn.dataset.view3d);
      });
    });
    $('colorMapSelect').addEventListener('change', (e) => {
      if (viewer3d) viewer3d.setColorMode(e.target.value);
    });
    $('cameraPresetSelect').addEventListener('change', (e) => {
      if (viewer3d) viewer3d.setCameraPreset(e.target.value);
    });
    $('exaggerationSlider').addEventListener('input', (e) => {
      const val = Number(e.target.value);
      $('exaggerationVal').textContent = `${val.toFixed(1)}×`;
      if (viewer3d) viewer3d.setExaggeration(val);
    });
    $('animateFlexBtn').addEventListener('click', (e) => {
      const active = e.target.classList.toggle('active');
      e.target.textContent = active ? '⏸ Pause' : '▶ Animate';
      if (viewer3d) viewer3d.setAnimateLoad(active);
    });
    $('autoOrbitBtn').addEventListener('click', (e) => {
      const active = e.target.classList.toggle('active');
      if (viewer3d) viewer3d.setAutoOrbit(active);
    });

    // Synchronized Section Inspector Slider + Inline Point-x Input
    $('sectionProbeSlider').addEventListener('input', (e) => {
      setInspectPointX(Number(e.target.value), true);
    });
    $('pointSolutionXInput').addEventListener('input', (e) => {
      if (e.target.value !== '' && state.solution) {
        setInspectPointX(Number(e.target.value), false);
      }
    });

    // AI Tab Buttons & Starter Chips
    $('aiVerifiedBtn').addEventListener('click', () => runAiDerivation('verified'));
    $('aiIndependentBtn').addEventListener('click', () => runAiDerivation('independent'));
    $('clearAiOutputBtn').addEventListener('click', () => $('aiSolutionBox').classList.add('hidden'));
    $('tutorSendBtn').addEventListener('click', () => sendTutorMessage());
    $('tutorInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendTutorMessage();
    });
    $('tutorStarterChips').querySelectorAll('.starter-chip').forEach((chip) => {
      chip.addEventListener('click', () => sendTutorMessage(chip.textContent));
    });

    // Modals (Guide & AI Settings)
    $('openGuideBtn').addEventListener('click', openGuideModal);
    $('closeGuideModalBtn').addEventListener('click', closeGuideModal);
    $('guideModalBackdrop').addEventListener('click', (e) => {
      if (e.target === $('guideModalBackdrop')) closeGuideModal();
    });

    $('openAiModalBtn').addEventListener('click', openAiModal);
    $('closeAiModalBtn').addEventListener('click', closeAiModal);
    $('aiModalBackdrop').addEventListener('click', (e) => {
      if (e.target === $('aiModalBackdrop')) closeAiModal();
    });
    $('aiProviderSelect').addEventListener('change', (e) => syncProviderModels(e.target.value, null));
    $('aiModelPreset').addEventListener('change', (e) => { $('aiModelInput').value = e.target.value; });
    $('toggleKeyVisBtn').addEventListener('click', () => {
      const inp = $('aiApiKeyInput');
      const showing = inp.type === 'text';
      inp.type = showing ? 'password' : 'text';
      $('toggleKeyVisBtn').textContent = showing ? 'Show' : 'Hide';
    });
    $('testAiKeyBtn').addEventListener('click', async () => {
      const testSettings = readAiSettingsFromModal();
      const resEl = $('aiTestResult');
      resEl.style.color = 'var(--text-secondary)';
      resEl.textContent = 'Testing connection...';
      try {
        const msg = await AIService.testConnection(testSettings);
        resEl.style.color = '#2c8a66';
        resEl.textContent = `✓ ${msg}`;
      } catch (err) {
        resEl.style.color = 'var(--mauve-accent)';
        resEl.textContent = `✕ Failed: ${err.message}`;
      }
    });
    $('clearAiKeyBtn').addEventListener('click', () => {
      $('aiApiKeyInput').value = '';
      state.aiSettings.apiKey = '';
      AIService.saveSettings(state.aiSettings);
      updateAiStatusBadge();
      showToast('API key cleared');
    });
    $('saveAiModalBtn').addEventListener('click', () => {
      state.aiSettings = readAiSettingsFromModal();
      AIService.saveSettings(state.aiSettings);
      updateAiStatusBadge();
      closeAiModal();
      showToast(`Connected ${AIService.PROVIDERS[state.aiSettings.provider]?.name}`);
    });

    // Theme & Print
    try {
      if (localStorage.getItem('beamstudio_theme') === 'dark') {
        state.dark = true;
        document.documentElement.setAttribute('data-theme', 'dark');
        if (viewer3d) viewer3d.setTheme(true);
      }
    } catch (_) {}
    $('themeToggleBtn').addEventListener('click', () => {
      state.dark = !state.dark;
      document.documentElement.setAttribute('data-theme', state.dark ? 'dark' : 'light');
      try { localStorage.setItem('beamstudio_theme', state.dark ? 'dark' : 'light'); } catch (_) {}
      if (viewer3d) viewer3d.setTheme(state.dark);
      redrawCurrentCanvasesOnly();
    });
    $('printReportBtn').addEventListener('click', () => global.print());

    let resizeTimer;
    global.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => redrawCurrentCanvasesOnly(), 120);
    });

    // Start completely blank on page open!
    renderEmptyState();
  }

  document.addEventListener('DOMContentLoaded', init);
})(window);
