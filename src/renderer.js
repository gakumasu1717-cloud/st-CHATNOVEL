/**
 * Chat Novel — Renderer
 * Converts processed messages to styled HTML for the novel reader.
 * Handles Markdown, dialogue detection, and visual formatting.
 */

/**
 * Dialogue detection patterns for various quote styles.
 */
const DIALOGUE_PATTERNS = [
    { open: '\u201C', close: '\u201D', name: 'double-smart' },   // "…"
    { open: '"', close: '"', name: 'double-straight' },           // "…"
    { open: '\u300C', close: '\u300D', name: 'cjk-corner' },     // 「…」
    { open: '\u300E', close: '\u300F', name: 'cjk-double' },     // 『…』
    { open: '\u2018', close: '\u2019', name: 'single-smart' },   // '…'
    { open: "'", close: "'", name: 'single-straight' },           // '…'
    { open: '\u00AB', close: '\u00BB', name: 'guillemet' },       // «…»
];

/**
 * Build a regex that matches all dialogue patterns.
 * @returns {RegExp}
 */
function buildDialogueRegex() {
    const patterns = DIALOGUE_PATTERNS.map(p => {
        const open = escapeRegex(p.open);
        const close = escapeRegex(p.close);
        return `${open}([^${close}]*?)${close}`;
    });
    return new RegExp(`(${patterns.join('|')})`, 'g');
}

/**
 * Render Markdown to HTML.
 * Handles: headers, bold, italic, strikethrough, code blocks, inline code, lists, links.
 * @param {string} text
 * @returns {string}
 */
export function renderMarkdown(text) {
    if (!text) return '';

    let html = text;

    // Preserve code blocks first
    const codeBlocks = [];
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (match, lang, code) => {
        const idx = codeBlocks.length;
        codeBlocks.push(`<pre class="cn-code-block"><code class="${lang}">${escapeHtml(code.trim())}</code></pre>`);
        return `%%CODEBLOCK_${idx}%%`;
    });

    // Inline code
    const inlineCodes = [];
    html = html.replace(/`([^`]+)`/g, (match, code) => {
        const idx = inlineCodes.length;
        inlineCodes.push(`<code class="cn-inline-code">${escapeHtml(code)}</code>`);
        return `%%INLINECODE_${idx}%%`;
    });

    // Headers (# to ######)
    html = html.replace(/^######\s+(.+)$/gm, '<h6 class="cn-heading">$1</h6>');
    html = html.replace(/^#####\s+(.+)$/gm, '<h5 class="cn-heading">$1</h5>');
    html = html.replace(/^####\s+(.+)$/gm, '<h4 class="cn-heading">$1</h4>');
    html = html.replace(/^###\s+(.+)$/gm, '<h3 class="cn-heading">$1</h3>');
    html = html.replace(/^##\s+(.+)$/gm, '<h2 class="cn-heading">$1</h2>');
    html = html.replace(/^#\s+(.+)$/gm, '<h1 class="cn-heading">$1</h1>');

    // Bold + Italic (***text***)
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');

    // Bold (**text**)
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Italic (*text*)
    html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');

    // Strikethrough (~~text~~)
    html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');

    // Horizontal rules
    html = html.replace(/^---+$/gm, '<hr class="cn-hr" />');
    html = html.replace(/^\*\*\*+$/gm, '<hr class="cn-hr" />');

    // Links [text](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    // Unordered lists
    html = html.replace(/^[\s]*[-*+]\s+(.+)$/gm, '<li class="cn-list-item">$1</li>');
    html = html.replace(/(<li[^>]*>.*<\/li>\n?)+/g, '<ul class="cn-list">$&</ul>');

    // Ordered lists
    html = html.replace(/^[\s]*\d+\.\s+(.+)$/gm, '<li class="cn-list-item cn-ol-item">$1</li>');

    // Restore code blocks
    codeBlocks.forEach((block, idx) => {
        html = html.replace(`%%CODEBLOCK_${idx}%%`, block);
    });
    inlineCodes.forEach((code, idx) => {
        html = html.replace(`%%INLINECODE_${idx}%%`, code);
    });

    // Paragraphs — wrap remaining lines
    html = html
        .split('\n')
        .map(line => {
            const trimmed = line.trim();
            if (!trimmed) return '<br />';
            if (trimmed.startsWith('<h') || trimmed.startsWith('<hr') ||
                trimmed.startsWith('<pre') || trimmed.startsWith('<ul') ||
                trimmed.startsWith('<ol') || trimmed.startsWith('<li') ||
                trimmed.startsWith('<div') || trimmed.startsWith('<table') ||
                trimmed.startsWith('</')) {
                return trimmed;
            }
            return `<p class="cn-paragraph">${trimmed}</p>`;
        })
        .join('\n');

    return html;
}

/**
 * Detect and style dialogue in text.
 * @param {string} html - Already-rendered HTML
 * @param {boolean} enabled - Whether dialogue styling is enabled
 * @returns {string}
 */
export function styleDialogue(html, enabled = true) {
    if (!enabled || !html) return html;

    const dialogueRegex = buildDialogueRegex();

    return html.replace(dialogueRegex, (match) => {
        return `<span class="cn-dialogue">${match}</span>`;
    });
}

/**
 * Replace {{user}} macro with the actual user name.
 * @param {string} text
 * @param {string} userName
 * @returns {string}
 */
export function substituteUserMacro(text, userName) {
    if (!text || !userName) return text;
    return text.replace(/\{\{user\}\}/gi, userName);
}

/**
 * Replace {{char}} macro with the actual character name.
 * @param {string} text
 * @param {string} charName
 * @returns {string}
 */
export function substituteCharMacro(text, charName) {
    if (!text || !charName) return text;
    return text.replace(/\{\{char\}\}/gi, charName);
}

/**
 * Process choices/selection tags into styled HTML cards.
 * @param {string} html
 * @returns {string}
 */
export function processChoices(html) {
    if (!html) return html;

    // Handle <choices>...</choices> tags
    const choicesPattern = /<choices>([\s\S]*?)<\/choices>/gi;
    return html.replace(choicesPattern, (match, content) => {
        const choices = parseChoiceItems(content.trim());
        if (choices.length === 0) return match;

        let choiceHtml = '<div class="cn-choices-container">';
        choiceHtml += '<div class="cn-choices-header">선택지</div>';

        for (const choice of choices) {
            choiceHtml += `<div class="cn-choice-card">
                <span class="cn-choice-number">${choice.number}.</span>
                <span class="cn-choice-text">${choice.text}</span>
            </div>`;
        }

        choiceHtml += '</div>';
        return choiceHtml;
    });
}

/**
 * Parse choice items from text content.
 * @param {string} content
 * @returns {Array<{number: string, text: string}>}
 */
function parseChoiceItems(content) {
    const items = [];
    // Match numbered items: "1. text", "2. text", etc.
    const itemPattern = /(\d+)\.\s*(.+?)(?=\d+\.|$)/gs;
    let match;

    while ((match = itemPattern.exec(content)) !== null) {
        items.push({
            number: match[1],
            text: match[2].trim().replace(/^[""]|[""]$/g, ''),
        });
    }

    // If no numbered items found, split by newlines
    if (items.length === 0) {
        const lines = content.split('\n').filter(l => l.trim());
        lines.forEach((line, i) => {
            items.push({
                number: String(i + 1),
                text: line.trim(),
            });
        });
    }

    return items;
}

/**
 * Full rendering pipeline for a single message.
 * @param {Object} message - Parsed message object
 * @param {Object} options
 * @param {string} options.userName
 * @param {string} options.characterName
 * @param {boolean} options.dialogueEnabled
 * @param {Function} [options.regexProcessor] - Custom regex processing function
 * @returns {string} Rendered HTML
 */
export function renderMessage(message, options) {
    let text = message.mes || '';

    // 1. Substitute macros
    text = substituteUserMacro(text, options.userName);
    text = substituteCharMacro(text, options.characterName);

    // 2. Apply regex transformations (if provided)
    if (options.regexProcessor) {
        text = options.regexProcessor(text, {
            isUser: message.is_user,
            characterName: options.characterName,
        });
    }

    // 3. Process choices
    text = processChoices(text);

    // 4. Render markdown
    text = renderMarkdown(text);

    // 5. Style dialogue
    text = styleDialogue(text, options.dialogueEnabled);

    return text;
}

/**
 * Render a full chapter to HTML.
 * @param {Object} chapter - Chapter object from chapterizer
 * @param {Object} options - Rendering options
 * @returns {string}
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

        if (senderName && !msg.is_system) {
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

/**
 * Escape HTML special characters.
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}

/**
 * Escape special regex characters.
 * @param {string} str
 * @returns {string}
 */
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
