/**
* BeamStudio — Multi-Provider AI Model API Service
* Supports user-supplied API keys for:
*  - Google Gemini (direct REST API)
*  - OpenAI (GPT-4o / GPT-4.1 / o3-mini)
*  - Anthropic Claude (direct browser header + optional local proxy)
*  - OpenRouter (unified gateway to Claude, Gemini, DeepSeek, GPT, Llama)
*  - DeepSeek, Groq, and Custom OpenAI-Compatible / Local Ollama endpoints
*/
(function (global) {
  'use strict';

  const BeamStudio = (global.BeamStudio = global.BeamStudio || {});

  const PROVIDERS = {
    gemini: {
      name: 'Google Gemini',
      defaultModel: 'gemini-2.5-flash',
      models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
      placeholderKey: 'AIzaSy...',
      keyHint: 'Get a free/paid key at aistudio.google.com'
    },
    openai: {
      name: 'OpenAI',
      defaultModel: 'gpt-4o',
      models: ['gpt-4o', 'gpt-4.1', 'gpt-4o-mini', 'o3-mini'],
      placeholderKey: 'sk-...',
      keyHint: 'Get an API key at platform.openai.com'
    },
    anthropic: {
      name: 'Anthropic Claude',
      defaultModel: 'claude-sonnet-4-20250514',
      models: ['claude-sonnet-4-20250514', 'claude-3-7-sonnet-latest', 'claude-3-5-haiku-latest'],
      placeholderKey: 'sk-ant-...',
      keyHint: 'Get an API key at console.anthropic.com'
    },
    openrouter: {
      name: 'OpenRouter',
      defaultModel: 'google/gemini-2.5-flash',
      models: [
        'google/gemini-2.5-flash',
        'anthropic/claude-sonnet-4',
        'openai/gpt-4o',
        'deepseek/deepseek-r1'
      ],
      placeholderKey: 'sk-or-v1-...',
      keyHint: 'Access 100+ models with one key at openrouter.ai'
    },
    deepseek: {
      name: 'DeepSeek',
      defaultModel: 'deepseek-chat',
      models: ['deepseek-chat', 'deepseek-reasoner'],
      placeholderKey: 'sk-...',
      keyHint: 'Get an API key at platform.deepseek.com'
    },
    groq: {
      name: 'Groq',
      defaultModel: 'llama-3.3-70b-versatile',
      models: ['llama-3.3-70b-versatile', 'qwen-qwq-32b'],
      placeholderKey: 'gsk_...',
      keyHint: 'Ultra-fast inference key at console.groq.com'
    },
    custom: {
      name: 'Custom / Local (OpenAI-Compatible)',
      defaultModel: 'llama3.2',
      models: ['llama3.2', 'qwen2.5:14b', 'deepseek-r1:8b'],
      placeholderKey: 'optional-key',
      baseUrl: 'http://localhost:11434/v1/chat/completions',
      keyHint: 'Any OpenAI-compatible chat/completions URL (Ollama, LM Studio, vLLM, etc.)'
    }
  };

  const STORAGE_KEY = 'beamstudio_ai_settings_v1';

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          provider: parsed.provider || 'gemini',
          model: parsed.model || PROVIDERS[parsed.provider || 'gemini'].defaultModel,
          apiKey: parsed.apiKey || '',
          customBaseUrl: parsed.customBaseUrl || 'http://localhost:11434/v1/chat/completions',
          persistKey: parsed.persistKey !== false,
          aiMode: parsed.aiMode || 'verified'
        };
      }
    } catch (_) { }
    return {
      provider: 'gemini',
      model: PROVIDERS.gemini.defaultModel,
      apiKey: '',
      customBaseUrl: 'http://localhost:11434/v1/chat/completions',
      persistKey: true,
      aiMode: 'verified'
    };
  }

  function saveSettings(settings) {
    try {
      const toStore = {
        provider: settings.provider,
        model: settings.model,
        apiKey: settings.persistKey ? settings.apiKey : '',
        customBaseUrl: settings.customBaseUrl,
        persistKey: settings.persistKey,
        aiMode: settings.aiMode
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
    } catch (_) { }
  }

  function isLocalServerAvailable() {
    return global.location && (global.location.protocol === 'http:' || global.location.protocol === 'https:') &&
      (global.location.hostname === 'localhost' || global.location.hostname === '127.0.0.1');
  }

  /**
   * Unified LLM completion call across all supported providers
   */
  async function callLLM(settings, systemPrompt, messages) {
    const provider = settings.provider || 'gemini';
    const model = (settings.model || PROVIDERS[provider].defaultModel).trim();
    const apiKey = (settings.apiKey || '').trim();

    if (!apiKey && provider !== 'custom') {
      throw new Error(`Please enter your ${PROVIDERS[provider].name} API key in AI Settings first.`);
    }

    // 1. Google Gemini Native REST API
    if (provider === 'gemini') {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const contents = messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));
      const body = {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 4096
        }
      };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message || `Gemini API error (${res.status})`);
      }
      const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
      if (!text) throw new Error('Gemini returned an empty response.');
      return text;
    }

    // 2. Anthropic Claude Messages API
    if (provider === 'anthropic') {
      const targetUrl = 'https://api.anthropic.com/v1/messages';
      const payload = {
        model,
        max_tokens: 4096,
        temperature: 0.2,
        system: systemPrompt,
        messages: messages.map((m) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content
        }))
      };

      const headers = {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      };

      try {
        const res = await fetch(targetUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error?.message || `Anthropic API error (${res.status})`);
        }
        return data?.content?.map((c) => c.text || '').join('') || '';
      } catch (err) {
        // Fallback via local proxy if launched via Launch_Beam_Studio.bat
        if (isLocalServerAvailable()) {
          const proxyRes = await fetch('/api/ai-proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: targetUrl, headers, payload })
          });
          const data = await proxyRes.json();
          if (!proxyRes.ok) throw new Error(data?.error?.message || `Proxy error (${proxyRes.status})`);
          return data?.content?.map((c) => c.text || '').join('') || '';
        }
        throw err;
      }
    }

    // 3. OpenAI-Compatible Providers (OpenAI, OpenRouter, DeepSeek, Groq, Custom)
    let endpoint = 'https://api.openai.com/v1/chat/completions';
    if (provider === 'openrouter') endpoint = 'https://openrouter.ai/api/v1/chat/completions';
    else if (provider === 'deepseek') endpoint = 'https://api.deepseek.com/chat/completions';
    else if (provider === 'groq') endpoint = 'https://api.groq.com/openai/v1/chat/completions';
    else if (provider === 'custom') endpoint = (settings.customBaseUrl || '').trim();

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    if (provider === 'openrouter') {
      headers['HTTP-Referer'] = global.location.href || 'http://localhost';
      headers['X-Title'] = 'BeamStudio 3D Structural Calculator';
    }

    const fullMessages = [{ role: 'system', content: systemPrompt }, ...messages];
    const body = {
      model,
      messages: fullMessages,
      temperature: 0.2
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error?.message || `${PROVIDERS[provider].name} API error (${res.status})`);
    }
    const text = data?.choices?.[0]?.message?.content || '';
    if (!text) throw new Error(`${PROVIDERS[provider].name} returned an empty response.`);
    return text;
  }

  /**
   * Quick connection check
   */
  async function testConnection(settings) {
    const reply = await callLLM(
      settings,
      'You are a structural engineering calculator verifier. Reply concisely.',
      [{ role: 'user', content: 'Respond with exactly: "Connection verified — ready for Euler-Bernoulli beam analysis."' }]
    );
    return reply.trim();
  }

  /**
   * Generate step-by-step derivation (or independent cross-check) using user's AI model
   */
  async function generateSolution(settings, sol, method, mode = 'verified') {
    const methodNames = {
      double_integration: 'Double Integration Method (Macaulay / Piecewise Integration of EI·y″ = M(x))',
      moment_area: 'Moment-Area Method (M/EI Diagram Decomposition, Centroids, First & Second Moment-Area Theorems)',
      conjugate_beam: 'Conjugate Beam Method (Support Transformation, Elastic Loading w* = M/EI, Conjugate Shear V* = θ and Moment M* = y)',
      compare: 'All Three Methods (Double Integration, Moment-Area, and Conjugate Beam) with Side-by-Side Comparison'
    };

    const methodTitle = methodNames[method] || methodNames.double_integration;
    const includeTruth = mode !== 'independent';
    const brief = BeamStudio.SolutionBuilder.buildEngineeringBrief(sol, includeTruth);

    const systemPrompt =
      'You are a Ph.D. Structural Engineering Professor writing crystal-clear, rigorous, textbook-grade beam deflection solutions. ' +
      'Format all mathematical equations using LaTeX: inline math with $...$ and display equations with $$...$$ on separate lines. ' +
      'Structure your solution with clean Markdown headings (### Step 1: ..., ### Step 2: ...), bullet lists, and clear engineering units (kN, m, kN·m, rad, mm). ' +
      'Never skip algebra steps—show every integral, boundary condition, centroid arm, or conjugate support rule clearly.';

    let userPrompt = '';
    if (mode === 'verified') {
      userPrompt =
        `Produce a complete, step-by-step structural engineering solution using the **${methodTitle}** for the following beam:\n\n` +
        `${brief}\n\n` +
        `Instructions:\n` +
        `1. Show every equilibrium equation, diagram equation, and method-specific step clearly.\n` +
        `2. For Moment-Area, explicitly list each M/EI shape, its area, its centroid distance to the reference point, Theorem 1 (slope change), and Theorem 2 (tangential deviation).\n` +
        `3. For Conjugate Beam, explicitly list the real-to-conjugate support mapping, the elastic load w* = M/EI direction, conjugate equilibrium for reactions, and how V* = θ and M* = y.\n` +
        `4. For Double Integration, show piecewise M(x) (or Macaulay singularity brackets), first integration EI·y'(x), second integration EI·y(x), boundary conditions solving C1 and C2, and final evaluation.\n` +
        `5. Ensure all final numerical answers align with the verified numerical checkpoints provided above, and conclude with a concise Engineering Insight (governing stress/deflection check, e.g., L/360 serviceability comparison).`;
    } else {
      userPrompt =
        `Solve the following beam **independently from scratch** using the **${methodTitle}**.\n\n` +
        `${brief}\n\n` +
        `Derive every reaction, shear/moment equation, slope, and deflection step-by-step from first principles.\n` +
        `At the VERY END of your response, include a machine-readable JSON block wrapped in \`\`\`json ... \`\`\` with your independently computed numbers:\n` +
        `\`\`\`json\n` +
        `{\n` +
        `  "RA_kN": 0.0,\n` +
        `  "RB_kN": 0.0,\n` +
        `  "max_abs_moment_kNm": 0.0,\n` +
        `  "max_abs_deflection_mm": 0.0,\n` +
        `  "max_deflection_x_m": 0.0\n` +
        `}\n` +
        `\`\`\``;
    }

    const rawText = await callLLM(settings, systemPrompt, [{ role: 'user', content: userPrompt }]);

    // If independent verification mode, parse JSON checkpoint and compare against exact engine
    let verification = null;
    if (mode === 'independent') {
      const jsonMatch = rawText.match(/```json\s*([\s\S]*?)```/i);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1]);
          const engineDefl = sol.extrema.deflection.maxAbs_mm;
          const aiDefl = Math.abs(Number(parsed.max_abs_deflection_mm));
          const engineMom = sol.extrema.moment.maxAbsVal;
          const aiMom = Math.abs(Number(parsed.max_abs_moment_kNm));
          const deflErrPct = engineDefl > 1e-9 ? (Math.abs(aiDefl - engineDefl) / engineDefl) * 100 : 0;
          const momErrPct = engineMom > 1e-9 ? (Math.abs(aiMom - engineMom) / engineMom) * 100 : 0;
          verification = {
            parsed,
            engineDefl,
            aiDefl,
            deflErrPct,
            engineMom,
            aiMom,
            momErrPct,
            matched: isFinite(deflErrPct) && deflErrPct < 2.0
          };
        } catch (_) { }
      }
    }

    return {
      markdown: rawText,
      verification,
      provider: PROVIDERS[settings.provider]?.name || settings.provider,
      model: settings.model,
      mode
    };
  }

  /**
   * Interactive AI Structural Engineering Tutor follow-up
   */
  async function askTutor(settings, sol, method, history, question) {
    const brief = BeamStudio.SolutionBuilder.buildEngineeringBrief(sol, true);
    const systemPrompt =
      `You are an interactive Structural Analysis Tutor embedded inside BeamStudio 3D. ` +
      `The user is currently analyzing the following beam using the "${method}" method:\n\n${brief}\n\n` +
      `Answer their question clearly, concisely, and accurately using LaTeX ($...$ and $$...$$) where helpful.`;

    const msgs = [
      ...history.slice(-8),
      { role: 'user', content: question }
    ];
    return callLLM(settings, systemPrompt, msgs);
  }

  BeamStudio.AIService = {
    PROVIDERS,
    loadSettings,
    saveSettings,
    testConnection,
    generateSolution,
    askTutor
  };
})(window);
