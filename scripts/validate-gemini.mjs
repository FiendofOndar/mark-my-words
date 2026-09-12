/**
 * Prove the Gemini path works before trusting anything built on it.
 *
 * Everything in src/verification is covered by tests against injected fakes.
 * This is the only thing that makes a real call, and it checks the three
 * assumptions that tests cannot: that the model id exists, that the grounding
 * tool is named what we think, and that the model returns citations whose
 * quoted passages actually appear on the pages it cites.
 *
 *   GEMINI_API_KEY=... node scripts/validate-gemini.mjs [model]
 */
import { readFileSync } from 'node:fs';

const key = process.env.GEMINI_API_KEY;
if (!key) {
  console.error('Set GEMINI_API_KEY first. Get one free at https://aistudio.google.com/apikey');
  process.exit(1);
}

const MODEL = process.argv[2] ?? 'gemini-2.5-flash';
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

// 1. The model exists and answers at all.
console.log('1. Reachability');
{
  const { status, text } = await post({
    contents: [{ role: 'user', parts: [{ text: 'Reply with the single word: ready' }] }],
    generationConfig: { maxOutputTokens: 16, temperature: 0 },
  });
  if (status === 200) ok(`${MODEL} answered`);
  else {
    bad(`HTTP ${status}: ${text.slice(0, 300)}`);
    if (status === 404) console.log('        The model id is wrong. Try: node scripts/validate-gemini.mjs gemini-2.0-flash');
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
    try {
      const parsed = extractJson(body);
      ok(`returned JSON alongside the tool (${tokens} tokens)`);
      const sources = parsed.sources ?? [];
      if (sources.length >= 2) ok(`${sources.length} sources cited`);
      else bad(`only ${sources.length} source(s) cited; the rubric needs two to auto-resolve`);

      // The whole guardrail rests on this being true.
      console.log('\n4. Citation validation (do the quotes exist on the pages?)');
      for (const source of sources.slice(0, 3)) {
        try {
          const page = await fetch(source.url, { redirect: 'follow' });
          if (!page.ok) {
            console.log(`  note  ${source.url} -> HTTP ${page.status} (would count as blocked)`);
            continue;
          }
          const html = await page.text();
          const plain = html
            .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .toLowerCase();
          const needle = (source.quoted_text ?? '').replace(/\s+/g, ' ').toLowerCase().trim();
          if (needle && plain.includes(needle)) ok(`quote found on ${source.publisher ?? source.url}`);
          else bad(`quote NOT found on ${source.url}`);
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
