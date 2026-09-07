const { TeraBoxApp } = require("@cfbeg/terabox-api");

const ndus =
    String(
        process.env.TERABOX_NDUS || ""
    ).trim();

async function main() {

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

    const methods =
        Object.getOwnPropertyNames(
            Object.getPrototypeOf(tb)
        );

    console.log(
        "HAS doReq:",
        methods.includes("doReq")
    );

    console.log(
        "SESSION KEYS:",
        Object.keys(
            tb.data || {}
        )
    );

    console.log(
        "doReq type:",
        typeof tb.doReq
    );

    /*
     * We deliberately do NOT print tb.data values.
     * They contain session credentials/tokens.
     */

}

main().catch(
    error => {

        console.error(
            "TEST FAILED:",
            error.message
        );

        process.exit(1);

    }
);
