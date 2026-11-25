/**
 * BeamStudio — Dynamic Three.js WebGL 3D Structural Beam Visualizer
 * Features:
 *  - Real swept Euler-Bernoulli 3D cross-sections (I-Beam, Rectangular, Circular Tube, T-Beam)
 *    deformed along exact y(x) with true plane-section rotation theta(x)
 *  - 3D Supports (Pin, Roller, Fixed Abutment, Conjugate Internal Hinge)
 *  - 3D Loads (Point, UDL curtain, UVL trapezoid, Applied Moment torus-arrow) & Reactions
 *  - 3D Method Views: Real Deflected Beam | 3D Moment-Area M/EI Ribbon | 3D Conjugate Beam
 *  - Live Stress/Moment/Shear/Deflection Vertex-Color Heatmaps in Starlight/Opaline/Aurora/Wisteria palette
 *  - Synchronized 3D Section-Cut Probe Plane & Smooth Damped Orbit/Pan/Zoom Camera
 *  - Automatic 2.5D Canvas fallback if WebGL/Three.js is unavailable offline
 */
(function (global) {
  'use strict';

  const BeamStudio = (global.BeamStudio = global.BeamStudio || {});

  // Uploaded Palette Hex Constants
  const PALETTE = {
    starlight: 0xf3eef8,
    opaline: 0xcdc4dc,
    aurora: 0x8ea4c4,
    wisteria: 0x6e5a88,
    deepPlum: 0x2a1f3d,
    auroraBright: 0x5c82b8,
    wisteriaDeep: 0x4b3869,
    coralAccent: 0xb95f89 // harmonious mauve-rose derived from Wisteria for downward load vectors
  };

  /**
   * Generate 2D cross-section contour points [(z, y), ...] centered at (0, 0) in scene units
   */
  function getSectionContour(sectionType, depthVis, widthVis) {
    const h = depthVis;
    const w = widthVis;
    if (sectionType === 'rect') {
      return [
        [-w / 2, -h / 2],
        [w / 2, -h / 2],
        [w / 2, h / 2],
        [-w / 2, h / 2]
      ];
    }
    if (sectionType === 'tube') {
      const pts = [];
      const segs = 20;
      const r = h * 0.5;
      for (let i = 0; i < segs; i++) {
        const ang = (i / segs) * Math.PI * 2;
        pts.push([Math.cos(ang) * r, Math.sin(ang) * r]);
      }
      return pts;
    }
    if (sectionType === 'tbeam') {
      const tf = h * 0.22;
      const tw = w * 0.26;
      return [
        [-tw / 2, -h / 2],
        [tw / 2, -h / 2],
        [tw / 2, h / 2 - tf],
        [w / 2, h / 2 - tf],
        [w / 2, h / 2],
        [-w / 2, h / 2],
        [-w / 2, h / 2 - tf],
        [-tw / 2, h / 2 - tf]
      ];
    }
    // Default: crisp architectural I-Beam (Wide Flange W-Section)
    const tf = h * 0.16;
    const tw = w * 0.18;
    return [
      [-w / 2, -h / 2],
      [w / 2, -h / 2],
      [w / 2, -h / 2 + tf],
      [tw / 2, -h / 2 + tf],
      [tw / 2, h / 2 - tf],
      [w / 2, h / 2 - tf],
      [w / 2, h / 2],
      [-w / 2, h / 2],
      [-w / 2, h / 2 - tf],
      [-tw / 2, h / 2 - tf],
      [-tw / 2, -h / 2 + tf],
      [-w / 2, -h / 2 + tf]
    ];
  }

  /**
   * Interpolate color in Starlight / Opaline / Aurora / Wisteria palette for value t in [-1, 1] or [0, 1]
   */
  function sampleHeatmapColor(t, mode, THREE) {
    const cStarlight = new THREE.Color(0xeae2f4);
    const cOpaline = new THREE.Color(0xbdb1d2);
    const cAurora = new THREE.Color(0x5a84be);
    const cWisteria = new THREE.Color(0x6e5a88);
    const cDeepWisteria = new THREE.Color(0x4a2f73);
    const cMauve = new THREE.Color(0xb35d8a);

    if (mode === 'metallic') {
      return cOpaline;
    }
    if (mode === 'deflection') {
      const a = Math.min(1, Math.max(0, Math.abs(t)));
      if (a < 0.5) return cStarlight.clone().lerp(cAurora, a * 2);
      return cAurora.clone().lerp(cDeepWisteria, (a - 0.5) * 2);
    }
    // Signed moment or shear heatmap: negative -> Wisteria/Mauve, zero -> Starlight, positive -> Aurora
    const clamped = Math.max(-1, Math.min(1, t));
    if (clamped >= 0) {
      return cStarlight.clone().lerp(cAurora, Math.pow(clamped, 0.8));
    }
    return cStarlight.clone().lerp(mode === 'moment' ? cMauve : cWisteria, Math.pow(-clamped, 0.8));
  }

  /**
   * Create a crisp floating canvas-texture text sprite for 3D labels
   */
  function createLabelSprite(text, bgHex, textHex, THREE) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 320;
    canvas.height = 84;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Rounded pill
    const r = 24;
    ctx.fillStyle = bgHex || 'rgba(110, 90, 136, 0.92)';
    ctx.beginPath();
    ctx.moveTo(r + 8, 10);
    ctx.lineTo(canvas.width - r - 8, 10);
    ctx.quadraticCurveTo(canvas.width - 8, 10, canvas.width - 8, 10 + r);
    ctx.lineTo(canvas.width - 8, canvas.height - 10 - r);
    ctx.quadraticCurveTo(canvas.width - 8, canvas.height - 10, canvas.width - r - 8, canvas.height - 10);
    ctx.lineTo(r + 8, canvas.height - 10);
    ctx.quadraticCurveTo(8, canvas.height - 10, 8, canvas.height - 10 - r);
    ctx.lineTo(8, 10 + r);
    ctx.quadraticCurveTo(8, 10, r + 8, 10);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(243, 238, 248, 0.55)';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.font = '700 28px "Inter", "Segoe UI", sans-serif';
    ctx.fillStyle = textHex || '#f3eef8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 1);

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.55, 0.41, 1);
    return sprite;
  }

  class Beam3DViewer {
    constructor(container) {
      this.container = container;
      this.solution = null;
      this.colorMode = 'moment'; // 'metallic' | 'moment' | 'shear' | 'deflection'
      this.viewMode = 'real'; // 'real' | 'moment_area' | 'conjugate'
      this.exaggeration = 1.0; // normalized visual multiplier (0 to 2.5)
      this.animateLoad = false;
      this.autoOrbit = false;
      this.darkMode = false;
      this.probeX = null;
      this.animPhase = 0;

      // Spherical orbit camera state
      this.camSpherical = { theta: 0.42, phi: 1.18, radius: 13.5 };
      this.camTargetSpherical = { theta: 0.42, phi: 1.18, radius: 13.5 };
      this.panOffset = { x: 0, y: 0.2 };
      this.targetPan = { x: 0, y: 0.2 };

      this.isDragging = false;
      this.dragButton = 0;
      this.lastMouse = { x: 0, y: 0 };

      this.hasThree = typeof global.THREE !== 'undefined';
      if (this.hasThree) {
        this._initThree();
      } else {
        this._initFallback25D();
      }
    }

    _initThree() {
      const THREE = global.THREE;
      this.scene = new THREE.Scene();

      const w = this.container.clientWidth || 800;
      const h = this.container.clientHeight || 420;
      this.camera = new THREE.PerspectiveCamera(36, w / h, 0.1, 120);

      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      this.renderer.setSize(w, h);
      this.renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer.outputEncoding = THREE.sRGBEncoding;

      this.container.innerHTML = '';
      this.container.appendChild(this.renderer.domElement);
      this.renderer.domElement.style.display = 'block';
      this.renderer.domElement.style.width = '100%';
      this.renderer.domElement.style.height = '100%';

      // Studio Lighting tuned for Starlight / Opaline / Aurora / Wisteria
      this.ambientLight = new THREE.AmbientLight(0xf3eef8, 0.72);
      this.scene.add(this.ambientLight);

      this.hemiLight = new THREE.HemisphereLight(0xf3eef8, 0x6e5a88, 0.55);
      this.hemiLight.position.set(0, 12, 0);
      this.scene.add(this.hemiLight);

      this.keyLight = new THREE.DirectionalLight(0xffffff, 0.92);
      this.keyLight.position.set(8, 14, 10);
      this.keyLight.castShadow = true;
      this.keyLight.shadow.mapSize.width = 1024;
      this.keyLight.shadow.mapSize.height = 1024;
      this.keyLight.shadow.camera.near = 1;
      this.keyLight.shadow.camera.far = 40;
      const d = 10;
      this.keyLight.shadow.camera.left = -d;
      this.keyLight.shadow.camera.right = d;
      this.keyLight.shadow.camera.top = d;
      this.keyLight.shadow.camera.bottom = -d;
      this.keyLight.shadow.bias = -0.0008;
      this.scene.add(this.keyLight);

      this.rimLight = new THREE.DirectionalLight(0x8ea4c4, 0.55);
      this.rimLight.position.set(-10, 6, -8);
      this.scene.add(this.rimLight);

      // Architectural Floor & Subtle Grid
      this.envGroup = new THREE.Group();
      this.scene.add(this.envGroup);
      this._buildEnvironment();

      // Dynamic Beam Assembly Group
      this.beamGroup = new THREE.Group();
      this.scene.add(this.beamGroup);

      // Section Probe Ring Group
      this.probeGroup = new THREE.Group();
      this.scene.add(this.probeGroup);

      this._bindControls();
      this._resizeObserver = new ResizeObserver(() => this.resize());
      this._resizeObserver.observe(this.container);

      this._clock = new THREE.Clock();
      this._animate();
    }

    _buildEnvironment() {
      const THREE = global.THREE;
      while (this.envGroup.children.length) {
        this.envGroup.remove(this.envGroup.children[0]);
      }

      const floorY = -2.2;
      const gridColor1 = this.darkMode ? 0x6e5a88 : 0xcdc4dc;
      const gridColor2 = this.darkMode ? 0x35294a : 0xe3dbe9;
      const grid = new THREE.GridHelper(24, 24, gridColor1, gridColor2);
      grid.position.y = floorY;
      grid.material.opacity = this.darkMode ? 0.42 : 0.65;
      grid.material.transparent = true;
      this.envGroup.add(grid);

      const shadowPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(24, 24),
        new THREE.ShadowMaterial({ opacity: this.darkMode ? 0.35 : 0.14, color: 0x3d2e57 })
      );
      shadowPlane.rotation.x = -Math.PI / 2;
      shadowPlane.position.y = floorY + 0.005;
      shadowPlane.receiveShadow = true;
      this.envGroup.add(shadowPlane);
    }

    _bindControls() {
      const el = this.renderer.domElement;
      el.addEventListener('contextmenu', (e) => e.preventDefault());

      el.addEventListener('pointerdown', (e) => {
        this.isDragging = true;
        this.dragButton = e.button;
        this.lastMouse = { x: e.clientX, y: e.clientY };
        el.setPointerCapture(e.pointerId);
      });

      el.addEventListener('pointermove', (e) => {
        if (!this.isDragging) return;
        const dx = e.clientX - this.lastMouse.x;
        const dy = e.clientY - this.lastMouse.y;
        this.lastMouse = { x: e.clientX, y: e.clientY };

        if (this.dragButton === 2 || e.shiftKey) {
          this.targetPan.x -= dx * 0.012;
          this.targetPan.y += dy * 0.012;
        } else {
          this.camTargetSpherical.theta -= dx * 0.0075;
          this.camTargetSpherical.phi = Math.max(0.22, Math.min(Math.PI - 0.22, this.camTargetSpherical.phi - dy * 0.0075));
        }
      });

      el.addEventListener('pointerup', () => {
        this.isDragging = false;
      });
      el.addEventListener('pointercancel', () => {
        this.isDragging = false;
      });

      el.addEventListener(
        'wheel',
        (e) => {
          e.preventDefault();
          const zoomFactor = 1 + Math.sign(e.deltaY) * 0.09;
          this.camTargetSpherical.radius = Math.max(5.5, Math.min(28, this.camTargetSpherical.radius * zoomFactor));
        },
        { passive: false }
      );
    }

    setCameraPreset(preset) {
      if (preset === 'iso') {
        this.camTargetSpherical = { theta: 0.44, phi: 1.16, radius: 13.5 };
        this.targetPan = { x: 0, y: 0.2 };
      } else if (preset === 'front') {
        this.camTargetSpherical = { theta: 0, phi: Math.PI / 2, radius: 13.2 };
        this.targetPan = { x: 0, y: 0.1 };
      } else if (preset === 'top') {
        this.camTargetSpherical = { theta: 0, phi: 0.25, radius: 14.2 };
        this.targetPan = { x: 0, y: 0 };
      } else if (preset === 'section') {
        this.camTargetSpherical = { theta: Math.PI / 2 - 0.18, phi: 1.38, radius: 10.5 };
        this.targetPan = { x: 0, y: 0.15 };
      }
    }

    setTheme(darkMode) {
      this.darkMode = !!darkMode;
      if (this.hasThree) {
        this._buildEnvironment();
        if (this.solution) this._rebuildScene();
      } else {
        this._drawFallback25D();
      }
    }

    setColorMode(mode) {
      this.colorMode = mode;
      if (this.solution) this._rebuildScene();
    }

    setViewMode(mode) {
      this.viewMode = mode;
      if (this.solution) this._rebuildScene();
    }

    setExaggeration(val) {
      this.exaggeration = Number(val);
      if (this.solution) this._rebuildScene();
    }

    setAnimateLoad(enabled) {
      this.animateLoad = !!enabled;
      if (!enabled && this.solution) {
        this.animPhase = 0;
        this._rebuildScene();
      }
    }

    setAutoOrbit(enabled) {
      this.autoOrbit = !!enabled;
    }

    setProbeX(x) {
      this.probeX = x;
      if (this.hasThree) {
        this._updateProbePlane();
      } else {
        this._drawFallback25D();
      }
    }

    update(solution) {
      this.solution = solution;
      if (this.hasThree) {
        this._rebuildScene();
      } else {
        this._drawFallback25D();
      }
    }

    resize() {
      if (!this.hasThree) {
        this._drawFallback25D();
        return;
      }
      const w = this.container.clientWidth || 800;
      const h = this.container.clientHeight || 420;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    }

    _disposeGroup(group) {
      while (group.children.length) {
        const obj = group.children[0];
        group.remove(obj);
        if (obj.children && obj.children.length) {
          this._disposeGroup(obj);
        }
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((m) => {
            if (m.map) m.map.dispose();
            m.dispose();
          });
        }
      }
    }

    /**
     * Map beam physical coordinate x in [0, L] to 3D scene X in [-spanHalf, +spanHalf]
     */
    _xToScene(x) {
      const L = this.solution ? this.solution.input.L : 6;
      const spanScene = 10.0;
      return (x / L - 0.5) * spanScene;
    }

    _getVisualDeflScale(animFactor = 1.0) {
      if (!this.solution) return 0;
      const maxAbs = this.solution.extrema.deflection.maxAbs;
      if (maxAbs < 1e-12) return 0;
      // Normalize so at exaggeration = 1.0, peak visual deflection is ~1.15 scene units (out of 10-unit span)
      return (1.15 / maxAbs) * this.exaggeration * animFactor;
    }

    _rebuildScene(animFactor = 1.0) {
      if (!this.hasThree || !this.solution) return;
      const THREE = global.THREE;
      this._disposeGroup(this.beamGroup);

      const sol = this.solution;
      const L = sol.input.L;
      const spanScene = 10.0;
      const deflScale = this.viewMode === 'conjugate' ? 0 : this._getVisualDeflScale(animFactor);

      // Visual beam cross-section proportions
      const secType = sol.input.section.type || 'ibeam';
      const depthVis = 0.58;
      const widthVis = secType === 'rect' ? 0.36 : 0.44;
      const contour = getSectionContour(secType, depthVis, widthVis);

      // 1. Ghost Undeformed Reference Beam (for Real & Moment-Area modes)
      if (this.viewMode !== 'conjugate') {
        const ghostGeom = this._buildSweptBeamGeometry(contour, 30, () => 0, () => 0, () => new THREE.Color(PALETTE.opaline));
        const ghostMat = new THREE.MeshBasicMaterial({
          color: this.darkMode ? 0xcdc4dc : 0x8ea4c4,
          wireframe: true,
          transparent: true,
          opacity: this.darkMode ? 0.14 : 0.22
        });
        const ghostMesh = new THREE.Mesh(ghostGeom, ghostMat);
        this.beamGroup.add(ghostMesh);
      }

      // 2. Main Deformed 3D Beam Mesh (swept along exact y(x) & slope theta(x))
      const maxM = Math.max(sol.extrema.moment.maxAbsVal, 1e-9);
      const maxV = Math.max(sol.extrema.shear.maxAbsVal, 1e-9);
      const maxY = Math.max(sol.extrema.deflection.maxAbs, 1e-9);

      const beamGeom = this._buildSweptBeamGeometry(
        contour,
        110,
        (x) => sol.evalAt(x).y * deflScale,
        (x) => {
          // Visual slope matches visual deflection derivative dy_scene / dx_scene
          const theta = sol.evalAt(x).theta;
          const dy_dx_scene = theta * (L / spanScene) * deflScale;
          return Math.atan(dy_dx_scene);
        },
        (x) => {
          const st = sol.evalAt(x);
          if (this.viewMode === 'conjugate') {
            return sampleHeatmapColor(st.M / maxM, 'moment', THREE);
          }
          if (this.colorMode === 'moment') return sampleHeatmapColor(st.M / maxM, 'moment', THREE);
          if (this.colorMode === 'shear') return sampleHeatmapColor(st.V / maxV, 'shear', THREE);
          if (this.colorMode === 'deflection') return sampleHeatmapColor(st.y / maxY, 'deflection', THREE);
          return sampleHeatmapColor(0, 'metallic', THREE);
        }
      );

      const beamMat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.32,
        metalness: 0.28
      });
      const beamMesh = new THREE.Mesh(beamGeom, beamMat);
      beamMesh.castShadow = true;
      beamMesh.receiveShadow = true;
      this.beamGroup.add(beamMesh);

      // 3. Supports (Real or Transformed Conjugate Supports)
      if (this.viewMode === 'conjugate') {
        for (const cs of sol.conjugateBeam.supports) {
          this._addSupport3D(cs.symbol, cs.x, depthVis, cs.id, true);
        }
      } else {
        for (const sup of sol.input.supports) {
          this._addSupport3D(sup.type, sup.x, depthVis, sup.id, false);
        }
      }

      // 4. Loads / Method-Specific 3D Visuals
      if (this.viewMode === 'real') {
        this._addRealLoads3D(sol, depthVis, deflScale, animFactor);
        this._addReactions3D(sol, depthVis);
      } else if (this.viewMode === 'moment_area') {
        this._addMomentArea3D(sol, depthVis, deflScale);
      } else if (this.viewMode === 'conjugate') {
        this._addConjugateLoad3D(sol, depthVis);
      }

      // 5. Span Dimension Axis underneath
      this._addDimensionAxis3D(L);

      // 6. Refresh Section Cut Probe Plane
      this._updateProbePlane(animFactor);
    }

    /**
     * Sweeps a 2D cross-section contour along x in [0, L] with exact y(x), slope angle, and vertex colors
     */
    _buildSweptBeamGeometry(contour, steps, yFn, angleFn, colorFn) {
      const THREE = global.THREE;
      const L = this.solution.input.L;
      const m = contour.length;
      const positions = [];
      const colors = [];
      const indices = [];

      // Ring vertices
      for (let i = 0; i <= steps; i++) {
        const frac = i / steps;
        const xPhys = frac * L;
        const xSc = this._xToScene(xPhys);
        const ySc = yFn(xPhys);
        const ang = angleFn(xPhys);
        const cosA = Math.cos(ang);
        const sinA = Math.sin(ang);
        const col = colorFn(xPhys);

        for (let j = 0; j < m; j++) {
          const cz = contour[j][0];
          const cy = contour[j][1];
          // Rotate local (0, cy) by slope angle around Z axis so plane sections remain perpendicular to elastic curve
          const rx = xSc - cy * sinA;
          const ry = ySc + cy * cosA;
          positions.push(rx, ry, cz);
          colors.push(col.r, col.g, col.b);
        }
      }

      // Side quads
      for (let i = 0; i < steps; i++) {
        const ring0 = i * m;
        const ring1 = (i + 1) * m;
        for (let j = 0; j < m; j++) {
          const jNext = (j + 1) % m;
          const a = ring0 + j;
          const b = ring1 + j;
          const c = ring1 + jNext;
          const d = ring0 + jNext;
          indices.push(a, b, c, a, c, d);
        }
      }

      // End caps (simple fan around ring centroid)
      const addCap = (ringIdx, reverse) => {
        const baseIdx = positions.length / 3;
        const frac = ringIdx / steps;
        const xPhys = frac * L;
        const xSc = this._xToScene(xPhys);
        const ySc = yFn(xPhys);
        const col = colorFn(xPhys);
        positions.push(xSc, ySc, 0);
        colors.push(col.r, col.g, col.b);
        const ringStart = ringIdx * m;
        for (let j = 0; j < m; j++) {
          const jNext = (j + 1) % m;
          if (reverse) indices.push(baseIdx, ringStart + jNext, ringStart + j);
          else indices.push(baseIdx, ringStart + j, ringStart + jNext);
        }
      };
      addCap(0, true);
      addCap(steps, false);

      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geom.setIndex(indices);
      geom.computeVertexNormals();
      return geom;
    }

    _addSupport3D(type, xPhys, depthVis, label, isConjugate) {
      const THREE = global.THREE;
      const xSc = this._xToScene(xPhys);
      const bottomY = -depthVis * 0.5;
      const supColor = isConjugate ? 0x5a84be : 0x6e5a88;
      const metalMat = new THREE.MeshStandardMaterial({ color: supColor, roughness: 0.38, metalness: 0.45 });
      const plateMat = new THREE.MeshStandardMaterial({ color: 0x3f3156, roughness: 0.5, metalness: 0.35 });
      const pinMat = new THREE.MeshStandardMaterial({ color: 0xf3eef8, roughness: 0.25, metalness: 0.7 });

      if (type === 'free') {
        // Label free end cleanly in conjugate view
        if (isConjugate) {
          const sp = createLabelSprite(`${label} Free`, 'rgba(142,164,196,0.9)', '#1e162e', THREE);
          sp.position.set(xSc, -depthVis - 0.45, 0);
          this.beamGroup.add(sp);
        }
        return;
      }

      if (type === 'hinge') {
        // Internal hinge sphere for conjugate overhanging support
        const sphere = new THREE.Mesh(
          new THREE.SphereGeometry(0.24, 20, 20),
          new THREE.MeshStandardMaterial({ color: 0xf3eef8, emissive: 0x8ea4c4, emissiveIntensity: 0.45, roughness: 0.2, metalness: 0.5 })
        );
        sphere.position.set(xSc, 0, 0);
        this.beamGroup.add(sphere);
        const sp = createLabelSprite(`${label} Hinge`, 'rgba(110,90,136,0.94)', '#f3eef8', THREE);
        sp.position.set(xSc, -depthVis - 0.55, 0);
        this.beamGroup.add(sp);
        return;
      }

      if (type === 'fixed') {
        const isRight = xPhys > this.solution.input.L * 0.5;
        const wallW = 0.65;
        const wallX = isRight ? xSc + wallW / 2 : xSc - wallW / 2;
        const wall = new THREE.Mesh(new THREE.BoxGeometry(wallW, 2.2, 1.4), plateMat);
        wall.position.set(wallX, -0.1, 0);
        wall.castShadow = true;
        wall.receiveShadow = true;
        this.beamGroup.add(wall);

        // Mounting flange collar
        const flange = new THREE.Mesh(new THREE.BoxGeometry(0.12, depthVis * 1.6, 0.85), metalMat);
        flange.position.set(isRight ? xSc + 0.04 : xSc - 0.04, 0, 0);
        this.beamGroup.add(flange);

        const sp = createLabelSprite(`${label} Fixed`, 'rgba(110,90,136,0.92)', '#f3eef8', THREE);
        sp.position.set(wallX, -1.55, 0);
        this.beamGroup.add(sp);
        return;
      }

      // Pin or Roller triangular saddle
      const triShape = new THREE.Shape();
      triShape.moveTo(0, 0);
      triShape.lineTo(-0.36, -0.62);
      triShape.lineTo(0.36, -0.62);
      triShape.closePath();
      const triGeom = new THREE.ExtrudeGeometry(triShape, { depth: 0.48, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02 });
      triGeom.translate(0, 0, -0.24);
      const triMesh = new THREE.Mesh(triGeom, metalMat);
      triMesh.position.set(xSc, bottomY, 0);
      triMesh.castShadow = true;
      this.beamGroup.add(triMesh);

      // Hinge pin cylinder
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.62, 16), pinMat);
      cyl.rotation.x = Math.PI / 2;
      cyl.position.set(xSc, bottomY - 0.06, 0);
      this.beamGroup.add(cyl);

      if (type === 'roller') {
        for (const offset of [-0.2, 0, 0.2]) {
          const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.56, 16), pinMat);
          wheel.rotation.x = Math.PI / 2;
          wheel.position.set(xSc + offset, bottomY - 0.72, 0);
          this.beamGroup.add(wheel);
        }
        const base = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.1, 0.72), plateMat);
        base.position.set(xSc, bottomY - 0.86, 0);
        this.beamGroup.add(base);
      } else {
        const base = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.14, 0.72), plateMat);
        base.position.set(xSc, bottomY - 0.70, 0);
        this.beamGroup.add(base);
      }

      const sp = createLabelSprite(`${label} (${type === 'pin' ? 'Pin' : 'Roller'})`, 'rgba(110,90,136,0.9)', '#f3eef8', THREE);
      sp.position.set(xSc, bottomY - 1.28, 0);
      this.beamGroup.add(sp);
    }

    _addArrow3D(xSc, yTip, length, dirY, colorHex) {
      const THREE = global.THREE;
      const mat = new THREE.MeshStandardMaterial({
        color: colorHex,
        emissive: colorHex,
        emissiveIntensity: 0.18,
        roughness: 0.3,
        metalness: 0.2
      });
      const headLen = Math.min(0.28, length * 0.35);
      const shaftLen = Math.max(0.1, length - headLen);

      const group = new THREE.Group();
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.1, headLen, 14), mat);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, shaftLen, 12), mat);

      if (dirY < 0) {
        // Pointing downward: tip at yTip, shaft above
        cone.rotation.x = Math.PI;
        cone.position.set(0, headLen / 2, 0);
        shaft.position.set(0, headLen + shaftLen / 2, 0);
      } else {
        // Pointing upward: tip at yTip, shaft below
        cone.position.set(0, -headLen / 2, 0);
        shaft.position.set(0, -(headLen + shaftLen / 2), 0);
      }
      group.add(cone, shaft);
      group.position.set(xSc, yTip, 0);
      this.beamGroup.add(group);
    }

    _addRealLoads3D(sol, depthVis, deflScale, animFactor) {
      const THREE = global.THREE;
      const U = sol.units || { length: 'm', force: 'kN', dist: 'kN/m', moment: 'kN·m' };
      const loadColor = PALETTE.coralAccent;
      const momentColor = PALETTE.wisteria;

      // Find max distributed load intensity for clean visual height scaling
      let maxW = 1;
      for (const ld of sol.input.loads) {
        if (ld.type === 'UDL') maxW = Math.max(maxW, Math.abs(ld.w));
        if (ld.type === 'UVL') maxW = Math.max(maxW, Math.abs(ld.w1), Math.abs(ld.w2));
      }

      for (const ld of sol.input.loads) {
        if (ld.type === 'Point') {
          const xSc = this._xToScene(ld.a);
          const yBeam = sol.evalAt(ld.a).y * deflScale;
          const dirDown = ld.P >= 0;
          const yTip = dirDown ? yBeam + depthVis * 0.54 : yBeam - depthVis * 0.54;
          const len = 1.45 * (0.4 + 0.6 * animFactor);
          this._addArrow3D(xSc, yTip, len, dirDown ? -1 : 1, loadColor);

          const sp = createLabelSprite(`${ld.P} ${U.force}`, 'rgba(185, 95, 137, 0.94)', '#f3eef8', THREE);
          sp.position.set(xSc, dirDown ? yTip + len + 0.34 : yTip - len - 0.34, 0);
          this.beamGroup.add(sp);
        } else if (ld.type === 'UDL' || ld.type === 'UVL') {
          const a = ld.a;
          const b = ld.b;
          const w1 = ld.type === 'UDL' ? ld.w : ld.w1;
          const w2 = ld.type === 'UDL' ? ld.w : ld.w2;
          const count = Math.max(5, Math.min(18, Math.round(((b - a) / sol.input.L) * 20)));

          const topPts = [];
          const ribbonPos = [];
          const ribbonIdx = [];

          for (let i = 0; i <= count; i++) {
            const t = i / count;
            const xPhys = a + (b - a) * t;
            const xSc = this._xToScene(xPhys);
            const yBeam = sol.evalAt(xPhys).y * deflScale;
            const wCur = w1 + (w2 - w1) * t;
            const hVis = (Math.abs(wCur) / maxW) * 1.15 * (0.4 + 0.6 * animFactor);
            const dirDown = wCur >= 0;
            const yBase = dirDown ? yBeam + depthVis * 0.52 : yBeam - depthVis * 0.52;
            const yTop = dirDown ? yBase + Math.max(0.12, hVis) : yBase - Math.max(0.12, hVis);

            if (Math.abs(wCur) > 1e-6) {
              this._addArrow3D(xSc, yBase, Math.max(0.32, hVis), dirDown ? -1 : 1, loadColor);
            }
            topPts.push(new THREE.Vector3(xSc, yTop, 0));

            ribbonPos.push(xSc, yBase, 0, xSc, yTop, 0);
            if (i < count) {
              const p = i * 2;
              ribbonIdx.push(p, p + 1, p + 2, p + 1, p + 3, p + 2);
            }
          }

          // Top profile bar
          const curve = new THREE.CatmullRomCurve3(topPts);
          const bar = new THREE.Mesh(
            new THREE.TubeGeometry(curve, 24, 0.032, 8, false),
            new THREE.MeshStandardMaterial({ color: loadColor, roughness: 0.3 })
          );
          this.beamGroup.add(bar);

          // Translucent load curtain
          const ribGeom = new THREE.BufferGeometry();
          ribGeom.setAttribute('position', new THREE.Float32BufferAttribute(ribbonPos, 3));
          ribGeom.setIndex(ribbonIdx);
          ribGeom.computeVertexNormals();
          const ribMat = new THREE.MeshBasicMaterial({
            color: loadColor,
            transparent: true,
            opacity: 0.18,
            side: THREE.DoubleSide
          });
          this.beamGroup.add(new THREE.Mesh(ribGeom, ribMat));

          const midX = 0.5 * (a + b);
          const midY = sol.evalAt(midX).y * deflScale + depthVis * 0.52 + 1.48;
          const lbl = ld.type === 'UDL' ? `${ld.w} ${U.dist}` : `${ld.w1}→${ld.w2} ${U.dist}`;
          const sp = createLabelSprite(lbl, 'rgba(185, 95, 137, 0.92)', '#f3eef8', THREE);
          sp.position.set(this._xToScene(midX), midY, 0);
          this.beamGroup.add(sp);
        } else if (ld.type === 'Moment') {
          const xSc = this._xToScene(ld.a);
          const yBeam = sol.evalAt(ld.a).y * deflScale;
          const arcGeom = new THREE.TorusGeometry(0.58, 0.045, 12, 28, Math.PI * 1.45);
          const arcMat = new THREE.MeshStandardMaterial({
            color: momentColor,
            emissive: momentColor,
            emissiveIntensity: 0.25,
            roughness: 0.25
          });
          const arc = new THREE.Mesh(arcGeom, arcMat);
          arc.position.set(xSc, yBeam, 0);
          arc.rotation.z = ld.M >= 0 ? -0.35 : Math.PI - 0.35;
          this.beamGroup.add(arc);

          // Cone tip on moment arc
          const tipAngle = (ld.M >= 0 ? -0.35 : Math.PI - 0.35) + Math.PI * 1.45;
          const cone = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.24, 12), arcMat);
          cone.position.set(xSc + Math.cos(tipAngle) * 0.58, yBeam + Math.sin(tipAngle) * 0.58, 0);
          cone.rotation.z = tipAngle;
          this.beamGroup.add(cone);

          const sp = createLabelSprite(`${ld.M} ${U.moment} ${ld.M >= 0 ? '↺' : '↻'}`, 'rgba(110,90,136,0.95)', '#f3eef8', THREE);
          sp.position.set(xSc, yBeam + 1.1, 0);
          this.beamGroup.add(sp);
        }
      }
    }

    _addReactions3D(sol, depthVis) {
      const THREE = global.THREE;
      const rColor = PALETTE.auroraBright;
      for (const sup of sol.input.supports) {
        const R = sup.id === 'A' ? sol.reactions.RA : sol.reactions.RB;
        if (Math.abs(R) > 1e-4) {
          const xSc = this._xToScene(sup.x);
          const dirUp = R >= 0;
          this._addArrow3D(xSc, -depthVis * 0.5 - 0.92, 0.72, dirUp ? 1 : -1, rColor);
        }
      }
    }

    /**
     * 3D Moment-Area Overlay: floating 3D M/EI curvature ribbon + centroid spheres + reference tangent line!
     */
    _addMomentArea3D(sol, depthVis, deflScale) {
      const THREE = global.THREE;
      const maxK = Math.max(...sol.arrays.curvature.map((v) => Math.abs(v)), 1e-12);
      const ribbonHeight = 1.65;
      const yOffset = depthVis * 0.65;

      // Build 3D curvature curtain
      const pos = [];
      const col = [];
      const idx = [];
      const cPos = new THREE.Color(0x5a84be);
      const cNeg = new THREE.Color(0xb35d8a);

      const n = sol.arrays.x.length;
      for (let i = 0; i < n; i++) {
        const xSc = this._xToScene(sol.arrays.x[i]);
        const kNorm = sol.arrays.curvature[i] / maxK;
        const h = kNorm * ribbonHeight;
        const c = kNorm >= 0 ? cPos : cNeg;

        pos.push(xSc, yOffset, 0, xSc, yOffset + h, 0);
        col.push(c.r, c.g, c.b, c.r, c.g, c.b);
        if (i < n - 1) {
          const p = i * 2;
          idx.push(p, p + 1, p + 2, p + 1, p + 3, p + 2);
        }
      }
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geom.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      geom.setIndex(idx);
      const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.45, side: THREE.DoubleSide });
      this.beamGroup.add(new THREE.Mesh(geom, mat));

      // Centroid Markers for each Moment-Area Region
      const lenU = sol.units ? sol.units.length : 'm';
      for (const reg of sol.momentArea.regions) {
        if (Math.abs(reg.area) < 1e-12) continue;
        const cx = this._xToScene(reg.xBar);
        const kAtBar = sol.evalAt(reg.xBar).curvature / maxK;
        const cy = yOffset + kAtBar * ribbonHeight * 0.55;
        const dot = new THREE.Mesh(
          new THREE.SphereGeometry(0.11, 14, 14),
          new THREE.MeshStandardMaterial({ color: 0xf3eef8, emissive: 0x6e5a88, emissiveIntensity: 0.5 })
        );
        dot.position.set(cx, cy, 0.08);
        this.beamGroup.add(dot);

        const sp = createLabelSprite(`${reg.id} (x̄=${reg.xBar.toFixed(2)}${lenU})`, 'rgba(110,90,136,0.92)', '#f3eef8', THREE);
        sp.position.set(cx, cy + (kAtBar >= 0 ? 0.52 : -0.52), 0.15);
        this.beamGroup.add(sp);
      }

      // Reference Tangent Line on the Elastic Curve
      const { refX, thetaRef, yRef } = sol.momentArea;
      const tPts = [0, sol.input.L].map((x) => {
        const yTan = (yRef + thetaRef * (x - refX)) * deflScale;
        return new THREE.Vector3(this._xToScene(x), yTan, 0.35);
      });
      const tanGeom = new THREE.BufferGeometry().setFromPoints(tPts);
      const tanLine = new THREE.Line(
        tanGeom,
        new THREE.LineDashedMaterial({ color: 0x6e5a88, dashSize: 0.25, gapSize: 0.15 })
      );
      tanLine.computeLineDistances();
      this.beamGroup.add(tanLine);
    }

    /**
     * 3D Conjugate Beam View: draws distributed elastic load w*(x) = M(x)/EI arrows along the conjugate beam
     */
    _addConjugateLoad3D(sol, depthVis) {
      const THREE = global.THREE;
      const maxK = Math.max(...sol.arrays.curvature.map((v) => Math.abs(v)), 1e-12);
      const count = 24;
      const L = sol.input.L;

      for (let i = 0; i <= count; i++) {
        const xPhys = (L * i) / count;
        const k = sol.evalAt(xPhys).curvature;
        const norm = k / maxK;
        if (Math.abs(norm) < 0.04) continue;

        const xSc = this._xToScene(xPhys);
        const len = Math.max(0.25, Math.abs(norm) * 1.45);
        // Positive M/EI acts UPWARD on conjugate beam (pushes from below), negative acts DOWNWARD (pushes from above)
        if (norm > 0) {
          this._addArrow3D(xSc, -depthVis * 0.52, len, 1, 0x5a84be);
        } else {
          this._addArrow3D(xSc, depthVis * 0.52, len, -1, 0xb35d8a);
        }
      }

      const sp = createLabelSprite('Conjugate Elastic Load w*(x) = M(x)/EI', 'rgba(90,132,190,0.94)', '#f3eef8', THREE);
      sp.position.set(0, 2.05, 0);
      sp.scale.set(2.9, 0.44, 1);
      this.beamGroup.add(sp);
    }

    _addDimensionAxis3D(L) {
      const THREE = global.THREE;
      const lenU = this.solution && this.solution.units ? this.solution.units.length : 'm';
      const yAxis = -2.1;
      const pts = [new THREE.Vector3(-5, yAxis, 0.9), new THREE.Vector3(5, yAxis, 0.9)];
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: this.darkMode ? 0xcdc4dc : 0x6e5a88, transparent: true, opacity: 0.55 })
      );
      this.beamGroup.add(line);

      const sp = createLabelSprite(`L = ${L} ${lenU}`, 'rgba(110,90,136,0.85)', '#f3eef8', THREE);
      sp.position.set(0, yAxis + 0.05, 1.3);
      sp.scale.set(1.2, 0.34, 1);
      this.beamGroup.add(sp);
    }

    _updateProbePlane(animFactor = 1.0) {
      if (!this.hasThree) return;
      const THREE = global.THREE;
      this._disposeGroup(this.probeGroup);
      if (this.probeX === null || !this.solution) return;

      const xSc = this._xToScene(this.probeX);
      const deflScale = this.viewMode === 'conjugate' ? 0 : this._getVisualDeflScale(animFactor);
      const ySc = this.solution.evalAt(this.probeX).y * deflScale;

      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.55, 0.028, 12, 32),
        new THREE.MeshBasicMaterial({ color: 0x6e5a88, transparent: true, opacity: 0.9 })
      );
      ring.rotation.y = Math.PI / 2;
      ring.position.set(xSc, ySc, 0);
      this.probeGroup.add(ring);

      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(1.4, 1.4),
        new THREE.MeshBasicMaterial({ color: 0x8ea4c4, transparent: true, opacity: 0.16, side: THREE.DoubleSide })
      );
      plane.rotation.y = Math.PI / 2;
      plane.position.set(xSc, ySc, 0);
      this.probeGroup.add(plane);
    }

    _animate() {
      requestAnimationFrame(() => this._animate());
      const dt = Math.min(this._clock.getDelta(), 0.05);

      if (this.autoOrbit && !this.isDragging) {
        this.camTargetSpherical.theta += dt * 0.28;
      }

      // Smooth camera damping
      const lerp = 1 - Math.exp(-9 * dt);
      this.camSpherical.theta += (this.camTargetSpherical.theta - this.camSpherical.theta) * lerp;
      this.camSpherical.phi += (this.camTargetSpherical.phi - this.camSpherical.phi) * lerp;
      this.camSpherical.radius += (this.camTargetSpherical.radius - this.camSpherical.radius) * lerp;
      this.panOffset.x += (this.targetPan.x - this.panOffset.x) * lerp;
      this.panOffset.y += (this.targetPan.y - this.panOffset.y) * lerp;

      const { theta, phi, radius } = this.camSpherical;
      this.camera.position.set(
        this.panOffset.x + radius * Math.sin(phi) * Math.sin(theta),
        this.panOffset.y + radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.cos(theta)
      );
      this.camera.lookAt(this.panOffset.x, this.panOffset.y, 0);

      // Optional dynamic load-flex animation
      if (this.animateLoad && this.solution) {
        this.animPhase += dt * 1.9;
        const factor = 0.5 - 0.5 * Math.cos(this.animPhase); // smooth 0 -> 1 -> 0 breathing cycle
        this._rebuildScene(factor);
      }

      this.renderer.render(this.scene, this.camera);
    }

    // Graceful 2.5D Isometric Canvas Fallback if Three.js CDN cannot load offline
    _initFallback25D() {
      this.fallbackCanvas = document.createElement('canvas');
      this.fallbackCanvas.style.width = '100%';
      this.fallbackCanvas.style.height = '100%';
      this.container.innerHTML = '';
      this.container.appendChild(this.fallbackCanvas);
      this._drawFallback25D();
    }

    _drawFallback25D() {
      if (!this.fallbackCanvas || !this.solution) return;
      const dpr = global.devicePixelRatio || 1;
      const w = this.container.clientWidth || 700;
      const h = this.container.clientHeight || 380;
      this.fallbackCanvas.width = w * dpr;
      this.fallbackCanvas.height = h * dpr;
      const ctx = this.fallbackCanvas.getContext('2d');
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      const sol = this.solution;
      const padX = 70;
      const span = w - padX * 2;
      const midY = h * 0.52;
      const maxY = Math.max(sol.extrema.deflection.maxAbs, 1e-12);
      const scaleY = (60 / maxY) * this.exaggeration;

      // Draw extruded 2.5D depth shadow
      ctx.save();
      ctx.strokeStyle = 'rgba(110, 90, 136, 0.25)';
      ctx.lineWidth = 20;
      ctx.lineCap = 'round';
      ctx.beginPath();
      sol.arrays.x.forEach((x, i) => {
        const px = padX + (x / sol.input.L) * span + 10;
        const py = midY - sol.arrays.y[i] * scaleY + 10;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();

      // Main 2.5D beam
      const grad = ctx.createLinearGradient(padX, 0, w - padX, 0);
      grad.addColorStop(0, '#6e5a88');
      grad.addColorStop(0.5, '#8ea4c4');
      grad.addColorStop(1, '#6e5a88');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 18;
      ctx.beginPath();
      sol.arrays.x.forEach((x, i) => {
        const px = padX + (x / sol.input.L) * span;
        const py = midY - sol.arrays.y[i] * scaleY;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.restore();
    }
  }

  BeamStudio.Viewer3D = Beam3DViewer;
})(window);
