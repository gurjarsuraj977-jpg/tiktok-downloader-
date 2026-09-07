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

const PORT = process.env.PORT || 3000;

const DOWNLOAD_DIR = path.join(__dirname, "instagram-downloads");
const TEMP_DIR = path.join(__dirname, "instagram-temp");

const MAX_FILE_SIZE = 200 * 1024 * 1024;
const DOWNLOAD_TIMEOUT = 120000;

const FILE_EXPIRY = 5 * 60 * 1000;
const JOB_EXPIRY = 10 * 60 * 1000;

const jobs = new Map();

app.use(express.json());

if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}


/* =========================================================
   HELPERS
========================================================= */

function safeUnlink(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    } catch (error) {
        console.error("Could not delete:", filePath, error.message);
    }
}


function isInstagramUrl(value) {
    try {
        const url = new URL(value);

        if (
            url.hostname !== "instagram.com" &&
            url.hostname !== "www.instagram.com" &&
            url.hostname !== "m.instagram.com"
        ) {
            return false;
        }

        return (
            url.pathname.startsWith("/reel/") ||
            url.pathname.startsWith("/reels/") ||
            url.pathname.startsWith("/p/") ||
            url.pathname.startsWith("/tv/") ||
            url.pathname.startsWith("/stories/")
        );
    } catch {
        return false;
    }
}


function looksLikeHttpUrl(value) {
    return (
        typeof value === "string" &&
        /^https?:\/\//i.test(value)
    );
}


function getExtensionFromContentType(contentType) {
    const type = String(contentType || "").toLowerCase();

    if (type.includes("image/jpeg")) return ".jpg";
    if (type.includes("image/jpg")) return ".jpg";
    if (type.includes("image/png")) return ".png";
    if (type.includes("image/webp")) return ".webp";
    if (type.includes("image/gif")) return ".gif";
    if (type.includes("image/avif")) return ".avif";

    if (type.includes("video/mp4")) return ".mp4";
    if (type.includes("video/webm")) return ".webm";
    if (type.includes("video/quicktime")) return ".mov";
    if (type.includes("video/x-msvideo")) return ".avi";

    return "";
}


function getExtensionFromUrl(url) {
    try {
        const pathname = new URL(url).pathname.toLowerCase();

        if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) {
            return ".jpg";
        }

        if (pathname.endsWith(".png")) {
            return ".png";
        }

        if (pathname.endsWith(".webp")) {
            return ".webp";
        }

        if (pathname.endsWith(".gif")) {
            return ".gif";
        }

        if (pathname.endsWith(".avif")) {
            return ".avif";
        }

        if (pathname.endsWith(".mp4")) {
            return ".mp4";
        }

        if (pathname.endsWith(".webm")) {
            return ".webm";
        }

        if (pathname.endsWith(".mov")) {
            return ".mov";
        }

        return "";
    } catch {
        return "";
    }
}


function isImageType(contentType, url) {
    const type = String(contentType || "").toLowerCase();

    if (type.startsWith("image/")) {
        return true;
    }

    const extension = getExtensionFromUrl(url);

    return [
        ".jpg",
        ".jpeg",
        ".png",
        ".webp",
        ".gif",
        ".avif"
    ].includes(extension);
}


function isAlreadyMp4(contentType, url) {
    const type = String(contentType || "").toLowerCase();

    if (type.includes("video/mp4")) {
        return true;
    }

    return getExtensionFromUrl(url) === ".mp4";
}


/* =========================================================
   DOWNLOAD REMOTE FILE
========================================================= */

function downloadFile(url, outputPath, redirectCount = 0) {
    return new Promise((resolve, reject) => {
        if (redirectCount > 5) {
            reject(new Error("Too many redirects."));
            return;
        }

        let parsed;

        try {
            parsed = new URL(url);
        } catch {
            reject(new Error("Invalid media URL."));
            return;
        }

        const protocol = parsed.protocol === "https:" ? https : http;

        const request = protocol.get(
            parsed,
            {
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36",

                    "Accept":
                        "*/*",

                    "Accept-Encoding":
                        "identity"
                },

                timeout: DOWNLOAD_TIMEOUT
            },
            (response) => {

                const status = response.statusCode || 0;

                if (
                    status >= 300 &&
                    status < 400 &&
                    response.headers.location
                ) {
                    response.resume();

                    const nextUrl = new URL(
                        response.headers.location,
                        url
                    ).toString();

                    downloadFile(
                        nextUrl,
                        outputPath,
                        redirectCount + 1
                    )
                        .then(resolve)
                        .catch(reject);

                    return;
                }


                if (status < 200 || status >= 300) {
                    response.resume();

                    reject(
                        new Error(
                            "Media server returned HTTP " +
                            status
                        )
                    );

                    return;
                }


                const contentType =
                    response.headers["content-type"] || "";

                const declaredLength =
                    Number(
                        response.headers["content-length"] || 0
                    );

                if (
                    declaredLength > MAX_FILE_SIZE
                ) {
                    response.resume();

                    reject(
                        new Error(
                            "File is larger than the 200 MB limit."
                        )
                    );

                    return;
                }


                const output =
                    fs.createWriteStream(outputPath);

                let totalBytes = 0;
                let finished = false;


                function fail(error) {
                    if (finished) return;

                    finished = true;

                    output.destroy();

                    safeUnlink(outputPath);

                    reject(error);
                }


                response.on("data", (chunk) => {
                    totalBytes += chunk.length;

                    if (totalBytes > MAX_FILE_SIZE) {
                        response.destroy(
                            new Error(
                                "File exceeded the 200 MB limit."
                            )
                        );
                    }
                });


                response.on("error", fail);

                output.on("error", fail);


                output.on("finish", () => {
                    if (finished) return;

                    finished = true;

                    resolve({
                        size: totalBytes,
                        contentType: contentType
                    });
                });


                response.pipe(output);
            }
        );


        request.on("timeout", () => {
            request.destroy(
                new Error("Download timed out.")
            );
        });


        request.on("error", (error) => {
            reject(error);
        });
    });
}


/* =========================================================
   FIND MEDIA URLS IN API RESPONSE
========================================================= */

function collectMediaUrls(value, result, seen, depth = 0) {
    if (
        value === null ||
        value === undefined ||
        depth > 8
    ) {
        return;
    }


    if (typeof value === "string") {
        if (looksLikeHttpUrl(value)) {

            const lower = value.toLowerCase();

            const looksLikeMedia =
                lower.includes(".jpg") ||
                lower.includes(".jpeg") ||
                lower.includes(".png") ||
                lower.includes(".webp") ||
                lower.includes(".gif") ||
                lower.includes(".avif") ||
                lower.includes(".mp4") ||
                lower.includes(".webm") ||
                lower.includes(".mov") ||
                lower.includes("video") ||
                lower.includes("image") ||
                lower.includes("media") ||
                lower.includes("cdninstagram") ||
                lower.includes("fbcdn");

            if (looksLikeMedia && !seen.has(value)) {
                seen.add(value);
                result.push(value);
            }
        }

        return;
    }


    if (Array.isArray(value)) {
        for (const item of value) {
            if (result.length >= 20) return;

            collectMediaUrls(
                item,
                result,
                seen,
                depth + 1
            );
        }

        return;
    }


    if (typeof value === "object") {

        const priorityKeys = [
            "video",
            "video_url",
            "videoUrl",
            "download",
            "download_url",
            "downloadUrl",
            "image",
            "image_url",
            "imageUrl",
            "display_url",
            "displayUrl",
            "media",
            "src",
            "url"
        ];


        for (const key of priorityKeys) {

            if (
                Object.prototype.hasOwnProperty.call(
                    value,
                    key
                )
            ) {
                collectMediaUrls(
                    value[key],
                    result,
                    seen,
                    depth + 1
                );
            }

            if (result.length >= 20) {
                return;
            }
        }


        for (const key of Object.keys(value)) {

            if (result.length >= 20) {
                return;
            }

            collectMediaUrls(
                value[key],
                result,
                seen,
                depth + 1
            );
        }
    }
}


function extractMediaUrls(result) {
    const urls = [];
    const seen = new Set();


    if (
        result &&
        result.data &&
        typeof result.data.url === "string" &&
        looksLikeHttpUrl(result.data.url)
    ) {
        seen.add(result.data.url);
        urls.push(result.data.url);
    }


    if (
        result &&
        typeof result.url === "string" &&
        looksLikeHttpUrl(result.url) &&
        !seen.has(result.url)
    ) {
        seen.add(result.url);
        urls.push(result.url);
    }


    collectMediaUrls(
        result,
        urls,
        seen
    );


    return [...new Set(urls)].slice(0, 20);
}


/* =========================================================
   FFMPEG CONVERSION
========================================================= */

function convertVideoToMp4(
    inputPath,
    outputPath,
    job
) {
    return new Promise((resolve, reject) => {

        if (!ffmpegPath) {
            reject(
                new Error(
                    "FFmpeg is not available."
                )
            );

            return;
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

            "-c:a",
            "aac",

            "-b:a",
            "128k",

            "-movflags",
            "+faststart",

            "-pix_fmt",
            "yuv420p",

            outputPath
        ];


        const ffmpeg =
            spawn(ffmpegPath, args);


        let stderr = "";


        ffmpeg.stderr.on(
            "data",
            (data) => {
                stderr += data.toString();

                if (job) {
                    job.stage = "converting";
                    job.message =
                        "Optimizing video for MP4...";
                }
            }
        );


        ffmpeg.on(
            "error",
            (error) => {
                reject(error);
            }
        );


        ffmpeg.on(
            "close",
            (code) => {

                if (code === 0) {

                    if (job) {
                        job.progress = Math.max(
                            job.progress,
                            95
                        );
                    }

                    resolve();

                    return;
                }


                reject(
                    new Error(
                        "FFmpeg conversion failed: " +
                        stderr.slice(-1000)
                    )
                );
            }
        );
    });
}


/* =========================================================
   PROCESS INSTAGRAM JOB
========================================================= */

async function processInstagramJob(
    jobId,
    instagramUrl
) {
    const job = jobs.get(jobId);

    if (!job) return;


    try {

        job.status = "processing";
        job.stage = "fetching";
        job.progress = 10;
        job.message =
            "Getting Instagram media...";


        const result =
            await instagram(instagramUrl);


        if (
            !result ||
            (
                result.status &&
                result.status !== "success"
            )
        ) {
            throw new Error(
                "Instagram media could not be found."
            );
        }


        const mediaUrls =
            extractMediaUrls(result);


        if (!mediaUrls.length) {
            throw new Error(
                "No downloadable media was found."
            );
        }


        job.total = mediaUrls.length;
        job.completed = 0;
        job.files = [];


        for (
            let i = 0;
            i < mediaUrls.length;
            i++
        ) {

            const mediaUrl = mediaUrls[i];

            job.stage = "downloading";
            job.progress =
                15 +
                Math.floor(
                    (i / mediaUrls.length) * 55
                );

            job.message =
                "Downloading media " +
                (i + 1) +
                " of " +
                mediaUrls.length +
                "...";


            const id =
                crypto
                    .randomBytes(12)
                    .toString("hex");


            const tempPath =
                path.join(
                    TEMP_DIR,
                    id + ".download"
                );


            try {

                const info =
                    await downloadFile(
                        mediaUrl,
                        tempPath
                    );


                const image =
                    isImageType(
                        info.contentType,
                        mediaUrl
                    );


                if (image) {

                    const extension =
                        getExtensionFromContentType(
                            info.contentType
                        ) ||
                        getExtensionFromUrl(
                            mediaUrl
                        ) ||
                        ".jpg";


                    const filename =
                        "instagram-" +
                        id +
                        extension;


                    const finalPath =
                        path.join(
                            DOWNLOAD_DIR,
                            filename
                        );


                    fs.renameSync(
                        tempPath,
                        finalPath
                    );


                    job.files.push({
                        filename: filename,
                        size: info.size,
                        type: "image",
                        downloadUrl:
                            "/api/file/" +
                            encodeURIComponent(
                                filename
                            )
                    });

                } else {

                    const filename =
                        "instagram-" +
                        id +
                        ".mp4";


                    const finalPath =
                        path.join(
                            DOWNLOAD_DIR,
                            filename
                        );


                    if (
                        isAlreadyMp4(
                            info.contentType,
                            mediaUrl
                        )
                    ) {

                        fs.renameSync(
                            tempPath,
                            finalPath
                        );

                    } else {

                        job.stage =
                            "converting";

                        job.progress =
                            75;

                        job.message =
                            "Converting video to compatible MP4...";


                        await convertVideoToMp4(
                            tempPath,
                            finalPath,
                            job
                        );


                        safeUnlink(
                            tempPath
                        );
                    }


                    const finalSize =
                        fs.statSync(
                            finalPath
                        ).size;


                    job.files.push({
                        filename: filename,
                        size: finalSize,
                        type: "video",
                        downloadUrl:
                            "/api/file/" +
                            encodeURIComponent(
                                filename
                            )
                    });
                }


                job.completed++;

            } catch (mediaError) {

                safeUnlink(tempPath);

                console.error(
                    "Media item failed:",
                    mediaError.message
                );
            }
        }


        if (!job.files.length) {
            throw new Error(
                "The media was found, but could not be downloaded."
            );
        }


        job.status = "completed";
        job.stage = "completed";
        job.progress = 100;
        job.message =
            job.files.length === 1
                ? "Download ready!"
                : job.files.length +
                  " media files ready!";


        job.finishedAt = Date.now();

    } catch (error) {

        console.error(
            "Instagram job error:",
            error
        );


        job.status = "error";
        job.stage = "error";
        job.progress = 0;
        job.message =
            error.message ||
            "Something went wrong.";


        job.finishedAt = Date.now();
    }
}


/* =========================================================
   CLEANUP
========================================================= */

function cleanupOldFiles() {

    const now = Date.now();


    for (const directory of [
        DOWNLOAD_DIR,
        TEMP_DIR
    ]) {

        try {

            const files =
                fs.readdirSync(directory);


            for (const filename of files) {

                const filePath =
                    path.join(
                        directory,
                        filename
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
                        safeUnlink(
                            filePath
                        );
                    }

                } catch {
                    // Ignore individual files.
                }
            }

        } catch (error) {
            console.error(
                "Cleanup error:",
                error.message
            );
        }
    }


    for (const [jobId, job] of jobs.entries()) {

        if (
            now - job.createdAt >
            JOB_EXPIRY
        ) {
            jobs.delete(jobId);
        }
    }
}


setInterval(
    cleanupOldFiles,
    60 * 1000
);


/* =========================================================
   API
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


app.post(
    "/api/download",
    async (req, res) => {

        try {

            const instagramUrl =
                String(
                    req.body &&
                    req.body.url ||
                    ""
                ).trim();


            if (!instagramUrl) {

                return res.status(400).json({
                    ok: false,
                    error:
                        "Please enter an Instagram URL."
                });
            }


            if (!isInstagramUrl(instagramUrl)) {

                return res.status(400).json({
                    ok: false,
                    error:
                        "Please enter a valid public Instagram Reel, Post, TV or Story URL."
                });
            }


            const jobId =
                crypto
                    .randomBytes(16)
                    .toString("hex");


            jobs.set(
                jobId,
                {
                    id: jobId,

                    status: "queued",

                    stage: "queued",

                    progress: 0,

                    message:
                        "Starting download...",

                    files: [],

                    total: 0,

                    completed: 0,

                    createdAt: Date.now(),

                    finishedAt: null
                }
            );


            processInstagramJob(
                jobId,
                instagramUrl
            );


            return res.status(202).json({
                ok: true,
                jobId: jobId,
                status: "queued",
                statusUrl:
                    "/api/status/" +
                    encodeURIComponent(
                        jobId
                    )
            });

        } catch (error) {

            console.error(
                "Download API error:",
                error
            );


            return res.status(500).json({
                ok: false,
                error:
                    "Could not start download."
            });
        }
    }
);


app.get(
    "/api/status/:jobId",
    (req, res) => {

        const jobId =
            req.params.jobId;


        const job =
            jobs.get(jobId);


        if (!job) {

            return res.status(404).json({
                ok: false,
                error:
                    "Download job not found or expired."
            });
        }


        return res.json({
            ok: true,
            jobId: job.id,
            status: job.status,
            stage: job.stage,
            progress: job.progress,
            message: job.message,
            total: job.total,
            completed: job.completed,
            files: job.files,
            createdAt: job.createdAt,
            finishedAt: job.finishedAt
        });
    }
);


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


        if (!fs.existsSync(filePath)) {

            return res.status(404).send(
                "File not found or expired."
            );
        }


        res.download(
            filePath,
            filename,
            (error) => {

                if (error) {
                    console.error(
                        "File download error:",
                        error.message
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

        const html = `
<!DOCTYPE html>
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
        system-ui,
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        sans-serif;

    background:
        radial-gradient(
            circle at top left,
            #3b0764 0,
            transparent 35%
        ),
        radial-gradient(
            circle at bottom right,
            #831843 0,
            transparent 35%
        ),
        #080808;

    color: #ffffff;

    display: flex;
    justify-content: center;
    align-items: center;

    padding: 24px;
}

.container {
    width: 100%;
    max-width: 720px;
}

.card {
    background: rgba(20, 20, 24, 0.92);

    border:
        1px solid
        rgba(255, 255, 255, 0.10);

    border-radius: 28px;

    padding: 38px;

    box-shadow:
        0 30px 100px
        rgba(0, 0, 0, 0.55);

    backdrop-filter: blur(20px);
}

.logo {
    width: 68px;
    height: 68px;

    margin: 0 auto 20px;

    border-radius: 20px;

    display: flex;
    align-items: center;
    justify-content: center;

    font-size: 32px;

    background:
        linear-gradient(
            135deg,
            #833ab4,
            #fd1d1d,
            #fcb045
        );

    box-shadow:
        0 12px 35px
        rgba(253, 29, 29, 0.25);
}

h1 {
    text-align: center;

    margin: 0;

    font-size: 36px;

    letter-spacing: -1.5px;
}

.subtitle {
    text-align: center;

    color: #a1a1aa;

    margin:
        10px 0 30px;

    line-height: 1.6;
}

.input-row {
    display: flex;

    gap: 10px;

    margin-bottom: 16px;
}

input {
    flex: 1;

    min-width: 0;

    padding:
        17px 18px;

    border-radius: 15px;

    border:
        1px solid
        rgba(255,255,255,0.10);

    background: #111114;

    color: #ffffff;

    outline: none;

    font-size: 15px;

    transition: 0.2s;
}

input:focus {
    border-color: #a855f7;

    box-shadow:
        0 0 0 3px
        rgba(168,85,247,0.12);
}

button {
    border: 0;

    border-radius: 15px;

    padding:
        0 24px;

    background:
        linear-gradient(
            135deg,
            #9333ea,
            #ec4899
        );

    color: white;

    font-size: 15px;

    font-weight: 700;

    cursor: pointer;

    transition:
        transform 0.2s,
        opacity 0.2s;

    white-space: nowrap;
}

button:hover {
    transform: translateY(-2px);
}

button:disabled {
    opacity: 0.55;

    cursor: not-allowed;

    transform: none;
}

.status-box {
    display: none;

    margin-top: 22px;

    padding: 20px;

    border-radius: 18px;

    background: #111114;

    border:
        1px solid
        rgba(255,255,255,0.08);
}

.status-top {
    display: flex;

    justify-content: space-between;

    gap: 15px;

    margin-bottom: 13px;
}

.status-text {
    color: #d4d4d8;

    font-size: 14px;
}

.percent {
    font-weight: 800;

    color: #ffffff;
}

.progress-track {
    height: 10px;

    background: #27272a;

    border-radius: 99px;

    overflow: hidden;
}

.progress-bar {
    width: 0%;

    height: 100%;

    border-radius: 99px;

    background:
        linear-gradient(
            90deg,
            #9333ea,
            #ec4899
        );

    transition:
        width 0.35s ease;
}

.results {
    margin-top: 22px;

    display: grid;

    gap: 10px;
}

.file-item {
    display: flex;

    align-items: center;

    justify-content: space-between;

    gap: 15px;

    padding: 15px;

    border-radius: 15px;

    background: #151518;

    border:
        1px solid
        rgba(255,255,255,0.07);
}

.file-info {
    min-width: 0;
}

.file-name {
    font-size: 14px;

    font-weight: 700;

    overflow: hidden;

    text-overflow: ellipsis;

    white-space: nowrap;
}

.file-type {
    margin-top: 4px;

    font-size: 12px;

    color: #71717a;
}

.download-link {
    flex-shrink: 0;

    text-decoration: none;

    color: white;

    background: #27272a;

    padding:
        10px 14px;

    border-radius: 11px;

    font-size: 13px;

    font-weight: 700;

    transition: 0.2s;
}

.download-link:hover {
    background: #3f3f46;
}

.error {
    color: #fca5a5;

    line-height: 1.5;
}

.success {
    color: #86efac;
}

.features {
    display: grid;

    grid-template-columns:
        repeat(3, 1fr);

    gap: 10px;

    margin-top: 25px;
}

.feature {
    text-align: center;

    padding: 15px 8px;

    border-radius: 15px;

    background:
        rgba(255,255,255,0.035);

    color: #a1a1aa;

    font-size: 12px;

    line-height: 1.5;
}

.feature strong {
    display: block;

    color: #ffffff;

    margin-bottom: 3px;
}

.footer {
    text-align: center;

    margin-top: 20px;

    color: #52525b;

    font-size: 11px;
}

@media (max-width: 600px) {

    body {
        padding: 14px;
    }

    .card {
        padding: 25px 18px;

        border-radius: 22px;
    }

    h1 {
        font-size: 30px;
    }

    .input-row {
        flex-direction: column;
    }

    input {
        width: 100%;
    }

    button {
        min-height: 52px;
    }

    .features {
        grid-template-columns: 1fr;
    }

    .file-item {
        align-items: flex-start;

        flex-direction: column;
    }

    .download-link {
        width: 100%;

        text-align: center;
    }
}

</style>

</head>


<body>

<div class="container">

    <div class="card">

        <div class="logo">
            ◎
        </div>

        <h1>
            Instagram Downloader
        </h1>

        <p class="subtitle">
            Download Instagram Reels, videos, photos and carousels.
            Fast, simple and mobile-friendly.
        </p>


        <div class="input-row">

            <input
                id="urlInput"
                type="url"
                placeholder="Paste Instagram URL here..."
                autocomplete="off"
            >

            <button
                id="downloadButton"
                type="button"
            >
                Download
            </button>

        </div>


        <div
            id="statusBox"
            class="status-box"
        >

            <div class="status-top">

                <div
                    id="statusText"
                    class="status-text"
                >
                    Starting...
                </div>

                <div
                    id="percent"
                    class="percent"
                >
                    0%
                </div>

            </div>


            <div class="progress-track">

                <div
                    id="progressBar"
                    class="progress-bar"
                ></div>

            </div>


            <div
                id="results"
                class="results"
            ></div>

        </div>


        <div class="features">

            <div class="feature">
                <strong>Reels</strong>
                MP4 downloads
            </div>

            <div class="feature">
                <strong>Photos</strong>
                JPG / PNG / WebP
            </div>

            <div class="feature">
                <strong>Carousel</strong>
                Multiple media
            </div>

        </div>


        <div class="footer">
            Personal-use downloader
        </div>

    </div>

</div>


<script>

"use strict";


(function () {

    var currentJob = null;


    var urlInput =
        document.getElementById(
            "urlInput"
        );


    var downloadButton =
        document.getElementById(
            "downloadButton"
        );


    var statusBox =
        document.getElementById(
            "statusBox"
        );


    var statusText =
        document.getElementById(
            "statusText"
        );


    var percent =
        document.getElementById(
            "percent"
        );


    var progressBar =
        document.getElementById(
            "progressBar"
        );


    var results =
        document.getElementById(
            "results"
        );


    function setStatus(
        message,
        progress,
        type
    ) {

        statusBox.style.display =
            "block";


        statusText.textContent =
            message || "";


        var safeProgress =
            Math.max(
                0,
                Math.min(
                    100,
                    Number(progress) || 0
                )
            );


        percent.textContent =
            Math.round(
                safeProgress
            ) + "%";


        progressBar.style.width =
            safeProgress + "%";


        statusText.className =
            "status-text";


        if (type === "error") {
            statusText.className =
                "status-text error";
        }


        if (type === "success") {
            statusText.className =
                "status-text success";
        }
    }


    function formatSize(bytes) {

        var size =
            Number(bytes) || 0;


        if (size < 1024) {
            return size + " B";
        }


        if (size < 1024 * 1024) {
            return (
                size / 1024
            ).toFixed(1) +
            " KB";
        }


        if (
            size <
            1024 * 1024 * 1024
        ) {
            return (
                size /
                (1024 * 1024)
            ).toFixed(1) +
            " MB";
        }


        return (
            size /
            (1024 * 1024 * 1024)
        ).toFixed(1) +
        " GB";
    }


    function clearResults() {

        results.innerHTML = "";
    }


    function renderFiles(files) {

        clearResults();


        if (
            !Array.isArray(files) ||
            files.length === 0
        ) {
            return;
        }


        files.forEach(
            function (file, index) {

                var item =
                    document.createElement(
                        "div"
                    );


                item.className =
                    "file-item";


                var info =
                    document.createElement(
                        "div"
                    );


                info.className =
                    "file-info";


                var name =
                    document.createElement(
                        "div"
                    );


                name.className =
                    "file-name";


                name.textContent =
                    file.filename ||
                    "Instagram media " +
                    (index + 1);


                var type =
                    document.createElement(
                        "div"
                    );


                type.className =
                    "file-type";


                type.textContent =
                    (
                        file.type ===
                        "image"
                            ? "IMAGE"
                            : "MP4 VIDEO"
                    ) +
                    " • " +
                    formatSize(
                        file.size
                    );


                info.appendChild(name);

                info.appendChild(type);


                var link =
                    document.createElement(
                        "a"
                    );


                link.className =
                    "download-link";


                link.href =
                    file.downloadUrl;


                link.textContent =
                    "Save";


                link.setAttribute(
                    "download",
                    file.filename ||
                    ""
                );


                item.appendChild(info);

                item.appendChild(link);


                results.appendChild(item);
            }
        );
    }


    async function startDownload() {

        var url =
            urlInput.value.trim();


        if (!url) {

            setStatus(
                "Paste an Instagram URL first.",
                0,
                "error"
            );

            urlInput.focus();

            return;
        }


        downloadButton.disabled =
            true;


        downloadButton.textContent =
            "Starting...";


        currentJob = null;

        clearResults();


        setStatus(
            "Starting download...",
            2
        );


        try {

            var response =
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
                                url: url
                            })
                    }
                );


            var data =
                await response.json();


            if (
                !response.ok ||
                !data.ok
            ) {

                throw new Error(
                    data.error ||
                    "Could not start download."
                );
            }


            currentJob =
                data.jobId;


            setStatus(
                "Getting Instagram media...",
                5
            );


            pollJob();

        } catch (error) {

            setStatus(
                error.message ||
                "Something went wrong.",
                0,
                "error"
            );


            downloadButton.disabled =
                false;


            downloadButton.textContent =
                "Download";
        }
    }


    async function pollJob() {

        if (!currentJob) {
            return;
        }


        try {

            var response =
                await fetch(
                    "/api/status/" +
                    encodeURIComponent(
                        currentJob
                    ),
                    {
                        cache: "no-store"
                    }
                );


            var data =
                await response.json();


            if (
                !response.ok ||
                !data.ok
            ) {

                throw new Error(
                    data.error ||
                    "Could not read download status."
                );
            }


            setStatus(
                data.message ||
                "Processing...",
                data.progress || 0
            );


            if (
                data.status ===
                "completed"
            ) {

                renderFiles(
                    data.files
                );


                setStatus(
                    data.message ||
                    "Download ready!",
                    100,
                    "success"
                );


                downloadButton.disabled =
                    false;


                downloadButton.textContent =
                    "Download Again";


                return;
            }


            if (
                data.status ===
                "error"
            ) {

                setStatus(
                    data.message ||
                    "Download failed.",
                    0,
                    "error"
                );


                downloadButton.disabled =
                    false;


                downloadButton.textContent =
                    "Try Again";


                return;
            }


            setTimeout(
                pollJob,
                900
            );

        } catch (error) {

            setStatus(
                error.message ||
                "Could not check status.",
                0,
                "error"
            );


            downloadButton.disabled =
                false;


            downloadButton.textContent =
                "Try Again";
        }
    }


    downloadButton.addEventListener(
        "click",
        startDownload
    );


    urlInput.addEventListener(
        "keydown",
        function (event) {

            if (
                event.key ===
                "Enter"
            ) {
                startDownload();
            }
        }
    );


})();

</script>

</body>

</html>
`;

        res.send(html);
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
            "Instagram Downloader running on port " +
            PORT
        );

        console.log(
            "======================================"
        );

        console.log("");
    }
);
