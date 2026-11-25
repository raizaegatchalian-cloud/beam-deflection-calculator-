/**
 * BeamStudio 3D — Main Application Controller
 * Features:
 *  - Clean blank initial state (auto-populates when a Ready-Made Example is chosen or user enters values)
 *  - Two separate Step-by-Step Solution tabs:
 *      1) Max Deflection Solution (x_max & δ_max)
 *      2) Point x Solution (exact Slope & Deflection at ANY inspected point x, synced live with Inspect Point x!)
 *  - Support for mm, cm, m deflection units + Constant EI symbolic mode (/EI)
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
    activeMethod: 'double_integration', // 'double_integration' | 'moment_area' | 'conjugate_beam' | 'compare'
    activeWsTab: 'diagrams', // 'diagrams' | 'solution_max' | 'solution_point' | 'ai'
    activeLoadType: 'Point',
    constantEI: false,
    deflUnit: 'mm', // 'mm' | 'cm' | 'm'
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
  // Ready-Made Engineering Examples
  // =========================================================================
  const PRESETS = {
    ss_point: {
      label: 'Simply Supported + Midspan Point Load',
      length: 6,
      E: 200,
      supportType: 'simply_supported',
      queryX: 3,
      section: { type: 'ibeam', h: 300, bf: 150, tf: 12, tw: 8 },
      loads: [{ type: 'Point', P: 30, a: 3 }]
    },
    ss_combined: {
      label: 'Simply Supported + UDL, Point & Moment',
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
    }
  };

  const METHOD_SHORT_NAMES = {
    double_integration: 'Double Integration',
    moment_area: 'Moment-Area',
    conjugate_beam: 'Conjugate Beam',
    compare: 'Compare All 3'
  };

  // =========================================================================
  // Utilities
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

  function fmtDefl(valMeters, sol) {
    const disp = sol.display;
    const scaled = valMeters * disp.deflScale;
    const absS = Math.abs(scaled);
    const numStr =
      absS > 0 && absS < 0.001
        ? scaled.toExponential(3)
        : disp.deflUnit === 'm' && !disp.isConstantEI
          ? scaled.toFixed(5)
          : scaled.toFixed(3);
    return disp.isConstantEI ? `${numStr} / EI` : `${numStr} ${disp.deflShortUnit}`;
  }

  function fmtSlope(valRad, sol) {
    const disp = sol.display;
    const scaled = valRad * disp.slopeScale;
    const absS = Math.abs(scaled);
    const numStr = absS > 0 && absS < 0.001 ? scaled.toExponential(2) : scaled.toFixed(3);
    return disp.isConstantEI ? `${numStr} / EI` : `${numStr} ${disp.slopeUnitLabel}`;
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
    const s = state.section;
    // Provide clean structural defaults behind the scenes if user leaves optional mm dimensions blank
    return {
      type: s.type || 'ibeam',
      h: Number(s.h) > 0 ? Number(s.h) : 300,
      bf: Number(s.bf) > 0 ? Number(s.bf) : 150,
      tf: Number(s.tf) > 0 ? Number(s.tf) : 12,
      tw: Number(s.tw) > 0 ? Number(s.tw) : 8,
      b: Number(s.b) > 0 ? Number(s.b) : 200,
      D: Number(s.D) > 0 ? Number(s.D) : 260,
      t: Number(s.t) > 0 ? Number(s.t) : 12,
      hw: Number(s.hw) > 0 ? Number(s.hw) : 260,
      customI: Number(s.customI) > 0 ? Number(s.customI) : 8.5e-5,
      customIUnit: s.customIUnit || 'm4'
    };
  }

  function renderSectionInputs() {
    const type = $('sectionType').value;
    state.section.type = type;
    const container = $('sectionDimsContainer');

    if (type === 'custom') {
      const unit = state.section.customIUnit || 'm4';
      container.innerHTML = `
        <div class="form-group">
          <label for="customIInput">Moment of Inertia I</label>
          <input class="input-3d sec-dim-input" id="customIInput" data-sec-key="customI" type="number" step="any" min="0.000000000001" placeholder="e.g. 8000" value="${state.section.customI}" />
        </div>
        <div class="form-group">
          <label for="customIUnitSelect">Unit of I</label>
          <select class="select-3d" id="customIUnitSelect">
            <option value="m4" ${unit === 'm4' ? 'selected' : ''}>m⁴</option>
            <option value="cm4" ${unit === 'cm4' ? 'selected' : ''}>cm⁴ (×10⁻⁸ m⁴)</option>
            <option value="e6mm4" ${unit === 'e6mm4' ? 'selected' : ''}>×10⁶ mm⁴ (×10⁻⁶ m⁴)</option>
            <option value="mm4" ${unit === 'mm4' ? 'selected' : ''}>mm⁴ (×10⁻¹² m⁴)</option>
            <option value="in4" ${unit === 'in4' ? 'selected' : ''}>in⁴ (Imperial)</option>
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

    let fields = [];
    if (type === 'ibeam') {
      fields = [
        { key: 'h', label: 'Depth h (mm)', val: state.section.h, ph: '300' },
        { key: 'bf', label: 'Flange b_f (mm)', val: state.section.bf, ph: '150' },
        { key: 'tf', label: 'Flange t_f (mm)', val: state.section.tf, ph: '12' },
        { key: 'tw', label: 'Web t_w (mm)', val: state.section.tw, ph: '8' }
      ];
    } else if (type === 'rect') {
      fields = [
        { key: 'b', label: 'Width b (mm)', val: state.section.b, ph: '200' },
        { key: 'h', label: 'Height h (mm)', val: state.section.h, ph: '350' }
      ];
    } else if (type === 'tube') {
      fields = [
        { key: 'D', label: 'Outer Dia D (mm)', val: state.section.D, ph: '260' },
        { key: 't', label: 'Wall Thick t (mm)', val: state.section.t, ph: '12' }
      ];
    } else if (type === 'tbeam') {
      fields = [
        { key: 'bf', label: 'Flange b_f (mm)', val: state.section.bf, ph: '280' },
        { key: 'tf', label: 'Flange t_f (mm)', val: state.section.tf, ph: '25' },
        { key: 'hw', label: 'Web h_w (mm)', val: state.section.hw, ph: '280' },
        { key: 'tw', label: 'Web t_w (mm)', val: state.section.tw, ph: '35' }
      ];
    }

    container.innerHTML = fields
      .map(
        (f) => `
      <div class="form-group">
        <label>${f.label}</label>
        <input class="input-3d sec-dim-input" data-sec-key="${f.key}" type="number" step="1" min="1" placeholder="e.g. ${f.ph}" value="${f.val}" />
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

    const props = Engine.computeSectionProperties(getEffectiveSection());
    const EI = E_val * 1e6 * props.I;
    const shortType = { ibeam: 'I-Beam', rect: 'Rect', tube: 'Tube', tbeam: 'T-Beam', custom: 'Custom I' }[state.section.type] || 'Section';
    $('computedILabel').textContent = `I = ${props.I.toExponential(3)} m⁴`;
    $('computedEILabel').textContent = `EI = ${EI.toLocaleString(undefined, { maximumFractionDigits: 1 })} kN·m²`;
    $('sectionSummaryMeta').textContent = `${shortType} ▾`;

    const warnBox = $('hugeIWarning');
    if (warnBox) {
      const isHugeM4 = state.section.type === 'custom' && (state.section.customIUnit || 'm4') === 'm4' && Number(state.section.customI) >= 1;
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
    const t = state.activeLoadType;
    const magLabel = $('loadMagLabel');
    const aLabel = $('loadALabel');
    const bGroup = $('loadBGroup');
    const w2Group = $('loadW2Group');

    if (t === 'Point') {
      magLabel.textContent = 'Force P (kN, ↓+)';
      aLabel.textContent = 'Position a (m)';
      bGroup.classList.add('hidden');
      w2Group.classList.add('hidden');
    } else if (t === 'UDL') {
      magLabel.textContent = 'Intensity w (kN/m, ↓+)';
      aLabel.textContent = 'Start a (m)';
      bGroup.classList.remove('hidden');
      w2Group.classList.add('hidden');
    } else if (t === 'UVL') {
      magLabel.textContent = 'Start w₁ (kN/m, ↓+)';
      aLabel.textContent = 'Start a (m)';
      bGroup.classList.remove('hidden');
      w2Group.classList.remove('hidden');
    } else if (t === 'Moment') {
      magLabel.textContent = 'Moment M₀ (kN·m, ↺+)';
      aLabel.textContent = 'Position a (m)';
      bGroup.classList.add('hidden');
      w2Group.classList.add('hidden');
    }
  }

  function renderLoadsList() {
    const list = $('loadsList');
    if (state.loads.length === 0) {
      list.innerHTML = `<div class="hint-text" style="text-align:center; padding:8px;">No loads added yet. Enter a load above or pick a ready-made example.</div>`;
      return;
    }
    list.innerHTML = state.loads
      .map((ld, idx) => {
        let desc = '';
        if (ld.type === 'Point') desc = `${ld.P} kN at x = ${ld.a} m`;
        else if (ld.type === 'UDL') desc = `${ld.w} kN/m from ${ld.a} to ${ld.b} m`;
        else if (ld.type === 'UVL') desc = `${ld.w1}→${ld.w2} kN/m (${ld.a}–${ld.b} m)`;
        else if (ld.type === 'Moment') desc = `${ld.M} kN·m (${ld.M >= 0 ? 'CCW' : 'CW'}) at ${ld.a} m`;
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
    const L = Number($('beamLength').value);
    if (!(L > 0)) return showToast('Enter Beam Length L (m) in Step 1 first.');
    const t = state.activeLoadType;
    const rawMag = $('loadMag').value.trim();
    const rawA = $('loadA').value.trim();
    if (rawMag === '' || rawA === '') return showToast('Enter the load magnitude and position first.');

    const mag = Number(rawMag);
    const a = Number(rawA);
    if (!isFinite(mag) || !isFinite(a)) return showToast('Enter valid numeric load values.');
    if (a < 0 || a > L) return showToast(`Position a must be within [0, ${L}] m.`);

    if (t === 'Point') {
      state.loads.push({ type: 'Point', P: mag, a });
    } else if (t === 'Moment') {
      state.loads.push({ type: 'Moment', M: mag, a });
    } else {
      const rawB = $('loadB').value.trim();
      if (rawB === '') return showToast('Enter End Position b (m) for the distributed load.');
      const b = Number(rawB);
      if (!isFinite(b) || b <= a || b > L) {
        return showToast(`Distributed load must satisfy 0 ≤ a < b ≤ ${L} m.`);
      }
      if (t === 'UDL') state.loads.push({ type: 'UDL', w: mag, a, b });
      else {
        const rawW2 = $('loadW2').value.trim();
        if (rawW2 === '') return showToast('Enter End Intensity w₂ (kN/m) for UVL.');
        const w2 = Number(rawW2);
        if (!isFinite(w2)) return showToast('Enter a valid end intensity w₂.');
        state.loads.push({ type: 'UVL', w1: mag, w2, a, b });
      }
    }

    renderLoadsList();
    // Auto-calculate if Step 1 is complete
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
    const L = Number($('beamLength').value);
    const supportType = $('supportType').value;
    const E = Number($('youngsE').value);

    if (!(L > 0)) {
      if (!silentMissing) showToast('Step 1: Enter Beam Length L (m) or pick a ready-made example.');
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

      // Sync probeX cleanly
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
    const { deflection, moment, shear } = sol.extrema;
    const dirWord = deflection.maxSigned < -1e-12 ? 'Downward' : deflection.maxSigned > 1e-12 ? 'Upward' : 'Zero';

    $('kpiDefl').textContent = fmtDefl(deflection.maxSigned, sol);
    if (sol.display.isConstantEI) {
      $('kpiDeflSub').textContent = `${dirWord} at x = ${deflection.maxX.toFixed(2)} m (kN·m³/EI)`;
    } else {
      const L_mm = sol.input.L * 1000;
      const ratio = deflection.maxAbs_mm > 1e-12 ? Math.round(L_mm / deflection.maxAbs_mm).toLocaleString() : '∞';
      $('kpiDeflSub').textContent = `${dirWord} at x = ${deflection.maxX.toFixed(2)} m (L/${ratio})`;
    }

    $('deflUnitPills').classList.toggle('hidden', sol.display.isConstantEI);
    $('deflEiTag').classList.toggle('hidden', !sol.display.isConstantEI);

    $('kpiMoment').textContent = `${moment.maxAbsSigned.toFixed(2)} kN·m`;
    $('kpiMomentSub').textContent = `at x = ${moment.maxAbsX.toFixed(2)} m`;

    $('kpiShear').textContent = `${shear.maxAbsSigned.toFixed(2)} kN`;
    $('kpiShearSub').textContent = `at x = ${shear.maxAbsX.toFixed(2)} m`;

    const r = sol.reactions;
    const rList = [];
    if (sol.input.supports.some((s) => s.id === 'A')) rList.push(`R<sub>A</sub> = ${r.RA.toFixed(2)} kN`);
    if (sol.input.supports.some((s) => s.id === 'B')) rList.push(`R<sub>B</sub> = ${r.RB.toFixed(2)} kN`);
    if (Math.abs(r.MA) > 1e-4) rList.push(`M<sub>A</sub> = ${r.MA.toFixed(1)} kN·m`);
    if (Math.abs(r.MB) > 1e-4) rList.push(`M<sub>B</sub> = ${r.MB.toFixed(1)} kN·m`);
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
    const st = sol.evalAt(state.probeX);
    $('probeXVal').textContent = `${st.x.toFixed(2)} m`;
    $('pointTabBadge').textContent = `x = ${st.x.toFixed(2)} m`;
    $('probeMetrics').innerHTML = `
      <span>V: <b>${st.V.toFixed(2)} kN</b></span>
      <span>M: <b>${st.M.toFixed(2)} kN·m</b></span>
      <span>θ: <b>${fmtSlope(st.theta, sol)}</b></span>
      <span>δ: <b>${fmtDefl(st.y, sol)}</b></span>
    `;
  }

  // =========================================================================
  // Diagrams Renderer (Plain-English Titles & Subtitles)
  // =========================================================================
  function renderActiveMethodDiagrams() {
    if (!state.solution) return;
    const sol = state.solution;
    const grid = $('diagramsGrid');
    const method = state.activeMethod;
    const commonOpts = { dark: state.dark, probeX: state.probeX };
    const disp = sol.display;
    const dUnit = disp.deflShortUnit;
    const sUnit = disp.slopeUnitLabel;
    const dDecimals = !disp.isConstantEI && disp.deflUnit === 'm' ? 5 : 3;

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
            <span class="diagram-tag">kN</span>
          </div>
          <canvas class="diagram-canvas" id="cvSfd"></canvas>
        </div>
        <div class="diagram-box">
          <div class="diagram-header">
            <div>
              <div class="diagram-title">Bending Moment Along Beam</div>
              <div class="diagram-sub">Internal bending effort curving the beam, M(x)</div>
            </div>
            <span class="diagram-tag">kN·m</span>
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
      registerCanvas($('cvSfd'), Diagrams.drawCurveChart($('cvSfd'), sol.arrays.x, sol.arrays.V, sol.input.L, { ...commonOpts, color: 'aurora', unit: 'kN', yLabel: 'Shear V (kN)' }));
      registerCanvas($('cvBmd'), Diagrams.drawCurveChart($('cvBmd'), sol.arrays.x, sol.arrays.M, sol.input.L, { ...commonOpts, color: 'wisteria', unit: 'kN·m', yLabel: 'Moment M (kN·m)' }));
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
            <span class="diagram-tag">kN</span>
          </div>
          <canvas class="diagram-canvas" id="cvSfdMa"></canvas>
        </div>
        <div class="diagram-box">
          <div class="diagram-header">
            <div>
              <div class="diagram-title">Bending Moment Along Beam</div>
              <div class="diagram-sub">Internal bending effort, M(x)</div>
            </div>
            <span class="diagram-tag">kN·m</span>
          </div>
          <canvas class="diagram-canvas" id="cvBmdMa"></canvas>
        </div>
      `;

      registerCanvas($('cvMaCurv'), Diagrams.drawMomentAreaCurvature($('cvMaCurv'), sol, commonOpts));
      registerCanvas($('cvMaTan'), Diagrams.drawMomentAreaTangent($('cvMaTan'), sol, commonOpts));
      registerCanvas($('cvSfdMa'), Diagrams.drawCurveChart($('cvSfdMa'), sol.arrays.x, sol.arrays.V, sol.input.L, { ...commonOpts, color: 'aurora', unit: 'kN', yLabel: 'Shear V (kN)' }));
      registerCanvas($('cvBmdMa'), Diagrams.drawCurveChart($('cvBmdMa'), sol.arrays.x, sol.arrays.M, sol.input.L, { ...commonOpts, color: 'wisteria', unit: 'kN·m', yLabel: 'Moment M (kN·m)' }));
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
            <span class="diagram-tag">kN</span>
          </div>
          <canvas class="diagram-canvas" id="cvSfdCmp"></canvas>
        </div>
        <div class="diagram-box">
          <div class="diagram-header">
            <div>
              <div class="diagram-title">Bending Moment Along Beam</div>
              <div class="diagram-sub">Internal bending effort, M(x)</div>
            </div>
            <span class="diagram-tag">kN·m</span>
          </div>
          <canvas class="diagram-canvas" id="cvBmdCmp"></canvas>
        </div>
      `;

      registerCanvas($('cvCompare'), Diagrams.drawComparisonChart($('cvCompare'), sol, commonOpts));
      registerCanvas($('cvSfdCmp'), Diagrams.drawCurveChart($('cvSfdCmp'), sol.arrays.x, sol.arrays.V, sol.input.L, { ...commonOpts, color: 'aurora', unit: 'kN', yLabel: 'Shear V (kN)' }));
      registerCanvas($('cvBmdCmp'), Diagrams.drawCurveChart($('cvBmdCmp'), sol.arrays.x, sol.arrays.M, sol.input.L, { ...commonOpts, color: 'wisteria', unit: 'kN·m', yLabel: 'Moment M (kN·m)' }));
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
    const disp = sol.display;
    const dUnit = disp.deflShortUnit;
    const sUnit = disp.slopeUnitLabel;
    const dDecimals = !disp.isConstantEI && disp.deflUnit === 'm' ? 5 : 3;
    const opts = { dark: state.dark, probeX: state.probeX };
    if ($('cvFbd')) Diagrams.drawFBD($('cvFbd'), sol, opts);
    if ($('cvSfd')) Diagrams.drawCurveChart($('cvSfd'), sol.arrays.x, sol.arrays.V, sol.input.L, { ...opts, color: 'aurora', unit: 'kN', yLabel: 'Shear V (kN)' });
    if ($('cvBmd')) Diagrams.drawCurveChart($('cvBmd'), sol.arrays.x, sol.arrays.M, sol.input.L, { ...opts, color: 'wisteria', unit: 'kN·m', yLabel: 'Moment M (kN·m)' });
    if ($('cvSlope')) Diagrams.drawCurveChart($('cvSlope'), sol.arrays.x, sol.arrays.theta.map((t) => t * disp.slopeScale), sol.input.L, { ...opts, color: 'aurora', unit: sUnit, decimals: 3, yLabel: `Slope θ (${sUnit})` });
    if ($('cvDefl')) Diagrams.drawCurveChart($('cvDefl'), sol.arrays.x, sol.arrays.y.map((v) => v * disp.deflScale), sol.input.L, { ...opts, color: 'mauve', unit: dUnit, decimals: dDecimals, yLabel: `Deflection y (${dUnit})` });
    if ($('cvMaCurv')) Diagrams.drawMomentAreaCurvature($('cvMaCurv'), sol, opts);
    if ($('cvMaTan')) Diagrams.drawMomentAreaTangent($('cvMaTan'), sol, opts);
    if ($('cvSfdMa')) Diagrams.drawCurveChart($('cvSfdMa'), sol.arrays.x, sol.arrays.V, sol.input.L, { ...opts, color: 'aurora', unit: 'kN', yLabel: 'Shear V (kN)' });
    if ($('cvBmdMa')) Diagrams.drawCurveChart($('cvBmdMa'), sol.arrays.x, sol.arrays.M, sol.input.L, { ...opts, color: 'wisteria', unit: 'kN·m', yLabel: 'Moment M (kN·m)' });
    if ($('cvConjSch')) Diagrams.drawConjugateBeamSchematic($('cvConjSch'), sol, opts);
    if ($('cvConjV')) Diagrams.drawCurveChart($('cvConjV'), sol.arrays.x, sol.arrays.thetaConj.map((v) => v * disp.slopeScale), sol.input.L, { ...opts, color: 'aurora', unit: sUnit, decimals: 3, yLabel: `V* = θ (${sUnit})` });
    if ($('cvConjM')) Diagrams.drawCurveChart($('cvConjM'), sol.arrays.x, sol.arrays.yConj_mm.map((v) => (v / 1000) * disp.deflScale), sol.input.L, { ...opts, color: 'wisteria', unit: dUnit, decimals: dDecimals, yLabel: `M* = y (${dUnit})` });
    if ($('cvCompare')) Diagrams.drawComparisonChart($('cvCompare'), sol, opts);
    if ($('cvSfdCmp')) Diagrams.drawCurveChart($('cvSfdCmp'), sol.arrays.x, sol.arrays.V, sol.input.L, { ...opts, color: 'aurora', unit: 'kN', yLabel: 'Shear V (kN)' });
    if ($('cvBmdCmp')) Diagrams.drawCurveChart($('cvBmdCmp'), sol.arrays.x, sol.arrays.M, sol.input.L, { ...opts, color: 'wisteria', unit: 'kN·m', yLabel: 'Moment M (kN·m)' });
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
                  <th>Location x_max (m)</th>
                  <th>Difference</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>1. Double Integration</strong></td>
                  <td>${fmtDefl(cmp.doubleIntegration.maxSigned_mm / 1000, sol)}</td>
                  <td>${cmp.doubleIntegration.maxX.toFixed(4)} m</td>
                  <td>Exact Reference</td>
                </tr>
                <tr>
                  <td><strong>2. Moment-Area Method</strong></td>
                  <td>${fmtDefl(cmp.momentArea.maxSigned_mm / 1000, sol)}</td>
                  <td>${cmp.momentArea.maxX.toFixed(4)} m</td>
                  <td>${((cmp.momentArea.maxError_mm / 1000) * sol.display.deflScale).toExponential(2)} ${dUnit}</td>
                </tr>
                <tr>
                  <td><strong>3. Conjugate Beam Method</strong></td>
                  <td>${fmtDefl(cmp.conjugateBeam.maxSigned_mm / 1000, sol)}</td>
                  <td>${cmp.conjugateBeam.maxX.toFixed(4)} m</td>
                  <td>${((cmp.conjugateBeam.maxError_mm / 1000) * sol.display.deflScale).toExponential(2)} ${dUnit}</td>
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
  // TAB 3: SLOPE & DEFLECTION AT ANY SELECTED POINT x (SYNCED TO INSPECT POINT x!)
  // =========================================================================
  function renderPointSolution() {
    if (!state.solution) return;
    const sol = state.solution;
    const xP = state.probeX;
    const container = $('builtInSolutionPointContainer');
    const method = state.activeMethod;

    const titles = {
      double_integration: `Slope & Deflection at x = ${xP.toFixed(2)} m — Double Integration Method`,
      moment_area: `Slope & Deflection at x = ${xP.toFixed(2)} m — Moment-Area Method`,
      conjugate_beam: `Slope & Deflection at x = ${xP.toFixed(2)} m — Conjugate Beam Method`,
      compare: `Slope & Deflection at x = ${xP.toFixed(2)} m — All 3 Methods Compared`
    };
    $('solutionPointTitle').textContent = titles[method] || titles.double_integration;

    if (method === 'compare') {
      const st = sol.evalAt(xP);
      const ma = sol.momentArea.evalAt(xP);
      const cj = sol.conjugateBeam.evalAt(xP);
      container.innerHTML = `
        <div class="step-card">
          <div class="step-card-head">
            <span class="step-title">Comparison at Selected Point x = ${xP.toFixed(3)} m</span>
            <span class="step-badge">All 3 Methods Match</span>
          </div>
          <p class="step-desc">Independent slope and deflection evaluation at x = ${xP.toFixed(3)} m across all three structural methods:</p>
          <div class="eng-table-wrap">
            <table class="eng-table">
              <thead>
                <tr>
                  <th>Method</th>
                  <th>Slope θ(${xP.toFixed(2)} m)</th>
                  <th>Deflection y(${xP.toFixed(2)} m)</th>
                  <th>Shear V / Moment M</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>1. Double Integration</strong></td>
                  <td>${fmtSlope(st.theta, sol)}</td>
                  <td>${fmtDefl(st.y, sol)}</td>
                  <td>V = ${st.V.toFixed(2)} kN · M = ${st.M.toFixed(2)} kN·m</td>
                </tr>
                <tr>
                  <td><strong>2. Moment-Area Method</strong></td>
                  <td>${fmtSlope(ma.theta, sol)}</td>
                  <td>${fmtDefl(ma.y, sol)}</td>
                  <td>t = ${fmtDefl(ma.t_x_ref, sol)}</td>
                </tr>
                <tr>
                  <td><strong>3. Conjugate Beam Method</strong></td>
                  <td>${fmtSlope(cj.V_star, sol)}</td>
                  <td>${fmtDefl(cj.M_star, sol)}</td>
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
            AI: ${v.aiDefl.toFixed(4)} mm vs. Solver: ${v.engineDefl.toFixed(4)} mm (Δ = ${v.deflErrPct.toFixed(2)}%)
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
  // Preset Loader (Auto-populates all fields cleanly!)
  // =========================================================================
  function loadPreset(key) {
    const p = PRESETS[key];
    if (!p) return;
    state.constantEI = false;
    $('constantEICheckbox').checked = false;
    $('presetSelect').value = key;
    $('beamLength').value = p.length;
    $('youngsE').value = p.E;
    $('materialPreset').value = ['200', '69', '28', '11'].includes(String(p.E)) ? String(p.E) : 'custom';
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

    renderSectionInputs();
    updateLoadInputVisibility();
    renderLoadsList();
    updateAiStatusBadge();

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
        $('materialPreset').value = ['200', '69', '28', '11'].includes(curE) ? curE : curE ? 'custom' : '';
      }
      updateSectionBadge();
      if (state.solution) recalculate(true);
    });

    $('deflUnitPills').querySelectorAll('.unit-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        $('deflUnitPills').querySelectorAll('.unit-pill').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.deflUnit = btn.dataset.deflUnit;
        if (state.solution) recalculate(true);
      });
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

    // Theme & Print (synced with Terms & Guide page via localStorage)
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
