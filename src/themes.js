/**
 * Chat Novel — Theme Manager
 * Manages visual themes and customization.
 */

/**
 * Built-in themes.
 */
export const THEMES = {
    'dark-noble': {
        name: '다크 노블',
        description: '리디북스 다크',
        background: '#0f0f14',
        text: '#d4d4d8',
        textSecondary: '#8b8b94',
        accent: '#7c6ffa',
        dialogue: '#e2b96f',
        senderUser: '#6cb4ee',
        senderChar: '#c9a0dc',
        border: '#2a2a35',
        sidebar: '#0a0a10',
        sidebarText: '#9898a0',
        sidebarActive: '#7c6ffa',
        chapterTitle: '#a8a8b0',
        progressBar: '#7c6ffa',
        progressBg: '#1a1a24',
        headerBg: '#0a0a10',
        headerText: '#d4d4d8',
        cardBg: '#1a1a24',
        cardBorder: '#2a2a35',
        highlight: 'rgba(124, 111, 250, 0.15)',
        codeBg: '#1a1a24',
        linkColor: '#7c9ffa',
    },
    'light-classic': {
        name: '라이트 클래식',
        description: '리디북스 라이트',
        background: '#faf8f5',
        text: '#2d2d2d',
        textSecondary: '#6b6b6b',
        accent: '#5a4fcf',
        dialogue: '#b8860b',
        senderUser: '#2563eb',
        senderChar: '#7c3aed',
        border: '#e5e1d8',
        sidebar: '#f0ece5',
        sidebarText: '#5a5a5a',
        sidebarActive: '#5a4fcf',
        chapterTitle: '#4a4a4a',
        progressBar: '#5a4fcf',
        progressBg: '#e5e1d8',
        headerBg: '#f0ece5',
        headerText: '#2d2d2d',
        cardBg: '#f5f2ec',
        cardBorder: '#e0dbd3',
        highlight: 'rgba(90, 79, 207, 0.1)',
        codeBg: '#f0ece5',
        linkColor: '#2563eb',
    },
    'sepia-vintage': {
        name: '세피아 빈티지',
        description: '종이 질감',
        background: '#f4ecd8',
        text: '#5b4636',
        textSecondary: '#8b7560',
        accent: '#a0522d',
        dialogue: '#8b4513',
        senderUser: '#4a7c9b',
        senderChar: '#7c5295',
        border: '#d4c8a8',
        sidebar: '#e8dcc4',
        sidebarText: '#6b5b4a',
        sidebarActive: '#a0522d',
        chapterTitle: '#6b5240',
        progressBar: '#a0522d',
        progressBg: '#d4c8a8',
        headerBg: '#e8dcc4',
        headerText: '#5b4636',
        cardBg: '#f0e4cc',
        cardBorder: '#d4c0a0',
        highlight: 'rgba(160, 82, 45, 0.12)',
        codeBg: '#ede3cb',
        linkColor: '#4a7c9b',
    },
    'midnight-blue': {
        name: '미드나잇 블루',
        description: '카카페 다크',
        background: '#0d1117',
        text: '#c9d1d9',
        textSecondary: '#8b949e',
        accent: '#58a6ff',
        dialogue: '#ffa657',
        senderUser: '#79c0ff',
        senderChar: '#d2a8ff',
        border: '#21262d',
        sidebar: '#090d13',
        sidebarText: '#8b949e',
        sidebarActive: '#58a6ff',
        chapterTitle: '#b0b8c0',
        progressBar: '#58a6ff',
        progressBg: '#161b22',
        headerBg: '#090d13',
        headerText: '#c9d1d9',
        cardBg: '#161b22',
        cardBorder: '#21262d',
        highlight: 'rgba(88, 166, 255, 0.1)',
        codeBg: '#161b22',
        linkColor: '#58a6ff',
    },
};

/**
 * Apply a theme's CSS variables to the reader container.
 * @param {HTMLElement} container
 * @param {string} themeId
 */
export function applyTheme(container, themeId) {
    let theme = THEMES[themeId];
    if (!theme) {
        console.warn(`[ChatNovel] Unknown theme: ${themeId}, falling back to dark-noble`);
        themeId = 'dark-noble';
        theme = THEMES[themeId];
    }

    const vars = {
        '--cn-bg': theme.background,
        '--cn-text': theme.text,
        '--cn-text-secondary': theme.textSecondary,
        '--cn-accent': theme.accent,
        '--cn-dialogue': theme.dialogue,
        '--cn-sender-user': theme.senderUser,
        '--cn-sender-char': theme.senderChar,
        '--cn-border': theme.border,
        '--cn-sidebar-bg': theme.sidebar,
        '--cn-sidebar-text': theme.sidebarText,
        '--cn-sidebar-active': theme.sidebarActive,
        '--cn-chapter-title': theme.chapterTitle,
        '--cn-progress-bar': theme.progressBar,
        '--cn-progress-bg': theme.progressBg,
        '--cn-header-bg': theme.headerBg,
        '--cn-header-text': theme.headerText,
        '--cn-card-bg': theme.cardBg,
        '--cn-card-border': theme.cardBorder,
        '--cn-highlight': theme.highlight,
        '--cn-code-bg': theme.codeBg,
        '--cn-link': theme.linkColor,
    };

    Object.entries(vars).forEach(([key, value]) => {
        container.style.setProperty(key, value);
    });
}

/**
 * Apply custom typography settings.
 * @param {HTMLElement} container
 * @param {Object} settings
 * @param {number} settings.fontSize
 * @param {number} settings.lineHeight
 * @param {number} settings.contentWidth
 * @param {string} settings.fontFamily
 */
export function applyTypography(container, settings) {
    if (settings.fontSize) {
        container.style.setProperty('--cn-font-size', `${settings.fontSize}px`);
    }
    if (settings.lineHeight) {
        container.style.setProperty('--cn-line-height', `${settings.lineHeight}`);
    }
    if (settings.contentWidth) {
        container.style.setProperty('--cn-content-width', `${settings.contentWidth}px`);
    }
    if (settings.fontFamily) {
        const families = {
            'gothic': "'Pretendard', 'Noto Sans KR', -apple-system, sans-serif",
            'serif': "'Noto Serif KR', 'Batang', Georgia, serif",
        };
        container.style.setProperty('--cn-font-family', families[settings.fontFamily] || families.gothic);
    }
}

/**
 * Get the list of available theme IDs and names.
 * @returns {Array<{id: string, name: string, description: string}>}
 */
export function getThemeList() {
    return Object.entries(THEMES).map(([id, theme]) => ({
        id,
        name: theme.name,
        description: theme.description,
    }));
}
