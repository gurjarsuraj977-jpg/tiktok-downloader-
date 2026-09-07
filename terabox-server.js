const express = require("express");
const { TeraBoxApp } = require("@cfbeg/terabox-api");

const app = express();
const PORT = process.env.PORT || 3000;

async function main() {
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

    console.log("TeraBoxApp created.");

    // Show available methods without printing secrets.
    const prototypeMethods =
        Object.getOwnPropertyNames(
            Object.getPrototypeOf(tb)
        ).filter(
            name =>
                name !== "constructor"
        );

    console.log(
        "Available TeraBoxApp methods:",
        prototypeMethods
    );

    // Try the current Node-style method.
    if (
        typeof tb.checkLogin !==
        "function"
    ) {
        throw new Error(
            "checkLogin() was not found. See the methods printed above."
        );
    }

    console.log(
        "Running checkLogin()..."
    );

    const loginResult =
        await tb.checkLogin();

    console.log(
        "checkLogin completed."
    );

    console.log(
        "Login result:",
        JSON.stringify(
            loginResult,
            null,
            2
        )
    );

    // Try user information if available.
    let userInfo = null;

    if (
        typeof tb.getCurrentUserInfo ===
        "function"
    ) {
        try {
            userInfo =
                await tb.getCurrentUserInfo();

            console.log(
                "User info retrieved."
            );

            console.log(
                "User info:",
                JSON.stringify(
                    userInfo,
                    null,
                    2
                )
            );
        } catch (error) {
            console.log(
                "User info failed:",
                error.message
            );
        }
    }

    app.get(
        "/",
        (req, res) => {
            res.json({
                ok: true,
                authenticated:
                    true,
                message:
                    "TeraBox authentication test passed."
            });
        }
    );

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
}

main().catch(error => {
    console.error(
        "TeraBox authentication test failed:"
    );

    console.error(
        error.message
    );

    process.exit(1);
});
