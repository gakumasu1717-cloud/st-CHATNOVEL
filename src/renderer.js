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

// ===== Previous Info Block Unwrapping =====

/**
 * Unwrap <details> blocks whose summary contains "이전 정보".
 * Instead of removing the entire block (which deletes current DOCTYPEs too),
 * this removes ONLY the <details>, <summary>, and </details> wrapper tags
 * while keeping the inner content. The code fences inside will survive
 * and renderMarkdown will turn OLD DOCTYPEs (inside ```) into harmless
 * <pre><code> text, while CURRENT DOCTYPEs (outside ```) become iframes.
 * @param {string} text
 * @returns {string}
 */
function unwrapPreviousInfoBlocks(text) {
    if (!text) return text;

    // Remove <details...><summary...>이전 정보</summary> opening tags
    text = text.replace(/<details[^>]*>\s*<summary[^>]*>[^<]*이전\s*정보[^<]*<\/summary>/gi, '');

    // Remove orphaned </details> that were part of the block.
    // After removing the opening tag, the matching </details> remains.
    // We can't just remove ALL </details> — only the ones from 이전 정보 blocks.
    // But since the opening tags are now gone, any </details> without a matching
    // <details> is orphaned and should be removed. Count and clean up.
    let openCount = (text.match(/<details\b/gi) || []).length;
    let closeCount = (text.match(/<\/details\s*>/gi) || []).length;

    // Remove excess </details> (orphaned from unwrapped blocks)
    while (closeCount > openCount) {
        text = text.replace(/<\/details\s*>/, '');
        closeCount--;
    }

    return text;
}

// ===== HTML Document → iframe Conversion =====

/**
 * Find complete HTML documents (<!DOCTYPE html>...) and replace them with
 * text token placeholders. The actual iframe HTML is stored in an array and
 * restored AFTER markdown processing. Text tokens (%%%CN_IFRAME_N%%%) are used
 * instead of HTML tags because the markdown renderer aggressively wraps/escapes
 * HTML tags into code blocks.
 *
 * @param {string} text - Text with potential HTML documents
 * @returns {{ text: string, iframePlaceholders: string[] }}
 */
function convertHtmlDocsToIframes(text) {
    const iframePlaceholders = [];
    if (!text) return { text, iframePlaceholders };

    // 정규식 스크립트가 HTML을 [...]로 감싸는 경우가 있으므로 앞뒤 대괄호도 함께 소비
    const htmlDocPattern = /\[?\s*(?:<!DOCTYPE\s+html[^>]*>[\s\S]*?<\/html>|<html[^>]*>[\s\S]*?<\/html>)\s*\]?/gi;

    // iframe 내부에 주입할 CSS + 높이 통신 스크립트
    const iframeOverrideCSS = '<style>html,body{height:auto!important;min-height:0!important;margin:0!important;padding:0!important;overflow:hidden!important;background:transparent;}#cn-wrap{position:absolute;top:0;left:0;width:100%;}::-webkit-scrollbar{display:none!important;}</style>';
    // body 내용을 #cn-wrap으로 감싸는 스크립트 + 높이 측정
    const iframeResizeScript = `<script>
(function(){
  document.addEventListener('DOMContentLoaded',function(){
    if(document.getElementById('cn-wrap'))return;
    var w=document.createElement('div');
    w.id='cn-wrap';
    while(document.body.firstChild)w.appendChild(document.body.firstChild);
    document.body.appendChild(w);
    init();
  });
  function init(){
    var w=document.getElementById('cn-wrap');
    if(!w)return;
    var busy=false;
    function sendH(){
      if(busy)return;
      busy=true;
      requestAnimationFrame(function(){
        var h=w.offsetHeight;
        if(h>0){
          window.parent.postMessage({type:'cn-iframe-resize',height:h},'*');
        }
        busy=false;
      });
    }
    sendH();
    document.querySelectorAll('details').forEach(function(d){
      d.addEventListener('toggle',function(){
        sendH();
        setTimeout(sendH,50);
        setTimeout(sendH,150);
        setTimeout(sendH,400);
      });
    });
    new MutationObserver(function(){sendH();}).observe(w,{childList:true,subtree:true,attributes:true});
    var t=[100,300,600,1500,3000,8000];t.forEach(function(d){setTimeout(sendH,d);});
  }
})();
<\/script>`;

    const processed = text.replace(htmlDocPattern, (match) => {
        // 앞뒤 [ ] 래핑 제거 (정규식으로 이미 소비했지만 match에 포함됨)
        let modified = match.replace(/^\s*\[/, '').replace(/\]\s*$/, '');

        // </head> 바로 앞에 override CSS를 주입
        if (modified.includes('</head>')) {
            modified = modified.replace('</head>', iframeOverrideCSS + '</head>');
        } else if (modified.includes('<body')) {
            modified = modified.replace('<body', iframeOverrideCSS + '<body');
        } else {
            modified = iframeOverrideCSS + modified;
        }

        // </body> 앞에 높이 통신 스크립트 주입
        if (modified.includes('</body>')) {
            modified = modified.replace('</body>', iframeResizeScript + '</body>');
        } else {
            modified += iframeResizeScript;
        }

        // Base64 인코딩 — srcdoc 따옴표 충돌 완전 회피
        const b64 = btoa(unescape(encodeURIComponent(modified)));

        const iframe = `<iframe class="cn-regex-iframe" data-cn-html="${b64}" sandbox="allow-scripts" frameborder="0" scrolling="no" style="width:100%;border:none;overflow:hidden;"></iframe>`;
        const index = iframePlaceholders.length;
        iframePlaceholders.push(iframe);
        return `\n%%%CN_IFRAME_${index}%%%\n`;
    });

    return { text: processed, iframePlaceholders };
}

/**
 * Restore text token placeholders with actual iframe HTML after markdown processing.
 * Tokens may be wrapped in <p> tags by the markdown renderer — the regex handles that.
 * @param {string} html - Markdown-processed HTML
 * @param {string[]} iframePlaceholders - Array of iframe HTML strings
 * @returns {string}
 */
function restoreIframePlaceholders(html, iframePlaceholders) {
    if (!iframePlaceholders || iframePlaceholders.length === 0) return html;
    // Remove surrounding <p>, <br />, <pre>, <code> tags that wrap the placeholder tokens
    // Markdown renderers may wrap inline tokens in code blocks or paragraphs
    return html.replace(
        /(?:<br\s*\/?>)?\s*(?:<pre[^>]*>)?\s*(?:<code[^>]*>)?\s*(?:<p[^>]*>)?\s*%%%CN_IFRAME_(\d+)%%%\s*(?:<\/p>)?\s*(?:<\/code>)?\s*(?:<\/pre>)?\s*(?:<br\s*\/?>)?/g,
        (match, index) => iframePlaceholders[parseInt(index, 10)] || match
    );
}

// ===== Cursor Marker Removal =====

/**
 * Remove cursor markers from text.
 * ST regex scripts / extensions sometimes insert cursor position markers
 * (vertical bars, zero-width spaces, custom span tags) that are hidden
 * in ST chat via CSS but visible in plain text.
 * @param {string} text
 * @returns {string}
 */
function removeCursorMarkers(text) {
    if (!text) return text;

    // 1. JS-Slash-Runner 커서 마커 패턴들
    //    - 단독 줄의 | (파이프) 문자 — 블록 시작/끝 표시
    text = text.replace(/^\s*\|\s*$/gm, '');

    // 2. <cursor> 또는 {{cursor}} 매크로 잔여물
    text = text.replace(/<cursor\s*\/?>/gi, '');
    text = text.replace(/\{\{cursor\}\}/gi, '');

    // 3. 빈 줄 정리 — 연속 3개 이상의 빈 줄을 2개로 축소
    text = text.replace(/\n{3,}/g, '\n\n');

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

    // Code fences extracted first (OLD DOCTYPEs inside ``` become harmless <pre><code>)
    const codeBlocks = [];
    text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (match, lang, code) => {
        const idx = codeBlocks.length;
        codeBlocks.push(`<pre class="cn-code-block"><code>${escapeHtml(code.trim())}</code></pre>`);
        return `\x00CODEBLOCK${idx}\x00`;
    });

    // Protect inline code
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

    // Restore code blocks (use function callback to avoid $ special-char interpretation)
    codeBlocks.forEach((block, i) => {
        text = text.replace(`\x00CODEBLOCK${i}\x00`, () => block);
    });
    inlineCodes.forEach((code, i) => {
        text = text.replace(`\x00INLINECODE${i}\x00`, () => code);
    });

    // Restore protected HTML blocks (must be last — after all other restore steps)
    protectedBlocks.forEach((block, i) => {
        text = text.replace(`\x00HTMLBLOCK${i}\x00`, () => block);
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

    // 3. Unwrap "이전 정보" details blocks — remove wrapper tags, keep content.
    // Current DOCTYPEs (status panels) are inside these blocks.
    text = unwrapPreviousInfoBlocks(text);

    // 3.5. 커서 마커 제거 — 정규식 스크립트 출력물에 포함된 커서 표시자
    text = removeCursorMarkers(text);

    // 4. Convert complete HTML documents → placeholders BEFORE markdown.
    // Code fences protect OLD DOCTYPEs; only CURRENT ones (outside ```) are converted.
    // Actual <iframe> tags are stored in array and restored after markdown.
    const { text: textWithPlaceholders, iframePlaceholders } = convertHtmlDocsToIframes(text);
    text = textWithPlaceholders;

    // 5. Choices processing (fallback for patterns not caught by regex).
    // Safe now — DOCTYPEs are already replaced with placeholder divs.
    text = processChoices(text);

    // 6. Markdown → HTML (placeholder <div>s pass through untouched)
    text = renderMarkdown(text);

    // 7. Restore placeholders → actual <iframe srcdoc> tags (after markdown)
    text = restoreIframePlaceholders(text, iframePlaceholders);

    // 8. Dialogue styling
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

        // 버튼 바
        html += `<div class="cn-msg-actions">`;
        html += `<button class="cn-msg-goto-btn" title="실리태번 메시지로 이동">📨</button>`;
        html += `<button class="cn-msg-bookmark-btn" title="북마크">🔖</button>`;
        html += `</div>`;

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

