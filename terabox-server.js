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

    console.log(
        "TeraBoxApp created successfully."
    );

    console.log(
        "Updating TeraBox session data..."
    );

    await tb.update_app_data();

    console.log(
        "Session data updated successfully."
    );

    console.log(
        "jsToken available:",
        Boolean(tb.data?.jsToken)
    );

    console.log(
        "pcftoken available:",
        Boolean(tb.data?.pcftoken)
    );

    console.log(
        "csrf available:",
        Boolean(tb.data?.csrf)
    );

    console.log(
        "Checking TeraBox login..."
    );

    const loginResult =
        await tb.check_login();

    console.log(
        "Login check completed."
    );

    console.log(
        "Login result:",
        JSON.stringify(
            loginResult,
            null,
            2
        )
    );

    let userInfo = null;

    try {
        userInfo =
            await tb.get_current_user_info();

        console.log(
            "User information retrieved."
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
            "User info request failed:",
            error.message
        );
    }

    return {
        loginResult,
        userInfo
    };
}

app.get(
    "/api/health",
    (req, res) => {
        res.json({
            ok: true,
            service: "TeraBox Auth Test",
            status: "running"
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
                message:
                    "TeraBox authentication test passed.",
                loginResult:
                    result.loginResult,
                userInfo:
                    result.userInfo
            });
        } catch (error) {
            console.error(
                "TeraBox authentication test failed:",
                error
            );

            res.status(500).json({
                ok: false,
                authenticated: false,
                error:
                    error.message ||
                    "TeraBox authentication failed."
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
