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

// One-time diagnostic flag
let _diagLogged = false;

/**
 * Collect regex scripts from all known ST storage locations.
 * ST stores scripts in multiple possible paths depending on version/config.
 * @param {Object} context - SillyTavern context
 * @returns {Array} Array of regex script objects
 */
function collectRegexScripts(context) {
    const scripts = [];
    const ext = context.extensionSettings || {};

    // Path 1: extensionSettings.regex (direct array — some ST versions)
    if (Array.isArray(ext.regex)) {
        scripts.push(...ext.regex);
    }
    // Path 2: extensionSettings.regex.scripts (nested)
    else if (ext.regex && Array.isArray(ext.regex?.scripts)) {
        scripts.push(...ext.regex.scripts);
    }

    // Path 3: extensionSettings.regex_scripts (alternate key)
    if (Array.isArray(ext.regex_scripts)) {
        scripts.push(...ext.regex_scripts);
    }

    // Path 4: Character-specific regex scripts (embedded in character data)
    try {
        const charId = context.characterId;
        const charData = context.characters?.[charId]?.data;
        if (charData?.extensions?.regex_scripts && Array.isArray(charData.extensions.regex_scripts)) {
            scripts.push(...charData.extensions.regex_scripts);
        }
    } catch { /* ignore */ }

    // One-time diagnostic log
    if (!_diagLogged) {
        _diagLogged = true;
        console.log('[ChatNovel] === Regex Diagnostics ===');
        console.log('[ChatNovel] extensionSettings keys:', Object.keys(ext).sort().join(', '));
        console.log('[ChatNovel] ext.regex type:', typeof ext.regex,
            Array.isArray(ext.regex) ? `(array, length=${ext.regex.length})` :
            ext.regex ? `(object, keys=${Object.keys(ext.regex).join(',')})` : '(falsy)');
        if (ext.regex_scripts) {
            console.log('[ChatNovel] ext.regex_scripts:', Array.isArray(ext.regex_scripts) ? `array(${ext.regex_scripts.length})` : typeof ext.regex_scripts);
        }
        // Check character data
        try {
            const charData = context.characters?.[context.characterId]?.data;
            if (charData?.extensions) {
                console.log('[ChatNovel] char.data.extensions keys:', Object.keys(charData.extensions).join(', '));
            }
        } catch { /* ignore */ }
        console.log('[ChatNovel] Total scripts found:', scripts.length);
        if (scripts.length > 0) {
            console.log('[ChatNovel] Script names:', scripts.map(s => s.scriptName || '(unnamed)').join(', '));
        }
        // Check if ST exposes getRegexedString globally
        if (typeof window.getRegexedString === 'function') {
            console.log('[ChatNovel] window.getRegexedString is available');
        }
    }

    return scripts;
}

/**
 * Apply all matching ST regex scripts to a message string.
 * Searches multiple ST storage paths for regex scripts.
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

        // Collect scripts from all possible locations
        const scripts = collectRegexScripts(context);

        if (scripts.length === 0) {
            return text;
        }

        let result = text;

        for (const script of scripts) {
            // Skip disabled scripts
            if (script.disabled) continue;

            // Skip prompt-only scripts (only for API prompt building)
            if (script.promptOnly) continue;

            // Check placement (2 = AI_OUTPUT, 1 = USER_INPUT, 0 = MD_DISPLAY)
            if (script.placement && Array.isArray(script.placement)) {
                const isAiOutput = script.placement.includes(2);
                const isUserInput = script.placement.includes(1);
                const isMdDisplay = script.placement.includes(0);

                if (options.isUser && !isUserInput && !isMdDisplay) continue;
                if (!options.isUser && !isAiOutput && !isMdDisplay) continue;
            }

            // markdownOnly = "only apply during display rendering, not API"
            // We ARE rendering for display, so we MUST apply these.

            result = applyRegexScript(script, result, options);
        }

        return result;
    } catch (e) {
        console.warn('[ChatNovel] applyAllRegex error:', e);
        return text;
    }
}
