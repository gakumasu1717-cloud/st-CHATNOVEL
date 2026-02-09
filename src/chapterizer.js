/**
 * Chat Novel — Chapterizer
 * Splits messages into chapters based on message count and time gaps.
 */

/**
 * @typedef {Object} Chapter
 * @property {number} index - Chapter index (0-based)
 * @property {string} title - Chapter title
 * @property {Array} messages - Array of messages in this chapter
 * @property {Date} startDate - Start date of the chapter
 * @property {Date} endDate - End date of the chapter
 */

/**
 * @typedef {Object} ChapterizeOptions
 * @property {string} mode - 'count' | 'time' | 'both' | 'none'
 * @property {number} messagesPerChapter - Messages per chapter (default: 20)
 * @property {number} timeGapHours - Hours gap to trigger a new chapter (default: 6)
 */

const DEFAULT_OPTIONS = {
    mode: 'count',
    messagesPerChapter: 20,
    timeGapHours: 6,
};

/**
 * Split messages into chapters.
 * @param {Array} messages - Array of parsed messages
 * @param {ChapterizeOptions} [options]
 * @returns {Chapter[]}
 */
export function chapterize(messages, options = {}) {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    if (!messages || messages.length === 0) {
        return [];
    }

    if (opts.mode === 'none') {
        return [{
            index: 0,
            title: 'Chapter 1',
            messages: [...messages],
            startDate: messages[0]._parsedDate || new Date(0),
            endDate: messages[messages.length - 1]._parsedDate || new Date(0),
        }];
    }

    let chapters = [];

    switch (opts.mode) {
        case 'count':
            chapters = chapterizeByCount(messages, opts.messagesPerChapter);
            break;
        case 'time':
            chapters = chapterizeByTime(messages, opts.timeGapHours);
            break;
        case 'both':
            chapters = chapterizeByBoth(messages, opts.messagesPerChapter, opts.timeGapHours);
            break;
        default:
            chapters = chapterizeByCount(messages, opts.messagesPerChapter);
    }

    // Assign titles
    chapters.forEach((ch, i) => {
        ch.index = i;
        ch.title = `Chapter ${i + 1}`;
        if (ch.messages.length > 0) {
            ch.startDate = ch.messages[0]._parsedDate || new Date(0);
            ch.endDate = ch.messages[ch.messages.length - 1]._parsedDate || new Date(0);
        }
    });

    return chapters;
}

/**
 * Split by message count.
 * @param {Array} messages
 * @param {number} count
 * @returns {Chapter[]}
 */
function chapterizeByCount(messages, count) {
    const chapters = [];
    for (let i = 0; i < messages.length; i += count) {
        chapters.push({
            index: 0,
            title: '',
            messages: messages.slice(i, i + count),
            startDate: new Date(0),
            endDate: new Date(0),
        });
    }
    return chapters;
}

/**
 * Split by time gap.
 * @param {Array} messages
 * @param {number} gapHours
 * @returns {Chapter[]}
 */
function chapterizeByTime(messages, gapHours) {
    const gapMs = gapHours * 60 * 60 * 1000;
    const chapters = [];
    let currentChapter = {
        index: 0,
        title: '',
        messages: [],
        startDate: new Date(0),
        endDate: new Date(0),
    };

    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        const prevMsg = i > 0 ? messages[i - 1] : null;

        if (prevMsg) {
            const timeDiff = (msg._parsedDate?.getTime() || 0) - (prevMsg._parsedDate?.getTime() || 0);
            if (timeDiff > gapMs && currentChapter.messages.length > 0) {
                chapters.push(currentChapter);
                currentChapter = {
                    index: 0,
                    title: '',
                    messages: [],
                    startDate: new Date(0),
                    endDate: new Date(0),
                };
            }
        }

        currentChapter.messages.push(msg);
    }

    if (currentChapter.messages.length > 0) {
        chapters.push(currentChapter);
    }

    return chapters;
}

/**
 * Split by both count and time (whichever triggers first).
 * @param {Array} messages
 * @param {number} count
 * @param {number} gapHours
 * @returns {Chapter[]}
 */
function chapterizeByBoth(messages, count, gapHours) {
    const gapMs = gapHours * 60 * 60 * 1000;
    const chapters = [];
    let currentChapter = {
        index: 0,
        title: '',
        messages: [],
        startDate: new Date(0),
        endDate: new Date(0),
    };

    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        const prevMsg = i > 0 ? messages[i - 1] : null;

        // Check time gap
        let timeBreak = false;
        if (prevMsg) {
            const timeDiff = (msg._parsedDate?.getTime() || 0) - (prevMsg._parsedDate?.getTime() || 0);
            timeBreak = timeDiff > gapMs;
        }

        // Check count
        const countBreak = currentChapter.messages.length >= count;

        if ((timeBreak || countBreak) && currentChapter.messages.length > 0) {
            chapters.push(currentChapter);
            currentChapter = {
                index: 0,
                title: '',
                messages: [],
                startDate: new Date(0),
                endDate: new Date(0),
            };
        }

        currentChapter.messages.push(msg);
    }

    if (currentChapter.messages.length > 0) {
        chapters.push(currentChapter);
    }

    return chapters;
}
