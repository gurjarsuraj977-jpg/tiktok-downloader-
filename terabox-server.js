const express = require("express");
const { TeraBoxApp } = require("@cfbeg/terabox-api");

const app = express();
const PORT = process.env.PORT || 3000;

async function testDownload() {
    const ndus = String(
        process.env.TERABOX_NDUS || ""
    ).trim();

    if (!ndus) {
        throw new Error(
            "TERABOX_NDUS is missing."
        );
    }

    console.log("Creating TeraBox session...");

    const tb = new TeraBoxApp(
        ndus,
        "ndus"
    );

    const login =
        await tb.checkLogin();

    console.log(
        "Login:",
        JSON.stringify(login)
    );

    if (
        !login ||
        Number(login.errno) !== 0
    ) {
        throw new Error(
            "TeraBox login failed."
        );
    }

    console.log(
        "Getting root directory..."
    );

    const remote =
        await tb.getRemoteDir("/");

    const list =
        remote?.data?.list ||
        remote?.list ||
        [];

    console.log(
        "Files found:",
        list.length
    );

    if (!list.length) {
        throw new Error(
            "No files found in root."
        );
    }

    const firstFile =
        list.find(
            item =>
                String(item.isdir) !== "1"
        );

    if (!firstFile) {
        throw new Error(
            "No downloadable file found."
        );
    }

    console.log(
        "Testing download link for:",
        firstFile.server_filename ||
        firstFile.filename
    );

    console.log(
        "FS ID:",
        String(firstFile.fs_id)
    );

    const downloadResult =
        await tb.download([
            String(firstFile.fs_id)
        ]);

    console.log(
        "Download API response received."
    );

    console.log(
        JSON.stringify(
            downloadResult,
            null,
            2
        )
    );

    const downloadList =
        downloadResult?.data?.list ||
        downloadResult?.list ||
        [];

    const item =
        downloadList[0] || null;

    return {
        filename:
            firstFile.server_filename ||
            firstFile.filename ||
            "",

        fs_id:
            String(firstFile.fs_id || ""),

        size:
            Number(firstFile.size || 0),

        dlink:
            item?.dlink || ""
    };
}

app.get(
    "/api/health",
    (req, res) => {
        res.json({
            ok: true,
            service: "TeraBox Download Test",
            status: "running"
        });
    }
);

app.get(
    "/",
    async (req, res) => {

        try {

            const result =
                await testDownload();

            res.json({
                ok: true,
                message:
                    "TeraBox download-link test passed.",
                file:
                    result.filename,
                size:
                    result.size,
                fs_id:
                    result.fs_id,
                downloadLinkAvailable:
                    Boolean(
                        result.dlink
                    )
            });

        } catch (error) {

            console.error(
                "Download test failed:",
                error
            );

            res.status(500).json({
                ok: false,
                error:
                    error.message ||
                    "Download test failed."
            });
        }
    }
);

app.listen(
    PORT,
    "0.0.0.0",
    () => {
        console.log(
            "TeraBox Download Test running on port " +
            PORT
        );
    }
);
