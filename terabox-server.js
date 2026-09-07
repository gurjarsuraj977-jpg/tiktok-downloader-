const express = require("express");
const { TeraBoxApp } = require("@cfbeg/terabox-api");

const app = express();
const PORT = process.env.PORT || 3000;

function extractSurl(input) {
    const value = String(input || "").trim();

    let match = value.match(/[?&]surl=([A-Za-z0-9_-]+)/i);

    if (!match) {
        match = value.match(/\/s\/([A-Za-z0-9_-]+)/i);
    }

    if (!match) {
        throw new Error("Could not extract surl.");
    }

    const raw = match[1];

    return raw.startsWith("1")
        ? raw.slice(1)
        : raw;
}

async function test() {
    const ndus =
        String(process.env.TERABOX_NDUS || "").trim();

    if (!ndus) {
        throw new Error("TERABOX_NDUS missing.");
    }

    const tb = new TeraBoxApp(ndus, "ndus");

    const login = await tb.checkLogin();

    if (
        !login ||
        Number(login.errno) !== 0
    ) {
        throw new Error("TeraBox login failed.");
    }

    const inputUrl =
        "https://teraboxshare.com/s/1N1_3C7UX3ZxIMjNi_D62Ag";

    const surl =
        extractSurl(inputUrl);

    console.log("Using surl:", surl);

    const jsToken =
        tb.data?.jsToken || "";

    const pcftoken =
        tb.data?.pcftoken || "";

    const logid =
        tb.data?.logid || "0";

    if (!jsToken) {
        throw new Error("No jsToken in session.");
    }

    const query =
        new URLSearchParams({
            clientfrom: "h5",
            psign: "0",
            pcftoken: pcftoken,
            clienttype: "0",
            channel: "dubox",
            shorturl: surl,
            root: "1",
            scene: "",
            app_id: "250528",
            web: "1",
            jsToken: jsToken,
            "dp-logid": String(logid)
        });

    const endpoint =
        "/api/shorturlinfo?" +
        query.toString();

    console.log(
        "Calling direct shorturlinfo..."
    );

    const result =
        await tb.doReq(
            endpoint,
            {
                method: "GET"
            }
        );

    console.log(
        "Direct API errno:",
        result?.errno
    );

    console.log(
        "Direct API fcount:",
        result?.fcount
    );

    console.log(
        "Direct API list length:",
        Array.isArray(result?.list)
            ? result.list.length
            : 0
    );

    const files =
        Array.isArray(result?.list)
            ? result.list.map(file => ({
                filename:
                    file.server_filename || "",
                size:
                    Number(file.size || 0),
                fs_id:
                    String(file.fs_id || "")
            }))
            : [];

    return {
        errno:
            result?.errno,
        fcount:
            result?.fcount,
        files
    };
}

app.get(
    "/",
    async (req, res) => {
        try {
            const result =
                await test();

            res.json({
                ok: true,
                result
            });

        } catch (error) {
            console.error(
                "Direct test failed:",
                error.message
            );

            res.status(500).json({
                ok: false,
                error:
                    error.message
            });
        }
    }
);

app.get(
    "/api/health",
    (req, res) => {
        res.json({
            ok: true,
            service:
                "TeraBox Direct API Test",
            status:
                "running"
        });
    }
);

app.listen(
    PORT,
    "0.0.0.0",
    () => {
        console.log(
            "TeraBox Direct API Test running on port " +
            PORT
        );
    }
);
