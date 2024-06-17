
/**
 * Checks if a given URL is a valid YouTube URL.
 *
 * @param {string} url - The URL to be checked.
 * @returns {boolean} - Returns true if the URL is a valid YouTube URL, otherwise returns false.
 */
 function isValidYoutubeUrl(url) {
    // Regular expression to match a valid YouTube URL
    const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/;
    return youtubeRegex.test(url);
}

module.exports = { isValidYoutubeUrl };