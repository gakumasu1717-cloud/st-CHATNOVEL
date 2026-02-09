/**
 * Chat Novel — Main Entry Point
 * SillyTavern extension that provides a web novel reader for chat JSONL data.
 */

import { openReader, closeReader, isReaderOpen } from './src/reader.js';
import { loadSettings } from './src/settings.js';

// Extension metadata
const MODULE_NAME = 'chat_novel';
const extensionName = 'st-CHATNOVEL';
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

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
        if (!document.getElementById('chat_novel_button')) {
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

    // Also add a top-bar quick access button
    const topBarButton = document.createElement('div');
    topBarButton.id = 'chat_novel_top_button';
    topBarButton.className = 'fa-solid fa-book-open interactable';
    topBarButton.title = '📖 Chat Novel 리더';
    topBarButton.style.cssText = 'cursor: pointer; font-size: 1.1em; padding: 2px;';
    topBarButton.addEventListener('click', (e) => {
        e.preventDefault();
        openReader();
    });

    // Try to insert near the chat action buttons
    waitForElement('#form_sheld .range-block-counter, #send_but_sheld, #rightSendForm').then((target) => {
        if (target && !document.getElementById('chat_novel_top_button')) {
            target.parentElement?.insertBefore(topBarButton, target);
        }
    });
}

/**
 * Register the /novel slash command.
 */
function registerSlashCommand() {
    try {
        const context = SillyTavern.getContext();
        if (context.registerSlashCommand) {
            context.registerSlashCommand('novel', (_args) => {
                openReader();
                return '';
            }, [], '<span class="monospace">Opens the Chat Novel reader</span>', true, true);
        }
    } catch (e) {
        console.debug('[ChatNovel] Slash command registration (legacy) skipped:', e.message);
    }

    // Try the new way via SlashCommandParser
    try {
        const SlashCommandParser = window.SillyTavern?.getContext()?.SlashCommandParser;
        if (!SlashCommandParser) {
            // Alternative: direct import approach
            tryNewSlashCommandRegistration();
        }
    } catch (e) {
        console.debug('[ChatNovel] New slash command registration skipped:', e.message);
    }
}

/**
 * Attempt new-style slash command registration.
 */
async function tryNewSlashCommandRegistration() {
    try {
        const { SlashCommand } = await import('../../../../slash-commands/SlashCommand.js');
        const { SlashCommandParser } = await import('../../../../slash-commands/SlashCommandParser.js');
        const { ARGUMENT_TYPE, SlashCommandArgument } = await import('../../../../slash-commands/SlashCommandArgument.js');

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
    } catch (e) {
        console.debug('[ChatNovel] New-style slash command registration failed:', e.message);
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
