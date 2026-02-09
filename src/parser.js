/**
 * Chat Novel — Parser
 * Parses SillyTavern chat data from DOM or JSONL into structured data.
 */

/**
 * @typedef {Object} ChatMetadata
 * @property {string} user_name
 * @property {string} character_name
 * @property {string} create_date
 * @property {Object} chat_metadata
 */

/**
 * @typedef {Object} ChatMessage
 * @property {string} name
 * @property {boolean} is_user
 * @property {boolean} [is_system]
 * @property {string} mes - Original raw text (for search / fallback)
 * @property {string|null} [renderedHtml] - Pre-rendered HTML from ST DOM
 * @property {string|number} send_date
 * @property {Object} [extra]
 * @property {number} [swipe_id]
 * @property {string[]} [swipes]
 * @property {Object[]} [swipe_info]
 * @property {number} _index - Original index in the JSONL
 * @property {Date} _parsedDate - Normalized date
 */

/**
 * @typedef {Object} ParsedChat
 * @property {ChatMetadata} metadata
 * @property {ChatMessage[]} messages
 */

/**
 * Normalize send_date to a Date object.
 * Handles Unix timestamps (number or numeric string) and text date strings.
 * @param {string|number} sendDate
 * @returns {Date}
 */
export function normalizeSendDate(sendDate) {
    if (!sendDate) return new Date(0);

    // Unix timestamp in milliseconds (number)
    if (typeof sendDate === 'number') {
        return new Date(sendDate);
    }

    // Numeric string — could be Unix timestamp
    if (typeof sendDate === 'string' && /^\d+$/.test(sendDate.trim())) {
        const num = Number(sendDate.trim());
        // If it looks like seconds (< year 2100 in seconds), convert to ms
        if (num < 1e12) {
            return new Date(num * 1000);
        }
        return new Date(num);
    }

    // SillyTavern style: "October 17, 2025 10:16am"
    if (typeof sendDate === 'string') {
        const d = new Date(sendDate);
        if (!isNaN(d.getTime())) return d;

        // Try parsing "2025-10-17@10h16m24s" format
        const match = sendDate.match(/(\d{4})-(\d{2})-(\d{2})@(\d{2})h(\d{2})m(\d{2})s/);
        if (match) {
            return new Date(
                parseInt(match[1]),
                parseInt(match[2]) - 1,
                parseInt(match[3]),
                parseInt(match[4]),
                parseInt(match[5]),
                parseInt(match[6])
            );
        }
    }

    return new Date(0);
}

/**
 * Parse a JSONL string into structured chat data.
 * @param {string} jsonlContent - The raw JSONL content
 * @returns {ParsedChat}
 */
export function parseJSONL(jsonlContent) {
    const lines = jsonlContent
        .split('\n')
        .filter(line => line.trim().length > 0);

    if (lines.length === 0) {
        throw new Error('Empty JSONL content');
    }

    // First line is metadata
    let metadata;
    try {
        metadata = JSON.parse(lines[0]);
    } catch (e) {
        throw new Error(`Failed to parse metadata line: ${e.message}`);
    }

    // Remaining lines are messages
    const messages = [];
    for (let i = 1; i < lines.length; i++) {
        try {
            const msg = JSON.parse(lines[i]);
            msg._index = i;
            msg._parsedDate = normalizeSendDate(msg.send_date);

            // Handle swipes — use the swipe_id to pick the current message
            if (msg.swipes && Array.isArray(msg.swipes) && typeof msg.swipe_id === 'number') {
                const selectedSwipe = msg.swipes[msg.swipe_id];
                if (selectedSwipe !== undefined && selectedSwipe !== null) {
                    msg.mes = selectedSwipe;
                }
            }

            messages.push(msg);
        } catch (e) {
            console.warn(`[ChatNovel] Skipping malformed JSONL line ${i + 1}: ${e.message}`);
        }
    }

    return { metadata, messages };
}

/**
 * Parse chat data from the ST context (context.chat array).
 * @param {Array} chatArray - ST context.chat array
 * @param {string} userName - The user's display name
 * @param {string} characterName - The character's display name
 * @returns {ParsedChat}
 */
export function parseChatArray(chatArray, userName, characterName) {
    if (!Array.isArray(chatArray) || chatArray.length === 0) {
        throw new Error('Chat array is empty or invalid');
    }

    const metadata = {
        user_name: userName || 'User',
        character_name: characterName || 'Character',
        create_date: new Date().toISOString(),
        chat_metadata: {},
    };

    const messages = [];
    for (let i = 0; i < chatArray.length; i++) {
        const item = chatArray[i];

        // Skip the metadata entry (first entry sometimes has no 'mes' field)
        if (!item.mes && item.user_name) {
            metadata.user_name = item.user_name || metadata.user_name;
            metadata.character_name = item.character_name || metadata.character_name;
            metadata.create_date = item.create_date || metadata.create_date;
            metadata.chat_metadata = item.chat_metadata || {};
            continue;
        }

        if (!item.mes && !item.name) continue;

        const msg = {
            name: item.name || (item.is_user ? userName : characterName),
            is_user: !!item.is_user,
            is_system: !!item.is_system,
            mes: item.mes || '',
            send_date: item.send_date || '',
            extra: item.extra || {},
            swipe_id: item.swipe_id,
            swipes: item.swipes,
            swipe_info: item.swipe_info,
            _index: i,
            _parsedDate: normalizeSendDate(item.send_date),
        };

        // Handle swipes
        if (msg.swipes && Array.isArray(msg.swipes) && typeof msg.swipe_id === 'number') {
            const selectedSwipe = msg.swipes[msg.swipe_id];
            if (selectedSwipe !== undefined && selectedSwipe !== null) {
                msg.mes = selectedSwipe;
            }
        }

        messages.push(msg);
    }

    return { metadata, messages };
}

/**
 * Parse chat data from the ST chat DOM.
 * Extracts already-rendered HTML (with all regex, JS-Slash-Runner, LALib processing applied).
 * Falls back to context.chat raw text for messages not present in DOM (lazy rendering).
 * @returns {ParsedChat}
 */
export function parseChatFromDOM() {
    const context = SillyTavern.getContext();
    const chat = context.chat || [];
    const userName = context.name1 || 'User';
    const characterName = context.characters?.[context.characterId]?.name || context.name2 || 'Character';

    // Metadata
    const metaEntry = chat[0]?.chat_metadata ? chat[0] : chat.find(m => m.chat_metadata);
    const metadata = {
        user_name: userName,
        character_name: characterName,
        create_date: metaEntry?.create_date || new Date().toISOString(),
        chat_metadata: metaEntry?.chat_metadata || {},
    };

    // Build a map of DOM-rendered messages by mesid
    const domMap = new Map();
    const messageElements = document.querySelectorAll('#chat .mes');
    messageElements.forEach((el) => {
        const mesId = parseInt(el.getAttribute('data-mesid'), 10);
        if (isNaN(mesId)) return;

        const isUser = el.classList.contains('is_user');
        const isSystem = el.classList.contains('is_system');
        const nameEl = el.querySelector('.ch_name .name_text');
        const textEl = el.querySelector('.mes_text');

        domMap.set(mesId, {
            renderedHtml: textEl ? textEl.innerHTML : null,
            domName: nameEl?.textContent?.trim() || '',
            isUser,
            isSystem,
        });
    });

    // Walk through context.chat to build the full message list
    // (DOM may be missing some messages due to ST lazy rendering)
    const messages = [];
    for (let i = 0; i < chat.length; i++) {
        const item = chat[i];

        // Skip metadata-only entries
        if (!item.mes && !item.name && item.user_name) continue;
        if (!item.mes && !item.name) continue;

        const domData = domMap.get(i);
        const isUser = domData?.isUser ?? !!item.is_user;
        const isSystem = domData?.isSystem ?? !!item.is_system;

        // Handle swipes for the raw text fallback
        let rawMes = item.mes || '';
        if (item.swipes && Array.isArray(item.swipes) && typeof item.swipe_id === 'number') {
            const selectedSwipe = item.swipes[item.swipe_id];
            if (selectedSwipe != null) rawMes = selectedSwipe;
        }

        messages.push({
            name: domData?.domName || item.name || (isUser ? userName : characterName),
            is_user: isUser,
            is_system: isSystem,
            mes: rawMes,
            renderedHtml: domData?.renderedHtml || null,
            send_date: item.send_date || '',
            extra: item.extra || {},
            _index: i,
            _parsedDate: normalizeSendDate(item.send_date),
        });
    }

    return { metadata, messages };
}
