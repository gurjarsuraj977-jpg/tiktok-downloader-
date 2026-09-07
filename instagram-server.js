const express = require("express");
const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { instagram } = require("@jerrycoder/instagram-api");

const app = express();

const PORT = process.env.PORT || 3000;

const DOWNLOAD_DIR = path.join(__dirname, "instagram-downloads");

const MAX_FILE_SIZE = 200 * 1024 * 1024;
const DOWNLOAD_TIMEOUT = 120000;
const FILE_EXPIRY = 5 * 60 * 1000;

app.use(express.json());

/* =========================================
   CREATE DOWNLOAD DIRECTORY
========================================= */

if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

/* =========================================
   VALIDATE INSTAGRAM URL
========================================= */

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

/* =========================================
   DOWNLOAD FILE
========================================= */

function downloadFile(url, outputPath) {
    return new Promise((resolve, reject) => {

        const parsedUrl = new URL(url);

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

                    return downloadFile(
                        response.headers.location,
                        outputPath
                    )
                        .then(resolve)
                        .catch(reject);
                }

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

                const contentLength =
                    Number(response.headers["content-length"]) || 0;

                if (
                    contentLength &&
                    contentLength > MAX_FILE_SIZE
                ) {
                    response.resume();

                    return reject(
                        new Error(
                            "Instagram media is larger than the 200 MB limit."
                        )
                    );
                }

                const file = fs.createWriteStream(outputPath);

                let downloadedBytes = 0;

                response.on("data", chunk => {

                    downloadedBytes += chunk.length;

                    if (downloadedBytes > MAX_FILE_SIZE) {

                        response.destroy();

                        file.destroy();

                        try {
                            fs.unlinkSync(outputPath);
                        } catch {}

                        reject(
                            new Error(
                                "Downloaded file exceeded the 200 MB limit."
                            )
                        );
                    }
                });

                response.pipe(file);

                file.on("finish", () => {

                    file.close(() => {

                        const size =
                            fs.statSync(outputPath).size;

                        if (size <= 0) {
                            return reject(
                                new Error(
                                    "Downloaded file is empty."
                                )
                            );
                        }

                        resolve({
                            size
                        });
                    });
                });

                file.on("error", error => {
                    reject(error);
                });
            }
        );

        request.on("timeout", () => {
            request.destroy(
                new Error("Instagram download timed out.")
            );
        });

        request.on("error", error => {
            reject(error);
        });
    });
}

/* =========================================
   CLEAN OLD FILES
========================================= */

function cleanupExpiredFiles() {

    if (!fs.existsSync(DOWNLOAD_DIR)) {
        return;
    }

    const now = Date.now();

    for (const fileName of fs.readdirSync(DOWNLOAD_DIR)) {

        const filePath =
            path.join(DOWNLOAD_DIR, fileName);

        try {

            const stats =
                fs.statSync(filePath);

            if (
                now - stats.mtimeMs >
                FILE_EXPIRY
            ) {
                fs.unlinkSync(filePath);

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

/* =========================================
   HEALTH CHECK
========================================= */

app.get("/api/health", (req, res) => {

    res.json({
        ok: true,
        service: "Instagram Downloader",
        status: "running"
    });

});

/* =========================================
   INSTAGRAM DOWNLOAD API
========================================= */

app.post("/api/download", async (req, res) => {

    try {

        const url =
            typeof req.body.url === "string"
                ? req.body.url.trim()
                : "";

        console.log("");
        console.log("=================================");
        console.log("Instagram download request");
        console.log("=================================");
        console.log(url);

        if (!url) {

            return res.status(400).json({
                ok: false,
                error: "Please provide an Instagram URL."
            });

        }

        if (!isInstagramUrl(url)) {

            return res.status(400).json({
                ok: false,
                error: "Please provide a valid Instagram URL."
            });

        }

        console.log(
            "Fetching Instagram media information..."
        );

        const result =
            await instagram(url);

        console.log("");
        console.log("Instagram API response:");
        console.log(
            JSON.stringify(result, null, 2)
        );

        /* =====================================
           FIND MEDIA URL
        ===================================== */

        let mediaUrl = null;

        if (
            result &&
            result.data &&
            typeof result.data.url === "string"
        ) {
            mediaUrl = result.data.url;
        }

        if (
            !mediaUrl &&
            result &&
            typeof result.url === "string"
        ) {
            mediaUrl = result.url;
        }

        if (!mediaUrl) {

            return res.status(502).json({
                ok: false,
                error:
                    "Instagram API did not return a downloadable media URL."
            });

        }

        console.log("");
        console.log(
            "Downloading Instagram media..."
        );

        const id =
            crypto.randomBytes(12).toString("hex");

        const filename =
            `instagram-${id}.mp4`;

        const outputPath =
            path.join(
                DOWNLOAD_DIR,
                filename
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

        const downloadUrl =
            `/api/file/${encodeURIComponent(filename)}`;

        console.log(
            "Instagram download ready."
        );

        return res.json({

            ok: true,

            platform: "Instagram",

            filename,

            size: downloadResult.size,

            downloadUrl

        });

    } catch (error) {

        console.error("");
        console.error(
            "INSTAGRAM ERROR:"
        );
        console.error(error);

        return res.status(500).json({

            ok: false,

            error:
                error.message ||
                "Instagram download failed."

        });

    }

});

/* =========================================
   SERVE DOWNLOADED FILE
========================================= */

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

/* =========================================
   START SERVER
========================================= */

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
