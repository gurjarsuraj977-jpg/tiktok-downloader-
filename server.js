const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const https = require("https");
const http = require("http");

const { download } = require("@satorufx/mediadownloader");

const app = express();

const PORT = process.env.PORT || 3000;

const DOWNLOAD_DIR = path.join(__dirname, "downloads");

const MAX_FILE_SIZE = 200 * 1024 * 1024;
const FILE_EXPIRY = 5 * 60 * 1000;

fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

app.use(express.json({ limit: "10kb" }));

app.use(express.static(path.join(__dirname, "public")));

function isValidTikTokUrl(value) {
    try {
        const url = new URL(value);

        const allowedHosts = [
            "tiktok.com",
            "www.tiktok.com",
            "vm.tiktok.com",
            "vt.tiktok.com"
        ];

        return (
            url.protocol === "https:" &&
            allowedHosts.includes(url.hostname.toLowerCase())
        );
    } catch {
        return false;
    }
}

function createJobDirectory() {
    const id = crypto.randomBytes(16).toString("hex");
    const directory = path.join(DOWNLOAD_DIR, id);

    fs.mkdirSync(directory, { recursive: true });

    return {
        id,
        directory
    };
}

function cleanupDirectory(directory) {
    fs.rm(
        directory,
        {
            recursive: true,
            force: true
        },
        () => {}
    );
}

function downloadFile(url, destination) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith("https")
            ? https
            : http;

        const request = protocol.get(
            url,
            {
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36"
                }
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
                        destination
                    )
                        .then(resolve)
                        .catch(reject);
                }

                if (response.statusCode !== 200) {
                    response.resume();

                    return reject(
                        new Error(
                            `Video server returned HTTP ${response.statusCode}`
                        )
                    );
                }

                const file = fs.createWriteStream(
                    destination
                );

                let downloaded = 0;

                response.on("data", chunk => {
                    downloaded += chunk.length;

                    if (
                        downloaded >
                        MAX_FILE_SIZE
                    ) {
                        request.destroy();

                        file.destroy();

                        fs.unlink(
                            destination,
                            () => {}
                        );

                        reject(
                            new Error(
                                "Video exceeds the 200 MB limit."
                            )
                        );
                    }
                });

                response.pipe(file);

                file.on("finish", () => {
                    file.close(resolve);
                });

                file.on("error", error => {
                    fs.unlink(
                        destination,
                        () => {}
                    );

                    reject(error);
                });
            }
        );

        request.setTimeout(
            120000,
            () => {
                request.destroy();

                reject(
                    new Error(
                        "Video download timed out."
                    )
                );
            }
        );

        request.on("error", reject);
    });
}

app.post("/api/download", async (req, res) => {

    const { url } = req.body || {};

    if (!url || typeof url !== "string") {
        return res.status(400).json({
            ok: false,
            error: "Please enter a TikTok URL."
        });
    }

    const cleanUrl = url.trim();

    if (!isValidTikTokUrl(cleanUrl)) {
        return res.status(400).json({
            ok: false,
            error: "Please enter a valid TikTok URL."
        });
    }

    const job = createJobDirectory();

    try {

        console.log(
            "Processing TikTok:",
            cleanUrl
        );

const result = await download(cleanUrl, {
    quality: "best"
});

        console.log(
            "TikTok API result:",
            result
        );

        if (
            !result ||
            !result.video
        ) {
            throw new Error(
                "TikTok downloader did not return a video URL."
            );
        }

        const videoUrl = result.video;

        const filename =
            `tiktok-${Date.now()}.mp4`;

        const filePath = path.join(
            job.directory,
            filename
        );

        console.log(
            "Downloading video..."
        );

        await downloadFile(
            videoUrl,
            filePath
        );

        if (!fs.existsSync(filePath)) {
            throw new Error(
                "Video file was not created."
            );
        }

        const stats = fs.statSync(
            filePath
        );

        if (stats.size === 0) {
            throw new Error(
                "Downloaded video is empty."
            );
        }

        if (
            stats.size >
            MAX_FILE_SIZE
        ) {
            cleanupDirectory(
                job.directory
            );

            return res.status(413).json({
                ok: false,
                error:
                    "This video is larger than the 200 MB limit."
            });
        }

        console.log(
            `Video downloaded successfully: ${stats.size} bytes`
        );

        setTimeout(() => {
            cleanupDirectory(
                job.directory
            );
        }, FILE_EXPIRY);

        return res.json({
            ok: true,
            filename,
            downloadUrl:
                `/api/file/${job.id}/${encodeURIComponent(filename)}`
        });

    } catch (error) {

        console.error(
            "DOWNLOAD ERROR:",
            error
        );

        console.error(
            "ERROR MESSAGE:",
            error.message
        );

        cleanupDirectory(
            job.directory
        );

        return res.status(500).json({
            ok: false,
            error:
                "Unable to process this TikTok video. Please make sure the video is public and the URL is correct."
        });
    }
});

app.get(
    "/api/file/:jobId/:filename",
    (req, res) => {

        const { jobId } = req.params;

        const filename =
            decodeURIComponent(
                req.params.filename
            );

        if (
            !/^[a-f0-9]{32}$/.test(
                jobId
            )
        ) {
            return res.status(400).send(
                "Invalid request."
            );
        }

        const jobDirectory =
            path.join(
                DOWNLOAD_DIR,
                jobId
            );

        const filePath =
            path.join(
                jobDirectory,
                filename
            );

        const resolvedDirectory =
            path.resolve(
                jobDirectory
            );

        const resolvedFile =
            path.resolve(
                filePath
            );

        if (
            !resolvedFile.startsWith(
                resolvedDirectory +
                path.sep
            )
        ) {
            return res.status(400).send(
                "Invalid file path."
            );
        }

        if (
            !fs.existsSync(
                resolvedFile
            )
        ) {
            return res.status(404).send(
                "File expired or no longer exists."
            );
        }

        res.download(
            resolvedFile,
            filename,
            error => {

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

app.listen(
    PORT,
    () => {
        console.log(
            `TikTok Downloader running on port ${PORT}`
        );
    }
);
