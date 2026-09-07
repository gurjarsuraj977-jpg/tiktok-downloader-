const express = require("express");
const { TeraBoxApp } = require("@cfbeg/terabox-api");

const app = express();
const PORT = process.env.PORT || 3000;

async function testTeraBox() {
    const ndus = String(
        process.env.TERABOX_NDUS || ""
    ).trim();

    if (!ndus) {
        throw new Error(
            "TERABOX_NDUS is missing in Render."
        );
    }

    console.log("Creating TeraBox session...");

    const tb = new TeraBoxApp(
        ndus,
        "ndus"
    );

    console.log("Checking login...");

    const login = await tb.checkLogin();

    console.log(
        "Login result:",
        JSON.stringify(login, null, 2)
    );

    if (
        !login ||
        Number(login.errno) !== 0
    ) {
        throw new Error(
            "TeraBox login/session is not valid."
        );
    }

    console.log("Listing root directory...");

    const result =
        await tb.getRemoteDir("/");

    console.log(
        "Root directory result:",
        JSON.stringify(
            result,
            null,
            2
        )
    );

    const list =
        result?.data?.list ||
        result?.list ||
        [];

    console.log(
        "Files found:",
        list.length
    );

    for (const item of list.slice(0, 10)) {
        console.log(
            "FILE:",
            item.server_filename ||
            item.filename ||
            item.path ||
            "(unknown)"
        );
    }

    return {
        login,
        count: list.length,
        files: list.slice(0, 10).map(
            item => ({
                name:
                    item.server_filename ||
                    item.filename ||
                    "",
                path:
                    item.path ||
                    "",
                size:
                    Number(item.size || 0),
                fs_id:
                    String(item.fs_id || ""),
                isdir:
                    String(item.isdir || "0")
            })
        )
    };
}

app.get(
    "/api/health",
    (req, res) => {
        res.json({
            ok: true,
            service:
                "TeraBox Auth Test",
            status:
                "running"
        });
    }
);

app.get(
    "/",
    async (req, res) => {
        try {
            const result =
                await testTeraBox();

            res.json({
                ok: true,
                authenticated: true,
                fileCount:
                    result.count,
                files:
                    result.files
            });

        } catch (error) {

            console.error(
                "TeraBox test failed:",
                error
            );

            res.status(500).json({
                ok: false,
                authenticated: false,
                error:
                    error.message ||
                    "TeraBox test failed."
            });
        }
    }
);

app.listen(
    PORT,
    "0.0.0.0",
    () => {
        console.log(
            "TeraBox Auth Test running on port " +
            PORT
        );
    }
);
