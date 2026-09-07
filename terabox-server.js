const express = require("express");
const { TeraBoxApp } = require("@cfbeg/terabox-api");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());


// =====================================================
// TeraBox client
// =====================================================

async function createClient() {
    const ndus = String(
        process.env.TERABOX_NDUS || ""
    ).trim();

    if (!ndus) {
        throw new Error(
            "TERABOX_NDUS is missing in Render."
        );
    }

    const tb = new TeraBoxApp(
        ndus,
        "ndus"
    );

    const login = await tb.checkLogin();

    if (!login || Number(login.errno) !== 0) {
        throw new Error(
            "TeraBox session is invalid or expired."
        );
    }

    return tb;
}


// =====================================================
// Helpers
// =====================================================

function getList(result) {
    if (Array.isArray(result?.list)) {
        return result.list;
    }

    if (Array.isArray(result?.data?.list)) {
        return result.data.list;
    }

    if (Array.isArray(result?.records)) {
        return result.records;
    }

    if (Array.isArray(result?.data?.records)) {
        return result.data.records;
    }

    return [];
}


function normalizeFile(file) {
    return {
        fs_id: String(
            file?.fs_id ||
            file?.fsId ||
            ""
        ),

        filename:
            file?.server_filename ||
            file?.filename ||
            file?.name ||
            "Unnamed",

        path:
            file?.path ||
            "",

        size:
            Number(file?.size || 0),

        isdir:
            String(file?.isdir || "0"),

        thumbnail:
            file?.thumbs?.url3 ||
            file?.thumbs?.url2 ||
            file?.thumbs?.url1 ||
            file?.thumbs?.icon ||
            ""
    };
}


function formatBytes(bytes) {
    const n = Number(bytes) || 0;

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

    return (
        n /
        (1024 * 1024 * 1024)
    ).toFixed(1) + " GB";
}


// =====================================================
// Health
// =====================================================

app.get("/api/health", (req, res) => {
    res.json({
        ok: true,
        service: "TeraBox Downloader",
        status: "running"
    });
});


// =====================================================
// Files
// =====================================================

app.get("/api/files", async (req, res) => {
    try {
        const requestedPath =
            String(req.query.path || "/").trim();

        const remotePath =
            requestedPath.startsWith("/")
                ? requestedPath
                : "/" + requestedPath;

        const tb = await createClient();

        console.log(
            "Loading TeraBox directory:",
            remotePath
        );

        const result =
            await tb.getRemoteDir(
                remotePath
            );

        const files =
            getList(result).map(
                normalizeFile
            );

        return res.json({
            ok: true,
            path: remotePath,
            files
        });

    } catch (error) {
        console.error(
            "Files error:",
            error.message
        );

        return res.status(500).json({
            ok: false,
            error:
                error.message ||
                "Could not load TeraBox files."
        });
    }
});


// =====================================================
// Search
// =====================================================

app.get("/api/search", async (req, res) => {
    try {
        const query =
            String(req.query.q || "").trim();

        if (!query) {
            return res.status(400).json({
                ok: false,
                error:
                    "Enter a search term."
            });
        }

        const tb = await createClient();

        console.log(
            "Searching TeraBox:",
            query
        );

        const result =
            await tb.search(
                query,
                1
            );

        const files =
            getList(result).map(
                normalizeFile
            );

        return res.json({
            ok: true,
            query,
            files
        });

    } catch (error) {
        console.error(
            "Search error:",
            error.message
        );

        return res.status(500).json({
            ok: false,
            error:
                error.message ||
                "Search failed."
        });
    }
});


// =====================================================
// Download
// =====================================================

app.post("/api/download", async (req, res) => {
    try {
        const fsIds =
            Array.isArray(req.body?.fsIds)
                ? req.body.fsIds
                : [];

        const ids =
            fsIds
                .map(
                    value =>
                        Number(value)
                )
                .filter(
                    Number.isFinite
                );

        if (!ids.length) {
            return res.status(400).json({
                ok: false,
                error:
                    "No valid file ID."
            });
        }

        const tb = await createClient();

        console.log(
            "Generating download link..."
        );

        let result;

        try {
            const home =
                await tb.getHomeInfo();

            const signb =
                home?.data?.signb ||
                home?.signb ||
                "";

            if (signb) {
                result =
                    await tb.download(
                        ids,
                        signb
                    );
            } else {
                result =
                    await tb.download(
                        ids
                    );
            }

        } catch (error) {
            console.log(
                "Primary download call failed:",
                error.message
            );

            result =
                await tb.download(
                    ids
                );
        }

        if (
            !result ||
            Number(result.errno || 0) !== 0
        ) {
            throw new Error(
                result?.errmsg ||
                "TeraBox could not create a download link."
            );
        }

        const links =
            Array.isArray(result?.dlink)
                ? result.dlink
                : Array.isArray(
                    result?.data?.dlink
                )
                    ? result.data.dlink
                    : [];

        const output =
            links.map(
                item => ({
                    fs_id:
                        String(
                            item?.fs_id || ""
                        ),

                    downloadUrl:
                        String(
                            item?.dlink || ""
                        )
                })
            );

        return res.json({
            ok: true,
            links: output
        });

    } catch (error) {
        console.error(
            "Download error:",
            error.message
        );

        return res.status(500).json({
            ok: false,
            error:
                error.message ||
                "Download failed."
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
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TeraBox Downloader</title>

<style>
* {
    box-sizing: border-box;
}

body {
    margin: 0;
    min-height: 100vh;
    font-family: Arial, sans-serif;
    background: #07101b;
    color: white;
    padding: 20px;
}

.container {
    max-width: 950px;
    margin: 0 auto;
}

.card {
    background: #111827;
    border: 1px solid #243041;
    border-radius: 24px;
    padding: 28px;
    box-shadow: 0 25px 70px rgba(0,0,0,.45);
}

.header {
    display: flex;
    align-items: center;
    gap: 15px;
    margin-bottom: 25px;
}

.logo {
    width: 58px;
    height: 58px;
    border-radius: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 900;
    background: linear-gradient(135deg,#2563eb,#06b6d4);
}

h1 {
    margin: 0;
    font-size: 28px;
}

.subtitle {
    margin: 4px 0 0;
    color: #94a3b8;
    font-size: 13px;
}

.search {
    display: flex;
    gap: 10px;
    margin-bottom: 20px;
}

input {
    flex: 1;
    min-width: 0;
    padding: 15px;
    border-radius: 12px;
    border: 1px solid #334155;
    background: #09111d;
    color: white;
    outline: none;
}

button {
    border: 0;
    border-radius: 12px;
    padding: 0 20px;
    background: linear-gradient(135deg,#2563eb,#06b6d4);
    color: white;
    font-weight: bold;
    cursor: pointer;
}

button:disabled {
    opacity: .5;
    cursor: not-allowed;
}

.toolbar {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 15px;
}

.path {
    color: #94a3b8;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.status {
    min-height: 20px;
    margin-bottom: 12px;
    color: #94a3b8;
    font-size: 13px;
}

.error {
    color: #fca5a5;
}

.success {
    color: #86efac;
}

.files {
    display: grid;
    gap: 10px;
}

.file {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px;
    border-radius: 14px;
    background: #0a1320;
    border: 1px solid #1e293b;
}

.icon {
    width: 46px;
    height: 46px;
    border-radius: 12px;
    display: flex;
    justify-content: center;
    align-items: center;
    background: #172033;
    font-size: 19px;
    flex-shrink: 0;
}

.info {
    flex: 1;
    min-width: 0;
}

.name {
    font-weight: bold;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.meta {
    margin-top: 4px;
    color: #64748b;
    font-size: 11px;
}

.action {
    background: #1e293b;
    padding: 9px 13px;
    border-radius: 10px;
    font-size: 12px;
}

.empty {
    text-align: center;
    padding: 30px;
    color: #64748b;
}

@media (max-width: 650px) {
    .card {
        padding: 20px 15px;
    }

    .search {
        flex-direction: column;
    }

    button {
        min-height: 48px;
    }

    .file {
        align-items: flex-start;
        flex-wrap: wrap;
    }

    .action {
        width: 100%;
    }
}
</style>
</head>

<body>

<div class="container">
<div class="card">

<div class="header">
<div class="logo">TB</div>

<div>
<h1>TeraBox Downloader</h1>
<div class="subtitle">
Browse and download your TeraBox files
</div>
</div>
</div>

<div class="search">

<input
    id="searchInput"
    type="text"
    placeholder="Search your files..."
    autocomplete="off"
>

<button id="searchButton" type="button">
Search
</button>

</div>

<div class="toolbar">

<div id="path" class="path">/</div>

<button id="homeButton" type="button">
My Files
</button>

</div>

<div id="status" class="status">
Loading...
</div>

<div id="files" class="files"></div>

</div>
</div>

<script>
(function () {

    const searchInput =
        document.getElementById("searchInput");

    const searchButton =
        document.getElementById("searchButton");

    const homeButton =
        document.getElementById("homeButton");

    const status =
        document.getElementById("status");

    const filesBox =
        document.getElementById("files");

    const pathBox =
        document.getElementById("path");


    function formatSize(bytes) {

        const n =
            Number(bytes) || 0;

        if (n < 1024) {
            return n + " B";
        }

        if (n < 1024 * 1024) {
            return (
                n / 1024
            ).toFixed(1) + " KB";
        }

        if (
            n <
            1024 * 1024 * 1024
        ) {
            return (
                n /
                (1024 * 1024)
            ).toFixed(1) + " MB";
        }

        return (
            n /
            (1024 * 1024 * 1024)
        ).toFixed(1) + " GB";
    }


    function show(
        text,
        type
    ) {

        status.textContent =
            text || "";

        status.className =
            "status " +
            (type || "");

    }


    function getIcon(
        file
    ) {

        if (file.isdir) {
            return "📁";
        }

        const name =
            String(
                file.filename || ""
            ).toLowerCase();

        if (
            /\\.(mp4|mkv|mov|webm|avi)$/.test(
                name
            )
        ) {
            return "🎬";
        }

        if (
            /\\.(jpg|jpeg|png|webp|gif|avif)$/.test(
                name
            )
        ) {
            return "🖼️";
        }

        if (
            /\\.(mp3|wav|m4a|flac)$/.test(
                name
            )
        ) {
            return "🎵";
        }

        if (
            /\\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt)$/.test(
                name
            )
        ) {
            return "📄";
        }

        return "📦";
    }


    function renderFiles(
        files
    ) {

        filesBox.innerHTML = "";

        if (!files.length) {

            const empty =
                document.createElement(
                    "div"
                );

            empty.className =
                "empty";

            empty.textContent =
                "No files found.";

            filesBox.appendChild(
                empty
            );

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


                const icon =
                    document.createElement(
                        "div"
                    );

                icon.className =
                    "icon";

                icon.textContent =
                    getIcon(file);


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
                    "Unnamed";


                const meta =
                    document.createElement(
                        "div"
                    );

                meta.className =
                    "meta";

                meta.textContent =
                    file.isdir
                        ? "Folder"
                        : "File • " +
                          formatSize(
                              file.size
                          );


                info.appendChild(
                    name
                );

                info.appendChild(
                    meta
                );


                const action =
                    document.createElement(
                        "button"
                    );

                action.className =
                    "action";


                if (file.isdir) {

                    action.textContent =
                        "Open";

                    action.addEventListener(
                        "click",
                        function () {

                            loadFolder(
                                file.path ||
                                "/"
                            );

                        }
                    );

                } else {

                    action.textContent =
                        "Download";

                    action.addEventListener(
                        "click",
                        function () {

                            downloadFile(
                                file
                            );

                        }
                    );

                }


                row.appendChild(
                    icon
                );

                row.appendChild(
                    info
                );

                row.appendChild(
                    action
                );

                filesBox.appendChild(
                    row
                );

            }
        );

    }


    async function loadFolder(
        folderPath
    ) {

        const path =
            folderPath || "/";

        pathBox.textContent =
            path;

        show(
            "Loading files..."
        );

        filesBox.innerHTML =
            "";


        try {

            const response =
                await fetch(
                    "/api/files?path=" +
                    encodeURIComponent(
                        path
                    ),
                    {
                        cache:
                            "no-store"
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
                    "Could not load files."
                );
            }


            renderFiles(
                Array.isArray(
                    data.files
                )
                    ? data.files
                    : []
            );


            show(
                (
                    data.files ||
                    []
                ).length +
                " item(s)"
            );

        } catch (error) {

            show(
                error.message ||
                "Could not load files.",
                "error"
            );

        }

    }


    async function search() {

        const query =
            searchInput.value.trim();


        if (!query) {

            loadFolder(
                "/"
            );

            return;
        }


        show(
            "Searching..."
        );

        filesBox.innerHTML =
            "";


        try {

            const response =
                await fetch(
                    "/api/search?q=" +
                    encodeURIComponent(
                        query
                    ),
                    {
                        cache:
                            "no-store"
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
                    "Search failed."
                );
            }


            pathBox.textContent =
                "Search: " +
                query;


            renderFiles(
                Array.isArray(
                    data.files
                )
                    ? data.files
                    : []
            );


            show(
                (
                    data.files ||
                    []
                ).length +
                " result(s)"
            );

        } catch (error) {

            show(
                error.message ||
                "Search failed.",
                "error"
            );

        }

    }


    async function downloadFile(
        file
    ) {

        show(
            "Generating download link..."
        );


        try {

            const response =
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
                                fsIds: [
                                    file.fs_id
                                ]
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
                    "Download link failed."
                );
            }


            const item =
                Array.isArray(
                    data.links
                )
                    ? data.links[0]
                    : null;


            if (
                !item ||
                !item.downloadUrl
            ) {
                throw new Error(
                    "TeraBox returned no download URL."
                );
            }


            const link =
                document.createElement(
                    "a"
                );

            link.href =
                item.downloadUrl;

            link.target =
                "_blank";

            link.rel =
                "noopener noreferrer";

            document.body.appendChild(
                link
            );

            link.click();

            link.remove();


            show(
                "Download link opened.",
                "success"
            );

        } catch (error) {

            show(
                error.message ||
                "Download failed.",
                "error"
            );

        }

    }


    searchButton.addEventListener(
        "click",
        search
    );


    homeButton.addEventListener(
        "click",
        function () {

            searchInput.value =
                "";

            loadFolder(
                "/"
            );

        }
    );


    searchInput.addEventListener(
        "keydown",
        function (event) {

            if (
                event.key ===
                "Enter"
            ) {
                search();
            }

        }
    );


    loadFolder(
        "/"
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
    () => {
        console.log(
            "TeraBox Downloader running on port " +
            PORT
        );
    }
);
