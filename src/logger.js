'use strict';

const PREFIX = '[RelatedSources]';

/**
 * Simple logger utility for the RelatedSources extension.
 * Wraps console methods with a consistent prefix.
 */
const logger = {
    log: (...args) => console.log(PREFIX, ...args),
    warn: (...args) => console.warn(PREFIX, ...args),
    error: (...args) => console.error(PREFIX, ...args),
};

module.exports = { logger };
