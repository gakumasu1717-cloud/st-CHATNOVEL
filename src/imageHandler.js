/**
 * Chat Novel — Image Handler
 * Detects, resolves, and renders images from chat messages.
 */

/**
 * Detect and process image tags in message text.
 * Handles {{img::filename}} pattern and converts to proper HTML.
 * @param {string} text - Message text with potential image tags
 * @param {string} characterName - Character name for path resolution
 * @returns {string} Text with image tags converted to HTML
 */
export function processImages(text, characterName) {
    if (!text) return text;

    // Handle {{img::filename}} pattern
    const imgTagPattern = /\{\{img::(.*?)\}\}/gi;
    text = text.replace(imgTagPattern, (match, filename) => {
        const src = resolveImagePath(filename.trim(), characterName);
        return createImageHtml(src, filename.trim());
    });

    // Handle existing <img> tags — ensure they have proper attributes
    text = text.replace(/<img\s+([^>]*?)>/gi, (match, attrs) => {
        if (attrs.includes('data-cn-processed')) return match;
        return match.replace('<img ', '<img data-cn-processed="true" loading="lazy" ');
    });

    return text;
}

/**
 * Resolve image path from filename.
 * Tries multiple possible locations.
 * @param {string} filename
 * @param {string} characterName
 * @returns {string}
 */
export function resolveImagePath(filename, characterName) {
    // If already a full URL or path, return as-is
    if (filename.startsWith('http://') || filename.startsWith('https://') || filename.startsWith('/')) {
        return filename;
    }

    // Clean character name for folder path
    const cleanCharName = characterName.replace(/[<>:"/\\|?*]/g, '_');

    // Try character folder path (SillyTavern convention)
    return `/characters/${encodeURIComponent(cleanCharName)}/${encodeURIComponent(filename)}`;
}

/**
 * Create HTML for an image with lightbox support and fallback.
 * @param {string} src - Image source URL
 * @param {string} alt - Alt text (filename)
 * @returns {string}
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
 * Set up the lightbox overlay for image viewing.
 * @param {HTMLElement} container - The reader container element
 */
export function setupLightbox(container) {
    // Create lightbox overlay
    const lightbox = document.createElement('div');
    lightbox.className = 'cn-lightbox';
    lightbox.innerHTML = `
        <div class="cn-lightbox-backdrop"></div>
        <div class="cn-lightbox-content">
            <img class="cn-lightbox-img" src="" alt="" />
            <div class="cn-lightbox-caption"></div>
            <button class="cn-lightbox-close" title="Close">✕</button>
        </div>
    `;
    container.appendChild(lightbox);

    // Close handlers
    const closeLightbox = () => lightbox.classList.remove('cn-lightbox-active');
    lightbox.querySelector('.cn-lightbox-backdrop').addEventListener('click', closeLightbox);
    lightbox.querySelector('.cn-lightbox-close').addEventListener('click', closeLightbox);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && lightbox.classList.contains('cn-lightbox-active')) {
            closeLightbox();
        }
    });

    // Global lightbox function
    window.ChatNovelLightbox = (src, alt) => {
        lightbox.querySelector('.cn-lightbox-img').src = src;
        lightbox.querySelector('.cn-lightbox-img').alt = alt || '';
        lightbox.querySelector('.cn-lightbox-caption').textContent = alt || '';
        lightbox.classList.add('cn-lightbox-active');
    };
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

/**
 * Escape HTML attribute value
 * @param {string} str
 * @returns {string}
 */
function escapeAttr(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
