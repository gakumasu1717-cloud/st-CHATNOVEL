/**
 * Chat Novel — Sidebar Navigation
 * Provides chapter navigation with tree view (bookmarks under chapters),
 * chapter renaming, and text search.
 */

import { escapeRegex } from './utils.js';

/**
 * Strip HTML tags from a string, returning plain text.
 * @param {string} html
 * @returns {string}
 */
function stripHtml(html) {
    if (!html) return '';
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
}

function escapeHtmlLocal(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Create and manage the sidebar navigation.
 * @param {HTMLElement} container - The reader container
 * @param {Array} chapters - Chapter data
 * @param {Function} onChapterSelect - Callback when chapter is clicked
 * @param {Object} [opts] - Additional options
 * @param {Array} [opts.bookmarks] - Bookmark objects { msgIndex, label }
 * @param {Function} [opts.onBookmarkClick] - Callback(msgIndex)
 * @param {Function} [opts.onBookmarkRemove] - Callback(msgIndex)
 * @param {Function} [opts.onChapterRename] - Callback(chapterIdx, newName)
 * @param {Object} [opts.chapterNames] - Custom names { chapterIdx: 'name' }
 * @returns {Object} Sidebar controller
 */
export function createSidebar(container, chapters, onChapterSelect, opts = {}) {
    const sidebar = document.createElement('div');
    sidebar.className = 'cn-sidebar';
    sidebar.innerHTML = `
        <div class="cn-sidebar-header">
            <button class="cn-sidebar-toggle" title="Toggle sidebar">≡</button>
            <span class="cn-sidebar-title">목차</span>
        </div>
        <div class="cn-sidebar-search">
            <input type="text" class="cn-search-input" placeholder="텍스트 검색..." />
            <div class="cn-search-results"></div>
        </div>
        <div class="cn-sidebar-chapters"></div>
    `;

    const sidebarChapters = sidebar.querySelector('.cn-sidebar-chapters');
    const searchInput = sidebar.querySelector('.cn-search-input');
    const searchResults = sidebar.querySelector('.cn-search-results');
    const toggleBtn = sidebar.querySelector('.cn-sidebar-toggle');

    // Build mapping: chapterIdx -> bookmarks in that chapter
    function getBookmarksByChapter() {
        const bookmarks = opts.bookmarks || [];
        const map = {};
        for (const bm of bookmarks) {
            let found = false;
            for (let ci = 0; ci < chapters.length; ci++) {
                if (chapters[ci].messages.some(m => m._index === bm.msgIndex)) {
                    if (!map[ci]) map[ci] = [];
                    map[ci].push(bm);
                    found = true;
                    break;
                }
            }
            if (!found && chapters.length > 0) {
                const last = chapters.length - 1;
                if (!map[last]) map[last] = [];
                map[last].push(bm);
            }
        }
        return map;
    }

    // Render chapter list with tree view
    function renderChapters(currentIndex = 0) {
        sidebarChapters.innerHTML = '';
        const bmByChapter = getBookmarksByChapter();
        const customNames = opts.chapterNames || {};

        chapters.forEach((chapter, i) => {
            const node = document.createElement('div');
            node.className = 'cn-sidebar-tree-node';
            node.dataset.chapter = i;

            const displayTitle = customNames[i] || chapter.title;
            const hasBm = bmByChapter[i] && bmByChapter[i].length > 0;

            // Chapter header row
            const row = document.createElement('div');
            row.className = `cn-sidebar-chapter ${i === currentIndex ? 'cn-sidebar-chapter-active' : ''}`;
            row.innerHTML = `
                <span class="cn-chapter-expand ${hasBm ? '' : 'cn-expand-hidden'}">${hasBm ? '▸' : ''}</span>
                <span class="cn-chapter-bullet">${i === currentIndex ? '●' : '○'}</span>
                <span class="cn-chapter-label" title="더블클릭으로 이름 변경">${escapeHtmlLocal(displayTitle)}</span>
                <span class="cn-chapter-count">(${chapter.messages.length})</span>
                <button class="cn-chapter-rename-btn" title="이름 변경">✏️</button>
            `;

            // Click — navigate
            row.addEventListener('click', (e) => {
                if (e.target.closest('.cn-chapter-rename-btn, .cn-chapter-expand')) return;
                onChapterSelect(i);
                highlightChapter(i);
            });

            // Expand/collapse bookmarks
            const expandBtn = row.querySelector('.cn-chapter-expand');
            if (hasBm) {
                expandBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const bmList = node.querySelector('.cn-sidebar-bookmarks');
                    if (bmList) {
                        const open = bmList.style.display !== 'none';
                        bmList.style.display = open ? 'none' : 'block';
                        expandBtn.textContent = open ? '▸' : '▾';
                    }
                });
            }

            // Rename button
            row.querySelector('.cn-chapter-rename-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                startRename(i, row.querySelector('.cn-chapter-label'), displayTitle);
            });

            // Double-click label to rename
            row.querySelector('.cn-chapter-label').addEventListener('dblclick', (e) => {
                e.stopPropagation();
                startRename(i, row.querySelector('.cn-chapter-label'), displayTitle);
            });

            node.appendChild(row);

            // Bookmark sub-list
            if (hasBm) {
                const bmList = document.createElement('div');
                bmList.className = 'cn-sidebar-bookmarks';
                bmList.style.display = 'none';

                for (const bm of bmByChapter[i]) {
                    const bmItem = document.createElement('div');
                    bmItem.className = 'cn-sidebar-bookmark';
                    bmItem.innerHTML = `
                        <span class="cn-bookmark-icon">🔖</span>
                        <span class="cn-bookmark-label">${escapeHtmlLocal(bm.label || `메시지 #${bm.msgIndex}`)}</span>
                        <button class="cn-bookmark-remove" title="북마크 삭제">✕</button>
                    `;

                    bmItem.addEventListener('click', (e) => {
                        if (e.target.closest('.cn-bookmark-remove')) return;
                        opts.onBookmarkClick?.(bm.msgIndex);
                    });

                    bmItem.querySelector('.cn-bookmark-remove').addEventListener('click', (e) => {
                        e.stopPropagation();
                        opts.onBookmarkRemove?.(bm.msgIndex);
                        bmItem.remove();
                        if (bmList.children.length === 0) {
                            bmList.remove();
                            expandBtn.textContent = '';
                            expandBtn.classList.add('cn-expand-hidden');
                        }
                    });

                    bmList.appendChild(bmItem);
                }

                node.appendChild(bmList);
            }

            sidebarChapters.appendChild(node);
        });
    }

    // Inline rename
    function startRename(chapterIdx, labelEl, currentName) {
        if (labelEl.querySelector('input')) return; // already editing
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'cn-chapter-rename-input';
        input.value = currentName;
        input.maxLength = 100;

        const originalText = labelEl.textContent;
        labelEl.textContent = '';
        labelEl.appendChild(input);
        input.focus();
        input.select();

        const finish = (save) => {
            if (!input.parentNode) return; // already finished
            const newName = input.value.trim();
            input.remove();
            if (save && newName && newName !== originalText) {
                labelEl.textContent = newName;
                opts.onChapterRename?.(chapterIdx, newName);
            } else {
                labelEl.textContent = originalText;
            }
        };

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); finish(true); }
            if (e.key === 'Escape') { e.preventDefault(); finish(false); }
        });
        input.addEventListener('blur', () => finish(true));
    }

    // Highlight current chapter
    function highlightChapter(index) {
        const items = sidebarChapters.querySelectorAll('.cn-sidebar-chapter');
        items.forEach((item, i) => {
            const isActive = i === index;
            item.classList.toggle('cn-sidebar-chapter-active', isActive);
            const bullet = item.querySelector('.cn-chapter-bullet');
            if (bullet) bullet.textContent = isActive ? '●' : '○';
        });
    }

    // Toggle sidebar
    let isOpen = true;
    toggleBtn.addEventListener('click', () => {
        isOpen = !isOpen;
        sidebar.classList.toggle('cn-sidebar-collapsed', !isOpen);
        container.classList.toggle('cn-sidebar-hidden', !isOpen);
    });

    // Search
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => performSearch(e.target.value.trim()), 300);
    });

    function performSearch(query) {
        searchResults.innerHTML = '';
        if (!query || query.length < 2) {
            searchResults.style.display = 'none';
            return;
        }

        const results = [];
        const lowerQuery = query.toLowerCase();

        chapters.forEach((chapter, chapterIdx) => {
            chapter.messages.forEach((msg, msgIdx) => {
                const text = msg.mes || '';
                const pos = text.toLowerCase().indexOf(lowerQuery);
                if (pos !== -1) {
                    const start = Math.max(0, pos - 30);
                    const end = Math.min(text.length, pos + query.length + 30);
                    let context = text.substring(start, end);
                    if (start > 0) context = '...' + context;
                    if (end < text.length) context += '...';
                    const highlighted = context.replace(
                        new RegExp(escapeRegex(query), 'gi'),
                        '<mark class="cn-search-highlight">$&</mark>'
                    );
                    results.push({ chapterIdx, msgIdx, context: highlighted, chapter: chapter.title });
                }
            });
        });

        if (results.length === 0) {
            searchResults.innerHTML = '<div class="cn-search-no-results">검색 결과 없음</div>';
            searchResults.style.display = 'block';
            return;
        }

        searchResults.style.display = 'block';
        searchResults.innerHTML = `<div class="cn-search-count">${results.length}건 발견</div>`;

        results.slice(0, 50).forEach(result => {
            const item = document.createElement('div');
            item.className = 'cn-search-result-item';
            item.innerHTML = `
                <div class="cn-search-result-chapter">${result.chapter}</div>
                <div class="cn-search-result-context">${result.context}</div>
            `;
            item.addEventListener('click', () => {
                onChapterSelect(result.chapterIdx);
                highlightChapter(result.chapterIdx);
                setTimeout(() => {
                    const msgEl = container.querySelector(`[data-msg-index="${chapters[result.chapterIdx].messages[result.msgIdx]._index}"]`);
                    if (msgEl) {
                        msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        msgEl.classList.add('cn-msg-highlight');
                        setTimeout(() => msgEl.classList.remove('cn-msg-highlight'), 2000);
                    }
                }, 100);
            });
            searchResults.appendChild(item);
        });
    }

    // Initial render
    renderChapters(0);

    return {
        element: sidebar,
        renderChapters,
        highlightChapter,
        toggle: () => {
            isOpen = !isOpen;
            sidebar.classList.toggle('cn-sidebar-collapsed', !isOpen);
            container.classList.toggle('cn-sidebar-hidden', !isOpen);
        },
        isOpen: () => isOpen,
    };
}
