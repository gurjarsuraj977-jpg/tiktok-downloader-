const { TeraBoxApp } = require("@cfbeg/terabox-api");

const ndus = String(
    process.env.TERABOX_NDUS || ""
).trim();

async function main() {
    if (!ndus) {
        throw new Error("TERABOX_NDUS is missing.");
    }

    const tb = new TeraBoxApp(ndus, "ndus");

    const login = await tb.checkLogin();

    console.log("LOGIN ERRNO:", login?.errno);

    console.log(
        "doReq source:"
    );

    console.log(
        String(tb.doReq).slice(0, 3000)
    );

    console.log(
        "shortUrlInfo source:"
    );

    console.log(
        String(tb.shortUrlInfo).slice(0, 3000)
    );
}

main().catch(error => {
    console.error(
        "TEST FAILED:",
        error.message
    );

    process.exit(1);
});
