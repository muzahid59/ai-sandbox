
 function isValidYoutubeUrl(url) {
    // Regular expression to match a valid YouTube URL
    const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/;
    return youtubeRegex.test(url);
}


module.exports = { isValidYoutubeUrl };