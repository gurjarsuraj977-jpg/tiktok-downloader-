const express = require("express");
const { TeraBoxApp } = require("@cfbeg/terabox-api");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());


// ======================================================
// HELPERS
// ======================================================

function extractShareCode(input) {
    const value = String(input || "").trim();

    let match = value.match(/[?&]surl=([A-Za-z0-9_-]+)/i);

    if (!match) {
        match = value.match(/\/s\/([A-Za-z0-9_-]+)/i);
    }

    if (!match) {
        throw new Error(
            "Could not extract the TeraBox share code."
        );
    }

    return match[1];
}


function isTeraBoxUrl(input) {
    try {
        const hostname =
            new URL(input).hostname.toLowerCase();

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


function normalizeFiles(value, output = [], seen = new Set(), depth = 0) {
    if (
        value === null ||
        value === undefined ||
        depth > 8
    ) {
        return output;
    }

    if (Array.isArray(value)) {
        for (const item of value) {
            normalizeFiles(
                item,
                output,
                seen,
                depth + 1
            );
        }

        return output;
    }

    if (typeof value !== "object") {
        return output;
    }

    if (
        value.fs_id !== undefined &&
        (
            value.server_filename ||
            value.filename ||
            value.path
        )
    ) {
        const id = String(value.fs_id);

        if (!seen.has(id)) {
            seen.add(id);
            output.push(value);
        }
    }

    for (const key of Object.keys(value)) {
        normalizeFiles(
            value[key],
            output,
            seen,
            depth + 1
        );
    }

    return output;
}


function formatFile(file) {
    return {
        filename:
            file.server_filename ||
            file.filename ||
            "TeraBox File",

        path:
            file.path ||
            "",

        size:
            Number(file.size || 0),

        fs_id:
            String(file.fs_id || ""),

        isdir:
            String(file.isdir || "0"),

        thumbnail:
            file.thumbs?.url3 ||
            file.thumbs?.url2 ||
            file.thumbs?.url1 ||
            file.thumbs?.icon ||
            ""
    };
}


// ======================================================
// TERABOX CLIENT
// ======================================================

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


// ======================================================
// RESOLVE SHARE
// ======================================================

async function resolveShare(url) {
    const tb =
        await createClient();

    const shareCode =
        extractShareCode(url);

    const candidates = [
        "s/" + shareCode,
        shareCode
    ];

    let lastError = null;

    for (const shortUrl of candidates) {
        try {

            console.log(
                "Trying TeraBox share:",
                shortUrl
            );

const info =
    await tb.shortUrlInfo(
        shortUrl
    );

console.log(
    "shortUrlInfo completed."
);

console.log(
    "shortUrlInfo errno:",
    info?.errno
);

console.log(
    "shortUrlInfo fcount:",
    info?.fcount
);

const rawFiles =
    Array.isArray(info?.list)
        ? info.list
        : [];

console.log(
    "Files directly in info.list:",
    rawFiles.length
);

const files =
    rawFiles
        .filter(
            file =>
                String(file.isdir) !== "1"
        )
        .map(
            formatFile
        );

            if (files.length > 0) {
                console.log(
                    "Files found from shortUrlInfo:",
                    files.length
                );

                return {
                    tb,
                    files
                };
            }

            console.log(
                "shortUrlInfo returned no file objects."
            );

        } catch (error) {

            lastError = error;

            console.log(
                "Share attempt failed:",
                error.message
            );
        }
    }

    /*
    Fallback to shortUrlList.
    */

    try {

        const tb =
            await createClient();

        const shortUrl =
            "s/" + shareCode;

        const listed =
            await tb.shortUrlList(
                shortUrl,
                "",
                1
            );

        const files =
            normalizeFiles(listed)
                .filter(
                    file =>
                        String(file.isdir) !== "1"
                )
                .map(
                    formatFile
                );

        if (files.length > 0) {

            console.log(
                "Files found from shortUrlList:",
                files.length
            );

            return {
                tb,
                files
            };
        }

    } catch (error) {

        lastError = error;

        console.log(
            "shortUrlList failed:",
            error.message
        );
    }

    throw new Error(
        lastError?.message ||
        "No files were found in this TeraBox share."
    );
}


// ======================================================
// DOWNLOAD LINKS
// ======================================================

async function getDownloadLinks(
    tb,
    files
) {
    const fsIds =
        files
            .map(
                file =>
                    Number(file.fs_id)
            )
            .filter(
                Number.isFinite
            );

    if (!fsIds.length) {
        throw new Error(
            "No valid file IDs were returned."
        );
    }

    console.log(
        "Requesting TeraBox download links..."
    );

    let result;

    /*
    Our earlier Render test proved this call works
    with this installed package/version.
    */

    try {

        result =
            await tb.download(
                fsIds
            );

    } catch (firstError) {

        console.log(
            "download(fsIds) failed:",
            firstError.message
        );

        /*
        Compatibility fallback for versions that
        require signb.
        */

        const home =
            await tb.getHomeInfo();

        const signb =
            home?.data?.signb ||
            home?.signb ||
            "";

        if (!signb) {
            throw firstError;
        }

        result =
            await tb.download(
                fsIds,
                signb
            );
    }

    console.log(
        "TeraBox download response received."
    );

    let items = [];

    if (
        Array.isArray(result?.dlink)
    ) {
        items = result.dlink;
    } else if (
        Array.isArray(result?.data?.dlink)
    ) {
        items = result.data.dlink;
    } else if (
        Array.isArray(result?.list)
    ) {
        items = result.list;
    } else if (
        Array.isArray(result?.data?.list)
    ) {
        items = result.data.list;
    }

    console.log(
        "Download links returned:",
        items.length
    );

    const links = new Map();

    for (const item of items) {

        if (
            item &&
            item.fs_id !== undefined &&
            item.dlink
        ) {
            links.set(
                String(item.fs_id),
                String(item.dlink)
            );
        }
    }

    return files.map(
        file => ({
            ...file,

            downloadUrl:
                links.get(
                    String(file.fs_id)
                ) || ""
        })
    );
}


// ======================================================
// HEALTH
// ======================================================

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


// ======================================================
// RESOLVE API
// ======================================================

app.post(
    "/api/resolve",
    async (req, res) => {

        try {

            const url =
                String(
                    req.body?.url || ""
                ).trim();

            console.log(
                "TeraBox resolve request received."
            );

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

            const resolved =
                await resolveShare(url);

            console.log(
                "Resolved files:",
                resolved.files.length
            );

            const files =
                await getDownloadLinks(
                    resolved.tb,
                    resolved.files
                );

            const ready =
                files.filter(
                    file =>
                        Boolean(
                            file.downloadUrl
                        )
                ).length;

            console.log(
                "Ready download links:",
                ready
            );

            return res.json({
                ok: true,
                files,
                count: files.length,
                ready
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


// ======================================================
// FRONTEND
// ======================================================

app.get(
    "/",
    (req, res) => {

        const html =
            "<!DOCTYPE html>" +
            "<html lang=\"en\">" +
            "<head>" +
            "<meta charset=\"UTF-8\">" +
            "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
            "<title>TeraBox Downloader</title>" +

            "<style>" +

            "*{box-sizing:border-box}" +

            "body{" +
            "margin:0;" +
            "min-height:100vh;" +
            "font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" +
            "background:radial-gradient(circle at top left,#172554 0,transparent 35%),radial-gradient(circle at bottom right,#164e63 0,transparent 35%),#05080d;" +
            "color:#fff;" +
            "display:flex;" +
            "justify-content:center;" +
            "align-items:center;" +
            "padding:20px" +
            "}" +

            ".container{width:100%;max-width:780px}" +

            ".card{" +
            "background:rgba(15,23,42,.95);" +
            "border:1px solid rgba(255,255,255,.09);" +
            "border-radius:28px;" +
            "padding:38px;" +
            "box-shadow:0 30px 100px rgba(0,0,0,.55)" +
            "}" +

            ".logo{" +
            "width:70px;" +
            "height:70px;" +
            "margin:0 auto 18px;" +
            "display:flex;" +
            "align-items:center;" +
            "justify-content:center;" +
            "border-radius:20px;" +
            "font-size:25px;" +
            "font-weight:900;" +
            "background:linear-gradient(135deg,#2563eb,#06b6d4)" +
            "}" +

            "h1{" +
            "margin:0;" +
            "text-align:center;" +
            "font-size:36px;" +
            "letter-spacing:-1px" +
            "}" +

            ".subtitle{" +
            "color:#94a3b8;" +
            "text-align:center;" +
            "line-height:1.6;" +
            "margin:10px auto 28px" +
            "}" +

            ".input-row{" +
            "display:flex;" +
            "gap:10px" +
            "}" +

            "input{" +
            "min-width:0;" +
            "flex:1;" +
            "padding:17px 18px;" +
            "border:1px solid #334155;" +
            "border-radius:15px;" +
            "background:#0b1220;" +
            "color:#fff;" +
            "outline:none;" +
            "font-size:15px" +
            "}" +

            "input:focus{" +
            "border-color:#3b82f6;" +
            "box-shadow:0 0 0 3px rgba(59,130,246,.13)" +
            "}" +

            "button{" +
            "border:0;" +
            "border-radius:15px;" +
            "padding:0 23px;" +
            "background:linear-gradient(135deg,#2563eb,#06b6d4);" +
            "color:#fff;" +
            "font-weight:800;" +
            "cursor:pointer;" +
            "white-space:nowrap" +
            "}" +

            "button:disabled{" +
            "opacity:.55;" +
            "cursor:not-allowed" +
            "}" +

            ".status{" +
            "display:none;" +
            "margin-top:22px;" +
            "padding:18px;" +
            "border-radius:18px;" +
            "background:#0b1220;" +
            "border:1px solid rgba(255,255,255,.07)" +
            "}" +

            ".message{" +
            "color:#cbd5e1;" +
            "font-size:14px;" +
            "line-height:1.5" +
            "}" +

            ".error{color:#fca5a5}" +
            ".success{color:#86efac}" +

            ".files{" +
            "display:grid;" +
            "gap:12px;" +
            "margin-top:18px" +
            "}" +

            ".file{" +
            "display:flex;" +
            "align-items:center;" +
            "gap:14px;" +
            "padding:14px;" +
            "border-radius:15px;" +
            "background:#111827;" +
            "border:1px solid rgba(255,255,255,.07)" +
            "}" +

            ".thumb{" +
            "width:76px;" +
            "height:58px;" +
            "object-fit:cover;" +
            "border-radius:9px;" +
            "background:#020617;" +
            "flex-shrink:0" +
            "}" +

            ".info{" +
            "min-width:0;" +
            "flex:1" +
            "}" +

            ".name{" +
            "font-weight:800;" +
            "white-space:nowrap;" +
            "overflow:hidden;" +
            "text-overflow:ellipsis" +
            "}" +

            ".size{" +
            "margin-top:4px;" +
            "color:#64748b;" +
            "font-size:12px" +
            "}" +

            ".download{" +
            "text-decoration:none;" +
            "color:#fff;" +
            "background:#1e293b;" +
            "padding:10px 14px;" +
            "border-radius:10px;" +
            "font-size:13px;" +
            "font-weight:800;" +
            "white-space:nowrap" +
            "}" +

            ".download:hover{background:#334155}" +

            ".missing{" +
            "color:#fbbf24;" +
            "font-size:12px" +
            "}" +

            ".note{" +
            "margin-top:20px;" +
            "text-align:center;" +
            "color:#475569;" +
            "font-size:11px" +
            "}" +

            "@media(max-width:620px){" +
            ".card{padding:25px 18px}" +
            "h1{font-size:30px}" +
            ".input-row{flex-direction:column}" +
            "button{min-height:52px}" +
            ".file{align-items:flex-start;flex-wrap:wrap}" +
            ".info{min-width:calc(100% - 95px)}" +
            ".download{width:100%;text-align:center}" +
            "}" +

            "</style>" +
            "</head>" +

            "<body>" +

            "<div class=\"container\">" +
            "<div class=\"card\">" +

            "<div class=\"logo\">TB</div>" +

            "<h1>TeraBox Downloader</h1>" +

            "<p class=\"subtitle\">" +
            "Paste a TeraBox share link and download your files." +
            "</p>" +

            "<div class=\"input-row\">" +

            "<input " +
            "id=\"urlInput\" " +
            "type=\"url\" " +
            "placeholder=\"Paste TeraBox share link...\" " +
            "autocomplete=\"off\">" +

            "<button " +
            "id=\"resolveButton\" " +
            "type=\"button\">" +
            "Get Files" +
            "</button>" +

            "</div>" +

            "<div id=\"status\" class=\"status\">" +

            "<div id=\"message\" class=\"message\"></div>" +

            "<div id=\"files\" class=\"files\"></div>" +

            "</div>" +

            "<div class=\"note\">" +
            "Personal-use downloader" +
            "</div>" +

            "</div>" +
            "</div>" +

            "<script>" +

            "(function(){" +

            "const input=document.getElementById('urlInput');" +
            "const button=document.getElementById('resolveButton');" +
            "const status=document.getElementById('status');" +
            "const message=document.getElementById('message');" +
            "const filesBox=document.getElementById('files');" +

            "function size(bytes){" +
            "const n=Number(bytes)||0;" +
            "if(n<1024)return n+' B';" +
            "if(n<1024*1024)return(n/1024).toFixed(1)+' KB';" +
            "if(n<1024*1024*1024)return(n/(1024*1024)).toFixed(1)+' MB';" +
            "return(n/(1024*1024*1024)).toFixed(1)+' GB';" +
            "}" +

            "function show(text,type){" +
            "status.style.display='block';" +
            "message.textContent=text;" +
            "message.className='message '+(type||'');" +
            "}" +

            "function render(files){" +
            "filesBox.innerHTML='';" +

            "files.forEach(function(file){" +

            "const row=document.createElement('div');" +
            "row.className='file';" +

            "if(file.thumbnail){" +
            "const img=document.createElement('img');" +
            "img.className='thumb';" +
            "img.src=file.thumbnail;" +
            "img.alt='';" +
            "row.appendChild(img);" +
            "}" +

            "const info=document.createElement('div');" +
            "info.className='info';" +

            "const name=document.createElement('div');" +
            "name.className='name';" +
            "name.textContent=file.filename||'TeraBox File';" +

            "const fileSize=document.createElement('div');" +
            "fileSize.className='size';" +
            "fileSize.textContent=size(file.size);" +

            "info.appendChild(name);" +
            "info.appendChild(fileSize);" +
            "row.appendChild(info);" +

            "if(file.downloadUrl){" +

            "const link=document.createElement('a');" +
            "link.className='download';" +
            "link.href=file.downloadUrl;" +
            "link.target='_blank';" +
            "link.rel='noopener noreferrer';" +
            "link.textContent='Download';" +
            "row.appendChild(link);" +

            "}else{" +

            "const missing=document.createElement('div');" +
            "missing.className='missing';" +
            "missing.textContent='Link unavailable';" +
            "row.appendChild(missing);" +

            "}" +

            "filesBox.appendChild(row);" +

            "});" +
            "}" +

            "async function resolve(){" +

            "const url=input.value.trim();" +

            "if(!url){" +
            "show('Paste a TeraBox link first.','error');" +
            "input.focus();" +
            "return;" +
            "}" +

            "button.disabled=true;" +
            "button.textContent='Resolving...';" +
            "filesBox.innerHTML='';" +
            "show('Connecting to TeraBox...');" +

            "try{" +

            "const response=await fetch('/api/resolve',{" +
            "method:'POST'," +
            "headers:{'Content-Type':'application/json'}," +
            "body:JSON.stringify({url:url})" +
            "});" +

            "const data=await response.json();" +

            "if(!response.ok||!data.ok){" +
            "throw new Error(data.error||'Could not resolve the link.');" +
            "}" +

            "const files=Array.isArray(data.files)?data.files:[];" +

            "if(!files.length){" +
            "throw new Error('No files were found in this share.');" +
            "}" +

            "render(files);" +

            "show(" +
            "String(data.ready||0)+' download link(s) ready.'," +
            "(Number(data.ready||0)>0?'success':'error')" +
            ");" +

            "}catch(error){" +

            "show(error.message||'Something went wrong.','error');" +

            "}finally{" +

            "button.disabled=false;" +
            "button.textContent='Get Files';" +

            "}" +

            "}" +

            "button.addEventListener('click',resolve);" +

            "input.addEventListener('keydown',function(event){" +
            "if(event.key==='Enter')resolve();" +
            "});" +

            "})();" +

            "</script>" +

            "</body>" +
            "</html>";


        res.send(html);
    }
);


// ======================================================
// START SERVER
// ======================================================

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
