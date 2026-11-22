import WebSocket from "ws";

const getTargets = async () => {
    const response = await fetch(
        "http://127.0.0.1:8080/json/list"
    );
    return response.json();
};

const targets = await getTargets();

for (const name of [
    "Steam Big Picture Mode",
     "SharedJSContext"
]) {
    const target = targets.find(t => t.title === name);

    if (!target) {
        console.log("Missing target:", name);
        continue;
    }

    const ws = new WebSocket(target.webSocketDebuggerUrl);

    await new Promise((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
    });

    const result = await new Promise((resolve, reject) => {
        ws.once("message", message => {
            const data = JSON.parse(message.toString());

            if (data.error) reject(data.error);
            else resolve(data.result.result.value);
        });

            ws.send(JSON.stringify({
                id: 1,
                method: "Runtime.evaluate",
                params: {
                    expression: `({
                        href: location.href,
                        title: document.title,
                        bodyText: document.body?.innerText?.slice(0, 1000),
                                  appIds: [
                                      ...document.querySelectorAll("[data-appid]")
                                  ].map(el => el.getAttribute("data-appid"))
                    })`,
                    returnByValue: true
                }
            }));
    });

    console.log("\\nTARGET:", name);
    console.log(JSON.stringify(result, null, 2));

    ws.close();
}
