const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const https = require("https");
const http = require("http");
const { spawn } = require("child_process");

const { download } = require("@satorufx/mediadownloader");

const ffmpegPath = require("ffmpeg-static");
const ffprobePath = require("ffprobe-static").path;

const app = express();

const PORT = process.env.PORT || 3000;

const DOWNLOAD_DIR =
    path.join(__dirname, "downloads");

/*
    Maximum source/final file size:
    200 MB
*/
const MAX_FILE_SIZE =
    200 * 1024 * 1024;

/*
    Temporary files expire after:
    5 minutes
*/
const FILE_EXPIRY =
    5 * 60 * 1000;

/*
    Maximum time allowed for downloading
*/
const DOWNLOAD_TIMEOUT =
    120000;

/*
    Maximum time allowed for FFmpeg
*/
const FFMPEG_TIMEOUT =
    180000;


/*
    Make sure downloads directory exists
*/
fs.mkdirSync(
    DOWNLOAD_DIR,
    {
        recursive: true
    }
);


/*
    Express setup
*/
app.use(
    express.json({
        limit: "10kb"
    })
);

app.use(
    express.static(
        path.join(
            __dirname,
            "public"
        )
    )
);


/* =========================================================
   TIKTOK URL VALIDATION
========================================================= */

function isValidTikTokUrl(value) {

    try {

        const url =
            new URL(value);

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


/* =========================================================
   CREATE JOB DIRECTORY
========================================================= */

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
        {
            recursive: true
        }
    );

    return {
        id,
        directory
    };
}


/* =========================================================
   CLEANUP DIRECTORY
========================================================= */

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


/* =========================================================
   DOWNLOAD FILE
========================================================= */

function downloadFile(
    url,
    destination
) {

    return new Promise(
        (resolve, reject) => {

            const protocol =
                url.startsWith("https")
                    ? https
                    : http;

            let finished = false;
            let downloaded = 0;

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
                            Follow redirects
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


                        /*
                            Monitor downloaded size
                        */
                        response.on(
                            "data",
                            chunk => {

                                downloaded +=
                                    chunk.length;

                                if (
                                    downloaded >
                                    MAX_FILE_SIZE &&
                                    !finished
                                ) {

                                    finished = true;

                                    request.destroy();

                                    response.destroy();

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

                                if (
                                    finished
                                ) {
                                    return;
                                }

                                finished = true;

                                file.close(
                                    () => resolve()
                                );

                            }
                        );


                        file.on(
                            "error",
                            error => {

                                if (
                                    finished
                                ) {
                                    return;
                                }

                                finished = true;

                                fs.unlink(
                                    destination,
                                    () => {}
                                );

                                reject(error);

                            }
                        );

                    }
                );


            /*
                Download timeout
            */
            request.setTimeout(
                DOWNLOAD_TIMEOUT,
                () => {

                    if (
                        finished
                    ) {
                        return;
                    }

                    finished = true;

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
                error => {

                    if (
                        finished
                    ) {
                        return;
                    }

                    finished = true;

                    reject(error);

                }
            );

        }
    );
}


/* =========================================================
   FFPROBE VIDEO INFORMATION
========================================================= */

function probeVideo(
    filePath
) {

    return new Promise(
        (resolve, reject) => {

            const args = [

                "-v",
                "error",

                "-select_streams",
                "v:0",

                "-show_entries",
                "stream=codec_name,pix_fmt,width,height",

                "-of",
                "json",

                filePath

            ];


            const process =
                spawn(
                    ffprobePath,
                    args
                );


            let stdout = "";
            let stderr = "";


            process.stdout.on(
                "data",
                data => {

                    stdout +=
                        data.toString();

                }
            );


            process.stderr.on(
                "data",
                data => {

                    stderr +=
                        data.toString();

                }
            );


            let timeout =
                setTimeout(
                    () => {

                        process.kill(
                            "SIGKILL"
                        );

                        reject(
                            new Error(
                                "FFprobe timed out."
                            )
                        );

                    },
                    30000
                );


            process.on(
                "error",
                error => {

                    clearTimeout(
                        timeout
                    );

                    reject(error);

                }
            );


            process.on(
                "close",
                code => {

                    clearTimeout(
                        timeout
                    );


                    if (
                        code !== 0
                    ) {

                        return reject(
                            new Error(
                                `FFprobe failed: ${stderr.slice(-2000)}`
                            )
                        );

                    }


                    try {

                        const data =
                            JSON.parse(
                                stdout
                            );


                        if (
                            !data.streams ||
                            !data.streams[0]
                        ) {

                            return reject(
                                new Error(
                                    "FFprobe could not find a video stream."
                                )
                            );

                        }


                        resolve(
                            data.streams[0]
                        );

                    } catch {

                        reject(
                            new Error(
                                "FFprobe returned invalid information."
                            )
                        );

                    }

                }
            );

        }
    );
}


/* =========================================================
   FFPROBE AUDIO INFORMATION
========================================================= */

function probeAudio(
    filePath
) {

    return new Promise(
        (resolve, reject) => {

            const args = [

                "-v",
                "error",

                "-select_streams",
                "a:0",

                "-show_entries",
                "stream=codec_name,sample_rate,channels",

                "-of",
                "json",

                filePath

            ];


            const process =
                spawn(
                    ffprobePath,
                    args
                );


            let stdout = "";
            let stderr = "";


            process.stdout.on(
                "data",
                data => {

                    stdout +=
                        data.toString();

                }
            );


            process.stderr.on(
                "data",
                data => {

                    stderr +=
                        data.toString();

                }
            );


            let timeout =
                setTimeout(
                    () => {

                        process.kill(
                            "SIGKILL"
                        );

                        reject(
                            new Error(
                                "FFprobe audio check timed out."
                            )
                        );

                    },
                    30000
                );


            process.on(
                "error",
                error => {

                    clearTimeout(
                        timeout
                    );

                    reject(error);

                }
            );


            process.on(
                "close",
                code => {

                    clearTimeout(
                        timeout
                    );


                    /*
                        Some TikTok files may not
                        contain a separate audio stream.
                    */
                    if (
                        code !== 0
                    ) {

                        return resolve(
                            null
                        );

                    }


                    try {

                        const data =
                            JSON.parse(
                                stdout
                            );


                        if (
                            !data.streams ||
                            !data.streams[0]
                        ) {

                            return resolve(
                                null
                            );

                        }


                        resolve(
                            data.streams[0]
                        );

                    } catch {

                        resolve(
                            null
                        );

                    }

                }
            );

        }
    );
}


/* =========================================================
   RUN FFMPEG
========================================================= */

function runFfmpeg(
    args,
    operationName
) {

    return new Promise(
        (resolve, reject) => {

            console.log(
                `${operationName} started...`
            );


            const process =
                spawn(
                    ffmpegPath,
                    args
                );


            let stderr = "";
            let finished = false;


            /*
                FFmpeg timeout
            */
            const timeout =
                setTimeout(
                    () => {

                        if (
                            finished
                        ) {
                            return;
                        }

                        console.log(
                            `${operationName} timed out.`
                        );

                        process.kill(
                            "SIGKILL"
                        );

                        finished = true;

                        reject(
                            new Error(
                                `${operationName} timed out.`
                            )
                        );

                    },
                    FFMPEG_TIMEOUT
                );


            process.stderr.on(
                "data",
                data => {

                    const text =
                        data.toString();

                    stderr += text;


                    /*
                        Show FFmpeg progress
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


            process.on(
                "error",
                error => {

                    if (
                        finished
                    ) {
                        return;
                    }

                    finished = true;

                    clearTimeout(
                        timeout
                    );

                    reject(
                        new Error(
                            `FFmpeg could not start: ${error.message}`
                        )
                    );

                }
            );


            process.on(
                "close",
                code => {

                    if (
                        finished
                    ) {
                        return;
                    }

                    finished = true;

                    clearTimeout(
                        timeout
                    );


                    if (
                        code !== 0
                    ) {

                        return reject(
                            new Error(
                                `FFmpeg failed with code ${code}\n${stderr.slice(-5000)}`
                            )
                        );

                    }


                    const outputPath =
                        args[
                            args.length - 1
                        ];


                    if (
                        !fs.existsSync(
                            outputPath
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
                            outputPath
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


                    resolve();

                }
            );

        }
    );
}


/* =========================================================
   INTELLIGENT VIDEO PROCESSING
========================================================= */

async function makeCompatibleMp4(
    inputPath,
    outputPath
) {

    console.log(
        "Checking video codec with FFprobe..."
    );


    const video =
        await probeVideo(
            inputPath
        );


    const audio =
        await probeAudio(
            inputPath
        );


    const videoCodec =
        String(
            video.codec_name || ""
        ).toLowerCase();


    const pixelFormat =
        String(
            video.pix_fmt || ""
        ).toLowerCase();


    const audioCodec =
        audio
            ? String(
                audio.codec_name || ""
            ).toLowerCase()
            : null;


    console.log(
        "Video codec:",
        videoCodec
    );


    console.log(
        "Pixel format:",
        pixelFormat
    );


    console.log(
        "Audio codec:",
        audioCodec || "none"
    );


    console.log(
        "Resolution:",
        `${video.width || "?"}x${video.height || "?"}`
    );


    /*
        We can safely keep the original
        video when it is:

        H.264
        + yuv420p

        and the audio is either:

        AAC
        OR no audio.
    */
    const alreadyCompatible =
        (
            videoCodec === "h264" ||
            videoCodec === "avc1"
        ) &&
        (
            pixelFormat === "yuv420p"
        ) &&
        (
            !audioCodec ||
            audioCodec === "aac"
        );


    if (
        alreadyCompatible
    ) {

        console.log(
            "Compatible H.264/AAC detected."
        );

        console.log(
            "Skipping video re-encoding."
        );

        console.log(
            "Using fast stream copy..."
        );


        /*
            Stream copy:

            NO video encoding
            NO quality loss
            Extremely fast
        */
        const args = [

            "-y",

            "-i",
            inputPath,

            "-map",
            "0:v:0",

            "-map",
            "0:a?",

            "-c",
            "copy",

            "-movflags",
            "+faststart",

            outputPath

        ];


        await runFfmpeg(
            args,
            "Fast MP4 remux"
        );


        return {
            converted: false,
            codec: videoCodec
        };

    }


    /*
        Everything else gets converted.

        This includes:

        HEVC / H.265
        H.264 10-bit
        incompatible pixel formats
        incompatible audio
        other video codecs
    */
    console.log(
        `Video requires compatibility conversion. Detected codec: ${videoCodec}`
    );


    console.log(
        "Converting to H.264 + AAC..."
    );


    const args = [

        "-y",

        "-i",
        inputPath,

        /*
            Video
        */
        "-map",
        "0:v:0",

        /*
            Audio if available
        */
        "-map",
        "0:a?",

        /*
            H.264
        */
        "-c:v",
        "libx264",

        /*
            Maximum encoding speed
        */
        "-preset",
        "ultrafast",

        /*
            Good social-video quality
        */
        "-crf",
        "24",

        /*
            Broad compatibility
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
            Fast-start MP4
        */
        "-movflags",
        "+faststart",

        outputPath

    ];


    await runFfmpeg(
        args,
        "H.264 conversion"
    );


    return {
        converted: true,
        codec: videoCodec
    };
}


/* =========================================================
   DOWNLOAD API
========================================================= */

app.post(
    "/api/download",
    async (req, res) => {

        const {
            url
        } = req.body || {};


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


        /*
            Create temporary job
        */
        const job =
            createJobDirectory();


        const timestamp =
            Date.now();


        const originalFilename =
            `original-${timestamp}.mp4`;


        const finalFilename =
            `tiktok-${timestamp}.mp4`;


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
                "======================================"
            );

            console.log(
                "Processing TikTok:"
            );

            console.log(
                cleanUrl
            );

            console.log(
                "======================================"
            );


            /*
                Get TikTok media
            */
            const result =
                await download(
                    cleanUrl,
                    {
                        quality: "best"
                    }
                );


            if (
                !result ||
                !result.video
            ) {

                throw new Error(
                    "TikTok downloader did not return a video URL."
                );

            }


            console.log(
                "TikTok video URL received."
            );


            /*
                Download original
            */
            console.log(
                "Downloading original video..."
            );


            await downloadFile(
                result.video,
                originalPath
            );


            /*
                Verify original
            */
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
                Intelligent compatibility processing
            */
            const processingResult =
                await makeCompatibleMp4(
                    originalPath,
                    finalPath
                );


            console.log(
                "Processing result:",
                processingResult
            );


            /*
                Delete original source file
            */
            try {

                fs.unlinkSync(
                    originalPath
                );

                console.log(
                    "Original temporary file deleted."
                );

            } catch (error) {

                console.log(
                    "Could not delete original file:",
                    error.message
                );

            }


            /*
                Verify final MP4
            */
            if (
                !fs.existsSync(
                    finalPath
                )
            ) {

                throw new Error(
                    "Final MP4 was not created."
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
                    "Final MP4 is empty."
                );

            }


            /*
                Final 200 MB protection
            */
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
                        "The processed video is larger than the 200 MB limit."

                });

            }


            console.log(
                `Final MP4 ready: ${finalStats.size} bytes`
            );


            /*
                Automatically remove temporary files
                after 5 minutes.
            */
            setTimeout(
                () => {

                    console.log(
                        `Cleaning up job ${job.id}`
                    );

                    cleanupDirectory(
                        job.directory
                    );

                },
                FILE_EXPIRY
            );


            /*
                Return download information
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
                "======================================"
            );

            console.error(
                "DOWNLOAD ERROR:"
            );

            console.error(
                error
            );

            console.error(
                "======================================"
            );


            /*
                Delete everything belonging
                to this failed job.
            */
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


/* =========================================================
   FILE DOWNLOAD ROUTE
========================================================= */

app.get(
    "/api/file/:jobId/:filename",
    (req, res) => {

        const {
            jobId
        } = req.params;


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


        /*
            Build paths
        */
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
            File must exist
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
            Force browser download
        */
        res.download(
            resolvedFile,
            filename,
            error => {

                if (
                    error
                ) {

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
   START SERVER
========================================================= */

app.listen(
    PORT,
    () => {

        console.log(
            "======================================"
        );

        console.log(
            `TikTok Downloader running on port ${PORT}`
        );

        console.log(
            `FFmpeg: ${ffmpegPath}`
        );

        console.log(
            `FFprobe: ${ffprobePath}`
        );

        console.log(
            "======================================"

        );

    }
);
