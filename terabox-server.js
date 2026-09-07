const express = require("express");
const { TeraBoxApp } = require("@cfbeg/terabox-api");

const app = express();
const PORT = process.env.PORT || 3000;

async function test() {
    const ndus =
        String(
            process.env.TERABOX_NDUS || ""
        ).trim();

    if (!ndus) {
        throw new Error(
            "TERABOX_NDUS is missing."
        );
    }

    const tb =
        new TeraBoxApp(
            ndus,
            "ndus"
        );

    const login =
        await tb.checkLogin();

    console.log(
        "LOGIN ERRNO:",
        login?.errno
    );

    if (
        !login ||
        Number(login.errno) !== 0
    ) {
        throw new Error(
            "TeraBox login failed."
        );
    }

    const shortUrl =
        "N1_3C7UX3ZxIMjNi_D62Ag";

    console.log(
        "Calling shortUrlInfo with:",
        shortUrl
    );

    const result =
        await tb.shortUrlInfo(
            shortUrl
        );

    console.log(
        "RESULT ERRNO:",
        result?.errno
    );

    console.log(
        "RESULT FCOUNT:",
        result?.fcount
    );

    console.log(
        "RESULT LIST LENGTH:",
        Array.isArray(result?.list)
            ? result.list.length
            : 0
    );

    if (
        Array.isArray(result?.list)
    ) {
        for (
            const file of result.list
        ) {
            console.log(
                "FILE:",
                file.server_filename ||
                "",
                "| FS_ID:",
                String(
                    file.fs_id || ""
                ),
                "| SIZE:",
                String(
                    file.size || ""
                )
            );
        }
    }

    return result;
}

app.get(
    "/api/health",
    (req, res) => {
        res.json({
            ok: true,
            service:
                "TeraBox Share Test",
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
                await test();

            res.json({
                ok: true,
                errno:
                    result?.errno,
                fcount:
                    result?.fcount,
                files:
                    Array.isArray(
                        result?.list
                    )
                        ? result.list.map(
                            file => ({
                                name:
                                    file.server_filename ||
                                    "",
                                fs_id:
                                    String(
                                        file.fs_id ||
                                        ""
                                    ),
                                size:
                                    Number(
                                        file.size ||
                                        0
                                    )
                            })
                        )
                        : []
            });

        } catch (error) {

            console.error(
                "TEST FAILED:",
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

app.listen(
    PORT,
    "0.0.0.0",
    () => {
        console.log(
            "TeraBox Share Test running on port " +
            PORT
        );
    }
);
