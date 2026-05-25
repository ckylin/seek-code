// ── Request Classifier ──────────────────────────────────────────────────────
// Determines whether a user request is a "code writing/production" task
// (requiring the full P/G/E pipeline) versus a conversational or
// informational query that can be answered directly.
//
// This is used by the direct-response module to short-circuit non-code
// requests before entering the agent loop / planner stages.

// ── Code-request keywords ─────────────────────────────────────────────────
// Each entry is [regex pattern, weight] — matched case-insensitively against
// the full input. Order matters for multi-word patterns (longer first).

const CODE_PATTERNS: [RegExp, number][] = [
  // ── Strong multi-word indicators ──────────────────────────────────────
  [/\bwrite\b.+\b(function|class|script|program|code|test|file|module|api|component|endpoint)\b/i, 5],
  [/\bcreate\b.+\b(function|class|script|program|code|test|file|module|api|component|endpoint)\b/i, 5],
  [/\bimplement\b.+\b(function|class|module|api|feature)\b/i, 5],
  [/\b(build|make)\b.+\b(app|component|module|api|endpoint|website|server|cli)\b/i, 4],
  [/\b(add|create)\b.+\bfeature\b/i, 4],
  [/\b(generate|produce)\b.+\bcode\b/i, 5],
  [/\bfix\b.+\b(bug|issue|error|test|problem)\b/i, 4],
  [/\b(refactor|rewrite|re-write)\b/i, 4],

  // ── Standalone strong verbs ───────────────────────────────────────────
  [/\bimplement\b/i, 3],
  [/\bdebug\b/i, 3],
  [/\bdeploy\b/i, 3],
  [/\bpatch\b/i, 3],

  // ── Code-writing phrases ──────────────────────────────────────────────
  [/\bwrite\s+(me\s+)?(a|an|some|the)\b/i, 4],
  [/\bwrite\s+(code|tests?|unit\s+tests?)\b/i, 5],
  [/\bcreate\s+(a|an)\s+file\b/i, 4],
  [/\bwrite\s+(a|an)\s+file\b/i, 4],
  [/\bedit\s+(the|this)\s+(file|code)\b/i, 4],
  [/\bmodify\s+the\s+code\b/i, 4],
  [/\bchange\s+the\s+code\b/i, 4],
  [/\bupdate\s+the\s+code\b/i, 3],

  // ── Tool hints ────────────────────────────────────────────────────────
  [/\buse\s+(write_file|edit_file)\b/i, 5],
  [/\buse\s+execute_shell\b/i, 3],
  [/\brun\s+this\s+command\b/i, 3],
  [/\binstall\b.+\bpackage\b/i, 3],
  [/\bnpm\s+install\b/i, 3],
  [/\bpip\s+install\b/i, 3],

  // ── Chinese equivalents (no \b — CJK chars don't have word boundaries) ─
  [/(写|创建|实现|编写|生成).{0,6}(函数|类|代码|脚本|程序|测试|文件|模块|组件|接口)/g, 5],
  [/(帮我写|帮我实现|帮我做|帮我弄)/g, 4],
  [/写个/g, 4],
  [/创建个/g, 4],
  [/实现个/g, 4],
  [/重构/g, 4],
  [/(修复|改|修改).{0,6}(bug|代码|问题|错误)/g, 4],
  [/(?:(?<!修)修复|修复(?!复))/g, 3],  // "修复" but not overlapping with longer patterns
  [/改代码/g, 4],
  [/修改代码/g, 4],
  [/添加功能/g, 3],
  [/增加功能/g, 3],
  [/(编译|部署|删除)/g, 2],
];

// ── Non-code indicators (subtract from score) ─────────────────────────────
// These help distinguish "explain how code works" from "write code".

const NON_CODE_PATTERNS: [RegExp, number][] = [
  [/\b(what|how|why|when|where|who|can|could|would|should|do|does|is|are|was|were)\b.{0,30}\?/i, -3],
  [/\bexplain\b/i, -3],
  [/\btell\s+me\s+(about|why|how)\b/i, -3],
  [/\bhelp\s+me\s+understand\b/i, -3],
  [/\bdescribe\b/i, -2],
  [/\bdefinition\s+of\b/i, -2],
  [/\bmeaning\s+of\b/i, -2],
  [/\bdifference\s+between\b/i, -2],
  [/\bcompare\b/i, -2],
  [/\byour\s+opinion\b/i, -3],
  [/\bdo\s+you\s+think\b/i, -2],
  [/\bis\s+it\s+possible\b/i, -2],
  // Chinese (no \b for CJK)
  [/(什么是|如何|怎么|为什么)/g, -2],
  [/(解释|告诉我|介绍一下)/g, -3],
  [/(区别|是否可以)/g, -2],
  [/(你觉得|你的意见)/g, -2],
  [/(是谁|在哪里)/g, -3],
  [/[？?]$/g, -2],
  // Greetings / small talk
  [/\b(hello|hi|hey|good\s+(morning|afternoon|evening))\b/i, -4],
  [/\bhow\s+are\s+you\b/i, -5],
  [/\bnice\s+to\s+meet\s+you\b/i, -5],
  [/\b(thank\s+you|thanks|bye|goodbye|see\s+you)\b/i, -4],
  // Chinese greetings (no \b for CJK)
  [/(你好|您好|早上好|下午好|晚上好)/g, -4],
  [/(谢谢|再见|嗨)/g, -4],
];

// ── Scoring threshold ──────────────────────────────────────────────────────
// A score >= CODE_THRESHOLD classifies the request as a code task.

const CODE_THRESHOLD = 3;

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Classify whether a user's request is a "code writing/production" task.
 *
 * Uses weighted keyword matching: code-related keywords add points,
 * conversational/question keywords subtract points. If the final score
 * meets or exceeds CODE_THRESHOLD, the request is classified as a code task.
 *
 * @param text - The user's raw input text (before @-reference resolution).
 * @returns `true` if this is likely a code production request.
 */
export function is_code_request(text: string): boolean {
  if (!text || typeof text !== 'string') {
    return false;
  }

  let score = 0;

  // ── Score code patterns (regex-based, case-insensitive) ──────────────
  for (const [pattern, weight] of CODE_PATTERNS) {
    if (pattern.test(text)) {
      score += weight;
    }
  }

  // ── Score non-code patterns ──────────────────────────────────────────
  for (const [pattern, penalty] of NON_CODE_PATTERNS) {
    if (pattern.test(text)) {
      score += penalty;
    }
  }

  // ── Heuristic: very short messages are unlikely to be code requests ──
  if (text.trim().length < 8) {
    score -= 2;
  }

  return score >= CODE_THRESHOLD;
}
