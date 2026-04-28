const fs = require("fs");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const Groq = require("groq-sdk");

const ROOT_DIR = path.resolve(__dirname, "..");
const CONTENT_DIR = path.join(ROOT_DIR, "content");
const DEFAULT_TIME_ZONE = process.env.CONTENT_TIMEZONE || "Asia/Kolkata";
const RECENT_TITLE_LIMIT = 8;
const BOOLEAN_TRUE = new Set(["1", "true", "yes", "on"]);

// Expanded DSA topic pool covering all major categories
const DSA_TOPICS = [
  { topic: "arrays and hashing",       technique: "hash map lookup",          language: "javascript", difficulty: "Easy"   },
  { topic: "two pointers",             technique: "two pointer scan",          language: "python",     difficulty: "Easy"   },
  { topic: "sliding window",           technique: "variable size window",      language: "javascript", difficulty: "Medium" },
  { topic: "stack",                    technique: "monotonic stack",           language: "python",     difficulty: "Medium" },
  { topic: "binary search",            technique: "binary search on answer",   language: "java",       difficulty: "Medium" },
  { topic: "linked list",              technique: "fast and slow pointers",    language: "python",     difficulty: "Medium" },
  { topic: "trees",                    technique: "depth-first search",        language: "javascript", difficulty: "Medium" },
  { topic: "trees",                    technique: "breadth-first search",      language: "python",     difficulty: "Medium" },
  { topic: "tries",                    technique: "prefix tree",               language: "python",     difficulty: "Medium" },
  { topic: "heap / priority queue",    technique: "min-heap",                  language: "python",     difficulty: "Medium" },
  { topic: "backtracking",             technique: "recursive backtracking",    language: "javascript", difficulty: "Medium" },
  { topic: "graphs",                   technique: "depth-first search",        language: "python",     difficulty: "Medium" },
  { topic: "graphs",                   technique: "breadth-first search",      language: "javascript", difficulty: "Medium" },
  { topic: "dynamic programming",      technique: "bottom-up dp",              language: "python",     difficulty: "Medium" },
  { topic: "dynamic programming",      technique: "memoization",               language: "javascript", difficulty: "Hard"   },
  { topic: "greedy",                   technique: "interval scheduling",       language: "python",     difficulty: "Medium" },
  { topic: "intervals",                technique: "sorting and merging",       language: "javascript", difficulty: "Medium" },
  { topic: "bit manipulation",         technique: "XOR tricks",                language: "python",     difficulty: "Easy"   },
  { topic: "math and geometry",        technique: "modular arithmetic",        language: "javascript", difficulty: "Easy"   },
  { topic: "sorting",                  technique: "merge sort",                language: "python",     difficulty: "Medium" },
  { topic: "recursion",                technique: "divide and conquer",        language: "javascript", difficulty: "Medium" },
  { topic: "string manipulation",      technique: "sliding window",            language: "python",     difficulty: "Medium" },
  { topic: "matrix",                   technique: "DFS on grid",               language: "python",     difficulty: "Medium" },
  { topic: "union find",               technique: "disjoint set union",        language: "python",     difficulty: "Medium" },
  { topic: "segment tree",             technique: "range query",               language: "python",     difficulty: "Hard"   },
];

const FALLBACK_LESSONS = [
  {
    title: "Two Sum with a Hash Map",
    language: "javascript",
    difficulty: "Easy",
    topic: "arrays and hashing",
    technique: "hash map lookup",
    problem: "Given an array of integers and a target value, return the indices of the two numbers whose sum equals the target.",
    code: `function twoSum(nums, target) {
  const seen = new Map();
  for (let i = 0; i < nums.length; i++) {
    const needed = target - nums[i];
    if (seen.has(needed)) return [seen.get(needed), i];
    seen.set(nums[i], i);
  }
  return [];
}`,
    explanation: "A hash map lets us check the complement for each number in O(1). We scan the array once, storing each number we have seen along with its index.\n\nWhen we encounter a new number, we compute the complement needed to reach the target. If that complement is already in the map, we have our answer. Time: O(n), Space: O(n).",
    keyPoints: [
      "Use a map to trade memory for speed.",
      "Check the complement before storing the current number.",
      "This avoids the O(n^2) brute-force approach.",
    ],
  },
  {
    title: "Valid Parentheses Using a Stack",
    language: "javascript",
    difficulty: "Easy",
    topic: "stack",
    technique: "stack matching",
    problem: "Given a string containing only brackets, determine whether every opening bracket is closed in the correct order.",
    code: `function isValid(s) {
  const pairs = { ")": "(", "]": "[", "}": "{" };
  const stack = [];
  for (const ch of s) {
    if (!pairs[ch]) { stack.push(ch); continue; }
    if (stack.pop() !== pairs[ch]) return false;
  }
  return stack.length === 0;
}`,
    explanation: "A stack mirrors the nesting behavior of brackets. Every opening bracket goes onto the stack, and every closing bracket must match the most recent opening bracket.\n\nIf a mismatch happens or the stack is empty on a closing bracket, the string is invalid. At the end the stack must also be empty.",
    keyPoints: [
      "Stacks naturally fit nested structures.",
      "The last opening bracket must be closed first (LIFO).",
      "An empty stack at the end confirms all pairs matched.",
    ],
  },
];

loadEnvFile(path.join(ROOT_DIR, ".env"));

async function main() {
  ensureDirectory(CONTENT_DIR);

  const lessonDate = getLessonDate();
  const recentTitles = getRecentTitles();
  const lessonPlan = pickDailyPlan(lessonDate, recentTitles);

  let lesson;
  let source = "fallback";

  if (!isTruthy(process.env.FORCE_FALLBACK)) {
    try {
      const generated = await generateWithAvailableProvider(lessonPlan, recentTitles, lessonDate);
      if (generated) {
        lesson = generated.lesson;
        source = generated.source;
      }
    } catch (error) {
      console.warn(`AI generation failed, using fallback: ${error.message}`);
    }
  }

  if (!lesson) {
    lesson = buildFallbackLesson(lessonPlan);
  }

  const normalizedLesson = normalizeLesson(lesson, lessonPlan);
  const targetPath = buildTargetPath(lessonDate);
  const markdown = renderMarkdown(normalizedLesson, lessonDate, source);

  ensureDirectory(path.dirname(targetPath));
  fs.writeFileSync(targetPath, markdown, "utf8");

  console.log(`Generated ${path.relative(ROOT_DIR, targetPath)} using ${source}.`);
}

// Provider selection: Groq → Gemini → HuggingFace → fallback
async function generateWithAvailableProvider(lessonPlan, recentTitles, lessonDate) {
  const groqKey = firstDefinedEnv(["GROQ_API_KEY"]);
  if (groqKey) {
    try {
      const lesson = await generateWithGroq(groqKey, lessonPlan, recentTitles, lessonDate);
      return { lesson: requireCompleteLesson(lesson), source: "groq" };
    } catch (error) {
      console.warn(`Groq generation failed: ${error.message}`);
    }
  }

  const geminiKey = firstDefinedEnv(["GEMINI_API_KEY", "GOOGLE_API_KEY"]);
  if (geminiKey) {
    try {
      const lesson = await generateWithGemini(geminiKey, lessonPlan, recentTitles, lessonDate);
      return { lesson: requireCompleteLesson(lesson), source: "gemini" };
    } catch (error) {
      console.warn(`Gemini generation failed: ${error.message}`);
    }
  }

  const hfToken = firstDefinedEnv(["HF_TOKEN", "HUGGING_FACE_TOKEN"]);
  if (hfToken) {
    const lesson = await generateWithHuggingFace(hfToken, lessonPlan, recentTitles, lessonDate);
    return { lesson: requireCompleteLesson(lesson), source: "huggingface" };
  }

  return null;
}

async function generateWithGroq(apiKey, lessonPlan, recentTitles, lessonDate) {
  const client = new Groq({ apiKey });
  const model = process.env.GROQ_MODEL || "llama-3.1-8b-instant";

  const response = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content: [
          "You are a DSA coding teacher. Respond with a single valid JSON object only.",
          "CRITICAL RULES:",
          "1. Use standard JSON syntax only.",
          "2. Every string value must be wrapped with double quotes.",
          "3. Do NOT use triple quotes, markdown fences, or backticks anywhere.",
          "4. The code field must be a JSON string with escaped newlines as \\n.",
          "5. No text before or after the JSON object.",
        ].join("\n"),
      },
      {
        role: "user",
        content: buildPrompt(lessonPlan, recentTitles, lessonDate),
      },
    ],
    temperature: 0.3,
    max_tokens: 1800,
    response_format: { type: "json_object" },
  });

  const text = response.choices[0].message.content;
  return parseLessonJson(sanitizeGroqResponse(text));
}

// Groq sometimes returns code with literal newlines inside JSON strings.
// This extracts the JSON object and fixes unescaped control characters inside string values.
function sanitizeGroqResponse(text) {
  // Step 1: strip outer markdown fences if present
  let cleaned = stripCodeFence(text.trim());

  // Step 2: extract the outermost JSON object
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end > start) {
    cleaned = cleaned.slice(start, end + 1);
  }

  // Step 3: remove backtick code fences inside the text (before JSON parsing)
  cleaned = cleaned.replace(/```[a-z]*\n?([\s\S]*?)```/g, (_, inner) => inner.trim());

  // Step 4: fix unescaped newlines/tabs inside JSON string values
  // We walk char by char to properly escape control chars only inside strings
  cleaned = fixJsonStringControlChars(cleaned);

  return cleaned;
}

function fixJsonStringControlChars(jsonText) {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < jsonText.length; i++) {
    const ch = jsonText[i];

    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      result += ch;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      result += ch;
      continue;
    }

    if (inString) {
      if (ch === "\n") { result += "\\n"; continue; }
      if (ch === "\r") { result += "\\r"; continue; }
      if (ch === "\t") { result += "\\t"; continue; }
    }

    result += ch;
  }

  return result;
}

async function generateWithGemini(token, lessonPlan, recentTitles, lessonDate) {
  const client = new GoogleGenerativeAI(token);
  const model = client.getGenerativeModel({
    model: process.env.GEMINI_MODEL || "gemini-1.5-flash",
    generationConfig: { responseMimeType: "application/json", temperature: 0.9, maxOutputTokens: 1800 },
  });
  const response = await model.generateContent(buildPrompt(lessonPlan, recentTitles, lessonDate));
  return parseLessonJson(response.response.text());
}

async function generateWithHuggingFace(token, lessonPlan, recentTitles, lessonDate) {
  const model = normalizeHuggingFaceModel(process.env.HF_MODEL || "mistralai/Mistral-7B-Instruct-v0.3");
  const response = await fetch("https://router.huggingface.co/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "You create practical daily coding lessons and must answer with valid JSON only." },
        { role: "user", content: buildPrompt(lessonPlan, recentTitles, lessonDate) },
      ],
      max_tokens: 1400,
      temperature: 0.9,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HuggingFace request failed (${response.status}): ${errorText}`);
  }

  const payload = await response.json();
  return parseLessonJson(extractChatCompletionText(payload));
}

function buildPrompt(lessonPlan, recentTitles, lessonDate) {
  const recentBlock = recentTitles.length > 0
    ? recentTitles.map((t, i) => `${i + 1}. ${t}`).join("\n")
    : "None yet";

  return [
    "You are creating a daily DSA (Data Structures & Algorithms) coding lesson.",
    `Date: ${lessonDate}`,
    `Topic: ${lessonPlan.topic}`,
    `Technique: ${lessonPlan.technique}`,
    `Language: ${lessonPlan.language}`,
    `Difficulty: ${lessonPlan.difficulty}`,
    "",
    "Avoid repeating these recent titles:",
    recentBlock,
    "",
    "Return ONLY a valid JSON object with this exact shape (no markdown, no extra text):",
    "{",
    '  "title": "short unique lesson title",',
    '  "language": "programming language in lowercase",',
    '  "difficulty": "Easy, Medium, or Hard",',
    '  "problem": "2-4 sentence problem statement",',
    '  "code": "complete runnable solution — no markdown fences inside",',
    '  "explanation": "2-4 paragraphs explaining the approach, time and space complexity",',
    '  "keyPoints": ["3-5 concise takeaways"]',
    "}",
    "",
    "Requirements:",
    "- Cover the specified DSA topic and technique thoroughly.",
    "- Code must be correct, readable, and self-contained with a working example.",
    "- Include time and space complexity in the explanation.",
    "- Make the lesson feel different from previous days.",
    "- Escape every newline inside JSON string values as \\n.",
    "- Do not use Python triple-quoted strings or JavaScript template literals.",
  ].join("\n");
}

function parseLessonJson(rawText) {
  const candidates = buildJsonCandidates(rawText);
  let lastError;
  for (const candidate of candidates) {
    try { return JSON.parse(candidate); } catch (e) { lastError = e; }
  }
  throw new Error(`Could not parse lesson JSON. ${lastError ? lastError.message : "Unknown error."}`);
}

function buildJsonCandidates(rawText) {
  const trimmed = String(rawText || "").trim();
  if (!trimmed) return [];
  const candidates = [trimmed, stripCodeFence(trimmed)];
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    const sliced = trimmed.slice(start, end + 1);
    candidates.push(sliced, removeTrailingCommas(sliced));
  }
  return [...new Set(candidates.filter(Boolean))];
}

function stripCodeFence(text) {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

function removeTrailingCommas(text) {
  return text.replace(/,\s*([}\]])/g, "$1");
}

function normalizeHuggingFaceModel(model) {
  const normalized = String(model || "").trim();
  if (!normalized) return "mistralai/Mistral-7B-Instruct-v0.3:hf-inference";
  if (normalized.startsWith("http") || normalized.includes(":")) return normalized;
  const provider = String(process.env.HF_PROVIDER || "hf-inference").trim();
  return provider ? `${normalized}:${provider}` : normalized;
}

function extractChatCompletionText(response) {
  const content = response?.choices?.[0]?.message?.content || "";
  if (Array.isArray(content)) return content.map((p) => (typeof p === "string" ? p : p?.text || "")).join("");
  return String(content);
}

function normalizeLesson(lesson, lessonPlan) {
  const fallback = buildFallbackLesson(lessonPlan);
  const keyPoints = Array.isArray(lesson.keyPoints)
    ? lesson.keyPoints.map((p) => String(p).trim()).filter(Boolean)
    : [];
  return {
    title: cleanText(lesson.title) || fallback.title,
    language: cleanText(lesson.language).toLowerCase() || fallback.language,
    difficulty: normalizeDifficulty(lesson.difficulty || fallback.difficulty),
    problem: cleanText(lesson.problem) || fallback.problem,
    code: cleanCode(lesson.code) || fallback.code,
    explanation: cleanText(lesson.explanation) || fallback.explanation,
    keyPoints: keyPoints.length > 0 ? keyPoints.slice(0, 5) : fallback.keyPoints,
  };
}

function requireCompleteLesson(lesson) {
  const requiredFields = ["title", "language", "difficulty", "problem", "code", "explanation"];
  const missing = requiredFields.filter((field) => !cleanText(lesson?.[field]));
  if (!Array.isArray(lesson?.keyPoints) || lesson.keyPoints.filter((p) => cleanText(p)).length < 3) {
    missing.push("keyPoints");
  }
  if (missing.length > 0) {
    throw new Error(`AI lesson missing required fields: ${missing.join(", ")}`);
  }
  return lesson;
}

function buildFallbackLesson(lessonPlan) {
  const fallbackLesson = lessonPlan.fallbackLesson || lessonPlan;
  return {
    title: fallbackLesson.title,
    language: fallbackLesson.language,
    difficulty: fallbackLesson.difficulty,
    problem: fallbackLesson.problem,
    code: fallbackLesson.code,
    explanation: fallbackLesson.explanation,
    keyPoints: fallbackLesson.keyPoints,
  };
}

// Pick a DSA topic based on date seed, avoiding recent titles
function pickDailyPlan(lessonDate, recentTitles) {
  const seed = lessonDate.split("-").map(Number).reduce((a, b) => a + b, 0);

  // Try DSA_TOPICS first for variety
  for (let offset = 0; offset < DSA_TOPICS.length; offset++) {
    const plan = DSA_TOPICS[(seed + offset) % DSA_TOPICS.length];
    // Build a synthetic title to check against recent ones
    const syntheticTitle = `${plan.technique} - ${plan.topic}`;
    if (!recentTitles.some((t) => t.toLowerCase().includes(plan.topic.split(" ")[0]))) {
      return { ...plan, fallbackLesson: FALLBACK_LESSONS[seed % FALLBACK_LESSONS.length] };
    }
  }

  // Absolute fallback
  return FALLBACK_LESSONS[seed % FALLBACK_LESSONS.length];
}

function renderMarkdown(lesson, lessonDate, source) {
  const fencedLang = normalizeFenceLanguage(lesson.language);
  const keyPoints = lesson.keyPoints.map((p) => `- ${p}`).join("\n");

  return [
    "---",
    `date: ${yamlEscape(lessonDate)}`,
    `title: ${yamlEscape(lesson.title)}`,
    `language: ${yamlEscape(lesson.language)}`,
    `difficulty: ${yamlEscape(lesson.difficulty)}`,
    `source: ${yamlEscape(source)}`,
    "---",
    "",
    `# ${lesson.title}`,
    "",
    `**Language:** ${toDisplayLanguage(lesson.language)}  `,
    `**Difficulty:** ${lesson.difficulty}`,
    "",
    "## Problem",
    "",
    lesson.problem,
    "",
    "## Solution",
    "",
    `\`\`\`${fencedLang}`,
    lesson.code,
    "```",
    "",
    "## Explanation",
    "",
    lesson.explanation,
    "",
    "## Key Points",
    "",
    keyPoints,
    "",
    `---`,
    `*Generated on ${lessonDate} using ${source}.*`,
    "",
  ].join("\n");
}

function buildTargetPath(lessonDate) {
  const year = lessonDate.slice(0, 4);
  return path.join(CONTENT_DIR, year, `${lessonDate}.md`);
}

function getRecentTitles() {
  if (!fs.existsSync(CONTENT_DIR)) return [];
  return collectMarkdownFiles(CONTENT_DIR)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, RECENT_TITLE_LIMIT)
    .map((f) => extractTitle(fs.readFileSync(f, "utf8")))
    .filter(Boolean);
}

function collectMarkdownFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectMarkdownFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(full);
  }
  return files;
}

function extractTitle(markdown) {
  const fm = markdown.match(/^title:\s*(.+)$/m);
  if (fm) return cleanText(fm[1]);
  const h1 = markdown.match(/^#\s+(.+)$/m);
  return h1 ? cleanText(h1[1]) : "";
}

function getLessonDate() {
  if (process.env.OUTPUT_DATE) return process.env.OUTPUT_DATE;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DEFAULT_TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function normalizeDifficulty(value) {
  const v = cleanText(value).toLowerCase();
  if (v === "easy") return "Easy";
  if (v === "hard") return "Hard";
  return "Medium";
}

function normalizeFenceLanguage(language) {
  return cleanText(language).toLowerCase() || "text";
}

function toDisplayLanguage(language) {
  const v = cleanText(language).toLowerCase();
  if (!v) return "Text";
  const labels = { csharp: "C#", cpp: "C++", javascript: "JavaScript", typescript: "TypeScript" };
  return labels[v] || (v.charAt(0).toUpperCase() + v.slice(1));
}

function cleanCode(value) {
  return String(value || "").replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/, "").trim();
}

function cleanText(value) {
  return String(value || "").replace(/\r/g, "").trim();
}

function yamlEscape(value) {
  return JSON.stringify(String(value || ""));
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const sep = trimmed.indexOf("=");
    if (sep === -1) continue;
    const key = trimmed.slice(0, sep).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = trimmed.slice(sep + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function firstDefinedEnv(keys) {
  for (const key of keys) {
    const v = process.env[key];
    if (v && v.trim()) return v.trim();
  }
  return "";
}

function isTruthy(value) {
  return BOOLEAN_TRUE.has(String(value || "").trim().toLowerCase());
}

function ensureDirectory(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

main().catch((error) => {
  console.error(`Generation failed: ${error.message}`);
  process.exit(1);
});
