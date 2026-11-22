import WebSocket from "ws";

const response = await fetch("http://127.0.0.1:8080/json/list");
const targets = await response.json();

const target = targets.find(t => t.title === "Steam Big Picture Mode");

if (!target) {
    console.log("Steam Big Picture Mode target not found.");
    process.exit(1);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);

await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
});

const expression = `(() => {
    const labels = [
        "Manage",
        "Choose ThemeDeck music...",
        "Properties..."
    ];

    const results = {};

    for (const label of labels) {
        const matches = [...document.querySelectorAll("*")]
            .filter(el => {
                return el.children.length === 0 &&
                    (el.innerText || el.textContent || "").trim() === label;
            });

        const element = matches[0];

        if (!element) {
            results[label] = "Not found";
            continue;
        }

        let current = element;
        const ancestors = [];

        for (let i = 0; i < 5 && current; i++) {
            ancestors.push({
                tag: current.tagName,
                className: typeof current.className === "string"
                    ? current.className : "",
                role: current.getAttribute("role"),
                html: current.outerHTML.slice(0, 5000)
            });

            current = current.parentElement;
        }

        results[label] = ancestors;
    }

    return results;
})()`;

const result = await new Promise((resolve, reject) => {
    const handler = message => {
        const data = JSON.parse(message.toString());

        if (data.id !== 1) return;

        ws.off("message", handler);

        if (data.error) reject(data.error);
        else resolve(data.result.result.value);
    };

    ws.on("message", handler);

    ws.send(JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: {
            expression,
            returnByValue: true
        }
    }));
});

console.log(JSON.stringify(result, null, 2));
ws.close();
