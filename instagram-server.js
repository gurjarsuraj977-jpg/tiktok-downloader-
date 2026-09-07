const express = require("express");
const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { instagram } = require("@jerrycoder/instagram-api");

const app = express();

const PORT = process.env.PORT || 10000;

const DOWNLOAD_DIR = path.join(
    __dirname,
    "instagram-downloads"
);

const MAX_FILE_SIZE = 200 * 1024 * 1024;
const DOWNLOAD_TIMEOUT = 120000;
const FILE_EXPIRY = 5 * 60 * 1000;

app.use(express.json());

/* =========================================================
   CREATE DOWNLOAD DIRECTORY
========================================================= */

if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, {
        recursive: true
    });
}

/* =========================================================
   INSTAGRAM URL VALIDATION
========================================================= */

function isInstagramUrl(value) {
    try {
        const parsed = new URL(value);

        const hostname =
            parsed.hostname.toLowerCase();

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
   DOWNLOAD MEDIA FILE
========================================================= */

function downloadFile(
    url,
    outputPath,
    redirectCount = 0
) {
    return new Promise(
        (resolve, reject) => {

            if (redirectCount > 5) {
                return reject(
                    new Error(
                        "Too many redirects."
                    )
                );
            }

            let parsedUrl;

            try {
                parsedUrl = new URL(url);
            } catch {
                return reject(
                    new Error(
                        "Invalid media URL returned by Instagram API."
                    )
                );
            }

            const protocol =
                parsedUrl.protocol === "https:"
                    ? https
                    : http;

            const request =
                protocol.get(
                    url,
                    {
                        headers: {
                            "User-Agent":
                                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36",

                            "Accept":
                                "*/*"
                        },

                        timeout:
                            DOWNLOAD_TIMEOUT
                    },

                    response => {

                        /* -------------------------
                           HANDLE REDIRECT
                        ------------------------- */

                        if (
                            response.statusCode >= 300 &&
                            response.statusCode < 400 &&
                            response.headers.location
                        ) {

                            const redirectUrl =
                                new URL(
                                    response.headers.location,
                                    url
                                ).toString();

                            response.resume();

                            return downloadFile(
                                redirectUrl,
                                outputPath,
                                redirectCount + 1
                            )
                                .then(resolve)
                                .catch(reject);
                        }

                        /* -------------------------
                           HTTP ERROR
                        ------------------------- */

                        if (
                            response.statusCode < 200 ||
                            response.statusCode >= 300
                        ) {

                            response.resume();

                            return reject(
                                new Error(
                                    `Media server returned HTTP ${response.statusCode}`
                                )
                            );
                        }

                        /* -------------------------
                           FILE SIZE CHECK
                        ------------------------- */

                        const contentLength =
                            Number(
                                response.headers[
                                    "content-length"
                                ]
                            ) || 0;

                        if (
                            contentLength &&
                            contentLength >
                                MAX_FILE_SIZE
                        ) {

                            response.resume();

                            return reject(
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

                        let rejected =
                            false;

                        response.on(
                            "data",
                            chunk => {

                                downloadedBytes +=
                                    chunk.length;

                                if (
                                    downloadedBytes >
                                    MAX_FILE_SIZE &&
                                    !rejected
                                ) {

                                    rejected = true;

                                    response.destroy();

                                    file.destroy();

                                    try {
                                        fs.unlinkSync(
                                            outputPath
                                        );
                                    } catch {}

                                    reject(
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

                                if (rejected) {
                                    return;
                                }

                                file.close(() => {

                                    try {

                                        const stats =
                                            fs.statSync(
                                                outputPath
                                            );

                                        if (
                                            stats.size <= 0
                                        ) {

                                            return reject(
                                                new Error(
                                                    "Downloaded file is empty."
                                                )
                                            );
                                        }

                                        resolve({
                                            size:
                                                stats.size
                                        });

                                    } catch (error) {

                                        reject(error);
                                    }
                                });
                            }
                        );

                        file.on(
                            "error",
                            error => {

                                if (!rejected) {
                                    reject(error);
                                }
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

                    reject(error);
                }
            );
        }
    );
}

/* =========================================================
   EXTRACT MEDIA URL
========================================================= */

function extractMediaUrl(result) {

    if (
        result &&
        result.data &&
        typeof result.data.url === "string"
    ) {
        return result.data.url;
    }

    if (
        result &&
        typeof result.url === "string"
    ) {
        return result.url;
    }

    if (
        result &&
        result.data &&
        result.data.data &&
        typeof result.data.data.url === "string"
    ) {
        return result.data.data.url;
    }

    return null;
}

/* =========================================================
   CLEANUP OLD FILES
========================================================= */

function cleanupExpiredFiles() {

    if (
        !fs.existsSync(
            DOWNLOAD_DIR
        )
    ) {
        return;
    }

    const now =
        Date.now();

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

setInterval(
    cleanupExpiredFiles,
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
            service:
                "Instagram Downloader",
            status:
                "running"
        });
    }
);

/* =========================================================
   HOMEPAGE / DOWNLOADER UI
========================================================= */

app.get(
    "/",
    (req, res) => {

        res.send(`
<!DOCTYPE html>

<html lang="en">

<head>

<meta charset="UTF-8">

<meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
>

<title>
Instagram Downloader
</title>

<style>

* {
    box-sizing: border-box;
}

body {

    margin: 0;

    min-height: 100vh;

    display: flex;

    align-items: center;

    justify-content: center;

    padding: 20px;

    font-family:
        Arial,
        Helvetica,
        sans-serif;

    background:
        linear-gradient(
            135deg,
            #f58529,
            #dd2a7b,
            #8134af,
            #515bd4
        );
}

.container {

    width: 100%;

    max-width: 650px;

    background: white;

    border-radius: 24px;

    padding: 35px;

    box-shadow:
        0 25px 70px
        rgba(0, 0, 0, 0.25);
}

.logo {

    width: 70px;

    height: 70px;

    margin: 0 auto 20px;

    border-radius: 20px;

    display: flex;

    align-items: center;

    justify-content: center;

    font-size: 36px;

    background:
        linear-gradient(
            135deg,
            #f58529,
            #dd2a7b,
            #8134af,
            #515bd4
        );

    color: white;
}

h1 {

    text-align: center;

    margin: 0;

    font-size: 32px;

    color: #111;
}

.subtitle {

    text-align: center;

    color: #666;

    margin-top: 10px;

    margin-bottom: 30px;

    line-height: 1.5;
}

.input {

    width: 100%;

    height: 55px;

    border: 2px solid #e5e5e5;

    border-radius: 14px;

    padding: 0 16px;

    font-size: 15px;

    outline: none;

    transition: 0.2s;
}

.input:focus {

    border-color: #b92b8f;

    box-shadow:
        0 0 0 4px
        rgba(185, 43, 143, 0.1);
}

.button {

    width: 100%;

    height: 55px;

    margin-top: 15px;

    border: none;

    border-radius: 14px;

    background:
        linear-gradient(
            135deg,
            #dd2a7b,
            #8134af
        );

    color: white;

    font-size: 17px;

    font-weight: bold;

    cursor: pointer;

    transition: 0.2s;
}

.button:hover {

    transform:
        translateY(-1px);

    box-shadow:
        0 8px 20px
        rgba(129, 52, 175, 0.3);
}

.button:disabled {

    opacity: 0.6;

    cursor: not-allowed;

    transform: none;
}

.status {

    display: none;

    margin-top: 20px;

    padding: 16px;

    border-radius: 12px;

    text-align: center;

    line-height: 1.5;
}

.status.loading {

    display: block;

    background: #f3f4f6;

    color: #333;
}

.status.success {

    display: block;

    background: #ecfdf3;

    color: #087443;
}

.status.error {

    display: block;

    background: #fff1f2;

    color: #b42318;
}

.download-link {

    display: none;

    width: 100%;

    margin-top: 15px;

    padding: 16px;

    border-radius: 14px;

    text-align: center;

    text-decoration: none;

    background: #111;

    color: white;

    font-weight: bold;
}

.download-link.show {

    display: block;
}

.footer {

    text-align: center;

    color: #999;

    font-size: 12px;

    margin-top: 25px;
}

.spinner {

    display: inline-block;

    width: 16px;

    height: 16px;

    border: 2px solid #ddd;

    border-top-color: #8134af;

    border-radius: 50%;

    animation:
        spin 0.8s linear infinite;

    vertical-align: middle;

    margin-right: 7px;
}

@keyframes spin {

    to {
        transform:
            rotate(360deg);
    }
}

</style>

</head>

<body>

<div class="container">

    <div class="logo">
        ◎
    </div>

    <h1>
        Instagram Downloader
    </h1>

    <div class="subtitle">
        Download public Instagram Reels
        and posts quickly.
    </div>

    <input
        id="url"
        class="input"
        type="url"
        placeholder="Paste Instagram URL here..."
        autocomplete="off"
    >

    <button
        id="downloadButton"
        class="button"
        onclick="downloadInstagram()"
    >
        Download
    </button>

    <div
        id="status"
        class="status"
    ></div>

    <a
        id="downloadLink"
        class="download-link"
        href="#"
    >
        ⬇ Download File
    </a>

    <div class="footer">
        Public Instagram URLs only.
    </div>

</div>

<script>

async function downloadInstagram() {

    const input =
        document.getElementById(
            "url"
        );

    const button =
        document.getElementById(
            "downloadButton"
        );

    const status =
        document.getElementById(
            "status"
        );

    const downloadLink =
        document.getElementById(
            "downloadLink"
        );

    const url =
        input.value.trim();

    /* -------------------------
       RESET
    ------------------------- */

    status.className =
        "status";

    status.innerHTML =
        "";

    downloadLink.classList.remove(
        "show"
    );

    downloadLink.href =
        "#";

    /* -------------------------
       VALIDATE
    ------------------------- */

    if (!url) {

        status.className =
            "status error";

        status.innerHTML =
            "Please paste an Instagram URL.";

        return;
    }

    if (
        !url.includes(
            "instagram.com"
        )
    ) {

        status.className =
            "status error";

        status.innerHTML =
            "Please enter a valid Instagram URL.";

        return;
    }

    /* -------------------------
       LOADING
    ------------------------- */

    button.disabled =
        true;

    button.innerText =
        "Processing...";

    status.className =
        "status loading";

    status.innerHTML =
        '<span class="spinner"></span>' +
        "Fetching Instagram media...";

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

                    body: JSON.stringify({
                        url: url
                    })
                }
            );

        let data;

        try {

            data =
                await response.json();

        } catch {

            throw new Error(
                "Server returned an invalid response."
            );
        }

        if (
            !response.ok ||
            !data.ok
        ) {

            throw new Error(
                data.error ||
                "Instagram download failed."
            );
        }

        /* -------------------------
           SUCCESS
        ------------------------- */

        status.className =
            "status success";

        status.innerHTML =
            "✅ Media is ready!";

        downloadLink.href =
            data.downloadUrl;

        downloadLink.download =
            data.filename || "";

        downloadLink.classList.add(
            "show"
        );

        button.innerText =
            "Download Again";

    } catch (error) {

        console.error(
            error
        );

        status.className =
            "status error";

        status.innerHTML =
            "❌ " +
            (
                error.message ||
                "Something went wrong."
            );

        button.innerText =
            "Try Again";

    } finally {

        button.disabled =
            false;
    }
}

document
    .getElementById("url")
    .addEventListener(
        "keydown",
        event => {

            if (
                event.key ===
                "Enter"
            ) {

                downloadInstagram();
            }
        }
    );

</script>

</body>

</html>
`);
    }
);

/* =========================================================
   INSTAGRAM DOWNLOAD API
========================================================= */

app.post(
    "/api/download",
    async (req, res) => {

        try {

            const url =
                typeof req.body.url === "string"
                    ? req.body.url.trim()
                    : "";

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

            console.log(url);

            /* -------------------------
               EMPTY URL
            ------------------------- */

            if (!url) {

                return res.status(400).json({
                    ok: false,
                    error:
                        "Please provide an Instagram URL."
                });
            }

            /* -------------------------
               URL VALIDATION
            ------------------------- */

            if (
                !isInstagramUrl(url)
            ) {

                return res.status(400).json({
                    ok: false,
                    error:
                        "Please provide a valid Instagram URL."
                });
            }

            console.log(
                "Fetching Instagram media information..."
            );

            /* -------------------------
               CALL INSTAGRAM API
            ------------------------- */

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

            /* -------------------------
               EXTRACT MEDIA URL
            ------------------------- */

            const mediaUrl =
                extractMediaUrl(
                    result
                );

            if (!mediaUrl) {

                return res.status(502).json({
                    ok: false,
                    error:
                        "Instagram API did not return a downloadable media URL."
                });
            }

            console.log(
                "Media URL received."
            );

            /* -------------------------
               CREATE FILE NAME
            ------------------------- */

            const id =
                crypto
                    .randomBytes(12)
                    .toString("hex");

            const filename =
                `instagram-${id}.mp4`;

            const outputPath =
                path.join(
                    DOWNLOAD_DIR,
                    filename
                );

            /* -------------------------
               DOWNLOAD MEDIA
            ------------------------- */

            console.log(
                "Downloading Instagram media..."
            );

            const downloadResult =
                await downloadFile(
                    mediaUrl,
                    outputPath
                );

            console.log(
                "Instagram media downloaded:",
                downloadResult.size,
                "bytes"
            );

            /* -------------------------
               RETURN DOWNLOAD URL
            ------------------------- */

            const downloadUrl =
                `/api/file/${encodeURIComponent(
                    filename
                )}`;

            console.log(
                "Instagram download ready."
            );

            return res.json({

                ok: true,

                platform:
                    "Instagram",

                filename:
                    filename,

                size:
                    downloadResult.size,

                downloadUrl:
                    downloadUrl
            });

        } catch (error) {

            console.error("");

            console.error(
                "INSTAGRAM ERROR:"
            );

            console.error(
                error
            );

            return res.status(500).json({

                ok: false,

                error:
                    error.message ||
                    "Instagram download failed."
            });
        }
    }
);

/* =========================================================
   FILE DOWNLOAD ROUTE
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

            return res
                .status(404)
                .send(
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
