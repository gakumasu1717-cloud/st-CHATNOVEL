/**
 * Chat Novel — HTML Exporter
 * Exports the rendered novel as a standalone HTML file.
 */

import { THEMES } from './themes.js';
import { imageToBase64 } from './imageHandler.js';

/**
 * Export rendered chapters as a standalone HTML file.
 * @param {Object} options
 * @param {string} options.title - Novel title
 * @param {string} options.renderedHtml - Pre-rendered chapter HTML
 * @param {Array} options.chapters - Chapter data for navigation
 * @param {Object} options.theme - Theme settings
 * @param {Object} options.typography - Typography settings
 * @param {string} options.imageMode - 'base64' | 'url'
 * @returns {Promise<string>} Complete HTML string
 */
export async function exportToHtml(options) {
    const { title, renderedHtml, chapters, theme, typography, imageMode } = options;

    let processedHtml = renderedHtml;

    // Convert images to base64 if needed
    if (imageMode === 'base64') {
        processedHtml = await embedImagesAsBase64(processedHtml);
    }

    const themeData = THEMES[theme] || THEMES['dark-noble'];

    const html = `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)} — Chat Novel</title>
    <style>
${generateExportCSS(themeData, typography)}
    </style>
</head>
<body>
    <div class="cn-export-container">
        <!-- Header -->
        <div class="cn-export-header">
            <div class="cn-export-header-inner">
                <span class="cn-export-title">📖 ${escapeHtml(title)}</span>
                <button class="cn-export-sidebar-toggle" onclick="toggleSidebar()">≡</button>
            </div>
            <div class="cn-export-progress">
                <div class="cn-export-progress-bar" id="progressBar"></div>
            </div>
            <div class="cn-export-progress-text" id="progressText"></div>
        </div>

        <!-- Sidebar -->
        <div class="cn-export-sidebar" id="sidebar">
            <div class="cn-export-sidebar-title">목차</div>
            ${chapters.map((ch, i) => `
                <div class="cn-export-sidebar-item" onclick="scrollToChapter(${i})">
                    <span class="cn-export-sidebar-bullet" id="bullet-${i}">○</span>
                    ${escapeHtml(ch.title)} (${ch.messages.length})
                </div>
            `).join('')}
        </div>

        <!-- Content -->
        <div class="cn-export-content" id="content">
            ${processedHtml}
        </div>
    </div>

    <script>
${generateExportJS(chapters.length)}
    </script>
</body>
</html>`;

    return html;
}

/**
 * Trigger file download.
 * @param {string} html - HTML content
 * @param {string} filename - Download filename
 */
export function downloadHtml(html, filename) {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Embed all images as base64 in the HTML string.
 * @param {string} html
 * @returns {Promise<string>}
 */
async function embedImagesAsBase64(html) {
    const imgRegex = /<img[^>]+src="([^"]+)"[^>]*>/gi;
    const matches = [...html.matchAll(imgRegex)];

    for (const match of matches) {
        const originalSrc = match[1];
        if (originalSrc.startsWith('data:')) continue;

        try {
            const base64 = await imageToBase64(originalSrc);
            html = html.replace(match[0], match[0].replace(originalSrc, base64));
        } catch (e) {
            console.warn(`[ChatNovel] Failed to embed image: ${originalSrc}`);
        }
    }

    return html;
}

/**
 * Generate inline CSS for the export.
 * @param {Object} theme
 * @param {Object} typography
 * @returns {string}
 */
function generateExportCSS(theme, typography) {
    return `
        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
            background: ${theme.background};
            color: ${theme.text};
            font-family: ${typography?.fontFamily === 'serif'
                ? "'Noto Serif KR', 'Batang', Georgia, serif"
                : "'Pretendard', 'Noto Sans KR', -apple-system, sans-serif"};
            font-size: ${typography?.fontSize || 16}px;
            line-height: ${typography?.lineHeight || 1.8};
        }

        .cn-export-container {
            display: flex;
            flex-direction: column;
            min-height: 100vh;
        }

        /* Header */
        .cn-export-header {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            z-index: 100;
            background: ${theme.sidebar};
            border-bottom: 1px solid ${theme.border};
        }

        .cn-export-header-inner {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 20px;
        }

        .cn-export-title {
            font-weight: 600;
            font-size: 15px;
        }

        .cn-export-sidebar-toggle {
            background: none;
            border: 1px solid ${theme.border};
            color: ${theme.text};
            font-size: 18px;
            cursor: pointer;
            padding: 4px 10px;
            border-radius: 4px;
        }

        .cn-export-progress {
            height: 3px;
            background: ${theme.border};
        }

        .cn-export-progress-bar {
            height: 100%;
            background: ${theme.accent};
            width: 0%;
            transition: width 0.1s;
        }

        .cn-export-progress-text {
            text-align: center;
            font-size: 11px;
            color: ${theme.textSecondary};
            padding: 2px 0;
        }

        /* Sidebar */
        .cn-export-sidebar {
            position: fixed;
            top: 60px;
            left: 0;
            bottom: 0;
            width: 220px;
            background: ${theme.sidebar};
            border-right: 1px solid ${theme.border};
            overflow-y: auto;
            padding: 15px;
            transform: translateX(0);
            transition: transform 0.3s;
            z-index: 99;
        }

        .cn-export-sidebar.hidden {
            transform: translateX(-100%);
        }

        .cn-export-sidebar-title {
            font-weight: 600;
            font-size: 14px;
            margin-bottom: 15px;
            color: ${theme.text};
        }

        .cn-export-sidebar-item {
            padding: 8px 10px;
            cursor: pointer;
            font-size: 13px;
            color: ${theme.textSecondary};
            border-radius: 5px;
            margin-bottom: 4px;
            transition: background 0.2s;
        }

        .cn-export-sidebar-item:hover {
            background: ${theme.highlight};
            color: ${theme.text};
        }

        .cn-export-sidebar-item.active {
            color: ${theme.accent};
            background: ${theme.highlight};
        }

        .cn-export-sidebar-bullet {
            margin-right: 6px;
        }

        /* Content */
        .cn-export-content {
            margin-top: 60px;
            margin-left: 220px;
            padding: 40px 20px;
            max-width: ${typography?.contentWidth || 700}px;
            margin-left: max(220px, calc(50% - ${(typography?.contentWidth || 700) / 2}px));
            transition: margin-left 0.3s;
        }

        .cn-export-content.full-width {
            margin-left: auto;
            margin-right: auto;
        }

        /* Messages */
        .cn-message { margin-bottom: 24px; }

        .cn-msg-sender {
            font-size: 0.85em;
            font-weight: 600;
            margin-bottom: 4px;
        }

        .cn-msg-user .cn-msg-sender { color: ${theme.senderUser}; }
        .cn-msg-character .cn-msg-sender { color: ${theme.senderChar}; }
        .cn-msg-system .cn-msg-sender { color: ${theme.textSecondary}; }

        .cn-msg-body { word-break: break-word; }
        .cn-msg-body p { margin-bottom: 0.6em; }

        /* Chapters */
        .cn-chapter { margin-bottom: 60px; }

        .cn-chapter-title {
            font-size: 1.4em;
            font-weight: 700;
            color: ${theme.chapterTitle};
            margin-bottom: 8px;
            padding-bottom: 8px;
            border-bottom: 1px solid ${theme.border};
        }

        .cn-chapter-date {
            font-size: 0.8em;
            color: ${theme.textSecondary};
            margin-bottom: 24px;
        }

        /* Dialogue */
        .cn-dialogue { color: ${theme.dialogue}; }

        /* Images */
        .cn-image-container {
            text-align: center;
            margin: 16px 0;
        }

        .cn-image {
            max-width: 100%;
            height: auto;
            border-radius: 8px;
            cursor: pointer;
        }

        .cn-image-fallback {
            padding: 20px;
            background: ${theme.cardBg};
            border: 1px dashed ${theme.border};
            border-radius: 8px;
            text-align: center;
            color: ${theme.textSecondary};
        }

        /* Choices */
        .cn-choices-container {
            margin: 16px 0;
            padding: 16px;
            background: ${theme.cardBg};
            border: 1px solid ${theme.cardBorder};
            border-radius: 10px;
        }

        .cn-choices-header {
            font-weight: 600;
            margin-bottom: 12px;
            color: ${theme.accent};
        }

        .cn-choice-card {
            padding: 10px 14px;
            margin-bottom: 8px;
            background: ${theme.background};
            border: 1px solid ${theme.border};
            border-radius: 6px;
        }

        .cn-choice-number {
            font-weight: 600;
            color: ${theme.accent};
            margin-right: 8px;
        }

        /* Code */
        .cn-code-block {
            background: ${theme.codeBg};
            padding: 14px;
            border-radius: 6px;
            overflow-x: auto;
            font-family: 'Cascadia Code', 'Fira Code', monospace;
            font-size: 0.9em;
            margin: 12px 0;
        }

        .cn-inline-code {
            background: ${theme.codeBg};
            padding: 2px 6px;
            border-radius: 3px;
            font-family: 'Cascadia Code', 'Fira Code', monospace;
            font-size: 0.9em;
        }

        .cn-heading { margin: 16px 0 8px; color: ${theme.chapterTitle}; }
        .cn-hr { border: none; border-top: 1px solid ${theme.border}; margin: 20px 0; }
        a { color: ${theme.linkColor}; }

        /* Responsive */
        @media (max-width: 768px) {
            .cn-export-sidebar { display: none; }
            .cn-export-content {
                margin-left: auto !important;
                margin-right: auto;
                padding: 20px 16px;
            }
        }
    `;
}

/**
 * Generate inline JS for the export.
 * @param {number} chapterCount
 * @returns {string}
 */
function generateExportJS(chapterCount) {
    return `
        let sidebarVisible = true;

        function toggleSidebar() {
            const sidebar = document.getElementById('sidebar');
            const content = document.querySelector('.cn-export-content');
            sidebarVisible = !sidebarVisible;
            sidebar.classList.toggle('hidden', !sidebarVisible);
            content.classList.toggle('full-width', !sidebarVisible);
        }

        function scrollToChapter(index) {
            const chapter = document.getElementById('cn-chapter-' + index);
            if (chapter) {
                chapter.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }

        // Progress tracking
        const content = document.getElementById('content');
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');
        const totalChapters = ${chapterCount};

        window.addEventListener('scroll', function() {
            const scrollTop = window.scrollY;
            const docHeight = document.documentElement.scrollHeight - window.innerHeight;
            const progress = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;

            progressBar.style.width = progress.toFixed(1) + '%';

            // Find current chapter
            let currentChapter = 0;
            for (let i = 0; i < totalChapters; i++) {
                const el = document.getElementById('cn-chapter-' + i);
                if (el && el.getBoundingClientRect().top <= 100) {
                    currentChapter = i;
                }
            }

            progressText.textContent = 'Ch.' + (currentChapter + 1) + ' / ' + totalChapters + '  ' + progress.toFixed(0) + '%';

            // Update sidebar
            document.querySelectorAll('.cn-export-sidebar-item').forEach((item, i) => {
                item.classList.toggle('active', i === currentChapter);
            });
            for (let i = 0; i < totalChapters; i++) {
                const bullet = document.getElementById('bullet-' + i);
                if (bullet) bullet.textContent = i === currentChapter ? '●' : '○';
            }
        });

        // Keyboard navigation
        document.addEventListener('keydown', function(e) {
            if (e.key === ' ' || e.key === 'PageDown') {
                e.preventDefault();
                window.scrollBy({ top: window.innerHeight * 0.85, behavior: 'smooth' });
            } else if (e.key === 'PageUp') {
                e.preventDefault();
                window.scrollBy({ top: -window.innerHeight * 0.85, behavior: 'smooth' });
            }
        });
    `;
}

/**
 * Escape HTML special characters.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}
