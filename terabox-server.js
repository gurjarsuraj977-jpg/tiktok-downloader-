const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

function extractSurl(input) {
    const value = String(input || "").trim();

    let match = value.match(/[?&]surl=([A-Za-z0-9_-]+)/i);

    if (!match) {
        match = value.match(/\/s\/([A-Za-z0-9_-]+)/i);
    }

    if (!match) {
        throw new Error("Could not extract the TeraBox share code.");
    }

    const key = match[1];

    return {
        surl: key.startsWith("1") ? key.slice(1) : key,
        apiSurl: key.startsWith("1") ? key : "1" + key
    };
}

function isTeraBoxUrl(input) {
    try {
        const hostname = new URL(input).hostname.toLowerCase();

        return [
            "terabox.com",
            "www.terabox.com",
            "terabox.app",
            "www.terabox.app",
            "teraboxshare.com",
            "www.teraboxshare.com",
            "1024terabox.com",
            "www.1024terabox.com",
            "1024tera.com",
            "www.1024tera.com"
        ].includes(hostname);
    } catch {
        return false;
    }
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

function getCookie() {
    return String(
        process.env.TERABOX_COOKIE || ""
    ).trim();
}

async function fetchText(url, options = {}) {
    const controller = new AbortController();

    const timer = setTimeout(
        () => controller.abort(),
        30000
    );

    try {
        const headers = {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36",
            "Accept":
                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language":
                "en-US,en;q=0.9",
            ...(options.headers || {})
        };

        const cookie = getCookie();

        if (cookie) {
            headers.Cookie = cookie;
        }

        const response = await fetch(
            url,
            {
                ...options,
                headers,
                signal: controller.signal,
                redirect: "follow"
            }
        );

        return {
            response,
            text: await response.text()
        };
    } finally {
        clearTimeout(timer);
    }
}

async function fetchJson(url, options = {}) {
    const result = await fetchText(
        url,
        options
    );

    let data;

    try {
        data = JSON.parse(result.text);
    } catch {
        throw new Error(
            "TeraBox returned non-JSON data."
        );
    }

    return {
        response: result.response,
        data
    };
}

async function resolveTeraBox(url) {
    const parsed = extractSurl(url);

    const sharePage =
        "https://dm.terabox.app/sharing/link?surl=" +
        encodeURIComponent(parsed.apiSurl);

    const page = await fetchText(
        sharePage
    );

    if (!page.response.ok) {
        throw new Error(
            "TeraBox share page returned HTTP " +
            page.response.status
        );
    }

const jsToken =
    process.env.TERABOX_JSTOKEN ||
    extractJsToken(page.text);

if (!jsToken) {
    throw new Error(
        "No TeraBox jsToken available. Add TERABOX_JSTOKEN in Render."
    );
}

    const dpLogId =
        extractDpLogId(page.text);

    const apiUrl =
        "https://dm.terabox.app/share/list?" +
        new URLSearchParams({
            app_id: "250528",
            jsToken: jsToken,
            dpLogId: dpLogId,
            shorturl: parsed.surl,
            root: "1",
            page: "1",
            num: "20"
        }).toString();

    const result =
        await fetchJson(
            apiUrl,
            {
                headers: {
                    "Accept":
                        "application/json, text/plain, */*",
                    "Referer":
                        sharePage,
                    "Origin":
                        "https://dm.terabox.app"
                }
            }
        );

    if (
        !result.data ||
        Number(result.data.errno) !== 0
    ) {
        throw new Error(
            result.data?.errmsg ||
            "TeraBox share/list request failed."
        );
    }

    return result.data;
}

app.get(
    "/api/health",
    (req, res) => {
        res.json({
            ok: true,
            service: "TeraBox Downloader",
            status: "running"
        });
    }
);

app.post(
    "/api/resolve",
    async (req, res) => {
        try {
            const url =
                String(
                    req.body?.url || ""
                ).trim();

            if (!url) {
                return res.status(400).json({
                    ok: false,
                    error:
                        "Please enter a TeraBox URL."
                });
            }

            if (!isTeraBoxUrl(url)) {
                return res.status(400).json({
                    ok: false,
                    error:
                        "Please enter a valid TeraBox share URL."
                });
            }

            const data =
                await resolveTeraBox(url);

            const files =
                Array.isArray(data.list)
                    ? data.list
                    : [];

            const output =
                files
                    .filter(
                        file =>
                            String(file.isdir) !== "1"
                    )
                    .map(file => ({
                        filename:
                            file.server_filename ||
                            "TeraBox file",

                        size:
                            Number(file.size || 0),

                        fs_id:
                            String(file.fs_id || ""),

                        thumbnail:
                            file.thumbs?.url3 ||
                            file.thumbs?.url2 ||
                            file.thumbs?.url1 ||
                            file.thumbs?.icon ||
                            "",

                        dlink:
                            file.dlink || ""
                    }));

            return res.json({
                ok: true,
                shareid:
                    String(data.shareid || ""),
                uk:
                    String(data.uk || ""),
                files: output
            });

        } catch (error) {
            console.error(
                "TeraBox resolve error:",
                error.message
            );

            return res.status(500).json({
                ok: false,
                error:
                    error.message ||
                    "TeraBox resolution failed."
            });
        }
    }
);

app.get(
    "/",
    (req, res) => {
        res.send(`
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TeraBox Downloader</title>
<style>
body {
    margin: 0;
    min-height: 100vh;
    background: #070b12;
    color: white;
    font-family: Arial, sans-serif;
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 20px;
}
.card {
    width: 100%;
    max-width: 700px;
    background: #111827;
    padding: 30px;
    border-radius: 24px;
    border: 1px solid #243041;
}
h1 {
    text-align: center;
}
p {
    text-align: center;
    color: #9ca3af;
}
.row {
    display: flex;
    gap: 10px;
    margin-top: 25px;
}
input {
    flex: 1;
    padding: 16px;
    border-radius: 12px;
    border: 1px solid #374151;
    background: #0b1220;
    color: white;
}
button {
    border: 0;
    padding: 0 22px;
    border-radius: 12px;
    background: #2563eb;
    color: white;
    font-weight: bold;
    cursor: pointer;
}
button:disabled {
    opacity: .5;
}
#status {
    margin-top: 20px;
    color: #d1d5db;
}
.file {
    margin-top: 12px;
    padding: 15px;
    border-radius: 14px;
    background: #0b1220;
    display: flex;
    gap: 12px;
    align-items: center;
}
.file img {
    width: 70px;
    height: 55px;
    object-fit: cover;
    border-radius: 8px;
}
.info {
    flex: 1;
}
.name {
    font-weight: bold;
}
.size {
    color: #6b7280;
    font-size: 12px;
    margin-top: 4px;
}
</style>
</head>

<body>

<div class="card">

<h1>TeraBox Downloader</h1>

<p>Paste a public TeraBox share link</p>

<div class="row">

<input
    id="url"
    placeholder="https://teraboxshare.com/s/..."
>

<button id="btn">
    Resolve
</button>

</div>

<div id="status"></div>

<div id="files"></div>

</div>

<script>
(function () {

    const input =
        document.getElementById("url");

    const button =
        document.getElementById("btn");

    const status =
        document.getElementById("status");

    const files =
        document.getElementById("files");

    function size(bytes) {

        if (!bytes) {
            return "0 B";
        }

        if (bytes < 1024) {
            return bytes + " B";
        }

        if (bytes < 1024 * 1024) {
            return (
                bytes / 1024
            ).toFixed(1) + " KB";
        }

        if (bytes < 1024 * 1024 * 1024) {
            return (
                bytes /
                (1024 * 1024)
            ).toFixed(1) + " MB";
        }

        return (
            bytes /
            (1024 * 1024 * 1024)
        ).toFixed(1) + " GB";
    }

    async function resolve() {

        const url =
            input.value.trim();

        if (!url) {
            status.textContent =
                "Paste a TeraBox URL first.";
            return;
        }

        button.disabled = true;
        button.textContent = "Resolving...";

        status.textContent =
            "Contacting TeraBox...";

        files.innerHTML = "";

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
                    "Could not resolve link."
                );
            }

            if (!data.files.length) {
                throw new Error(
                    "No files found."
                );
            }

            data.files.forEach(
                function (file) {

                    const div =
                        document.createElement(
                            "div"
                        );

                    div.className = "file";

                    if (file.thumbnail) {

                        const img =
                            document.createElement(
                                "img"
                            );

                        img.src =
                            file.thumbnail;

                        div.appendChild(img);
                    }

                    const info =
                        document.createElement(
                            "div"
                        );

                    info.className = "info";

                    const name =
                        document.createElement(
                            "div"
                        );

                    name.className = "name";

                    name.textContent =
                        file.filename;

                    const fileSize =
                        document.createElement(
                            "div"
                        );

                    fileSize.className = "size";

                    fileSize.textContent =
                        size(file.size);

                    info.appendChild(name);
                    info.appendChild(fileSize);

                    div.appendChild(info);

                    files.appendChild(div);

                }
            );

            status.textContent =
                data.files.length +
                " file(s) found.";

        } catch (error) {

            status.textContent =
                error.message ||
                "Something went wrong.";

        } finally {

            button.disabled = false;
            button.textContent = "Resolve";

        }
    }

    button.addEventListener(
        "click",
        resolve
    );

    input.addEventListener(
        "keydown",
        function (event) {
            if (event.key === "Enter") {
                resolve();
            }
        }
    );

})();
</script>

</body>
</html>
`);
    }
);

app.listen(
    PORT,
    "0.0.0.0",
    () => {
        console.log(
            "TeraBox Downloader running on port " +
            PORT
        );
    }
);
