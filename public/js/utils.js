// ===== 工具函数 =====

// ---- 句子拆分（DeepSeek 已按句分行，直接 split） ----
export function splitSentences(text) {
  if (!text || !text.trim()) return [];
  return text
    .split('\n')
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

// ---- Markdown 粗体解析 ----

/**
 * 将 **word** 解析为 HTML 字符串（用于 innerHTML）
 * 处理跨句子、不匹配等边界情况
 */
export function parseBoldHTML(text) {
  if (!text) return '';
  // 转义 HTML 特殊字符（但保留 ** 标记）
  let escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 替换 **text** 为 <strong class="story-vocab">text</strong>
  escaped = escaped.replace(/\*\*(.+?)\*\*/g, '<strong class="story-vocab">$1</strong>');

  return escaped;
}

/**
 * 从文本中提取所有 ** 包裹的词汇
 */
export function extractBoldWords(text) {
  const matches = text.match(/\*\*(.+?)\*\*/g);
  if (!matches) return [];
  return [...new Set(matches.map(m => m.replace(/\*\*/g, '').toLowerCase()))];
}

// ---- 生词匹配 ----

/**
 * 检查词汇列表中的每个词是否出现在故事正文中
 * 大小写不敏感，单词边界匹配
 */
export function matchWords(vocabularyWords, storyBody) {
  // 去掉粗体标记后的小写文本
  const cleanBody = storyBody.replace(/\*\*/g, '').toLowerCase();

  const used = [];
  const missing = [];

  vocabularyWords.forEach(word => {
    const lower = word.toLowerCase();
    // 单词边界匹配
    const regex = new RegExp(`\\b${escapeRegex(lower)}\\b`, 'i');
    if (regex.test(cleanBody)) {
      used.push(word);
    } else {
      missing.push(word);
    }
  });

  return { used, missing };
}

/**
 * 为每个句子标注包含的生词
 */
export function tagSentenceWords(sentences, vocabularyWords) {
  return sentences.map(s => {
    const clean = s.replace(/\*\*/g, '').toLowerCase();
    const containsWords = vocabularyWords.filter(w => {
      const regex = new RegExp(`\\b${escapeRegex(w.toLowerCase())}\\b`, 'i');
      return regex.test(clean);
    });
    return containsWords;
  });
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
