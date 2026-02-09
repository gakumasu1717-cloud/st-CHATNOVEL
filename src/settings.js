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
 * @param {string} chatId
 * @param {Object} position
 * @param {number} position.chapterIndex
 * @param {number} position.scrollTop
 * @param {number} position.progress
 */
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

/**
 * Create settings panel HTML.
 * @param {Object} currentSettings - Current settings values
 * @param {Array} themeList - Array of theme options
 * @returns {string}
 */
export function createSettingsPanelHtml(currentSettings, themeList) {
    return `
    <div class="cn-settings-panel">
        <div class="cn-settings-header">
            <h3>⚙️ 설정</h3>
            <button class="cn-settings-close" title="닫기">✕</button>
        </div>

        <div class="cn-settings-body">
            <!-- Chapter Settings -->
            <div class="cn-settings-section">
                <h4>챕터 분할</h4>
                <div class="cn-setting-row">
                    <label>분할 모드</label>
                    <select class="cn-setting-input" data-setting="chapterMode">
                        <option value="count" ${currentSettings.chapterMode === 'count' ? 'selected' : ''}>메시지 수</option>
                        <option value="time" ${currentSettings.chapterMode === 'time' ? 'selected' : ''}>시간 간격</option>
                        <option value="both" ${currentSettings.chapterMode === 'both' ? 'selected' : ''}>메시지 수 + 시간</option>
                        <option value="none" ${currentSettings.chapterMode === 'none' ? 'selected' : ''}>분할 안 함</option>
                    </select>
                </div>
                <div class="cn-setting-row">
                    <label>챕터당 메시지 수</label>
                    <input type="range" class="cn-setting-input" data-setting="messagesPerChapter"
                        min="5" max="100" step="5" value="${currentSettings.messagesPerChapter}" />
                    <span class="cn-setting-value">${currentSettings.messagesPerChapter}</span>
                </div>
                <div class="cn-setting-row">
                    <label>시간 간격 (시간)</label>
                    <input type="range" class="cn-setting-input" data-setting="timeGapHours"
                        min="1" max="48" step="1" value="${currentSettings.timeGapHours}" />
                    <span class="cn-setting-value">${currentSettings.timeGapHours}h</span>
                </div>
            </div>

            <!-- Typography Settings -->
            <div class="cn-settings-section">
                <h4>글꼴 & 표시</h4>
                <div class="cn-setting-row">
                    <label>글꼴 크기</label>
                    <input type="range" class="cn-setting-input" data-setting="fontSize"
                        min="12" max="24" step="1" value="${currentSettings.fontSize}" />
                    <span class="cn-setting-value">${currentSettings.fontSize}px</span>
                </div>
                <div class="cn-setting-row">
                    <label>줄 간격</label>
                    <input type="range" class="cn-setting-input" data-setting="lineHeight"
                        min="1.4" max="2.4" step="0.1" value="${currentSettings.lineHeight}" />
                    <span class="cn-setting-value">${currentSettings.lineHeight}</span>
                </div>
                <div class="cn-setting-row">
                    <label>본문 너비</label>
                    <input type="range" class="cn-setting-input" data-setting="contentWidth"
                        min="500" max="900" step="50" value="${currentSettings.contentWidth}" />
                    <span class="cn-setting-value">${currentSettings.contentWidth}px</span>
                </div>
                <div class="cn-setting-row">
                    <label>글꼴 종류</label>
                    <select class="cn-setting-input" data-setting="fontFamily">
                        <option value="gothic" ${currentSettings.fontFamily === 'gothic' ? 'selected' : ''}>고딕</option>
                        <option value="serif" ${currentSettings.fontFamily === 'serif' ? 'selected' : ''}>명조</option>
                    </select>
                </div>
            </div>

            <!-- Display Settings -->
            <div class="cn-settings-section">
                <h4>표시 옵션</h4>
                <div class="cn-setting-row">
                    <label>대사 스타일링</label>
                    <input type="checkbox" class="cn-setting-input" data-setting="dialogueEnabled"
                        ${currentSettings.dialogueEnabled ? 'checked' : ''} />
                </div>
                <div class="cn-setting-row">
                    <label>이미지 표시</label>
                    <input type="checkbox" class="cn-setting-input" data-setting="showImages"
                        ${currentSettings.showImages ? 'checked' : ''} />
                </div>
                <div class="cn-setting-row">
                    <label>발화자 이름 표시</label>
                    <input type="checkbox" class="cn-setting-input" data-setting="showSenderName"
                        ${currentSettings.showSenderName ? 'checked' : ''} />
                </div>
            </div>

            <!-- Theme Selection -->
            <div class="cn-settings-section">
                <h4>🎨 테마</h4>
                <div class="cn-theme-grid">
                    ${themeList.map(t => `
                        <div class="cn-theme-option ${t.id === currentSettings.theme ? 'cn-theme-active' : ''}"
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
                        <option value="url" ${currentSettings.exportImageMode === 'url' ? 'selected' : ''}>URL 참조 (가벼움)</option>
                        <option value="base64" ${currentSettings.exportImageMode === 'base64' ? 'selected' : ''}>Base64 임베드 (독립)</option>
                    </select>
                </div>
            </div>
        </div>
    </div>`;
}
