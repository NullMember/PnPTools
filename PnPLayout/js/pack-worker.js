// Runs the packer off the main thread so the page stays responsive.
importScripts('packer.js');

self.onmessage = (e) => {
    const { id, job } = e.data;
    try {
        const result = Packer.pack(job, (p) => self.postMessage({ id, progress: p }));
        self.postMessage({ id, result });
    } catch (err) {
        self.postMessage({ id, error: err.message });
    }
};
