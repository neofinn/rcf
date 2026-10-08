importScripts('demo-backend.js', 'demo-server.js');
onconnect = (e) => {
  const port = e.ports[0];
  port.onmessage = async ({ data }) => {
    const res = await RCDemoServer.handle(data);
    port.postMessage({ id: data.id, ...res });
  };
  port.start();
};
