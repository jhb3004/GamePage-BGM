import WebSocket from "ws";

const response = await fetch(
    "http://127.0.0.1:8080/json/list"
);

const targets = await response.json();

const names = [
    "Steam Big Picture Mode",
"SharedJSContext"
];

for (const name of names) {
    const target = targets.find(t => t.title === name);

    if (!target) {
        console.log(`Target not found: ${name}`);
        continue;
    }

    console.log("\n================================");
    console.log("TARGET:", name);
    console.log("================================");
    console.log("URL:", target.url);

    const ws = new WebSocket(
        target.webSocketDebuggerUrl
    );

    await new Promise((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
    });

    const result = await new Promise((resolve, reject) => {
        const id = 1;

        const handler = message => {
            const data = JSON.parse(message.toString());

            if (data.id !== id) return;

            ws.off("message", handler);

            if (data.error) reject(data.error);
            else resolve(data.result.result.value);
        };

            ws.on("message", handler);

            ws.send(JSON.stringify({
                id,
                method: "Runtime.evaluate",
                params: {
                    expression: `({
                        href: location.href,
                        title: document.title,
                        bodyText: document.body?.innerText?.slice(0, 4000),
                                  bodyHTML: document.body?.innerHTML?.slice(0, 2500)
                    })`,
                    returnByValue: true
                }
            }));
    });

    console.log(JSON.stringify(result, null, 2));

    ws.close();
}
