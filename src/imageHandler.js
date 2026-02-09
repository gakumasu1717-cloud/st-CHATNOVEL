/**
 * Chat Novel — Image Handler
 * Provides lightbox viewer and base64 conversion for images.
 * 
 * In the DOM-based architecture, images are already rendered as <img> tags
 * by ST. This module only handles lightbox viewing and export utilities.
 */

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
