const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { TikTok } = require("@satorufx/mediadownloader");

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

function findVideoFile(directory) {
    const files = fs.readdirSync(directory);

    const allowedExtensions = [
        ".mp4",
        ".webm",
        ".mkv",
        ".mov"
    ];

    return files.find(file =>
        allowedExtensions.includes(
            path.extname(file).toLowerCase()
        )
    );
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

app.post("/api/download", async (req, res) => {
    const { url } = req.body || {};

    if (!url || typeof url !== "string") {
        return res.status(400).json({
            ok: false,
            error: "Please enter a TikTok URL."
        });
    }

    if (!isValidTikTokUrl(url.trim())) {
        return res.status(400).json({
            ok: false,
            error: "Please enter a valid TikTok URL."
        });
    }

    const job = createJobDirectory();

    try {
        await ytdlp(url.trim(), {
            output: path.join(
                job.directory,
                "%(title).100s.%(ext)s"
            ),
            format: "best",
            noPlaylist: true,
            noWarnings: true,
            quiet: true,
            restrictFilenames: true,
        });

        const filename = findVideoFile(job.directory);

        if (!filename) {
            throw new Error(
                "No video file was produced."
            );
        }

        const filePath = path.join(
            job.directory,
            filename
        );

        const stats = fs.statSync(filePath);

        if (stats.size > MAX_FILE_SIZE) {
            cleanupDirectory(job.directory);

            return res.status(413).json({
                ok: false,
                error:
                    "This video is larger than the 200 MB limit."
            });
        }

        setTimeout(() => {
            cleanupDirectory(job.directory);
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

        console.error(
            "ERROR STDERR:",
            error.stderr
        );

        cleanupDirectory(job.directory);

        return res.status(500).json({
            ok: false,
            error:
                "Unable to process this video. Make sure the TikTok video is publicly accessible and the URL is correct."
        });
    }
});

app.get(
    "/api/file/:jobId/:filename",
    (req, res) => {

        const { jobId } = req.params;

        const filename =
            decodeURIComponent(req.params.filename);

        if (!/^[a-f0-9]{32}$/.test(jobId)) {
            return res.status(400).send(
                "Invalid request."
            );
        }

        const jobDirectory = path.join(
            DOWNLOAD_DIR,
            jobId
        );

        const filePath = path.join(
            jobDirectory,
            filename
        );

        const resolvedDirectory =
            path.resolve(jobDirectory);

        const resolvedFile =
            path.resolve(filePath);

        if (
            !resolvedFile.startsWith(
                resolvedDirectory + path.sep
            )
        ) {
            return res.status(400).send(
                "Invalid file path."
            );
        }

        if (!fs.existsSync(resolvedFile)) {
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

app.listen(PORT, () => {
    console.log(
        `TikTok Downloader running on port ${PORT}`
    );
});
