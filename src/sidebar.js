/**
 * Chat Novel — Sidebar Navigation
 * Provides chapter navigation and text search.
 */

import { escapeRegex } from './utils.js';

/**
 * Create and manage the sidebar navigation.
 * @param {HTMLElement} container - The reader container
 * @param {Array} chapters - Chapter data
 * @param {Function} onChapterSelect - Callback when chapter is clicked
 * @returns {Object} Sidebar controller
 */
export function createSidebar(container, chapters, onChapterSelect) {
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

    // Render chapter list
    function renderChapters(currentIndex = 0) {
        sidebarChapters.innerHTML = '';
        chapters.forEach((chapter, i) => {
            const item = document.createElement('div');
            item.className = `cn-sidebar-chapter ${i === currentIndex ? 'cn-sidebar-chapter-active' : ''}`;
            item.dataset.chapter = i;
            item.innerHTML = `
                <span class="cn-chapter-bullet">${i === currentIndex ? '●' : '○'}</span>
                <span class="cn-chapter-label">${chapter.title}</span>
                <span class="cn-chapter-count">(${chapter.messages.length})</span>
            `;
            item.addEventListener('click', () => {
                onChapterSelect(i);
                highlightChapter(i);
            });
            sidebarChapters.appendChild(item);
        });
    }

    // Highlight current chapter
    function highlightChapter(index) {
        const items = sidebarChapters.querySelectorAll('.cn-sidebar-chapter');
        items.forEach((item, i) => {
            const isActive = i === index;
            item.classList.toggle('cn-sidebar-chapter-active', isActive);
            item.querySelector('.cn-chapter-bullet').textContent = isActive ? '●' : '○';
        });
    }

    // Toggle sidebar
    let isOpen = true;
    toggleBtn.addEventListener('click', () => {
        isOpen = !isOpen;
        sidebar.classList.toggle('cn-sidebar-collapsed', !isOpen);
        container.classList.toggle('cn-sidebar-hidden', !isOpen);
    });

    // Search functionality
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            performSearch(e.target.value.trim());
        }, 300);
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
                const lowerText = text.toLowerCase();
                const pos = lowerText.indexOf(lowerQuery);

                if (pos !== -1) {
                    // Extract context around match
                    const start = Math.max(0, pos - 30);
                    const end = Math.min(text.length, pos + query.length + 30);
                    let context = text.substring(start, end);
                    if (start > 0) context = '...' + context;
                    if (end < text.length) context = context + '...';

                    // Highlight match
                    const highlightedContext = context.replace(
                        new RegExp(escapeRegex(query), 'gi'),
                        '<mark class="cn-search-highlight">$&</mark>'
                    );

                    results.push({
                        chapterIdx,
                        msgIdx,
                        context: highlightedContext,
                        chapter: chapter.title,
                    });
                }
            });
        });

        if (results.length === 0) {
            searchResults.innerHTML = '<div class="cn-search-no-results">검색 결과 없음</div>';
            searchResults.style.display = 'block';
            return;
        }

        // Show max 50 results
        const limitedResults = results.slice(0, 50);
        searchResults.style.display = 'block';
        searchResults.innerHTML = `<div class="cn-search-count">${results.length}건 발견</div>`;

        limitedResults.forEach(result => {
            const item = document.createElement('div');
            item.className = 'cn-search-result-item';
            item.innerHTML = `
                <div class="cn-search-result-chapter">${result.chapter}</div>
                <div class="cn-search-result-context">${result.context}</div>
            `;
            item.addEventListener('click', () => {
                onChapterSelect(result.chapterIdx);
                highlightChapter(result.chapterIdx);

                // Scroll to the specific message
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
