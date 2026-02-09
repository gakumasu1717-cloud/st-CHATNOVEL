/**
 * Chat Novel — Regex Engine (Export-only)
 * 
 * In the DOM-based architecture, ST already applies all regex transformations
 * before we read the chat. This module is kept minimal for potential
 * offline/JSONL-based export scenarios only.
 */

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

    try {
        return new RegExp(regexStr, 'gi');
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
        const findRegex = regexFromString(script.findRegex);
        if (!findRegex) return text;

        let replaceStr = script.replaceString || '';

        // Handle {{match}} macro — $& is the correct JS replacement for full match
        replaceStr = replaceStr.replace(/\{\{match\}\}/gi, '$&');

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
