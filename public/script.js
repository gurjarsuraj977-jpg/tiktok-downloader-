const urlInput =
    document.getElementById("urlInput");

const downloadBtn =
    document.getElementById("downloadBtn");

const buttonText =
    document.getElementById("buttonText");

const spinner =
    document.getElementById("spinner");

const statusBox =
    document.getElementById("status");

const resultBox =
    document.getElementById("result");

const downloadLink =
    document.getElementById("downloadLink");

const filenameBox =
    document.getElementById("filename");


function setLoading(loading) {

    downloadBtn.disabled = loading;

    if (loading) {

        buttonText.textContent = "Processing...";

        spinner.classList.remove("hidden");

    } else {

        buttonText.textContent = "Download";

        spinner.classList.add("hidden");

    }
}


function showStatus(message) {

    statusBox.textContent = message;

    statusBox.classList.remove("hidden");
}


function hideStatus() {

    statusBox.classList.add("hidden");
}


function hideResult() {

    resultBox.classList.add("hidden");

    downloadLink.href = "#";
}


downloadBtn.addEventListener(
    "click",
    async () => {

        const url =
            urlInput.value.trim();

        hideResult();

        if (!url) {

            showStatus(
                "Paste a TikTok URL first."
            );

            return;
        }

        setLoading(true);

        showStatus(
            "Fetching your video..."
        );

        try {

            const response =
                await fetch(
                    "/api/download",
                    {
                        method: "POST",

                        headers: {
                            "Content-Type":
                                "application/json"
                        },

                        body: JSON.stringify({
                            url
                        })
                    }
                );

            const data =
                await response.json();

            if (
                !response.ok ||
                !data.ok
            ) {

                throw new Error(
                    data.error ||
                    "Download failed."
                );
            }

            hideStatus();

            filenameBox.textContent =
                data.filename;

            downloadLink.href =
                data.downloadUrl;

            downloadLink.setAttribute(
                "download",
                data.filename
            );

            resultBox.classList.remove(
                "hidden"
            );

        } catch (error) {

            showStatus(
                error.message ||
                "Something went wrong."
            );

        } finally {

            setLoading(false);

        }
    }
);


urlInput.addEventListener(
    "keydown",
    event => {

        if (event.key === "Enter") {

            downloadBtn.click();

        }

    }
);
