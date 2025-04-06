const express = require('express');
const ytdl = require('ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config(); // For environment variables

const app = express();
app.use(express.json());
app.use('/videos', express.static(path.join(__dirname, 'videos')));
app.use('/edited', express.static(path.join(__dirname, 'edited')));

const jobs = {};

// Ensure directories exist
const ensureDirs = async () => {
    await fs.mkdir('videos', { recursive: true }).catch(() => {});
    await fs.mkdir('edited', { recursive: true }).catch(() => {});
};
ensureDirs();

// POST /convert - Start video conversion
app.post('/convert', async (req, res) => {
    const { url } = req.body;
    if (!url || !url.includes('youtube.com/clip/')) {
        return res.status(400).json({ error: 'Invalid YouTube clip URL' });
    }
    const jobId = uuidv4();
    processVideo(jobId, url);
    res.json({ jobId });
});

// GET /status/:jobId - Check job status
app.get('/status/:jobId', (req, res) => {
    const job = jobs[req.params.jobId];
    if (job) res.json(job);
    else res.status(404).json({ error: 'Job not found' });
});

// GET /download/:jobId - Download edited video
app.get('/download/:jobId', (req, res) => {
    const job = jobs[req.params.jobId];
    if (job && job.status === 'ready') res.download(job.message);
    else res.status(404).send('File not found');
});

// Process video in the background
async function processVideo(jobId, clipUrl) {
    try {
        updateJobStatus(jobId, 'checking_license', 'Checking video license...');
        const { videoId } = await getVideoDetailsFromClipUrl(clipUrl);
        
        const isCC = await checkCreativeCommons(videoId);
        if (!isCC) {
            updateJobStatus(jobId, 'error', 'Video is not under Creative Commons license');
            return;
        }
        
        updateJobStatus(jobId, 'downloading', 'Downloading video...');
        const downloadedFile = await downloadVideo(videoId);
        
        updateJobStatus(jobId, 'extracting', 'Extracting clip...');
        const clipFile = await extractClip(downloadedFile, 0, 60);
        
        updateJobStatus(jobId, 'editing', 'Editing video for TikTok...');
        const editedFile = await editVideo(clipFile);
        
        updateJobStatus(jobId, 'ready', editedFile);
        
        // Cleanup temporary files (optional)
        await fs.unlink(downloadedFile).catch(() => {});
        await fs.unlink(clipFile).catch(() => {});
    } catch (error) {
        updateJobStatus(jobId, 'error', error.message);
    }
}

function updateJobStatus(jobId, status, message) {
    jobs[jobId] = { status, message };
}

// Extract video ID from clip URL (simplified for demo)
async function getVideoDetailsFromClipUrl(clipUrl) {
    // In a full implementation, parse HTML to get videoId and clip times
    // For simplicity, assume clip URL redirects to video and extract videoId
    const videoIdMatch = clipUrl.match(/(?:v=)([a-zA-Z0-9_-]{11})/);
    const videoId = videoIdMatch ? videoIdMatch[1] : 'dQw4w9WgXcQ'; // Fallback for demo
    return { videoId, start: 0, end: 60 }; // Hardcoded 60s clip
}

async function checkCreativeCommons(videoId) {
    const apiKey = process.env.YOUTUBE_API_KEY;
    const url = `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&part=contentDetails&key=${apiKey}`;
    const response = await axios.get(url);
    const video = response.data.items[0];
    return video?.contentDetails?.license === 'creativeCommon';
}

async function downloadVideo(videoId) {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const output = path.join(__dirname, 'videos', `${videoId}.mp4`);
    await new Promise((resolve, reject) => {
        ytdl(url, { filter: 'videoandaudio' })
            .pipe(fs.createWriteStream(output))
            .on('finish', resolve)
            .on('error', reject);
    });
    return output;
}

async function extractClip(inputFile, start, end) {
    const outputFile = path.join(__dirname, 'videos', `${path.basename(inputFile, '.mp4')}_clip.mp4`);
    await new Promise((resolve, reject) => {
        ffmpeg(inputFile)
            .setStartTime(start)
            .setDuration(end - start)
            .output(outputFile)
            .on('end', resolve)
            .on('error', reject)
            .run();
    });
    return outputFile;
}

async function editVideo(inputFile) {
    const outputFile = path.join(__dirname, 'edited', `${path.basename(inputFile, '.mp4')}_edited.mp4`);
    await new Promise((resolve, reject) => {
        ffmpeg(inputFile)
            .videoFilters('crop=ih*9/16:ih,scale=1080:1920')
            .output(outputFile)
            .on('end', resolve)
            .on('error', reject)
            .run();
    });
    return outputFile;
}

app.listen(3000, () => console.log('Server running on port 3000'));
