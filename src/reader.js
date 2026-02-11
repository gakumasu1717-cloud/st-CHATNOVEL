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
    getBookmarks, addBookmark, removeBookmark,
    getChapterNames, setChapterName,
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
    // 페이지 모드
    pageMode: false,
    currentPage: 0,
    totalPages: 0,
    _pageClickHandler: null,
    _pageKeyHandler: null,
    _pageTouchStart: null,
    _pageTouchEnd: null,
    _resizeHandler: null,
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

    // Save reading position (msgIndex-based)
    const contentEl = state.overlay.querySelector('.cn-content');
    if (contentEl) {
        const scrollTop = state.pageMode ? state.currentPage : contentEl.scrollTop;
        const scrollHeight = contentEl.scrollHeight - contentEl.clientHeight;
        const progress = state.pageMode
            ? (state.totalPages > 1 ? (state.currentPage / (state.totalPages - 1)) * 100 : 100)
            : (scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0);

        // Find nearest visible message index
        let msgIndex = 0;
        const contentRect = contentEl.getBoundingClientRect();
        const msgEls = contentEl.querySelectorAll('[data-msg-index]');
        for (const el of msgEls) {
            const rect = el.getBoundingClientRect();
            if (rect.top >= contentRect.top) {
                msgIndex = parseInt(el.dataset.msgIndex, 10) || 0;
                break;
            }
        }

        saveReadingPosition(state.chatId, {
            chapterIndex: state.currentChapter,
            scrollTop: contentEl.scrollTop,
            progress: progress,
            msgIndex: msgIndex,
            page: state.pageMode ? state.currentPage : undefined,
        });
    }

    // Clean up page mode
    if (state.pageMode) {
        const cEl = state.overlay.querySelector('.cn-content');
        if (cEl) cleanupPageNavigation(cEl);
    }

    // Clean up resize handler
    if (state._resizeHandler) {
        window.removeEventListener('resize', state._resizeHandler);
        state._resizeHandler = null;
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
        state.pageMode = false;
        state.currentPage = 0;
        state.totalPages = 0;

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
            <div class="cn-footer-info">
                <button class="cn-footer-mode-btn" title="읽기 모드 전환">📖</button>
                <span class="cn-footer-chapter"></span>
                <span class="cn-footer-separator">·</span>
                <span class="cn-footer-percent">0%</span>
                <span class="cn-footer-separator">·</span>
                <span class="cn-footer-remaining"></span>
                <span class="cn-footer-page-info" style="display:none"></span>
            </div>
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

    // Mode toggle button in footer
    overlay.querySelector('.cn-footer-mode-btn').addEventListener('click', () => {
        const s = getSettings();
        const newMode = s.readingMode === 'scroll' ? 'page' : 'scroll';
        updateSetting('readingMode', newMode);
        const contentEl = overlay.querySelector('.cn-content');
        if (newMode === 'page') {
            enablePageMode(contentEl);
        } else {
            disablePageMode(contentEl);
        }
    });

    // Window resize handler for page mode
    state._resizeHandler = () => {
        if (state.pageMode && state.overlay) {
            const contentEl = state.overlay.querySelector('.cn-content');
            if (contentEl) {
                recalcPageLayout(contentEl);
                goToPage(contentEl, state.currentPage);
            }
        }
    };
    window.addEventListener('resize', state._resizeHandler);

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

    // Apply custom chapter names
    const customNames = getChapterNames(state.chatId);
    for (const ch of state.chapters) {
        if (customNames[ch.index] != null) {
            ch.title = customNames[ch.index];
        }
    }

    // Setup sidebar with bookmarks, chapter rename
    const sidebarContainer = state.overlay.querySelector('.cn-sidebar-container');
    state.sidebar = createSidebar(sidebarContainer, state.chapters, (chapterIdx) => {
        scrollToChapter(chapterIdx);
    }, {
        bookmarks: getBookmarks(state.chatId),
        chapterNames: customNames,
        onBookmarkClick: (msgIndex) => {
            const contentEl = state.overlay.querySelector('.cn-content');
            const msgEl = contentEl.querySelector(`[data-msg-index="${msgIndex}"]`);
            if (msgEl) {
                if (state.pageMode) {
                    // Find which page contains this message
                    const rect = contentEl.getBoundingClientRect();
                    const pageUnit = rect.width * 2;
                    const msgLeft = msgEl.offsetLeft;
                    const page = Math.floor(msgLeft / pageUnit);
                    goToPage(contentEl, page);
                } else {
                    msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
                msgEl.classList.add('cn-msg-highlight');
                setTimeout(() => msgEl.classList.remove('cn-msg-highlight'), 2000);
            }
        },
        onBookmarkRemove: (msgIndex) => {
            removeBookmark(state.chatId, msgIndex);
        },
        onChapterRename: (chapterIdx, newName) => {
            setChapterName(state.chatId, chapterIdx, newName);
            // Update the chapter title in DOM as well
            const chapterTitleEl = state.overlay.querySelector(`#cn-chapter-${chapterIdx} .cn-chapter-title`);
            if (chapterTitleEl) chapterTitleEl.textContent = newName;
            // Update state
            if (state.chapters[chapterIdx]) state.chapters[chapterIdx].title = newName;
        },
    });
    sidebarContainer.appendChild(state.sidebar.element);

    // Setup scroll tracking + keyboard
    setupScrollTracking(contentEl);
    setupKeyboardShortcuts(contentEl);

    // 읽기 모드 초기화
    if (settings.readingMode === 'page') {
        setTimeout(() => enablePageMode(contentEl), 200);
    }

    // Restore reading position — try msgIndex first, then scrollTop/page
    const savedPos = getReadingPosition(state.chatId);
    if (savedPos) {
        setTimeout(() => {
            if (state.pageMode && savedPos.page != null) {
                goToPage(contentEl, savedPos.page);
                return;
            }
            if (savedPos.msgIndex != null) {
                const targetEl = contentEl.querySelector(`[data-msg-index="${savedPos.msgIndex}"]`);
                if (targetEl) {
                    const offsetTop = targetEl.offsetTop - contentEl.offsetTop;
                    contentEl.scrollTop = offsetTop;
                    return;
                }
            }
            if (savedPos.scrollTop) {
                contentEl.scrollTop = savedPos.scrollTop;
            }
        }, 300);
    }

    // Update footer info
    updateFooterInfo(contentEl);

    // Setup bookmark context menu on messages
    setupBookmarkContextMenu(contentEl);

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

    // Set up iframe auto-resize for regex-output HTML documents
    setupIframeAutoResize(contentEl);
}

/**
 * Set up auto-resize for all .cn-regex-iframe elements.
 * Uses MutationObserver to also handle dynamically added iframes.
 * @param {HTMLElement} contentEl
 */
function setupIframeAutoResize(contentEl) {
    // Handle already-existing iframes
    contentEl.querySelectorAll('.cn-regex-iframe').forEach(setupSingleIframe);

    // Watch for newly added iframes (from dynamic content insertion)
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType !== Node.ELEMENT_NODE) continue;
                if (node.classList?.contains('cn-regex-iframe')) {
                    setupSingleIframe(node);
                }
                const nested = node.querySelectorAll?.('.cn-regex-iframe');
                if (nested) nested.forEach(setupSingleIframe);
            }
        }
    });
    observer.observe(contentEl, { childList: true, subtree: true });
}

/**
 * Set up a single iframe for auto-height resizing.
 * Reads internal scrollHeight after load and watches for dynamic content changes
 * (collapsible panels, etc.) via ResizeObserver.
 * @param {HTMLIFrameElement} iframe
 */
function setupSingleIframe(iframe) {
    // Disable scrolling via HTML attribute
    iframe.setAttribute('scrolling', 'no');

    // Base64로 저장된 HTML을 contentDocument.write()로 주입
    const b64 = iframe.getAttribute('data-cn-html');
    if (b64) {
        iframe.removeAttribute('data-cn-html');
        try {
            const html = decodeURIComponent(escape(atob(b64)));
            // sandbox 속성은 HTML attribute로 이미 설정됨
            // contentDocument.write 사용을 위해 잠시 srcdoc 비우기
            const doc = iframe.contentDocument || iframe.contentWindow?.document;
            if (doc) {
                doc.open();
                doc.write(html);
                doc.close();
            }
        } catch (e) {
            console.warn('[ChatNovel] iframe write failed, fallback to srcdoc:', e);
            // fallback: srcdoc에 직접 넣기
            try {
                const html = decodeURIComponent(escape(atob(b64)));
                iframe.srcdoc = html;
            } catch (_) { /* give up */ }
        }
    }

    const resize = () => {
        try {
            const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
            if (!iframeDoc || !iframeDoc.body) return;

            // Shrink to 1px so scrollHeight reflects natural content height
            iframe.style.height = '1px';

            // 내부 스타일을 건드리지 않고 높이만 측정
            const bodyH = iframeDoc.body.scrollHeight || 0;
            const docH = iframeDoc.documentElement.scrollHeight || 0;
            const h = Math.max(bodyH, docH);

            // +2px 여유 — 소수점 반올림 오차로 스크롤바 생기는 것 방지
            iframe.style.height = (h > 20 ? h + 2 : 400) + 'px';
        } catch (e) {
            console.warn('[ChatNovel] iframe resize failed:', e);
            iframe.style.height = '400px';
        }
    };

    // ResizeObserver 부착 (한 번만)
    const tryObserve = () => {
        try {
            const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
            if (iframeDoc?.body && window.ResizeObserver && !iframe._cnObserved) {
                iframe._cnObserved = true;
                const ro = new ResizeObserver(() => resize());
                ro.observe(iframeDoc.body);
                if (iframeDoc.documentElement) ro.observe(iframeDoc.documentElement);
                setTimeout(() => ro.disconnect(), 30000);
            }
        } catch (_) { /* cross-origin */ }
    };

    // MutationObserver — 내부 JS가 DOM을 동적으로 빌드하는 경우
    const tryMutationObserve = () => {
        try {
            const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
            if (iframeDoc?.body && !iframe._cnMoObserved) {
                iframe._cnMoObserved = true;
                const mo = new MutationObserver(() => resize());
                mo.observe(iframeDoc.body, { childList: true, subtree: true, attributes: true });
                setTimeout(() => mo.disconnect(), 15000);
            }
        } catch (_) { /* cross-origin */ }
    };

    // load 이벤트 백업
    iframe.addEventListener('load', () => {
        resize();
        tryObserve();
        tryMutationObserve();
    });

    // 공격적 재시도 — srcdoc는 동기적으로 load할 수 있음
    const delays = [0, 50, 100, 200, 500, 1000, 2000, 4000];
    delays.forEach(d => {
        if (d === 0) {
            resize(); tryObserve(); tryMutationObserve();
        } else {
            setTimeout(() => { resize(); tryObserve(); tryMutationObserve(); }, d);
        }
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

    // 페이지 모드에서는 별도 처리
    if (state.pageMode) {
        updatePageInfo(contentEl);
        return;
    }

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

    // Update footer info
    updateFooterInfo(contentEl, progress);
}

/**
 * Update footer info bar (chapter · percent · remaining).
 * @param {HTMLElement} contentEl
 * @param {number} [progress]
 */
function updateFooterInfo(contentEl, progress) {
    if (!state.overlay) return;

    if (progress == null) {
        const scrollHeight = contentEl.scrollHeight - contentEl.clientHeight;
        progress = scrollHeight > 0 ? (contentEl.scrollTop / scrollHeight) * 100 : 0;
    }

    const chapterEl = state.overlay.querySelector('.cn-footer-chapter');
    const percentEl = state.overlay.querySelector('.cn-footer-percent');
    const remainingEl = state.overlay.querySelector('.cn-footer-remaining');

    if (chapterEl) {
        chapterEl.textContent = `${state.currentChapter + 1}/${state.chapters.length}장`;
    }
    if (percentEl) {
        percentEl.textContent = `${Math.round(progress)}%`;
    }
    if (remainingEl) {
        // Estimate remaining time (500 chars/min reading speed)
        const totalChars = state.chapters.reduce((a, ch) =>
            a + ch.messages.reduce((b, m) => b + (m.mes?.length || 0), 0), 0);
        const remainingChars = totalChars * (1 - progress / 100);
        const remainingMin = Math.ceil(remainingChars / 500);
        if (remainingMin > 60) {
            remainingEl.textContent = `약${Math.ceil(remainingMin / 60)}시간`;
        } else {
            remainingEl.textContent = `약${remainingMin}분`;
        }
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
        // 페이지 모드에서는 별도 핸들러가 처리
        if (state.pageMode) return;

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

// ===== Page Mode =====

/**
 * 페이지 모드를 활성화한다.
 * CSS columns 기반으로 콘텐츠를 페이지로 분할한다.
 * @param {HTMLElement} contentEl
 */
function enablePageMode(contentEl) {
    state.pageMode = true;
    state.currentPage = 0;

    const overlay = state.overlay;
    overlay.classList.add('cn-page-mode');

    // 콘텐츠 영역을 column 레이아웃으로 전환
    recalcPageLayout(contentEl);

    // 터치/클릭/키보드 이벤트 바인딩
    setupPageNavigation(contentEl);

    // 첫 페이지 표시
    goToPage(contentEl, 0);

    // 하단 정보 갱신
    updatePageInfo(contentEl);

    // 모드 버튼 아이콘 변경 (스크롤 아이콘으로)
    const modeBtn = overlay.querySelector('.cn-footer-mode-btn');
    if (modeBtn) modeBtn.textContent = '📜';

    // 스크롤 모드 전용 요소 숨김, 페이지 모드 전용 표시
    overlay.querySelector('.cn-footer-percent')?.style.setProperty('display', 'none');
    overlay.querySelector('.cn-footer-remaining')?.style.setProperty('display', 'none');
    overlay.querySelectorAll('.cn-footer-separator').forEach(s => s.style.display = 'none');
    overlay.querySelector('.cn-footer-page-info')?.style.setProperty('display', '');
}

/**
 * 페이지 레이아웃 계산.
 * @param {HTMLElement} contentEl
 */
function recalcPageLayout(contentEl) {
    const rect = contentEl.getBoundingClientRect();
    const pageWidth = rect.width;
    const pageHeight = rect.height;

    contentEl.style.overflow = 'hidden';
    contentEl.style.height = pageHeight + 'px';
    contentEl.style.columnWidth = pageWidth + 'px';
    contentEl.style.columnGap = pageWidth + 'px';
    contentEl.style.columnFill = 'auto';
    contentEl.style.paddingBottom = '0';

    // iframe 로드 완료 후 재계산 (내부 높이가 바뀌면 column 수가 달라짐)
    const iframes = contentEl.querySelectorAll('.cn-regex-iframe');
    const doCalc = () => {
        const totalWidth = contentEl.scrollWidth;
        const pageUnit = pageWidth * 2; // column + gap
        state.totalPages = Math.max(1, Math.ceil(totalWidth / pageUnit));
        updatePageInfo(contentEl);
    };

    // 즉시 한 번 + iframe 로드마다 재계산
    requestAnimationFrame(doCalc);
    iframes.forEach(iframe => {
        iframe.addEventListener('load', () => {
            setTimeout(doCalc, 100);
            setTimeout(doCalc, 500);
        });
    });
    // 안전망 — 2초 후 최종 재계산
    setTimeout(doCalc, 2000);
}

/**
 * 페이지 모드 비활성화 — 스크롤 모드로 복귀.
 * @param {HTMLElement} contentEl
 */
function disablePageMode(contentEl) {
    state.pageMode = false;
    const overlay = state.overlay;
    overlay.classList.remove('cn-page-mode');

    // CSS 초기화
    contentEl.style.removeProperty('height');
    contentEl.style.removeProperty('column-width');
    contentEl.style.removeProperty('column-gap');
    contentEl.style.removeProperty('column-fill');
    contentEl.style.removeProperty('overflow');
    contentEl.style.removeProperty('transform');
    contentEl.style.paddingBottom = '';

    // 모드 버튼 아이콘 복귀
    const modeBtn = overlay.querySelector('.cn-footer-mode-btn');
    if (modeBtn) modeBtn.textContent = '📖';

    // 스크롤 모드 요소 복귀
    overlay.querySelector('.cn-footer-percent')?.style.setProperty('display', '');
    overlay.querySelector('.cn-footer-remaining')?.style.setProperty('display', '');
    overlay.querySelectorAll('.cn-footer-separator').forEach(s => s.style.display = '');
    overlay.querySelector('.cn-footer-page-info')?.style.setProperty('display', 'none');

    // 이벤트 정리
    cleanupPageNavigation(contentEl);
}

/**
 * 특정 페이지로 이동.
 * @param {HTMLElement} contentEl
 * @param {number} pageNum
 */
function goToPage(contentEl, pageNum) {
    if (pageNum < 0) pageNum = 0;
    if (pageNum >= state.totalPages) pageNum = state.totalPages - 1;

    state.currentPage = pageNum;
    const rect = contentEl.getBoundingClientRect();
    const pageUnit = rect.width * 2; // column + gap
    const offset = pageNum * pageUnit;

    contentEl.style.transform = `translateX(-${offset}px)`;
    updatePageInfo(contentEl);
}

/**
 * 페이지 정보 갱신 (하단 바).
 * @param {HTMLElement} contentEl
 */
function updatePageInfo(contentEl) {
    if (!state.pageMode || !state.overlay) return;

    const pageInfo = state.overlay.querySelector('.cn-footer-page-info');
    if (pageInfo) {
        pageInfo.textContent = `${state.currentPage + 1} / ${state.totalPages || '?'}`;
    }

    const chapterEl = state.overlay.querySelector('.cn-footer-chapter');
    if (chapterEl) {
        chapterEl.textContent = `${state.currentChapter + 1}/${state.chapters.length}장`;
    }

    // 프로그레스바도 갱신
    const progress = state.totalPages > 1
        ? (state.currentPage / (state.totalPages - 1)) * 100
        : 100;
    const progressBar = state.overlay.querySelector('.cn-progress-bar');
    const footerFill = state.overlay.querySelector('.cn-footer-progress-fill');
    if (progressBar) progressBar.style.width = `${progress}%`;
    if (footerFill) footerFill.style.width = `${progress}%`;
}

/**
 * 페이지 네비게이션 이벤트 설정.
 * 좌측 1/3 탭 = 이전, 우측 2/3 탭 = 다음.
 * @param {HTMLElement} contentEl
 */
function setupPageNavigation(contentEl) {
    // 클릭 네비게이션
    state._pageClickHandler = (e) => {
        if (e.target.closest('button, a, input, select, textarea, .cn-settings-overlay, .cn-sidebar, .cn-footer')) return;

        const rect = contentEl.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const thirdWidth = rect.width / 3;

        if (clickX < thirdWidth) {
            goToPage(contentEl, state.currentPage - 1);
        } else {
            goToPage(contentEl, state.currentPage + 1);
        }
    };
    contentEl.addEventListener('click', state._pageClickHandler);

    // 키보드 네비게이션
    state._pageKeyHandler = (e) => {
        if (!state.pageMode) return;
        if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
            e.preventDefault();
            goToPage(contentEl, state.currentPage + 1);
        } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
            e.preventDefault();
            goToPage(contentEl, state.currentPage - 1);
        } else if (e.key === 'Home') {
            e.preventDefault();
            goToPage(contentEl, 0);
        } else if (e.key === 'End') {
            e.preventDefault();
            goToPage(contentEl, state.totalPages - 1);
        }
    };
    contentEl.addEventListener('keydown', state._pageKeyHandler);

    // 터치 스와이프
    let touchStartX = 0;
    let touchStartY = 0;
    state._pageTouchStart = (e) => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    };
    state._pageTouchEnd = (e) => {
        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = e.changedTouches[0].clientY - touchStartY;
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) {
            if (dx < 0) {
                goToPage(contentEl, state.currentPage + 1);
            } else {
                goToPage(contentEl, state.currentPage - 1);
            }
        }
    };
    contentEl.addEventListener('touchstart', state._pageTouchStart, { passive: true });
    contentEl.addEventListener('touchend', state._pageTouchEnd, { passive: true });
}

/**
 * 페이지 네비게이션 이벤트 정리.
 * @param {HTMLElement} contentEl
 */
function cleanupPageNavigation(contentEl) {
    if (state._pageClickHandler) {
        contentEl.removeEventListener('click', state._pageClickHandler);
        state._pageClickHandler = null;
    }
    if (state._pageKeyHandler) {
        contentEl.removeEventListener('keydown', state._pageKeyHandler);
        state._pageKeyHandler = null;
    }
    if (state._pageTouchStart) {
        contentEl.removeEventListener('touchstart', state._pageTouchStart);
        state._pageTouchStart = null;
    }
    if (state._pageTouchEnd) {
        contentEl.removeEventListener('touchend', state._pageTouchEnd);
        state._pageTouchEnd = null;
    }
}

/**
 * Show the theme quick-switcher.
 */
// ===== Bookmark Context Menu =====

/**
 * Set up right-click context menu on messages for adding bookmarks.
 * @param {HTMLElement} contentEl
 */
function setupBookmarkContextMenu(contentEl) {
    contentEl.addEventListener('contextmenu', (e) => {
        const msgEl = e.target.closest('.cn-message[data-msg-index]');
        if (!msgEl) return;

        e.preventDefault();

        // Remove any existing context menu
        const existing = state.overlay.querySelector('.cn-context-menu');
        if (existing) existing.remove();

        const msgIndex = parseInt(msgEl.dataset.msgIndex, 10);
        const existingBm = getBookmarks(state.chatId).find(b => b.msgIndex === msgIndex);

        const menu = document.createElement('div');
        menu.className = 'cn-context-menu';
        menu.style.left = `${e.clientX}px`;
        menu.style.top = `${e.clientY}px`;

        if (existingBm) {
            menu.innerHTML = `
                <div class="cn-context-item cn-context-remove-bm">🔖 북마크 삭제</div>
                <div class="cn-context-item cn-context-rename-bm">✏️ 북마크 이름 변경</div>
            `;
            menu.querySelector('.cn-context-remove-bm').addEventListener('click', () => {
                removeBookmark(state.chatId, msgIndex);
                msgEl.classList.remove('cn-bookmarked');
                menu.remove();
                // Update sidebar
                refreshSidebar();
            });
            menu.querySelector('.cn-context-rename-bm').addEventListener('click', () => {
                menu.remove();
                const newLabel = prompt('북마크 이름:', existingBm.label || '');
                if (newLabel != null) {
                    addBookmark(state.chatId, msgIndex, newLabel);
                    refreshSidebar();
                }
            });
        } else {
            // Extract preview text (first 30 chars of message body)
            const bodyEl = msgEl.querySelector('.cn-msg-body');
            const previewText = (bodyEl?.textContent || '').substring(0, 40).trim() || `메시지 #${msgIndex}`;

            menu.innerHTML = `
                <div class="cn-context-item cn-context-add-bm">🔖 북마크 추가</div>
            `;
            menu.querySelector('.cn-context-add-bm').addEventListener('click', () => {
                menu.remove();
                const label = prompt('북마크 이름:', previewText);
                if (label != null) {
                    addBookmark(state.chatId, msgIndex, label || previewText);
                    msgEl.classList.add('cn-bookmarked');
                    refreshSidebar();
                }
            });
        }

        state.overlay.appendChild(menu);

        // Close on click outside
        const close = (ev) => {
            if (!menu.contains(ev.target)) {
                menu.remove();
                document.removeEventListener('click', close);
            }
        };
        setTimeout(() => document.addEventListener('click', close), 0);
    });

    // Mark already-bookmarked messages
    const bookmarks = getBookmarks(state.chatId);
    for (const bm of bookmarks) {
        const el = contentEl.querySelector(`[data-msg-index="${bm.msgIndex}"]`);
        if (el) el.classList.add('cn-bookmarked');
    }
}

/**
 * Refresh sidebar to reflect bookmark/chapter name changes.
 */
function refreshSidebar() {
    if (!state.overlay) return;
    const contentEl = state.overlay.querySelector('.cn-content');
    const sidebarContainer = state.overlay.querySelector('.cn-sidebar-container');
    if (!sidebarContainer) return;

    const customNames = getChapterNames(state.chatId);
    sidebarContainer.innerHTML = '';
    state.sidebar = createSidebar(sidebarContainer, state.chapters, (chapterIdx) => {
        scrollToChapter(chapterIdx);
    }, {
        bookmarks: getBookmarks(state.chatId),
        chapterNames: customNames,
        onBookmarkClick: (msgIndex) => {
            const msgEl = contentEl?.querySelector(`[data-msg-index="${msgIndex}"]`);
            if (msgEl) {
                if (state.pageMode) {
                    const rect = contentEl.getBoundingClientRect();
                    const pageUnit = rect.width * 2;
                    const page = Math.floor(msgEl.offsetLeft / pageUnit);
                    goToPage(contentEl, page);
                } else {
                    msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
                msgEl.classList.add('cn-msg-highlight');
                setTimeout(() => msgEl.classList.remove('cn-msg-highlight'), 2000);
            }
        },
        onBookmarkRemove: (msgIndex) => {
            removeBookmark(state.chatId, msgIndex);
            const el = contentEl?.querySelector(`[data-msg-index="${msgIndex}"]`);
            if (el) el.classList.remove('cn-bookmarked');
        },
        onChapterRename: (chapterIdx, newName) => {
            setChapterName(state.chatId, chapterIdx, newName);
            const chapterTitleEl = state.overlay.querySelector(`#cn-chapter-${chapterIdx} .cn-chapter-title`);
            if (chapterTitleEl) chapterTitleEl.textContent = newName;
            if (state.chapters[chapterIdx]) state.chapters[chapterIdx].title = newName;
        },
    });
    sidebarContainer.appendChild(state.sidebar.element);
    state.sidebar.highlightChapter(state.currentChapter);
}

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

    // 조건부 행 초기화
    updateConditionalRows(panelContainer);

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
                else if (key === 'timeGapHours') valueSpan.textContent = `${value}시간`;
                else if (key === 'messagesPerChapter') valueSpan.textContent = `${value}개`;
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
                updateConditionalRows(panelContainer);
                reRender(userName, characterName);
            }

            // 읽기 모드 전환
            if (key === 'readingMode') {
                const contentEl = state.overlay.querySelector('.cn-content');
                if (select.value === 'page') {
                    enablePageMode(contentEl);
                } else {
                    disablePageMode(contentEl);
                }
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
 * 조건부 설정 행 표시/숨김.
 * data-show-when="chapterMode:count,both" 형태로 조건 지정.
 * @param {HTMLElement} panelContainer
 */
function updateConditionalRows(panelContainer) {
    const chapterMode = panelContainer.querySelector('[data-setting="chapterMode"]')?.value || 'count';
    panelContainer.querySelectorAll('.cn-setting-conditional').forEach(row => {
        const showWhen = row.dataset.showWhen;
        if (!showWhen) return;
        const [, values] = showWhen.split(':');
        const allowed = values.split(',');
        row.style.display = allowed.includes(chapterMode) ? '' : 'none';
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

    // Apply custom chapter names
    const customNames = getChapterNames(state.chatId);
    for (const ch of state.chapters) {
        if (customNames[ch.index] != null) {
            ch.title = customNames[ch.index];
        }
    }

    const contentEl = state.overlay.querySelector('.cn-content');
    renderAllChapters(contentEl, settings, userName, characterName);

    // Rebuild sidebar with bookmarks
    const sidebarContainer = state.overlay.querySelector('.cn-sidebar-container');
    sidebarContainer.innerHTML = '';
    state.sidebar = createSidebar(sidebarContainer, state.chapters, (chapterIdx) => {
        scrollToChapter(chapterIdx);
    }, {
        bookmarks: getBookmarks(state.chatId),
        chapterNames: customNames,
        onBookmarkClick: (msgIndex) => {
            const msgEl = contentEl.querySelector(`[data-msg-index="${msgIndex}"]`);
            if (msgEl) {
                msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                msgEl.classList.add('cn-msg-highlight');
                setTimeout(() => msgEl.classList.remove('cn-msg-highlight'), 2000);
            }
        },
        onBookmarkRemove: (msgIndex) => {
            removeBookmark(state.chatId, msgIndex);
        },
        onChapterRename: (chapterIdx, newName) => {
            setChapterName(state.chatId, chapterIdx, newName);
            const chapterTitleEl = state.overlay.querySelector(`#cn-chapter-${chapterIdx} .cn-chapter-title`);
            if (chapterTitleEl) chapterTitleEl.textContent = newName;
            if (state.chapters[chapterIdx]) state.chapters[chapterIdx].title = newName;
        },
    });
    sidebarContainer.appendChild(state.sidebar.element);

    // Re-setup bookmark context menu
    setupBookmarkContextMenu(contentEl);
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
