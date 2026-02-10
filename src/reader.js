/**
 * Chat Novel — Reader UI Controller
 * Manages the full-screen overlay reader interface.
 * Uses context.chat + ST regex scripts for rendering (not DOM scraping).
 */

import { parseChatArray } from './parser.js';
import { applyAllRegex } from './regexEngine.js';
import { processImages, setupLightbox, setupImageClickDelegation } from './imageHandler.js';
import { chapterize } from './chapterizer.js';
import { renderChapter } from './renderer.js';
import { createSidebar } from './sidebar.js';
import { applyTheme, applyTypography, getThemeList } from './themes.js';
import {
    getSettings, updateSetting, saveReadingPosition,
    getReadingPosition, createSettingsPanelHtml,
} from './settings.js';
import { exportToHtml, downloadHtml } from './exporter.js';
import { escapeHtml } from './utils.js';

/**
 * @typedef {Object} ReaderState
 * @property {boolean} isOpen
 * @property {HTMLElement|null} overlay
 * @property {Array} chapters
 * @property {Object} metadata
 * @property {number} currentChapter
 * @property {Object|null} sidebar
 * @property {string} chatId
 * @property {string} characterKey
 * @property {Function|null} _escHandler
 * @property {AbortController|null} _abortController
 */

/** @type {ReaderState} */
const state = {
    isOpen: false,
    overlay: null,
    chapters: [],
    metadata: null,
    currentChapter: 0,
    sidebar: null,
    chatId: '',
    characterKey: '',
    _escHandler: null,
    _abortController: null,
};

/**
 * Open the Chat Novel reader.
 * Parses context.chat, applies regex + markdown, renders in overlay.
 */
export function openReader() {
    if (state.isOpen) return;

    try {
        const context = SillyTavern.getContext();
        const chat = context.chat;
        const characterName = context.characters?.[context.characterId]?.name || context.name2 || 'Character';
        const userName = context.name1 || 'User';

        if (!chat || chat.length === 0) {
            toastr.warning('채팅 데이터가 없습니다.');
            return;
        }

        // Compute characterKey for {{charkey}} macro in regex scripts
        const avatar = context.characters?.[context.characterId]?.avatar;
        state.characterKey = avatar ? avatar.replace(/\.png$/i, '') : characterName;

        // Generate a stable chat ID for position saving
        const chatMeta = chat[0]?.chat_metadata || chat.find(m => m.chat_metadata)?.chat_metadata;
        state.chatId = chatMeta?.chat_id_hash
            || chatMeta?.integrity
            || `${characterName}_${chat[0]?.send_date || 'unknown'}`;

        // Parse messages from context.chat
        const parsed = parseChatArray(chat, userName, characterName);
        state.metadata = parsed.metadata;

        const settings = getSettings();

        // Chapterize
        state.chapters = chapterize(parsed.messages, {
            mode: settings.chapterMode,
            messagesPerChapter: settings.messagesPerChapter,
            timeGapHours: settings.timeGapHours,
        });

        // Create overlay shell (fast — no rendering yet)
        createOverlayShell(settings, userName, characterName);
        state.isOpen = true;
        document.body.classList.add('cn-reader-open');

        // Defer heavy rendering to next frame
        requestAnimationFrame(() => {
            try {
                loadContent(settings, userName, characterName);
            } catch (e) {
                console.error('[ChatNovel] Failed to render:', e);
                const contentEl = state.overlay?.querySelector('.cn-content');
                if (contentEl) {
                    contentEl.innerHTML = `<div style="padding:40px;text-align:center;color:#f44;">오류: ${escapeHtml(e.message)}</div>`;
                }
            }
        });

    } catch (e) {
        console.error('[ChatNovel] Failed to open reader:', e);
        toastr.error(`Chat Novel 오류: ${e.message}`);
    }
}

/**
 * Close the reader overlay.
 */
export function closeReader() {
    if (!state.isOpen || !state.overlay) return;

    // Save reading position
    const contentEl = state.overlay.querySelector('.cn-content');
    if (contentEl) {
        const scrollTop = contentEl.scrollTop;
        const scrollHeight = contentEl.scrollHeight - contentEl.clientHeight;
        const progress = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;

        saveReadingPosition(state.chatId, {
            chapterIndex: state.currentChapter,
            scrollTop: scrollTop,
            progress: progress,
        });
    }

    state.overlay.classList.add('cn-overlay-closing');
    setTimeout(() => {
        if (state.overlay && state.overlay.parentNode) {
            state.overlay.parentNode.removeChild(state.overlay);
        }
        state.overlay = null;
        state.isOpen = false;
        state.chapters = [];
        state.sidebar = null;

        // Clean up ESC handler
        if (state._escHandler) {
            document.removeEventListener('keydown', state._escHandler);
            state._escHandler = null;
        }

        // Clean up all AbortController-managed listeners (lightbox etc.)
        if (state._abortController) {
            state._abortController.abort();
            state._abortController = null;
        }

        // Clean up lightbox
        if (window.ChatNovelLightbox) {
            delete window.ChatNovelLightbox;
        }

        // Remove body scroll lock
        document.body.classList.remove('cn-reader-open');
    }, 300);
}

/**
 * Create the overlay shell (header, empty content, footer, event bindings).
 * Does NOT parse or render content — that's deferred to loadContent().
 * @param {Object} settings
 * @param {string} userName
 * @param {string} characterName
 */
function createOverlayShell(settings, userName, characterName) {
    const overlay = document.createElement('div');
    overlay.className = 'cn-overlay';
    overlay.id = 'chat-novel-overlay';

    overlay.innerHTML = `
        <div class="cn-header">
            <div class="cn-header-left">
                <button class="cn-btn cn-sidebar-btn" title="사이드바 토글">≡</button>
                <span class="cn-header-title">📖 Chat Novel — ${escapeHtml(characterName)}</span>
            </div>
            <div class="cn-header-right">
                <button class="cn-btn cn-theme-btn" title="테마 변경">🎨</button>
                <button class="cn-btn cn-settings-btn" title="설정">⚙️</button>
                <button class="cn-btn cn-export-btn" title="HTML 내보내기">📤</button>
                <button class="cn-btn cn-close-btn" title="닫기 (ESC)">✕</button>
            </div>
        </div>
        <div class="cn-progress-bar-container">
            <div class="cn-progress-bar"></div>
        </div>
        <div class="cn-body">
            <div class="cn-sidebar-container"></div>
            <div class="cn-content">
                <div class="cn-loading">로딩 중...</div>
            </div>
        </div>
        <div class="cn-footer">
            <div class="cn-footer-progress">
                <div class="cn-footer-progress-fill"></div>
            </div>
            <div class="cn-footer-text"></div>
        </div>
    `;

    document.body.appendChild(overlay);
    state.overlay = overlay;

    // Apply theme and typography
    applyTheme(overlay, settings.theme);
    applyTypography(overlay, settings);

    // Setup lightbox (with AbortController for cleanup)
    state._abortController = setupLightbox(overlay);

    // Bind button events
    overlay.querySelector('.cn-close-btn').addEventListener('click', closeReader);
    overlay.querySelector('.cn-sidebar-btn').addEventListener('click', () => {
        state.sidebar?.toggle();
    });
    overlay.querySelector('.cn-theme-btn').addEventListener('click', () => {
        showThemePanel();
    });
    overlay.querySelector('.cn-settings-btn').addEventListener('click', () => {
        showSettingsPanel(userName, characterName);
    });
    overlay.querySelector('.cn-export-btn').addEventListener('click', () => {
        handleExport(userName, characterName);
    });

    // ESC to close (store handler reference for cleanup)
    state._escHandler = (e) => {
        if (e.key === 'Escape') {
            closeReader();
        }
    };
    document.addEventListener('keydown', state._escHandler);

    // Animate in
    requestAnimationFrame(() => {
        overlay.classList.add('cn-overlay-active');
    });
}

/**
 * Render parsed content into the overlay.
 * @param {Object} settings
 * @param {string} userName
 * @param {string} characterName
 */
function loadContent(settings, userName, characterName) {
    // Update header title with parsed metadata
    const title = state.metadata?.character_name || characterName;
    const titleEl = state.overlay.querySelector('.cn-header-title');
    if (titleEl) titleEl.textContent = `\ud83d\udcd6 Chat Novel \u2014 ${title}`;

    // Render content
    const contentEl = state.overlay.querySelector('.cn-content');
    renderAllChapters(contentEl, settings, userName, characterName);

    // Setup sidebar
    const sidebarContainer = state.overlay.querySelector('.cn-sidebar-container');
    state.sidebar = createSidebar(sidebarContainer, state.chapters, (chapterIdx) => {
        scrollToChapter(chapterIdx);
    });
    sidebarContainer.appendChild(state.sidebar.element);

    // Setup scroll tracking + keyboard
    setupScrollTracking(contentEl);
    setupKeyboardShortcuts(contentEl);

    // Restore reading position
    const savedPos = getReadingPosition(state.chatId);
    if (savedPos && savedPos.scrollTop) {
        setTimeout(() => {
            contentEl.scrollTop = savedPos.scrollTop;
        }, 100);
    }

    console.log(`[ChatNovel] Opened reader: ${state.chapters.reduce((a, c) => a + c.messages.length, 0)} messages, ${state.chapters.length} chapters`);
}

/**
 * Render all chapters into the content area.
 * @param {HTMLElement} contentEl
 * @param {Object} settings
 * @param {string} userName
 * @param {string} characterName
 */
function renderAllChapters(contentEl, settings, userName, characterName) {
    contentEl.innerHTML = '';

    const renderOptions = {
        userName,
        characterName,
        characterKey: state.characterKey,
        showSenderName: settings.showSenderName,
        dialogueEnabled: settings.dialogueEnabled,
        regexProcessor: (text, opts) => {
            // 1. Apply ST regex scripts
            let processed = applyAllRegex(text, opts);
            // 2. Image pattern fallback (if regex didn't handle it)
            if (settings.showImages !== false) {
                processed = processImages(processed, characterName);
            }
            return processed;
        },
    };

    for (const chapter of state.chapters) {
        const chapterHtml = renderChapter(chapter, renderOptions);
        contentEl.insertAdjacentHTML('beforeend', chapterHtml);
    }

    // Set up image click delegation for lightbox
    setupImageClickDelegation(contentEl);

    // Convert pending HTML blocks (from regex scripts) into live iframes
    postProcessHtmlBlocks(contentEl);
}

/**
 * Convert hidden HTML block placeholders into live iframes.
 * Regex scripts output complete HTML documents (<!DOCTYPE html>...)</n * which are stored as escaped text content during markdown rendering.
 * This function creates iframes and writes the HTML directly via document.write(),
 * avoiding srcdoc attribute escaping issues.
 * @param {HTMLElement} contentEl
 */
function postProcessHtmlBlocks(contentEl) {
    const pendingEls = contentEl.querySelectorAll('.cn-regex-html-pending');
    if (pendingEls.length === 0) return;

    console.log(`[ChatNovel] Post-processing ${pendingEls.length} HTML blocks into iframes`);

    pendingEls.forEach((el) => {
        const html = el.textContent; // textContent auto-decodes HTML entities
        const iframe = document.createElement('iframe');
        iframe.className = 'cn-regex-iframe';
        el.replaceWith(iframe);

        // Write HTML directly — no attribute escaping needed
        const doc = iframe.contentDocument || iframe.contentWindow.document;
        doc.open();
        doc.write(html);
        doc.close();

        // Auto-resize iframe to content height (multiple attempts for async rendering)
        const resize = () => {
            try {
                const h = doc.documentElement.scrollHeight;
                if (h > 0) iframe.style.height = h + 'px';
            } catch (e) { /* cross-origin or detached */ }
        };
        iframe.addEventListener('load', resize);
        setTimeout(resize, 300);
        setTimeout(resize, 1000);
        setTimeout(resize, 3000);
    });
}

/**
 * Set up scroll tracking for progress and chapter detection.
 * @param {HTMLElement} contentEl
 */
function setupScrollTracking(contentEl) {
    let ticking = false;

    contentEl.addEventListener('scroll', () => {
        if (!ticking) {
            requestAnimationFrame(() => {
                updateProgress(contentEl);
                ticking = false;
            });
            ticking = true;
        }
    });
}

/**
 * Update progress bar and current chapter.
 * @param {HTMLElement} contentEl
 */
function updateProgress(contentEl) {
    if (!state.overlay) return;

    const scrollTop = contentEl.scrollTop;
    const scrollHeight = contentEl.scrollHeight - contentEl.clientHeight;
    const progress = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;

    // Update progress bars
    const progressBar = state.overlay.querySelector('.cn-progress-bar');
    const footerFill = state.overlay.querySelector('.cn-footer-progress-fill');
    if (progressBar) progressBar.style.width = `${progress}%`;
    if (footerFill) footerFill.style.width = `${progress}%`;

    // Detect current chapter
    const chapterEls = contentEl.querySelectorAll('.cn-chapter');
    let currentIdx = 0;

    chapterEls.forEach((el, i) => {
        const rect = el.getBoundingClientRect();
        const contentRect = contentEl.getBoundingClientRect();
        if (rect.top - contentRect.top <= 100) {
            currentIdx = i;
        }
    });

    if (currentIdx !== state.currentChapter) {
        state.currentChapter = currentIdx;
        state.sidebar?.highlightChapter(currentIdx);
    }

    // Update footer text
    const footerText = state.overlay.querySelector('.cn-footer-text');
    if (footerText) {
        footerText.textContent = `Ch.${currentIdx + 1} / ${state.chapters.length}  ${progress.toFixed(0)}%`;
    }
}

/**
 * Scroll to a specific chapter.
 * @param {number} chapterIdx
 */
function scrollToChapter(chapterIdx) {
    if (!state.overlay) return;

    const contentEl = state.overlay.querySelector('.cn-content');
    const chapterEl = state.overlay.querySelector(`#cn-chapter-${chapterIdx}`);
    if (chapterEl && contentEl) {
        // Use manual scrollTop to avoid scrollIntoView moving the outer page on mobile
        const chapterTop = chapterEl.offsetTop - contentEl.offsetTop;
        contentEl.scrollTo({ top: chapterTop, behavior: 'smooth' });
    }
}

/**
 * Set up keyboard shortcuts for the reader.
 * @param {HTMLElement} contentEl
 */
function setupKeyboardShortcuts(contentEl) {
    contentEl.addEventListener('keydown', (e) => {
        switch (e.key) {
            case ' ':
            case 'PageDown':
                e.preventDefault();
                contentEl.scrollBy({ top: contentEl.clientHeight * 0.85, behavior: 'smooth' });
                break;
            case 'PageUp':
                e.preventDefault();
                contentEl.scrollBy({ top: -contentEl.clientHeight * 0.85, behavior: 'smooth' });
                break;
            case 'ArrowDown':
                contentEl.scrollBy({ top: 60, behavior: 'smooth' });
                break;
            case 'ArrowUp':
                contentEl.scrollBy({ top: -60, behavior: 'smooth' });
                break;
            case 'Home':
                e.preventDefault();
                contentEl.scrollTop = 0;
                break;
            case 'End':
                e.preventDefault();
                contentEl.scrollTop = contentEl.scrollHeight;
                break;
        }
    });

    // Make content focusable for keyboard events
    contentEl.tabIndex = 0;
    contentEl.focus();
}

/**
 * Show the theme quick-switcher.
 */
function showThemePanel() {
    const existing = state.overlay?.querySelector('.cn-theme-popup');
    if (existing) {
        existing.remove();
        return;
    }

    const themes = getThemeList();
    const settings = getSettings();

    const popup = document.createElement('div');
    popup.className = 'cn-theme-popup';
    popup.innerHTML = `
        <div class="cn-popup-title">🎨 테마</div>
        ${themes.map(t => `
            <div class="cn-theme-popup-item ${t.id === settings.theme ? 'active' : ''}" data-theme="${t.id}">
                <strong>${t.name}</strong>
                <small>${t.description}</small>
            </div>
        `).join('')}
    `;

    popup.querySelectorAll('.cn-theme-popup-item').forEach(item => {
        item.addEventListener('click', () => {
            const themeId = item.dataset.theme;
            updateSetting('theme', themeId);
            applyTheme(state.overlay, themeId);

            // Update active state
            popup.querySelectorAll('.cn-theme-popup-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
        });
    });

    // Close on click outside
    const closeHandler = (e) => {
        if (!popup.contains(e.target) && !e.target.closest('.cn-theme-btn')) {
            popup.remove();
            document.removeEventListener('click', closeHandler);
        }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);

    state.overlay.querySelector('.cn-header').appendChild(popup);
}

/**
 * Show the settings panel.
 * @param {string} userName
 * @param {string} characterName
 */
function showSettingsPanel(userName, characterName) {
    const existing = state.overlay?.querySelector('.cn-settings-panel');
    if (existing) {
        existing.remove();
        return;
    }

    const settings = getSettings();
    const themeList = getThemeList();

    const panelContainer = document.createElement('div');
    panelContainer.className = 'cn-settings-overlay';
    panelContainer.innerHTML = createSettingsPanelHtml(settings, themeList);

    state.overlay.appendChild(panelContainer);

    // Close button
    panelContainer.querySelector('.cn-settings-close').addEventListener('click', () => {
        panelContainer.remove();
    });

    // Range inputs — show value and save
    panelContainer.querySelectorAll('input[type="range"]').forEach(input => {
        const valueSpan = input.nextElementSibling;
        input.addEventListener('input', () => {
            const key = input.dataset.setting;
            let value = parseFloat(input.value);
            updateSetting(key, value);

            // Update value display
            if (valueSpan?.classList.contains('cn-setting-value')) {
                if (key === 'fontSize') valueSpan.textContent = `${value}px`;
                else if (key === 'contentWidth') valueSpan.textContent = `${value}px`;
                else if (key === 'timeGapHours') valueSpan.textContent = `${value}h`;
                else valueSpan.textContent = `${value}`;
            }

            // Live preview typography changes
            if (['fontSize', 'lineHeight', 'contentWidth'].includes(key)) {
                applyTypography(state.overlay, getSettings());
            }
        });
    });

    // Select inputs
    panelContainer.querySelectorAll('select.cn-setting-input').forEach(select => {
        select.addEventListener('change', () => {
            const key = select.dataset.setting;
            updateSetting(key, select.value);

            if (key === 'fontFamily') {
                applyTypography(state.overlay, getSettings());
            }

            // Re-render if chapter settings changed
            if (['chapterMode'].includes(key)) {
                reRender(userName, characterName);
            }
        });
    });

    // Checkbox inputs
    panelContainer.querySelectorAll('input[type="checkbox"].cn-setting-input').forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            const key = checkbox.dataset.setting;
            updateSetting(key, checkbox.checked);
            reRender(userName, characterName);
        });
    });

    // Theme grid
    panelContainer.querySelectorAll('.cn-theme-option').forEach(option => {
        option.addEventListener('click', () => {
            const themeId = option.dataset.theme;
            updateSetting('theme', themeId);
            applyTheme(state.overlay, themeId);

            panelContainer.querySelectorAll('.cn-theme-option').forEach(o => o.classList.remove('cn-theme-active'));
            option.classList.add('cn-theme-active');
        });
    });
}

/**
 * Re-render content with current settings.
 * @param {string} userName
 * @param {string} characterName
 */
function reRender(userName, characterName) {
    const settings = getSettings();

    // DOM 재파싱 안 함 — 기존 파싱 데이터에서 메시지만 추출하여 재분할
    const allMessages = state.chapters.flatMap(ch => ch.messages);

    state.chapters = chapterize(allMessages, {
        mode: settings.chapterMode,
        messagesPerChapter: settings.messagesPerChapter,
        timeGapHours: settings.timeGapHours,
    });

    const contentEl = state.overlay.querySelector('.cn-content');
    renderAllChapters(contentEl, settings, userName, characterName);

    // Rebuild sidebar
    const sidebarContainer = state.overlay.querySelector('.cn-sidebar-container');
    sidebarContainer.innerHTML = '';
    state.sidebar = createSidebar(sidebarContainer, state.chapters, (chapterIdx) => {
        scrollToChapter(chapterIdx);
    });
    sidebarContainer.appendChild(state.sidebar.element);
}

/**
 * Handle HTML export.
 * @param {string} userName
 * @param {string} characterName
 */
async function handleExport(userName, characterName) {
    try {
        const settings = getSettings();
        const title = state.metadata?.character_name || characterName;

        toastr.info('HTML 파일 생성 중...');

        // Build the full rendered HTML
        const contentEl = state.overlay.querySelector('.cn-content');
        const renderedHtml = contentEl.innerHTML;

        const html = await exportToHtml({
            title,
            renderedHtml,
            chapters: state.chapters,
            theme: settings.theme,
            typography: {
                fontSize: settings.fontSize,
                lineHeight: settings.lineHeight,
                contentWidth: settings.contentWidth,
                fontFamily: settings.fontFamily,
            },
            imageMode: settings.exportImageMode,
        });

        const filename = `${title.replace(/[<>:"/\\|?*]/g, '_')}_novel.html`;
        downloadHtml(html, filename);

        toastr.success('HTML 파일이 다운로드되었습니다!');
    } catch (e) {
        console.error('[ChatNovel] Export failed:', e);
        toastr.error(`내보내기 실패: ${e.message}`);
    }
}

/**
 * Check if reader is currently open.
 * @returns {boolean}
 */
export function isReaderOpen() {
    return state.isOpen;
}
