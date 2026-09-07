
const express = require("express");
const { TeraBoxApp } = require("@cfbeg/terabox-api");

const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.json());


// ============================================================
// TeraBox client
// ============================================================

async function createClient() {
    const ndus =
        String(
            process.env.TERABOX_NDUS || ""
        ).trim();

    if (!ndus) {
        throw new Error(
            "TERABOX_NDUS is missing in Render."
        );
    }

    const tb =
        new TeraBoxApp(
            ndus,
            "ndus"
        );

    const login =
        await tb.checkLogin();

    if (
        !login ||
        Number(login.errno) !== 0
    ) {
        throw new Error(
            "TeraBox session is invalid or expired."
        );
    }

    return tb;
}


// ============================================================
// Helpers
// ============================================================

function extractEntries(response) {
    const possible =
        [
            response?.data?.list,
            response?.list,
            response?.data?.records,
            response?.records,
            response?.data?.entries,
            response?.entries
        ];

    for (
        const value of possible
    ) {
        if (Array.isArray(value)) {
            return value;
        }
    }

    return [];
}


function normalizeFile(file) {
    const isDir =
        String(
            file?.isdir ??
            file?.is_dir ??
            file?.category === "folder"
                ? "1"
                : "0"
        ) === "1";

    return {
        fs_id:
            String(
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
            Number(
                file?.size || 0
            ),

        isdir: isDir,

        category:
            String(
                file?.category || ""
            ),

        mtime:
            Number(
                file?.server_mtime ||
                file?.mtime ||
                file?.local_mtime ||
                0
            ),

        thumbnail:
            file?.thumbs?.url3 ||
            file?.thumbs?.url2 ||
            file?.thumbs?.url1 ||
            file?.thumbs?.icon ||
            ""
    };
}


function formatBytes(bytes) {
    const n =
        Number(bytes) || 0;

    if (n === 0) {
        return "0 B";
    }

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


// ============================================================
// Root / Files
// ============================================================

app.get(
    "/api/files",
    async (req, res) => {

        try {

            const rawPath =
                String(
                    req.query.path ||
                    "/"
                ).trim();


            const remotePath =
                rawPath.startsWith("/")
                    ? rawPath
                    : "/" + rawPath;


            const page =
                Math.max(
                    1,
                    Number(
                        req.query.page || 1
                    )
                );


            const tb =
                await createClient();


            console.log(
                "Listing TeraBox directory:",
                remotePath,
                "page:",
                page
            );


            const result =
                await tb.getRemoteDir(
                    remotePath,
                    page
                );


            const entries =
                extractEntries(
                    result
                );


            const files =
                entries.map(
                    normalizeFile
                );


            return res.json({

                ok: true,

                path:
                    remotePath,

                page,

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

    }
);


// ============================================================
// Search
// ============================================================

app.get(
    "/api/search",
    async (req, res) => {

        try {

            const term =
                String(
                    req.query.q ||
                    ""
                ).trim();


            if (!term) {

                return res.status(400).json({
                    ok: false,
                    error:
                        "Enter something to search."
                });

            }


            const page =
                Math.max(
                    1,
                    Number(
                        req.query.page || 1
                    )
                );


            const tb =
                await createClient();


            console.log(
                "Searching TeraBox:",
                term
            );


            const result =
                await tb.search(
                    term,
                    page
                );


            const entries =
                extractEntries(
                    result
                );


            const files =
                entries.map(
                    normalizeFile
                );


            return res.json({

                ok: true,

                query:
                    term,

                page,

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
                    "TeraBox search failed."

            });

        }

    }
);


// ============================================================
// Generate download link
// ============================================================

app.post(
    "/api/download",
    async (req, res) => {

        try {

            const fsIds =
                Array.isArray(
                    req.body?.fsIds
                )
                    ? req.body.fsIds
                    : [];


            const numericIds =
                fsIds
                    .map(
                        value =>
                            Number(value)
                    )
                    .filter(
                        Number.isFinite
                    );


            if (!numericIds.length) {

                return res.status(400).json({
                    ok: false,
                    error:
                        "No valid file ID was supplied."
                });

            }


            const tb =
                await createClient();


            console.log(
                "Generating download link for",
                numericIds.length,
                "file(s)."
            );


            let result;


            /*
             * Current @cfbeg/terabox-api documents
             * download(fs_ids, signb).
             */

            try {

                const home =
                    await tb.getHomeInfo();


                const signb =
                    home?.data?.signb ||
                    home?.signb ||
                    "";


                if (!signb) {
                    throw new Error(
                        "TeraBox did not provide signb."
                    );
                }


                result =
                    await tb.download(
                        numericIds,
                        signb
                    );


            } catch (error) {

                console.log(
                    "Standard download call failed:",
                    error.message
                );


                /*
                 * Compatibility fallback because our
                 * earlier Render test proved download(fsIds)
                 * works on this installed package.
                 */

                result =
                    await tb.download(
                        numericIds
                    );

            }


            if (
                !result ||
                Number(result.errno || 0) !== 0
            ) {

                throw new Error(
                    result?.errmsg ||
                    "TeraBox could not generate a download link."
                );

            }


            const links =
                Array.isArray(
                    result.dlink
                )
                    ? result.dlink
                    : (
                        Array.isArray(
                            result?.data?.dlink
                        )
                            ? result.data.dlink
                            : []
                    );


            const output =
                links.map(
                    item => ({
                        fs_id:
                            String(
                                item.fs_id ||
                                ""
                            ),

                        downloadUrl:
                            String(
                                item.dlink ||
                                ""
                            )
                    })
                );


            return res.json({

                ok: true,

                links:
                    output

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
                    "Could not create download link."

            });

        }

    }
);


// ============================================================
// Account
// ============================================================

app.get(
    "/api/account",
    async (req, res) => {

        try {

            const tb =
                await createClient();


            let user = null;

            try {

                user =
                    await tb.getCurrentUserInfo();

            } catch {
                // Optional.
            }


            let quota = null;

            try {

                quota =
                    await tb.getQuota();

            } catch {
                // Optional.
            }


            return res.json({

                ok: true,

                user,

                quota

            });


        } catch (error) {

            return res.status(500).json({

                ok: false,

                error:
                    error.message ||
                    "Could not load account."

            });

        }

    }
);


// ============================================================
// Health
// ============================================================

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


// ============================================================
// FRONTEND
// ============================================================

app.get(
    "/",
    (req, res) => {

        const html = [
            "<!DOCTYPE html>",
            "<html lang=\"en\">",
            "<head>",

            "<meta charset=\"UTF-8\">",

            "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",

            "<title>TeraBox Downloader</title>",

            "<style>",

            "*{box-sizing:border-box}",

            "body{",
            "margin:0;",
            "min-height:100vh;",
            "font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;",
            "background:radial-gradient(circle at top left,#172554 0,transparent 34%),radial-gradient(circle at bottom right,#164e63 0,transparent 34%),#05080d;",
            "color:#fff;",
            "padding:20px",
            "}",

            ".container{",
            "width:100%;",
            "max-width:1050px;",
            "margin:0 auto",
            "}",

            ".card{",
            "background:rgba(15,23,42,.96);",
            "border:1px solid rgba(255,255,255,.08);",
            "border-radius:28px;",
            "padding:30px;",
            "box-shadow:0 30px 100px rgba(0,0,0,.5)",
            "}",

            ".top{",
            "display:flex;",
            "align-items:center;",
            "justify-content:space-between;",
            "gap:20px;",
            "margin-bottom:24px",
            "}",

            ".brand{",
            "display:flex;",
            "align-items:center;",
            "gap:14px",
            "}",

            ".logo{",
            "width:58px;",
            "height:58px;",
            "display:flex;",
            "align-items:center;",
            "justify-content:center;",
            "border-radius:17px;",
            "font-weight:900;",
            "font-size:20px;",
            "background:linear-gradient(135deg,#2563eb,#06b6d4)"
            "}",

            "h1{",
            "margin:0;",
            "font-size:28px;",
            "letter-spacing:-.8px"
            "}",

            ".sub{",
            "margin:4px 0 0;",
            "font-size:13px;",
            "color:#64748b"
            "}",

            ".search{",
            "display:flex;",
            "gap:10px;",
            "margin-bottom:20px"
            "}",

            "input{",
            "flex:1;",
            "min-width:0;",
            "padding:15px 17px;",
            "border:1px solid #334155;",
            "border-radius:14px;",
            "background:#0b1220;",
            "color:white;",
            "font-size:14px;",
            "outline:none"
            "}",

            "input:focus{",
            "border-color:#3b82f6;",
            "box-shadow:0 0 0 3px rgba(59,130,246,.12)"
            "}",

            "button{",
            "border:0;",
            "border-radius:14px;",
            "padding:0 20px;",
            "background:linear-gradient(135deg,#2563eb,#06b6d4);",
            "color:#fff;",
            "font-weight:800;",
            "cursor:pointer"
            "}",

            "button:disabled{",
            "opacity:.5;",
            "cursor:not-allowed"
            "}",

            ".toolbar{",
            "display:flex;",
            "align-items:center;",
            "justify-content:space-between;",
            "gap:10px;",
            "margin-bottom:14px"
            "}",

            ".path{",
            "font-size:13px;",
            "color:#94a3b8;",
            "overflow:hidden;",
            "text-overflow:ellipsis;",
            "white-space:nowrap"
            "}",

            ".small-button{",
            "padding:9px 13px;",
            "font-size:12px;",
            "background:#1e293b"
            "}",

            ".status{",
            "min-height:20px;",
            "margin-bottom:12px;",
            "font-size:13px;",
            "color:#94a3b8"
            "}",

            ".error{color:#fca5a5}",

            ".success{color:#86efac}",

            ".files{",
            "display:grid;",
            "gap:10px"
            "}",

            ".file{",
            "display:flex;",
            "align-items:center;",
            "gap:14px;",
            "padding:14px;",
            "border-radius:16px;",
            "background:#0b1220;",
            "border:1px solid rgba(255,255,255,.06)"
            "}",

            ".icon{",
            "width:48px;",
            "height:48px;",
            "display:flex;",
            "justify-content:center;",
            "align-items:center;",
            "border-radius:13px;",
            "background:#172033;",
            "font-size:20px;",
            "flex-shrink:0"
            "}",

            ".info{",
            "min-width:0;",
            "flex:1"
            "}",

            ".name{",
            "font-size:14px;",
            "font-weight:800;",
            "white-space:nowrap;",
            "overflow:hidden;",
            "text-overflow:ellipsis"
            "}",

            ".meta{",
            "font-size:11px;",
            "color:#64748b;",
            "margin-top:4px"
            "}",

            ".actions{",
            "display:flex;",
            "gap:8px;",
            "flex-shrink:0"
            "}",

            ".action{",
            "text-decoration:none;",
            "padding:10px 13px;",
            "border-radius:10px;",
            "background:#1e293b;",
            "color:white;",
            "font-size:12px;",
            "font-weight:800"
            "}",

            ".action:hover{background:#334155}",

            ".empty{",
            "padding:35px 20px;",
            "text-align:center;",
            "color:#64748b"
            "}",

            ".footer{",
            "margin-top:20px;",
            "text-align:center;",
            "font-size:11px;",
            "color:#475569"
            "}",

            "@media(max-width:700px){",

            ".card{padding:20px 16px}",

            ".top{align-items:flex-start}",

            ".search{flex-direction:column}",

            "button{min-height:50px}",

            ".file{align-items:flex-start}",

            ".actions{flex-direction:column}",

            ".action{text-align:center}",

            "}",

            "</style>",

            "</head>",

            "<body>",

            "<div class=\"container\">",

            "<div class=\"card\">",

            "<div class=\"top\">",

            "<div class=\"brand\">",

            "<div class=\"logo\">TB</div>",

            "<div>",

            "<h1>TeraBox Downloader</h1>",

            "<p class=\"sub\">Browse and download files from your TeraBox account</p>",

            "</div>",

            "</div>",

            "</div>",

            "<div class=\"search\">",

            "<input id=\"searchInput\" placeholder=\"Search your TeraBox files...\" autocomplete=\"off\">",

            "<button id=\"searchButton\" type=\"button\">Search</button>",

            "</div>",

            "<div class=\"toolbar\">",

            "<div id=\"path\" class=\"path\">/</div>",

            "<button id=\"homeButton\" class=\"small-button\" type=\"button\">My Files</button>",

            "</div>",

            "<div id=\"status\" class=\"status\">Loading files...</div>",

            "<div id=\"files\" class=\"files\"></div>",

            "<div class=\"footer\">Personal-use downloader</div>",

            "</div>",

            "</div>",

            "<script>",

            "(function(){",

            "const filesBox=document.getElementById('files');",

            "const status=document.getElementById('status');",

            "const pathBox=document.getElementById('path');",

            "const searchInput=document.getElementById('searchInput');",

            "const searchButton=document.getElementById('searchButton');",

            "const homeButton=document.getElementById('homeButton');",

            "let currentPath='/';",

            "",

            "function size(bytes){",

            "const n=Number(bytes)||0;",

            "if(n<1024)return n+' B';",

            "if(n<1024*1024)return(n/1024).toFixed(1)+' KB';",

            "if(n<1024*1024*1024)return(n/(1024*1024)).toFixed(1)+' MB';",

            "return(n/(1024*1024*1024)).toFixed(1)+' GB';",

            "}",

            "",

            "function show(text,type){",

            "status.textContent=text||'';",

            "status.className='status '+(type||'');",

            "}",

            "",

            "function icon(file){",

            "if(file.isdir)return '📁';",

            "const name=(file.filename||'').toLowerCase();",

            "if(/\\.(mp4|mkv|mov|webm|avi)$/.test(name))return '🎬';",

            "if(/\\.(jpg|jpeg|png|webp|gif|avif)$/.test(name))return '🖼️';",

            "if(/\\.(mp3|wav|m4a|flac)$/.test(name))return '🎵';",

            "if(/\\.(pdf|doc|docx|txt|xls|xlsx|ppt|pptx)$/.test(name))return '📄';",

            "return '📦';",

            "}",

            "",

            "function render(files){",

            "filesBox.innerHTML='';",

            "if(!files.length){",

            "const empty=document.createElement('div');",

            "empty.className='empty';",

            "empty.textContent='No files found.';",

            "filesBox.appendChild(empty);",

            "return;",

            "}",

            "",

            "files.forEach(function(file){",

            "const row=document.createElement('div');",

            "row.className='file';",

            "",

            "const iconBox=document.createElement('div');",

            "iconBox.className='icon';",

            "iconBox.textContent=icon(file);",

            "",

            "const info=document.createElement('div');",

            "info.className='info';",

            "",

            "const name=document.createElement('div');",

            "name.className='name';",

            "name.textContent=file.filename||'Unnamed';",

            "",

            "const meta=document.createElement('div');",

            "meta.className='meta';",

            "meta.textContent=file.isdir?'Folder':'File • '+size(file.size);",

            "",

            "info.appendChild(name);",

            "info.appendChild(meta);",

            "",

            "row.appendChild(iconBox);",

            "row.appendChild(info);",

            "",

            "const actions=document.createElement('div');",

            "actions.className='actions';",

            "",

            "if(file.isdir){",

            "const open=document.createElement('button');",

            "open.className='action';",

            "open.textContent='Open';",

            "open.addEventListener('click',function(){loadFolder(file.path||'/');});",

            "actions.appendChild(open);",

            "}else{",

            "const download=document.createElement('button');",

            "download.className='action';",

            "download.textContent='Download';",

            "download.addEventListener('click',function(){downloadFile(file);});",

            "actions.appendChild(download);",

            "}",

            "",

            "row.appendChild(actions);",

            "filesBox.appendChild(row);",

            "});",

            "}",

            "",

            "async function loadFolder(path){",

            "currentPath=path||'/';",

            "pathBox.textContent=currentPath;",

            "show('Loading files...');",

            "filesBox.innerHTML='';",

            "",

            "try{",

            "const response=await fetch('/api/files?path='+encodeURIComponent(currentPath)+'&page=1',{cache:'no-store'});",

            "const data=await response.json();",

            "",

            "if(!response.ok||!data.ok){throw new Error(data.error||'Could not load files.');}",

            "",

            "render(Array.isArray(data.files)?data.files:[]);",

            "show((data.files||[]).length+' item(s)');",

            "}catch(error){",

            "show(error.message||'Could not load files.','error');",

            "}",

            "}",

            "",

            "async function search(){",

            "const q=searchInput.value.trim();",

            "if(!q){",

            "loadFolder('/');",

            "return;",

            "}",

            "",

            "show('Searching...');",

            "filesBox.innerHTML='';",

            "",

            "try{",

            "const response=await fetch('/api/search?q='+encodeURIComponent(q)+'&page=1',{cache:'no-store'});",

            "const data=await response.json();",

            "",

            "if(!response.ok||!data.ok){throw new Error(data.error||'Search failed.');}",

            "",

            "render(Array.isArray(data.files)?data.files:[]);",

            "pathBox.textContent='Search: '+q;",

            "show((data.files||[]).length+' result(s)');",

            "}catch(error){",

            "show(error.message||'Search failed.','error');",

            "}",

            "}",

            "",

            "async function downloadFile(file){",

            "if(!file||!file.fs_id){",

            "show('This file has no valid ID.','error');",

            "return;",

            "}",

            "",

            "show('Generating download link...');",

            "",

            "try{",

            "const response=await fetch('/api/download',{",

            "method:'POST',",

            "headers:{'Content-Type':'application/json'},",

            "body:JSON.stringify({fsIds:[file.fs_id]})",

            "});",

            "",

            "const data=await response.json();",

            "",

            "if(!response.ok||!data.ok){",

            "throw new Error(data.error||'Could not generate download link.');",

            "}",

            "",

            "const item=(data.links||[])[0];",

            "",

            "if(!item||!item.downloadUrl){",

            "throw new Error('TeraBox did not return a download URL.');",

            "}",

            "",

            "const a=document.createElement('a');",

            "a.href=item.downloadUrl;",

            "a.target='_blank';",

            "a.rel='noopener noreferrer';",

            "a.click();",

            "",

            "show('Download link opened.','success');",

            "}catch(error){",

            "show(error.message||'Download failed.','error');",

            "}",

            "}",

            "",

            "searchButton.addEventListener('click',search);",

            "",

            "searchInput.addEventListener('keydown',function(event){",

            "if(event.key==='Enter')search();",

            "});",

            "",

            "homeButton.addEventListener('click',function(){",

            "searchInput.value='';",

            "loadFolder('/');",

            "});",

            "",

            "loadFolder('/');",

            "",

            "})();",

            "</script>",

            "</body>",

            "</html>"
        ].join("");

        res.send(html);
    }
);


// ============================================================
// START
// ============================================================

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
