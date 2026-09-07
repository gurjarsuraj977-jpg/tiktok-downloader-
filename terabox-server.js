const { TeraBoxApp } = require("@cfbeg/terabox-api");

const ndus =
    String(process.env.TERABOX_NDUS || "").trim();

async function main() {
    if (!ndus) {
        throw new Error("TERABOX_NDUS missing");
    }

    const tb =
        new TeraBoxApp(ndus, "ndus");

    await tb.checkLogin();

    console.log(
        "Available methods:"
    );

    console.log(
        Object.getOwnPropertyNames(
            Object.getPrototypeOf(tb)
        )
    );

    console.log(
        "Internal data keys:"
    );

    console.log(
        Object.keys(tb.data || {})
    );

    console.log(
        "Session hostname:"
    );

    console.log(
        tb.host ||
        tb.hostname ||
        tb.data?.host ||
        "not exposed"
    );

    console.log(
        "Has shortUrlInfo:",
        typeof tb.shortUrlInfo
    );

    console.log(
        "Has doReq:",
        typeof tb.doReq
    );
}

main().catch(
    error => {
        console.error(
            error.message
        );

        process.exit(1);
    }
);
