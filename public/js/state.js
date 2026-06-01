// ===== 全局状态管理（发布订阅模式） =====

const HISTORY_KEY = 'engstory_history';
const MAX_HISTORY = 10;

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(history) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
  } catch { /* localStorage 不可用时静默失败 */ }
}

export const state = {
  // 输入
  inputMode: 'text',        // 'text' | 'image'
  rawWords: [],             // 已提取的生词
  imagePreview: null,       // base64 data URL
  imageFile: null,          // File 对象

  // 流程
  step: 'input',            // 'input'|'ocr'|'generating'|'translating'|'done'|'error'
  error: null,

  // 结果
  title: '',
  storyBody: '',            // 原始 markdown
  sentences: [],            // [{id, english, chinese, revealed, containsWords}]
  highlightWord: null,      // 当前联动高亮的生词

  // 历史
  history: loadHistory(),
};

// ----- 订阅者 -----
const subscribers = new Set();

export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

function notify() {
  subscribers.forEach(fn => fn(state));
}

// ----- 状态更新 -----
export function setState(partial) {
  Object.assign(state, partial);
  notify();
}

// ----- 便捷操作 -----
export function addWords(words) {
  const cleaned = words
    .map(w => w.replace(/[^\w\s-]/g, '').trim())
    .filter(w => w.length > 0 && /[a-zA-Z]/.test(w));
  const unique = [...new Set([...state.rawWords, ...cleaned])];
  setState({ rawWords: unique, error: null });
}

export function removeWord(word) {
  setState({ rawWords: state.rawWords.filter(w => w !== word) });
}

export function clearWords() {
  setState({ rawWords: [], error: null });
}

export function addToHistory(storyData) {
  const entry = {
    id: Date.now().toString(36),
    date: new Date().toISOString(),
    title: storyData.title,
    words: [...state.rawWords],
    storyBody: storyData.storyBody,
    sentences: storyData.sentences,
  };
  const updated = [entry, ...state.history];
  setState({ history: updated });
  saveHistory(updated);
}

export function deleteHistory(id) {
  const updated = state.history.filter(h => h.id !== id);
  setState({ history: updated });
  saveHistory(updated);
}

export function toggleSentence(id) {
  const sentences = state.sentences.map(s =>
    s.id === id ? { ...s, revealed: !s.revealed } : s
  );
  setState({ sentences });
}

export function revealAllSentences() {
  const sentences = state.sentences.map(s => ({ ...s, revealed: true }));
  setState({ sentences });
}

export function hideAllSentences() {
  const sentences = state.sentences.map(s => ({ ...s, revealed: false }));
  setState({ sentences });
}
