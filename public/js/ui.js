// ===== DOM 渲染函数 =====

import { state, toggleSentence, removeWord, clearWords, deleteHistory, setState, addToHistory, revealAllSentences, hideAllSentences } from './state.js';
import { splitSentences, parseBoldHTML, matchWords, tagSentenceWords } from './utils.js';
import { generateStory, translateStory, ocrImage } from './api.js';

// ===== 初始化 DOM 引用 =====
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  modeTabs: () => $$('.mode-tab'),
  textPanel: () => $('#textInputPanel'),
  imagePanel: () => $('#imageInputPanel'),
  wordInput: () => $('#wordInput'),
  imageDropZone: () => $('#imageDropZone'),
  imageFileInput: () => $('#imageFileInput'),
  imageDropContent: () => $('#imageDropContent'),
  imagePreview: () => $('#imagePreview'),
  previewImg: () => $('#previewImg'),
  removeImage: () => $('#removeImage'),
  ocrBtn: () => $('#ocrBtn'),
  wordChips: () => $('#wordChips'),
  wordCount: () => $('#wordCount'),
  chipsContainer: () => $('#chipsContainer'),
  clearWordsBtn: () => $('#clearWords'),
  generateBtn: () => $('#generateBtn'),
  loadingBar: () => $('#loadingBar'),
  loadingStep: () => $('#loadingStep'),
  loadingProgress: () => $('#loadingProgress'),
  errorBanner: () => $('#errorBanner'),
  errorText: () => $('#errorText'),
  inputSection: () => $('#inputSection'),
  storySection: () => $('#storySection'),
  storyMeta: () => $('#storyMeta'),
  storyTitle: () => $('#storyTitle'),
  storyContent: () => $('#storyContent'),
  usedWords: () => $('#usedWords'),
  missingWords: () => $('#missingWords'),
  missingRow: () => $('#missingRow'),
  trackerStats: () => $('#trackerStats'),
  trackerBar: () => $('#trackerBar'),
  historyPanel: () => $('#historyPanel'),
  historyOverlay: () => $('#historyOverlay'),
  historyList: () => $('#historyList'),
};

// ===== 模式切换 =====
export function initModeTabs() {
  dom.modeTabs().forEach(tab => {
    tab.addEventListener('click', () => {
      dom.modeTabs().forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const mode = tab.dataset.mode;
      setState({ inputMode: mode });

      if (mode === 'text') {
        dom.textPanel().classList.remove('hidden');
        dom.imagePanel().classList.add('hidden');
      } else {
        dom.textPanel().classList.add('hidden');
        dom.imagePanel().classList.remove('hidden');
      }
    });
  });
}

// ===== 词条渲染 =====
export function renderWordChips() {
  const words = state.rawWords;
  const container = dom.chipsContainer();
  const panel = dom.wordChips();

  if (words.length === 0) {
    panel.classList.add('hidden');
    return;
  }

  panel.classList.remove('hidden');
  dom.wordCount().textContent = `${words.length} 个单词`;

  container.innerHTML = words.map(w => `
    <span class="word-chip">
      ${escapeHTML(w)}
      <span class="remove-chip" data-word="${escapeHTML(w)}">✕</span>
    </span>
  `).join('');

  // 绑定点 x 删除事件
  container.querySelectorAll('.remove-chip').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeWord(btn.dataset.word);
      renderWordChips();
      updateGenerateButton();
    });
  });
}

function updateGenerateButton() {
  const btn = dom.generateBtn();
  btn.disabled = state.rawWords.length === 0;
}

// ===== 图片处理 =====
export function initImageInput() {
  const input = dom.imageFileInput();
  const drop = dom.imageDropZone();

  input.addEventListener('change', () => {
    const file = input.files[0];
    if (file) handleImageFile(file);
  });

  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('border-amber-light/60');
  });

  drop.addEventListener('dragleave', () => {
    drop.classList.remove('border-amber-light/60');
  });

  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('border-amber-light/60');
    const file = e.dataTransfer.files[0];
    if (file) handleImageFile(file);
  });

  dom.removeImage().addEventListener('click', () => {
    setState({ imagePreview: null, imageFile: null });
    dom.imageDropContent().classList.remove('hidden');
    dom.imagePreview().classList.add('hidden');
    dom.previewImg().src = '';
    dom.ocrBtn().classList.add('hidden');
    input.value = '';
  });

  dom.ocrBtn().addEventListener('click', runOCR);
}

function handleImageFile(file) {
  if (file.size > 5 * 1024 * 1024) {
    setState({ error: '图片需小于 5MB' });
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const base64 = reader.result;
    setState({ imagePreview: base64, imageFile: file });
    dom.imageDropContent().classList.add('hidden');
    dom.imagePreview().classList.remove('hidden');
    dom.previewImg().src = base64;
    dom.ocrBtn().classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

async function runOCR() {
  if (!state.imagePreview) return;

  setState({ step: 'ocr', error: null });
  dom.ocrBtn().disabled = true;
  dom.ocrBtn().textContent = 'Scanning...';
  showLoading('正在识别图片...', 30);

  try {
    const words = await ocrImage(state.imagePreview);
    if (words.length === 0) {
      setState({ error: '未检测到单词，请换更清晰的图片或手动输入', step: 'input' });
    } else {
      // 合并去重
      const merged = [...new Set([...state.rawWords, ...words])];
      setState({ rawWords: merged, step: 'input' });
      renderWordChips();
      updateGenerateButton();
    }
  } catch (err) {
    setState({ error: `OCR 失败：${err.message}`, step: 'input' });
  } finally {
    hideLoading();
    dom.ocrBtn().disabled = false;
    dom.ocrBtn().textContent = 'Scan Words from Image';
  }
}

// ===== 文本输入 =====
export function initTextInput() {
  const textarea = dom.wordInput();

  // 实时解析（延迟 500ms）
  let parseTimer;
  textarea.addEventListener('input', () => {
    clearTimeout(parseTimer);
    parseTimer = setTimeout(() => {
      parseTextWords();
    }, 500);
  });

  // 失去焦点时立即解析
  textarea.addEventListener('blur', () => {
    clearTimeout(parseTimer);
    parseTextWords();
  });
}

function parseTextWords() {
  const text = dom.wordInput().value;
  if (!text.trim()) {
    clearWords();
    renderWordChips();
    updateGenerateButton();
    return;
  }

  const words = text
    .split(/[,，\s\n]+/)
    .map(w => w.replace(/[^\w\s-]/g, '').trim())
    .filter(w => w.length > 0 && /[a-zA-Z]/.test(w));

  const unique = [...new Set(words)];
  setState({ rawWords: unique });
  renderWordChips();
  updateGenerateButton();
}

// ===== 生成按钮 =====
export function initGenerateButton() {
  dom.generateBtn().addEventListener('click', startGeneration);
  dom.clearWordsBtn().addEventListener('click', () => {
    clearWords();
    renderWordChips();
    updateGenerateButton();
    dom.wordInput().value = '';
  });
}

async function startGeneration() {
  if (state.rawWords.length === 0) {
    setState({ error: '请先输入生词' });
    return;
  }

  setState({ step: 'generating', error: null });
  dom.generateBtn().disabled = true;
  showLoading('正在构思故事...', 20);

  try {
    // Step 1: 生成故事
    updateLoading('正在写作中...', 40);
    const { title, body } = await generateStory(state.rawWords);

    // Step 2: 拆分英文句子（DeepSeek 已按句分行）
    const rawSentences = splitSentences(body);
    setState({ title, storyBody: body, step: 'translating' });
    updateLoading('正在翻译...', 70);

    // Step 3: 整篇翻译（全文送入保证上下文连贯）
    const translations = await translateStory(body, rawSentences.length);

    // Step 4: 组装数据
    const containsWordsArr = tagSentenceWords(rawSentences, state.rawWords);
    const sentences = rawSentences.map((eng, i) => ({
      id: i,
      english: eng,
      chinese: translations[i] || '(translation pending)',
      revealed: false,
      containsWords: containsWordsArr[i] || [],
    }));

    setState({ sentences, step: 'done' });
    renderStory();

    // 存入历史
    addToHistory({ title, storyBody: body, sentences });

  } catch (err) {
    setState({ error: `生成失败：${err.message}`, step: 'input' });
  } finally {
    hideLoading();
    dom.generateBtn().disabled = false;
    dom.generateBtn().textContent = 'Regenerate';
  }
}

// ===== 故事渲染 =====
function renderStory() {
  const section = dom.storySection();

  // 切到故事页面：隐藏输入区
  dom.inputSection().classList.add('hidden');
  section.classList.remove('hidden');

  // 标题 + 词数
  dom.storyTitle().textContent = state.title;
  const wordCount = state.storyBody.replace(/\*\*/g, '').split(/\s+/).filter(w => w.length > 0).length;
  dom.storyMeta().textContent = `${wordCount} words · ${state.sentences.length} sentences`;

  // 句子 — 分离文本区和触发展开区
  const content = dom.storyContent();
  content.innerHTML = state.sentences.map(s => {
    const hasVocab = s.containsWords.length > 0 ? 'has-vocab' : '';
    return `
      <div class="sentence-row ${hasVocab}" data-sid="${s.id}">
        <span class="sentence-text">${parseBoldHTML(s.english)}</span>
        <span class="sentence-toggle" data-toggle="${s.id}">
          <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 18l6-6-6-6"/>
          </svg>
        </span>
      </div>
      <div class="translation-wrapper" data-tid="${s.id}">
        <div class="translation-text">
          <div class="translation-text-inner">${escapeHTML(s.chinese)}</div>
        </div>
      </div>
    `;
  }).join('');

  // 逐行延迟入场（staggered entrance）
  content.querySelectorAll('.sentence-row').forEach((row, i) => {
    row.style.animationDelay = `${i * 0.03}s`;
  });

  // 仅右侧 toggle 区域触发翻译
  content.querySelectorAll('.sentence-toggle').forEach(toggle => {
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const sid = parseInt(toggle.dataset.toggle);
      toggleSentence(sid);
      refreshSentenceUI(sid);
    });
  });

  // 生词追踪
  renderWordTracker();

  // 重置展开按钮
  const toggleBtn = $('#toggleAllBtn');
  if (toggleBtn) toggleBtn.textContent = 'Show All CN';

  // 滚到顶部
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function refreshSentenceUI(sid) {
  const sentence = state.sentences.find(s => s.id === sid);
  if (!sentence) return;

  const row = document.querySelector(`.sentence-row[data-sid="${sid}"]`);
  const wrapper = document.querySelector(`.translation-wrapper[data-tid="${sid}"]`);

  if (sentence.revealed) {
    row.classList.add('revealed');
    wrapper.classList.add('open');
  } else {
    row.classList.remove('revealed');
    wrapper.classList.remove('open');
  }
}

function renderWordTracker() {
  const { used, missing } = matchWords(state.rawWords, state.storyBody);
  const total = state.rawWords.length;
  const pct = Math.round((used.length / total) * 100);

  dom.trackerStats().textContent = `${used.length}/${total} (${pct}%)`;
  dom.trackerBar().style.width = `${pct}%`;
  dom.trackerBar().style.background = pct === 100 ? 'var(--sage)' : 'var(--amber)';

  // 已用词条
  dom.usedWords().innerHTML = used.map(w => `
    <span class="tracker-chip used" data-word="${escapeHTML(w)}">${escapeHTML(w)}</span>
  `).join('');

  // 遗漏词条
  if (missing.length > 0) {
    dom.missingRow().classList.remove('hidden');
    dom.missingWords().innerHTML = missing.map(w => `
      <span class="tracker-chip missing">${escapeHTML(w)}</span>
    `).join('');
  } else {
    dom.missingRow().classList.add('hidden');
  }

  // 绑定点击高亮
  dom.usedWords().querySelectorAll('.tracker-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const word = chip.dataset.word;
      toggleHighlight(word, chip);
    });
  });
}

function toggleHighlight(word, chipElement) {
  const current = state.highlightWord;

  // 取消之前的高亮
  if (current) {
    document.querySelectorAll('.story-vocab.highlight-flash').forEach(el => {
      el.classList.remove('highlight-flash');
    });
    document.querySelectorAll('.tracker-chip.highlighted').forEach(el => {
      el.classList.remove('highlighted');
    });
  }

  if (current === word) {
    setState({ highlightWord: null });
    return;
  }

  setState({ highlightWord: word });
  chipElement.classList.add('highlighted');

  // 高亮故事中所有匹配的单词
  document.querySelectorAll('.story-vocab').forEach(el => {
    if (el.textContent.toLowerCase() === word.toLowerCase()) {
      el.classList.add('highlight-flash');
    }
  });
}

// ===== 加载状态 =====
function showLoading(text, progress) {
  dom.loadingBar().classList.remove('hidden');
  dom.loadingStep().textContent = text;
  dom.loadingProgress().style.width = `${progress}%`;
}

function updateLoading(text, progress) {
  dom.loadingStep().textContent = text;
  dom.loadingProgress().style.width = `${progress}%`;
}

function hideLoading() {
  dom.loadingBar().classList.add('hidden');
}

// ===== 错误提示 =====
export function initErrorBanner() {
  dom.errorBanner().querySelector('#dismissError').addEventListener('click', () => {
    setState({ error: null });
  });
}

export function renderError() {
  const banner = dom.errorBanner();
  if (state.error) {
    banner.classList.remove('hidden');
    dom.errorText().textContent = state.error;
  } else {
    banner.classList.add('hidden');
  }
}

// ===== 复制功能 =====
// ===== 返回输入区 =====
export function initBackButton() {
  $('#backToInput').addEventListener('click', () => {
    dom.storySection().classList.add('hidden');
    dom.inputSection().classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

// ===== 复制按钮 =====
export function initCopyButtons() {
  $('#toggleAllBtn').addEventListener('click', () => {
    const anyHidden = state.sentences.some(s => !s.revealed);
    if (anyHidden) {
      revealAllSentences();
      $('#toggleAllBtn').textContent = 'Hide All CN';
    } else {
      hideAllSentences();
      $('#toggleAllBtn').textContent = 'Show All CN';
    }
    refreshAllSentencesUI();
  });

  $('#copyEnBtn').addEventListener('click', () => {
    const text = state.sentences.map(s => s.english.replace(/\*\*/g, '')).join('\n\n');
    copyToClipboard(text, '英文故事已复制');
  });

  $('#copyBilingualBtn').addEventListener('click', () => {
    const text = state.sentences.map(s =>
      `${s.english.replace(/\*\*/g, '')}\n${s.chinese}`
    ).join('\n\n');
    copyToClipboard(text, '双语故事已复制');
  });

  $('#printBtn').addEventListener('click', () => {
    window.print();
  });
}

function refreshAllSentencesUI() {
  state.sentences.forEach(s => refreshSentenceUI(s.id));
}

function copyToClipboard(text, label) {
  navigator.clipboard.writeText(text).then(() => {
    showToast(label);
  }).catch(() => {
    // fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast(label);
  });
}

function showToast(msg) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 2000);
}

// ===== 历史面板 =====
export function initHistoryPanel() {
  $('#historyBtn').addEventListener('click', openHistory);
  $('#closeHistory').addEventListener('click', closeHistory);
  dom.historyOverlay().addEventListener('click', closeHistory);
}

function openHistory() {
  dom.historyPanel().classList.remove('hidden');
  dom.historyOverlay().classList.remove('hidden');
  requestAnimationFrame(() => {
    dom.historyPanel().classList.remove('translate-x-full');
  });
  renderHistoryList();
}

function closeHistory() {
  dom.historyPanel().classList.add('translate-x-full');
  setTimeout(() => {
    dom.historyPanel().classList.add('hidden');
    dom.historyOverlay().classList.add('hidden');
  }, 300);
}

function renderHistoryList() {
  const list = dom.historyList();

  if (state.history.length === 0) {
    list.innerHTML = '<p class="text-sm text-ink-muted text-center py-8">暂无历史记录</p>';
    return;
  }

  list.innerHTML = state.history.map(h => {
    const date = new Date(h.date);
    const dateStr = date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    return `
      <div class="history-item" data-hid="${h.id}">
        <div class="history-title">${escapeHTML(h.title || '无标题')}</div>
        <div class="history-meta">${dateStr} · ${h.words.length} 个生词</div>
        <button class="delete-history text-xs text-ink-muted hover:text-wine transition-colors mt-1" data-hid="${h.id}">删除</button>
      </div>
    `;
  }).join('');

  // 绑定点击：加载历史故事
  list.querySelectorAll('.history-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('delete-history')) return;
      const hid = item.dataset.hid;
      loadHistoryEntry(hid);
    });
  });

  // 绑定删除
  list.querySelectorAll('.delete-history').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteHistory(btn.dataset.hid);
      renderHistoryList();
    });
  });
}

function loadHistoryEntry(hid) {
  const entry = state.history.find(h => h.id === hid);
  if (!entry) return;

  setState({
    title: entry.title,
    storyBody: entry.storyBody,
    sentences: entry.sentences.map(s => ({ ...s, revealed: false })),
    rawWords: entry.words,
    step: 'done',
  });

  renderStory();
  renderWordChips();
  closeHistory();

  // 滚动到故事
  setTimeout(() => {
    dom.storySection().scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 300);
}

// ===== 工具 =====
function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
