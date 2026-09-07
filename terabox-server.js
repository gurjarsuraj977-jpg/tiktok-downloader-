```js
const express = require("express");

const app = express();

const PORT = process.env.PORT || 3000;

/*
=========================================================
TeraBox Downloader
=========================================================

Environment variable supported by Render:

TERABOX_COOKIE

Example format:

ndus=YOUR_NDUS_VALUE

Do NOT put this value inside this file or GitHub.
*/

app.use(express.json());


// =======================================================
// HELPERS
// =======================================================

function extractSurl(input) {
    const value = String(input || "").trim();

    if (!value) {
        throw new Error("Please enter a TeraBox URL.");
    }

    const patterns = [
        /[?&]surl=([A-Za-z0-9_-]+)/i,
        /\/s\/([A-Za-z0-9_-]+)/i
    ];

    for (const pattern of patterns) {
        const match = value.match(pattern);

        if (match && match[1]) {
            const key = match[1];

            return {
                original: key,
                apiShorturl: key.startsWith("1")
                    ? key
                    : "1" + key,
                shorturl: key.startsWith("1")
                    ? key.slice(1)
                    : key
            };
        }
    }

    throw new Error("Could not extract the TeraBox share code.");
}


function isTeraBoxUrl(input) {
    try {
        const url = new URL(input);

        const allowed = [
            "terabox.com",
            "www.terabox.com",
            "terabox.app",
            "www.terabox.app",
            "teraboxshare.com",
            "www.teraboxshare.com",
            "1024terabox.com",
            "www.1024terabox.com",
            "1024tera.com",
            "www.1024tera.com",
            "dm.terabox.app",
            "dm.terabox.com"
        ];

        return allowed.includes(url.hostname.toLowerCase());
    } catch {
        return false;
    }
}


function getCookieHeader() {
    return String(
        process.env.TERABOX_COOKIE || ""
    ).trim();
}


function extractJsToken(html) {
    const patterns = [
        /fn%28%22(.*?)%22%29/i,
        /fn\("([^"]+)"\)/i,
        /jsToken\s*=\s*["']([^"']+)["']/i,
        /jsToken["']?\s*:\s*["']([^"']+)["']/i,
        /window\.jsToken\s*=\s*["']([^"']+)["']/i
    ];

    for (const pattern of patterns) {
        const match = html.match(pattern);

        if (match && match[1]) {
            return match[1];
        }
    }

    return null;
}


function extractDpLogId(html) {
    const patterns = [
        /dp-logid[=:]["']?([0-9]+)/i,
        /dpLogId[=:]["']?([0-9]+)/i
    ];

    for (const pattern of patterns) {
        const match = html.match(pattern);

        if (match && match[1]) {
            return match[1];
        }
    }

    return "0";
}


function jsonHeaders(referer) {
    const headers = {
        "Accept":
            "application/json, text/plain, */*",

        "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36",

        "Accept-Language":
            "en-US,en;q=0.9",

        "Origin":
            "https://www.terabox.app",

        "Referer":
            referer || "https://www.terabox.app/"
    };

    const cookie = getCookieHeader();

    if (cookie) {
        headers.Cookie = cookie;
    }

    return headers;
}


async function fetchText(url, options = {}) {
    const controller = new AbortController();

    const timeout = setTimeout(
        () => controller.abort(),
        30000
    );

    try {
        const response = await fetch(
            url,
            {
                ...options,
                signal: controller.signal,
                redirect: "follow"
            }
        );

        const text = await response.text();

        return {
            response,
            text
        };
    } finally {
        clearTimeout(timeout);
    }
}


async function requestJson(url, options = {}) {
    const result = await fetchText(
        url,
        options
    );

    let data;

    try {
        data = JSON.parse(result.text);
    } catch {
        throw new Error(
            "TeraBox returned an invalid JSON response."
        );
    }

    return {
        response: result.response,
        data
    };
}


// =======================================================
// RESOLVE SHARE PAGE
// =======================================================

async function openSharePage(inputUrl) {
    const surl = extractSurl(inputUrl);

    const pageUrl =
        "https://dm.terabox.app/sharing/link?surl=" +
        encodeURIComponent(
            surl.apiShorturl
        );

    const result = await fetchText(
        pageUrl,
        {
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36",

                "Accept":
                    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",

                "Accept-Language":
                    "en-US,en;q=0.9",

                ...(getCookieHeader()
                    ? {
                        Cookie:
                            getCookieHeader()
                    }
                    : {})
            }
        }
    );

    if (!result.response.ok) {
        throw new Error(
            "TeraBox share page returned HTTP " +
            result.response.status
        );
    }

    const jsToken =
        extractJsToken(result.text);

    if (!jsToken) {
        throw new Error(
            "TeraBox verification blocked automatic jsToken extraction. Add TERABOX_COOKIE in Render."
        );
    }

    const dpLogId =
        extractDpLogId(result.text);

    return {
        ...surl,
        pageUrl,
        jsToken,
        dpLogId
    };
}


// =======================================================
// GET SHARE INFORMATION
// =======================================================

async function getShareInfo(inputUrl) {
    const session =
        await openSharePage(inputUrl);

    const params = new URLSearchParams();

    params.set(
        "clientfrom",
        "h5"
    );

    params.set(
        "psign",
        "0"
    );

    params.set(
        "clienttype",
        "0"
    );

    params.set(
        "channel",
        "dubox"
    );

    params.set(
        "shorturl",
        session.apiShorturl
    );

    params.set(
        "root",
        "1"
    );

    params.set(
        "app_id",
        "250528"
    );

    params.set(
        "web",
        "1"
    );

    params.set(
        "jsToken",
        session.jsToken
    );

    if (session.dpLogId) {
        params.set(
            "dp-logid",
            session.dpLogId
        );
    }

    const url =
        "https://dm.terabox.app/api/shorturlinfo?" +
        params.toString();

    const result =
        await requestJson(
            url,
            {
                headers:
                    jsonHeaders(
                        session.pageUrl
                    )
            }
        );

    if (
        !result.data ||
        Number(result.data.errno) !== 0
    ) {
        throw new Error(
            result.data?.errmsg ||
            "TeraBox could not resolve this share."
        );
    }

    return {
        session,
        data: result.data
    };
}


// =======================================================
// DOWNLOAD LINK
// =======================================================

async function getDownloadLink(
    shareInfo,
    item
) {
    const session =
        shareInfo.session;

    const info =
        shareInfo.data;

    const params =
        new URLSearchParams();

    params.set(
        "app_id",
        "250528"
    );

    params.set(
        "web",
        "1"
    );

    params.set(
        "channel",
        "dubox"
    );

    params.set(
        "clienttype",
        "0"
    );

    params.set(
        "jsToken",
        session.jsToken
    );

    if (session.dpLogId) {
        params.set(
            "dp-logid",
            session.dpLogId
        );
    }

    params.set(
        "shareid",
        String(
            info.shareid
        )
    );

    params.set(
        "sign",
        String(
            info.sign
        )
    );

    params.set(
        "timestamp",
        String(
            info.timestamp
        )
    );

    const downloadUrl =
        "https://dm.terabox.app/share/download?" +
        params.toString();

    const body =
        new URLSearchParams();

    body.set(
        "product",
        "share"
    );

    body.set(
        "nozip",
        "0"
    );

    body.set(
        "fid_list",
        JSON.stringify([
            String(item.fs_id)
        ])
    );

    body.set(
        "uk",
        String(info.uk)
    );

    body.set(
        "primaryid",
        String(info.shareid)
    );


    const result =
        await requestJson(
            downloadUrl,
            {
                method: "POST",

                headers: {
                    ...jsonHeaders(
                        session.pageUrl
                    ),

                    "Content-Type":
                        "application/x-www-form-urlencoded; charset=UTF-8"
                },

                body:
                    body.toString(),

                redirect: "manual"
            }
        );


    if (
        !result.data ||
        Number(result.data.errno) !== 0
    ) {
        throw new Error(
            result.data?.errmsg ||
            "TeraBox could not create the download link."
        );
    }


    const dlink =
        result.data.dlink ||
        (
            Array.isArray(result.data.list) &&
            result.data.list[0] &&
            result.data.list[0].dlink
        );


    if (!dlink) {
        throw new Error(
            "TeraBox returned no download link."
        );
    }


    /*
    Some TeraBox responses return a temporary
    redirect URL. Follow it and return the final URL.
    */

    try {

        const redirectResponse =
            await fetch(
                dlink,
                {
                    method: "HEAD",

                    headers: {
                        "User-Agent":
                            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36",

                        "Referer":
                            session.pageUrl,

                        ...(getCookieHeader()
                            ? {
                                Cookie:
                                    getCookieHeader()
                            }
                            : {})
                    },

                    redirect: "manual"
                }
            );


        const location =
            redirectResponse.headers.get(
                "location"
            );


        if (location) {
            return location;
        }

    } catch {
        // Return original dlink below.
    }


    return dlink;
}


// =======================================================
// API ROUTES
// =======================================================

app.get(
    "/api/health",
    (req, res) => {

        res.json({
            ok: true,
            service:
                "TeraBox Downloader",
            status:
                "running"
        });

    }
);


app.post(
    "/api/resolve",
    async (req, res) => {

        try {

            const input =
                String(
                    req.body?.url || ""
                ).trim();


            if (!input) {

                return res.status(400).json({
                    ok: false,
                    error:
                        "Please enter a TeraBox URL."
                });

            }


            if (!isTeraBoxUrl(input)) {

                return res.status(400).json({
                    ok: false,
                    error:
                        "Please enter a valid TeraBox share URL."
                });

            }


            const shareInfo =
                await getShareInfo(input);


            const data =
                shareInfo.data;


            const files =
                Array.isArray(data.list)
                    ? data.list
                    : [];


            const results = [];


            for (
                const item of files
            ) {

                if (
                    String(
                        item.isdir
                    ) === "1"
                ) {
                    continue;
                }


                let downloadUrl = "";


                try {

                    downloadUrl =
                        await getDownloadLink(
                            shareInfo,
                            item
                        );

                } catch (downloadError) {

                    console.error(
                        "Download link error:",
                        downloadError.message
                    );

                }


                results.push({

                    fsId:
                        String(
                            item.fs_id || ""
                        ),

                    filename:
                        item.server_filename ||
                        "TeraBox File",

                    path:
                        item.path || "",

                    size:
                        Number(
                            item.size || 0
                        ),

                    md5:
                        item.md5 || "",

                    thumbnail:
                        item.thumbs?.url3 ||
                        item.thumbs?.url2 ||
                        item.thumbs?.url1 ||
                        item.thumbs?.icon ||
                        "",

                    downloadUrl
                });

            }


            if (!results.length) {

                return res.status(404).json({
                    ok: false,
                    error:
                        "No downloadable files were found."
                });

            }


            return res.json({

                ok: true,

                shareId:
                    String(
                        data.shareid || ""
                    ),

                uk:
                    String(
                        data.uk || ""
                    ),

                files:
                    results

            });


        } catch (error) {

            console.error(
                "Resolve error:",
                error
            );


            return res.status(500).json({

                ok: false,

                error:
                    error.message ||
                    "Could not resolve TeraBox link."

            });

        }

    }
);


// =======================================================
// FRONTEND
// =======================================================

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

<title>TeraBox Downloader</title>

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
            #111827 0,
            transparent 35%
        ),
        radial-gradient(
            circle at bottom right,
            #1e3a8a 0,
            transparent 35%
        ),
        #05070b;

    color: white;

    display: flex;
    align-items: center;
    justify-content: center;

    padding: 20px;
}

.container {
    width: 100%;
    max-width: 760px;
}

.card {
    background:
        rgba(15, 18, 25, 0.94);

    border:
        1px solid
        rgba(255,255,255,0.09);

    border-radius: 28px;

    padding: 38px;

    box-shadow:
        0 30px 100px
        rgba(0,0,0,0.55);
}

.logo {
    width: 68px;
    height: 68px;

    margin:
        0 auto 18px;

    border-radius: 20px;

    display: flex;
    align-items: center;
    justify-content: center;

    font-size: 28px;
    font-weight: 900;

    background:
        linear-gradient(
            135deg,
            #2563eb,
            #06b6d4
        );
}

h1 {
    text-align: center;

    margin: 0;

    font-size: 36px;

    letter-spacing: -1.5px;
}

.subtitle {
    color: #9ca3af;

    text-align: center;

    line-height: 1.6;

    margin:
        10px auto 28px;

    max-width: 600px;
}

.input-row {
    display: flex;

    gap: 10px;
}

input {
    flex: 1;

    min-width: 0;

    padding:
        17px 18px;

    background: #0b0e14;

    color: white;

    border:
        1px solid
        rgba(255,255,255,0.10);

    border-radius: 15px;

    outline: none;

    font-size: 15px;
}

input:focus {
    border-color: #3b82f6;

    box-shadow:
        0 0 0 3px
        rgba(59,130,246,0.12);
}

button {
    border: 0;

    border-radius: 15px;

    padding:
        0 25px;

    color: white;

    background:
        linear-gradient(
            135deg,
            #2563eb,
            #06b6d4
        );

    font-weight: 800;

    cursor: pointer;

    white-space: nowrap;
}

button:disabled {
    opacity: 0.55;

    cursor: not-allowed;
}

.status {
    display: none;

    margin-top: 22px;

    padding: 20px;

    border-radius: 18px;

    background:
        #0b0e14;

    border:
        1px solid
        rgba(255,255,255,0.08);
}

.message {
    color: #d1d5db;

    line-height: 1.5;

    font-size: 14px;
}

.error {
    color: #fca5a5;
}

.success {
    color: #86efac;
}

.file-list {
    display: grid;

    gap: 12px;

    margin-top: 18px;
}

.file {
    display: flex;

    gap: 15px;

    align-items: center;

    padding: 15px;

    border-radius: 16px;

    background:
        #11151e;

    border:
        1px solid
        rgba(255,255,255,0.07);
}

.thumb {
    width: 72px;
    height: 54px;

    flex-shrink: 0;

    border-radius: 10px;

    object-fit: cover;

    background: #05070b;
}

.info {
    min-width: 0;

    flex: 1;
}

.name {
    font-weight: 700;

    white-space: nowrap;

    overflow: hidden;

    text-overflow: ellipsis;
}

.size {
    color: #71717a;

    font-size: 12px;

    margin-top: 4px;
}

.save {
    text-decoration: none;

    color: white;

    background: #1f2937;

    padding:
        10px 14px;

    border-radius: 10px;

    font-size: 13px;

    font-weight: 800;
}

.save:hover {
    background: #374151;
}

.note {
    color: #52525b;

    font-size: 11px;

    text-align: center;

    margin-top: 22px;
}

@media (max-width: 620px) {

    .card {
        padding: 25px 18px;
    }

    h1 {
        font-size: 30px;
    }

    .input-row {
        flex-direction: column;
    }

    button {
        min-height: 52px;
    }

    .file {
        align-items: flex-start;

        flex-wrap: wrap;
    }

    .save {
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
TB
</div>

<h1>
TeraBox Downloader
</h1>

<p class="subtitle">
Download files from public TeraBox share links.
</p>

<div class="input-row">

<input
    id="urlInput"
    type="url"
    placeholder="Paste TeraBox share link..."
    autocomplete="off"
>

<button
    id="resolveButton"
    type="button"
>
Get File
</button>

</div>

<div
    id="status"
    class="status"
>

<div
    id="message"
    class="message"
>
Ready.
</div>

<div
    id="fileList"
    class="file-list"
></div>

</div>

<div class="note">
Personal-use downloader
</div>

</div>

</div>


<script>

"use strict";

(function () {

    const urlInput =
        document.getElementById(
            "urlInput"
        );

    const resolveButton =
        document.getElementById(
            "resolveButton"
        );

    const status =
        document.getElementById(
            "status"
        );

    const message =
        document.getElementById(
            "message"
        );

    const fileList =
        document.getElementById(
            "fileList"
        );


    function formatSize(bytes) {

        const n =
            Number(bytes) || 0;


        if (n < 1024) {
            return n + " B";
        }


        if (
            n <
            1024 * 1024
        ) {
            return (
                n / 1024
            ).toFixed(1) +
            " KB";
        }


        if (
            n <
            1024 * 1024 * 1024
        ) {
            return (
                n /
                (1024 * 1024)
            ).toFixed(1) +
            " MB";
        }


        return (
            n /
            (1024 * 1024 * 1024)
        ).toFixed(1) +
        " GB";
    }


    function setMessage(
        text,
        type
    ) {

        status.style.display =
            "block";

        message.textContent =
            text;

        message.className =
            "message " +
            (type || "");

    }


    function clearFiles() {

        fileList.innerHTML =
            "";

    }


    function renderFiles(files) {

        clearFiles();


        for (
            const file of files
        ) {

            const item =
                document.createElement(
                    "div"
                );

            item.className =
                "file";


            if (file.thumbnail) {

                const image =
                    document.createElement(
                        "img"
                    );

                image.className =
                    "thumb";

                image.src =
                    file.thumbnail;

                image.alt =
                    "";

                item.appendChild(
                    image
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
                "TeraBox File";


            const size =
                document.createElement(
                    "div"
                );

            size.className =
                "size";

            size.textContent =
                formatSize(
                    file.size
                );


            info.appendChild(
                name
            );

            info.appendChild(
                size
            );


            item.appendChild(
                info
            );


            if (file.downloadUrl) {

                const link =
                    document.createElement(
                        "a"
                    );

                link.className =
                    "save";

                link.href =
                    file.downloadUrl;

                link.target =
                    "_blank";

                link.rel =
                    "noopener noreferrer";

                link.textContent =
                    "Download";


                item.appendChild(
                    link
                );

            }


            fileList.appendChild(
                item
            );

        }

    }


    async function resolve() {

        const url =
            urlInput.value.trim();


        if (!url) {

            setMessage(
                "Paste a TeraBox link first.",
                "error"
            );

            return;
        }


        resolveButton.disabled =
            true;

        resolveButton.textContent =
            "Resolving...";


        clearFiles();


        setMessage(
            "Connecting to TeraBox..."
        );


        try {

            const response =
                await fetch(
                    "/api/resolve",
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


            const data =
                await response.json();


            if (
                !response.ok ||
                !data.ok
            ) {

                throw new Error(
                    data.error ||
                    "Could not resolve the TeraBox link."
                );

            }


            renderFiles(
                data.files || []
            );


            setMessage(
                data.files.length === 1
                    ? "File ready to download."
                    : data.files.length +
                      " files ready to download.",
                "success"
            );


        } catch (error) {

            setMessage(
                error.message ||
                "Something went wrong.",
                "error"
            );

        } finally {

            resolveButton.disabled =
                false;

            resolveButton.textContent =
                "Get File";

        }

    }


    resolveButton.addEventListener(
        "click",
        resolve
    );


    urlInput.addEventListener(
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

    }
);


// =======================================================
// START
// =======================================================

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            "======================================"
        );

        console.log(
            "TeraBox Downloader running on port " +
            PORT
        );

        console.log(
            "======================================"
        );

    }
);
```
