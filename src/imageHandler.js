/**
 * Chat Novel — Image Handler
 * Handles {{img::}} pattern conversion, lightbox viewer, and base64 export.
 */

import { escapeHtml } from './utils.js';

/**
 * Escape a string for use in HTML attributes.
 * @param {string} str
 * @returns {string}
 */
function escapeAttr(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Resolve an image filename to a full path.
 * Uses ST's character image directory convention.
 * @param {string} filename - The image filename
 * @param {string} characterName - The character name (for folder path)
 * @returns {string} Resolved URL path
 */
function resolveImagePath(filename, characterName) {
    if (!filename) return '';

    // Already a full URL or data URI
    if (filename.startsWith('http://') || filename.startsWith('https://') || filename.startsWith('data:')) {
        return filename;
    }

    // Already an absolute path
    if (filename.startsWith('/')) {
        return filename;
    }

    // Resolve to ST character image directory
    const cleanCharName = characterName || 'Unknown';
    return `/characters/${encodeURIComponent(cleanCharName)}/${encodeURIComponent(filename)}`;
}

/**
 * Create HTML for an image element.
 * No inline onclick — uses event delegation via setupImageClickDelegation().
 * @param {string} src - Image source URL
 * @param {string} alt - Alt text
 * @returns {string} HTML string
 */
export function createImageHtml(src, alt) {
    const escapedSrc = escapeAttr(src);
    const escapedAlt = escapeAttr(alt);

    return `<div class="cn-image-container">
        <img class="cn-image"
             src="${escapedSrc}"
             alt="${escapedAlt}"
             title="${escapedAlt}"
             loading="lazy"
             data-cn-processed="true"
             onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'cn-image-fallback\\'><span class=\\'cn-image-fallback-icon\\'>🖼️</span><span>${escapedAlt}</span></div>'"
        />
    </div>`;
}

/**
 * Process {{img::filename}} patterns in text.
 * Fallback for when ST regex scripts don't handle this pattern.
 * @param {string} text - The message text
 * @param {string} characterName - Character name for image path resolution
 * @returns {string} Text with {{img::}} replaced by <img> HTML
 */
export function processImages(text, characterName) {
    if (!text) return text;

    return text.replace(/\{\{img::([^}]+)\}\}/gi, (match, filename) => {
        const trimmedFilename = filename.trim();
        const src = resolveImagePath(trimmedFilename, characterName);
        return createImageHtml(src, trimmedFilename);
    });
}

/**
 * Set up the lightbox overlay for image viewing.
 * Uses AbortController for clean listener removal on reader close.
 * @param {HTMLElement} container - The reader container element
 * @returns {AbortController} Controller for cleaning up listeners
 */
export function setupLightbox(container) {
    const abortController = new AbortController();
    const { signal } = abortController;

    const lightbox = document.createElement('div');
    lightbox.className = 'cn-lightbox';
    lightbox.innerHTML = `
        <div class="cn-lightbox-backdrop"></div>
        <div class="cn-lightbox-content">
            <img class="cn-lightbox-img" src="" alt="" />
            <div class="cn-lightbox-caption"></div>
            <button class="cn-lightbox-close" title="Close">\u2715</button>
        </div>
    `;
    container.appendChild(lightbox);

    const closeLightbox = () => lightbox.classList.remove('cn-lightbox-active');
    lightbox.querySelector('.cn-lightbox-backdrop').addEventListener('click', closeLightbox, { signal });
    lightbox.querySelector('.cn-lightbox-close').addEventListener('click', closeLightbox, { signal });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && lightbox.classList.contains('cn-lightbox-active')) {
            closeLightbox();
        }
    }, { signal });

    window.ChatNovelLightbox = (src, alt) => {
        lightbox.querySelector('.cn-lightbox-img').src = src;
        lightbox.querySelector('.cn-lightbox-img').alt = alt || '';
        lightbox.querySelector('.cn-lightbox-caption').textContent = alt || '';
        lightbox.classList.add('cn-lightbox-active');
    };

    return abortController;
}

/**
 * Set up event delegation for image clicks in the reader content area.
 * Clicking any <img> inside the content opens the lightbox.
 * @param {HTMLElement} contentEl - The novel content area
 */
export function setupImageClickDelegation(contentEl) {
    contentEl.addEventListener('click', (e) => {
        const img = e.target.closest('img');
        if (img && window.ChatNovelLightbox) {
            e.preventDefault();
            e.stopPropagation();
            window.ChatNovelLightbox(img.src, img.alt || img.title || '');
        }
    });
}

/**
 * Convert an image URL to a base64 data URI.
 * @param {string} url - Image URL
 * @returns {Promise<string>} Base64 data URI
 */
export async function imageToBase64(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        console.warn(`[ChatNovel] Failed to convert image to base64: ${url}`, e);
        return url; // Return original URL as fallback
    }
}
