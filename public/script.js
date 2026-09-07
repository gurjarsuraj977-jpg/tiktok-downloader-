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

    downloadLink.removeAttribute("download");

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

            urlInput.focus();

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
                            url: url
                        })
                    }
                );


            let data;

            try {

                data =
                    await response.json();

            } catch {

                throw new Error(
                    "The server returned an invalid response."
                );

            }


            if (
                !response.ok ||
                !data.ok
            ) {

                throw new Error(
                    data.error ||
                    "Download failed."
                );

            }


            if (!data.downloadUrl) {

                throw new Error(
                    "The server did not provide a download link."
                );

            }


            filenameBox.textContent =
                data.filename ||
                "TikTok video.mp4";


            downloadLink.href =
                data.downloadUrl;


            downloadLink.setAttribute(
                "download",
                data.filename ||
                "TikTok-video.mp4"
            );


            resultBox.classList.remove(
                "hidden"
            );


            hideStatus();


            // Automatically start the MP4 download
            const downloadUrl =
                data.downloadUrl;

            const temporaryLink =
                document.createElement("a");

            temporaryLink.href =
                downloadUrl;

            temporaryLink.setAttribute(
                "download",
                data.filename ||
                "TikTok-video.mp4"
            );

            document.body.appendChild(
                temporaryLink
            );

            temporaryLink.click();

            temporaryLink.remove();


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

            event.preventDefault();

            downloadBtn.click();

        }

    }
);
