const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const https = require("https");
const http = require("http");
const { spawn } = require("child_process");

const { download } = require("@satorufx/mediadownloader");
const ffmpegPath = require("ffmpeg-static");

const app = express();

const PORT = process.env.PORT || 3000;

const DOWNLOAD_DIR = path.join(__dirname, "downloads");

const MAX_FILE_SIZE = 200 * 1024 * 1024;
const FILE_EXPIRY = 5 * 60 * 1000;

fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

app.use(express.json({ limit: "10kb" }));
app.use(express.static(path.join(__dirname, "public")));


/* ================================
   TIKTOK URL VALIDATION
================================ */

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
            allowedHosts.includes(
                url.hostname.toLowerCase()
            )
        );

    } catch {
        return false;
    }
}


/* ================================
   JOB DIRECTORY
================================ */

function createJobDirectory() {

    const id =
        crypto.randomBytes(16).toString("hex");

    const directory =
        path.join(
            DOWNLOAD_DIR,
            id
        );

    fs.mkdirSync(
        directory,
        { recursive: true }
    );

    return {
        id,
        directory
    };
}


/* ================================
   CLEANUP
================================ */

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


/* ================================
   DOWNLOAD ORIGINAL VIDEO
================================ */

function downloadFile(url, destination) {

    return new Promise(
        (resolve, reject) => {

            const protocol =
                url.startsWith("https")
                    ? https
                    : http;

            const request =
                protocol.get(
                    url,
                    {
                        headers: {
                            "User-Agent":
                                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36"
                        }
                    },
                    response => {

                        /*
                            Handle redirects
                        */
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


                        /*
                            HTTP error
                        */
                        if (
                            response.statusCode !== 200
                        ) {

                            response.resume();

                            return reject(
                                new Error(
                                    `Video server returned HTTP ${response.statusCode}`
                                )
                            );
                        }


                        const file =
                            fs.createWriteStream(
                                destination
                            );

                        let downloaded = 0;
                        let sizeLimitReached = false;


                        response.on(
                            "data",
                            chunk => {

                                downloaded +=
                                    chunk.length;


                                if (
                                    downloaded >
                                    MAX_FILE_SIZE &&
                                    !sizeLimitReached
                                ) {

                                    sizeLimitReached =
                                        true;

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
                            }
                        );


                        response.pipe(file);


                        file.on(
                            "finish",
                            () => {

                                file.close(resolve);

                            }
                        );


                        file.on(
                            "error",
                            error => {

                                fs.unlink(
                                    destination,
                                    () => {}
                                );

                                reject(error);

                            }
                        );

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


            request.on(
                "error",
                reject
            );

        }
    );
}


/* ================================
   GET VIDEO CODEC
================================ */

function getVideoCodec(filePath) {

    return new Promise(
        (resolve, reject) => {

            const args = [
                "-v",
                "error",

                "-select_streams",
                "v:0",

                "-show_entries",
                "stream=codec_name",

                "-of",
                "default=noprint_wrappers=1:nokey=1",

                filePath
            ];


            const ffprobeArgs = [
                "-v",
                "error",

                "-select_streams",
                "v:0",

                "-show_entries",
                "stream=codec_name",

                "-of",
                "default=noprint_wrappers=1:nokey=1",

                filePath
            ];


            /*
                ffmpeg-static does not provide
                a separate ffprobe binary.

                So we use FFmpeg itself to inspect
                the file.
            */
            const ffmpeg =
                spawn(
                    ffmpegPath,
                    [
                        "-i",
                        filePath
                    ]
                );


            let stderr = "";


            ffmpeg.stderr.on(
                "data",
                data => {

                    stderr +=
                        data.toString();

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
                () => {

                    /*
                        Look for codec information
                        in FFmpeg's input description.
                    */

                    const match =
                        stderr.match(
                            /Video:\s*([^,\s]+)/i
                        );


                    if (
                        match &&
                        match[1]
                    ) {

                        return resolve(
                            match[1]
                                .toLowerCase()
                                .trim()
                        );

                    }


                    /*
                        Alternative detection
                    */
                    if (
                        /hevc|h265/i.test(
                            stderr
                        )
                    ) {

                        return resolve(
                            "hevc"
                        );

                    }


                    if (
                        /h264|avc1/i.test(
                            stderr
                        )
                    ) {

                        return resolve(
                            "h264"
                        );

                    }


                    reject(
                        new Error(
                            "Unable to determine video codec."
                        )
                    );

                }
            );

        }
    );
}


/* ================================
   FAST COMPATIBILITY PROCESSING
================================ */

function makeCompatibleMp4(
    inputPath,
    outputPath
) {

    return new Promise(
        async (resolve, reject) => {

            try {

                console.log(
                    "Checking video codec..."
                );


                const codec =
                    await getVideoCodec(
                        inputPath
                    );


                console.log(
                    "Detected video codec:",
                    codec
                );


                /*
                    H.264 is already compatible.

                    Use stream copy instead of
                    re-encoding.

                    This is MUCH faster.
                */
                if (
                    codec === "h264" ||
                    codec === "avc1"
                ) {

                    console.log(
                        "H.264 detected. Skipping re-encode."
                    );


                    const args = [

                        "-y",

                        "-i",
                        inputPath,

                        "-c",
                        "copy",

                        "-movflags",
                        "+faststart",

                        outputPath

                    ];


                    return runFfmpeg(
                        args,
                        "Fast MP4 remux"
                    )
                        .then(resolve)
                        .catch(reject);
                }


                /*
                    HEVC/H.265 or another codec.

                    Re-encode to H.264.
                */

                console.log(
                    `Codec ${codec} detected. Converting to H.264...`
                );


                const args = [

                    "-y",

                    "-i",
                    inputPath,

                    /*
                        H.264
                    */
                    "-c:v",
                    "libx264",

                    /*
                        Faster encoding
                    */
                    "-preset",
                    "veryfast",

                    /*
                        Good quality
                    */
                    "-crf",
                    "23",

                    /*
                        Maximum compatibility
                    */
                    "-pix_fmt",
                    "yuv420p",

                    /*
                        AAC audio
                    */
                    "-c:a",
                    "aac",

                    "-b:a",
                    "128k",

                    /*
                        Web-friendly MP4
                    */
                    "-movflags",
                    "+faststart",

                    outputPath

                ];


                return runFfmpeg(
                    args,
                    "H.264 conversion"
                )
                    .then(resolve)
                    .catch(reject);

            } catch (error) {

                reject(error);

            }

        }
    );
}


/* ================================
   RUN FFMPEG
================================ */

function runFfmpeg(
    args,
    operationName
) {

    return new Promise(
        (resolve, reject) => {

            console.log(
                `${operationName} started...`
            );


            const ffmpeg =
                spawn(
                    ffmpegPath,
                    args
                );


            let stderr = "";


            ffmpeg.stderr.on(
                "data",
                data => {

                    const text =
                        data.toString();

                    stderr += text;

                    /*
                        Log FFmpeg progress
                    */
                    if (
                        text.includes("frame=") ||
                        text.includes("time=")
                    ) {

                        console.log(
                            text.trim()
                        );

                    }

                }
            );


            ffmpeg.on(
                "error",
                error => {

                    reject(
                        new Error(
                            `FFmpeg could not start: ${error.message}`
                        )
                    );

                }
            );


            ffmpeg.on(
                "close",
                code => {

                    if (
                        code === 0
                    ) {

                        if (
                            !fs.existsSync(
                                args[args.length - 1]
                            )
                        ) {

                            return reject(
                                new Error(
                                    "FFmpeg finished but output file was not created."
                                )
                            );

                        }


                        const stats =
                            fs.statSync(
                                args[args.length - 1]
                            );


                        if (
                            stats.size === 0
                        ) {

                            return reject(
                                new Error(
                                    "FFmpeg created an empty file."
                                )
                            );

                        }


                        console.log(
                            `${operationName} completed: ${stats.size} bytes`
                        );


                        return resolve();

                    }


                    reject(
                        new Error(
                            `FFmpeg failed with code ${code}\n${stderr.slice(-5000)}`
                        )
                    );

                }
            );

        }
    );
}


/* ================================
   DOWNLOAD API
================================ */

app.post(
    "/api/download",
    async (req, res) => {

        const { url } =
            req.body || {};


        /*
            Validate input
        */
        if (
            !url ||
            typeof url !== "string"
        ) {

            return res.status(400).json({

                ok: false,

                error:
                    "Please enter a TikTok URL."

            });

        }


        const cleanUrl =
            url.trim();


        /*
            Validate TikTok URL
        */
        if (
            !isValidTikTokUrl(
                cleanUrl
            )
        ) {

            return res.status(400).json({

                ok: false,

                error:
                    "Please enter a valid TikTok URL."

            });

        }


        const job =
            createJobDirectory();


        const originalFilename =
            `original-${Date.now()}.mp4`;


        const finalFilename =
            `tiktok-${Date.now()}.mp4`;


        const originalPath =
            path.join(
                job.directory,
                originalFilename
            );


        const finalPath =
            path.join(
                job.directory,
                finalFilename
            );


        try {

            console.log(
                "Processing TikTok:",
                cleanUrl
            );


            /*
                Get TikTok video
            */
            const result =
                await download(
                    cleanUrl,
                    {
                        quality: "best"
                    }
                );


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


            const videoUrl =
                result.video;


            /*
                Download original
            */
            console.log(
                "Downloading original video..."
            );


            await downloadFile(
                videoUrl,
                originalPath
            );


            if (
                !fs.existsSync(
                    originalPath
                )
            ) {

                throw new Error(
                    "Original video file was not created."
                );

            }


            const originalStats =
                fs.statSync(
                    originalPath
                );


            if (
                originalStats.size === 0
            ) {

                throw new Error(
                    "Downloaded video is empty."
                );

            }


            if (
                originalStats.size >
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
                `Original video downloaded: ${originalStats.size} bytes`
            );


            /*
                INTELLIGENT PROCESSING
            */
            await makeCompatibleMp4(
                originalPath,
                finalPath
            );


            /*
                Delete original HEVC/source file
            */
            fs.unlink(
                originalPath,
                error => {

                    if (error) {

                        console.log(
                            "Could not delete original file:",
                            error.message
                        );

                    }

                }
            );


            /*
                Verify final file
            */
            if (
                !fs.existsSync(
                    finalPath
                )
            ) {

                throw new Error(
                    "Final video file was not created."
                );

            }


            const finalStats =
                fs.statSync(
                    finalPath
                );


            if (
                finalStats.size === 0
            ) {

                throw new Error(
                    "Final video is empty."
                );

            }


            if (
                finalStats.size >
                MAX_FILE_SIZE
            ) {

                cleanupDirectory(
                    job.directory
                );

                return res.status(413).json({

                    ok: false,

                    error:
                        "The final video is larger than the 200 MB limit."

                });

            }


            console.log(
                `Final MP4 ready: ${finalStats.size} bytes`
            );


            /*
                Keep file alive for 5 minutes
            */
            setTimeout(
                () => {

                    cleanupDirectory(
                        job.directory
                    );

                },
                FILE_EXPIRY
            );


            /*
                Return download URL
            */
            return res.json({

                ok: true,

                filename:
                    finalFilename,

                downloadUrl:
                    `/api/file/${job.id}/${encodeURIComponent(finalFilename)}`

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

    }
);


/* ================================
   FILE DOWNLOAD
================================ */

app.get(
    "/api/file/:jobId/:filename",
    (req, res) => {

        const { jobId } =
            req.params;


        const filename =
            decodeURIComponent(
                req.params.filename
            );


        /*
            Validate job ID
        */
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


        /*
            Prevent path traversal
        */
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


        /*
            Check file exists
        */
        if (
            !fs.existsSync(
                resolvedFile
            )
        ) {

            return res.status(404).send(
                "File expired or no longer exists."
            );

        }


        /*
            Force MP4 download
        */
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


/* ================================
   START SERVER
================================ */

app.listen(
    PORT,
    () => {

        console.log(
            `TikTok Downloader running on port ${PORT}`
        );

    }
);
