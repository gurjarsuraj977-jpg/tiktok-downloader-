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
   FILE HELPERS
========================================================= */

function safeUnlink(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    } catch {}
}


function getExtensionFromContentType(contentType) {
    if (!contentType) {
        return ".mp4";
    }

    const type = contentType.toLowerCase();

    if (type.includes("image/jpeg")) {
        return ".jpg";
    }

    if (type.includes("image/png")) {
        return ".png";
    }

    if (type.includes("image/webp")) {
        return ".webp";
    }

    if (type.includes("image/gif")) {
        return ".gif";
    }

    if (type.includes("video/mp4")) {
        return ".mp4";
    }

    if (type.includes("video/webm")) {
        return ".webm";
    }

    if (type.includes("video/quicktime")) {
        return ".mov";
    }

    return ".mp4";
}


/* =========================================================
   DOWNLOAD REMOTE FILE
========================================================= */

function downloadFile(url, outputPath) {
    return new Promise((resolve, reject) => {
        let finished = false;

        function fail(error) {
            if (finished) {
                return;
            }

            finished = true;

            safeUnlink(outputPath);

            reject(error);
        }

        function complete(result) {
            if (finished) {
                return;
            }

            finished = true;
            resolve(result);
        }

        let parsedUrl;

        try {
            parsedUrl = new URL(url);
        } catch {
            return fail(new Error("Invalid media URL."));
        }

        const protocol =
            parsedUrl.protocol === "https:"
                ? https
                : http;

        const request = protocol.get(
            url,
            {
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36",

                    "Accept":
                        "*/*",

                    "Accept-Encoding":
                        "identity"
                },

                timeout: DOWNLOAD_TIMEOUT
            },

            response => {

                if (
                    response.statusCode >= 300 &&
                    response.statusCode < 400 &&
                    response.headers.location
                ) {
                    response.resume();

                    return downloadFile(
                        response.headers.location,
                        outputPath
                    )
                        .then(complete)
                        .catch(fail);
                }


                if (
                    response.statusCode < 200 ||
                    response.statusCode >= 300
                ) {
                    response.resume();

                    return fail(
                        new Error(
                            "Media server returned HTTP " +
                            response.statusCode
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

                    return fail(
                        new Error(
                            "Instagram media is larger than the 200 MB limit."
                        )
                    );
                }


                const contentType =
                    response.headers["content-type"] || "";


                const file =
                    fs.createWriteStream(outputPath);


                let downloadedBytes = 0;


                response.on(
                    "data",
                    chunk => {

                        downloadedBytes +=
                            chunk.length;


                        if (
                            downloadedBytes >
                            MAX_FILE_SIZE
                        ) {
                            response.destroy();
                            file.destroy();

                            return fail(
                                new Error(
                                    "Downloaded file exceeded the 200 MB limit."
                                )
                            );
                        }
                    }
                );


                response.pipe(file);


                file.on(
                    "finish",
                    () => {

                        file.close(
                            () => {

                                try {

                                    if (
                                        !fs.existsSync(
                                            outputPath
                                        )
                                    ) {
                                        return fail(
                                            new Error(
                                                "Downloaded file was not created."
                                            )
                                        );
                                    }


                                    const stats =
                                        fs.statSync(
                                            outputPath
                                        );


                                    if (
                                        stats.size <= 0
                                    ) {
                                        return fail(
                                            new Error(
                                                "Downloaded file is empty."
                                            )
                                        );
                                    }


                                    complete({
                                        size:
                                            stats.size,

                                        contentType:
                                            contentType
                                    });

                                } catch (
                                    error
                                ) {
                                    fail(error);
                                }
                            }
                        );
                    }
                );


                file.on(
                    "error",
                    error => {
                        fail(error);
                    }
                );
            }
        );


        request.on(
            "timeout",
            () => {

                request.destroy(
                    new Error(
                        "Instagram download timed out."
                    )
                );
            }
        );


        request.on(
            "error",
            error => {
                fail(error);
            }
        );
    });
}


/* =========================================================
   MEDIA URL EXTRACTION
========================================================= */

function looksLikeHttpUrl(value) {
    return (
        typeof value === "string" &&
        /^https?:\/\//i.test(value)
    );
}


function collectMediaUrls(
    value,
    keyName,
    output,
    seen
) {
    if (!value) {
        return;
    }


    if (
        typeof value === "string"
    ) {

        if (
            looksLikeHttpUrl(value)
        ) {

            const key =
                String(
                    keyName || ""
                ).toLowerCase();


            const mediaKey =
                key.includes("url") ||
                key.includes("video") ||
                key.includes("image") ||
                key.includes("media") ||
                key.includes("download") ||
                key.includes("src") ||
                key.includes("photo") ||
                key.includes("thumbnail");


            const obviousMedia =
                /\.(mp4|m4v|mov|webm|jpg|jpeg|png|webp)(\?|$)/i
                    .test(value) ||

                value.includes("fbcdn") ||

                value.includes("cdninstagram");


            if (
                mediaKey ||
                obviousMedia
            ) {
                if (
                    !seen.has(value)
                ) {
                    seen.add(value);
                    output.push(value);
                }
            }
        }

        return;
    }


    if (
        Array.isArray(value)
    ) {

        for (
            const item of value
        ) {

            collectMediaUrls(
                item,
                keyName,
                output,
                seen
            );
        }

        return;
    }


    if (
        typeof value === "object"
    ) {

        for (
            const key of Object.keys(value)
        ) {

            collectMediaUrls(
                value[key],
                key,
                output,
                seen
            );
        }
    }
}


function extractMediaUrls(result) {

    const urls = [];
    const seen = new Set();


    /*
       These are the most important known locations
       from @jerrycoder/instagram-api.
    */

    if (
        result &&
        result.data &&
        typeof result.data.url === "string"
    ) {

        if (
            looksLikeHttpUrl(
                result.data.url
            )
        ) {
            seen.add(
                result.data.url
            );

            urls.push(
                result.data.url
            );
        }
    }


    if (
        result &&
        typeof result.url === "string"
    ) {

        if (
            looksLikeHttpUrl(
                result.url
            ) &&
            !seen.has(result.url)
        ) {

            seen.add(
                result.url
            );

            urls.push(
                result.url
            );
        }
    }


    /*
       Search the rest of the response
       for carousel/media URLs.
    */

    collectMediaUrls(
        result,
        "",
        urls,
        seen
    );


    return urls.slice(0, 20);
}


/* =========================================================
   FFMPEG
========================================================= */

function convertVideoToMp4(
    inputPath,
    outputPath,
    job
) {

    return new Promise(
        (resolve, reject) => {

            if (!ffmpegPath) {
                return reject(
                    new Error(
                        "FFmpeg is not available."
                    )
                );
            }


            job.status =
                "converting";

            job.progress = 70;


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


            console.log(
                "Starting FFmpeg conversion..."
            );


            const ffmpeg =
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


            ffmpeg.stderr.on(
                "data",
                chunk => {

                    stderr +=
                        chunk.toString();

                    /*
                       FFmpeg progress is not always
                       available in a simple percentage.
                       We keep the UI moving during conversion.
                    */

                    if (
                        job.progress < 90
                    ) {
                        job.progress += 1;
                    }
                }
            );


            ffmpeg.on(
                "error",
                error => {
                    reject(error);
                }
            );


            ffmpeg.on(
                "close",
                code => {

                    if (
                        code !== 0
                    ) {

                        return reject(
                            new Error(
                                "FFmpeg conversion failed: " +
                                stderr.slice(-500)
                            )
                        );
                    }


                    if (
                        !fs.existsSync(
                            outputPath
                        )
                    ) {

                        return reject(
                            new Error(
                                "FFmpeg did not create the MP4 file."
                            )
                        );
                    }


                    const stats =
                        fs.statSync(
                            outputPath
                        );


                    if (
                        stats.size <= 0
                    ) {

                        return reject(
                            new Error(
                                "Converted MP4 file is empty."
                            )
                        );
                    }


                    job.progress =
                        95;


                    resolve({
                        size:
                            stats.size
                    });
                }
            );
        }
    );
}


/* =========================================================
   JOB PROCESSING
========================================================= */

async function processInstagramJob(
    jobId,
    instagramUrl
) {

    const job =
        jobs.get(jobId);


    if (!job) {
        return;
    }


    try {

        job.status =
            "fetching";

        job.progress =
            5;

        job.message =
            "Fetching Instagram media...";


        console.log("");
        console.log(
            "================================="
        );
        console.log(
            "Instagram download request"
        );
        console.log(
            "================================="
        );
        console.log(
            instagramUrl
        );


        const result =
            await instagram(
                instagramUrl
            );


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


        const mediaUrls =
            extractMediaUrls(
                result
            );


        console.log(
            "Media URLs found:",
            mediaUrls.length
        );


        if (
            mediaUrls.length === 0
        ) {

            throw new Error(
                "Instagram API did not return a downloadable media URL."
            );
        }


        job.total =
            mediaUrls.length;


        job.status =
            "downloading";


        job.progress =
            10;


        const files = [];


        /*
           Download every discovered media item.
        */

        for (
            let i = 0;
            i < mediaUrls.length;
            i++
        ) {

            const itemNumber =
                i + 1;


            job.current =
                itemNumber;


            job.message =
                "Downloading item " +
                itemNumber +
                " of " +
                mediaUrls.length +
                "...";


            const temporaryName =
                "temp-" +
                jobId +
                "-" +
                itemNumber;


            const tempPath =
                path.join(
                    TEMP_DIR,
                    temporaryName
                );


            const downloaded =
                await downloadFile(
                    mediaUrls[i],
                    tempPath
                );


            const extension =
                getExtensionFromContentType(
                    downloaded.contentType
                );


            const isImage =
                downloaded.contentType &&
                downloaded.contentType
                    .toLowerCase()
                    .startsWith(
                        "image/"
                    );


            let finalFilename;


            if (
                isImage
            ) {

                finalFilename =
                    "instagram-" +
                    jobId +
                    "-" +
                    itemNumber +
                    extension;

            } else {

                finalFilename =
                    "instagram-" +
                    jobId +
                    "-" +
                    itemNumber +
                    ".mp4";
            }


            const finalPath =
                path.join(
                    DOWNLOAD_DIR,
                    finalFilename
                );


            /*
               Convert video to universally compatible
               H.264/AAC MP4.
            */

            if (
                !isImage
            ) {

                job.status =
                    "converting";

                job.message =
                    "Optimizing video " +
                    itemNumber +
                    "...";


                await convertVideoToMp4(
                    tempPath,
                    finalPath,
                    job
                );


                safeUnlink(
                    tempPath
                );

            } else {

                fs.renameSync(
                    tempPath,
                    finalPath
                );
            }


            let finalSize =
                0;


            try {

                finalSize =
                    fs.statSync(
                        finalPath
                    ).size;

            } catch {}


            files.push({
                filename:
                    finalFilename,

                size:
                    finalSize,

                type:
                    isImage
                        ? "image"
                        : "video",

                downloadUrl:
                    "/api/file/" +
                    encodeURIComponent(
                        finalFilename
                    )
            });


            const completedPercent =
                10 +
                Math.round(
                    ((i + 1) /
                        mediaUrls.length) *
                    85
                );


            job.progress =
                Math.min(
                    completedPercent,
                    95
                );
        }


        if (
            files.length === 0
        ) {

            throw new Error(
                "No downloadable media was created."
            );
        }


        job.status =
            "completed";

        job.progress =
            100;

        job.message =
            "Download ready!";

        job.files =
            files;

        job.filename =
            files[0].filename;

        job.downloadUrl =
            files[0].downloadUrl;

        job.finishedAt =
            Date.now();


        console.log(
            "Instagram download completed."
        );


    } catch (error) {

        console.error(
            "INSTAGRAM JOB ERROR:"
        );

        console.error(
            error
        );


        job.status =
            "error";

        job.progress =
            0;

        job.message =
            error.message ||
            "Instagram download failed.";

        job.error =
            error.message ||
            "Instagram download failed.";

        job.finishedAt =
            Date.now();
    }
}


/* =========================================================
   CLEANUP
========================================================= */

function cleanupExpiredFiles() {

    const now =
        Date.now();


    if (
        fs.existsSync(
            DOWNLOAD_DIR
        )
    ) {

        for (
            const fileName of
            fs.readdirSync(
                DOWNLOAD_DIR
            )
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


    if (
        fs.existsSync(
            TEMP_DIR
        )
    ) {

        for (
            const fileName of
            fs.readdirSync(
                TEMP_DIR
            )
        ) {

            const filePath =
                path.join(
                    TEMP_DIR,
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
                }

            } catch {}
        }
    }


    for (
        const [
            jobId,
            job
        ] of jobs.entries()
    ) {

        const created =
            job.createdAt || now;


        if (
            now -
            created >
            JOB_EXPIRY
        ) {

            jobs.delete(
                jobId
            );
        }
    }
}


setInterval(
    cleanupExpiredFiles,
    60 * 1000
);


/* =========================================================
   HEALTH
========================================================= */

app.get(
    "/api/health",
    (req, res) => {

        res.json({
            ok: true,
            service:
                "Instagram Downloader",
            status:
                "running"
        });
    }
);


/* =========================================================
   MAIN DOWNLOAD API
========================================================= */

app.post(
    "/api/download",
    async (req, res) => {

        try {

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


            if (
                !isInstagramUrl(url)
            ) {

                return res.status(400).json({
                    ok: false,
                    error:
                        "Please provide a valid Instagram URL."
                });
            }


            const jobId =
                crypto
                    .randomBytes(16)
                    .toString("hex");


            const job = {

                id:
                    jobId,

                status:
                    "queued",

                progress:
                    0,

                message:
                    "Starting download...",

                current:
                    0,

                total:
                    1,

                files:
                    [],

                createdAt:
                    Date.now()
            };


            jobs.set(
                jobId,
                job
            );


            processInstagramJob(
                jobId,
                url
            );


            return res.status(202).json({

                ok:
                    true,

                jobId:
                    jobId,

                status:
                    "queued",

                statusUrl:
                    "/api/status/" +
                    encodeURIComponent(
                        jobId
                    )
            });


        } catch (error) {

            console.error(
                "DOWNLOAD API ERROR:",
                error
            );


            return res.status(500).json({

                ok:
                    false,

                error:
                    error.message ||
                    "Instagram download failed."
            });
        }
    }
);


/* =========================================================
   JOB STATUS API
========================================================= */

app.get(
    "/api/status/:jobId",
    (req, res) => {

        const jobId =
            String(
                req.params.jobId
            );


        const job =
            jobs.get(
                jobId
            );


        if (!job) {

            return res.status(404).json({

                ok:
                    false,

                error:
                    "Download job not found or expired."
            });
        }


        return res.json({

            ok:
                true,

            jobId:
                job.id,

            status:
                job.status,

            progress:
                job.progress,

            message:
                job.message,

            current:
                job.current,

            total:
                job.total,

            files:
                job.files || [],

            filename:
                job.filename || null,

            downloadUrl:
                job.downloadUrl || null,

            error:
                job.error || null
        });
    }
);


/* =========================================================
   FILE DOWNLOAD
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
        Helvetica,
        sans-serif;

    background:
        radial-gradient(
            circle at top,
            #2b123f 0%,
            #100b19 40%,
            #07070b 100%
        );

    color: #ffffff;

    display: flex;
    align-items: center;
    justify-content: center;

    padding: 25px;
}

.container {
    width: 100%;
    max-width: 760px;
}

.card {
    background: rgba(20, 18, 28, 0.88);

    border:
        1px solid
        rgba(255, 255, 255, 0.10);

    border-radius: 28px;

    padding: 38px;

    box-shadow:
        0 30px 90px
        rgba(0, 0, 0, 0.55);

    backdrop-filter: blur(20px);
}

.logo {
    width: 72px;
    height: 72px;

    border-radius: 22px;

    margin: 0 auto 22px;

    display: flex;
    align-items: center;
    justify-content: center;

    font-size: 34px;

    background:
        linear-gradient(
            135deg,
            #833ab4,
            #fd1d1d,
            #fcb045
        );

    box-shadow:
        0 15px 40px
        rgba(253, 29, 29, 0.25);
}

h1 {
    text-align: center;

    margin:
        0 0 10px;

    font-size:
        clamp(30px, 7vw, 52px);

    letter-spacing:
        -1.5px;
}

.subtitle {
    text-align: center;

    color:
        #a9a5b4;

    font-size:
        16px;

    margin-bottom:
        32px;

    line-height:
        1.6;
}

.input-area {
    display: flex;

    gap: 12px;

    background:
        rgba(255,255,255,0.06);

    padding: 8px;

    border-radius: 18px;

    border:
        1px solid
        rgba(255,255,255,0.08);
}

input {
    flex: 1;

    min-width: 0;

    background:
        transparent;

    border: 0;

    outline: 0;

    color:
        white;

    padding:
        15px 14px;

    font-size:
        15px;
}

input::placeholder {
    color:
        #77727f;
}

button {
    border: 0;

    cursor: pointer;

    border-radius: 14px;

    padding:
        14px 22px;

    font-size:
        15px;

    font-weight:
        700;

    color:
        white;

    background:
        linear-gradient(
            135deg,
            #833ab4,
            #fd1d1d
        );

    transition:
        transform .2s ease,
        opacity .2s ease;
}

button:hover {
    transform:
        translateY(-2px);
}

button:disabled {
    opacity:
        0.55;

    cursor:
        not-allowed;

    transform:
        none;
}

.progress-box {
    display:
        none;

    margin-top:
        28px;

    padding:
        22px;

    border-radius:
        20px;

    background:
        rgba(255,255,255,0.045);

    border:
        1px solid
        rgba(255,255,255,0.07);
}

.progress-top {
    display:
        flex;

    justify-content:
        space-between;

    gap:
        15px;

    margin-bottom:
        12px;
}

.progress-text {
    color:
        #c5c1cc;

    font-size:
        14px;
}

.percent {
    font-weight:
        800;
}

.progress-track {
    height:
        10px;

    border-radius:
        999px;

    overflow:
        hidden;

    background:
        rgba(255,255,255,0.08);
}

.progress-bar {
    width:
        0%;

    height:
        100%;

    border-radius:
        inherit;

    background:
        linear-gradient(
            90deg,
            #833ab4,
            #fd1d1d,
            #fcb045
        );

    transition:
        width .35s ease;
}

.message {
    margin-top:
        13px;

    color:
        #a9a5b4;

    font-size:
        14px;
}

.result {
    display:
        none;

    margin-top:
        24px;
}

.result-title {
    font-size:
        18px;

    font-weight:
        800;

    margin-bottom:
        14px;
}

.file-list {
    display:
        flex;

    flex-direction:
        column;

    gap:
        10px;
}

.file-item {
    display:
        flex;

    align-items:
        center;

    justify-content:
        space-between;

    gap:
        15px;

    padding:
        15px;

    border-radius:
        16px;

    background:
        rgba(255,255,255,0.05);

    border:
        1px solid
        rgba(255,255,255,0.07);
}

.file-info {
    overflow:
        hidden;
}

.file-name {
    font-weight:
        700;

    overflow:
        hidden;

    text-overflow:
        ellipsis;

    white-space:
        nowrap;
}

.file-type {
    color:
        #8e8996;

    font-size:
        12px;

    margin-top:
        4px;
}

.download-button {
    flex-shrink:
        0;

    text-decoration:
        none;

    display:
        inline-flex;

    align-items:
        center;

    justify-content:
        center;

    padding:
        10px 16px;

    border-radius:
        12px;

    background:
        rgba(255,255,255,0.10);

    color:
        white;

    font-weight:
        700;

    font-size:
        13px;
}

.download-button:hover {
    background:
        rgba(255,255,255,0.16);
}

.error {
    color:
        #ff7b8b;
}

.success {
    color:
        #72e6a3;
}

.footer {
    text-align:
        center;

    margin-top:
        24px;

    color:
        #6f6a76;

    font-size:
        12px;
}

@media (max-width: 600px) {

    body {
        padding:
            14px;
    }

    .card {
        padding:
            24px 18px;

        border-radius:
            22px;
    }

    .input-area {
        flex-direction:
            column;

        background:
            transparent;

        border:
            0;

        padding:
            0;
    }

    input {
        background:
            rgba(255,255,255,0.06);

        border:
            1px solid
            rgba(255,255,255,0.08);

        border-radius:
            14px;

        padding:
            16px;
    }

    button {
        width:
            100%;
    }

    .file-item {
        align-items:
            flex-start;

        flex-direction:
            column;
    }

    .download-button {
        width:
            100%;
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

<div class="subtitle">
    Download public Instagram videos, reels and photos in a few clicks.
</div>

<div class="input-area">

<input
    id="url"
    type="url"
    placeholder="Paste Instagram URL here..."
    autocomplete="off"
>

<button
    id="downloadBtn"
    onclick="startDownload()"
>
    Download
</button>

</div>

<div
    id="progressBox"
    class="progress-box"
>

<div class="progress-top">

<div
    id="progressText"
    class="progress-text"
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
    id="message"
    class="message"
>
    Preparing your download...
</div>

</div>

<div
    id="result"
    class="result"
>

<div class="result-title">
    Your files are ready
</div>

<div
    id="fileList"
    class="file-list"
></div>

</div>

<div class="footer">
    Personal-use downloader • Files are automatically cleaned up
</div>

</div>

</div>


<script>

var currentJob = null;
var polling = false;


function escapeHtml(text) {

    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


function setProgress(
    value,
    text
) {

    var safeValue =
        Math.max(
            0,
            Math.min(
                100,
                Number(value) || 0
            )
        );


    document.getElementById(
        "percent"
    ).textContent =
        Math.round(
            safeValue
        ) + "%";


    document.getElementById(
        "progressBar"
    ).style.width =
        safeValue + "%";


    if (text) {

        document.getElementById(
            "progressText"
        ).textContent =
            text;
    }
}


function showError(text) {

    document.getElementById(
        "progressBox"
    ).style.display =
        "block";


    document.getElementById(
        "message"
    ).innerHTML =
        "<span class=\"error\">❌ " +
        escapeHtml(text) +
        "</span>";
}


function showSuccess(text) {

    document.getElementById(
        "message"
    ).innerHTML =
        "<span class=\"success\">✓ " +
        escapeHtml(text) +
        "</span>";
}


function renderFiles(files) {

    var result =
        document.getElementById(
            "result"
        );


    var list =
        document.getElementById(
            "fileList"
        );


    list.innerHTML =
        "";


    files.forEach(
        function(file, index) {

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
                "Instagram file " +
                (index + 1);


            var type =
                document.createElement(
                    "div"
                );

            type.className =
                "file-type";

            type.textContent =
                file.type === "image"
                    ? "IMAGE"
                    : "MP4 VIDEO";


            info.appendChild(
                name
            );

            info.appendChild(
                type
            );


            var link =
                document.createElement(
                    "a"
                );

            link.className =
                "download-button";

            link.href =
                file.downloadUrl;

            link.download =
                file.filename ||
                "instagram-download";

            link.textContent =
                "Download";


            item.appendChild(
                info
            );

            item.appendChild(
                link
            );


            list.appendChild(
                item
            );
        }
    );


    result.style.display =
        "block";
}


async function startDownload() {

    if (polling) {
        return;
    }


    var input =
        document.getElementById(
            "url"
        );


    var button =
        document.getElementById(
            "downloadBtn"
        );


    var url =
        input.value.trim();


    if (!url) {

        showError(
            "Please paste an Instagram URL."
        );

        return;
    }


    document.getElementById(
        "result"
    ).style.display =
        "none";


    document.getElementById(
        "fileList"
    ).innerHTML =
        "";


    document.getElementById(
        "progressBox"
    ).style.display =
        "block";


    setProgress(
        0,
        "Starting..."
    );


    button.disabled =
        true;

    button.textContent =
        "Processing...";


    polling =
        true;


    try {

        var response =
            await fetch(
                "/api/download",
                {
                    method:
                        "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify({
                            url:
                                url
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
                "Download could not be started."
            );
        }


        currentJob =
            data.jobId;


        await pollJob();


    } catch (error) {

        showError(
            error.message ||
            "Something went wrong."
        );

    } finally {

        polling =
            false;

        button.disabled =
            false;

        button.textContent =
            "Download";
    }
}


async function pollJob() {

    while (
        currentJob
    ) {

        var response =
            await fetch(
                "/api/status/" +
                encodeURIComponent(
                    currentJob
                )
            );


        var data =
            await response.json();


        if (
            !response.ok ||
            !data.ok
        ) {

            throw new Error(
                data.error ||
                "Unable to check download status."
            );
        }


        setProgress(
            data.progress,
            getStatusText(
                data.status
            )
        );


        if (
            data.message
        ) {

            document.getElementById(
                "message"
            ).textContent =
                data.message;
        }


        if (
            data.status ===
            "completed"
        ) {

            setProgress(
                100,
                "Complete"
            );


            showSuccess(
                "Your download is ready."
            );


            renderFiles(
                data.files || []
            );


            currentJob =
                null;

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


        await sleep(
            900
        );
    }
}


function getStatusText(
    status
) {

    if (
        status ===
        "queued"
    ) {
        return "Queued";
    }

    if (
        status ===
        "fetching"
    ) {
        return "Fetching media";
    }

    if (
        status ===
        "downloading"
    ) {
        return "Downloading";
    }

    if (
        status ===
        "converting"
    ) {
        return "Optimizing video";
    }

    if (
        status ===
        "completed"
    ) {
        return "Complete";
    }

    if (
        status ===
        "error"
    ) {
        return "Error";
    }

    return "Processing";
}


function sleep(
    milliseconds
) {

    return new Promise(
        function(resolve) {

            setTimeout(
                resolve,
                milliseconds
            );
        }
    );
}


document
    .getElementById("url")
    .addEventListener(
        "keydown",
        function(event) {

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
   SERVER
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
    }
);
