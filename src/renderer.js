/**
 * Chat Novel — Renderer
 * Renders parsed messages and chapters to HTML for the novel reader.
 * 
 * In the DOM-based architecture, messages already have `renderedHtml` from ST.
 * This module acts as a passthrough for DOM-sourced content, with a basic
 * fallback renderer for messages not present in DOM (lazy rendering).
 */

import { escapeHtml } from './utils.js';

/**
 * Render a single message to HTML.
 * Uses pre-rendered DOM HTML if available, otherwise falls back to basic rendering.
 * @param {Object} message - Parsed message object
 * @param {Object} options - Rendering options (unused in DOM mode, kept for API compat)
 * @returns {string} HTML string
 */
export function renderMessage(message, options) {
    // DOM-sourced: use the already-rendered HTML from ST
    if (message.renderedHtml) {
        return message.renderedHtml;
    }

    // Fallback: basic rendering for messages not in DOM
    let text = message.mes || '';
    text = escapeHtml(text);
    text = text.replace(/\n/g, '<br>');
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

