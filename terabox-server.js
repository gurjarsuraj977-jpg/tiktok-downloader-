const express = require("express");
const { TeraBoxApp } = require("@cfbeg/terabox-api");

const app = express();
const PORT = process.env.PORT || 3000;

async function testTransfer() {
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

    if (
        !login ||
        Number(login.errno) !== 0
    ) {
        throw new Error(
            "TeraBox login failed."
        );
    }

    const shareId =
        581605428011;

    const fromUk =
        4400995370102;

    const fsId =
        842937368323081;

    const destination =
        "/TeraBox-Downloads";

    console.log(
        "Checking transfer status..."
    );

    const check =
        await tb.querySurlTransfer(
            shareId,
            fromUk
        );

    console.log(
        "Transfer check:",
        JSON.stringify(
            check
        )
    );

    if (
        !check ||
        Number(check.errno) !== 0
    ) {
        throw new Error(
            "Transfer check failed."
        );
    }

    console.log(
        "Running shareTransfer..."
    );

    const result =
        await tb.shareTransfer(
            shareId,
            fromUk,
            [fsId],
            destination,
            {
                ondup:
                    "newcopy"
            }
        );

    console.log(
        "Transfer result:"
    );

    console.log(
        JSON.stringify(
            result,
            null,
            2
        )
    );

    return result;
}

app.get(
    "/",
    async (req, res) => {

        try {

            const result =
                await testTransfer();

            res.json({
                ok: true,
                message:
                    "TeraBox share transfer completed.",
                result
            });

        } catch (error) {

            console.error(
                "TRANSFER FAILED:",
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
