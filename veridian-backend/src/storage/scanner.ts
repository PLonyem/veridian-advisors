import net from "node:net";
import { config } from "../config.js";

export type ScanResult = { clean: boolean; reference: string };

export async function scanPdf(content: Buffer): Promise<ScanResult> {
  if (config.SCANNER_ADAPTER === "development-allow-pdf") {
    if (config.NODE_ENV === "production") throw new Error("Development scanner is forbidden in production");
    return { clean: true, reference: "development-signature-check-only" };
  }
  if (!config.CLAMAV_HOST || !config.CLAMAV_PORT) throw new Error("ClamAV scanner configuration is incomplete");
  const host = config.CLAMAV_HOST;
  const port = config.CLAMAV_PORT;
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => socket.destroy(new Error("ClamAV scan timed out")), 20_000);
    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      for (let offset = 0; offset < content.length; offset += 64 * 1024) {
        const chunk = content.subarray(offset, Math.min(offset + 64 * 1024, content.length));
        const length = Buffer.alloc(4);
        length.writeUInt32BE(chunk.length);
        socket.write(length);
        socket.write(chunk);
      }
      socket.end(Buffer.alloc(4));
    });
    socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    socket.on("error", reject);
    socket.on("close", () => {
      clearTimeout(timer);
      const response = Buffer.concat(chunks).toString("utf8").replace(/\0/g, "").trim();
      if (response.endsWith("OK")) resolve({ clean: true, reference: response });
      else if (response.includes("FOUND")) resolve({ clean: false, reference: response.slice(0, 300) });
      else reject(new Error(`Unexpected ClamAV response: ${response.slice(0, 200)}`));
    });
  });
}
