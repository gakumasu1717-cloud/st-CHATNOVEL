/**
 * Chat Novel — Settings Manager
 * Manages extension settings with persistence.
 */

const MODULE_NAME = 'chat_novel';

const DEFAULT_SETTINGS = Object.freeze({
    // Theme
    theme: 'dark-noble',

    // Typography
    fontSize: 16,
    lineHeight: 1.8,
    contentWidth: 700,
    fontFamily: 'gothic', // 'gothic' | 'serif'

    // Chapter splitting
    chapterMode: 'count', // 'count' | 'time' | 'both' | 'none'
    messagesPerChapter: 20,
    timeGapHours: 6,

    // Display
    dialogueEnabled: true,
    showImages: true,
    showSenderName: true,

    // Export
    exportImageMode: 'url', // 'base64' | 'url'

    // Reading mode
    readingMode: 'scroll', // 'scroll' | 'page'

    // Blue light filter
    brightness: 100,
    warmth: 0,

    // Paragraph indent
    paragraphIndent: 0, // em 단위, 0 = off

    // Bookmarks (per-chat): { chatId: [ { msgIndex, label, timestamp } ] }
    bookmarks: {},

    // Custom chapter names (per-chat): { chatId: { chapterIdx: 'name' } }
    chapterNames: {},

    // Reading position (per-chat)
    readingPositions: {},
});

/**
 * Initialize or load settings from ST's extension settings.
 * @returns {Object} Settings object (mutable reference)
 */
export function loadSettings() {
    const context = SillyTavern.getContext();
    const { extensionSettings } = context;

    if (!extensionSettings[MODULE_NAME]) {
        extensionSettings[MODULE_NAME] = structuredClone(DEFAULT_SETTINGS);
    }

    // Ensure all default keys exist (for updates)
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (!Object.hasOwn(extensionSettings[MODULE_NAME], key)) {
            extensionSettings[MODULE_NAME][key] = typeof DEFAULT_SETTINGS[key] === 'object'
                ? structuredClone(DEFAULT_SETTINGS[key])
                : DEFAULT_SETTINGS[key];
        }
    }

    // Theme migration: old theme names that no longer exist
    const validThemes = ['dark-noble', 'light-classic', 'sepia-vintage', 'midnight-blue'];
    if (extensionSettings[MODULE_NAME].theme && !validThemes.includes(extensionSettings[MODULE_NAME].theme)) {
        console.warn(`[ChatNovel] Migrating unknown theme '${extensionSettings[MODULE_NAME].theme}' to 'dark-noble'`);
        extensionSettings[MODULE_NAME].theme = 'dark-noble';
    }

    return extensionSettings[MODULE_NAME];
}

/**
 * Save settings (debounced via ST's built-in mechanism).
 */
export function saveSettings() {
    try {
        const { saveSettingsDebounced } = SillyTavern.getContext();
        saveSettingsDebounced();
    } catch (e) {
        console.warn('[ChatNovel] Failed to save settings:', e);
    }
}

/**
 * Get current settings.
 * @returns {Object}
 */
export function getSettings() {
    return loadSettings();
}

/**
 * Update a single setting.
 * @param {string} key
 * @param {any} value
 */
export function updateSetting(key, value) {
    const settings = loadSettings();
    settings[key] = value;
    saveSettings();
}

/**
 * Save reading position for a specific chat.
 * Uses LRU cleanup to prevent unbounded growth.
 * @param {string} chatId
 * @param {Object} position
 * @param {number} position.chapterIndex
 * @param {number} position.scrollTop
 * @param {number} position.progress
 */
const MAX_READING_POSITIONS = 100;

export function saveReadingPosition(chatId, position) {
    if (!chatId) return;
    const settings = loadSettings();
    if (!settings.readingPositions) {
        settings.readingPositions = {};
    }
    settings.readingPositions[chatId] = {
        ...position,
        timestamp: Date.now(),
    };

    // LRU cleanup: keep only the most recent N entries
    const entries = Object.entries(settings.readingPositions);
    if (entries.length > MAX_READING_POSITIONS) {
        entries.sort((a, b) => (a[1].timestamp || 0) - (b[1].timestamp || 0));
        for (let i = 0; i < entries.length - MAX_READING_POSITIONS; i++) {
            delete settings.readingPositions[entries[i][0]];
        }
    }

    saveSettings();
}

/**
 * Get reading position for a specific chat.
 * @param {string} chatId
 * @returns {Object|null}
 */
export function getReadingPosition(chatId) {
    if (!chatId) return null;
    const settings = loadSettings();
    return settings.readingPositions?.[chatId] || null;
}

/**
 * Reset settings to defaults.
 */
export function resetSettings() {
    const context = SillyTavern.getContext();
    const { extensionSettings } = context;
    extensionSettings[MODULE_NAME] = structuredClone(DEFAULT_SETTINGS);
    saveSettings();
}

// ===== Bookmarks =====

/**
 * Get bookmarks for a specific chat.
 * @param {string} chatId
 * @returns {Array<{msgIndex: number, label: string, timestamp: number}>}
 */
export function getBookmarks(chatId) {
    if (!chatId) return [];
    const settings = loadSettings();
    return settings.bookmarks?.[chatId] || [];
}

/**
 * Add a bookmark.
 * @param {string} chatId
 * @param {number} msgIndex
 * @param {string} label
 */
export function addBookmark(chatId, msgIndex, label) {
    if (!chatId) return;
    const settings = loadSettings();
    if (!settings.bookmarks) settings.bookmarks = {};
    if (!settings.bookmarks[chatId]) settings.bookmarks[chatId] = [];
    // Prevent duplicates
    const existing = settings.bookmarks[chatId].find(b => b.msgIndex === msgIndex);
    if (existing) {
        existing.label = label;
        existing.timestamp = Date.now();
    } else {
        settings.bookmarks[chatId].push({ msgIndex, label, timestamp: Date.now() });
    }
    // Sort by msgIndex
    settings.bookmarks[chatId].sort((a, b) => a.msgIndex - b.msgIndex);
    saveSettings();
}

/**
 * Remove a bookmark.
 * @param {string} chatId
 * @param {number} msgIndex
 */
export function removeBookmark(chatId, msgIndex) {
    if (!chatId) return;
    const settings = loadSettings();
    if (!settings.bookmarks?.[chatId]) return;
    settings.bookmarks[chatId] = settings.bookmarks[chatId].filter(b => b.msgIndex !== msgIndex);
    saveSettings();
}

// ===== Custom Chapter Names =====

/**
 * Get custom chapter names for a chat.
 * @param {string} chatId
 * @returns {Object} { chapterIndex: 'name' }
 */
export function getChapterNames(chatId) {
    if (!chatId) return {};
    const settings = loadSettings();
    return settings.chapterNames?.[chatId] || {};
}

/**
 * Set a custom chapter name.
 * @param {string} chatId
 * @param {number} chapterIndex
 * @param {string} name
 */
export function setChapterName(chatId, chapterIndex, name) {
    if (!chatId) return;
    const settings = loadSettings();
    if (!settings.chapterNames) settings.chapterNames = {};
    if (!settings.chapterNames[chatId]) settings.chapterNames[chatId] = {};
    if (name && name.trim()) {
        settings.chapterNames[chatId][chapterIndex] = name.trim();
    } else {
        delete settings.chapterNames[chatId][chapterIndex];
    }
    saveSettings();
}

/**
 * Create settings panel HTML.
 * @param {Object} currentSettings - Current settings values
 * @param {Array} themeList - Array of theme options
 * @returns {string}
 */
export function createSettingsPanelHtml(currentSettings, themeList) {
    const s = currentSettings;
    return `
    <div class="cn-settings-panel">
        <div class="cn-settings-header">
            <h3>⚙️ 설정</h3>
            <button class="cn-settings-close" title="닫기">✕</button>
        </div>

        <div class="cn-settings-body">
            <!-- 읽기 모드 -->
            <div class="cn-settings-section">
                <h4>읽기 모드</h4>
                <div class="cn-setting-row">
                    <label>모드</label>
                    <select class="cn-setting-input" data-setting="readingMode">
                        <option value="scroll" ${s.readingMode === 'scroll' ? 'selected' : ''}>스크롤</option>
                        <option value="page" ${s.readingMode === 'page' ? 'selected' : ''}>페이지 넘김</option>
                    </select>
                </div>
            </div>

            <!-- Chapter Settings -->
            <div class="cn-settings-section">
                <h4>챕터 분할</h4>
                <div class="cn-setting-row">
                    <label>분할 기준</label>
                    <select class="cn-setting-input" data-setting="chapterMode">
                        <option value="count" ${s.chapterMode === 'count' ? 'selected' : ''}>메시지 수 기준</option>
                        <option value="time" ${s.chapterMode === 'time' ? 'selected' : ''}>대화 공백 시간 기준</option>
                        <option value="both" ${s.chapterMode === 'both' ? 'selected' : ''}>메시지 수 + 대화 공백</option>
                        <option value="none" ${s.chapterMode === 'none' ? 'selected' : ''}>분할 안 함 (1챕터)</option>
                    </select>
                </div>
                <div class="cn-setting-row cn-setting-conditional" data-show-when="chapterMode:count,both">
                    <label>챕터당 메시지</label>
                    <input type="range" class="cn-setting-input" data-setting="messagesPerChapter"
                        min="5" max="100" step="5" value="${s.messagesPerChapter}" />
                    <span class="cn-setting-value">${s.messagesPerChapter}개</span>
                </div>
                <div class="cn-setting-row cn-setting-conditional" data-show-when="chapterMode:time,both">
                    <label>공백 시간 기준</label>
                    <input type="range" class="cn-setting-input" data-setting="timeGapHours"
                        min="1" max="48" step="1" value="${s.timeGapHours}" />
                    <span class="cn-setting-value">${s.timeGapHours}시간</span>
                </div>
                <div class="cn-setting-hint cn-setting-conditional" data-show-when="chapterMode:time,both">
                    메시지 사이 공백이 위 시간을 넘으면 새 챕터로 나눕니다.
                </div>
            </div>

            <!-- Typography Settings -->
            <div class="cn-settings-section">
                <h4>글꼴 & 표시</h4>
                <div class="cn-setting-row">
                    <label>글꼴 크기</label>
                    <input type="range" class="cn-setting-input" data-setting="fontSize"
                        min="12" max="24" step="1" value="${s.fontSize}" />
                    <span class="cn-setting-value">${s.fontSize}px</span>
                </div>
                <div class="cn-setting-row">
                    <label>줄 간격</label>
                    <input type="range" class="cn-setting-input" data-setting="lineHeight"
                        min="1.4" max="2.4" step="0.1" value="${s.lineHeight}" />
                    <span class="cn-setting-value">${s.lineHeight}</span>
                </div>
                <div class="cn-setting-row">
                    <label>본문 너비</label>
                    <input type="range" class="cn-setting-input" data-setting="contentWidth"
                        min="500" max="900" step="50" value="${s.contentWidth}" />
                    <span class="cn-setting-value">${s.contentWidth}px</span>
                </div>
                <div class="cn-setting-row">
                    <label>글꼴 종류</label>
                    <select class="cn-setting-input" data-setting="fontFamily">
                        <option value="gothic" ${s.fontFamily === 'gothic' ? 'selected' : ''}>고딕 (Pretendard)</option>
                        <option value="serif" ${s.fontFamily === 'serif' ? 'selected' : ''}>명조 (Noto Serif KR)</option>
                        <option value="nanumgothic" ${s.fontFamily === 'nanumgothic' ? 'selected' : ''}>나눔고딕</option>
                        <option value="nanummyeongjo" ${s.fontFamily === 'nanummyeongjo' ? 'selected' : ''}>나눔명조</option>
                        <option value="nanumbarun" ${s.fontFamily === 'nanumbarun' ? 'selected' : ''}>나눔바른고딕</option>
                        <option value="ridibatang" ${s.fontFamily === 'ridibatang' ? 'selected' : ''}>리디바탕</option>
                        <option value="kopubworld" ${s.fontFamily === 'kopubworld' ? 'selected' : ''}>KoPub돋움</option>
                        <option value="spoqa" ${s.fontFamily === 'spoqa' ? 'selected' : ''}>Spoqa Han Sans</option>
                        <option value="iropke" ${s.fontFamily === 'iropke' ? 'selected' : ''}>이롭게 바탕</option>
                    </select>
                </div>
            </div>

            <!-- Display Settings -->
            <div class="cn-settings-section">
                <h4>표시 옵션</h4>
                <div class="cn-setting-row">
                    <label>대사 스타일링</label>
                    <input type="checkbox" class="cn-setting-input" data-setting="dialogueEnabled"
                        ${s.dialogueEnabled ? 'checked' : ''} />
                </div>
                <div class="cn-setting-row">
                    <label>이미지 표시</label>
                    <input type="checkbox" class="cn-setting-input" data-setting="showImages"
                        ${s.showImages ? 'checked' : ''} />
                </div>
                <div class="cn-setting-row">
                    <label>발화자 이름 표시</label>
                    <input type="checkbox" class="cn-setting-input" data-setting="showSenderName"
                        ${s.showSenderName ? 'checked' : ''} />
                </div>
                <div class="cn-setting-row">
                    <label>단락 들여쓰기</label>
                    <input type="range" class="cn-setting-input" data-setting="paragraphIndent"
                        min="0" max="3" step="0.5" value="${s.paragraphIndent || 0}" />
                    <span class="cn-setting-value">${s.paragraphIndent || 0}em</span>
                </div>
            </div>

            <!-- Blue Light Filter -->
            <div class="cn-settings-section">
                <h4>🔆 화면 필터</h4>
                <div class="cn-setting-row">
                    <label>밝기</label>
                    <input type="range" class="cn-setting-input" data-setting="brightness"
                        min="50" max="100" step="5" value="${s.brightness || 100}" />
                    <span class="cn-setting-value">${s.brightness || 100}%</span>
                </div>
                <div class="cn-setting-row">
                    <label>따뜻한 색감</label>
                    <input type="range" class="cn-setting-input" data-setting="warmth"
                        min="0" max="60" step="5" value="${s.warmth || 0}" />
                    <span class="cn-setting-value">${s.warmth || 0}%</span>
                </div>
            </div>

            <!-- Theme Selection -->
            <div class="cn-settings-section">
                <h4>🎨 테마</h4>
                <div class="cn-theme-grid">
                    ${themeList.map(t => `
                        <div class="cn-theme-option ${t.id === s.theme ? 'cn-theme-active' : ''}"
                             data-theme="${t.id}">
                            <div class="cn-theme-name">${t.name}</div>
                            <div class="cn-theme-desc">${t.description}</div>
                        </div>
                    `).join('')}
                </div>
            </div>

            <!-- Export Settings -->
            <div class="cn-settings-section">
                <h4>📤 내보내기</h4>
                <div class="cn-setting-row">
                    <label>이미지 처리</label>
                    <select class="cn-setting-input" data-setting="exportImageMode">
                        <option value="url" ${s.exportImageMode === 'url' ? 'selected' : ''}>URL 참조 (가벼움)</option>
                        <option value="base64" ${s.exportImageMode === 'base64' ? 'selected' : ''}>Base64 임베드 (독립)</option>
                    </select>
                </div>
            </div>
        </div>
    </div>`;
}
