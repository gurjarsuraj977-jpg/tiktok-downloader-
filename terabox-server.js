const express = require("express");

const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get("/api/health", (req, res) => {
    res.json({
        ok: true,
        service: "TeraBox Downloader",
        status: "running"
    });
});

app.get("/", (req, res) => {
    res.send("TeraBox Downloader is running!");
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(
        "TeraBox Downloader running on port " + PORT
    );
});
