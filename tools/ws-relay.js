// Small WebSocket relay for forwarding JSON messages between Control and Overlay
// Usage: node tools/ws-relay.js [port]
const port = Number(process.argv[2]) || 8765;
const WebSocket = require("ws");
const wss = new WebSocket.Server({ port });
console.log(`ws-relay listening on ws://localhost:${port}`);

wss.on("connection", function connection(ws) {
  ws.on("message", function incoming(message) {
    // Broadcast incoming message to all other clients
    try {
      const str = message.toString();
      // Optionally validate JSON
      JSON.parse(str);
      wss.clients.forEach(function each(client) {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(str);
        }
      });
    } catch (e) {
      // ignore non-json
    }
  });
});
