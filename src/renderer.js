/**
 * Chat Novel — Renderer
 * Renders parsed messages and chapters to HTML for the novel reader.
 * Pipeline: raw mes → macro substitution → regex → choices → markdown → dialogue styling.
 */

import { escapeHtml } from './utils.js';
import { createImageHtml } from './imageHandler.js';

// ===== Macro Substitution =====

/**
 * Replace {{user}} macros in text.
 * @param {string} text
 * @param {string} userName
 * @returns {string}
 */
function substituteUserMacro(text, userName) {
    if (!text || !userName) return text;
    return text.replace(/\{\{user\}\}/gi, userName);
}

/**
 * Replace {{char}} macros in text.
 * @param {string} text
 * @param {string} characterName
 * @returns {string}
 */
function substituteCharMacro(text, characterName) {
    if (!text || !characterName) return text;
    return text.replace(/\{\{char\}\}/gi, characterName);
}

// ===== Previous Info Block Removal =====

/**
 * Strip <details> blocks whose summary contains "이전 정보".
 * Uses two strategies:
 * 1. Pattern-based: look for ``` + </details> marker (most reliable)
 * 2. Depth counting fallback: handle nested <details> by counting open/close
 * @param {string} text
 * @returns {string}
 */
function stripPreviousInfoBlocks(text) {
    if (!text) return text;

    const headerRe = /<details[^>]*>\s*<summary[^>]*>[^<]*이전\s*정보[^<]*<\/summary>/i;
    let iterations = 0;
    let match;

    while ((match = headerRe.exec(text)) !== null && iterations < 10) {
        iterations++;
        const afterMatch = text.substring(match.index + match[0].length);

        // Strategy 1: Find ``` followed by </details> (the code-fence wrapping pattern)
        const fenceEndRe = /```\s*<\/details\s*>/;
        const fenceEndMatch = fenceEndRe.exec(afterMatch);
        if (fenceEndMatch) {
            const endPos = match.index + match[0].length + fenceEndMatch.index + fenceEndMatch[0].length;
            text = text.substring(0, match.index) + text.substring(endPos);
            continue;
        }

        // Strategy 2: Find </details> right after a line break (simple fallback)
        const simpleEndRe = /\n<\/details\s*>/;
        const simpleEndMatch = simpleEndRe.exec(afterMatch);
        if (simpleEndMatch) {
            const endPos = match.index + match[0].length + simpleEndMatch.index + simpleEndMatch[0].length;
            text = text.substring(0, match.index) + text.substring(endPos);
            continue;
        }

        // Strategy 3: Depth counting (last resort)
        let depth = 1;
        let pos = match.index + match[0].length;
        let found = false;
        while (depth > 0 && pos < text.length) {
            const openIdx = text.indexOf('<details', pos);
            const closeIdx = text.indexOf('</details', pos);
            if (closeIdx === -1) break;
            if (openIdx !== -1 && openIdx < closeIdx) {
                depth++;
                pos = openIdx + 8;
            } else {
                depth--;
                if (depth === 0) {
                    const endIdx = text.indexOf('>', closeIdx) + 1;
                    text = text.substring(0, match.index) + text.substring(endIdx);
                    found = true;
                    break;
                }
                pos = closeIdx + 10;
            }
        }
        if (!found) break; // Prevent infinite loop
    }

    return text;
}

// ===== Choices Processing =====

/**
 * Process <choices> blocks and numbered choice patterns.
 * Converts them into styled choice cards.
 * @param {string} text
 * @returns {string}
 */
function processChoices(text) {
    if (!text) return text;

    // Handle <choices>...</choices> blocks
    text = text.replace(/<choices>([\s\S]*?)<\/choices>/gi, (match, content) => {
        const lines = content.trim().split('\n').filter(l => l.trim());
        if (lines.length === 0) return match;

        let html = '<div class="cn-choices-container"><div class="cn-choices-header">선택지</div>';
        lines.forEach((line, i) => {
            const cleanLine = line.replace(/^\d+[\.\)\-]\s*/, '').trim();
            if (cleanLine) {
                html += `<div class="cn-choice-card"><span class="cn-choice-number">${i + 1}.</span><span class="cn-choice-text">${escapeHtml(cleanLine)}</span></div>`;
            }
        });
        html += '</div>';
        return html;
    });

    return text;
}

// ===== Markdown Rendering =====

/**
 * Render markdown-like text to HTML.
 * Handles headings, bold, italic, code, links, lists, HR, blockquotes.
 * Protects multi-line HTML blocks (from regex scripts) from line-based processing.
 * Converts complete HTML documents to sandboxed iframes.
 * @param {string} text
 * @returns {string}
 */
function renderMarkdown(text) {
    if (!text) return '';

    // === Protect multi-line HTML blocks from markdown processing ===
    const protectedBlocks = [];
    function protectBlock(match) {
        const idx = protectedBlocks.length;
        protectedBlocks.push(match);
        return `\x00HTMLBLOCK${idx}\x00`;
    }

    // *** Code fences MUST be extracted FIRST ***
    // Regex scripts wrap OLD state in code fences (```) inside <details>이전 정보.
    // If we extract DOCTYPEs first, we'd capture OLD DOCTYPEs inside code fences
    // and turn them into broken iframes with no data.
    const codeBlocks = [];
    text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (match, lang, code) => {
        const idx = codeBlocks.length;
        codeBlocks.push(`<pre class="cn-code-block"><code>${escapeHtml(code.trim())}</code></pre>`);
        return `\x00CODEBLOCK${idx}\x00`;
    });

    // Complete HTML documents from regex scripts (choices, status panels, etc.).
    // MUST be before inline code extraction — backticks in HTML (template literals,
    // etc.) would be captured as inline code and corrupt the DOCTYPE content.
    text = text.replace(/<!DOCTYPE\s+html[^>]*>[\s\S]*?<\/html>/gi, (match) => {
        const idx = protectedBlocks.length;
        protectedBlocks.push(
            `<div class="cn-regex-html-pending" style="display:none">${escapeHtml(match)}</div>`
        );
        return `\x00HTMLBLOCK${idx}\x00`;
    });

    // Protect inline code (AFTER DOCTYPE extraction to avoid corrupting HTML)
    const inlineCodes = [];
    text = text.replace(/`([^`]+)`/g, (match, code) => {
        const idx = inlineCodes.length;
        inlineCodes.push(`<code class="cn-inline-code">${escapeHtml(code)}</code>`);
        return `\x00INLINECODE${idx}\x00`;
    });

    // Protect <style>...</style> blocks
    text = text.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, protectBlock);

    // Protect <script>...</script> blocks
    text = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, protectBlock);

    // Protect <svg>...</svg> blocks
    text = text.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, protectBlock);

    // Protect <table>...</table> blocks
    text = text.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, protectBlock);

    // === Line-by-line processing with HTML block depth tracking ===
    // Block-level HTML elements that can span multiple lines.
    // Content inside these must NOT be processed as markdown.
    const blockOpenRe = /<(div|details|section|article|aside|nav|header|footer|form|fieldset|figure|main|iframe|pre|dl)\b/gi;
    const blockCloseRe = /<\/(div|details|section|article|aside|nav|header|footer|form|fieldset|figure|main|iframe|pre|dl)\s*>/gi;

    function countBlockOpens(str) { return (str.match(blockOpenRe) || []).length; }
    function countBlockCloses(str) { return (str.match(blockCloseRe) || []).length; }

    let lines = text.split('\n');
    let result = [];
    let inList = false;
    let listType = '';
    let htmlBlockDepth = 0;

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        const trimmed = line.trim();

        // --- HTML block depth tracking ---
        // When inside a block element, pass ALL lines through without markdown processing.
        if (htmlBlockDepth > 0) {
            const opens = countBlockOpens(trimmed);
            const closes = countBlockCloses(trimmed);
            htmlBlockDepth += opens - closes;
            if (htmlBlockDepth < 0) htmlBlockDepth = 0;
            result.push(line);
            continue;
        }

        // Check if this line starts a multi-line HTML block
        if (/^<[a-zA-Z]/.test(trimmed)) {
            const opens = countBlockOpens(trimmed);
            const closes = countBlockCloses(trimmed);
            if (opens > closes) {
                // Multi-line block starts here
                htmlBlockDepth = opens - closes;
                result.push(line);
                continue;
            }
            // Balanced single-line block or non-block element — pass through
            result.push(trimmed);
            continue;
        }

        // Closing HTML tag on its own line (e.g. </div>) — pass through
        if (/^<\/[a-zA-Z]/.test(trimmed)) {
            const closes = countBlockCloses(trimmed);
            // Should not happen if depth tracking is correct, but handle gracefully
            htmlBlockDepth -= closes;
            if (htmlBlockDepth < 0) htmlBlockDepth = 0;
            result.push(trimmed);
            continue;
        }

        // Close list if non-list line
        if (inList && !trimmed.match(/^[\-\*]\s/) && !trimmed.match(/^\d+\.\s/)) {
            result.push(listType === 'ul' ? '</ul>' : '</ol>');
            inList = false;
        }

        // Empty line
        if (!trimmed) {
            result.push('<br />');
            continue;
        }

        // Headings
        const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
        if (headingMatch) {
            const level = headingMatch[1].length;
            const content = processInlineMarkdown(headingMatch[2]);
            result.push(`<h${level} class="cn-heading">${content}</h${level}>`);
            continue;
        }

        // Horizontal rule
        if (/^[-*_]{3,}\s*$/.test(trimmed)) {
            result.push('<hr class="cn-hr" />');
            continue;
        }

        // Blockquote
        if (trimmed.startsWith('>')) {
            const quoteContent = processInlineMarkdown(trimmed.replace(/^>\s?/, ''));
            result.push(`<blockquote class="cn-blockquote">${quoteContent}</blockquote>`);
            continue;
        }

        // Unordered list
        const ulMatch = trimmed.match(/^[\-\*]\s+(.+)$/);
        if (ulMatch) {
            if (!inList || listType !== 'ul') {
                if (inList) result.push(listType === 'ul' ? '</ul>' : '</ol>');
                result.push('<ul class="cn-list">');
                inList = true;
                listType = 'ul';
            }
            result.push(`<li class="cn-list-item">${processInlineMarkdown(ulMatch[1])}</li>`);
            continue;
        }

        // Ordered list
        const olMatch = trimmed.match(/^\d+\.\s+(.+)$/);
        if (olMatch) {
            if (!inList || listType !== 'ol') {
                if (inList) result.push(listType === 'ul' ? '</ul>' : '</ol>');
                result.push('<ol class="cn-list">');
                inList = true;
                listType = 'ol';
            }
            result.push(`<li class="cn-list-item">${processInlineMarkdown(olMatch[1])}</li>`);
            continue;
        }

        // Protected block placeholders — pass through as-is
        if (/^\x00(HTMLBLOCK|CODEBLOCK|INLINECODE)\d+\x00$/.test(trimmed)) {
            result.push(trimmed);
            continue;
        }

        // Normal paragraph
        result.push(`<p class="cn-paragraph">${processInlineMarkdown(trimmed)}</p>`);
    }

    // Close open list
    if (inList) {
        result.push(listType === 'ul' ? '</ul>' : '</ol>');
    }

    text = result.join('\n');

    // Restore code blocks
    codeBlocks.forEach((block, i) => {
        text = text.replace(`\x00CODEBLOCK${i}\x00`, block);
    });
    inlineCodes.forEach((code, i) => {
        text = text.replace(`\x00INLINECODE${i}\x00`, code);
    });

    // Restore protected HTML blocks (must be last — after all other restore steps)
    protectedBlocks.forEach((block, i) => {
        text = text.replace(`\x00HTMLBLOCK${i}\x00`, block);
    });

    return text;
}

/**
 * Process inline markdown (bold, italic, links, etc.)
 * @param {string} text
 * @returns {string}
 */
function processInlineMarkdown(text) {
    if (!text) return '';

    // Bold + Italic (***text***)
    text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');

    // Bold (**text**)
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Italic (*text*)
    text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Strikethrough (~~text~~)
    text = text.replace(/~~(.+?)~~/g, '<del>$1</del>');

    // Links [text](url)
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    return text;
}

// ===== Dialogue Styling =====

/**
 * Style dialogue text (quoted speech).
 * @param {string} html
 * @param {boolean} enabled
 * @returns {string}
 */
function styleDialogue(html, enabled) {
    if (!enabled || !html) return html;

    // Style "quoted speech" with dialogue class
    html = html.replace(/(?<=>|^)([^<]*?"[^"]*?"[^<]*?)(?=<|$)/g, (match) => {
        return match.replace(/"([^"]+)"/g, '<span class="cn-dialogue">"$1"</span>');
    });

    return html;
}

// ===== Extra Image Rendering =====

/**
 * Render images stored in message.extra (ST image system).
 * ST stores images separately from mes text — in extra.media[] (current)
 * or extra.image (deprecated). These include SD-generated, pasted,
 * auto-pic, and other extension images.
 * @param {Object} message - Parsed message object
 * @returns {string} HTML string for images, or empty string
 */
function renderExtraImages(message) {
    if (!message.extra) return '';

    const images = [];
    // Use a raw copy to avoid ST's Proxy deprecation warnings
    const extra = Object.assign({}, message.extra);

    // Current format: extra.media[] array of MediaAttachment objects
    if (Array.isArray(extra.media)) {
        for (const media of extra.media) {
            if (media && media.url && (!media.type || media.type === 'image')) {
                images.push({ src: media.url, alt: media.title || '' });
            }
        }
    }

    // Deprecated: extra.image (single image URL)
    if (images.length === 0 && extra.image) {
        images.push({ src: extra.image, alt: extra.title || '' });
    }

    // Deprecated: extra.image_swipes (multiple image URLs)
    if (images.length === 0 && Array.isArray(extra.image_swipes)) {
        // Use media_index or default to last swipe (ST default)
        const idx = extra.media_index ?? (extra.image_swipes.length - 1);
        const url = extra.image_swipes[idx] || extra.image_swipes[extra.image_swipes.length - 1];
        if (url) {
            images.push({ src: url, alt: extra.title || '' });
        }
    }

    if (images.length === 0) return '';

    return '<div class="cn-extra-images">' +
        images.map(img => createImageHtml(img.src, img.alt)).join('') +
        '</div>';
}

// ===== Public API =====

/**
 * Render a single message to HTML.
 * @param {Object} message - Parsed message object
 * @param {Object} options - Rendering options
 * @param {string} options.userName
 * @param {string} options.characterName
 * @param {string} [options.characterKey]
 * @param {boolean} [options.dialogueEnabled]
 * @param {Function} [options.regexProcessor] - (text, opts) => processed text
 * @returns {string} HTML string
 */
export function renderMessage(message, options) {
    let text = message.mes || '';

    // 1. Macro substitution
    text = substituteUserMacro(text, options.userName);
    text = substituteCharMacro(text, options.characterName);

    // 2. ST regex scripts (image conversion, custom tags, etc.)
    if (options.regexProcessor) {
        text = options.regexProcessor(text, {
            isUser: message.is_user,
            characterName: options.characterName,
            characterKey: options.characterKey,
            userName: options.userName,
        });
    }

    // 2.5. Strip "이전 정보" details blocks BEFORE any HTML processing.
    const beforeStripLen = text.length;
    text = stripPreviousInfoBlocks(text);
    const hasDOCTYPE = /<!DOCTYPE/i.test(text);
    const hasHtml = /<\/html>/i.test(text);
    console.log(`[ChatNovel] msg ${message._index}: stripPreviousInfo: ${beforeStripLen} -> ${text.length} chars, DOCTYPE=${hasDOCTYPE}, </html>=${hasHtml}, first150=${JSON.stringify(text.substring(0, 150))}`);

    // 3. Protect DOCTYPE blocks from choices processing.
    // Regex scripts have their own choices UI (선택/대필 buttons) inside DOCTYPE docs.
    // processChoices must NOT modify <choices> tags inside those documents.
    const doctypeBlocks = [];
    text = text.replace(/<!DOCTYPE\s+html[^>]*>[\s\S]*?<\/html>/gi, (match) => {
        doctypeBlocks.push(match);
        return `\x00DOCTYPEHOLD${doctypeBlocks.length - 1}\x00`;
    });

    // 4. Choices processing (fallback for patterns not caught by regex)
    text = processChoices(text);

    // 5. Restore DOCTYPE blocks
    doctypeBlocks.forEach((block, i) => {
        text = text.replace(`\x00DOCTYPEHOLD${i}\x00`, block);
    });

    // 6. Markdown → HTML
    text = renderMarkdown(text);

    // 7. Dialogue styling
    text = styleDialogue(text, options.dialogueEnabled);

    // 8. Extra images (SD-generated, pasted, auto-pic, etc.)
    const extraImgHtml = renderExtraImages(message);
    if (extraImgHtml) {
        if (message.extra?.inline_image) {
            // inline_image = image IS the message (text hidden in ST)
            text = extraImgHtml;
        } else {
            text += extraImgHtml;
        }
    }

    return text;
}

/**
 * Render a full chapter to HTML.
 * @param {Object} chapter - Chapter object from chapterizer
 * @param {Object} options - Rendering options
 * @param {boolean} [options.showSenderName=true] - Whether to show sender names
 * @returns {string} HTML string
 */
export function renderChapter(chapter, options) {
    let html = `<div class="cn-chapter" data-chapter="${chapter.index}" id="cn-chapter-${chapter.index}">`;
    html += `<h2 class="cn-chapter-title">${escapeHtml(chapter.title)}</h2>`;

    if (chapter.startDate && chapter.startDate.getTime() > 0) {
        const dateStr = formatDate(chapter.startDate);
        html += `<div class="cn-chapter-date">${dateStr}</div>`;
    }

    html += '<div class="cn-chapter-content">';

    for (const msg of chapter.messages) {
        const renderedText = renderMessage(msg, options);
        const roleClass = msg.is_user ? 'cn-msg-user' : (msg.is_system ? 'cn-msg-system' : 'cn-msg-character');
        const senderName = msg.is_system ? '' : msg.name;

        html += `<div class="cn-message ${roleClass}" data-msg-index="${msg._index}">`;

        if (senderName && !msg.is_system && options.showSenderName !== false) {
            html += `<div class="cn-msg-sender">${escapeHtml(senderName)}</div>`;
        }

        html += `<div class="cn-msg-body">${renderedText}</div>`;
        html += '</div>';
    }

    html += '</div></div>';
    return html;
}

/**
 * Format a Date to a readable string.
 * @param {Date} date
 * @returns {string}
 */
function formatDate(date) {
    if (!date || isNaN(date.getTime())) return '';
    try {
        return date.toLocaleDateString('ko-KR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return date.toISOString();
    }
}

