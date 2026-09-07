const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

async function main() {
    const ndus = process.env.TERABOX_NDUS;

    if (!ndus) {
        throw new Error(
            "TERABOX_NDUS is not configured in Render."
        );
    }

    const mod = await import("@cfbeg/terabox-api");

    console.log(
        "TeraBox package loaded successfully."
    );

    console.log(
        "TERABOX_NDUS configured:",
        Boolean(ndus)
    );

    console.log(
        "Exported module keys:",
        Object.keys(mod)
    );

    app.get("/", (req, res) => {
        res.json({
            ok: true,
            service: "TeraBox Auth Test",
            packageLoaded: true,
            ndusConfigured: true
        });
    });

    app.get("/api/health", (req, res) => {
        res.json({
            ok: true,
            service: "TeraBox Auth Test",
            status: "running"
        });
    });

    app.listen(PORT, "0.0.0.0", () => {
        console.log(
            "TeraBox Auth Test running on port " +
            PORT
        );
    });
}

main().catch((error) => {
    console.error(
        "TeraBox auth test failed:"
    );

    console.error(
        error.message
    );

    process.exit(1);
});
