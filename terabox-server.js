const express = require("express");
const { TeraBoxApp } = require("@cfbeg/terabox-api");

const app = express();
const PORT = process.env.PORT || 3000;

async function main() {
    const ndus =
        String(process.env.TERABOX_NDUS || "").trim();

    if (!ndus) {
        throw new Error("TERABOX_NDUS is missing.");
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
        throw new Error("TeraBox login failed.");
    }

    /*
     * These are metadata from the exact public share
     * you already resolved successfully in Chrome.
     *
     * No cookies or tokens are placed in this file.
     */

    const shareId =
        "581605428011";

    const fromUk =
        "4400995370102";

    const fsId =
        "842937368323081";

    console.log(
        "Checking whether shared file can be transferred..."
    );

    const check =
        await tb.querySurlTransfer(
            Number(shareId),
            Number(fromUk)
        );

    console.log(
        "TRANSFER CHECK:"
    );

    console.log(
        JSON.stringify(
            check,
            null,
            2
        )
    );

    /*
     * We stop here for the first test.
     * This avoids creating a duplicate copy without
     * first confirming that TeraBox allows the transfer.
     */

    return check;
}

app.get(
    "/",
    async (req, res) => {
        try {
            const result =
                await main();

            res.json({
                ok: true,
                transferCheck: result
            });

        } catch (error) {

            console.error(
                "TRANSFER TEST FAILED:",
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
                "TeraBox Transfer Test",
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
            "TeraBox Transfer Test running on port " +
            PORT
        );
    }
);
