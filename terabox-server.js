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

    /*
     * Use the same hostname your browser is using.
     */
    tb.params.whost =
        "https://dm.terabox.app";

    const surl =
        "N1_3C7UX3ZxIMjNi_D62Ag";

    const params =
        new URLSearchParams({
            clientfrom: "h5",
            psign: "0",
            pcftoken:
                String(
                    tb.data?.pcftoken || ""
                ),
            clienttype: "0",
            channel: "dubox",
            shorturl:
                "1" + surl,
            root: "1",
            scene: "",
            app_id: "250528",
            web: "1",
            jsToken:
                String(
                    tb.data?.jsToken || ""
                ),
            "dp-logid":
                String(
                    tb.data?.logid || "0"
                )
        });

    /*
     * IMPORTANT:
     * We do not print token values.
     */

    console.log(
        "Hostname:",
        tb.params.whost
    );

    console.log(
        "jsToken configured:",
        Boolean(tb.data?.jsToken)
    );

    console.log(
        "pcftoken configured:",
        Boolean(tb.data?.pcftoken)
    );

    console.log(
        "Calling exact browser-style shorturlinfo..."
    );

    const result =
        await tb.doReq(
            "/api/shorturlinfo?" +
            params.toString(),
            {
                method: "GET",
                headers: {
                    "Accept":
                        "application/json, text/plain, */*",
                    "X-Requested-With":
                        "XMLHttpRequest",
                    "Referer":
                        "https://dm.terabox.app/sharing/link?surl=" +
                        surl
                }
            }
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
        "RESULT LIST:",
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
                "DIRECT TEST FAILED:",
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
            "TeraBox direct API test running on port " +
            PORT
        );

    }
);
