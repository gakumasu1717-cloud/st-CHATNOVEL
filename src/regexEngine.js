/**
 * Chat Novel — Regex Engine
 * Reads ST regex settings and applies transformations to message text.
 */

/**
 * Get all regex scripts from ST's extension settings.
 * Combines global, scoped (character), and preset scripts.
 * @returns {Array} Array of regex script objects
 */
export function getRegexScripts() {
    try {
        const context = SillyTavern.getContext();
        const extensionSettings = context.extensionSettings;

        const scripts = [];

        // Global regex scripts
        if (Array.isArray(extensionSettings?.regex)) {
            for (const script of extensionSettings.regex) {
                if (!script.disabled) {
                    scripts.push({ ...script, _source: 'global' });
                }
            }
        }

        // Character-scoped regex scripts
        try {
            const characterId = context.characterId;
            if (characterId !== undefined && context.characters?.[characterId]) {
                const character = context.characters[characterId];
                const scopedScripts = character?.data?.extensions?.regex_scripts;
                if (Array.isArray(scopedScripts)) {
                    for (const script of scopedScripts) {
                        if (!script.disabled) {
                            scripts.push({ ...script, _source: 'scoped' });
                        }
                    }
                }
            }
        } catch (e) {
            console.debug('[ChatNovel] No scoped regex scripts found');
        }

        return scripts;
    } catch (e) {
        console.warn('[ChatNovel] Failed to load regex scripts:', e);
        return [];
    }
}

/**
 * Convert a regex string (like "/pattern/flags") to a RegExp object.
 * @param {string} regexStr
 * @returns {RegExp|null}
 */
export function regexFromString(regexStr) {
    if (!regexStr) return null;

    const match = regexStr.match(/^\/(.*?)\/([gimsuy]*)$/);
    if (match) {
        try {
            return new RegExp(match[1], match[2]);
        } catch (e) {
            console.warn(`[ChatNovel] Invalid regex: ${regexStr}`, e);
            return null;
        }
    }

    // Try as plain regex without delimiters
    try {
        return new RegExp(regexStr, 'gi');
    } catch (e) {
        console.warn(`[ChatNovel] Invalid regex: ${regexStr}`, e);
        return null;
    }
}

/**
 * Apply a single regex script to a string.
 * Handles {{match}} macro and capture group references ($1, $2, etc.).
 * @param {Object} script - The regex script object
 * @param {string} text - The input text
 * @param {Object} [options] - Options
 * @param {string} [options.characterName] - Character name for replacements
 * @returns {string}
 */
export function applyRegexScript(script, text, options = {}) {
    if (!script || !script.findRegex || !text) return text;

    try {
        const findRegex = regexFromString(script.findRegex);
        if (!findRegex) return text;

        let replaceStr = script.replaceString || '';

        // Handle {{match}} macro — $& is the correct JS replacement for full match
        replaceStr = replaceStr.replace(/\{\{match\}\}/gi, '$&');

        // Handle {{charkey}} macro — ST's character folder key (avatar-based)
        if (options.characterKey) {
            replaceStr = replaceStr.replace(/\{\{charkey\}\}/gi, options.characterKey);
        } else if (options.characterName) {
            // Fallback: use character name if charkey not provided
            replaceStr = replaceStr.replace(/\{\{charkey\}\}/gi, options.characterName);
        }

        // Handle {{char}} macro — character display name
        if (options.characterName) {
            replaceStr = replaceStr.replace(/\{\{char\}\}/gi, options.characterName);
        }

        // Handle {{user}} macro
        if (options.userName) {
            replaceStr = replaceStr.replace(/\{\{user\}\}/gi, options.userName);
        }

        let result = text.replace(findRegex, replaceStr);

        // Handle trimStrings option
        if (script.trimStrings) {
            for (const trimStr of script.trimStrings) {
                result = result.replaceAll(trimStr, '');
            }
        }

        return result;
    } catch (e) {
        console.warn(`[ChatNovel] Regex script error (${script.scriptName || 'unnamed'}):`, e);
        return text;
    }
}

/**
 * Apply all applicable regex scripts to a message text.
 * Filters by placement: we want scripts that affect AI output or markdown display.
 * @param {string} text - The raw message text
 * @param {Object} [options]
 * @param {boolean} [options.isUser] - Whether this is a user message
 * @param {string} [options.characterName] - Character name
 * @returns {string}
 */
export function applyAllRegex(text, options = {}) {
    if (!text) return text;

    const scripts = getRegexScripts();
    let result = text;

    for (const script of scripts) {
        // Check placement filters
        const placement = script.placement || [];

        // regex_placement values: MD_DISPLAY=0, USER_INPUT=1, AI_OUTPUT=2, SLASH_COMMAND=3, WORLD_INFO=5, REASONING=6
        // For novel display, we want scripts that apply to markdown display or AI output
        const appliesToDisplay = script.markdownOnly ||
            placement.includes(0) || // MD_DISPLAY (deprecated but may exist)
            placement.includes(2);    // AI_OUTPUT

        // Also apply scripts that affect user input if it's a user message
        const appliesToUserInput = options.isUser && placement.includes(1);

        // Apply if it matches any relevant placement, or if no placement filter is set
        if (appliesToDisplay || appliesToUserInput || placement.length === 0) {
            result = applyRegexScript(script, result, options);
        }
    }

    return result;
}

/**
 * Get the full list of regex scripts for export (including disabled ones for reference).
 * @returns {Array}
 */
export function getAllRegexScriptsForExport() {
    try {
        const context = SillyTavern.getContext();
        const extensionSettings = context.extensionSettings;
        return Array.isArray(extensionSettings?.regex) ? extensionSettings.regex : [];
    } catch (e) {
        return [];
    }
}
