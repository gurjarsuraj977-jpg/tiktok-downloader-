const express = require("express");
const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const { instagram } = require("@jerrycoder/instagram-api");
const ffmpegPath = require("ffmpeg-static");

const app = express();

const PORT = process.env.PORT || 10000;
const DOWNLOAD_DIR = path.join(__dirname, "instagram-downloads");

const MAX_FILE_SIZE = 200 * 1024 * 1024;
const DOWNLOAD_TIMEOUT = 120000;
const PROCESS_TIMEOUT = 180000;
const FILE_EXPIRY = 5 * 60 * 1000;
const JOB_EXPIRY = 10 * 60 * 1000;

app.use(express.json({ limit: "1mb" }));

/* =========================================================
   JOB STORAGE
========================================================= */

const jobs = new Map();

/* =========================================================
   CREATE DOWNLOAD DIRECTORY
========================================================= */

if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

/* =========================================================
   JOB HELPERS
========================================================= */

function createJob() {
    const id = crypto.randomBytes(16).toString("hex");

    const job = {
        id,
        status: "starting",
        progress: 0,
        message: "Starting...",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        files: [],
        error: null
    };

    jobs.set(id, job);

    return job;
}

function updateJob(job, status, progress, message) {
    job.status = status;
    job.progress = Math.max(0, Math.min(100, progress));
    job.message = message;
    job.updatedAt = Date.now();
}

function failJob(job, message) {
    job.status = "error";
    job.progress = 0;
    job.message = message;
    job.error = message;
    job.updatedAt = Date.now();
}

function completeJob(job, files) {
    job.status = "completed";
    job.progress = 100;
    job.message = "Your media is ready!";
    job.files = files;
    job.updatedAt = Date.now();
}

/* =========================================================
   URL VALIDATION
========================================================= */

function isInstagramUrl(value) {
    try {
        const parsed = new URL(value);

        const hostname = parsed.hostname.toLowerCase();

        return (
            hostname === "instagram.com" ||
            hostname === "www.instagram.com" ||
            hostname === "m.instagram.com"
        );
    } catch {
        return false;
    }
}

/* =========================================================
   FIND MEDIA URLS IN API RESPONSE
========================================================= */

function collectMediaUrls(value, results = new Set(), depth = 0) {

    if (depth > 12 || value === null || value === undefined) {
        return results;
    }

    if (typeof value === "string") {

        if (
            value.startsWith("http://") ||
            value.startsWith("https://")
        ) {

            const lower = value.toLowerCase();

            const looksLikeMedia =
                lower.includes(".mp4") ||
                lower.includes(".m4v") ||
                lower.includes(".mov") ||
                lower.includes(".webm") ||
                lower.includes(".jpg") ||
                lower.includes(".jpeg") ||
                lower.includes(".png") ||
                lower.includes(".webp") ||
                lower.includes(".heic") ||
                lower.includes("video") ||
                lower.includes("image");

            if (looksLikeMedia) {
                results.add(value);
            }
        }

        return results;
    }

    if (Array.isArray(value)) {

        for (const item of value) {
            collectMediaUrls(
                item,
                results,
                depth + 1
            );
        }

        return results;
    }

    if (typeof value === "object") {

        for (const key of Object.keys(value)) {

            collectMediaUrls(
                value[key],
                results,
                depth + 1
            );

        }
    }

    return results;
}

/* =========================================================
   DOWNLOAD MEDIA
========================================================= */

function downloadFile(url, outputPath, onProgress) {

    return new Promise((resolve, reject) => {

        let settled = false;

        function finishError(error) {

            if (settled) return;

            settled = true;

            try {
                fs.unlinkSync(outputPath);
            } catch {}

            reject(error);
        }

        function finishSuccess(size) {

            if (settled) return;

            settled = true;

            resolve({
                size
            });
        }

        function requestUrl(currentUrl, redirectCount = 0) {

            if (redirectCount > 5) {
                return finishError(
                    new Error(
                        "Too many redirects from Instagram media server."
                    )
                );
            }

            let parsedUrl;

            try {
                parsedUrl = new URL(currentUrl);
            } catch {
                return finishError(
                    new Error("Invalid media URL.")
                );
            }

            const protocol =
                parsedUrl.protocol === "https:"
                    ? https
                    : http;

            const request = protocol.get(
                currentUrl,
                {
                    headers: {
                        "User-Agent":
                            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36",
                        "Accept": "*/*"
                    },
                    timeout: DOWNLOAD_TIMEOUT
                },
                response => {

                    /* ==============================
                       REDIRECT
                    ============================== */

                    if (
                        response.statusCode >= 300 &&
                        response.statusCode < 400 &&
                        response.headers.location
                    ) {

                        response.resume();

                        const nextUrl =
                            new URL(
                                response.headers.location,
                                currentUrl
                            ).toString();

                        return requestUrl(
                            nextUrl,
                            redirectCount + 1
                        );
                    }

                    /* ==============================
                       HTTP ERROR
                    ============================== */

                    if (
                        response.statusCode < 200 ||
                        response.statusCode >= 300
                    ) {

                        response.resume();

                        return finishError(
                            new Error(
                                `Media server returned HTTP ${response.statusCode}`
                            )
                        );
                    }

                    const contentLength =
                        Number(
                            response.headers["content-length"]
                        ) || 0;

                    if (
                        contentLength &&
                        contentLength > MAX_FILE_SIZE
                    ) {

                        response.resume();

                        return finishError(
                            new Error(
                                "Instagram media is larger than the 200 MB limit."
                            )
                        );
                    }

                    const file =
                        fs.createWriteStream(
                            outputPath
                        );

                    let downloadedBytes = 0;

                    response.on("data", chunk => {

                        downloadedBytes += chunk.length;

                        if (
                            downloadedBytes >
                            MAX_FILE_SIZE
                        ) {

                            response.destroy();

                            file.destroy();

                            finishError(
                                new Error(
                                    "Downloaded file exceeded the 200 MB limit."
                                )
                            );

                            return;
                        }

                        if (contentLength > 0) {

                            const percent =
                                Math.round(
                                    (
                                        downloadedBytes /
                                        contentLength
                                    ) * 100
                                );

                            if (onProgress) {
                                onProgress(
                                    Math.min(
                                        99,
                                        percent
                                    )
                                );
                            }
                        }
                    });

                    response.pipe(file);

                    file.on("finish", () => {

                        file.close(() => {

                            if (settled) {
                                return;
                            }

                            try {

                                const size =
                                    fs.statSync(
                                        outputPath
                                    ).size;

                                if (size <= 0) {

                                    return finishError(
                                        new Error(
                                            "Downloaded file is empty."
                                        )
                                    );

                                }

                                if (onProgress) {
                                    onProgress(100);
                                }

                                finishSuccess(size);

                            } catch (error) {
                                finishError(error);
                            }

                        });

                    });

                    file.on("error", error => {
                        finishError(error);
                    });

                }
            );

            request.on("timeout", () => {

                request.destroy();

                finishError(
                    new Error(
                        "Instagram media download timed out."
                    )
                );

            });

            request.on("error", error => {
                finishError(error);
            });
        }

        requestUrl(url);
    });
}

/* =========================================================
   DETECT MEDIA TYPE
========================================================= */

function detectMediaType(url, contentType = "") {

    const lowerUrl =
        String(url || "").toLowerCase();

    const lowerType =
        String(contentType || "").toLowerCase();

    if (
        lowerType.includes("image") ||
        lowerUrl.includes(".jpg") ||
        lowerUrl.includes(".jpeg") ||
        lowerUrl.includes(".png") ||
        lowerUrl.includes(".webp") ||
        lowerUrl.includes(".heic")
    ) {
        return "image";
    }

    return "video";
}

/* =========================================================
   RUN FFMPEG
========================================================= */

function runFfmpeg(inputPath, outputPath, job, baseProgress) {

    return new Promise((resolve, reject) => {

        if (!ffmpegPath) {
            return reject(
                new Error(
                    "FFmpeg is not available on this server."
                )
            );
        }

        const args = [
            "-y",
            "-i",
            inputPath,

            "-c:v",
            "libx264",

            "-preset",
            "veryfast",

            "-crf",
            "23",

            "-pix_fmt",
            "yuv420p",

            "-c:a",
            "aac",

            "-b:a",
            "128k",

            "-movflags",
            "+faststart",

            outputPath
        ];

        console.log(
            "Running FFmpeg:"
        );

        console.log(
            ffmpegPath,
            args.join(" ")
        );

        const process =
            spawn(
                ffmpegPath,
                args,
                {
                    stdio: [
                        "ignore",
                        "ignore",
                        "pipe"
                    ]
                }
            );

        let stderr = "";

        let finished = false;

        const timeout =
            setTimeout(() => {

                if (finished) return;

                try {
                    process.kill("SIGKILL");
                } catch {}

                finished = true;

                reject(
                    new Error(
                        "Video conversion timed out."
                    )
                );

            }, PROCESS_TIMEOUT);

        process.stderr.on(
            "data",
            data => {

                stderr +=
                    data.toString();

                const match =
                    stderr.match(
                        /time=(\d+):(\d+):(\d+(?:\.\d+)?)/g
                    );

                if (match && job) {

                    updateJob(
                        job,
                        "processing",
                        Math.min(
                            99,
                            baseProgress + 10
                        ),
                        "Optimizing video for maximum compatibility..."
                    );

                }
            }
        );

        process.on(
            "error",
            error => {

                if (finished) return;

                clearTimeout(timeout);

                finished = true;

                reject(error);

            }
        );

        process.on(
            "close",
            code => {

                if (finished) return;

                clearTimeout(timeout);

                finished = true;

                if (code !== 0) {

                    console.error(
                        "FFmpeg error:",
                        stderr
                    );

                    return reject(
                        new Error(
                            "Video compatibility conversion failed."
                        )
                    );

                }

                if (!fs.existsSync(outputPath)) {

                    return reject(
                        new Error(
                            "FFmpeg did not create the converted video."
                        )
                    );

                }

                resolve();

            }
        );
    });
}

/* =========================================================
   PROCESS VIDEO
========================================================= */

async function processVideo(
    inputPath,
    outputPath,
    job,
    baseProgress
) {

    updateJob(
        job,
        "processing",
        baseProgress,
        "Optimizing video for compatibility..."
    );

    await runFfmpeg(
        inputPath,
        outputPath,
        job,
        baseProgress
    );

    try {
        fs.unlinkSync(inputPath);
    } catch {}

    return fs.statSync(
        outputPath
    ).size;
}

/* =========================================================
   CLEAN OLD FILES
========================================================= */

function cleanupExpiredFiles() {

    if (!fs.existsSync(DOWNLOAD_DIR)) {
        return;
    }

    const now =
        Date.now();

    for (
        const fileName of
        fs.readdirSync(DOWNLOAD_DIR)
    ) {

        const filePath =
            path.join(
                DOWNLOAD_DIR,
                fileName
            );

        try {

            const stats =
                fs.statSync(
                    filePath
                );

            if (
                now -
                stats.mtimeMs >
                FILE_EXPIRY
            ) {

                fs.unlinkSync(
                    filePath
                );

                console.log(
                    "Deleted expired file:",
                    fileName
                );
            }

        } catch {}

    }
}

/* =========================================================
   CLEAN OLD JOBS
========================================================= */

function cleanupOldJobs() {

    const now =
        Date.now();

    for (
        const [id, job]
        of jobs.entries()
    ) {

        if (
            now -
            job.updatedAt >
            JOB_EXPIRY
        ) {

            jobs.delete(id);

        }

    }
}

setInterval(
    cleanupExpiredFiles,
    60 * 1000
);

setInterval(
    cleanupOldJobs,
    60 * 1000
);

/* =========================================================
   HEALTH CHECK
========================================================= */

app.get(
    "/api/health",
    (req, res) => {

        res.json({
            ok: true,
            service: "Instagram Downloader",
            status: "running"
        });

    }
);

/* =========================================================
   START DOWNLOAD JOB
========================================================= */

app.post(
    "/api/download",
    async (req, res) => {

        const url =
            typeof req.body.url === "string"
                ? req.body.url.trim()
                : "";

        if (!url) {

            return res.status(400).json({
                ok: false,
                error:
                    "Please provide an Instagram URL."
            });

        }

        if (!isInstagramUrl(url)) {

            return res.status(400).json({
                ok: false,
                error:
                    "Please provide a valid Instagram URL."
            });

        }

        const job =
            createJob();

        updateJob(
            job,
            "fetching",
            5,
            "Fetching Instagram media..."
        );

        res.status(202).json({
            ok: true,
            jobId: job.id
        });

        processInstagramJob(
            job,
            url
        );

    }
);

/* =========================================================
   PROCESS INSTAGRAM JOB
========================================================= */

async function processInstagramJob(
    job,
    url
) {

    try {

        console.log("");
        console.log(
            "================================="
        );
        console.log(
            "Instagram download job:",
            job.id
        );
        console.log(
            "================================="
        );

        console.log(url);

        /* =========================================
           FETCH INSTAGRAM INFORMATION
        ========================================= */

        updateJob(
            job,
            "fetching",
            10,
            "Connecting to Instagram..."
        );

        const result =
            await instagram(url);

        console.log(
            "Instagram API response:"
        );

        console.log(
            JSON.stringify(
                result,
                null,
                2
            )
        );

        /* =========================================
           FIND MEDIA URLS
        ========================================= */

        let mediaUrls =
            Array.from(
                collectMediaUrls(
                    result
                )
            );

        /* =========================================
           FALLBACKS
        ========================================= */

        if (
            mediaUrls.length === 0 &&
            result &&
            result.data &&
            typeof result.data.url === "string"
        ) {

            mediaUrls = [
                result.data.url
            ];

        }

        if (
            mediaUrls.length === 0 &&
            result &&
            typeof result.url === "string"
        ) {

            mediaUrls = [
                result.url
            ];

        }

        /* =========================================
           REMOVE DUPLICATES
        ========================================= */

        mediaUrls =
            Array.from(
                new Set(
                    mediaUrls
                )
            );

        /* Limit carousel extraction to 20 items */
        mediaUrls =
            mediaUrls.slice(
                0,
                20
            );

        if (
            mediaUrls.length === 0
        ) {

            throw new Error(
                "Instagram API did not return a downloadable media URL."
            );

        }

        console.log(
            "Media URLs found:",
            mediaUrls.length
        );

        /* =========================================
           DOWNLOAD MEDIA
        ========================================= */

        const files = [];

        for (
            let i = 0;
            i < mediaUrls.length;
            i++
        ) {

            const mediaUrl =
                mediaUrls[i];

            const itemNumber =
                i + 1;

            const total =
                mediaUrls.length;

            const downloadStart =
                15 +
                (
                    i /
                    total
                ) * 45;

            updateJob(
                job,
                "downloading",
                Math.round(
                    downloadStart
                ),
                total > 1
                    ? `Downloading item ${itemNumber} of ${total}...`
                    : "Downloading media..."
            );

            const id =
                crypto
                    .randomBytes(12)
                    .toString("hex");

            const temporaryName =
                `instagram-${id}-source`;

            const temporaryPath =
                path.join(
                    DOWNLOAD_DIR,
                    temporaryName
                );

            const downloadResult =
                await downloadFile(
                    mediaUrl,
                    temporaryPath,
                    percent => {

                        const progress =
                            downloadStart +
                            (
                                percent /
                                100
                            ) * 40 /
                            total;

                        updateJob(
                            job,
                            "downloading",
                            Math.round(
                                progress
                            ),
                            total > 1
                                ? `Downloading item ${itemNumber} of ${total}...`
                                : `Downloading media... ${percent}%`
                        );

                    }
                );

            const originalSize =
                downloadResult.size;

            const type =
                detectMediaType(
                    mediaUrl
                );

            /* =========================================
               IMAGE
            ========================================= */

            if (type === "image") {

                const filename =
                    `instagram-${id}.jpg`;

                const finalPath =
                    path.join(
                        DOWNLOAD_DIR,
                        filename
                    );

                fs.renameSync(
                    temporaryPath,
                    finalPath
                );

                files.push({

                    filename,

                    size:
                        originalSize,

                    type:
                        "image",

                    downloadUrl:
                        `/api/file/${encodeURIComponent(filename)}`

                });

                continue;
            }

            /* =========================================
               VIDEO
            ========================================= */

            const filename =
                `instagram-${id}.mp4`;

            const finalPath =
                path.join(
                    DOWNLOAD_DIR,
                    filename
                );

            await processVideo(
                temporaryPath,
                finalPath,
                job,
                65
            );

            const finalSize =
                fs.statSync(
                    finalPath
                ).size;

            files.push({

                filename,

                size:
                    finalSize,

                type:
                    "video",

                downloadUrl:
                    `/api/file/${encodeURIComponent(filename)}`

            });

        }

        /* =========================================
           COMPLETE
        ========================================= */

        completeJob(
            job,
            files
        );

        console.log(
            "Instagram job completed:",
            job.id
        );

    } catch (error) {

        console.error(
            "INSTAGRAM ERROR:",
            error
        );

        failJob(
            job,
            error.message ||
            "Instagram download failed."
        );

    }

}

/* =========================================================
   JOB STATUS
========================================================= */

app.get(
    "/api/status/:jobId",
    (req, res) => {

        const job =
            jobs.get(
                req.params.jobId
            );

        if (!job) {

            return res.status(404).json({
                ok: false,
                error:
                    "Download job not found or expired."
            });

        }

        res.json({

            ok: true,

            jobId:
                job.id,

            status:
                job.status,

            progress:
                job.progress,

            message:
                job.message,

            files:
                job.files,

            error:
                job.error

        });

    }
);

/* =========================================================
   SERVE FILE
========================================================= */

app.get(
    "/api/file/:filename",
    (req, res) => {

        const filename =
            path.basename(
                req.params.filename
            );

        const filePath =
            path.join(
                DOWNLOAD_DIR,
                filename
            );

        if (
            !fs.existsSync(
                filePath
            )
        ) {

            return res.status(404).send(
                "File not found or expired."
            );

        }

        const extension =
            path.extname(
                filename
            ).toLowerCase();

        let contentType =
            "application/octet-stream";

        if (
            extension === ".mp4"
        ) {
            contentType =
                "video/mp4";
        }

        if (
            extension === ".jpg" ||
            extension === ".jpeg"
        ) {
            contentType =
                "image/jpeg";
        }

        if (
            extension === ".png"
        ) {
            contentType =
                "image/png";
        }

        if (
            extension === ".webp"
        ) {
            contentType =
                "image/webp";
        }

        res.setHeader(
            "Content-Type",
            contentType
        );

        res.download(
            filePath,
            filename,
            error => {

                if (error) {

                    console.error(
                        "File download error:",
                        error
                    );

                }

            }
        );

    }
);

/* =========================================================
   FRONTEND
========================================================= */

app.get(
    "/",
    (req, res) => {

        res.send(`<!DOCTYPE html>

<html lang="en">

<head>

<meta charset="UTF-8">

<meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
>

<title>Instagram Downloader</title>

<style>

* {
    box-sizing: border-box;
}

body {

    margin: 0;

    min-height: 100vh;

    font-family:
        Inter,
        Arial,
        sans-serif;

    background:
        radial-gradient(
            circle at top left,
            #39205f 0%,
            #171525 35%,
            #080910 75%
        );

    color: white;

    display: flex;

    align-items: center;

    justify-content: center;

    padding: 24px;

}

.container {

    width: 100%;

    max-width: 760px;

}

.brand {

    text-align: center;

    margin-bottom: 28px;

}

.logo {

    width: 74px;

    height: 74px;

    margin: 0 auto 18px;

    border-radius: 22px;

    display: flex;

    align-items: center;

    justify-content: center;

    font-size: 35px;

    background:
        linear-gradient(
            135deg,
            #feda75,
            #d62976,
            #962fbf,
            #4f5bd5
        );

    box-shadow:
        0 20px 60px rgba(
            214,
            41,
            118,
            0.28
        );

}

h1 {

    margin: 0;

    font-size: 38px;

    letter-spacing: -1px;

}

.subtitle {

    margin-top: 10px;

    color: #aaaebe;

    font-size: 15px;

}

.card {

    background:
        rgba(
            20,
            21,
            31,
            0.88
        );

    border:
        1px solid
        rgba(
            255,
            255,
            255,
            0.09
        );

    border-radius: 28px;

    padding: 28px;

    box-shadow:
        0 30px 100px
        rgba(
            0,
            0,
            0,
            0.45
        );

    backdrop-filter:
        blur(20px);

}

.input-wrap {

    display: flex;

    gap: 10px;

    padding: 7px;

    border-radius: 18px;

    background:
        #0c0d14;

    border:
        1px solid
        rgba(
            255,
            255,
            255,
            0.08
        );

}

input {

    flex: 1;

    min-width: 0;

    border: none;

    outline: none;

    background: transparent;

    color: white;

    padding:
        15px 14px;

    font-size: 15px;

}

input::placeholder {
    color: #707384;
}

button {

    border: none;

    cursor: pointer;

    border-radius: 14px;

    padding:
        0 24px;

    font-weight: 700;

    color: white;

    background:
        linear-gradient(
            135deg,
            #d62976,
            #8e35c7
        );

    transition:
        transform .2s,
        opacity .2s;

}

button:hover {

    transform:
        translateY(-1px);

}

button:disabled {

    opacity: .5;

    cursor:
        not-allowed;

    transform:
        none;

}

.status {

    margin-top: 24px;

    display: none;

}

.status.show {
    display: block;
}

.status-box {

    padding: 20px;

    border-radius: 18px;

    background:
        rgba(
            255,
            255,
            255,
            0.045
        );

}

.status-top {

    display: flex;

    align-items: center;

    gap: 12px;

    margin-bottom: 15px;

}

.spinner {

    width: 20px;

    height: 20px;

    border-radius: 50%;

    border:
        3px solid
        rgba(
            255,
            255,
            255,
            0.15
        );

    border-top-color:
        #d62976;

    animation:
        spin .8s linear infinite;

}

@keyframes spin {

    to {
        transform:
            rotate(360deg);
    }

}

.progress {

    height: 9px;

    background:
        #090a10;

    border-radius: 999px;

    overflow: hidden;

}

.progress-bar {

    height: 100%;

    width: 0%;

    border-radius: inherit;

    background:
        linear-gradient(
            90deg,
            #d62976,
            #8e35c7,
            #4f5bd5
        );

    transition:
        width .35s ease;

}

.percent {

    margin-top: 9px;

    color: #989bad;

    font-size: 13px;

}

.results {

    margin-top: 15px;

    display: grid;

    gap: 10px;

}

.result {

    display: flex;

    align-items: center;

    justify-content: space-between;

    gap: 12px;

    padding: 14px;

    border-radius: 15px;

    background:
        rgba(
            255,
            255,
            255,
            0.05
        );

}

.result-name {

    overflow: hidden;

    text-overflow: ellipsis;

    white-space: nowrap;

    color: #dfe1eb;

    font-size: 14px;

}

.download {

    flex-shrink: 0;

    text-decoration: none;

    color: white;

    background:
        #242637;

    padding:
        10px 15px;

    border-radius: 11px;

    font-size: 13px;

    font-weight: 700;

}

.error {

    color:
        #ff8e9f;

}

.features {

    display: grid;

    grid-template-columns:
        repeat(3, 1fr);

    gap: 10px;

    margin-top: 16px;

}

.feature {

    padding: 14px;

    border-radius: 15px;

    background:
        rgba(
            255,
            255,
            255,
            0.035
        );

    color: #9da0b2;

    font-size: 12px;

    text-align: center;

}

.footer {

    text-align: center;

    color: #656878;

    font-size: 12px;

    margin-top: 18px;

}

@media (
    max-width: 600px
) {

    body {
        padding: 15px;
    }

    h1 {
        font-size: 30px;
    }

    .card {
        padding: 18px;
        border-radius: 22px;
    }

    .input-wrap {
        flex-direction: column;
    }

    button {
        height: 50px;
    }

    .features {
        grid-template-columns:
            1fr;
    }

    .result {
        align-items:
            flex-start;

        flex-direction:
            column;
    }

}

</style>

</head>

<body>

<div class="container">

    <div class="brand">

        <div class="logo">
            ◎
        </div>

        <h1>
            Instagram Downloader
        </h1>

        <div class="subtitle">
            Download public Instagram media quickly and easily
        </div>

    </div>

    <div class="card">

        <div class="input-wrap">

            <input
                id="url"
                type="url"
                autocomplete="off"
                placeholder="Paste Instagram Reel or Post URL..."
            >

            <button
                id="downloadBtn"
                onclick="startDownload()"
            >
                Download
            </button>

        </div>

        <div
            id="status"
            class="status"
        >

            <div class="status-box">

                <div class="status-top">

                    <div
                        id="spinner"
                        class="spinner"
                    ></div>

                    <div id="message">
                        Starting...
                    </div>

                </div>

                <div class="progress">

                    <div
                        id="progressBar"
                        class="progress-bar"
                    ></div>

                </div>

                <div
                    id="percent"
                    class="percent"
                >
                    0%
                </div>

                <div
                    id="results"
                    class="results"
                ></div>

            </div>

        </div>

        <div class="features">

            <div class="feature">
                🎬 Reels
            </div>

            <div class="feature">
                🖼️ Photos
            </div>

            <div class="feature">
                📦 Multiple Media
            </div>

        </div>

    </div>

    <div class="footer">
        Public Instagram content only
    </div>

</div>

<script>

const urlInput =
    document.getElementById(
        "url"
    );

const button =
    document.getElementById(
        "downloadBtn"
    );

const statusBox =
    document.getElementById(
        "status"
    );

const message =
    document.getElementById(
        "message"
    );

const progressBar =
    document.getElementById(
        "progressBar"
    );

const percent =
    document.getElementById(
        "percent"
    );

const results =
    document.getElementById(
        "results"
    );

const spinner =
    document.getElementById(
        "spinner"
    );

/* =========================================================
   START DOWNLOAD
========================================================= */

async function startDownload() {

    const url =
        urlInput.value.trim();

    if (!url) {

        showError(
            "Please paste an Instagram URL."
        );

        return;

    }

    button.disabled = true;

    statusBox.classList.add(
        "show"
    );

    results.innerHTML = "";

    spinner.style.display =
        "block";

    progressBar.style.width =
        "0%";

    percent.textContent =
        "0%";

    message.textContent =
        "Starting download...";

    try {

        const response =
            await fetch(
                "/api/download",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify({
                            url
                        })
                }
            );

        const data =
            await response.json();

        if (!response.ok) {

            throw new Error(
                data.error ||
                "Download could not be started."
            );

        }

        await pollJob(
            data.jobId
        );

    } catch (error) {

        showError(
            error.message
        );

        button.disabled =
            false;

    }

}

/* =========================================================
   POLL JOB
========================================================= */

async function pollJob(
    jobId
) {

    try {

        const response =
            await fetch(
                "/api/status/" + encodeURIComponent(jobId)
            );

        const data =
            await response.json();

        if (!response.ok) {

            throw new Error(
                data.error ||
                "Could not read download status."
            );

        }

        progressBar.style.width =
            `${data.progress}%`;

        percent.textContent =
            `${data.progress}%`;

        message.textContent =
            data.message ||
            "Processing...";

        if (
            data.status ===
            "completed"
        ) {

            spinner.style.display =
                "none";

            renderResults(
                data.files || []
            );

            button.disabled =
                false;

            return;

        }

        if (
            data.status ===
            "error"
        ) {

            throw new Error(
                data.error ||
                data.message ||
                "Instagram download failed."
            );

        }

        setTimeout(
            () => pollJob(jobId),
            800
        );

    } catch (error) {

        showError(
            error.message
        );

        button.disabled =
            false;

    }

}

/* =========================================================
   SHOW RESULTS
========================================================= */

function renderResults(
    files
) {

    results.innerHTML = "";

    if (!files.length) {

        showError(
            "No downloadable media was returned."
        );

        return;

    }

    files.forEach(
        (file, index) => {

            const row =
                document.createElement(
                    "div"
                );

            row.className =
                "result";

            const name =
                document.createElement(
                    "div"
                );

            name.className =
                "result-name";

            name.textContent =
                files.length > 1
                    ? `${file.type === "image" ? "🖼️" : "🎬"} Media ${index + 1}`
                    : file.filename;

            const link =
                document.createElement(
                    "a"
                );

            link.className =
                "download";

            link.href =
                file.downloadUrl;

            link.download =
                file.filename;

            link.textContent =
                "⬇ Download";

            row.appendChild(
                name
            );

            row.appendChild(
                link
            );

            results.appendChild(
                row
            );

        }
    );

}

/* =========================================================
   ERROR
========================================================= */

function showError(
    text
) {

    statusBox.classList.add(
        "show"
    );

    spinner.style.display =
        "none";

    message.innerHTML =
        `<span class="error">❌ ${escapeHtml(text)}</span>`;

    progressBar.style.width =
        "0%";

    percent.textContent =
        "";

}

/* =========================================================
   ESCAPE HTML
========================================================= */

function escapeHtml(
    text
) {

    return String(text)
        .replace(
            /&/g,
            "&amp;"
        )
        .replace(
            /</g,
            "&lt;"
        )
        .replace(
            />/g,
            "&gt;"
        )
        .replace(
            /"/g,
            "&quot;"
        )
        .replace(
            /'/g,
            "&#039;"
        );

}

/* =========================================================
   ENTER KEY
========================================================= */

urlInput.addEventListener(
    "keydown",
    event => {

        if (
            event.key ===
            "Enter"
        ) {

            startDownload();

        }

    }
);

</script>

</body>

</html>`);

    }
);

/* =========================================================
   START SERVER
========================================================= */

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log("");
        console.log(
            "======================================"
        );

        console.log(
            `Instagram Downloader running on port ${PORT}`
        );

        console.log(
            "======================================"
        );

    }
);
