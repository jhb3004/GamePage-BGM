import WebSocket from "ws";

async function main() {
    const response = await fetch(
        "http://127.0.0.1:8080/json/list"
    );

    const targets = await response.json();

    const target = targets.find(
        t => t.title === "SharedJSContext"
    );

    if (!target) {
        console.log("SharedJSContext not found");
        return;
    }

    const ws = new WebSocket(
        target.webSocketDebuggerUrl
    );

    await new Promise(resolve =>
    ws.once("open", resolve)
    );

    console.log("Connected: SharedJSContext");

    let requestId = 1;
    let lastUrl = "";

    function checkUrl() {
        ws.send(JSON.stringify({
            id: requestId++,
            method: "Runtime.evaluate",
            params: {
                expression: "location.href",
                returnByValue: true
            }
        }));
    }

    ws.on("message", message => {
        const data = JSON.parse(message.toString());

        if (!data.result?.result?.value) return;

        const url = data.result.result.value;

        if (url === lastUrl) return;

        lastUrl = url;

        const match = url.match(
            /\/routes\/library\/app\/(\d+)/
        );

        if (match) {
            console.log("GAME PAGE:", match[1]);
        } else {
            console.log("OTHER PAGE:", url);
        }
    });

    setInterval(checkUrl, 500);

    checkUrl();
}

main().catch(console.error);
