import axios from 'axios';
import * as cheerio from 'cheerio';

/**
 * Universal Video Downloader - tích hợp từ universalDownloader
 * Hỗ trợ: YouTube, TikTok, Facebook, Instagram, Twitter, Spotify, v.v.
 */

// ===================== PLATFORM DETECTORS =====================

const PLATFORM_PATTERNS = [
    { name: 'youtube', patterns: [/youtube\.com/, /youtu\.be/] },
    { name: 'tiktok', patterns: [/tiktok\.com/, /vm\.tiktok\.com/] },
    { name: 'facebook', patterns: [/facebook\.com/, /fb\.watch/, /fb\.com/] },
    { name: 'instagram', patterns: [/instagram\.com/, /instagr\.am/] },
    { name: 'twitter', patterns: [/twitter\.com/, /x\.com/] },
    { name: 'spotify', patterns: [/spotify\.com/] },
    { name: 'tiktok', patterns: [/douyin\.com/] },
    { name: 'reddit', patterns: [/reddit\.com/] },
    { name: 'pinterest', patterns: [/pinterest\.com/, /pin\.it/] },
    { name: 'soundcloud', patterns: [/soundcloud\.com/] },
    { name: 'dailymotion', patterns: [/dailymotion\.com/, /dai\.ly/] },
    { name: 'tumblr', patterns: [/tumblr\.com/] },
    { name: 'threads', patterns: [/threads\.net/] },
    { name: 'linkedin', patterns: [/linkedin\.com/] },
    { name: 'snapchat', patterns: [/snapchat\.com/, /t\.snapchat\.com/] },
    { name: 'capcut', patterns: [/capcut\.com/] },
    { name: 'terabox', patterns: [/terabox\.com/, /teraboxapp\.com/, /1024tera\.com/] },
    { name: 'bluesky', patterns: [/bsky\.app/, /bsky\.social/] },
    { name: 'kuaishou', patterns: [/kuaishou\.com/, /kwai\.com/] },
];

function detectPlatform(url) {
    const lower = url.toLowerCase();
    for (const { name, patterns } of PLATFORM_PATTERNS) {
        for (const pattern of patterns) {
            if (pattern.test(lower)) return name;
        }
    }
    return null;
}

// ===================== SERVICE FUNCTIONS =====================

async function fetchYouTubeData(url) {
    // Gọi API YTSave.to
    const { data } = await axios.post('https://ytsave.to/proxy.php',
        `url=${encodeURIComponent(url)}`,
        {
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'origin': 'https://ytsave.to',
                'referer': 'https://ytsave.to/vi2/',
            },
            timeout: 30000,
        }
    );

    if (!data.api || data.api.status?.toLowerCase() !== 'ok') {
        throw new Error(data.api?.message || 'YTSave API lỗi');
    }

    const api = data.api;
    const title = api.title || null;
    const thumbnail = null; // YTSave trả thumbnail trong mediaItems
    const duration = null;

    const videos = [];
    const audios = [];

    if (api.mediaItems && api.mediaItems.length > 0) {
        let firstThumb = null;

        for (const item of api.mediaItems) {
            if (!firstThumb && item.mediaThumbnail) {
                firstThumb = item.mediaThumbnail;
            }

            if (item.type === 'Video') {
                const label = [item.mediaExtension, item.mediaRes, item.mediaQuality].filter(Boolean).join(' ');
                videos.push({
                    format: item.mediaExtension || 'mp4',
                    quality: label || 'Video',
                    url: item.mediaUrl,
                    size: item.mediaFileSize || null,
                    task: item.mediaTask || 'download', // 'download' | 'render' | 'merge'
                    thumbnail: item.mediaThumbnail || null,
                    previewUrl: item.mediaPreviewUrl || null,
                });
            } else if (item.type === 'Audio') {
                const label = [item.mediaExtension, item.mediaRes, item.mediaQuality].filter(Boolean).join(' ');
                audios.push({
                    format: item.mediaExtension || 'mp3',
                    quality: label || 'Audio',
                    url: item.mediaUrl,
                    size: item.mediaFileSize || null,
                    task: item.mediaTask || 'download',
                });
            }
        }

        return {
            platform: 'youtube',
            title,
            thumbnail: firstThumb,
            duration,
            videos,
            audios,
        };
    }

    throw new Error('Không tìm thấy video/audio nào');
}

async function fetchTikTokData(url) {
    const { data: res } = await axios.post('https://tikwm.com/api/',
        { url, hd: 1 },
        {
            headers: {
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'content-type': 'application/json',
            },
            timeout: 15000,
        }
    );

    if (res.code !== 0 || !res.data) {
        throw new Error(res.msg || 'TikTok API lỗi');
    }

    const d = res.data;
    const title = d.title || null;
    const thumbnail = d.cover || d.origin_cover || null;
    const duration = d.duration || null;

    const videos = [];
    const audios = [];
    const downloads = [];

    // Video SD (no watermark)
    if (d.play) {
        const sizeMB = d.size ? (d.size / 1024 / 1024).toFixed(2) + 'MB' : '';
        videos.push({
            format: 'mp4',
            quality: '📹 Video (No Watermark)',
            url: d.play,
            size: sizeMB,
        });
    }

    // Video HD (no watermark)
    if (d.hdplay) {
        const sizeMB = d.hd_size ? (d.hd_size / 1024 / 1024).toFixed(2) + 'MB' : '';
        videos.push({
            format: 'mp4',
            quality: '📹 Video HD (No Watermark)',
            url: d.hdplay,
            size: sizeMB,
        });
    }

    // Video with watermark
    if (d.wmplay) {
        const sizeMB = d.wm_size ? (d.wm_size / 1024 / 1024).toFixed(2) + 'MB' : '';
        videos.push({
            format: 'mp4',
            quality: '📹 Video (Watermark)',
            url: d.wmplay,
            size: sizeMB,
        });
    }

    // Music/Audio
    if (d.music) {
        audios.push({
            format: 'mp3',
            quality: '🎵 Nhạc nền',
            url: d.music,
            size: '',
        });
    }

    // Image slideshow (TikTok ảnh)
    if (d.images && d.images.length > 0) {
        d.images.forEach((img, i) => {
            downloads.push({
                text: '🖼️ Ảnh ' + (i + 1),
                url: img,
                quality: 'Image',
            });
        });
    }

    return { platform: 'tiktok', title, thumbnail, duration, videos, audios, downloads };
}

async function fetchTwitterData(url) {
    const twitterApiUrl = `https://twitsave.com/info?url=${encodeURIComponent(url)}`;
    const { data } = await axios.get(twitterApiUrl, {
        headers: {
            'user-agent':
                'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
        },
        timeout: 15000,
    });
    const $ = cheerio.load(data);
    const downloads = [];
    $('.origin-size a').each((_, el) => {
        const dlUrl = $(el).attr('href');
        const quality = $(el).text().trim();
        if (dlUrl) downloads.push({ quality, url: dlUrl });
    });
    const thumbnail = $('video').attr('poster') || null;
    const title = $('h2').first().text().trim() || 'Twitter Video';
    return { platform: 'twitter', title, thumbnail, downloads };
}

async function fetchMetaData(url) {
    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);
    const snapsave = require('metadownloader');
    const result = await snapsave(url);
    return { platform: url.includes('instagram') ? 'instagram' : 'facebook', ...result };
}

async function fetchSpotifyData(url) {
    const res = await axios.post(
        'https://songsnatch-2.emergent.host/api/download',
        { url },
        {
            headers: {
                accept: '*/*',
                'content-type': 'application/json',
                origin: 'https://spotihelper.com',
                referer: 'https://spotihelper.com/',
                'user-agent':
                    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
            },
            timeout: 15000,
        }
    );
    return { platform: 'spotify', ...res.data };
}

async function fetchRedditData(url) {
    const response = await axios.get(
        `https://www.viddit.app/download/${encodeURIComponent(url)}`,
        {
            headers: { 'user-agent': 'Mozilla/5.0' },
            timeout: 15000,
        }
    );
    const $ = cheerio.load(response.data);
    const downloads = [];
    $('a[href*="reddit"]').each((_, el) => {
        const dlUrl = $(el).attr('href');
        const text = $(el).text().trim();
        if (dlUrl && text) downloads.push({ text, url: dlUrl });
    });
    return { platform: 'reddit', downloads };
}

async function fetchPinterestData(url) {
    const apiUrl = `https://www.savepin.app/download.php?url=${encodeURIComponent(url)}&lang=en&type=redirect`;
    const { data } = await axios.get(apiUrl, {
        headers: {
            'user-agent':
                'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
            referer: 'https://www.savepin.app/',
        },
        timeout: 15000,
    });
    return { platform: 'pinterest', ...data };
}

async function fetchSoundCloudData(url) {
    const body = new URLSearchParams({ url });
    const { data } = await axios.post(
        'https://api.downloadsound.cloud/track',
        body.toString(),
        {
            headers: {
                accept: '*/*',
                'content-type': 'application/x-www-form-urlencoded',
                origin: 'https://downloadsound.cloud',
                referer: 'https://downloadsound.cloud/',
                'user-agent': 'Mozilla/5.0',
            },
            timeout: 15000,
        }
    );
    return { platform: 'soundcloud', ...data };
}

async function fetchDailymotionData(url) {
    const apiUrl = `https://www.savethevideo.com/api/dailymotion?url=${encodeURIComponent(url)}`;
    const { data } = await axios.get(apiUrl, {
        headers: { 'user-agent': 'Mozilla/5.0' },
        timeout: 15000,
    });
    return { platform: 'dailymotion', ...data };
}

async function fetchGenericData(url) {
    throw new Error('Nền tảng không được hỗ trợ hoặc URL không hợp lệ');
}

// ===================== MAIN HANDLER =====================

const PLATFORM_HANDLERS = {
    youtube: fetchYouTubeData,
    tiktok: fetchTikTokData,
    douyin: fetchTikTokData,
    twitter: fetchTwitterData,
    facebook: fetchMetaData,
    instagram: fetchMetaData,
    spotify: fetchSpotifyData,
    reddit: fetchRedditData,
    pinterest: fetchPinterestData,
    soundcloud: fetchSoundCloudData,
    dailymotion: fetchDailymotionData,
};

export async function fetchVideoData(url) {
    if (!url || typeof url !== 'string') {
        throw new Error('URL không hợp lệ');
    }

    const platform = detectPlatform(url.trim());
    const handler = platform ? PLATFORM_HANDLERS[platform] : null;

    if (handler) {
        const result = await handler(url.trim());
        return { success: true, platform: platform, data: result };
    }

    // Try generic handler
    const result = await fetchGenericData(url.trim());
    return { success: true, platform: 'unknown', data: result };
}

// YouTube download via YTSave - proxy endpoint để xử lý render/merge
export async function handleYTSaveDownload(mediaUrl, res) {
    try {
        // Bước 1: Gọi proxy.php với mediaUrl để bắt đầu render/download
        const { data } = await axios.post('https://ytsave.to/proxy.php',
            `url=${encodeURIComponent(mediaUrl)}`,
            {
                headers: {
                    'content-type': 'application/x-www-form-urlencoded',
                    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'origin': 'https://ytsave.to',
                    'referer': 'https://ytsave.to/vi2/',
                },
                timeout: 60000,
            }
        );

        if (!data.api) {
            return res.status(500).json({ error: 'YTSave không phản hồi' });
        }

        // Nếu đã completed → trả fileUrl
        if (data.api.status === 'completed' && data.api.fileUrl) {
            return res.json({ status: 'completed', fileUrl: data.api.fileUrl, fileName: data.api.fileName || 'video.mp4' });
        }

        // Nếu đang processing → trả progress
        if (data.api.progress) {
            return res.json({ status: 'processing', progress: data.api.progress });
        }

        return res.json({ status: 'unknown', data: data.api });
    } catch (err) {
        console.error('[YTSave Download] Error:', err.message);
        if (!res.headersSent) {
            res.status(500).json({ error: err.message });
        }
    }
}

export function getSupportedPlatforms() {
    return [
        { id: 'youtube', name: 'YouTube', icon: 'fab fa-youtube' },
        { id: 'tiktok', name: 'TikTok', icon: 'fab fa-tiktok' },
        { id: 'facebook', name: 'Facebook', icon: 'fab fa-facebook' },
        { id: 'instagram', name: 'Instagram', icon: 'fab fa-instagram' },
        { id: 'twitter', name: 'Twitter/X', icon: 'fab fa-twitter' },
        { id: 'spotify', name: 'Spotify', icon: 'fab fa-spotify' },
        { id: 'reddit', name: 'Reddit', icon: 'fab fa-reddit' },
        { id: 'pinterest', name: 'Pinterest', icon: 'fab fa-pinterest' },
        { id: 'soundcloud', name: 'SoundCloud', icon: 'fab fa-soundcloud' },
        { id: 'dailymotion', name: 'Dailymotion', icon: 'fas fa-play-circle' },
        { id: 'threads', name: 'Threads', icon: 'fas fa-at' },
        { id: 'linkedin', name: 'LinkedIn', icon: 'fab fa-linkedin' },
        { id: 'snapchat', name: 'Snapchat', icon: 'fab fa-snapchat' },
        { id: 'terabox', name: 'TeraBox', icon: 'fas fa-cloud' },
        { id: 'bluesky', name: 'BlueSky', icon: 'fas fa-cloud' },
    ];
}
