# BeamStudio 3D — Interactive Beam Deflection, Shear & Moment Calculator

A dynamic 3D structural analysis web application for computing beam deflection, slope, shear force diagrams (SFD), and bending moment diagrams (BMD) using **three classical structural engineering methods**:

1. **Double Integration Method** ($EI\,y''(x) = M(x)$)
2. **Moment-Area Method** (partitioned $M/EI$ bending areas, centroids $\bar{x}_i$, and tangential deviations $t$)
3. **Conjugate Beam Method** (real-to-conjugate support transformation, elastic load $w^* = M/EI$, $V^* = \theta$, $M^* = y$)

## Key Features
- **Dynamic 3D WebGL Visualizer (Three.js)**: Real swept 3D cross-sections (I-Beam, Rectangular, Circular/Hollow Tube, T-Beam) deformed along the exact elastic curve with Bending Moment, Deflection, Shear, and Opaline color maps, plus 3D Moment-Area and 3D Conjugate Beam modes.
- **6 Support Conditions**: Simply Supported, Cantilever (Fixed Left & Fixed Right), Overhanging (custom pin/roller positions), Propped Cantilever, and Fixed-Fixed.
- **4 Load Types**: Point Load, Uniformly Distributed Load (UDL), Uniformly Varying Load (UVL), and Applied Concentrated Moment.
- **Flexible Units & Symbolic Mode**: Choose deflection units in `mm`, `cm`, or `m`; enter custom $I$ in `m⁴`, `cm⁴`, `×10⁶ mm⁴`, `mm⁴`, or `in⁴`; or enable **Treat EI as Constant** to express slopes and deflections symbolically in `/EI`.
- **Interactive Diagrams & Step-by-Step Solutions**: Synchronized section-cut inspector across 3D and 2D diagrams, plus KaTeX step-by-step derivations and a 3-method convergence comparison.
- **Built-in Terms & Visual Guide**: Dedicated beginner-friendly guide (`glossary.html`) explaining every support symbol, load arrow, chart, and engineering term.
- **Multi-Provider AI Model Integration (Bring Your Own API Key)**: Connect Google Gemini, OpenAI, Anthropic Claude, OpenRouter, DeepSeek, Groq, or local Ollama for AI-generated derivations, independent cross-check verification, and an interactive Structural Tutor.

## How to Run Locally
- **Option 1 (Instant)**: Double-click `index.html` to open directly in Chrome, Edge, or Firefox (zero build step, zero dependencies).
- **Option 2 (Local Server)**: Double-click `Launch_Beam_Studio.bat` on Windows to start a zero-dependency local server at `http://localhost:8080`.
- **GitHub Pages**: Because `index.html` is at the repository root, you can publish the site live via **Settings → Pages → Deploy from branch (`main` / root)**.
