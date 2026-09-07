const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const RESOLVER_API =
    "https://terabox-worker.robinkumarshakya103.workers.dev/api";


// =====================================================
// Helpers
// =====================================================

function isValidTeraboxUrl(value) {
    try {
        const url = new URL(value);

        const host = url.hostname
            .toLowerCase()
            .replace(/^www\./, "");

        const allowedHosts = [
            "terabox.com",
            "terabox.app",
            "teraboxshare.com",
            "1024terabox.com",
            "teraboxlink.com",
            "terasharefile.com",
            "terafileshare.com",
            "terasharelink.com"
        ];

        return allowedHosts.some(
            domain =>
                host === domain ||
                host.endsWith("." + domain)
        );

    } catch {
        return false;
    }
}


function formatBytes(bytes) {
    const n = Number(bytes) || 0;

    if (n <= 0) {
        return "Unknown size";
    }

    if (n < 1024) {
        return n + " B";
    }

    if (n < 1024 * 1024) {
        return (
            n / 1024
        ).toFixed(1) + " KB";
    }

    if (n < 1024 * 1024 * 1024) {
        return (
            n /
            (1024 * 1024)
        ).toFixed(1) + " MB";
    }

    if (n < 1024 * 1024 * 1024 * 1024) {
        return (
            n /
            (1024 * 1024 * 1024)
        ).toFixed(2) + " GB";
    }

    return (
        n /
        (1024 * 1024 * 1024 * 1024)
    ).toFixed(2) + " TB";
}


function normalizeFile(file) {
    return {
        filename:
            file?.file_name ||
            file?.filename ||
            file?.server_filename ||
            file?.name ||
            "Unnamed file",

        size:
            file?.size ||
            "",

        thumbnail:
            file?.thumbnail ||
            file?.thumb ||
            file?.thumbnail_url ||
            "",

        downloadUrl:
            file?.download_url ||
            file?.download_link ||
            file?.dlink ||
            "",

        streamingUrl:
            file?.streaming_url ||
            ""
    };
}


// =====================================================
// Health
// =====================================================

app.get("/api/health", (req, res) => {
    res.json({
        ok: true,
        service: "TeraBox Link Downloader",
        status: "running"
    });
});


// =====================================================
// Resolve TeraBox Share Link
// =====================================================

app.post("/api/resolve", async (req, res) => {

    try {

        const input =
            String(
                req.body?.url || ""
            ).trim();

        if (!input) {
            return res.status(400).json({
                ok: false,
                error:
                    "Paste a TeraBox share link."
            });
        }


        if (!isValidTeraboxUrl(input)) {
            return res.status(400).json({
                ok: false,
                error:
                    "That does not look like a supported TeraBox link."
            });
        }


        console.log(
            "Resolving TeraBox link..."
        );


        const apiUrl =
            RESOLVER_API +
            "?url=" +
            encodeURIComponent(input);


        const controller =
            new AbortController();


        const timeout =
            setTimeout(
                () => controller.abort(),
                30000
            );


        let response;

        try {

            response =
                await fetch(
                    apiUrl,
                    {
                        method: "GET",
                        headers: {
                            "Accept":
                                "application/json"
                        },
                        signal:
                            controller.signal
                    }
                );

        } finally {

            clearTimeout(
                timeout
            );

        }


        let data;

        try {

            data =
                await response.json();

        } catch {

            return res.status(502).json({
                ok: false,
                error:
                    "TeraBox resolver returned an invalid response."
            });

        }


        console.log(
            "Resolver HTTP status:",
            response.status
        );

        console.log(
            "Resolver success:",
            data?.success
        );


        if (
            !response.ok ||
            data?.success === false
        ) {

            return res.status(502).json({
                ok: false,
                error:
                    data?.error ||
                    "Could not resolve this TeraBox link."
            });

        }


        const rawFiles =
            Array.isArray(data?.files)
                ? data.files
                : [];


        const files =
            rawFiles
                .map(normalizeFile)
                .filter(
                    file =>
                        file.downloadUrl
                );


        if (!files.length) {

            return res.status(404).json({
                ok: false,
                error:
                    "No downloadable files were found in this TeraBox link."
            });

        }


        return res.json({
            ok: true,
            sourceUrl: input,
            files
        });


    } catch (error) {

        console.error(
            "Resolve error:",
            error.message
        );


        if (
            error.name ===
            "AbortError"
        ) {

            return res.status(504).json({
                ok: false,
                error:
                    "TeraBox took too long to respond. Try again."
            });

        }


        return res.status(500).json({
            ok: false,
            error:
                error.message ||
                "Failed to resolve TeraBox link."
        });

    }

});


// =====================================================
// Frontend
// =====================================================

app.get("/", (req, res) => {

    const html = `

<!DOCTYPE html>

<html lang="en">

<head>

<meta charset="UTF-8">

<meta
    name="viewport"
    content="width=device-width,initial-scale=1"
/>

<title>TeraBox Link Downloader</title>

<style>

* {
    box-sizing: border-box;
}

body {

    margin: 0;

    min-height: 100vh;

    font-family:
        Arial,
        Helvetica,
        sans-serif;

    background:
        radial-gradient(
            circle at top,
            #172554 0%,
            #07101b 45%,
            #020617 100%
        );

    color: white;

    padding: 20px;

}

.container {

    width: 100%;

    max-width: 900px;

    margin:
        0 auto;

}

.card {

    background:
        rgba(
            15,
            23,
            42,
            .94
        );

    border:
        1px solid
        rgba(
            148,
            163,
            184,
            .16
        );

    border-radius: 28px;

    padding: 30px;

    box-shadow:
        0 30px 80px
        rgba(
            0,
            0,
            0,
            .45
        );

}

.logo {

    width: 64px;

    height: 64px;

    border-radius: 18px;

    display: flex;

    align-items: center;

    justify-content: center;

    font-size: 22px;

    font-weight: 900;

    background:
        linear-gradient(
            135deg,
            #2563eb,
            #06b6d4
        );

    box-shadow:
        0 10px 30px
        rgba(
            37,
            99,
            235,
            .25
        );

}

.header {

    display: flex;

    align-items: center;

    gap: 16px;

    margin-bottom: 28px;

}

h1 {

    margin: 0;

    font-size: 30px;

}

.subtitle {

    color:
        #94a3b8;

    margin-top: 5px;

    font-size: 14px;

}

.search-box {

    display: flex;

    gap: 10px;

    margin-bottom: 18px;

}

input {

    flex: 1;

    min-width: 0;

    padding:
        17px 18px;

    border-radius: 14px;

    border:
        1px solid
        #334155;

    background:
        #08111f;

    color: white;

    outline: none;

    font-size: 14px;

}

input:focus {

    border-color:
        #38bdf8;

    box-shadow:
        0 0 0 3px
        rgba(
            56,
            189,
            248,
            .08
        );

}

button {

    border: 0;

    border-radius: 14px;

    padding:
        0 22px;

    font-size: 14px;

    font-weight: 800;

    color: white;

    background:
        linear-gradient(
            135deg,
            #2563eb,
            #06b6d4
        );

    cursor: pointer;

}

button:hover {

    filter:
        brightness(1.08);

}

button:disabled {

    opacity: .55;

    cursor:
        not-allowed;

}

.status {

    min-height: 22px;

    color:
        #94a3b8;

    font-size: 13px;

    margin-bottom: 18px;

}

.status.error {

    color:
        #fca5a5;

}

.status.success {

    color:
        #86efac;

}

.files {

    display: grid;

    gap: 12px;

}

.file {

    display: flex;

    gap: 14px;

    align-items: center;

    padding: 15px;

    background:
        #0b1422;

    border:
        1px solid
        #1e293b;

    border-radius: 16px;

}

.thumb {

    width: 82px;

    height: 58px;

    border-radius: 10px;

    background:
        #172033;

    object-fit: cover;

    flex-shrink: 0;

}

.thumb-placeholder {

    width: 82px;

    height: 58px;

    border-radius: 10px;

    display: flex;

    align-items: center;

    justify-content: center;

    background:
        #172033;

    font-size: 24px;

    flex-shrink: 0;

}

.info {

    flex: 1;

    min-width: 0;

}

.name {

    font-weight: 800;

    word-break:
        break-word;

}

.meta {

    color:
        #64748b;

    font-size: 12px;

    margin-top: 6px;

}

.download {

    background:
        #1e293b;

    border:
        1px solid
        #334155;

    padding:
        10px 14px;

    border-radius: 11px;

    white-space: nowrap;

}

.empty {

    padding: 35px;

    text-align: center;

    color:
        #64748b;

    border:
        1px dashed
        #334155;

    border-radius: 16px;

}

.footer {

    margin-top: 24px;

    text-align: center;

    color:
        #475569;

    font-size: 11px;

}

@media (
    max-width: 650px
) {

    .card {

        padding: 20px 15px;

    }

    .search-box {

        flex-direction:
            column;

    }

    .search-box button {

        min-height:
            50px;

    }

    .file {

        align-items:
            flex-start;

        flex-wrap:
            wrap;

    }

    .download {

        width: 100%;

    }

    .thumb,
    .thumb-placeholder {

        width: 70px;

        height: 52px;

    }

}

</style>

</head>

<body>

<div class="container">

<div class="card">

<div class="header">

<div class="logo">
TB
</div>

<div>

<h1>
TeraBox Link Downloader
</h1>

<div class="subtitle">
Paste a TeraBox share link and download your files
</div>

</div>

</div>


<div class="search-box">

<input
    id="urlInput"
    type="url"
    placeholder="Paste TeraBox link here..."
    autocomplete="off"
/>

<button
    id="resolveButton"
    type="button"
>
Get Download
</button>

</div>


<div
    id="status"
    class="status"
>
Paste a TeraBox share link above.
</div>


<div
    id="files"
    class="files"
></div>


<div class="footer">
TeraBox Link Downloader
</div>

</div>

</div>


<script>

(function () {

    const input =
        document.getElementById(
            "urlInput"
        );

    const button =
        document.getElementById(
            "resolveButton"
        );

    const status =
        document.getElementById(
            "status"
        );

    const filesBox =
        document.getElementById(
            "files"
        );


    function formatSize(value) {

        if (
            typeof value ===
            "string" &&
            value.trim()
        ) {

            return value;

        }

        const bytes =
            Number(value) || 0;

        if (!bytes) {

            return "Unknown size";

        }

        if (bytes < 1024) {

            return bytes + " B";

        }

        if (
            bytes <
            1024 * 1024
        ) {

            return (
                bytes / 1024
            ).toFixed(1) +
            " KB";

        }

        if (
            bytes <
            1024 *
            1024 *
            1024
        ) {

            return (
                bytes /
                (1024 * 1024)
            ).toFixed(1) +
            " MB";

        }

        return (
            bytes /
            (1024 * 1024 * 1024)
        ).toFixed(2) +
        " GB";

    }


    function setStatus(
        text,
        type
    ) {

        status.textContent =
            text || "";

        status.className =
            "status " +
            (
                type || ""
            );

    }


    function renderFiles(
        files
    ) {

        filesBox.innerHTML =
            "";

        if (!files.length) {

            filesBox.innerHTML =
                '<div class="empty">No downloadable files found.</div>';

            return;

        }


        files.forEach(
            function (file) {

                const row =
                    document.createElement(
                        "div"
                    );

                row.className =
                    "file";


                if (
                    file.thumbnail
                ) {

                    const image =
                        document.createElement(
                            "img"
                        );

                    image.className =
                        "thumb";

                    image.src =
                        file.thumbnail;

                    image.alt =
                        file.filename;

                    image.loading =
                        "lazy";

                    image.onerror =
                        function () {

                            image.replaceWith(
                                createPlaceholder()
                            );

                        };

                    row.appendChild(
                        image
                    );

                } else {

                    row.appendChild(
                        createPlaceholder()
                    );

                }


                const info =
                    document.createElement(
                        "div"
                    );

                info.className =
                    "info";


                const name =
                    document.createElement(
                        "div"
                    );

                name.className =
                    "name";

                name.textContent =
                    file.filename ||
                    "Unnamed file";


                const meta =
                    document.createElement(
                        "div"
                    );

                meta.className =
                    "meta";

                meta.textContent =
                    "File • " +
                    formatSize(
                        file.size
                    );


                info.appendChild(
                    name
                );

                info.appendChild(
                    meta
                );


                const download =
                    document.createElement(
                        "button"
                    );

                download.className =
                    "download";

                download.type =
                    "button";

                download.textContent =
                    "Download";


                download.addEventListener(
                    "click",
                    function () {

                        if (
                            !file.downloadUrl
                        ) {

                            setStatus(
                                "No download link was returned.",
                                "error"
                            );

                            return;

                        }


                        const a =
                            document.createElement(
                                "a"
                            );

                        a.href =
                            file.downloadUrl;

                        a.target =
                            "_blank";

                        a.rel =
                            "noopener noreferrer";

                        document.body.appendChild(
                            a
                        );

                        a.click();

                        a.remove();

                    }
                );


                row.appendChild(
                    info
                );

                row.appendChild(
                    download
                );

                filesBox.appendChild(
                    row
                );

            }
        );

    }


    function createPlaceholder() {

        const div =
            document.createElement(
                "div"
            );

        div.className =
            "thumb-placeholder";

        div.textContent =
            "📦";

        return div;

    }


    async function resolve() {

        const url =
            input.value.trim();


        if (!url) {

            setStatus(
                "Paste a TeraBox share link first.",
                "error"
            );

            return;

        }


        button.disabled =
            true;

        button.textContent =
            "Getting Link...";

        filesBox.innerHTML =
            "";

        setStatus(
            "Extracting TeraBox files..."
        );


        try {

            const response =
                await fetch(
                    "/api/resolve",
                    {
                        method:
                            "POST",

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


            if (
                !response.ok ||
                !data.ok
            ) {

                throw new Error(
                    data.error ||
                    "Could not process this link."
                );

            }


            renderFiles(
                Array.isArray(
                    data.files
                )
                    ? data.files
                    : []
            );


            setStatus(
                data.files.length +
                " downloadable file(s) found.",
                "success"
            );


        } catch (error) {

            setStatus(
                error.message ||
                "Something went wrong.",
                "error"
            );

        } finally {

            button.disabled =
                false;

            button.textContent =
                "Get Download";

        }

    }


    button.addEventListener(
        "click",
        resolve
    );


    input.addEventListener(
        "keydown",
        function (event) {

            if (
                event.key ===
                "Enter"
            ) {

                resolve();

            }

        }
    );

})();

</script>

</body>

</html>

`;

    res.send(html);

});


// =====================================================
// Start
// =====================================================

app.listen(
    PORT,
    "0.0.0.0",
    function () {

        console.log(
            "TeraBox Link Downloader running on port " +
            PORT
        );

    }
);
