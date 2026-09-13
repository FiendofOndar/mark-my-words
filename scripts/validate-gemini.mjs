/**
 * Prove the Gemini path works before trusting anything built on it.
 *
 * Everything in src/verification is covered by tests against injected fakes.
 * This is the only thing that makes a real call, and it checks the assumptions
 * that tests cannot: that the model id exists, that the grounding tool is named
 * what we think, what the grounded response actually carries (model version,
 * grounding metadata, search queries), and that the cited links go somewhere.
 * It saves the full raw grounded response beside itself as
 * gemini-raw-response.json, which is the fastest way to see the API's real
 * shape without an APK build.
 *
 *   GEMINI_API_KEY=... node scripts/validate-gemini.mjs [model]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const key = process.env.GEMINI_API_KEY;
if (!key) {
  console.error('Set GEMINI_API_KEY first. Get one free at https://aistudio.google.com/apikey');
  process.exit(1);
}

const MODEL = process.argv[2] ?? 'gemini-flash-latest';
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

let failures = 0;
const ok = (m) => console.log(`  ok    ${m}`);
const bad = (m) => {
  failures += 1;
  console.log(`  FAIL  ${m}`);
};

async function post(body) {
  const response = await fetch(`${BASE}/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, text };
}

function firstText(raw) {
  const json = JSON.parse(raw);
  if (json.promptFeedback?.blockReason) throw new Error(`refused: ${json.promptFeedback.blockReason}`);
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  return {
    text: parts.map((p) => p.text ?? '').join(''),
    finish: json.candidates?.[0]?.finishReason,
    tokens: json.usageMetadata?.totalTokenCount,
  };
}

function extractJson(text) {
  const fenced = text.trim().match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const body = fenced?.[1] ?? text.trim();
  try {
    return JSON.parse(body);
  } catch {
    return JSON.parse(body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1));
  }
}

console.log(`\nModel: ${MODEL}\n`);

// 0. What this key can actually reach. Model names get retired per account, so
// a 404 here is about the id, not the key.
console.log('0. Models available to this key');
{
  const response = await fetch(`${BASE}/models?pageSize=1000`, {
    headers: { 'x-goog-api-key': key },
  });
  if (!response.ok) {
    bad(`could not list models: HTTP ${response.status} ${(await response.text()).slice(0, 200)}`);
  } else {
    const { models = [] } = await response.json();
    const usable = models
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''));
    ok(`${usable.length} usable`);
    for (const id of usable.filter((m) => m.includes('flash')).slice(0, 8)) {
      console.log(`        ${id}${id === MODEL ? '   <- using this' : ''}`);
    }
    if (!usable.includes(MODEL)) {
      bad(`"${MODEL}" is not among them. Re-run with one of the ids above.`);
      process.exit(1);
    }
  }
}

// 1. The model exists and answers at all.
console.log('\n1. Reachability');
{
  const { status, text } = await post({
    contents: [{ role: 'user', parts: [{ text: 'Reply with the single word: ready' }] }],
    generationConfig: { maxOutputTokens: 16, temperature: 0 },
  });
  if (status === 200) ok(`${MODEL} answered`);
  else {
    bad(`HTTP ${status}: ${text.slice(0, 300)}`);
    if (status === 404) console.log('        The model id is wrong. Pick one from the list above.');
    process.exit(1);
  }
}

// 2. Structured output, the intake path.
console.log('\n2. Intake (structured output)');
{
  const schema = JSON.parse(
    readFileSync(new URL('./structure-schema.json', import.meta.url), 'utf8'),
  );
  const { status, text } = await post({
    systemInstruction: {
      parts: [
        {
          text: 'Turn the statement into a structured, checkable prediction record. Criteria must be things a search could confirm. Return only JSON.',
        },
      ],
    },
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: 'Today is 2026-09-12.\n\nStatement:\n"""Mark my words, the Cardinals will win the World Series this year."""',
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      responseSchema: schema,
    },
  });

  if (status !== 200) bad(`HTTP ${status}: ${text.slice(0, 300)}`);
  else {
    const { text: body, tokens } = firstText(text);
    try {
      const parsed = extractJson(body);
      ok(`returned JSON (${tokens} tokens)`);
      if (parsed.resolution_date) ok(`resolved a deadline: ${parsed.resolution_date}`);
      else bad('no deadline came back');
      if (Array.isArray(parsed.criteria_elements) && parsed.criteria_elements.length > 0) {
        ok(`${parsed.criteria_elements.length} criteria: ${parsed.criteria_elements[0]}`);
      } else bad('no criteria came back');
      if (Array.isArray(parsed.ambiguities) && parsed.ambiguities.length > 0) {
        ok(`flagged ambiguity: ${parsed.ambiguities[0]}`);
      } else {
        console.log('  note  no ambiguity flagged. "The Cardinals" is two teams, so the prompt may need sharpening.');
      }
    } catch (err) {
      bad(`unparseable: ${err.message}`);
      console.log(body.slice(0, 400));
    }
  }
}

// 3. Grounded search, the verification path. This is the one most likely to break.
console.log('\n3. Verification (Google Search grounding)');
{
  const { status, text } = await post({
    systemInstruction: {
      parts: [
        {
          text: 'Search the web, then return only a JSON object: {"verdict":"hit|miss|no_change","summary":string,"sources":[{"url":string,"publisher":string,"published_at":string,"quoted_text":string,"tier":"primary|major_outlet|secondary|social"}],"model_confidence":number}. quoted_text must be copied verbatim from the page.',
        },
      ],
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: 'Has SpaceX Starship reached orbit? Cite sources with verbatim quotes.' }],
      },
    ],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.1 },
  });

  if (status !== 200) {
    bad(`HTTP ${status}: ${text.slice(0, 400)}`);
    console.log('        If this complains about the tool, the grounding field name has changed.');
    console.log('        Fix it in src/verification/GeminiVerifier.ts (currently `google_search`).');
  } else {
    ok('grounded call accepted (tool name `google_search` is right)');
    const { text: body, tokens } = firstText(text);

    // 3a. What the response actually carries. On the phone, every real check
    // has come back with no groundingMetadata at all, on answers whose
    // citations carried readings the model could only have searched for.
    // This prints the shape and saves the whole response next to the script,
    // because the billing unit (per prompt or per search query) depends on
    // the model version, and the search count depends on where the API puts
    // it, and neither can be seen from a phone screenshot.
    const raw = JSON.parse(text);
    const candidate = raw.candidates?.[0] ?? {};
    console.log(`  info  modelVersion: ${raw.modelVersion ?? 'not reported'}`);
    console.log(`  info  response keys: ${Object.keys(raw).join(', ')}`);
    console.log(`  info  candidate keys: ${Object.keys(candidate).join(', ')}`);
    const parts = candidate.content?.parts ?? [];
    console.log(
      `  info  parts: ${parts
        .map((p) => Object.keys(p).map((k) => (k === 'text' ? `text(${p.text.length})` : k)).join('+'))
        .join(', ')}`,
    );
    if (candidate.groundingMetadata) {
      const gm = candidate.groundingMetadata;
      ok(`groundingMetadata present: keys ${Object.keys(gm).join(', ')}`);
      if (Array.isArray(gm.webSearchQueries)) ok(`${gm.webSearchQueries.length} webSearchQueries: ${gm.webSearchQueries.join(' | ')}`);
      else bad('groundingMetadata has no webSearchQueries; the app cannot count searches from it');
    } else {
      bad('groundingMetadata absent from the candidate; the app has nothing to count searches from');
    }
    const out = new URL('./gemini-raw-response.json', import.meta.url);
    writeFileSync(out, JSON.stringify(raw, null, 2));
    console.log(`  info  full response saved to ${out.pathname}`);

    try {
      const parsed = extractJson(body);
      ok(`returned JSON alongside the tool (${tokens} tokens)`);
      const sources = parsed.sources ?? [];
      if (sources.length >= 2) ok(`${sources.length} sources cited`);
      else bad(`only ${sources.length} source(s) cited; two are needed unless one is primary`);

      // The app checks that each link goes somewhere. It no longer reads the
      // page, so neither does this.
      console.log('\n4. Citation links (does each one go somewhere?)');
      for (const source of sources.slice(0, 3)) {
        try {
          const page = await fetch(source.url, { redirect: 'follow' });
          if (page.status === 404 || page.status === 410) bad(`${source.url} -> HTTP ${page.status} (unreachable)`);
          else if (!page.ok) console.log(`  note  ${source.url} -> HTTP ${page.status} (would count as blocked)`);
          else ok(`${source.publisher ?? source.url} answered${page.url !== source.url ? ` (landed on ${page.url})` : ''}`);
        } catch (err) {
          console.log(`  note  ${source.url} unreachable from here: ${err.message}`);
        }
      }
    } catch (err) {
      bad(`unparseable: ${err.message}`);
      console.log(body.slice(0, 600));
    }
  }
}

console.log(
  failures === 0
    ? '\nAll good. The assumptions in src/verification hold.\n'
    : `\n${failures} problem(s). Fix these before trusting a verdict.\n`,
);
process.exit(failures === 0 ? 0 : 1);
