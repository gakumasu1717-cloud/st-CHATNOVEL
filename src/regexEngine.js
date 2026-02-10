/**
 * Chat Novel — Regex Engine
 * Applies SillyTavern regex scripts to message text.
 * Reproduces the same regex pipeline ST uses for chat display.
 */

/**
 * Determine regex flags from a ST script's substituteRegex field.
 * @param {Object} script
 * @returns {string}
 */
function getRegexFlags(script) {
    switch (script.substituteRegex) {
        case 0: return 'gi';  // global + case-insensitive (default)
        case 1: return 'g';   // global only
        case 2: return 'i';   // case-insensitive only
        case 3: return '';    // no flags
        default: return 'gi';
    }
}

/**
 * Convert a regex string (like "/pattern/flags" or plain pattern) to a RegExp object.
 * @param {string} regexStr
 * @param {Object} [script] - ST regex script (for substituteRegex flag lookup)
 * @returns {RegExp|null}
 */
export function regexFromString(regexStr, script = null) {
    if (!regexStr) return null;

    // 1. /pattern/flags format — parse as-is
    const match = regexStr.match(/^\/(.*?)\/([gimsuy]*)$/);
    if (match) {
        try {
            return new RegExp(match[1], match[2]);
        } catch (e) {
            console.warn(`[ChatNovel] Invalid regex: ${regexStr}`, e);
            return null;
        }
    }

    // 2. Plain pattern string — use substituteRegex field for flags
    const flags = script != null ? getRegexFlags(script) : 'gi';
    try {
        return new RegExp(regexStr, flags);
    } catch (e) {
        console.warn(`[ChatNovel] Invalid regex: ${regexStr}`, e);
        return null;
    }
}

/**
 * Apply a single regex script to a string.
 * @param {Object} script - The regex script object
 * @param {string} text - The input text
 * @param {Object} [options]
 * @param {string} [options.characterName]
 * @param {string} [options.characterKey]
 * @param {string} [options.userName]
 * @returns {string}
 */
export function applyRegexScript(script, text, options = {}) {
    if (!script || !script.findRegex || !text) return text;

    try {
        const findRegex = regexFromString(script.findRegex, script);
        if (!findRegex) return text;

        let replaceStr = script.replaceString || '';

        // Handle {{match}} macro — $& is the correct JS replacement for full match
        replaceStr = replaceStr.replace(/\{\{match\}\}/gi, '$&');

        // Handle {{charkey}} — ST character folder key (avatar-based)
        if (options.characterKey) {
            replaceStr = replaceStr.replace(/\{\{charkey\}\}/gi, options.characterKey);
        } else if (options.characterName) {
            replaceStr = replaceStr.replace(/\{\{charkey\}\}/gi, options.characterName);
        }

        if (options.characterName) {
            replaceStr = replaceStr.replace(/\{\{char\}\}/gi, options.characterName);
        }

        if (options.userName) {
            replaceStr = replaceStr.replace(/\{\{user\}\}/gi, options.userName);
        }

        let result = text.replace(findRegex, replaceStr);

        // Handle trimStrings — array of strings to remove after replacement
        if (script.trimStrings && Array.isArray(script.trimStrings)) {
            for (const trimStr of script.trimStrings) {
                if (trimStr) result = result.replaceAll(trimStr, '');
            }
        }

        return result;
    } catch (e) {
        console.warn(`[ChatNovel] Regex script error (${script.scriptName || 'unnamed'}):`, e);
        return text;
    }
}

/**
 * Apply all matching ST regex scripts to a message string.
 * Reads scripts from SillyTavern.getContext().extensionSettings.
 * @param {string} text - The raw message text
 * @param {Object} options
 * @param {boolean} options.isUser - Whether the message is from the user
 * @param {string} options.characterName
 * @param {string} [options.characterKey]
 * @param {string} [options.userName]
 * @returns {string}
 */
export function applyAllRegex(text, options = {}) {
    if (!text) return text;

    try {
        const context = SillyTavern.getContext();
        const scripts = context.extensionSettings?.regex?.scripts;

        if (!scripts || !Array.isArray(scripts)) return text;

        let result = text;

        for (const script of scripts) {
            // Skip disabled scripts
            if (script.disabled) continue;

            // Skip prompt-only scripts
            if (script.promptOnly) continue;

            // Check placement (2 = AI_OUTPUT, 1 = USER_INPUT, 0 = MD_DISPLAY)
            // For novel display: apply AI_OUTPUT scripts to AI messages,
            // USER_INPUT scripts to user messages, MD_DISPLAY to all
            if (script.placement && Array.isArray(script.placement)) {
                const isAiOutput = script.placement.includes(2);
                const isUserInput = script.placement.includes(1);
                const isMdDisplay = script.placement.includes(0);

                if (options.isUser && !isUserInput && !isMdDisplay) continue;
                if (!options.isUser && !isAiOutput && !isMdDisplay) continue;
            }

            // Skip markdownOnly scripts — we handle those in our own renderer
            if (script.markdownOnly) continue;

            result = applyRegexScript(script, result, options);
        }

        return result;
    } catch (e) {
        console.warn('[ChatNovel] applyAllRegex error:', e);
        return text;
    }
}
