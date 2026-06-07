(() => {
  'use strict';

  const STORAGE_KEY = 'gogexmd_last_content';
  const SETTINGS_KEY = 'gogexmd_settings';

  const DEFAULT_SETTINGS = {
    panguSpacing: true,
    removeCurlyQuotes: true,
    rememberLast: false,
  };

  const ALLOWED_TAGS = new Set([
    'P', 'BR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'STRONG', 'B', 'EM', 'I', 'CODE', 'PRE',
    'UL', 'OL', 'LI', 'BLOCKQUOTE',
    'A', 'IMG',
    'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD',
    'HR'
  ]);

  const ALLOWED_ATTRS = {
    A: new Set(['href']),
    IMG: new Set(['src', 'alt']),
    PRE: new Set(['style']),
    CODE: new Set(['style'])
  };

  const DROP_TAGS = new Set([
    'SCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH',
    'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT',
    'STYLE', 'LINK', 'META', 'VIDEO', 'AUDIO', 'CANVAS'
  ]);

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function getSettings() {
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettings(settings) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, ...settings }));
    } catch {}
  }

  function isArticlePage() {
    return /^https:\/\/(x|twitter)\.com\/.+(article|compose\/article)/.test(location.href);
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function isSafeLink(url) {
    try {
      const parsed = new URL(url, location.href);
      return ['https:', 'http:', 'mailto:'].includes(parsed.protocol);
    } catch {
      return false;
    }
  }

  function isSafeImage(url) {
    try {
      return new URL(url, location.href).protocol === 'https:';
    } catch {
      return false;
    }
  }

  function parseFrontmatter(markdown) {
    const fm = {};
    const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
    if (!match) return { fm, markdown };

    match[1].split('\n').forEach(line => {
      const [key, ...rest] = line.split(':');
      if (key.trim()) fm[key.trim()] = rest.join(':').trim();
    });

    return { fm, markdown: markdown.slice(match[0].length) };
  }

  function extractTitle(markdown, filename) {
    const h1 = markdown.match(/^#\s+(.+)$/m);
    if (h1) return h1[1].trim();
    return filename.replace(/\.(md|markdown)$/i, '');
  }

  function removeFirstH1(markdown) {
    return markdown.replace(/^#\s+.+\n?/, '');
  }

  function panguSpacing(text) {
    return text
      .replace(/([一-鿿぀-ヿ])([A-Za-z0-9（(])/g, '$1 $2')
      .replace(/([A-Za-z0-9）)])([一-鿿぀-ヿ])/g, '$1 $2');
  }

  function removeChineseQuotes(text) {
    return text.replace(/[“”]/g, '');
  }

  function calcStats(markdown) {
    const text = markdown
      .replace(/```[\s\S]*?```/g, '')
      .replace(/[#*`>\-|!()[\]]/g, '');
    const chinese = (text.match(/[一-龥]/g) || []).length;
    const english = (text.match(/\b[a-zA-Z]+\b/g) || []).length;
    const words = chinese + english;
    return { words, minutes: Math.max(1, Math.ceil(words / 400)) };
  }

  function inlineMarkdown(text) {
    let out = escapeHtml(text);
    out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, src) => {
      return isSafeImage(src) ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}">` : `[图片: ${escapeHtml(alt || '已移除')}]`;
    });
    out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, href) => {
      return isSafeLink(href) ? `<a href="${escapeHtml(href)}">${label}</a>` : label;
    });
    return out;
  }

  function markdownTableToText(lines, start) {
    const rows = [];
    let i = start;
    while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
      const raw = lines[i].trim();
      if (!/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(raw)) {
        rows.push(raw);
      }
      i += 1;
    }
    return { html: rows.map(row => `<p>${escapeHtml(row)}</p>`).join(''), next: i };
  }

  function markdownToHtml(markdown) {
    const lines = markdown.replace(/\r\n/g, '\n').split('\n');
    const html = [];
    let paragraph = [];
    let inCode = false;
    let code = [];

    function flushParagraph() {
      if (!paragraph.length) return;
      html.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`);
      paragraph = [];
    }

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];

      if (/^```/.test(line)) {
        if (inCode) {
          html.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
          code = [];
          inCode = false;
        } else {
          flushParagraph();
          inCode = true;
        }
        continue;
      }

      if (inCode) {
        code.push(line);
        continue;
      }

      if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i + 1])) {
        flushParagraph();
        const table = markdownTableToText(lines, i);
        html.push(table.html);
        i = table.next - 1;
        continue;
      }

      if (!line.trim()) {
        flushParagraph();
        continue;
      }

      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        flushParagraph();
        const level = heading[1].length;
        html.push(`<h${level}>${inlineMarkdown(heading[2].trim())}</h${level}>`);
        continue;
      }

      const quote = line.match(/^>\s*(.+)$/);
      if (quote) {
        flushParagraph();
        html.push(`<blockquote>${inlineMarkdown(quote[1])}</blockquote>`);
        continue;
      }

      const unordered = line.match(/^\s*[-*]\s+(.+)$/);
      if (unordered) {
        flushParagraph();
        const items = [unordered[1]];
        while (i + 1 < lines.length) {
          const next = lines[i + 1].match(/^\s*[-*]\s+(.+)$/);
          if (!next) break;
          items.push(next[1]);
          i += 1;
        }
        html.push(`<ul>${items.map(item => `<li>${inlineMarkdown(item)}</li>`).join('')}</ul>`);
        continue;
      }

      const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
      if (ordered) {
        flushParagraph();
        const items = [ordered[1]];
        while (i + 1 < lines.length) {
          const next = lines[i + 1].match(/^\s*\d+\.\s+(.+)$/);
          if (!next) break;
          items.push(next[1]);
          i += 1;
        }
        html.push(`<ol>${items.map(item => `<li>${inlineMarkdown(item)}</li>`).join('')}</ol>`);
        continue;
      }

      if (/^---+$/.test(line.trim())) {
        flushParagraph();
        html.push('<hr>');
        continue;
      }

      paragraph.push(line.trim());
    }

    flushParagraph();
    if (inCode) html.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);

    return sanitizeHtml(html.join('\n'));
  }

  function sanitizeHtml(html) {
    const template = document.createElement('template');
    template.innerHTML = html;

    function cleanNode(node) {
      if (node.nodeType === Node.TEXT_NODE) return;
      if (node.nodeType !== Node.ELEMENT_NODE) {
        node.remove();
        return;
      }

      const tag = node.tagName;
      if (DROP_TAGS.has(tag)) {
        node.remove();
        return;
      }

      if (!ALLOWED_TAGS.has(tag)) {
        const fragment = document.createDocumentFragment();
        while (node.firstChild) {
          const child = node.firstChild;
          fragment.appendChild(child);
          cleanNode(child);
        }
        node.replaceWith(fragment);
        return;
      }

      const allowed = ALLOWED_ATTRS[tag] || new Set();
      Array.from(node.attributes).forEach(attr => {
        if (!allowed.has(attr.name)) node.removeAttribute(attr.name);
      });

      if (tag === 'A') {
        const href = node.getAttribute('href');
        if (!href || !isSafeLink(href)) {
          node.removeAttribute('href');
        } else {
          node.setAttribute('href', new URL(href, location.href).href);
        }
      }

      if (tag === 'IMG') {
        const src = node.getAttribute('src');
        if (!src || !isSafeImage(src)) {
          node.replaceWith(document.createTextNode(`[图片: ${node.getAttribute('alt') || '已移除'}]`));
          return;
        }
        node.setAttribute('src', new URL(src, location.href).href);
      }

      if (tag === 'PRE') {
        node.setAttribute('style', 'background:#f1f5f9;border-radius:6px;padding:12px 16px;font-family:monospace;font-size:13px;overflow-x:auto;white-space:pre;');
      }

      if (tag === 'CODE') {
        node.setAttribute('style', 'background:#f1f5f9;padding:2px 5px;border-radius:4px;font-family:monospace;font-size:0.9em;');
      }

      Array.from(node.childNodes).forEach(cleanNode);
    }

    Array.from(template.content.childNodes).forEach(cleanNode);
    return template.innerHTML;
  }

  function htmlToPlain(html) {
    const div = document.createElement('div');
    div.innerHTML = sanitizeHtml(html)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>|<\/h[1-6]>|<\/div>|<\/blockquote>/gi, '\n\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<hr[^>]*>/gi, '\n--------------------\n');
    return (div.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
  }

  function findTitleEditor() {
    const byTestId = document.querySelector('[data-testid="article-title"] [contenteditable]')
      || document.querySelector('[data-testid="article-title"]');
    if (byTestId) return byTestId;

    const byAttr = document.querySelector('[data-placeholder="添加标题"]')
      || document.querySelector('[placeholder="添加标题"]');
    if (byAttr) return byAttr;

    const drafts = Array.from(document.querySelectorAll('.public-DraftEditor-content'));
    if (drafts.length > 1) {
      return drafts.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
    }
    return null;
  }

  function isUsableEditor(el) {
    if (!el) return false;
    if (el.closest('#gogexmd-panel, #gogexmd-preview-modal, #gogexmd-settings-modal')) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 80 && rect.height > 20 && rect.bottom > 0 && rect.right > 0;
  }

  function editorScore(el) {
    const rect = el.getBoundingClientRect();
    const text = [
      el.getAttribute('aria-label'),
      el.getAttribute('data-testid'),
      el.getAttribute('data-placeholder'),
      el.closest('[data-testid]')?.getAttribute('data-testid'),
      el.parentElement?.textContent
    ].filter(Boolean).join(' ').toLowerCase();

    let score = rect.width * rect.height;
    if (/body|正文|article-body|write|compose/.test(text)) score += 1000000;
    if (/title|标题|article-title/.test(text)) score -= 1000000;
    return score;
  }

  function findBodyEditor() {
    const exactSelectors = [
      '[data-testid="article-body-input"] [contenteditable="true"]',
      '[data-testid="article-body-input"][contenteditable="true"]',
      '[aria-label*="正文"][contenteditable="true"]',
      '[aria-label*="Body"][contenteditable="true"]',
      '[data-placeholder*="正文"][contenteditable="true"]',
      '[data-placeholder*="Write"][contenteditable="true"]'
    ];

    for (const selector of exactSelectors) {
      const found = Array.from(document.querySelectorAll(selector)).find(isUsableEditor);
      if (found) return found;
    }

    const drafts = Array.from(document.querySelectorAll('.public-DraftEditor-content')).filter(isUsableEditor);
    if (drafts.length > 1) {
      return drafts.sort((a, b) => editorScore(b) - editorScore(a))[0];
    }
    if (drafts.length === 1) return drafts[0];

    return Array.from(document.querySelectorAll('[contenteditable="true"]'))
      .filter(isUsableEditor)
      .sort((a, b) => editorScore(b) - editorScore(a))[0] || null;
  }

  function editableTarget(el) {
    if (!el) return null;
    if (el.getAttribute('contenteditable') === 'true') return el;
    return el.querySelector?.('[contenteditable="true"]') || el;
  }

  function selectElementContents(el) {
    const target = editableTarget(el);
    if (!target) return false;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(target);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }

  function dispatchEditorInput(el, inputType, data = null) {
    const target = editableTarget(el);
    if (!target) return;
    try {
      target.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType,
        data
      }));
    } catch {}
    try {
      target.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType,
        data
      }));
    } catch {
      target.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  async function clearEditable(el) {
    const target = editableTarget(el);
    if (!target) return false;
    target.scrollIntoView({ block: 'center', inline: 'nearest' });
    target.focus();
    target.click();
    await sleep(80);

    selectElementContents(target);
    await sleep(40);
    document.execCommand('cut');
    dispatchEditorInput(target, 'deleteContentBackward');
    await sleep(120);
    if (target.textContent.trim().length === 0) return true;

    selectElementContents(target);
    await sleep(40);
    document.execCommand('delete');
    dispatchEditorInput(target, 'deleteContentBackward');
    await sleep(120);
    if (target.textContent.trim().length === 0) return true;

    selectElementContents(target);
    await sleep(40);
    document.execCommand('insertText', false, '');
    dispatchEditorInput(target, 'deleteContentBackward');
    await sleep(120);
    if (target.textContent.trim().length === 0) return true;

    target.textContent = '';
    dispatchEditorInput(target, 'deleteContentBackward');
    await sleep(160);
    return target.textContent.trim().length === 0;
  }

  async function fillTitle(text) {
    const title = findTitleEditor();
    if (!title) return false;
    const target = editableTarget(title);
    target.focus();
    target.click();
    await sleep(100);
    selectElementContents(target);
    document.execCommand('insertText', false, text);
    return true;
  }

  async function injectBody(html) {
    const editor = findBodyEditor();
    if (!editor) return false;

    const clean = sanitizeHtml(html);
    const plain = htmlToPlain(clean);
    const target = editableTarget(editor);
    if (!target) return false;

    await clearEditable(editor);

    try {
      const dt = new DataTransfer();
      dt.setData('text/html', clean);
      dt.setData('text/plain', plain);
      target.dispatchEvent(new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dt
      }));
      await sleep(700);
      if (target.textContent.trim().length > 20) return 'auto';
    } catch {}

    await clearEditable(editor);

    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([clean], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' })
        })
      ]);
    } catch {
      await navigator.clipboard.writeText(plain);
    }

    target.focus();
    target.click();
    await sleep(120);

    try {
      document.execCommand('paste');
      await sleep(900);
      if (target.textContent.trim().length > 20) return 'auto';
    } catch {}

    await clearEditable(editor);
    target.focus();
    target.click();
    await sleep(120);
    try {
      document.execCommand('insertText', false, plain);
      dispatchEditorInput(target, 'insertText', plain);
      await sleep(900);
      if (target.textContent.trim().length > 20) return 'auto';
    } catch {}

    target.focus();
    target.click();
    return 'manual';
  }

  let currentTitle = '';
  let currentHtml = '';
  let currentMarkdown = '';
  let currentFilename = '';

  async function processMarkdown(markdown, filename) {
    setStatus('解析中...', 'loading');
    const settings = getSettings();
    const parsed = parseFrontmatter(markdown);
    const title = parsed.fm.title || extractTitle(parsed.markdown, filename);

    let body = removeFirstH1(parsed.markdown);
    if (settings.removeCurlyQuotes) body = removeChineseQuotes(body);
    if (settings.panguSpacing) body = panguSpacing(body);

    currentTitle = title;
    currentHtml = markdownToHtml(body);
    currentMarkdown = markdown;
    currentFilename = filename;

    const stats = calcStats(body);
    setMeta(stats.words, stats.minutes);

    if (settings.rememberLast) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          markdown,
          filename,
          ts: Date.now()
        }));
      } catch {}
    }

    showActions(true);
    setStatus('解析完成', 'success');
  }

  async function importArticle() {
    if (!currentHtml) {
      setStatus('请先选择 Markdown', 'error');
      return;
    }
    setStatus('导入中...', 'loading');
    const titleOk = await fillTitle(currentTitle);
    await sleep(200);
    const result = await injectBody(currentHtml);
    if (result === 'auto') {
      setStatus(`导入完成${titleOk ? '（含标题）' : ''}`, 'success');
    } else if (result === 'manual') {
      setStatus('已复制，请在正文框按 Command+V', 'success');
    } else {
      setStatus('找不到 X 长文编辑器', 'error');
    }
  }

  async function pasteMarkdown() {
    setStatus('读取剪贴板...', 'loading');
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        setStatus('剪贴板为空', 'error');
        return;
      }
      await processMarkdown(text, 'clipboard.md');
    } catch {
      setStatus('无法读取剪贴板，请检查权限', 'error');
    }
  }

  function loadLast() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!saved || !saved.markdown) {
        setStatus('没有可恢复内容', 'error');
        return;
      }
      if (Date.now() - saved.ts > 24 * 60 * 60 * 1000) {
        localStorage.removeItem(STORAGE_KEY);
        setStatus('上次内容已超过 24 小时，已清除', 'error');
        return;
      }
      processMarkdown(saved.markdown, saved.filename || 'last.md');
    } catch {
      setStatus('恢复失败', 'error');
    }
  }

  async function clearEditors() {
    const title = findTitleEditor();
    const body = findBodyEditor();
    if (!title && !body) {
      setStatus('找不到编辑器', 'error');
      return;
    }
    if (title) await clearEditable(title);
    if (body) await clearEditable(body);
    currentTitle = '';
    currentHtml = '';
    currentMarkdown = '';
    currentFilename = '';
    showActions(false);
    setMeta(0, 0);
    setStatus('编辑器已清空', 'success');
  }

  async function exportEditorText() {
    const body = findBodyEditor();
    if (!body || !body.textContent.trim()) {
      setStatus('编辑器为空', 'error');
      return;
    }
    await navigator.clipboard.writeText(body.innerText || body.textContent);
    setStatus('已复制编辑器内容', 'success');
  }

  function showPreview() {
    if (!currentHtml) {
      setStatus('请先选择 Markdown', 'error');
      return;
    }
    if (document.getElementById('gogexmd-preview-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'gogexmd-preview-modal';

    const box = document.createElement('div');
    box.id = 'gogexmd-preview-box';

    const header = document.createElement('div');
    header.id = 'gogexmd-preview-header';
    header.innerHTML = `<strong>${escapeHtml(currentTitle)}</strong>`;

    const close = document.createElement('button');
    close.textContent = '×';
    close.addEventListener('click', () => modal.remove());
    header.appendChild(close);

    const content = document.createElement('div');
    content.id = 'gogexmd-preview-content';
    content.innerHTML = sanitizeHtml(currentHtml);

    const footer = document.createElement('div');
    footer.id = 'gogexmd-preview-footer';
    const importBtn = document.createElement('button');
    importBtn.className = 'gogexmd-btn gogexmd-primary';
    importBtn.textContent = '确认导入';
    importBtn.addEventListener('click', () => {
      modal.remove();
      importArticle();
    });
    footer.appendChild(importBtn);

    box.append(header, content, footer);
    modal.appendChild(box);
    modal.addEventListener('click', event => {
      if (event.target === modal) modal.remove();
    });
    document.body.appendChild(modal);
  }

  function showSettings() {
    if (document.getElementById('gogexmd-settings-modal')) return;
    const settings = getSettings();
    const modal = document.createElement('div');
    modal.id = 'gogexmd-settings-modal';
    modal.innerHTML = `
      <div id="gogexmd-settings-box">
        <div id="gogexmd-settings-header">
          <strong>设置</strong>
          <button id="gogexmd-settings-close">×</button>
        </div>
        <label><input id="gogexmd-s-pangu" type="checkbox"> 中英文自动加空格</label>
        <label><input id="gogexmd-s-quotes" type="checkbox"> 去除中文弯引号</label>
        <label><input id="gogexmd-s-remember" type="checkbox"> 保存上次内容 24 小时</label>
        <button class="gogexmd-btn gogexmd-primary" id="gogexmd-settings-save">保存</button>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('gogexmd-s-pangu').checked = settings.panguSpacing;
    document.getElementById('gogexmd-s-quotes').checked = settings.removeCurlyQuotes;
    document.getElementById('gogexmd-s-remember').checked = settings.rememberLast;
    document.getElementById('gogexmd-settings-close').addEventListener('click', () => modal.remove());
    document.getElementById('gogexmd-settings-save').addEventListener('click', () => {
      saveSettings({
        panguSpacing: document.getElementById('gogexmd-s-pangu').checked,
        removeCurlyQuotes: document.getElementById('gogexmd-s-quotes').checked,
        rememberLast: document.getElementById('gogexmd-s-remember').checked
      });
      modal.remove();
      setStatus('设置已保存', 'success');
    });
  }

  function readFile(file) {
    if (!/\.(md|markdown)$/i.test(file.name)) {
      setStatus('只支持 .md / .markdown 文件', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = event => processMarkdown(String(event.target.result || ''), file.name);
    reader.readAsText(file);
  }

  function createPanel() {
    if (document.getElementById('gogexmd-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'gogexmd-panel';
    panel.innerHTML = `
      <div id="gogexmd-header">
        <strong>gogexmd</strong>
        <div>
          <button id="gogexmd-settings" title="设置">⚙</button>
          <button id="gogexmd-collapse" title="收起">−</button>
        </div>
      </div>
      <div id="gogexmd-body">
        <div id="gogexmd-drop">
          <div class="gogexmd-drop-title">拖入 Markdown</div>
          <label for="gogexmd-file">点击选择文件</label>
          <input id="gogexmd-file" type="file" accept=".md,.markdown">
        </div>
        <button class="gogexmd-btn" id="gogexmd-paste">粘贴 Markdown</button>
        <button class="gogexmd-btn" id="gogexmd-restore">恢复上次内容</button>
        <div id="gogexmd-meta">
          <span id="gogexmd-words"></span>
          <span id="gogexmd-time"></span>
        </div>
        <div id="gogexmd-actions">
          <button class="gogexmd-btn" id="gogexmd-preview">预览</button>
          <button class="gogexmd-btn gogexmd-primary" id="gogexmd-import">导入</button>
        </div>
        <button class="gogexmd-btn" id="gogexmd-export">复制编辑器内容</button>
        <button class="gogexmd-btn gogexmd-danger" id="gogexmd-clear">清空编辑器</button>
        <div id="gogexmd-status"></div>
      </div>
    `;
    document.body.appendChild(panel);

    const drop = document.getElementById('gogexmd-drop');
    drop.addEventListener('dragover', event => {
      event.preventDefault();
      drop.classList.add('hover');
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('hover'));
    drop.addEventListener('drop', event => {
      event.preventDefault();
      drop.classList.remove('hover');
      if (event.dataTransfer.files[0]) readFile(event.dataTransfer.files[0]);
    });

    document.getElementById('gogexmd-file').addEventListener('change', event => {
      if (event.target.files[0]) readFile(event.target.files[0]);
    });
    document.getElementById('gogexmd-paste').addEventListener('click', pasteMarkdown);
    document.getElementById('gogexmd-restore').addEventListener('click', loadLast);
    document.getElementById('gogexmd-preview').addEventListener('click', showPreview);
    document.getElementById('gogexmd-import').addEventListener('click', importArticle);
    document.getElementById('gogexmd-export').addEventListener('click', exportEditorText);
    document.getElementById('gogexmd-clear').addEventListener('click', clearEditors);
    document.getElementById('gogexmd-settings').addEventListener('click', showSettings);
    document.getElementById('gogexmd-collapse').addEventListener('click', () => {
      const body = document.getElementById('gogexmd-body');
      const collapsed = body.style.display === 'none';
      body.style.display = collapsed ? 'block' : 'none';
      document.getElementById('gogexmd-collapse').textContent = collapsed ? '−' : '+';
    });
  }

  function showActions(show) {
    const actions = document.getElementById('gogexmd-actions');
    if (actions) actions.style.display = show ? 'flex' : 'none';
  }

  function setMeta(words, minutes) {
    const meta = document.getElementById('gogexmd-meta');
    const w = document.getElementById('gogexmd-words');
    const t = document.getElementById('gogexmd-time');
    if (!meta || !w || !t) return;
    if (!words) {
      meta.style.display = 'none';
      return;
    }
    w.textContent = `${words} 字`;
    t.textContent = `约 ${minutes} 分钟`;
    meta.style.display = 'flex';
  }

  function setStatus(message, type) {
    const status = document.getElementById('gogexmd-status');
    if (!status) return;
    status.textContent = message;
    status.className = type || '';
  }

  let lastUrl = '';
  let debounceTimer = null;

  function init() {
    if (isArticlePage()) {
      setTimeout(createPanel, 1000);
    }
  }

  new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        document.getElementById('gogexmd-panel')?.remove();
        document.getElementById('gogexmd-preview-modal')?.remove();
        document.getElementById('gogexmd-settings-modal')?.remove();
        init();
      }
    }, 120);
  }).observe(document.body, { childList: true, subtree: true });

  init();
})();
