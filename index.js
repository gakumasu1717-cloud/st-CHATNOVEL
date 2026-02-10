/**
 * Chat Novel — Main Entry Point
 * SillyTavern extension that provides a web novel reader for chat JSONL data.
 */

import { openReader, closeReader, isReaderOpen } from './src/reader.js';
import { loadSettings } from './src/settings.js';

// Extension metadata
const extensionName = 'st-CHATNOVEL';

/**
 * Initialize the Chat Novel extension.
 */
(async function init() {
    // Wait for ST to be ready
    const context = SillyTavern.getContext();
    const { eventSource, event_types } = context;

    // Load settings
    loadSettings();

    console.log('[ChatNovel] Extension loaded');

    // Add menu button to the extensions panel / chat actions
    addChatMenuButton();

    // Register slash command: /novel
    registerSlashCommand();

    // Listen for chat changes to update button state
    eventSource.on(event_types.CHAT_CHANGED, () => {
        if (isReaderOpen()) {
            closeReader();
        }
    });
})();

/**
 * Add the Chat Novel button to the chat interface.
 */
function addChatMenuButton() {
    // Add to the extensions actions area / wand menu
    const buttonHtml = `
        <div id="chat_novel_button" class="list-group-item flex-container flexGap5" title="Chat Novel — 웹소설 리더">
            <div class="fa-solid fa-book-open extensionsMenuExtensionButton"></div>
            📖 Chat Novel
        </div>
    `;

    // Try to add to the wand/extensions menu
    const wandContainer = document.getElementById('extensionsMenu');
    if (wandContainer) {
        const items = wandContainer.querySelector('.list-group');
        if (items) {
            items.insertAdjacentHTML('beforeend', buttonHtml);
        } else {
            wandContainer.insertAdjacentHTML('beforeend', buttonHtml);
        }
    }

    // Also try to add directly to the extensions actions / data-area
    // This ensures broad compatibility
    waitForElement('#extensionsMenu, #extensions_menu2, #extrasPanelContainer').then((container) => {
        if (container && !document.getElementById('chat_novel_button')) {
            container.insertAdjacentHTML('beforeend', buttonHtml);
        }
    });

    // Bind click handler
    document.addEventListener('click', (e) => {
        if (e.target.closest('#chat_novel_button')) {
            e.preventDefault();
            e.stopPropagation();
            openReader();
        }
    });
}

/**
 * Register the /novel slash command.
 * Tries new-style SlashCommandParser first, falls back to legacy.
 */
async function registerSlashCommand() {
    // Try new-style SlashCommandParser first
    try {
        const { SlashCommand } = await import('../../../../slash-commands/SlashCommand.js');
        const { SlashCommandParser } = await import('../../../../slash-commands/SlashCommandParser.js');

        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'novel',
            callback: () => {
                openReader();
                return '';
            },
            aliases: ['chatnovel'],
            returns: 'nothing',
            helpString: '<div>채팅을 웹소설 형태로 읽는 Chat Novel 리더를 엽니다.</div>',
        }));

        console.log('[ChatNovel] /novel slash command registered (new style)');
        return; // Success — skip legacy
    } catch (e) {
        console.debug('[ChatNovel] New-style slash command registration skipped:', e.message);
    }

    // Fall back to legacy registration
    try {
        const context = SillyTavern.getContext();
        if (context.registerSlashCommand) {
            context.registerSlashCommand('novel', (_args) => {
                openReader();
                return '';
            }, [], '<span class="monospace">Opens the Chat Novel reader</span>', true, true);
            console.log('[ChatNovel] /novel slash command registered (legacy)');
        }
    } catch (e) {
        console.debug('[ChatNovel] Slash command registration (legacy) failed:', e.message);
    }
}

/**
 * Wait for a DOM element to appear.
 * @param {string} selector
 * @param {number} timeout
 * @returns {Promise<Element>}
 */
function waitForElement(selector, timeout = 10000) {
    return new Promise((resolve) => {
        const existing = document.querySelector(selector);
        if (existing) {
            resolve(existing);
            return;
        }

        const observer = new MutationObserver(() => {
            const el = document.querySelector(selector);
            if (el) {
                observer.disconnect();
                resolve(el);
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });

        setTimeout(() => {
            observer.disconnect();
            resolve(null);
        }, timeout);
    });
}
